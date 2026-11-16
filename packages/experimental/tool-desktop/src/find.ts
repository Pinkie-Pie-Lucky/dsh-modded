/**
 * `desktop_find` — locate controls inside one window through UI Automation and
 * report where they are, so a later click can aim at a control instead of at a
 * guessed pixel.
 *
 * The query runs in PowerShell rather than in the compiled C# helper on
 * purpose: UI Automation lives in `UIAutomationClient`/`UIAutomationTypes`,
 * which `Add-Type -TypeDefinition` would have to be handed as references, while
 * PowerShell can load both assemblies and use their types directly. C# is used
 * only for the window lookup that every tool in this package shares.
 *
 * Reading the tree is read-only: it does not activate, move, or modify the
 * window, so it is safe to run while the user is working elsewhere.
 * @module @deepseek-ai/dsh-tool-desktop/src/find
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { runPowerShellJson } from './powershell.ts'

/** One control as reported to the model. */
export interface FoundControl {
  /** UI Automation control type, such as `Button` or `Edit`. */
  readonly controlType: string
  /** Accessible name; empty for many classic Win32 controls. */
  readonly name: string
  /** Window class name, the only discriminator on classic Win32 controls. */
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
  /** Whether the control currently accepts input. */
  readonly enabled: boolean
  /** Whether the control is scrolled out of view. */
  readonly offscreen: boolean
  /** Patterns the control supports, such as `Invoke` or `Value`. */
  readonly patterns: string[]
}

/** Payload written by the query script. */
interface FindPayload {
  /** Handle of the queried window. */
  readonly windowHandle: string
  /** Title of the queried window. */
  readonly windowTitle: string
  /** Number of controls the walk visited. */
  readonly scanned: number
  /** Whether the walk stopped at the limit or the scan bound. */
  readonly truncated: boolean
  /** Matching controls. */
  readonly matches: FoundControl[]
}

/**
 * Query one window's control tree.
 * @param query - window address and the filters to apply.
 * @param signal - caller cancellation forwarded to the child process.
 * @returns the window identity plus every matching control.
 */
export async function findControls(
  query: {
    readonly window: string
    readonly name?: string | undefined
    readonly className?: string | undefined
    readonly controlType?: string | undefined
    readonly automationId?: string | undefined
    readonly limit: number
  },
  signal: AbortSignal | undefined,
): Promise<FindPayload> {
  const script = FIND_SCRIPT
    .replace('__WINDOW__', quote(query.window))
    .replace('__NAME__', quote((query.name ?? '').toLowerCase()))
    .replace('__CLASS__', quote((query.className ?? '').toLowerCase()))
    .replace('__TYPE__', quote((query.controlType ?? '').toLowerCase()))
    .replace('__AUTOID__', quote((query.automationId ?? '').toLowerCase()))
    .replace('__LIMIT__', String(Math.max(1, Math.min(100, Math.trunc(query.limit)))))
  // A deep tree with many properties read per node is slow; give it room.
  return await runPowerShellJson<FindPayload>(script, { signal, timeoutMs: 60_000 })
}

/** Format one match for the model-facing envelope. */
function describeControl(control: FoundControl, index: number): string {
  const flags = [control.enabled ? '' : 'disabled', control.offscreen ? 'offscreen' : '']
    .filter(flag => flag !== '')
    .join(' ')
  const patterns = control.patterns.length === 0 ? '' : ` patterns=${control.patterns.join(',')}`
  return `  [${String(index)}] ${control.controlType} name="${control.name}" class=${control.className}`
    + ` id="${control.automationId}" at ${String(control.x)},${String(control.y)}`
    + ` ${String(control.width)}x${String(control.height)}`
    + `${patterns}${flags === '' ? '' : ` [${flags}]`}`
}

/** The model-facing `desktop_find` tool. */
export const desktopFindTool: ToolDefinition = defineTool({
  name: 'desktop_find',
  description: 'Find controls inside one window through UI Automation and report each match\'s control type, '
    + 'name, class, automation id, screen rectangle, and the patterns it supports. Read-only: it never activates '
    + 'or modifies the window. Use it before clicking a button or filling a field — the returned rectangle can '
    + 'be aimed at with desktop_click, which is far steadier than guessing from a screenshot. Classic Win32 '
    + 'controls often report an empty name and an empty automation id (match them by class or control type '
    + 'instead), and complex interfaces expose large trees, so pass as many filters as you can and keep `limit` '
    + 'small.',
  parameters: {
    window: {
      type: 'string',
      required: true,
      description: 'Window handle (0x…) or a title substring to search inside.',
    },
    name: {
      type: 'string',
      description: 'Case-insensitive substring of the control\'s accessible name.',
    },
    class_name: {
      type: 'string',
      description: 'Case-insensitive substring of the window class name, such as "Edit" or "Button".',
    },
    control_type: {
      type: 'string',
      description: 'Exact UI Automation control type, such as Button, Edit, MenuItem, ListItem, or Text.',
    },
    automation_id: {
      type: 'string',
      description: 'Case-insensitive substring of the automation id.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum matches to return; defaults to 20, capped at 100.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        windowHandle: { type: 'string', required: true },
        windowTitle: { type: 'string', required: true },
        scanned: { type: 'integer', required: true },
        truncated: { type: 'boolean', required: true },
        matches: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
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
              patterns: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `Window ${value.windowHandle} "${value.windowTitle}": scanned ${String(value.scanned)} controls, `
        + `${String(value.matches.length)} match(es)${value.truncated ? ' (truncated)' : ''}.\n`
        + (value.matches.length === 0
          ? 'No control matched. Widen the filters, or fall back to a capture and pixel coordinates.'
          : value.matches.map((control, index) => describeControl(control, index)).join('\n')),
    }],
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    return await findControls({
      window: args.window,
      name: args.name,
      className: args.class_name,
      controlType: args.control_type,
      automationId: args.automation_id,
      limit: args.limit ?? 20,
    }, exec.signal)
  },
  presentCall: args => ({
    card: 'generic',
    title: args.name === undefined ? `Find controls in ${args.window}` : `Find "${args.name}"`,
    kind: 'read',
  }),
})

