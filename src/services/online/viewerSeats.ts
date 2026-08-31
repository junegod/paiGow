import type { SeatId } from '@/rules-core/types'

/**
 * 把服务端座位转换成当前玩家看到的界面座位。
 * 联机客户端统一用“自己永远坐底部座位 0”的视角展示牌桌。
 *
 * @param seat 服务端逻辑座位。
 * @param viewerSeat 当前玩家服务端座位。
 * @returns 当前玩家视角下的界面座位。
 */
export function mapSeatForViewer(seat: SeatId, viewerSeat: SeatId): SeatId {
  return (((seat - viewerSeat + 4) % 4) as SeatId)
}
