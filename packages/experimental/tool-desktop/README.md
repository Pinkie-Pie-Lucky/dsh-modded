---
description: "Windows desktop tools: window listing, screen capture, and pointer/keyboard input."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-desktop

English | [中文](README.zh.md)

## Summary

This package gives a Windows host seven model-facing desktop tools: list the visible windows, capture the screen or one window, focus a window, move the pointer, click, type text, and send a key combination. Every tool drives the host's own desktop session through a fresh PowerShell process, with the window walk and input injection running in compiled C# helpers. A host that is not Windows registers nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in the profile that should own the tools. Nothing else is required: the package contributes no service, no client half, and no configuration.

```yaml
- insert:
    - id: tool-desktop
      name: '@deepseek-ai/dsh-tool-desktop'
```

| Tool | Action |
| --- | --- |
| `desktop_windows` | List visible top-level windows: handle, process, title, geometry, foreground and minimized state. Read-only. |
| `desktop_screenshot` | Capture the virtual screen or one window and return the image with its pixel mapping. Read-only. |
| `desktop_find` | Locate controls inside a window through UI Automation and report each match's rectangle and patterns. Read-only. |
| `desktop_invoke` | Act on one control through UI Automation (invoke, set or read a value, toggle, select, expand, collapse, scroll into view) without taking the foreground. |
| `desktop_focus` | Bring one window to the foreground, restoring it first when minimized. |
| `desktop_move` | Move the pointer to an absolute screen pixel without pressing. |
| `desktop_click` | Move to an absolute point and click (left, right, middle; single or double). |
| `desktop_type` | Type text into one named window, Unicode included, without touching the clipboard. |
| `desktop_keys` | Send one combination such as `ctrl+s`, `alt+f4`, or `enter` to one named window. |

The tools are the hands, not the judgement. They cannot tell personal work from company work: the instructions around them own that boundary, and the descriptions carry the two rules that matter — confirm the target from a fresh capture before an irreversible click or key, and ask the user before anything that submits, sends, deletes, or closes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each tool call spawns one PowerShell process with `-EncodedCommand` (base64 UTF-16LE), so no quoting or code page can corrupt a script; results come back as a UTF-8 file the Node side reads, which is what keeps non-ASCII window titles intact. `powerShellExecutable()` prefers `pwsh.exe` and falls back to the OS-provided `powershell.exe`.

The window walk and the title match run inside the compiled C# helper rather than in a PowerShell scriptblock. A scriptblock converted to a delegate runs outside the caller's variables, so a collecting callback there silently returns an empty list — a failure this package hit during development and avoids by keeping the callback in C#.

Input injection uses `SendInput` with `KEYEVENTF_UNICODE` for typing and `keybd_event` for named keys: the Unicode path carries Chinese and emoji without a clipboard round trip, and it needs no single-threaded-apartment host. Captures are 1:1 by default and report the captured rectangle and the scale, so a point measured on the returned image maps back onto screen pixels; `max_width` scales the image down when a full-screen capture would be too large. The capture PNG is stored through the attachment service and its temporary file is released whether or not storage accepted it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [tools](../../../docs/subsystems/tools.md) — the tool pipeline, definitions, and the model-facing schema projection.
- [computer-use](../../computer-use/computer-use/README.md) — the provider registry the shipped macOS implementation uses; this package drives Windows directly instead.
- [filesystem](../../fs/tool-fs/README.md) — the sibling source of `read_image`, whose attachment-and-image-block result shape the capture tool follows.

-----

<a id="model-experience"></a>
## Model Experience

### Desktop tools

#### What the model sees

Eight tool definitions with fixed schemas: `desktop_windows` (optional `title_contains`), `desktop_screenshot` (`window`, `max_width`), `desktop_find` (`window`, `name`, `class_name`, `control_type`, `automation_id`, `limit`), `desktop_focus` (`window`), `desktop_move` (`x`, `y`), `desktop_click` (`window`, `x`, `y`, `button`, `count`), `desktop_type` (`window`, `text`), and `desktop_keys` (`window`, `keys`). Descriptions state the coordinate space, that a capture reports its own origin and scale, that keyboard input names its window, and the two safety rules: confirm the target from a fresh capture before an irreversible action, and ask the user before anything that submits, sends, deletes, or closes.

