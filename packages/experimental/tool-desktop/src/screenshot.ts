/**
 * `desktop_screenshot` — capture the virtual screen, or one window after
 * bringing it to the foreground, and return the image itself to the model
 * beside the exact pixel mapping the caller needs to aim later input.
 *
 * The capture is 1:1 by default, so a point measured on the returned image is
 * the same point in screen pixels once the reported origin is added. An
 * optional `max_width` scales the image down; the reported `scale` then maps
 * image pixels back onto screen pixels.
 * @module @deepseek-ai/dsh-tool-desktop/src/screenshot
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { releasePowerShellFile, runPowerShellFile } from './powershell.ts'

/** Media type of every capture this tool produces. */
const PNG = 'image/png'

/** Capture geometry written beside the PNG by the capture script. */
interface CaptureMeta {
  /** Left edge of the captured rectangle in virtual-screen pixels. */
  readonly x: number
  /** Top edge of the captured rectangle in virtual-screen pixels. */
  readonly y: number
  /** Width of the captured rectangle in screen pixels. */
  readonly width: number
  /** Height of the captured rectangle in screen pixels. */
  readonly height: number
  /** Image width after any scaling. */
  readonly imageWidth: number
  /** Image height after any scaling. */
  readonly imageHeight: number
  /** Screen pixels per image pixel; 1 means the capture is unscaled. */
  readonly scale: number
  /** Handle of the captured window, when one was addressed. */
  readonly windowHandle?: string
  /** Title of the captured window, when one was addressed. */
  readonly windowTitle?: string
}

/**
 * Capture geometry exactly as the script writes it: a window that was not
 * addressed arrives as an explicit null rather than an absent field.
 */
interface RawCaptureMeta extends Omit<CaptureMeta, 'windowHandle' | 'windowTitle'> {
  readonly windowHandle?: string | null
  readonly windowTitle?: string | null
}

/** Structured outcome declared by the tool's output schema. */
interface ScreenshotValue {
  /** Canonical path of the image attachment's source capture. */
  readonly path: string
  /** Image metadata carried into the attachment reference. */
  readonly image: {
    readonly attachmentId: string
    readonly mediaType: 'image/png'
    readonly bytes: number
    readonly width: number
    readonly height: number
    readonly name?: string
  }
  /** Capture geometry and pixel mapping. */
  readonly capture: CaptureMeta
}

/**
 * Capture the screen or one window.
 * @param target - window handle, title substring, or undefined for the whole virtual screen.
 * @param maxWidth - optional scale-down bound in image pixels.
 * @param signal - caller cancellation forwarded to the capture process.
 * @returns the capture metadata plus the produced files.
 */
export async function captureDesktop(
  target: string | undefined,
  maxWidth: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ meta: CaptureMeta; file: string; bytes: Buffer }> {
  const windowArgument = target === undefined || target.trim() === '' ? '' : target.trim()
  const widthArgument = maxWidth === undefined ? 0 : Math.max(0, Math.trunc(maxWidth))
  const script = CAPTURE_SCRIPT
    .replace('__TARGET__', quote(windowArgument))
    .replace('__MAX_WIDTH__', String(widthArgument))
  const file = await runPowerShellFile(script, '.png', { signal, timeoutMs: 60_000 })
  const raw = JSON.parse(await readFile(metaPath(file), 'utf8')) as RawCaptureMeta
  // Fields are restated rather than spread: the raw shape carries explicit
  // nulls for an unaddressed window, and the normalized shape has no nulls.
  const meta: CaptureMeta = {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    imageWidth: raw.imageWidth,
    imageHeight: raw.imageHeight,
    scale: raw.scale,
    ...raw.windowHandle == null ? {} : { windowHandle: raw.windowHandle },
    ...raw.windowTitle == null ? {} : { windowTitle: raw.windowTitle },
  }
  return { meta, file, bytes: await readFile(file) }
}

