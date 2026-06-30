import type {
  CardDefinition,
  RoundState,
  SeatConfig,
  TrickRecord,
} from '@/rules-core/types'

import { CardStrip } from '@/ui/components/CardStrip'
import {
  getDeadRewardCoverLabel,
  shouldCoverCardForDeadReward,
} from '@/ui/cardPresentation'

interface TrickArenaProps {
  round: RoundState
  reviewTrick: TrickRecord | null
  seatConfigs: SeatConfig[]
  cardDefinitions: Record<string, CardDefinition>
  onInspectTrick: (trickIndex: number) => void
}

/**
 * 当前出牌回合的舞台。中间区域只保留四家已出的牌面，
 * 回合说明和查看按钮统一改为通过玩家墩数入口或牌面点击查看。
 */
export function TrickArena({
  round,
  reviewTrick,
  cardDefinitions,
  onInspectTrick,
}: TrickArenaProps) {
  const trick = round.currentTrick ?? reviewTrick

  if (!trick) {
    return (
      <section className="trick-arena trick-arena--empty">
        <div className="trick-arena__status">
          {round.pendingDice
            ? `定到${round.pendingDice.forcedDoor === 'long' ? '长门' : round.pendingDice.forcedDoor === 'yao' ? '幺门' : '点子门'}，请选择要出的牌。`
            : '等待领出'}
        </div>
      </section>
    )
  }

  return (
    <section className="trick-arena">
      <div className="trick-arena__grid">
        {trick.plays.map((play) => {
          const isPublic = play.pattern.isOpen || play.revealed || round.phase === 'settled'

          return (
            <button
              key={`${play.seat}-${play.pattern.id}`}
              type="button"
              className={`trick-play trick-play--seat-${play.seat}`}
              onClick={() => onInspectTrick(trick.trickIndex)}
            >
              <CardStrip
                cards={play.cards}
                arena
                spread
                hidden={!isPublic}
                getCardHidden={(card, cardIndex) =>
                  isPublic && shouldCoverCardForDeadReward(play, card, cardIndex)}
                getCardHiddenLabel={(card, cardIndex) =>
                  getDeadRewardCoverLabel(play, card, cardIndex)}
                cardDefinitions={cardDefinitions}
              />
            </button>
          )
        })}
      </div>
    </section>
  )
}
