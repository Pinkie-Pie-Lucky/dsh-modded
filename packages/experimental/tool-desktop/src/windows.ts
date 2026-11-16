/**
 * `desktop_windows` — list the visible top-level windows of this Windows
 * session, with the geometry and identity needed to target one of them from a
 * later call. Read-only: it never activates, moves, or modifies a window.
 *
 * The window walk runs entirely inside the compiled C# helper. A PowerShell
 * scriptblock converted to a delegate runs outside the caller's variables, so
 * collecting rows there silently yields an empty list; keeping the callback in
 * C# is what makes the enumeration reliable.
 * @module @deepseek-ai/dsh-tool-desktop/src/windows
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { runPowerShellJson } from './powershell.ts'

/** One visible top-level window as reported to the model. */
export interface DesktopWindow {
  /** Window handle as a hexadecimal string, the value later calls address. */
  readonly handle: string
  /** Window title; empty titles are never listed. */
  readonly title: string
  /** Executable name of the owning process, without extension. */
  readonly process: string
  /** Process id of the owning process. */
  readonly pid: number
  /** Left edge in virtual-screen pixels. */
  readonly x: number
  /** Top edge in virtual-screen pixels. */
  readonly y: number
  /** Width in pixels. */
  readonly width: number
  /** Height in pixels. */
  readonly height: number
  /** Whether this window currently holds the foreground. */
  readonly foreground: boolean
  /** Whether the window is minimized. */
  readonly minimized: boolean
}

/** Payload written by the enumeration script. */
export interface WindowsPayload {
  /** Virtual-screen origin in pixels; window rectangles are absolute. */
  readonly screenX: number
  /** Virtual-screen origin in pixels. */
  readonly screenY: number
  /** Virtual-screen size in pixels. */
  readonly screenWidth: number
  /** Virtual-screen size in pixels. */
  readonly screenHeight: number
  /** Visible, titled top-level windows. */
  readonly windows: DesktopWindow[]
}

/**
 * Enumerate visible top-level windows through a fresh PowerShell process.
 * @param signal - caller cancellation forwarded to the child process.
 * @param titleFilter - case-insensitive substring a title must contain.
 * @returns the virtual-screen geometry and the matching windows.
 */
export async function listDesktopWindows(
  signal: AbortSignal | undefined,
  titleFilter: string | undefined,
): Promise<WindowsPayload> {
  const payload = await runPowerShellJson<WindowsPayload>(ENUMERATE_SCRIPT, { signal, timeoutMs: 30_000 })
  if (titleFilter === undefined || titleFilter.trim() === '') return payload
  const needle = titleFilter.trim().toLowerCase()
  return {
    ...payload,
    windows: payload.windows.filter(window => window.title.toLowerCase().includes(needle)),
  }
}

/** Format one window row for the model-facing envelope. */
function describeWindow(window: DesktopWindow): string {
  const flags = [window.foreground ? 'foreground' : '', window.minimized ? 'minimized' : '']
    .filter(flag => flag !== '')
    .join(' ')
  return `${window.handle} ${window.process} "${window.title}" ${String(window.width)}x${String(window.height)}`
    + ` at ${String(window.x)},${String(window.y)}${flags === '' ? '' : ` [${flags}]`}`
}

/** The model-facing `desktop_windows` tool. */
export const desktopWindowsTool: ToolDefinition = defineTool({
  name: 'desktop_windows',
  description: 'List the visible top-level windows of this Windows session: handle, owning process, title, '
    + 'pixel geometry, and whether the window holds the foreground. Read-only. Call this before acting on a '
    + 'window, and address the window by the returned handle in later calls.',
  parameters: {
    title_contains: {
      type: 'string',
      description: 'Optional case-insensitive substring; only windows whose title contains it are listed.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        screenX: { type: 'integer', required: true },
        screenY: { type: 'integer', required: true },
        screenWidth: { type: 'integer', required: true },
        screenHeight: { type: 'integer', required: true },
        windows: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              handle: { type: 'string', required: true },
              title: { type: 'string', required: true },
              process: { type: 'string', required: true },
              pid: { type: 'integer', required: true },
              x: { type: 'integer', required: true },
              y: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              foreground: { type: 'boolean', required: true },
              minimized: { type: 'boolean', required: true },
            },
          },
        },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `Virtual screen: ${String(value.screenWidth)}x${String(value.screenHeight)} at `
        + `${String(value.screenX)},${String(value.screenY)} (absolute pixel coordinates).\n`
        + `Visible windows (${String(value.windows.length)}):\n`
        + value.windows.map(window => `  ${describeWindow(window)}`).join('\n'),
    }],
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    return await listDesktopWindows(exec.signal, args.title_contains)
  },
  presentCall: args => ({
    card: 'generic',
    title: args.title_contains === undefined ? 'List windows' : `List windows matching ${args.title_contains}`,
    kind: 'read',
  }),
})

/**
 * Enumerate visible, titled top-level windows and report the virtual-screen
 * bounds beside them. Window rectangles are already absolute virtual-screen
 * pixels, so a caller maps a window-local point to a screen point by adding the
 * window's own origin. The JSON payload is written as UTF-8 without a BOM and
 * read back as UTF-8, so non-ASCII titles survive intact.
 */
const ENUMERATE_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class DshDesktopWindows {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  private delegate bool EnumProc(IntPtr handle, IntPtr param);

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);

  public class WindowInfo {
    public string handle { get; set; }
    public string title { get; set; }
    public string process { get; set; }
    public int pid { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public bool foreground { get; set; }
    public bool minimized { get; set; }
  }

  public static List<WindowInfo> Enumerate() {
    IntPtr front = GetForegroundWindow();
    List<WindowInfo> windows = new List<WindowInfo>();
    EnumWindows((handle, param) => {
      if (!IsWindowVisible(handle)) return true;
      int length = GetWindowTextLength(handle);
      if (length <= 0) return true;
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(handle, text, text.Capacity);
      RECT rect;
      GetWindowRect(handle, out rect);
      uint owner;
      GetWindowThreadProcessId(handle, out owner);
      string name = "unknown";
      try { name = Process.GetProcessById((int)owner).ProcessName; } catch { }
      windows.Add(new WindowInfo {
        handle = "0x" + handle.ToInt64().ToString("X"),
        title = text.ToString(),
        process = name,
        pid = (int)owner,
        x = rect.Left,
        y = rect.Top,
        width = rect.Right - rect.Left,
        height = rect.Bottom - rect.Top,
        foreground = handle == front,
        minimized = IsIconic(handle)
      });
      return true;
    }, IntPtr.Zero);
    return windows;
  }

  public static int[] VirtualScreen() {
    return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
  }
}
'@

$rows = [DshDesktopWindows]::Enumerate()
$bounds = [DshDesktopWindows]::VirtualScreen()
$payload = [pscustomobject]@{
  screenX = $bounds[0]
  screenY = $bounds[1]
  screenWidth = $bounds[2]
  screenHeight = $bounds[3]
  windows = @($rows)
}
[System.IO.File]::WriteAllText($out, (ConvertTo-Json -InputObject $payload -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
`