/** The model-facing `desktop_screenshot` tool. */
export function createDesktopScreenshotTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'desktop_screenshot',
    description: 'Capture this Windows session and return the image. Omitting `window` captures the whole '
      + 'virtual screen; passing a window handle (from desktop_windows) or a title substring brings that '
      + 'window to the foreground and captures its rectangle. The capture is 1:1 unless `max_width` scales it; '
      + 'the result reports the origin, the size, and the scale, so a point measured on the image maps back to '
      + 'screen pixels. Requires an image-capable model, and it captures whatever is on screen: ask the user '
      + 'before capturing when the screen may hold content they did not offer.',
    parameters: {
      window: {
        type: 'string',
        description: 'Window handle (0x…) or a title substring. Omit to capture the whole virtual screen.',
      },
      max_width: {
        type: 'integer',
        description: 'Optional maximum image width in pixels; the capture is scaled down to fit. Omit for 1:1 pixels.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          capture: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              x: { type: 'integer', required: true },
              y: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              imageWidth: { type: 'integer', required: true },
              imageHeight: { type: 'integer', required: true },
              scale: { type: 'number', required: true },
              windowHandle: { type: 'string' },
              windowTitle: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => screenshotContent(value),
    },
    async execute(args, exec) {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('desktop_screenshot needs a mounted attachment service to store the capture')
      }
      const capture = await captureDesktop(args.window, args.max_width, exec.signal)
      try {
        let ref: ImageAttachmentRef
        try {
          ref = await attachments.saveImage({ data: capture.bytes, mediaType: PNG, name: 'desktop.png' })
        } catch (error: unknown) {
          throw new Error(
            `cannot store the screen capture: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          )
        }
        const value: ScreenshotValue = {
          path: capture.file,
          image: {
            attachmentId: ref.attachmentId,
            mediaType: PNG,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...ref.name === undefined ? {} : { name: ref.name },
          },
          capture: capture.meta,
        }
        return value
      } finally {
        // The attachment is durable once saved, so the capture file and its
        // temporary directory are released even when storage refused it.
        await releasePowerShellFile(capture.file)
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.window === undefined ? 'Capture the screen' : `Capture ${args.window}`,
      kind: 'read',
    }),
  })
}

/** Project one capture into its model-facing envelope and image block. */
function screenshotContent(value: ScreenshotValue): ContentBlock[] {
  const capture = value.capture
  const mapping = capture.scale === 1
    ? `Unscaled: a point (px,py) on the image is screen pixel (${String(capture.x)}+px, ${String(capture.y)}+py).`
    : `Scaled by ${capture.scale.toFixed(4)}: a point (px,py) on the image is screen pixel `
      + `(${String(capture.x)}+round(px/${capture.scale.toFixed(4)}), ${String(capture.y)}+round(py/${capture.scale.toFixed(4)})).`
  const source = capture.windowHandle === undefined
    ? 'Source: whole virtual screen.'
    : `Source: window ${capture.windowHandle} "${capture.windowTitle ?? ''}".`
  return [
    {
      type: 'text',
      text: `<capture>\n${source}\n`
        + `Screen rectangle: ${String(capture.width)}x${String(capture.height)} at ${String(capture.x)},${String(capture.y)}.\n`
        + `Image: ${String(capture.imageWidth)}x${String(capture.imageHeight)} px.\n${mapping}\n</capture>`,
    },
    {
      type: 'image',
      attachment: {
        attachmentId: AttachmentId(value.image.attachmentId),
        mediaType: value.image.mediaType,
        bytes: value.image.bytes,
        width: value.image.width,
        height: value.image.height,
        ...value.image.name === undefined ? {} : { name: value.image.name },
      },
    },
  ]
}

/**
 * Sidecar metadata path for one capture file. The capture script names it
 * through `[IO.Path]::ChangeExtension`, so the same extension swap here keeps
 * the two sides in step.
 * @param file - path returned by the capture helper.
 * @returns the metadata path the script wrote.
 */
function metaPath(file: string): string {
  return file.replace(/\.[^./\\]+$/u, '.json')
}

/** Render one PowerShell single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Capture script. `__TARGET__` is a quoted handle or title substring (empty for
 * the whole screen) and `__MAX_WIDTH__` is a non-negative integer bound. The
 * window walk and the title match both run in C#: a PowerShell scriptblock
 * converted to a delegate cannot see the caller's variables.
 */
const CAPTURE_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DshDesktopCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  private delegate bool EnumProc(IntPtr handle, IntPtr param);

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);

  public static IntPtr FindByTitle(string needle) {
    string wanted = needle.ToLowerInvariant();
    IntPtr found = IntPtr.Zero;
    EnumWindows((handle, param) => {
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

  public static int[] VirtualScreen() {
    return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
  }
}
'@

Add-Type -AssemblyName System.Drawing

$target = __TARGET__
$maxWidth = [int]__MAX_WIDTH__
$handle = [IntPtr]::Zero
$title = ''

if ($target -ne '') {
  if ($target -match '^0x[0-9A-Fa-f]+$') {
    $handle = [IntPtr]([Convert]::ToInt64($target.Substring(2), 16))
  } else {
    $handle = [DshDesktopCapture]::FindByTitle($target)
    if ($handle -eq [IntPtr]::Zero) { throw "no visible window title contains '$target'" }
  }
  if ([DshDesktopCapture]::IsIconic($handle)) { [void][DshDesktopCapture]::ShowWindow($handle, 9) }
  [void][DshDesktopCapture]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 300
  $rect = New-Object DshDesktopCapture+RECT
  if (-not [DshDesktopCapture]::GetWindowRect($handle, [ref]$rect)) { throw "cannot read the rectangle of window $target" }
  $left = $rect.Left
  $top = $rect.Top
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $title = [DshDesktopCapture]::Title($handle)
} else {
  $bounds = [DshDesktopCapture]::VirtualScreen()
  $left = $bounds[0]
  $top = $bounds[1]
  $width = $bounds[2]
  $height = $bounds[3]
}

if ($width -le 0 -or $height -le 0) { throw "capture rectangle is empty ($width x $height)" }

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
$graphics.Dispose()

$scale = 1.0
if ($maxWidth -gt 0 -and $width -gt $maxWidth) {
  $scale = $maxWidth / $width
  $scaledWidth = [int][Math]::Max(1, [Math]::Round($width * $scale))
  $scaledHeight = [int][Math]::Max(1, [Math]::Round($height * $scale))
  $scaled = New-Object System.Drawing.Bitmap($scaledWidth, $scaledHeight)
  $shrink = [System.Drawing.Graphics]::FromImage($scaled)
  $shrink.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $shrink.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
  $shrink.Dispose()
  $bitmap.Dispose()
  $bitmap = $scaled
}

$meta = [pscustomobject]@{
  x = [int]$left
  y = [int]$top
  width = [int]$width
  height = [int]$height
  imageWidth = [int]$bitmap.Width
  imageHeight = [int]$bitmap.Height
  scale = [double]$scale
  windowHandle = $(if ($handle -eq [IntPtr]::Zero) { $null } else { '0x{0:X}' -f $handle.ToInt64() })
  windowTitle = $(if ($title -eq '') { $null } else { $title })
}
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
[System.IO.File]::WriteAllText([System.IO.Path]::ChangeExtension($out, 'json'), (ConvertTo-Json -InputObject $meta -Depth 4 -Compress), [System.Text.UTF8Encoding]::new($false))
`
