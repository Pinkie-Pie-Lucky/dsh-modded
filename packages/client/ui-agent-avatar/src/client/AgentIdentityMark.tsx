/**
 * 侧边栏品牌行里的印记：与头像同一张图稿，尺寸由宿主给定。
 */
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import avatarUrl from './assets/avatar.svg'
import css from './AgentIdentity.module.css'

/**
 * 在侧边栏品牌位渲染阿墨的印记。
 * @param props - 宿主请求的边长。
 * @returns 印记图片；名字在旁边的品牌位里，故此处对辅助技术隐藏。
 */
export function AgentIdentityMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <img
      className={css.mark}
      src={avatarUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
