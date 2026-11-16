/**
 * Defensive adapter from an observed Chat view snapshot to {@link OutlineEntry}.
 *
 * The Chat projection is a deep, merge-extensible structure owned by other
 * packages. This module therefore narrows it at runtime instead of importing
 * its types: an unexpected node shape degrades to "skipped" rather than
 * throwing inside a sidebar render, and the whole adapter stays testable from
 * plain object fixtures.
 */

import type { OutlineEntry, OutlineEntryKind, OutlineStatus } from './outline.ts'

/** Blank a non-object value the way the projection occasionally reports it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** @param value - Candidate. @returns a non-empty string, or undefined. */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Read the Turn a node belongs to.
 *
 * The projection has reported `location.turn` both as a bare number and as a
 * turn reference carrying `turn`, so both shapes are accepted.
 * @param location - Observed `ConversationLocation`.
 * @returns The Turn number for `turn` and `step` locations, else undefined.
 */
function turnOf(location: unknown): number | undefined {
  const record = asRecord(location)
  if (record === undefined) return undefined
  const kind = record['kind']
  if (kind !== 'turn' && kind !== 'step') return undefined
  const carrier = record['turn']
  const value = typeof carrier === 'number' ? carrier : asRecord(carrier)?.['turn']
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Join the text-carrying blocks of one message body.
 * @param blocks - `ContentBlock[]` or `AssistantBlock[]`.
 * @param discriminator - Field naming the block kind in that union.
 * @returns Joined text, or undefined without a non-empty text block.
 */
function bodyText(blocks: unknown, discriminator: 'kind' | 'type'): string | undefined {
  if (!Array.isArray(blocks)) return undefined
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    if (record === undefined || record[discriminator] !== 'text') continue
    const text = asText(record['text'])
    if (text !== undefined) parts.push(text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Read a `user`/`steering` node body.
 * @param data - Observed node payload.
 * @returns Its text-block body.
 */
function userText(data: unknown): string | undefined {
  return bodyText(asRecord(data)?.['content'], 'type')
}

/**
 * Read an Assistant node body, preferring the durable final message.
 * @param data - Observed `AssistantChatData`.
 * @returns The final answer's text blocks, falling back to the live blocks.
 */
function assistantText(data: unknown): string | undefined {
  const record = asRecord(data)
  if (record === undefined) return undefined
  const final = asRecord(record['finalNode'])?.['blocks']
  return bodyText(final ?? record['blocks'], 'kind')
}

/**
 * Read a root Tool call's wire name and lifecycle.
 * @param data - Observed `ToolChatData`.
 * @returns The tool name when the call is named, plus its current status.
 */
function toolOf(data: unknown): { readonly tool?: string; readonly status: OutlineStatus } {
  const root = asRecord(asRecord(data)?.['root'])
  if (root === undefined) return { status: 'running' }
  const name = asText(root['name']) ?? asText(asRecord(root['call'])?.['name'])
  const settled = root['kind'] === 'tool-result'
  const status: OutlineStatus = !settled ? 'running' : root['isError'] === true ? 'error' : 'settled'
  return { ...name === undefined ? {} : { tool: name }, status }
}

/** Chat node kinds this first revision projects into the outline. */
const PROJECTED: Record<string, OutlineEntryKind> = {
  user: 'user',
  steering: 'steering',
  assistant: 'assistant',
}

/** Node collection surface read off the observed Chat snapshot. */
interface NodeCollection {
  readonly order?: readonly string[]
  readonly nodes?: {
    source?: (key: string) => { getSnapshot: () => unknown } | undefined
    get?: (key: string) => unknown
  }
}

/**
 * Project one observed Chat snapshot into ordered outline facts.
 *
 * Only Turn-scoped conversational rows are projected: user and steering
 * messages, Assistant answers, and root Tool calls. Presentation-only rows
 * (`turn-process`, `turn-tail`) and structural markers (`compaction`, `retry`,
 * `turn-error`) are intentionally out of scope for this revision.
 * @param chat - Observed `ChatSnapshot`, or anything else.
 * @returns Facts in Chat order; empty when the value is not a Chat snapshot.
 */
export function projectChat(chat: unknown): readonly OutlineEntry[] {
  const view = asRecord(chat) as NodeCollection | undefined
  if (view === undefined) return []
  const order = view.order
  if (!Array.isArray(order)) return []
  const entries: OutlineEntry[] = []
  order.forEach((key, index) => {
    if (typeof key !== 'string') return
    const node = asRecord(view.nodes?.source?.(key)?.getSnapshot() ?? view.nodes?.get?.(key))
    if (node === undefined) return
    const kind = asText(node['kind'])
    if (kind === undefined) return
    const turn = turnOf(node['location'])
    const base = { seq: index, ...turn === undefined ? {} : { turn } }
    if (kind === 'tool-call') {
      entries.push({ kind: 'tool', ...base, ...toolOf(node['data']) })
      return
    }
    const projected = PROJECTED[kind]
    if (projected === undefined) return
    const text = projected === 'assistant' ? assistantText(node['data']) : userText(node['data'])
    entries.push({ kind: projected, ...base, ...text === undefined ? {} : { text } })
  })
  return entries
}
