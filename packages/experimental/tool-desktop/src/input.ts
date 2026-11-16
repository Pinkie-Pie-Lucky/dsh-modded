/**
 * Pointer and keyboard tools: focus a window, move, click, type text, and send
 * key combinations.
 *
 * Typing goes through `SendInput` with `KEYEVENTF_UNICODE` rather than the
 * clipboard or `SendKeys`: the Unicode path carries any character (including
 * Chinese) without touching the user's clipboard, and it needs no
 * single-threaded-apartment host. Every call runs in a fresh PowerShell
 * process whose only job is to compile the helper and invoke one action.
 * @module @deepseek-ai/dsh-tool-desktop/src/input
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { runPowerShellJson } from './powershell.ts'

/** Outcome of one focus call. */
interface FocusResult {
  /** Handle of the window that took the foreground. */
  readonly handle: string
  /** Title of that window. */
  readonly title: string
}

/** Outcome of one pointer call. */
interface PointerResult {
  /** Screen x of the acted point. */
  readonly x: number
  /** Screen y of the acted point. */
  readonly y: number
}

/** Outcome of one keyboard call. */
interface KeyboardResult {
  /** Number of characters sent, for typing. */
  readonly characters: number
  /** The combination sent, for key presses. */
  readonly keys: string
}

/**
 * Run one action through the shared helper.
 * @param action - PowerShell statement calling `[DshDesktopInput]`.
 * @param signal - caller cancellation forwarded to the child process.
 * @returns the parsed action result.
 */
async function act<T>(action: string, signal: AbortSignal | undefined): Promise<T> {
  return await runPowerShellJson<T>(`${HELPER}\n${action}`, { signal, timeoutMs: 30_000 })
}

/** `desktop_focus` — bring a window to the foreground. */
export const desktopFocusTool: ToolDefinition = defineTool({
  name: 'desktop_focus',
  description: 'Bring one window of this Windows session to the foreground, restoring it first when minimized. '
    + 'Address the window by the handle reported by desktop_windows, or by a title substring. Use this before '
    + 'typing or capturing a window, so input reaches the intended target.',
  parameters: {
    window: {
      type: 'string',
      required: true,
      description: 'Window handle (0x…) or a title substring.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        handle: { type: 'string', required: true },
        title: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `Focused window ${value.handle} "${value.title}".`,
    }],
  },
  async execute(args, exec) {
    return await act<FocusResult>(
      `$result = [DshDesktopInput]::Focus(${quote(args.window)})\n${writeJson('$result')}`,
      exec.signal,
    )
  },
  presentCall: args => ({ card: 'generic', title: `Focus ${args.window}`, kind: 'other' }),
})

