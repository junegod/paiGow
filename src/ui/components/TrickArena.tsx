import type {
  CardDefinition,
  CurrentTrickState,
  RoundState,
  SeatConfig,
  TrickRecord,
} from '@/rules-core/types'

import { CardStrip } from '@/ui/components/CardStrip'
import { DiceDisplay } from '@/ui/components/DiceDisplay'
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

type DisplayTrick = CurrentTrickState | TrickRecord

function getSeatConfig(seatConfigs: SeatConfig[], seat: number): SeatConfig {
  const seatConfig = seatConfigs.find((item) => item.seat === seat)

  if (!seatConfig) {
    throw new Error(`缺少座位 ${seat} 的配置。`)
  }

  return seatConfig
}

/**
 * 当前墩和刚结算完成的历史墩字段不同，这里统一读取本回合对应墩数。
 */
function getDisplayTrickCardCount(trick: DisplayTrick): number {
  return 'cardCount' in trick ? trick.cardCount : trick.expectedCardCount
}

/**
 * 判断当前展示的是已完成的墩。已完成墩用于 2 秒停留展示，
 * 不再显示“最大牌”，而是显示最终赢家。
 */
function isCompletedDisplayTrick(trick: DisplayTrick): trick is TrickRecord {
  return 'winner' in trick
}

/**
 * 当前出牌回合的舞台。这里的回合序号不等于墩数，墩数按本回合张数计算。
 */
export function TrickArena({
  round,
  reviewTrick,
  seatConfigs,
  cardDefinitions,
  onInspectTrick,
}: TrickArenaProps) {
  const trick = round.currentTrick ?? reviewTrick

  if (!trick) {
    return (
      <section className="trick-arena trick-arena--empty">
        <DiceDisplay roll={round.pendingDice?.roll ?? null} animate />
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
      <div className="trick-arena__header">
        <p>第 {trick.trickIndex} 回合｜{getDisplayTrickCardCount(trick)} 墩</p>
        <button type="button" onClick={() => onInspectTrick(trick.trickIndex)}>
          查看牌
        </button>
      </div>

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

      <div className="trick-arena__footer">
        {isCompletedDisplayTrick(trick) ? (
          <>
            <span>赢家：{getSeatConfig(seatConfigs, trick.winner).name}</span>
            <span>收墩中，稍等 2 秒</span>
          </>
        ) : (
          <>
            <span>领出：{getSeatConfig(seatConfigs, trick.leader).name}</span>
            <span>最大：{trick.currentTargetPattern?.label ?? '无'}</span>
          </>
        )}
      </div>
    </section>
  )
}
