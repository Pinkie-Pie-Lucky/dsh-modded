/**
 * Pure projection from ordered Chat facts to a Turn-rooted session outline.
 *
 * This module deliberately holds no presentation strings: labels, truncation
 * and localization belong to the view. Keeping it free of both React and the
 * client runtime is what makes the shape directly unit-testable.
 */

/** Fact kinds the outline understands. */
export type OutlineEntryKind = 'user' | 'steering' | 'assistant' | 'tool' | 'note'

/** Tool lifecycle as Chat reported it. */
export type OutlineStatus = 'running' | 'settled' | 'error'

/** One fact extracted from a Chat node, kept in Chat order. */
export interface OutlineEntry {
  readonly kind: OutlineEntryKind
  /** Turn the fact belongs to; absent for facts outside every Turn. */
  readonly turn?: number
  /** Monotonic Chat order key. */
  readonly seq: number
  /** Plain-text body for `user`, `steering`, `assistant`, and `note`. */
  readonly text?: string
  /** Wire tool name for `tool`. */
  readonly tool?: string
  readonly status?: OutlineStatus
}

/** One outline row; `children` is empty for leaves. */
export interface OutlineNode {
  /** Stable render key, unique across the whole outline. */
  readonly id: string
  readonly kind: 'turn' | OutlineEntryKind
  readonly turn?: number
  readonly text?: string
  readonly tool?: string
  readonly status?: OutlineStatus
  /** True for a Turn's last Assistant row: its conclusion. */
  readonly conclusion?: boolean
  readonly children: readonly OutlineNode[]
}

/** Counts of the leaf kinds under one Turn. */
export interface OutlineCounts {
  readonly user: number
  readonly tool: number
  readonly assistant: number
}

/**
 * Count the leaf kinds inside one Turn node.
 * @param node - Turn node produced by {@link buildOutline}.
 * @returns Per-kind leaf counts, ignoring `note` rows.
 */
export function countNode(node: OutlineNode): OutlineCounts {
  let user = 0
  let tool = 0
  let assistant = 0
  for (const child of node.children) {
    if (child.kind === 'user' || child.kind === 'steering') user += 1
    else if (child.kind === 'tool') tool += 1
    else if (child.kind === 'assistant') assistant += 1
  }
  return { user, tool, assistant }
}

/** @param entry - Fact to test. @returns whether it renders as a leaf row. */
function isLeaf(entry: OutlineEntry): boolean {
  return entry.kind !== 'tool' || entry.tool !== undefined
}

/**
 * Reduce ordered Chat facts into Turn buckets, flagging each Turn's conclusion.
 *
 * Buckets keep the order in which their first member appeared, so the result is
 * chronological without sorting a separate turn index. Facts outside every Turn
 * group under `turn === undefined` at their own chronological position.
 * @param entries - Facts extracted from one Session's Chat, any order.
 * @returns Turn nodes in chronological order.
 */
export function buildOutline(entries: readonly OutlineEntry[]): readonly OutlineNode[] {
  const ordered = [...entries].sort((left, right) => left.seq - right.seq)
  const buckets = new Map<number | undefined, OutlineEntry[]>()
  for (const entry of ordered) {
    if (!isLeaf(entry)) continue
    const bucket = buckets.get(entry.turn)
    if (bucket === undefined) buckets.set(entry.turn, [entry])
    else bucket.push(entry)
  }
  const turns: OutlineNode[] = []
  for (const [turn, members] of buckets) {
    const prefix = turn === undefined ? '~' : String(turn)
    const lastAssistant = members.reduce<number>(
      (found, entry, index) => entry.kind === 'assistant' ? index : found, -1)
    const children = members.map((entry, index): OutlineNode => ({
      id: `${prefix}:${index}:${entry.kind}`,
      kind: entry.kind,
      ...turn === undefined ? {} : { turn },
      ...entry.text === undefined ? {} : { text: entry.text },
      ...entry.tool === undefined ? {} : { tool: entry.tool },
      ...entry.status === undefined ? {} : { status: entry.status },
      ...index === lastAssistant ? { conclusion: true } : {},
      children: [],
    }))
    turns.push({
      id: `turn:${prefix}`,
      kind: 'turn',
      ...turn === undefined ? {} : { turn },
      children,
    })
  }
  return turns
}
