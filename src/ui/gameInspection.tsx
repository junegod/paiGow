import type { ReactNode } from 'react'

import type {
  CardDefinition,
  CurrentTrickState,
  MatchState,
  PlayedAction,
  RoundState,
  SeatConfig,
  SeatId,
  TrickRecord,
} from '@/rules-core/types'
import { getDeadRewardCoverLabel, shouldCoverCardForDeadReward } from '@/ui/cardPresentation'
import { CardStrip } from '@/ui/components/CardStrip'

/** 当前打开的牌局检查抽屉。 */
export type DrawerState =
  | { type: 'trick'; trickIndex: number }
  | { type: 'seat'; seat: SeatId }
  | { type: 'history' }
  | null

/** 抽屉标题、说明和正文。 */
export interface GameDrawerMeta {
  title: string
  subtitle?: string
  content: ReactNode
}

/** 从座位配置中读取指定玩家。 */
function getSeatConfig(seatConfigs: SeatConfig[], seat: SeatId): SeatConfig {
  const seatConfig = seatConfigs.find((item) => item.seat === seat)
  if (!seatConfig) {
    throw new Error(`缺少座位 ${seat} 的配置。`)
  }
  return seatConfig
}

/** 背面弃牌只有在揭示或结算后才能展示正面。 */
function isPlayPublic(play: PlayedAction, round: RoundState): boolean {
  return play.pattern.isOpen || play.revealed || round.phase === 'settled'
}

/** 查找当前或历史回合。 */
function findTrick(round: RoundState, trickIndex: number): TrickRecord | CurrentTrickState | null {
  return round.currentTrick?.trickIndex === trickIndex
    ? round.currentTrick
    : round.publicTrickLog.find((trick) => trick.trickIndex === trickIndex) ?? null
}

/** 将出牌回合换算成实际墩数。 */
function getTrickPierCount(trick: TrickRecord | CurrentTrickState): number {
  return 'cardCount' in trick ? trick.cardCount : trick.expectedCardCount
}

/** 生成抽屉中的一条出牌摘要。 */
function formatTrickPlaySummary(
  trick: TrickRecord | CurrentTrickState,
  round: RoundState,
  seatConfigs: SeatConfig[],
): string {
  return trick.plays.map((play) => {
    const label = isPlayPublic(play, round) ? play.pattern.label : `弃牌${play.cards.length}张`
    return `${getSeatConfig(seatConfigs, play.seat).name}${label}`
  }).join(' / ')
}

/** 生成当前或已完成回合的赢家状态。 */
function formatTrickStatus(
  trick: TrickRecord | CurrentTrickState,
  seatConfigs: SeatConfig[],
): string {
  return 'winner' in trick
    ? `赢家 ${getSeatConfig(seatConfigs, trick.winner).name}`
    : `进行中，明面最大 ${getSeatConfig(seatConfigs, trick.currentWinningSeat).name}`
}

/** 渲染一组出牌记录，并持续保护尚未揭示的牌面。 */
function renderTrickPlayList({
  plays,
  round,
  cardDefinitions,
  seatConfigs,
}: {
  plays: PlayedAction[]
  round: RoundState
  cardDefinitions: Record<string, CardDefinition>
  seatConfigs: SeatConfig[]
}) {
  return (
    <div className="drawer-trick-list">
      {plays.map((play, index) => {
        const publicPlay = isPlayPublic(play, round)
        return (
          <article key={`${play.seat}-${index}`} className="drawer-trick">
            <div className="drawer-trick__head">
              <strong>{getSeatConfig(seatConfigs, play.seat).name}</strong>
              <span>{publicPlay ? play.pattern.label : `弃牌 ${play.cards.length} 张`}</span>
            </div>
            <CardStrip
              cards={play.cards}
              compact
              spread
              hidden={!publicPlay}
              getCardHidden={(card, cardIndex) =>
                publicPlay && shouldCoverCardForDeadReward(play, card, cardIndex)}
              getCardHiddenLabel={(card, cardIndex) =>
                getDeadRewardCoverLabel(play, card, cardIndex)}
              cardDefinitions={cardDefinitions}
            />
            <p className="drawer-trick__desc">{play.message}</p>
          </article>
        )
      })}
    </div>
  )
}

interface CreateGameDrawerMetaOptions {
  drawerState: DrawerState
  round: RoundState
  matchState: MatchState
  cardDefinitions: Record<string, CardDefinition>
  seatConfigs: SeatConfig[]
  onSelectTrick: (trickIndex: number) => void
}

