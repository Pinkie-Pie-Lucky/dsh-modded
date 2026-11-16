/**
 * PowerShell bridge for the Windows desktop tools. Every script runs in a
 * fresh, non-interactive PowerShell process; results travel through a UTF-8
 * file rather than the console, so nothing depends on console code pages,
 * argument quoting, or output buffering. Scripts ride `-EncodedCommand`, which
 * takes base64 UTF-16LE text and therefore needs no shell escaping at all.
 * @module @deepseek-ai/dsh-tool-desktop/src/powershell
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/** Result of one PowerShell invocation. */
export interface PowerShellResult {
  /** Decoded standard output. */
  readonly stdout: string
  /** Decoded standard error. */
  readonly stderr: string
  /** Process exit code. */
  readonly code: number
}

/**
 * Prologue prepended to every script: fail loud, keep every channel UTF-8, and
 * make the process DPI-aware before any window call. Under display scaling
 * (125% is the common case) window rectangles, screen copies, and cursor
 * positions otherwise disagree, and a capture frames the wrong region.
 */
const PROLOGUE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  // A warm session already has this type; recompiling it per call is pure cost.
  'if (-not (\'DshDpiAware\' -as [type])) { Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class DshDpiAware{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}\' }',
  '[void][DshDpiAware]::SetProcessDPIAware()',
].join('; ')

/** Executables probed in order: PowerShell 7 first, then the OS-provided host. */
const CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const

let resolved: string | undefined

/**
 * Resolve the PowerShell executable once per process.
 * @returns the executable that accepted a trivial probe, or the first candidate
 *   when neither probe succeeds (the spawn error then names the real problem).
 */
export function powerShellExecutable(): string {
  if (resolved !== undefined) return resolved
  for (const candidate of CANDIDATES) {
    const probe = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: 'ignore',
      timeout: 20_000,
    })
    if (probe.status === 0) {
      resolved = candidate
      return candidate
    }
  }
  resolved = CANDIDATES[0]
  return resolved
}

/** Options shared by both invocation helpers. */
export interface PowerShellOptions {
  /** Abort the child process when the caller's work is cancelled. */
  readonly signal?: AbortSignal | undefined
  /** Hard deadline in milliseconds. @default 60000 */
  readonly timeoutMs?: number | undefined
}

/**
 * Run one PowerShell script and collect its console streams.
 * @param script - script body; the prologue is prepended automatically.
 * @param options - cancellation signal and deadline.
 * @returns the collected exit code and decoded streams.
 */
export async function runPowerShell(script: string, options: PowerShellOptions = {}): Promise<PowerShellResult> {
  return await run(`${PROLOGUE}; ${script}`, options)
}

/** A warm session that runs this package's scripts back to back, if one is attached. */
export interface SharedSession {
  /**
   * Run one script.
   * @param script - PowerShell statements; `$out` is bound to `outFile` already.
   * @param outFile - path the script writes its JSON payload to.
   * @param options - deadline and cancellation.
   */
  run(
    script: string,
    outFile: string,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined },
  ): Promise<void>
}

let sharedSession: SharedSession | undefined

/**
 * Attach a warm session. Injection rather than an import keeps this module out
 * of a cycle with the session, which itself needs the launcher below.
 * @param session - the session to use, or undefined for one-shot processes.
 */
export function useSharedSession(session: SharedSession | undefined): void {
  sharedSession = session
}

/**
 * Run one PowerShell script whose payload is a single JSON document written to
 * a temporary UTF-8 file, and parse that document. The script runs in the warm
 * session when one is attached, and in its own process otherwise; either way the
 * prologue runs first, so both paths start from the same state.
 * @param script - script body that writes JSON to `$out`.
 * @param options - cancellation signal and deadline.
 * @returns the parsed JSON payload.
 * @throws {Error} when the process fails or the payload is not valid JSON.
 */
export async function runPowerShellJson<T>(script: string, options: PowerShellOptions = {}): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  const outFile = join(directory, 'result.json')
  try {
    if (sharedSession === undefined) {
      const result = await run(writeTo(script, outFile), options)
      if (result.code !== 0) {
        throw new Error(`PowerShell exited with ${String(result.code)}: ${firstLine(result.stderr) || firstLine(result.stdout)}`)
      }
    } else {
      await sharedSession.run(`${PROLOGUE}; ${script}`, outFile, {
        timeoutMs: options.timeoutMs ?? 60_000,
        signal: options.signal,
      })
    }
    return JSON.parse(await readFile(outFile, 'utf8')) as T
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Run one PowerShell script that produces a binary file, and return its path.
 * The caller owns the file and the temporary directory that holds it.
 * @param script - script body that writes bytes to `$out`.
 * @param extension - extension of the produced file, dot included.
 * @param options - cancellation signal and deadline.
 * @returns the absolute path of the produced file.
 * @throws {Error} when the process fails.
 */
export async function runPowerShellFile(
  script: string,
  extension: string,
  options: PowerShellOptions = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  const outFile = join(directory, `capture${extension}`)
  const result = await run(writeTo(script, outFile), options)
  if (result.code !== 0) {
    await rm(directory, { recursive: true, force: true })
    throw new Error(`PowerShell exited with ${String(result.code)}: ${firstLine(result.stderr) || firstLine(result.stdout)}`)
  }
  return outFile
}

/**
 * Remove a temporary file and its directory, ignoring a directory that is
 * already gone.
 * @param file - path returned by {@link runPowerShellFile}.
 */
export async function releasePowerShellFile(file: string): Promise<void> {
  await rm(dirname(file), { recursive: true, force: true })
}

/** Bind `$out` to a literal path before the script body runs. */
function writeTo(script: string, outFile: string): string {
  return `$out = ${quote(outFile)}; ${PROLOGUE}; ${script}`
}

/** Render one PowerShell single-quoted literal. */
export function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/** Spawn one PowerShell process carrying a complete script. */
async function run(script: string, options: PowerShellOptions): Promise<PowerShellResult> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const argv = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded,
  ]
  const timeoutMs = options.timeoutMs ?? 60_000
  return await new Promise<PowerShellResult>((resolve, reject) => {
    const child = spawn(powerShellExecutable(), argv, { windowsHide: true, signal: options.signal })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`PowerShell timed out after ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? -1,
      })
    })
  })
}

/**
 * First non-empty line of a diagnostic stream. PowerShell serializes an error
 * object as CLIXML when its error stream is redirected, so the readable text
 * has to be unwrapped from `<S S="Error">` before it means anything.
 */
function firstLine(text: string): string {
  const serialized = /<S S="Error">([\s\S]*?)<\/S>/u.exec(text)
  const source = serialized?.[1] === undefined ? text : decodeClixml(serialized[1])
  return source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#< CLIXML')) ?? ''
}

/** Decode the text escapes PowerShell uses inside a serialized error record. */
function decodeClixml(text: string): string {
  return text
    .replace(/_x000D_/gu, '')
    .replace(/_x000A_/gu, '\n')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}
