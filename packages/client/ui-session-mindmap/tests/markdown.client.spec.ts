/** Outline → markmap Markdown serialization. */

import { expect, it } from 'vitest'
import { singleLine, turnsToMarkdown } from '../src/client/views/markdown.ts'
import type { OutlineNode } from '../src/client/views/outline.ts'

const LABELS = { root: '会话', turn: (n: number) => `第 ${n} 轮` }

/** @param overrides - Partial leaf. @returns A leaf fact node. */
function leaf(overrides: Partial<OutlineNode> & Pick<OutlineNode, 'kind' | 'id'>): OutlineNode {
  return { children: [], ...overrides }
}

it('flattens line breaks and blank runs to a single line', () => {
  expect(singleLine('a\n\n  b\tc')).toBe('a b c')
  expect(singleLine('  padded  ')).toBe('padded')
})

it('emits the root, one Turn heading, and one leaf heading per fact', () => {
  const turns: OutlineNode[] = [{
    id: 'turn:1', kind: 'turn', turn: 1,
    children: [
      leaf({ id: 'a', kind: 'user', turn: 1, text: '你好' }),
      leaf({ id: 'b', kind: 'tool', turn: 1, tool: 'read' }),
    ],
  }]
  const markdown = turnsToMarkdown(turns, LABELS)
  const lines = markdown.split('\n')
  expect(lines[0]).toBe('# 会话')
  expect(lines[1]).toBe('## 第 1 轮')
  expect(lines[2]).toBe('### 💬 你好')
  expect(lines[3]).toBe('### 🔧 read')
})

it('uses the tool name for tool leaves and falls back to an em dash', () => {
  const turns: OutlineNode[] = [{
    id: 'turn:1', kind: 'turn', turn: 1,
    children: [leaf({ id: 'a', kind: 'tool', turn: 1 })],
  }]
  expect(turnsToMarkdown(turns, LABELS).split('\n')[2]).toBe('### 🔧 —')
})

it('bolds the conclusion leaf', () => {
  const turns: OutlineNode[] = [{
    id: 'turn:1', kind: 'turn', turn: 1,
    children: [leaf({ id: 'a', kind: 'assistant', turn: 1, text: '做完了', conclusion: true })],
  }]
  expect(turnsToMarkdown(turns, LABELS).split('\n')[2]).toBe('### 📝 **做完了**')
})

it('keeps markdown formatting in a leaf body on one line', () => {
  const turns: OutlineNode[] = [{
    id: 'turn:1', kind: 'turn', turn: 1,
    children: [leaf({ id: 'a', kind: 'user', turn: 1, text: '看 **这段** 和 `code`' })],
  }]
  expect(turnsToMarkdown(turns, LABELS).split('\n')[2]).toBe('### 💬 看 **这段** 和 `code`')
})

it('serializes multiple turns in order', () => {
  const turns: OutlineNode[] = [
    { id: 'turn:1', kind: 'turn', turn: 1, children: [leaf({ id: 'a', kind: 'user', turn: 1, text: '一' })] },
    { id: 'turn:2', kind: 'turn', turn: 2, children: [leaf({ id: 'b', kind: 'user', turn: 2, text: '二' })] },
  ]
  const lines = turnsToMarkdown(turns, LABELS).split('\n')
  expect(lines).toEqual(['# 会话', '## 第 1 轮', '### 💬 一', '## 第 2 轮', '### 💬 二'])
})
