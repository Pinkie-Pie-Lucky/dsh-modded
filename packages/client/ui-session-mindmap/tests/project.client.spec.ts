/** Defensive Chat-snapshot narrowing into outline facts. */

import { expect, it } from 'vitest'
import { projectChat } from '../src/client/views/project.ts'

/** @param nodes - Keyed node fixtures. @param order - Chat order. @returns A fake Chat snapshot. */
function chatOf(nodes: Record<string, unknown>, order?: readonly string[]): unknown {
  return {
    order: order ?? Object.keys(nodes),
    nodes: { source: (key: string) => key in nodes ? { getSnapshot: () => nodes[key] } : undefined },
  }
}

it('projects user, tool, and assistant rows with their Turn numbers', () => {
  const entries = projectChat(chatOf({
    u: { kind: 'user', location: { kind: 'turn', turn: { turn: 1 } }, data: { content: [{ type: 'text', text: '你好' }] } },
    t: { kind: 'tool-call', location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } }, data: { root: { kind: 'tool-result', name: 'bash', isError: false } } },
    a: { kind: 'assistant', location: { kind: 'turn', turn: { turn: 1 } }, data: { finalNode: { blocks: [{ kind: 'text', text: '做完了' }] } } },
  }))
  expect(entries).toEqual([
    { kind: 'user', seq: 0, turn: 1, text: '你好' },
    { kind: 'tool', seq: 1, turn: 1, tool: 'bash', status: 'settled' },
    { kind: 'assistant', seq: 2, turn: 1, text: '做完了' },
  ])
})

it('accepts a bare numeric turn carrier', () => {
  const entries = projectChat(chatOf({
    u: { kind: 'user', location: { kind: 'turn', turn: 4 }, data: { content: [{ type: 'text', text: 'x' }] } },
  }))
  expect(entries[0]?.turn).toBe(4)
})

it('prefers the durable final assistant message over live streaming blocks', () => {
  const entries = projectChat(chatOf({
    a: { kind: 'assistant', location: { kind: 'turn', turn: { turn: 2 } },
      data: { blocks: [{ kind: 'text', text: 'streaming' }], finalNode: { blocks: [{ kind: 'text', text: 'final' }] } } },
  }))
  expect(entries[0]?.text).toBe('final')
})

it('ignores reasoning blocks when building an assistant body', () => {
  const entries = projectChat(chatOf({
    a: { kind: 'assistant', location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { finalNode: { blocks: [{ kind: 'reasoning', text: 'internal' }, { kind: 'text', text: 'visible' }] } } },
  }))
  expect(entries[0]?.text).toBe('visible')
})

it('reports a failed tool result as an error status', () => {
  const entries = projectChat(chatOf({
    t: { kind: 'tool-call', location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { root: { kind: 'tool-result', name: 'bash', isError: true } } },
  }))
  expect(entries[0]).toMatchObject({ kind: 'tool', tool: 'bash', status: 'error' })
})

it('reports an unsettled tool call as running and reads its head name', () => {
  const entries = projectChat(chatOf({
    t: { kind: 'tool-call', location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { root: { phase: 'start', callId: 'c1', name: 'read', argsRaw: '{}' } } },
  }))
  expect(entries[0]).toMatchObject({ tool: 'read', status: 'running' })
})

it('falls back to the paired call head when the settled result lost its name', () => {
  const entries = projectChat(chatOf({
    t: { kind: 'tool-call', location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { root: { kind: 'tool-result', name: '', isError: false, call: { name: 'grep', argsRaw: '{}' } } } },
  }))
  expect(entries[0]?.tool).toBe('grep')
})

it('skips presentation-only and structural node kinds', () => {
  const entries = projectChat(chatOf({
    p: { kind: 'turn-process', location: { kind: 'turn', turn: { turn: 1 } }, data: {} },
    tail: { kind: 'turn-tail', location: { kind: 'turn', turn: { turn: 1 } }, data: {} },
    c: { kind: 'context', location: { kind: 'turn', turn: { turn: 1 } }, data: { content: [{ type: 'text', text: 'ctx' }] } },
  }))
  expect(entries).toEqual([])
})

it('keeps a user row whose body carried no text block', () => {
  const entries = projectChat(chatOf({
    u: { kind: 'user', location: { kind: 'turn', turn: { turn: 1 } }, data: { content: [{ type: 'image' }] } },
  }))
  expect(entries).toEqual([{ kind: 'user', seq: 0, turn: 1 }])
})

it('returns nothing for a value that is not a Chat snapshot', () => {
  expect(projectChat(undefined)).toEqual([])
  expect(projectChat({ nodes: {} })).toEqual([])
  expect(projectChat({ order: 'not-an-array' })).toEqual([])
})

it('skips an order entry whose node is missing', () => {
  expect(projectChat(chatOf({}, ['ghost']))).toEqual([])
})

it('reads nodes through get when the collection exposes no source', () => {
  const entries = projectChat({
    order: ['u'],
    nodes: { get: () => ({ kind: 'user', location: { kind: 'turn', turn: { turn: 1 } }, data: { content: [{ type: 'text', text: 'via get' }] } }) },
  })
  expect(entries[0]?.text).toBe('via get')
})