/** `desktop_move` — move the pointer without pressing. */
export const desktopMoveTool: ToolDefinition = defineTool({
  name: 'desktop_move',
  description: 'Move the mouse pointer to an absolute screen pixel. Harmless on its own: use it to park the '
    + 'pointer before a click, or to reveal a hover state while inspecting the screen.',
  parameters: {
    x: { type: 'integer', required: true, description: 'Absolute screen x in pixels.' },
    y: { type: 'integer', required: true, description: 'Absolute screen y in pixels.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `Pointer moved to ${String(value.x)},${String(value.y)}.` }],
  },
  async execute(args, exec) {
    const x = Math.trunc(args.x)
    const y = Math.trunc(args.y)
    return await act<PointerResult>(
      `[DshDesktopInput]::Move(${String(x)}, ${String(y)})\n`
      + writeJson(`[pscustomobject]@{ x = ${String(x)}; y = ${String(y)} }`),
      exec.signal,
    )
  },
})

/** `desktop_click` — press a mouse button at an absolute point. */
export const desktopClickTool: ToolDefinition = defineTool({
  name: 'desktop_click',
  description: 'Move the pointer to an absolute screen pixel and click there. This is an irreversible action '
    + 'in whatever application is under the pointer: confirm the target from a fresh capture first, and ask the '
    + 'user before a click that submits, sends, deletes, or otherwise leaves the window. Never use it on '
    + 'company or work content.',
  parameters: {
    window: {
      type: 'string',
      description: 'Optional window handle (0x…) or title substring. When given, the tool brings it to the '
        + 'foreground and verifies it first, so the click cannot land on another window covering that point.',
    },
    x: { type: 'integer', required: true, description: 'Absolute screen x in pixels.' },
    y: { type: 'integer', required: true, description: 'Absolute screen y in pixels.' },
    button: {
      type: 'string',
      enum: ['left', 'right', 'middle'],
      description: 'Mouse button; defaults to left.',
    },
    count: {
      type: 'integer',
      description: 'Number of clicks: 1 (default) or 2 for a double click.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `Clicked at ${String(value.x)},${String(value.y)}.` }],
  },
  async execute(args, exec) {
    const x = Math.trunc(args.x)
    const y = Math.trunc(args.y)
    const button = args.button ?? 'left'
    const count = args.count === 2 ? 2 : 1
    const activate = args.window === undefined || args.window.trim() === ''
      ? ''
      : `[void][DshDesktopInput]::Focus(${quote(args.window)})\n`
    return await act<PointerResult>(
      activate
      + `[DshDesktopInput]::Click(${String(x)}, ${String(y)}, ${quote(button)}, ${String(count)})\n`
      + writeJson(`[pscustomobject]@{ x = ${String(x)}; y = ${String(y)} }`),
      exec.signal,
    )
  },
  presentCall: args => ({
    card: 'generic',
    title: `Click ${String(args.x)},${String(args.y)}`,
    kind: 'other',
  }),
})

/** `desktop_type` — type text into the focused window. */
export const desktopTypeTool: ToolDefinition = defineTool({
  name: 'desktop_type',
  description: 'Type text into one named window, one character at a time, without touching the clipboard. The '
    + 'window must be given: the tool brings it to the foreground, verifies it actually holds the foreground, and '
    + 'types only then. Never typing into "whatever has focus" is deliberate — between two tool calls the user can '
    + 'switch windows, and text that lands in their window cannot be taken back. Non-ASCII text (Chinese, emoji) '
    + 'goes through as Unicode. Never type into company or work content.',
  parameters: {
    window: {
      type: 'string',
      required: true,
      description: 'Window handle (0x…) or a title substring; the text is typed into this window.',
    },
    text: { type: 'string', required: true, description: 'Exact text to type.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        characters: { type: 'integer', required: true },
        keys: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `Typed ${String(value.characters)} characters.`,
    }],
  },
  async execute(args, exec) {
    return await act<KeyboardResult>(
      `[void][DshDesktopInput]::Focus(${quote(args.window)})\n`
      + `$count = [DshDesktopInput]::Type(${quote(args.text)})\n`
      + writeJson('[pscustomobject]@{ characters = $count; keys = [string]::Empty }'),
      exec.signal,
    )
  },
  presentCall: () => ({ card: 'generic', title: 'Type text', kind: 'other' }),
})

/** `desktop_keys` — send one key combination. */
export const desktopKeysTool: ToolDefinition = defineTool({
  name: 'desktop_keys',
  description: 'Send one key combination to one named window, written with "+" between a modifier and a key: '
    + '"ctrl+s", "alt+f4", "ctrl+shift+t", "enter", "esc", "f5". The window must be given: the tool brings it to '
    + 'the foreground, verifies it holds the foreground, and sends only then, so a combination never reaches '
    + 'whatever the user happens to be using. Supported modifiers are ctrl, alt, shift and win; supported keys are '
    + 'a-z, 0-9, F1-F24, and the named keys enter, tab, esc, space, backspace, delete, insert, home, end, pageup, '
    + 'pagedown, up, down, left, right. Ask the user before a combination that saves, submits, or closes anything '
    + 'in a window holding their own work.',
  parameters: {
    window: {
      type: 'string',
      required: true,
      description: 'Window handle (0x…) or a title substring; the combination goes to this window.',
    },
    keys: { type: 'string', required: true, description: 'One combination, such as "ctrl+s".' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        characters: { type: 'integer', required: true },
        keys: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `Sent ${value.keys}.` }],
  },
  async execute(args, exec) {
    return await act<KeyboardResult>(
      `[void][DshDesktopInput]::Focus(${quote(args.window)})\n`
      + `[DshDesktopInput]::Keys(${quote(args.keys)})\n`
      + writeJson(`[pscustomobject]@{ characters = 0; keys = ${quote(args.keys)} }`),
      exec.signal,
    )
  },
  presentCall: args => ({ card: 'generic', title: `Send ${args.keys}`, kind: 'other' }),
})

