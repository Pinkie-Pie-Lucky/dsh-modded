/** Session Mindmap sidebar tab labels owned by this plugin. */

/** Namespace owned by the Session Mindmap plugin. */
export const NS = 'session-mindmap'

/** Simplified Chinese labels and dictionary keys. */
export const zh = {
  'tab.title': '会话大纲',
  'tab.description': '在侧边栏按轮次查看当前会话的结构大纲',
  'outline.root': '会话',
  'outline.turn': '第 {turn} 轮',
  'outline.user': '提问',
  'outline.steering': '补充',
  'outline.assistant': '回复',
  'outline.conclusion': '结论',
  'outline.tool': '工具',
  'outline.status.running': '进行中',
  'outline.status.settled': '完成',
  'outline.status.error': '失败',
  'outline.empty': '当前会话还没有可展示的内容',
  'outline.zoomIn': '放大',
  'outline.zoomOut': '缩小',
  'outline.fit': '适应视图',
  'outline.folded': '已折叠 {count} 轮',
} as const

/** Dictionary keys accepted by this plugin's translator. */
export type SessionMindmapKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session Mindmap tab and outline row labels. */
    'session-mindmap': SessionMindmapKey
  }
}

/** English labels, checked against the Chinese key set. */
export const en: Record<SessionMindmapKey, string> = {
  'tab.title': 'Session outline',
  'tab.description': 'Follow this session as a Turn-by-Turn structural outline in the sidebar.',
  'outline.root': 'Session',
  'outline.turn': 'Turn {turn}',
  'outline.user': 'Prompt',
  'outline.steering': 'Follow-up',
  'outline.assistant': 'Reply',
  'outline.conclusion': 'Conclusion',
  'outline.tool': 'Tool',
  'outline.status.running': 'running',
  'outline.status.settled': 'done',
  'outline.status.error': 'failed',
  'outline.empty': 'This session has nothing to outline yet',
  'outline.zoomIn': 'Zoom in',
  'outline.zoomOut': 'Zoom out',
  'outline.fit': 'Fit to view',
  'outline.folded': '{count} turns folded',
}
