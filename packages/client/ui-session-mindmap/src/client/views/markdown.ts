/**
 * Serialize the Session outline into the Markdown that markmap parses.
 *
 * markmap renders one node per Markdown heading, so the outline's three levels
 * map to heading depths: the synthetic root is `#`, each Turn is `##`, and each
 * leaf fact is `###`. Only line breaks threaten the structure (a stray line
 * starting with `#` would become a new level), so bodies are flattened to one
 * line; other Markdown is left intact so user formatting survives into the map.
 */

import type { OutlineNode } from './outline.ts'

/** Emoji glyph shown before each leaf kind; Turn headings carry none. */
const KIND_PREFIX: Record<OutlineNode['kind'], string> = {
  turn: '',
  user: '💬',
  steering: '✏️',
  assistant: '📝',
  tool: '🔧',
  note: '📌',
}

/** Labels for the synthetic root and each Turn, supplied by the caller. */
export interface MarkdownLabels {
  /** Label of the single root node wrapping every Turn. */
  readonly root: string
  /** Label of one Turn node. */
  readonly turn: (turn: number) => string
}

/** @param text - Raw body. @returns It flattened to a single line. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** @param node - Leaf fact. @returns Its heading line, conclusion bolded. */
function leafLine(node: OutlineNode): string {
  const body = node.kind === 'tool' ? (node.tool ?? '') : (node.text ?? '')
  const prefix = KIND_PREFIX[node.kind]
  const text = singleLine(body) || '—'
  const wrapped = node.conclusion === true ? `**${text}**` : text
  return `### ${prefix} ${wrapped}`
}

/**
 * @param turns - Turn nodes from {@link buildOutline}.
 * @param labels - Root and Turn labels.
 * @returns Markdown whose heading tree matches the outline.
 */
export function turnsToMarkdown(turns: readonly OutlineNode[], labels: MarkdownLabels): string {
  const lines: string[] = [`# ${labels.root}`]
  for (const turn of turns) {
    lines.push(`## ${labels.turn(turn.turn ?? 0)}`)
    for (const child of turn.children) lines.push(leafLine(child))
  }
  return lines.join('\n')
}
