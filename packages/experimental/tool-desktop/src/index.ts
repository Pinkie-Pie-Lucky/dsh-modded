/**
 * Windows desktop tools: list the session's visible windows, capture the
 * screen or a single window, and drive the pointer and keyboard. Every tool
 * drives the host's own desktop session through PowerShell, so this package is
 * meaningful only on Windows and registers nothing anywhere else.
 *
 * Scope discipline lives in the surrounding instructions, not in these tools:
 * they are the hands (look, focus, click, type), while the decision to act on a
 * window — and to avoid company or work content entirely — belongs to the agent
 * using them. Captures and clicks are visible to the user's own screen, so ask
 * before acting when the target may hold content they did not offer.
 * @module @deepseek-ai/dsh-tool-desktop
 */

import type { Context } from '@deepseek-ai/cordis'
import { desktopFindTool } from './find.ts'
import {
  desktopClickTool, desktopFocusTool, desktopKeysTool, desktopMoveTool, desktopTypeTool,
} from './input.ts'
import { desktopInvokeTool } from './invoke.ts'
import { useSharedSession } from './powershell.ts'
import { createDesktopScreenshotTool } from './screenshot.ts'
import { desktopShell } from './session.ts'
import { desktopWindowsTool } from './windows.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-desktop'

/** Services required to register tools; attachments stays optional and is read per call. */
export const inject = ['tools']

/**
 * Register the desktop tools for a Windows host.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  if (process.platform !== 'win32') return
  // One process per host keeps the C# helpers compiled between calls; the
  // launcher itself is a few hundred milliseconds, which dominates a call.
  useSharedSession(desktopShell)
  ctx.effect(() => () => desktopShell.dispose(), 'tool-desktop: shell session')
  ctx.tools.register(desktopWindowsTool)
  ctx.tools.register(createDesktopScreenshotTool(ctx))
  ctx.tools.register(desktopFocusTool)
  ctx.tools.register(desktopMoveTool)
  ctx.tools.register(desktopClickTool)
  ctx.tools.register(desktopTypeTool)
  ctx.tools.register(desktopKeysTool)
  ctx.tools.register(desktopFindTool)
  ctx.tools.register(desktopInvokeTool)
}
