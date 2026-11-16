/**
 * `desktop_invoke` — act on a control through UI Automation instead of
 * pretending to be a mouse.
 *
 * The difference from `desktop_click` is where the action comes from. A click
 * injects real input, which only the foreground window receives, so it moves
 * the pointer and takes the user's screen. Invoking a control calls its own
 * automation interface: the window does not need the foreground, the pointer
 * never moves, and a control that is scrolled out of view can still be
 * operated. The price is that the control must expose the pattern being used —
 * a classic Win32 edit control exposes none, while a modern framework's button
 * exposes `Invoke`.
 *
 * Locating and acting happen inside one process on purpose: the target is
 * matched and operated in the same walk, so nothing can move between the two.
 * @module @deepseek-ai/dsh-tool-desktop/src/invoke
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { runPowerShellJson } from './powershell.ts'

/** Actions the tool can perform, each backed by one UI Automation pattern. */
export const INVOKE_ACTIONS = [
  'invoke',
  'set_value',
  'get_value',
  'toggle',
  'select',
  'expand',
  'collapse',
  'scroll_into_view',
] as const

/** One action name. */
export type InvokeAction = typeof INVOKE_ACTIONS[number]

/** The control an action was applied to. */
export interface InvokedControl {
  /** UI Automation control type, such as `Button`. */
  readonly controlType: string
  /** Accessible name; empty for many classic Win32 controls. */
  readonly name: string
  /** Window class name. */
  readonly className: string
  /** Automation id; empty for many classic Win32 controls. */
  readonly automationId: string
  /** Bounding rectangle left edge in screen pixels. */
  readonly x: number
  /** Bounding rectangle top edge in screen pixels. */
  readonly y: number
  /** Bounding rectangle width in pixels. */
  readonly width: number
  /** Bounding rectangle height in pixels. */
  readonly height: number
  /** Whether the control accepted input at the time of the action. */
  readonly enabled: boolean
  /** Whether the control was scrolled out of view. */
  readonly offscreen: boolean
}

/** Payload written by the action script. */
interface InvokePayload {
  /** Handle of the window the control belonged to. */
  readonly windowHandle: string
  /** Title of that window. */
  readonly windowTitle: string
  /** Number of controls the walk matched before the action. */
  readonly matched: number
  /** Zero-based index of the control the action was applied to. */
  readonly index: number
  /** The control itself. */
  readonly control: InvokedControl
  /** The action that ran. */
  readonly action: string
  /** Value read or written for the value actions; empty otherwise. */
  readonly value: string
}

/**
 * Run one UI Automation action against a control.
 * @param request - window address, locator filters, action, and optional value.
 * @param signal - caller cancellation forwarded to the child process.
 * @returns the matched control and the action outcome.
 */
export async function invokeControl(
  request: {
    readonly window: string
    readonly action: InvokeAction
    readonly name?: string | undefined
    readonly className?: string | undefined
    readonly controlType?: string | undefined
    readonly automationId?: string | undefined
    readonly value?: string | undefined
    readonly index: number
  },
  signal: AbortSignal | undefined,
): Promise<InvokePayload> {
  const script = INVOKE_SCRIPT
    .replace('__WINDOW__', quote(request.window))
    .replace('__NAME__', quote((request.name ?? '').toLowerCase()))
    .replace('__CLASS__', quote((request.className ?? '').toLowerCase()))
    .replace('__TYPE__', quote((request.controlType ?? '').toLowerCase()))
    .replace('__AUTOID__', quote((request.automationId ?? '').toLowerCase()))
    .replace('__ACTION__', quote(request.action))
    .replace('__VALUE__', quote(request.value ?? ''))
    .replace('__INDEX__', String(Math.max(0, Math.trunc(request.index))))
  return await runPowerShellJson<InvokePayload>(script, { signal, timeoutMs: 60_000 })
}

