/**
 * 空白首页 hero 品牌位里的印记：与头像同一张图稿（宣纸底 + 墨色鲸），
 * 替换掉原版的动画鱼回退。
 */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import avatarUrl from './assets/avatar.svg'

/**
 * 在 hero 品牌位渲染阿墨的印记（墨色鲸）。
 * @param props - 宿主请求的边长与几何类名。
 * @returns 印记图片；对辅助技术隐藏。
 */
export function AgentHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <img
      className={className}
      src={avatarUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
