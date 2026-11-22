import type { CardInstance } from '@/rules-core/types'

/** 大厅等待开始时的机器人默认名字。 */
export const DEFAULT_BOT_NAMES = ['村里的阿明', '村里的老周', '村里的细妹']

/**
 * 按本地保存的顺序展示某个座位的牌。
 * 顺序缺失时返回原始手牌；顺序里少了牌就追加，顺序里多了牌就过滤掉。
 *
 * @param savedOrder 本地保存的牌实例 ID 顺序。
 * @param hand 服务端手牌数组。
 * @returns 用于展示的牌数组。
 */
export function orderHandBySavedIds(
  savedOrder: string[] | undefined,
  hand: CardInstance[],
): CardInstance[] {
  if (!savedOrder) {
    return hand
  }

  const currentIds = new Set(hand.map((card) => card.id))
  const preserved = savedOrder.filter((cardId) => currentIds.has(cardId))
  const preservedSet = new Set(preserved)
  const appended = hand
    .map((card) => card.id)
    .filter((cardId) => !preservedSet.has(cardId))

  return [...preserved, ...appended]
    .map((cardId) => hand.find((card) => card.id === cardId))
    .filter((card): card is CardInstance => Boolean(card))
}

/** 联机界面所处阶段。 */
export type OnlineMode = 'offline' | 'browser' | 'lobby' | 'match'

/**
 * 根据当前页面地址推导 WebSocket 地址，支持 Vite 代理和同域名部署。
 *
 * @returns 例如 wss://game9.qdkl.cn/ws。
 */
export function createWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_ONLINE_WS_URL

  if (typeof configuredUrl === 'string' && configuredUrl.trim()) {
    return configuredUrl.trim()
  }

  if (location.protocol === 'capacitor:' || location.protocol === 'ionic:') {
    return 'wss://game9.qdkl.cn/ws'
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}
