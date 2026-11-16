/** Session-scoped Sidebar tab over the live Chat projection. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { NS } from '../locales.ts'
import { buildOutline, type OutlineNode } from './outline.ts'
import { projectChat } from './project.ts'
import { SessionMindmapView, type SessionMindmapInjected } from './View.tsx'

/**
 * Register the outline Sidebar page and its Session-scoped sources.
 * @param ctx - Client plugin context owning the tab registration and model cache.
 */
export function registerMindmapTab(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  const id = '@deepseek-ai/dsh-client-ui-session-mindmap'
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind: 'session-mindmap', title: () => t('tab.title'),
    guide: [{ id: 'open', order: 70, title: () => t('tab.title'), description: () => t('tab.description') }],
  }), 'session-mindmap: sidebar tab')
  // Subscriptions outlive individual mounts, so they are released with the plugin.
  const releases = new Set<() => void>()
  ctx.effect(() => () => {
    for (const release of releases) release()
    releases.clear()
  }, 'session-mindmap: conversation subscriptions')
  const models = new WeakMap<SessionBinding, SessionMindmapInjected>()
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id, locale: NS,
    inject: (sessionId: SessionId): SessionMindmapInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`session-mindmap: unknown Session ${sessionId}`)
      const cached = models.get(binding)
      if (cached !== undefined) return cached
      const conversation = ctx.uiConversation.binding(binding)
      const store = createSnapshotStore<readonly OutlineNode[]>([])
      const sync = (): void => {
        store.set(buildOutline(projectChat(conversation.snapshot.getSnapshot().views.get('chat'))))
      }
      conversation.activate('chat')
      const stop = conversation.snapshot.subscribe(sync)
      releases.add(stop)
      sync()
      const face: SessionMindmapInjected = { outline: store }
      models.set(binding, face)
      return face
    },
  }, SessionMindmapView))
}