/** Render one PowerShell single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Query script. `__WINDOW__` is a quoted handle or title substring and the four
 * filter placeholders are quoted lowercase substrings (empty means "any").
 * Property reads are the expensive part of a UI Automation walk, so each node
 * reads only its identifying properties, and the rectangle and patterns are
 * read for matches alone.
 */
const FIND_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DshFindWindow {
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
$limit = [int]__LIMIT__
$scanBound = 1500

$handle = [IntPtr]::Zero
if ($target -match '^0x[0-9A-Fa-f]+$') {
  $handle = [IntPtr][Convert]::ToInt64($target.Substring(2), 16)
} else {
  $handle = [DshFindWindow]::FindByTitle($target)
  if ($handle -eq [IntPtr]::Zero) { throw "no visible window title contains '$target'" }
}
if ($handle -eq [IntPtr]::Zero) { throw "window handle '$target' is not usable" }

$window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($window -eq $null) { throw "UI Automation cannot read window $target (its provider may be unavailable)" }

$all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$scanned = [Math]::Min($all.Count, $scanBound)
$patternIds = @(
  [System.Windows.Automation.InvokePattern]::Pattern,
  [System.Windows.Automation.ValuePattern]::Pattern,
  [System.Windows.Automation.TogglePattern]::Pattern,
  [System.Windows.Automation.SelectionItemPattern]::Pattern,
  [System.Windows.Automation.ExpandCollapsePattern]::Pattern,
  [System.Windows.Automation.ScrollItemPattern]::Pattern,
  [System.Windows.Automation.TextPattern]::Pattern
)
$found = @()
for ($i = 0; $i -lt $scanned; $i++) {
  if ($found.Count -ge $limit) { break }
  $control = $all[$i]
  try { $current = $control.Current } catch { continue }
  $name = [string]$current.Name
  $className = [string]$current.ClassName
  $controlType = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
  $automationId = [string]$current.AutomationId
  if ($nameNeedle -ne '' -and -not $name.ToLowerInvariant().Contains($nameNeedle)) { continue }
  if ($classNeedle -ne '' -and -not $className.ToLowerInvariant().Contains($classNeedle)) { continue }
  if ($typeNeedle -ne '' -and $controlType.ToLowerInvariant() -ne $typeNeedle) { continue }
  if ($autoNeedle -ne '' -and -not $automationId.ToLowerInvariant().Contains($autoNeedle)) { continue }
  $rect = $current.BoundingRectangle
  $patterns = @()
  foreach ($patternId in $patternIds) {
    $patternObject = $null
    try {
      if ($control.TryGetCurrentPattern($patternId, [ref]$patternObject)) {
        $patterns += $patternId.ProgrammaticName.Replace('PatternIdentifiers.', '').Replace('Pattern', '')
      }
    } catch { }
  }
  $found += [pscustomobject]@{
    controlType = $controlType
    name = $name
    className = $className
    automationId = $automationId
    x = [int]$rect.X
    y = [int]$rect.Y
    width = [int]$rect.Width
    height = [int]$rect.Height
    enabled = [bool]$current.IsEnabled
    offscreen = [bool]$current.IsOffscreen
    patterns = @($patterns)
  }
}

$windowHandle = '0x{0:X}' -f $handle.ToInt64()
$windowTitle = [DshFindWindow]::Title($handle)
$scannedCount = [int]$scanned
$isTruncated = [bool]($scanned -lt $all.Count -or $found.Count -ge $limit)
$matchList = @($found)
$payload = [pscustomobject]@{
  windowHandle = $windowHandle
  windowTitle = $windowTitle
  scanned = $scannedCount
  truncated = $isTruncated
  matches = $matchList
}
[System.IO.File]::WriteAllText($out, (ConvertTo-Json -InputObject $payload -Depth 6 -Compress), [System.Text.UTF8Encoding]::new($false))
`
