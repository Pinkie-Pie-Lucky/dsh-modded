/**
 * One long-lived PowerShell process shared by every tool in this package.
 *
 * Spawning PowerShell and compiling the C# helpers costs roughly a second per
 * call, which dominates every action. This module keeps a single process alive
 * that reads one script path per line from stdin, dot-sources it (so the script
 * still owns `$out`), and answers with one marker line. The helpers compile
 * once and stay loaded; each later command only runs its own statements.
 *
 * The session is an optimisation, never a requirement: `runPowerShellJson`
 * falls back to a one-shot process whenever the session is unavailable, so a
 * crash or a timeout degrades speed instead of breaking a tool.
 *
 * Commands run strictly one at a time — a single process has one interpreter —
 * and a command that times out takes the process down with it, after which the
 * next call starts a fresh session.
 * @module @deepseek-ai/dsh-tool-desktop/src/session
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'
import { powerShellExecutable, quote } from './powershell.ts'

/** Marker a finished command prints on stdout. */
const OK = '##dsh-ok'

/** Marker a failed command prints on stdout, followed by its message. */
const ERROR = '##dsh-err '

/** Marker that ends the read loop. */
const EXIT = '##dsh-exit'

/**
 * Read loop handed to PowerShell. It never prints anything the caller does not
 * recognise as a marker, so stray output from a script cannot be mistaken for a
 * result; failures are reported per command and leave the session alive.
 */
const BOOTSTRAP = String.raw`
$ErrorActionPreference = 'Continue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $commandFile = [Console]::In.ReadLine()
  if ($null -eq $commandFile) { break }
  if ($commandFile -eq '##dsh-exit') { break }
  try {
    . $commandFile
    [Console]::Out.WriteLine('##dsh-ok')
  } catch {
    [Console]::Out.WriteLine('##dsh-err ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
  }
}
`

/** One queued command waiting for its marker line. */
interface Pending {
  /** Resolve when the command's marker arrives. */
  readonly settle: (error: Error | undefined) => void
  /** Timer that fails the command and restarts the process. */
  readonly timer: NodeJS.Timeout
}

/** Serialise a script path for the read loop. */
class Session {
  private child: ChildProcess | undefined
  private reader: ReadlineInterface | undefined
  private pending: Pending | undefined
  private tail: Promise<void> = Promise.resolve()
  private workDirectory: string | undefined
  private counter = 0

  /**
   * Run one script in the shared process.
   * @param script - PowerShell statements; the caller's `$out` is already set.
   * @param outFile - path the script writes its JSON payload to.
   * @param options - timeout and cancellation.
   */
  async run(
    script: string,
    outFile: string,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined },
  ): Promise<void> {
    const previous = this.tail
    let release: () => void = () => undefined
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      await this.execute(script, outFile, options)
    } finally {
      release()
    }
  }

  /** Stop the process, if one is running. */
  async dispose(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.reader?.close()
    this.reader = undefined
    this.finish(new Error('the desktop shell session was disposed'))
    if (child?.stdin?.writable === true) child.stdin.write(`${EXIT}\n`)
    child?.kill()
    const directory = this.workDirectory
    this.workDirectory = undefined
    if (directory !== undefined) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  /** Run one command against a live session, spawning it when needed. */
  private async execute(
    script: string,
    outFile: string,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined },
  ): Promise<void> {
    const child = this.ensure()
    const directory = await this.ensureWorkDirectory()
    const commandFile = join(directory, `command-${String(this.counter++)}.ps1`)
    await writeFile(commandFile, `$out = ${quote(outFile)}\n${script}\n`, 'utf8')

    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A command that outlived its budget leaves the interpreter in an unknown
        // state, so the whole session goes and the next call starts a new one.
        this.finish(new Error(`the command did not finish within ${String(options.timeoutMs)}ms`))
        this.child?.kill()
        this.child = undefined
      }, options.timeoutMs)
      this.pending = {
        settle: (error) => {
          clearTimeout(timer)
          if (error === undefined) resolve()
          else reject(error)
        },
        timer,
      }
      options.signal?.addEventListener('abort', () => {
        this.finish(new Error('the command was aborted'))
      }, { once: true })
    })

    if (child.stdin?.writable !== true) {
      this.finish(undefined)
      throw new Error('the desktop shell session has no writable stdin')
    }
    child.stdin.write(`${commandFile}\n`)
    await done
  }

  /** Spawn the process once and keep it; re-spawn after a crash. */
  private ensure(): ChildProcess {
    if (this.child !== undefined && this.child.exitCode === null && !this.child.killed) return this.child
    const encoded = Buffer.from(BOOTSTRAP, 'utf16le').toString('base64')
    const child = spawn(powerShellExecutable(), [
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => { this.consume(line) })
    child.on('exit', () => {
      if (this.child === child) {
        this.child = undefined
        this.finish(new Error('the desktop shell session exited'))
      }
    })
    child.stderr.on('data', () => undefined)
    return child
  }

  /** Create the directory that holds command scripts for this session. */
  private async ensureWorkDirectory(): Promise<string> {
    this.workDirectory ??= await mkdtemp(join(tmpdir(), 'dsh-desktop-shell-'))
    return this.workDirectory
  }

  /** Turn one marker line into the ending of the waiting command. */
  private consume(line: string): void {
    if (line === OK) this.finish(undefined)
    else if (line.startsWith(ERROR)) this.finish(new Error(line.slice(ERROR.length).trim()))
  }

  /** End the command currently waiting, if any. */
  private finish(error: Error | undefined): void {
    const pending = this.pending
    this.pending = undefined
    pending?.settle(error)
  }
}

/** Marker the session prints on stdout. */
export const desktopShell = new Session()