#### Token effect

Fixed schema cost on every request where the tools are visible. Results are small except for a capture, which adds a text envelope plus an image block: image tokens scale with the captured area, so `max_width` bounds that cost.

#### KV Cache effect

Prefix-stable while the definitions and their visibility are unchanged. Registering the package, unloading it, or changing which presets see the tools changes the tool set and therefore reuse from that point on.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Windows only** — a host on another platform registers nothing; the shipped Computer Use implementation covers macOS instead.
- **Coordinates are blind** — the tools address absolute screen pixels, so a layout change between capture and click lands the click somewhere else. Always capture immediately before acting.
- **No element-level targeting** — nothing here walks the UI Automation tree, so a click cannot be addressed to a named control; Electron applications such as chat clients expose little of that tree anyway.
- **Coordinates are physical pixels** — every script makes its process DPI-aware before its first window call, so window rectangles, cursor positions, and captures share one coordinate space under display scaling. On a 150%-scaled host the screen reports 1707×1067 to a DPI-unaware caller and 2560×1600 to these tools, so a coordinate taken from anywhere else lands somewhere else. Always take coordinates from `desktop_windows`.
- **A capture copies the screen, not the window** — a covered window is captured as covered, so the capture helper brings the target to the foreground first. A window that closes between the rectangle read and the copy reports an empty rectangle instead of returning a stale image.
- **Keyboard input names its window** — `desktop_type` and `desktop_keys` take the target window, bring it forward, and verify it holds the foreground before injecting. Focus is never carried between tool calls: the user can switch windows in between, and text delivered to their window cannot be recalled.
- **Control lookup depends on the target's provider** — `desktop_find` reads the UI Automation tree, whose quality varies by application: classic Win32 controls often report no accessible name and no usable patterns (Notepad's edit control exposes only its class name, and an empty pattern list), while modern frameworks expose names and automation ids. Match by class name or control type when names are empty, and use a match's rectangle as input for `desktop_click` instead of calling its patterns. Some providers also build the tree on demand, so querying a window handle directly is more reliable than searching every window of a process.
- **Acting on a control can raise its window** — `desktop_invoke` needs no coordinates, never moves the pointer, reaches controls scrolled out of view, and the target does not have to be in the foreground for the action to succeed. Measured twice, it nevertheless brought the window to the foreground: `invoke` on Calculator (a UWP app) and `set_value` on a classic Win32 edit control, while a read-only `desktop_find` walk did not. Treat `desktop_invoke` as a steadier way to aim than pixel coordinates, not as a silent background action.
- **Every call pays process startup** — one PowerShell process per call, including C# compilation, costs roughly a second.
- **Captures show whatever is on screen** — a capture can include content the user did not offer, and it enters the session as an image block; the caller must ask first.
- **The package does not enforce scope** — the personal-versus-company boundary lives in the instructions around the tools, not in their code.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package is `private` and unpublished: it exists for a local, personal-use profile. Its `lib/index.js` is built by the package-local `tsdown.config.ts` because the root workspace build supplies entries for host packages but this row is mounted from a profile patch rather than from a bundle's own dependency list.

Every C# helper stays inside C# 5 syntax. The tools run under whichever PowerShell the host provides — `powershell.exe` from Windows PowerShell 5.1 included — and that `Add-Type` rejects later language features: an inline `out` declaration fails to compile, so out-parameters are declared first.

Every tool shares one long-lived PowerShell process ([session.ts](src/session.ts)): it reads one script path per line, dot-sources that script, and answers with a single marker line, so the interpreter and the compiled helpers are paid for once. Spawning the process and compiling the helpers otherwise dominates a call — measured on this host, listing windows took a median of 1854 ms per call with a fresh process and 370 ms through the session. The session is an optimisation, never a requirement: `runPowerShellJson` falls back to a one-shot process whenever the session is unavailable, and a command that overruns its deadline takes the process down so the next call starts clean.

</details>
