/**
 * 阿墨的界面身份：助手回复槽位里的头像，以及侧边栏品牌行里的印记与名字。
 * 两个品牌席位由 ui-sidebar 声明、回复席位由 ui-chat 声明，因此注册一律等
 * 声明就位后再登记，并在声明收回时一并撤回。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AgentAvatarMark } from './AgentAvatarMark.tsx'
import { AgentIdentityMark } from './AgentIdentityMark.tsx'
import { AgentIdentityName } from './AgentIdentityName.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * 占住阿墨的三个界面席位。
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.assistant.before', () => ctx.slots.register(
    { name: 'conversation.chat.assistant.before' }, AgentAvatarMark))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark' }, AgentIdentityMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name' }, AgentIdentityName))
}