/** Render the PowerShell statement that writes one JSON expression to `$out`. */
function writeJson(expression: string): string {
  return `[System.IO.File]::WriteAllText($out, (ConvertTo-Json -InputObject (${expression}) -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))`
}

/** Render one PowerShell single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Shared helper. Every public method is a complete action; the caller appends
 * one statement that invokes it and writes the JSON result to `$out`.
 */
const HELPER = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DshDesktopInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }

  private delegate bool EnumProc(IntPtr handle, IntPtr param);

  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachIt);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr handle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  private static readonly IntPtr HWND_TOP = IntPtr.Zero;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_SHOWWINDOW = 0x0040;

  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;

  public static void Move(int x, int y) {
    if (!SetCursorPos(x, y)) throw new Exception("SetCursorPos failed for " + x + "," + y);
  }

  public static void Click(int x, int y, string button, int count) {
    Move(x, y);
    System.Threading.Thread.Sleep(60);
    uint down = MOUSEEVENTF_LEFTDOWN;
    uint up = MOUSEEVENTF_LEFTUP;
    if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
    else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
    for (int i = 0; i < count; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(70);
    }
  }

  public static int Type(string text) {
    if (text == null || text.Length == 0) return 0;
    INPUT[] inputs = new INPUT[text.Length * 2];
    for (int i = 0; i < text.Length; i++) {
      ushort scan = (ushort)text[i];
      inputs[i * 2].type = INPUT_KEYBOARD;
      inputs[i * 2].u.ki = new KEYBDINPUT { wVk = 0, wScan = scan, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero };
      inputs[i * 2 + 1].type = INPUT_KEYBOARD;
      inputs[i * 2 + 1].u.ki = new KEYBDINPUT { wVk = 0, wScan = scan, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
    }
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new Exception("SendInput accepted " + sent + " of " + inputs.Length + " keyboard events");
    return text.Length;
  }

  public static string Keys(string spec) {
    string[] parts = spec.Trim().ToLowerInvariant().Split('+');
    if (parts.Length == 0 || parts[parts.Length - 1].Length == 0) throw new Exception("key combination '" + spec + "' names no main key");
    byte[] modifiers = new byte[parts.Length - 1];
    for (int i = 0; i < parts.Length - 1; i++) modifiers[i] = Modifier(parts[i]);
    byte main = VirtualKey(parts[parts.Length - 1]);
    for (int i = 0; i < modifiers.Length; i++) keybd_event(modifiers[i], 0, 0, UIntPtr.Zero);
    keybd_event(main, 0, 0, UIntPtr.Zero);
    keybd_event(main, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    for (int i = modifiers.Length - 1; i >= 0; i--) keybd_event(modifiers[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    return spec;
  }

  private static byte Modifier(string name) {
    if (name == "ctrl" || name == "control") return 0x11;
    if (name == "alt") return 0x12;
    if (name == "shift") return 0x10;
    if (name == "win") return 0x5B;
    throw new Exception("unsupported modifier '" + name + "'");
  }

  private static byte VirtualKey(string name) {
    if (name.Length == 1) {
      char c = name[0];
      if (c >= 'a' && c <= 'z') return (byte)(c - 32);
      if (c >= '0' && c <= '9') return (byte)c;
    }
    if (name.Length >= 2 && name[0] == 'f') {
      int index;
      if (int.TryParse(name.Substring(1), out index) && index >= 1 && index <= 24) return (byte)(0x6F + index);
    }
    switch (name) {
      case "enter": return 0x0D;
      case "tab": return 0x09;
      case "esc": case "escape": return 0x1B;
      case "space": return 0x20;
      case "backspace": return 0x08;
      case "delete": case "del": return 0x2E;
      case "insert": return 0x2D;
      case "home": return 0x24;
      case "end": return 0x23;
      case "pageup": return 0x21;
      case "pagedown": return 0x22;
      case "up": return 0x26;
      case "down": return 0x28;
      case "left": return 0x25;
      case "right": return 0x27;
    }
    throw new Exception("unsupported key '" + name + "'");
  }

  public static IntPtr FindByTitle(string needle) {
    string wanted = needle.ToLowerInvariant();
    IntPtr found = IntPtr.Zero;
    EnumWindows((handle, param) => {
      if (found != IntPtr.Zero) return false;
      if (!IsWindowVisible(handle)) return true;
      int length = GetWindowTextLength(handle);
      if (length <= 0) return true;
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(handle, text, text.Capacity);
      if (text.ToString().ToLowerInvariant().Contains(wanted)) { found = handle; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Title(IntPtr handle) {
    int length = GetWindowTextLength(handle);
    if (length <= 0) return "";
    StringBuilder text = new StringBuilder(length + 1);
    GetWindowText(handle, text, text.Capacity);
    return text.ToString();
  }

  public static object Focus(string target) {
    IntPtr handle = IntPtr.Zero;
    if (target.StartsWith("0x") || target.StartsWith("0X")) {
      handle = new IntPtr(Convert.ToInt64(target.Substring(2), 16));
    } else {
      handle = FindByTitle(target);
      if (handle == IntPtr.Zero) throw new Exception("no visible window title contains '" + target + "'");
    }
    if (handle == IntPtr.Zero) throw new Exception("window handle '" + target + "' is not usable");
    if (IsIconic(handle)) ShowWindow(handle, 9);
    Activate(handle);
    System.Threading.Thread.Sleep(250);
    // Windows denies SetForegroundWindow to a background process under its
    // foreground lock, and it also returns false when the window already holds
    // the foreground. The foreground check is what makes "already there" a
    // success instead of a spurious failure.
    bool foreground = GetForegroundWindow() == handle;
    if (!foreground) throw new Exception("cannot bring window " + target + " to the foreground");
    return new { handle = "0x" + handle.ToInt64().ToString("X"), title = Title(handle) };
  }

  /** Bring one window forward, lifting the foreground lock when it applies. */
  private static bool Activate(IntPtr handle) {
    if (GetForegroundWindow() == handle) return true;
    if (SetForegroundWindow(handle)) return true;
    uint current = GetCurrentThreadId();
    uint owner;
    GetWindowThreadProcessId(handle, out owner);
    uint foregroundOwner;
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundOwner);
    bool attachedForeground = false;
    bool attachedOwner = false;
    try {
      if (foreground != current && foreground != 0) attachedForeground = AttachThreadInput(current, foreground, true);
      ShowWindow(handle, 5);
      SetWindowPos(handle, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
      if (SetForegroundWindow(handle)) return true;
      if (!attachedForeground && owner != current && owner != 0) {
        attachedOwner = AttachThreadInput(current, owner, true);
        if (SetForegroundWindow(handle)) return true;
      }
      return GetForegroundWindow() == handle;
    } finally {
      if (attachedOwner) AttachThreadInput(current, owner, false);
      if (attachedForeground) AttachThreadInput(current, foreground, false);
    }
  }
}
'@
`
