import type { CSSProperties } from 'react'

import type { SeatState } from '@/rules-core/types'

interface SeatPanelProps {
  seatState: SeatState
  isCurrent: boolean
  isDealer: boolean
  score: number
  onInspectWonTricks: () => void
}

/**
 * 桌面四周的座位摘要，展示玩家名称、累计积分与赢墩入口。
 * 赢下的墩牌不直接铺在桌面外侧，避免和当前出牌区域混在一起；
 * 需要查看时统一点击黑色墩数牌进入详情弹窗。
 */
export function SeatPanel({
  seatState,
  isCurrent,
  isDealer,
  score,
  onInspectWonTricks,
}: SeatPanelProps) {
  const scoreText = score > 0 ? `积分 +${score}` : `积分 ${score}`

  return (
    <section
      className={[
        'seat-panel',
        `seat-panel--seat-${seatState.seat}`,
        isCurrent ? 'seat-panel--current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--seat-color': seatState.config.color } as CSSProperties}
    >
      {isDealer ? <span className="seat-panel__dealer">庄</span> : null}
      <button type="button" className="seat-panel__pier-count" onClick={onInspectWonTricks}>
        {seatState.wonPierCount}
      </button>

      <div className="seat-panel__profile">
        <span className="seat-panel__name">{seatState.config.name}</span>
        <div className="seat-panel__avatar" aria-hidden="true">
          <span className="seat-panel__avatar-body" />
          <span className="seat-panel__avatar-face" />
          <span className="seat-panel__avatar-hair" />
          <span className="seat-panel__avatar-detail" />
        </div>
        <span className="seat-panel__score">{scoreText}</span>
      </div>
    </section>
  )
}
