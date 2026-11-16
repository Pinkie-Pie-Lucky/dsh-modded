/** Sidebar panel rendering the Session outline as a markmap mind map. */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { Markmap } from '@markmap/view'
import { parse } from '@markmap/parse'
import { builtinThemes } from '@markmap/render'
import type { OutlineNode } from './outline.ts'
import { turnsToMarkdown } from './markdown.ts'
import css from './mindmap.module.css'

/** Resolve the built-in cards theme once; fail loudly if it ever disappears. */
function resolveCardsTheme() {
  const theme = builtinThemes.cards
  if (theme === undefined) throw new Error('markmap: cards theme is not built in')
  return theme
}
const cardsTheme = resolveCardsTheme()

/** Outline source handed to this tab by its registration. */
export interface SessionMindmapInjected {
  readonly outline: ObservableSnapshot<readonly OutlineNode[]>
}

/** Sidebar outline source and its localized labels. */
export type SessionMindmapProps = Pick<PropsRuntime<'sidebar.right.pane.tab'>, 'useSession'>
  & InjectFace<SessionMindmapInjected> & PropsLocale<'session-mindmap'>

/**
 * @param props - Session-bound outline source and labels.
 * @returns A markmap canvas whose tree follows the conversation live.
 */
export function SessionMindmapView(props: SessionMindmapProps) {
  const outline = props.outline
  const subscribe = useCallback((listener: () => void) => outline.subscribe(listener), [outline])
  const getSnapshot = useCallback(() => outline.getSnapshot(), [outline])
  const turns = useSyncExternalStore(subscribe, getSnapshot)
  const t = props.t
  const svgRef = useRef<SVGSVGElement>(null)
  const mmRef = useRef<Markmap | null>(null)

  const markdown = useMemo(() => turnsToMarkdown(turns, {
    root: t('outline.root'),
    turn: turn => t('outline.turn', { turn }),
  }), [turns, t])

  // Create the markmap once and hand it the tree on every change. markmap keeps
  // fold state for ids that still exist, which is exactly what live editing wants.
  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const mm = Markmap.create(svg, undefined, {
      theme: cardsTheme,
      colorScheme: 'auto',
      duration: 250,
      wrapWidth: 300,
    })
    mmRef.current = mm
    return () => { mm.destroy(); mmRef.current = null }
  }, [])

  useEffect(() => {
    const mm = mmRef.current
    if (mm === null) return
    const { root } = parse(markdown)
    mm.setTree(root)
  }, [markdown])

  return (
    <div className={css['canvas']}>
      <svg ref={svgRef} className={css['canvasSvg']} />
      <div className={css['controls']}>
        <button type="button" className={css['controlButton']} title={t('outline.zoomIn')}
          onClick={() => { mmRef.current?.zoomIn() }}>+</button>
        <button type="button" className={css['controlButton']} title={t('outline.zoomOut')}
          onClick={() => { mmRef.current?.zoomOut() }}>−</button>
        <button type="button" className={css['controlButton']} title={t('outline.fit')}
          onClick={() => { mmRef.current?.fit() }}>⤢</button>
      </div>
    </div>
  )
}
