/**
 * 回复槽位里的头像：阿墨的脸出现在每段助手回复的左侧。
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import avatarUrl from './assets/avatar.svg'
import css from './AgentIdentity.module.css'

/** 回复槽位的席位 props（含分组片段信息）。 */
type AgentAvatarMarkProps = PropsRuntime<'conversation.chat.assistant.before'>

/**
 * 在一条助手回复前渲染阿墨的头像。
 *
 * 印记属于它引出的那段回复，所以一轮里的过程片段（折叠后以 reasoning
 * 呈现的叙述行）不带头像，整段对话保持「一个回答一个头像」。
 * @param props - 槽位 props。
 * @returns 头像图片；过程片段返回空。
 */
export function AgentAvatarMark({ groupPart }: AgentAvatarMarkProps) {
  if (groupPart === 'reasoning') return null
  return <img className={css.avatar} src={avatarUrl} alt="" draggable={false} />
}
