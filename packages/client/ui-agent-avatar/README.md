---
description: "The agent's own identity in the interface: reply avatar, sidebar mark, and name."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-avatar

English | [中文](README.zh.md)

## Summary

This package gives the agent its interface identity: the avatar beside each assistant reply, and the mark and name in the sidebar's brand row. Chat and the sidebar declare those seats, and each renders its own fallback while the seat is unoccupied, so removing this row restores the shell's fish mark, its local-build label, and full-width replies without touching message content, Session data, or any model request.

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

The Web composition mounts this plugin beside the other Chat rows. There is no setting or Plugins-page toggle: the row is the only switch, and the identity ships inside the package.

### The three seats

| Seat | Rendered |
| --- | --- |
| `conversation.chat.assistant.before` | The avatar in the gutter before an assistant reply body. |
| `sidebar.brand.mark` | The same artwork as the sidebar's brand mark, at the size the sidebar requests (24px). |
| `sidebar.brand.name` | The name beside that mark, in the brand row's own 18px/600 typography. |

### Replacing the identity

Replace the packaged [artwork](src/client/assets/avatar.svg) with your own image and rebuild the package. The client build supports the asset formats `.svg`, `.png`, `.webp`, `.jpg`, and `.jpeg`; it emits the file under `lib/assets/` with a content revision and compiles the import into the document-relative URL the asset route serves. The name is `AGENT_NAME` in [`src/client/AgentIdentityName.tsx`](src/client/AgentIdentityName.tsx). A foreign identity belongs in another occupant of a seat — every seat here is single-occupant, so an alternative replaces this row rather than joining it.

### Which replies carry the avatar

The reply seat renders once per reply body. A folded Turn passes `groupPart: 'reasoning'` for its process fragments, which stay unmarked, so a turn shows the avatar beside the reply instead of beside its narration. `final` reports whether the body carries the Turn's final reply, and `step` reports the assistant step within the Turn, so a different occupant can apply a different rule without a Chat change.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Chat's assistant-step renderer declares `conversation.chat.assistant.before` and renders it in a fixed 28px gutter before the reply body; the sidebar declares `sidebar.brand.mark` and `sidebar.brand.name` in its brand row. An empty seat renders no element, so an unoccupied gutter reserves no space and an unoccupied brand row keeps the shell's fish mark and local-build label. This package registers all three through `ctx.slots.inject()`, so it works whether the row activates before or after its declarers, and it withdraws with them, leaving no partial identity during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. One artwork serves both surfaces: the client preset emits it under `lib/assets/` and rewrites each import into the `require.asset()` reference the client module loader resolves. The artwork is a paper disc with an ink whale, so it holds on light and dark themes without a theme-specific variant.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-chat](../ui-chat/README.md) — declares the `conversation.chat.assistant.before` seat and renders the reply gutter around it.
- [ui-sidebar](../ui-sidebar/README.md) — declares and renders the brand row's mark and name seats.
- [ui-brand-official](../ui-brand-official/README.md) — the shipped occupant of the same sidebar seats under an official build profile.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load, register slots, and publish package assets.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single occupancy per seat** — an alternative avatar, mark, or name replaces this row; none of the three seats renders two occupants.
- **The identity is fixed at build time** — changing the artwork or the name means editing the package and rebuilding it, because no runtime identity setting exists.
- **The sidebar version line yields to the name** — the shell's local-build fallback also shows the build version and copies it on click; occupying the name seat replaces that display.
- **The gutter geometry is fixed** — the 28px column comes from the Chat shell and the 24px mark from this package's stylesheet, so neither follows a user preference.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