/** The model-facing `desktop_invoke` tool. */
export const desktopInvokeTool: ToolDefinition = defineTool({
  name: 'desktop_invoke',
  description: 'Act on one control through UI Automation: invoke a button or menu item, set or read an input '
    + 'field, toggle a checkbox, select a list item, expand or collapse a tree node, or scroll an item into '
    + 'view. It needs no coordinates and reaches controls that are scrolled out of view, the pointer never '
    + 'moves, and the target window does not have to be in the foreground for the action to succeed. Activating '
    + 'a control can nevertheless bring its window to the foreground (measured both ways: invoke on a UWP '
    + 'app, set_value on a classic Win32 edit control), so '
    + 'this is not a silent background action. Use desktop_find first to see which patterns a control supports '
    + 'and fall back to desktop_click with the reported rectangle when it supports none. `invoke` can trigger an '
    + 'irreversible action (submit, send, delete, close): confirm the control from desktop_find and ask the user '
    + 'before invoking such a control. Never act on company or work content.',
  parameters: {
    window: {
      type: 'string',
      required: true,
      description: 'Window handle (0x…) or a title substring holding the control.',
    },
    action: {
      type: 'string',
      required: true,
      enum: [...INVOKE_ACTIONS],
      description: 'The UI Automation action to perform.',
    },
    name: {
      type: 'string',
      description: 'Case-insensitive substring of the control\'s accessible name.',
    },
    class_name: {
      type: 'string',
      description: 'Case-insensitive substring of the window class name.',
    },
    control_type: {
      type: 'string',
      description: 'Exact UI Automation control type, such as Button, Edit, CheckBox, ListItem, or TreeItem.',
    },
    automation_id: {
      type: 'string',
      description: 'Case-insensitive substring of the automation id; the steadiest locator when present.',
    },
    value: {
      type: 'string',
      description: 'Value to write, required by set_value and ignored by the other actions.',
    },
    index: {
      type: 'integer',
      description: 'Which match to act on when several match; defaults to 0, the first.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        windowHandle: { type: 'string', required: true },
        windowTitle: { type: 'string', required: true },
        matched: { type: 'integer', required: true },
        index: { type: 'integer', required: true },
        control: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            controlType: { type: 'string', required: true },
            name: { type: 'string', required: true },
            className: { type: 'string', required: true },
            automationId: { type: 'string', required: true },
            x: { type: 'integer', required: true },
            y: { type: 'integer', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            enabled: { type: 'boolean', required: true },
            offscreen: { type: 'boolean', required: true },
          },
        },
        action: { type: 'string', required: true },
        value: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `${value.action} on ${value.control.controlType} name="${value.control.name}" `
        + `id="${value.control.automationId}" in window ${value.windowHandle} `
        + `(match ${String(value.index + 1)} of ${String(value.matched)}).`
        + (value.value === '' ? '' : `\nValue: ${value.value}`),
    }],
  },
  async execute(args, exec) {
    return await invokeControl({
      window: args.window,
      action: args.action,
      name: args.name,
      className: args.class_name,
      controlType: args.control_type,
      automationId: args.automation_id,
      value: args.value,
      index: args.index ?? 0,
    }, exec.signal)
  },
  presentCall: args => ({
    card: 'generic',
    title: `${args.action} ${args.name ?? args.automation_id ?? 'control'}`,
    kind: 'other',
  }),
})

/** Render one PowerShell single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Locate-then-act script. The walk stops as soon as it has collected the
 * requested match, so a large tree costs only what it must; the action then
 * runs against that same element, which is what keeps a target from moving
 * between locating and acting.
 */
const INVOKE_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DshInvokeWindow {
  private delegate bool EnumProc(IntPtr handle, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);

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
      if (text.ToString().ToLowerInvariant().Contains(wanted)) {
        found = handle;
        return false;
      }
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
}
'@

$target = __WINDOW__
$nameNeedle = __NAME__
$classNeedle = __CLASS__
$typeNeedle = __TYPE__
$autoNeedle = __AUTOID__
$action = __ACTION__
$actionValue = __VALUE__
$wantedIndex = [int]__INDEX__
$scanBound = 1500

