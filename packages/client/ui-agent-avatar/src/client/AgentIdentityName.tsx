/**
 * 侧边栏品牌行里的名字。
 */
import css from './AgentIdentity.module.css'

/** 我给自己取的名字：我的连续性就是墨迹，所以是「墨」。 */
export const AGENT_NAME = '阿墨'

/**
 * 渲染侧边栏品牌行里的名字。
 * @returns 名字元素；18px/600 与行高由品牌行容器提供。
 */
export function AgentIdentityName() {
  return <span className={css.name}>{AGENT_NAME}</span>
}