/**
 * 集中创建回合、历史和赢墩抽屉，避免主 App 同时承担牌桌编排和复盘渲染。
 */
export function createGameDrawerMeta({
  drawerState,
  round,
  matchState,
  cardDefinitions,
  seatConfigs,
  onSelectTrick,
}: CreateGameDrawerMetaOptions): GameDrawerMeta | null {
  if (!drawerState) {
    return null
  }

  if (drawerState.type === 'trick') {
    const trick = findTrick(round, drawerState.trickIndex)
    if (!trick) {
      return null
    }
    return {
      title: `第 ${drawerState.trickIndex} 回合详情`,
      subtitle: 'winner' in trick
        ? `赢家：${getSeatConfig(matchState.seatConfigs, trick.winner).name}｜本回合 ${getTrickPierCount(trick)} 墩`
        : `仍在进行中，本回合 ${getTrickPierCount(trick)} 墩，当前明面最大为 ${trick.currentTargetPattern?.label ?? '无公开牌'}`,
      content: renderTrickPlayList({
        plays: trick.plays,
        round,
        cardDefinitions,
        seatConfigs,
      }),
    }
  }

  if (drawerState.type === 'history') {
    const current = round.currentTrick ? [{ trick: round.currentTrick, isCurrent: true }] : []
    const history = [...round.publicTrickLog].reverse().map((trick) => ({ trick, isCurrent: false }))
    const inspectableTricks = [...current, ...history]
    return {
      title: '回合记录',
      subtitle: `可查 ${inspectableTricks.length} 个回合；背面弃牌整局结束前只显示背面。`,
      content: (
        <div className="drawer-history-grid">
          {inspectableTricks.length > 0 ? inspectableTricks.map(({ trick, isCurrent }) => (
            <button
              key={`${isCurrent ? 'current' : 'history'}-${trick.trickIndex}`}
              type="button"
              className="drawer-history-tile"
              onClick={() => onSelectTrick(trick.trickIndex)}
            >
              <span className="drawer-history-tile__head">
                <strong>第 {trick.trickIndex} 回合</strong>
                <em>{isCurrent ? '当前' : `${getTrickPierCount(trick)} 墩`}</em>
              </span>
              <span className="drawer-history-tile__meta">
                领出 {getSeatConfig(matchState.seatConfigs, trick.leader).name}｜
                {formatTrickStatus(trick, matchState.seatConfigs)}
              </span>
              <span className="drawer-history-tile__summary">
                {formatTrickPlaySummary(trick, round, matchState.seatConfigs) || '还没有出牌记录'}
              </span>
              <span className="drawer-history-tile__cta">点开查看牌面</span>
            </button>
          )) : <p className="drawer-empty">当前还没有任何回合记录。</p>}
        </div>
      ),
    }
  }

  const seatState = round.seats.find((seat) => seat.seat === drawerState.seat)
  if (!seatState) {
    return null
  }
  return {
    title: `${seatState.config.name} 的赢墩堆`,
    subtitle: `共赢 ${seatState.wonPierCount} 墩`,
    content: (
      <div className="drawer-stack-grid">
        {seatState.wonTricks.length > 0 ? seatState.wonTricks.map((trick) => (
          <button
            key={trick.trickIndex}
            type="button"
            className="drawer-stack-tile"
            onClick={() => onSelectTrick(trick.trickIndex)}
          >
            <span className="drawer-stack-tile__head">
              <strong>第 {trick.trickIndex} 回合</strong>
              <em>赢 {trick.cardCount} 墩</em>
            </span>
            <div className="drawer-stack-tile__cards">
              {trick.plays.map((play, index) => (
                <CardStrip
                  key={`${trick.trickIndex}-${play.seat}-${index}`}
                  cards={play.cards}
                  cardDefinitions={cardDefinitions}
                  hidden={!isPlayPublic(play, round)}
                  getCardHidden={(card, cardIndex) =>
                    isPlayPublic(play, round) && shouldCoverCardForDeadReward(play, card, cardIndex)}
                  getCardHiddenLabel={(card, cardIndex) =>
                    getDeadRewardCoverLabel(play, card, cardIndex)}
                  mini
                  spread
                />
              ))}
            </div>
            <span className="drawer-stack-tile__cta">点击查看本回合</span>
          </button>
        )) : <p className="drawer-empty">当前还没有赢下任何墩。</p>}
      </div>
    ),
  }
}