$handle = [IntPtr]::Zero
if ($target -match '^0x[0-9A-Fa-f]+$') {
  $handle = [IntPtr][Convert]::ToInt64($target.Substring(2), 16)
} else {
  $handle = [DshInvokeWindow]::FindByTitle($target)
  if ($handle -eq [IntPtr]::Zero) { throw "no visible window title contains '$target'" }
}
if ($handle -eq [IntPtr]::Zero) { throw "window handle '$target' is not usable" }

$window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($window -eq $null) { throw "UI Automation cannot read window $target (its provider may be unavailable)" }

$all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$scanned = [Math]::Min($all.Count, $scanBound)
$matchedCount = 0
$subject = $null
for ($i = 0; $i -lt $scanned; $i++) {
  $candidate = $all[$i]
  try { $current = $candidate.Current } catch { continue }
  $name = [string]$current.Name
  $className = [string]$current.ClassName
  $controlType = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
  $automationId = [string]$current.AutomationId
  if ($nameNeedle -ne '' -and -not $name.ToLowerInvariant().Contains($nameNeedle)) { continue }
  if ($classNeedle -ne '' -and -not $className.ToLowerInvariant().Contains($classNeedle)) { continue }
  if ($typeNeedle -ne '' -and $controlType.ToLowerInvariant() -ne $typeNeedle) { continue }
  if ($autoNeedle -ne '' -and -not $automationId.ToLowerInvariant().Contains($autoNeedle)) { continue }
  $matchedCount++
  if ($matchedCount -eq ($wantedIndex + 1)) { $subject = $candidate; break }
}

if ($subject -eq $null) {
  throw "no control matched (matched $matchedCount before the walk stopped; requested index $wantedIndex)"
}

$subjectCurrent = $subject.Current
$rect = $subjectCurrent.BoundingRectangle
$patternObject = $null
$resultText = ''

switch ($action) {
  'invoke' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support Invoke"
    }
    $patternObject.Invoke()
    $resultText = 'invoked'
  }
  'set_value' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support Value (cannot set a value)"
    }
    $patternObject.SetValue($actionValue)
    $resultText = [string]$patternObject.Current.Value
  }
  'get_value' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support Value (cannot read a value)"
    }
    $resultText = [string]$patternObject.Current.Value
  }
  'toggle' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support Toggle"
    }
    $patternObject.Toggle()
    $resultText = [string]$patternObject.Current.ToggleState
  }
  'select' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support SelectionItem"
    }
    $patternObject.Select()
    $resultText = 'selected'
  }
  'expand' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support ExpandCollapse"
    }
    $patternObject.Expand()
    $resultText = [string]$patternObject.Current.ExpandCollapseState
  }
  'collapse' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support ExpandCollapse"
    }
    $patternObject.Collapse()
    $resultText = [string]$patternObject.Current.ExpandCollapseState
  }
  'scroll_into_view' {
    if (-not $subject.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$patternObject)) {
      throw "the control does not support ScrollItem"
    }
    $patternObject.ScrollIntoView()
    $resultText = 'scrolled'
  }
  default { throw "unsupported action '$action'" }
}

$control = [pscustomobject]@{
  controlType = $subjectCurrent.ControlType.ProgrammaticName.Replace('ControlType.', '')
  name = [string]$subjectCurrent.Name
  className = [string]$subjectCurrent.ClassName
  automationId = [string]$subjectCurrent.AutomationId
  x = [int]$rect.X
  y = [int]$rect.Y
  width = [int]$rect.Width
  height = [int]$rect.Height
  enabled = [bool]$subjectCurrent.IsEnabled
  offscreen = [bool]$subjectCurrent.IsOffscreen
}
$payload = [pscustomobject]@{
  windowHandle = ('0x{0:X}' -f $handle.ToInt64())
  windowTitle = [DshInvokeWindow]::Title($handle)
  matched = [int]$matchedCount
  index = [int]$wantedIndex
  control = $control
  action = $action
  value = $resultText
}
[System.IO.File]::WriteAllText($out, (ConvertTo-Json -InputObject $payload -Depth 6 -Compress), [System.Text.UTF8Encoding]::new($false))
`
