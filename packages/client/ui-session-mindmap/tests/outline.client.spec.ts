/** Turn bucketing, conclusion flagging, and per-Turn leaf counts. */

import { expect, it } from 'vitest'
import { buildOutline, countNode, type OutlineEntry } from '../src/client/views/outline.ts'

/** @param entry - Partial fact. @returns A complete fact. */
function entry(partial: Partial<OutlineEntry> & Pick<OutlineEntry, 'kind' | 'seq'>): OutlineEntry {
  return partial
}

it('buckets facts by Turn and keeps chronological bucket order', () => {
  const outline = buildOutline([
    entry({ kind: 'assistant', seq: 3, turn: 2, text: 'second' }),
    entry({ kind: 'user', seq: 2, turn: 2, text: 'ask two' }),
    entry({ kind: 'user', seq: 1, turn: 1, text: 'ask one' }),
  ])
  expect(outline.map(node => node.turn)).toEqual([1, 2])
  expect(outline[1]?.children.map(child => child.text)).toEqual(['ask two', 'second'])
})

it('orders facts inside a Turn by sequence, not by input order', () => {
  const outline = buildOutline([
    entry({ kind: 'assistant', seq: 30, turn: 1, text: 'answer' }),
    entry({ kind: 'user', seq: 10, turn: 1, text: 'question' }),
  ])
  expect(outline[0]?.children.map(child => child.kind)).toEqual(['user', 'assistant'])
})

it("flags only the Turn's last Assistant row as its conclusion", () => {
  const outline = buildOutline([
    entry({ kind: 'assistant', seq: 1, turn: 1, text: 'narration' }),
    entry({ kind: 'tool', seq: 2, turn: 1, tool: 'bash', status: 'settled' }),
    entry({ kind: 'assistant', seq: 3, turn: 1, text: 'final' }),
  ])
  const flags = outline[0]?.children.map(child => child.conclusion === true)
  expect(flags).toEqual([false, false, true])
})

it('leaves the conclusion unflagged when a Turn has no Assistant row', () => {
  const outline = buildOutline([entry({ kind: 'user', seq: 1, turn: 1, text: 'only' })])
  expect(outline[0]?.children.every(child => child.conclusion === undefined)).toBe(true)
})

it('groups facts outside every Turn under an undefined Turn', () => {
  const outline = buildOutline([
    entry({ kind: 'user', seq: 5, text: 'session level' }),
    entry({ kind: 'user', seq: 6, turn: 1, text: 'in turn' }),
  ])
  expect(outline.map(node => node.turn)).toEqual([undefined, 1])
  expect(outline[0]?.id).toBe('turn:~')
  expect(outline[0]?.children[0]?.turn).toBeUndefined()
})

it('drops a tool row that never named its call', () => {
  const outline = buildOutline([
    entry({ kind: 'tool', seq: 1, turn: 1 }),
    entry({ kind: 'user', seq: 2, turn: 1, text: 'kept' }),
  ])
  expect(outline[0]?.children.map(child => child.kind)).toEqual(['user'])
})

it('gives every row a unique id', () => {
  const outline = buildOutline([
    entry({ kind: 'user', seq: 1, turn: 1, text: 'a' }),
    entry({ kind: 'tool', seq: 2, turn: 1, tool: 'bash' }),
    entry({ kind: 'user', seq: 3, turn: 2, text: 'b' }),
  ])
  const ids = [outline[0]?.id, ...outline[0]?.children.map(child => child.id) ?? [], ...outline[1]?.children.map(child => child.id) ?? []]
  expect(new Set(ids).size).toBe(ids.length)
})

it('counts user, steering, and tool leaves for the Turn summary', () => {
  const outline = buildOutline([
    entry({ kind: 'user', seq: 1, turn: 1, text: 'a' }),
    entry({ kind: 'steering', seq: 2, turn: 1, text: 'b' }),
    entry({ kind: 'tool', seq: 3, turn: 1, tool: 'bash' }),
    entry({ kind: 'assistant', seq: 4, turn: 1, text: 'c' }),
    entry({ kind: 'note', seq: 5, turn: 1, text: 'd' }),
  ])
  expect(countNode(outline[0]!)).toEqual({ user: 2, tool: 1, assistant: 1 })
})

it('returns no Turns for an empty fact list', () => {
  expect(buildOutline([])).toEqual([])
})
