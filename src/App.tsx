import { useEffect, useMemo, useRef, useState } from 'react'

import { useGameController } from '@/app/useGameController'
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
import {
  playGameSound,
  preloadGameAudio,
  unlockGameAudio,
  type GameSoundName,
} from '@/ui/audio/gameAudio'
import { ActionPanel } from '@/ui/components/ActionPanel'
import { CardStrip } from '@/ui/components/CardStrip'
import { DiceDisplay } from '@/ui/components/DiceDisplay'
import { InspectorDrawer } from '@/ui/components/InspectorDrawer'
import { LobbyPanel } from '@/ui/components/LobbyPanel'
import { SeatPanel } from '@/ui/components/SeatPanel'
import { SettlementPanel } from '@/ui/components/SettlementPanel'
import { TrickArena } from '@/ui/components/TrickArena'
import {
  getDeadRewardCoverLabel,
  shouldCoverCardForDeadReward,
} from '@/ui/cardPresentation'

type DrawerState =
  | { type: 'trick'; trickIndex: number }
  | { type: 'seat'; seat: SeatId }
  | { type: 'history' }
  | null

type InspectableTrick = {
  trick: TrickRecord | CurrentTrickState
  isCurrent: boolean
}

type RoundAudioSnapshot = {
  roundNumber: number | null
  phase: string
  pendingDiceKey: string | null
  totalPlayCount: number
  completedTrickCount: number
  settlementKey: string | null
}

function getSeatConfig(seatConfigs: SeatConfig[], seat: SeatId): SeatConfig {
  const seatConfig = seatConfigs.find((item) => item.seat === seat)

  if (!seatConfig) {
    throw new Error(`缺少座位 ${seat} 的配置。`)
  }

  return seatConfig
}

/**
 * 统一判断出牌记录是否能公开正面。背面弃牌在整局结算前任何弹窗和赢墩入口都必须显示背面。
 */
function isPlayPublic(play: PlayedAction, round: RoundState): boolean {
  return play.pattern.isOpen || play.revealed || round.phase === 'settled'
}

/**
 * 查找当前墩或历史墩，统一给抽屉展示使用。
 */
function findTrick(round: RoundState, trickIndex: number): TrickRecord | CurrentTrickState | null {
  if (round.currentTrick?.trickIndex === trickIndex) {
    return round.currentTrick
  }

  return round.publicTrickLog.find((trick) => trick.trickIndex === trickIndex) ?? null
}

/**
 * trickIndex 只表示第几次出牌回合；真正墩数按本回合张数计算。
 */
function getTrickPierCount(trick: TrickRecord | CurrentTrickState): number {
  return 'cardCount' in trick ? trick.cardCount : trick.expectedCardCount
}

/**
 * 汇总当前局所有可查看回合。当前回合放在列表首位，历史回合倒序展示，
 * 方便排查刚刚发生的可疑出牌。
 */
function getInspectableTricks(round: RoundState): InspectableTrick[] {
  const currentTrick = round.currentTrick
    ? [{ trick: round.currentTrick, isCurrent: true }]
    : []
  const historyTricks = [...round.publicTrickLog]
    .reverse()
    .map((trick) => ({ trick, isCurrent: false }))

  return [...currentTrick, ...historyTricks]
}

/**
 * 生成回合记录中的出牌摘要。背面弃牌在结算前只暴露张数，不泄露真实牌面。
 */
function formatTrickPlaySummary(
  trick: TrickRecord | CurrentTrickState,
  round: RoundState,
  seatConfigs: SeatConfig[],
): string {
  return trick.plays
    .map((play) => {
      const seatName = getSeatConfig(seatConfigs, play.seat).name
      const label = isPlayPublic(play, round) ? play.pattern.label : `弃牌${play.cards.length}张`
      return `${seatName}${label}`
    })
    .join(' / ')
}

/**
 * 回合记录里的赢家文案需要兼容“已结束回合”和“当前进行中回合”。
 */
function formatTrickStatus(
  trick: TrickRecord | CurrentTrickState,
  seatConfigs: SeatConfig[],
): string {
  if ('winner' in trick) {
    return `赢家 ${getSeatConfig(seatConfigs, trick.winner).name}`
  }

  return `进行中，明面最大 ${getSeatConfig(seatConfigs, trick.currentWinningSeat).name}`
}

/**
 * 将规则集提供的定义数组转成 UI 更好读取的映射表。
 */
function createCardDefinitionMap(definitions: CardDefinition[]) {
  return Object.fromEntries(
    definitions.map((definition) => [definition.id, definition]),
  ) as Record<string, CardDefinition>
}

/**
 * 计算某个座位的累计积分。积分只取已经完成结算的局，
 * 当前局若刚结算但还没有进入回放数组，也会作为兜底纳入一次。
 */
function getSeatScore(matchState: MatchState, seat: SeatId): number {
  const settledRounds = [...matchState.replayRounds]
  const currentRound = matchState.currentRound

  if (
    currentRound?.settlement &&
    !settledRounds.some((round) => round.roundNumber === currentRound.roundNumber)
  ) {
    settledRounds.push(currentRound)
  }

  return settledRounds.reduce((total, round) => {
    const seatSettlement = round.settlement?.seats.find((item) => item.seat === seat)
    return total + (seatSettlement?.totalDelta ?? 0)
  }, 0)
}

/**
 * 将规则层门类转换成牌桌 HUD 上的短中文。
 */
function formatDoorName(door: string): string {
  if (door === 'long') {
    return '长门'
  }

  if (door === 'yao') {
    return '幺门'
  }

  return '点子门'
}

/**
 * 统计当前局已经发生的出牌次数，当前墩和历史墩都要纳入。
 * 音效只关心“有没有新牌落桌”，不参与任何规则判断。
 */
function getRoundTotalPlayCount(round: RoundState): number {
  const publicPlayCount = round.publicTrickLog.reduce(
    (total, trick) => total + trick.plays.length,
    0,
  )
  const currentPlayCount = round.currentTrick?.plays.length ?? 0

  return publicPlayCount + currentPlayCount
}

/**
 * 读取最新一次出牌，用来区分正面出牌和背面弃牌音效。
 */
function getLatestPlayedAction(round: RoundState): PlayedAction | null {
  const currentPlays = round.currentTrick?.plays ?? []

  if (currentPlays.length > 0) {
    return currentPlays[currentPlays.length - 1]
  }

  const latestTrick = round.publicTrickLog[round.publicTrickLog.length - 1]

  if (!latestTrick || latestTrick.plays.length === 0) {
    return null
  }

  return latestTrick.plays[latestTrick.plays.length - 1]
}

/**
 * 把局面压缩成音效关注的快照，避免 UI 每次重渲染都重复播放声音。
 */
function createRoundAudioSnapshot(round: RoundState | null): RoundAudioSnapshot {
  if (!round) {
    return {
      roundNumber: null,
      phase: 'none',
      pendingDiceKey: null,
      totalPlayCount: 0,
      completedTrickCount: 0,
      settlementKey: null,
    }
  }

  return {
    roundNumber: round.roundNumber,
    phase: round.phase,
    pendingDiceKey: round.pendingDice?.roll.key ?? null,
    totalPlayCount: getRoundTotalPlayCount(round),
    completedTrickCount: round.publicTrickLog.length,
    settlementKey: round.settlement
      ? `${round.roundNumber}:${round.settlement.summary}`
      : null,
  }
}

/**
 * 根据最新出牌判断应该播放正面落牌还是背面弃牌。
 */
function getPlaySoundName(round: RoundState): GameSoundName {
  const latestPlay = getLatestPlayedAction(round)

  return latestPlay?.pattern.isOpen ? 'cardPlay' : 'cardDiscard'
}

/**
 * 抽屉里的单条出牌记录渲染器，兼容明牌与整局后翻开的背面弃牌。
 */
function TrickPlayList({
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
        const seatConfig = getSeatConfig(seatConfigs, play.seat)
        const isPublic = isPlayPublic(play, round)

        return (
          <article key={`${play.seat}-${index}`} className="drawer-trick">
            <div className="drawer-trick__head">
              <strong>{seatConfig.name}</strong>
              <span>{isPublic ? play.pattern.label : `弃牌 ${play.cards.length} 张`}</span>
            </div>
            <CardStrip
              cards={play.cards}
              compact
              spread
              hidden={!isPublic}
              getCardHidden={(card, cardIndex) =>
                isPublic && shouldCoverCardForDeadReward(play, card, cardIndex)}
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

function App() {
  const controller = useGameController()
  const [drawerState, setDrawerState] = useState<DrawerState>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const previousAudioSnapshotRef = useRef<RoundAudioSnapshot | null>(null)

  const cardDefinitionMap = useMemo(
    () => createCardDefinitionMap(controller.ruleSet.getAllCardDefinitions()),
    [controller.ruleSet],
  )

  const currentRound = controller.currentRound
  const currentSeatName =
    currentRound && controller.currentSeat !== null
      ? getSeatConfig(controller.matchState.seatConfigs, controller.currentSeat).name
      : '未开始'
  const canUseActionPanel =
    !controller.isTrickReviewing &&
    !controller.isDiceReviewing &&
    controller.visibleActionSeatState?.seat === controller.currentSeat &&
    controller.currentSeatState?.config.mode === 'human'
  const actionPanelSelectedCardIds = canUseActionPanel ? controller.selectedCardIds : []
  const actionPanelPreparedActions = canUseActionPanel ? controller.selectionPreview.actions : []
  const actionPanelHint = controller.isTrickReviewing
    ? '本回合出牌已完成，停留 2 秒方便看清牌面。'
    : controller.isDiceReviewing
      ? '骰子正在滚动并展示结果，稍等一下看清点数。'
    : controller.selectionPreview.hint
  const activeDiceRoll =
    currentRound?.pendingDice?.roll ??
    (
      currentRound?.currentTrick?.plays[0]?.pattern.source === 'dice'
        ? currentRound.lastDiceRoll
        : null
    )

  /**
   * 浏览器移动端需要用户手势后才能播放声音；这里在首次点击或触摸时解锁，
   * 同时提前预加载音效，减少第一次播放的延迟。
   */
  useEffect(() => {
    preloadGameAudio()

    function handleFirstInteraction(): void {
      unlockGameAudio()
    }

    window.addEventListener('pointerdown', handleFirstInteraction, { passive: true })
    window.addEventListener('keydown', handleFirstInteraction)

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction)
      window.removeEventListener('keydown', handleFirstInteraction)
    }
  }, [])

  /**
   * 根据局面变化自动播放音效，覆盖机器人出牌、掷骰、赢墩和结算。
   * 这里只监听状态快照差异，不把音效逻辑写进规则引擎。
   */
  useEffect(() => {
    const currentSnapshot = createRoundAudioSnapshot(currentRound)
    const previousSnapshot = previousAudioSnapshotRef.current

    previousAudioSnapshotRef.current = currentSnapshot

    if (!currentRound) {
      return
    }

    if (!previousSnapshot || previousSnapshot.roundNumber !== currentSnapshot.roundNumber) {
      playGameSound('cardShuffle')
      return
    }

    if (
      currentSnapshot.pendingDiceKey &&
      previousSnapshot.pendingDiceKey !== currentSnapshot.pendingDiceKey
    ) {
      playGameSound('diceRoll')
    }

    if (currentSnapshot.totalPlayCount > previousSnapshot.totalPlayCount) {
      playGameSound(getPlaySoundName(currentRound))
    }

    if (currentSnapshot.completedTrickCount > previousSnapshot.completedTrickCount) {
      playGameSound('trickWin')
    }

    if (
      currentSnapshot.phase === 'settled' &&
      currentSnapshot.settlementKey &&
      previousSnapshot.settlementKey !== currentSnapshot.settlementKey
    ) {
      playGameSound('settlement')
    }
  }, [currentRound])

  /**
   * 选牌属于明确的手势反馈，直接播放轻触音。
   */
  function toggleCardSelectionWithSound(cardId: string): void {
    playGameSound('cardSelect')
    controller.toggleCardSelection(cardId)
  }

  const drawerMeta = useMemo(() => {
    if (!currentRound || !drawerState) {
      return null
    }

    if (drawerState.type === 'trick') {
      const trick = findTrick(currentRound, drawerState.trickIndex)

      if (!trick) {
        return null
      }

      return {
        title: `第 ${drawerState.trickIndex} 回合详情`,
        subtitle:
          'winner' in trick
            ? `赢家：${getSeatConfig(controller.matchState.seatConfigs, trick.winner).name}｜本回合 ${getTrickPierCount(trick)} 墩`
            : `仍在进行中，本回合 ${getTrickPierCount(trick)} 墩，当前明面最大为 ${trick.currentTargetPattern?.label ?? '无公开牌'}`,
        content: (
          <TrickPlayList
            plays={trick.plays}
            round={currentRound}
            cardDefinitions={cardDefinitionMap}
            seatConfigs={controller.matchState.seatConfigs}
          />
        ),
      }
    }

    if (drawerState.type === 'history') {
      const inspectableTricks = getInspectableTricks(currentRound)

      return {
        title: '回合记录',
        subtitle: `可查 ${inspectableTricks.length} 个回合；背面弃牌整局结束前只显示背面。`,
        content: (
          <div className="drawer-history-grid">
            {inspectableTricks.length > 0 ? (
              inspectableTricks.map(({ trick, isCurrent }) => (
                <button
                  key={`${isCurrent ? 'current' : 'history'}-${trick.trickIndex}`}
                  type="button"
                  className="drawer-history-tile"
                  onClick={() => setDrawerState({ type: 'trick', trickIndex: trick.trickIndex })}
                >
                  <span className="drawer-history-tile__head">
                    <strong>第 {trick.trickIndex} 回合</strong>
                    <em>{isCurrent ? '当前' : `${getTrickPierCount(trick)} 墩`}</em>
                  </span>
                  <span className="drawer-history-tile__meta">
                    领出 {getSeatConfig(controller.matchState.seatConfigs, trick.leader).name}
                    ｜{formatTrickStatus(trick, controller.matchState.seatConfigs)}
                  </span>
                  <span className="drawer-history-tile__summary">
                    {formatTrickPlaySummary(
                      trick,
                      currentRound,
                      controller.matchState.seatConfigs,
                    ) || '还没有出牌记录'}
                  </span>
                  <span className="drawer-history-tile__cta">点开查看牌面</span>
                </button>
              ))
            ) : (
              <p className="drawer-empty">当前还没有任何回合记录。</p>
            )}
          </div>
        ),
      }
    }

    const seatState = currentRound.seats.find((seat) => seat.seat === drawerState.seat)

    if (!seatState) {
      return null
    }

    return {
      title: `${seatState.config.name} 的赢墩堆`,
      subtitle: `共赢 ${seatState.wonPierCount} 墩`,
      content: (
        <div className="drawer-stack-grid">
          {seatState.wonTricks.length > 0 ? (
            seatState.wonTricks.map((trick) => (
              <button
                key={trick.trickIndex}
                type="button"
                className="drawer-stack-tile"
                onClick={() => setDrawerState({ type: 'trick', trickIndex: trick.trickIndex })}
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
                      cardDefinitions={cardDefinitionMap}
                      hidden={!isPlayPublic(play, currentRound)}
                      getCardHidden={(card, cardIndex) =>
                        isPlayPublic(play, currentRound) &&
                        shouldCoverCardForDeadReward(play, card, cardIndex)}
                      getCardHiddenLabel={(card, cardIndex) =>
                        getDeadRewardCoverLabel(play, card, cardIndex)}
                      mini
                      spread
                    />
                  ))}
                </div>
                <span className="drawer-stack-tile__cta">点击查看本回合</span>
              </button>
            ))
          ) : (
            <p className="drawer-empty">当前还没有赢下任何墩。</p>
          )}
        </div>
      ),
    }
  }, [cardDefinitionMap, controller.matchState.seatConfigs, currentRound, drawerState])

  /**
   * 从牌桌菜单强制开始新局时，先关闭覆盖层，避免新局被菜单挡住。
   */
  function startRoundFromMenu(): void {
    setIsMenuOpen(false)
    controller.startRound()
  }

  /**
   * 从菜单重置整场时，明确关闭覆盖层并丢弃当前局。
   */
  function restartMatchFromMenu(): void {
    setIsMenuOpen(false)
    controller.restartMatch()
  }

  if (!currentRound) {
    return (
      <main className="app-shell">
        <LobbyPanel
          onStart={controller.startRound}
          onRestartMatch={controller.restartMatch}
          canConfigureSeats
        />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="game-table">
        <span className="table-corner table-corner--top-left" aria-hidden="true" />
        <span className="table-corner table-corner--top-right" aria-hidden="true" />
        <span className="table-corner table-corner--bottom-left" aria-hidden="true" />
        <span className="table-corner table-corner--bottom-right" aria-hidden="true" />

        <button
          type="button"
          className="table-menu-button"
          aria-label="打开菜单"
          onClick={() => setIsMenuOpen(true)}
        >
          <span className="table-menu-button__triangle" aria-hidden="true" />
        </button>

        <aside className={`table-hud ${activeDiceRoll ? 'table-hud--with-dice' : ''}`}>
          <div className="table-hud__info">
            <span>
              <em>局数</em>{currentRound.roundNumber}
            </span>
            <span>
              <em>当前</em>{currentSeatName}
            </span>
            <span>
              <em>弃牌</em>{currentRound.hiddenPlaysPendingReveal}
            </span>
          </div>
          {activeDiceRoll ? (
            <div className="table-hud__dice-result">
              <span>
                骰子: {activeDiceRoll.first}+{activeDiceRoll.second}
                {' '}{formatDoorName(activeDiceRoll.door)}
              </span>
              <DiceDisplay roll={activeDiceRoll} compact />
            </div>
          ) : null}
        </aside>

        <section className="table-surface">
          <div className="table-surface__north">
            <SeatPanel
              seatState={currentRound.seats[2]}
              isCurrent={controller.currentSeat === 2}
              isDealer={currentRound.firstLeader === 2}
              score={getSeatScore(controller.matchState, 2)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 2 })}
            />
          </div>
          <div className="table-surface__west">
            <SeatPanel
              seatState={currentRound.seats[3]}
              isCurrent={controller.currentSeat === 3}
              isDealer={currentRound.firstLeader === 3}
              score={getSeatScore(controller.matchState, 3)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 3 })}
            />
          </div>
          <div className="table-surface__center">
            <TrickArena
              round={currentRound}
              reviewTrick={controller.reviewTrick}
              seatConfigs={controller.matchState.seatConfigs}
              cardDefinitions={cardDefinitionMap}
              onInspectTrick={(trickIndex) => setDrawerState({ type: 'trick', trickIndex })}
            />
          </div>
          <div className="table-surface__east">
            <SeatPanel
              seatState={currentRound.seats[1]}
              isCurrent={controller.currentSeat === 1}
              isDealer={currentRound.firstLeader === 1}
              score={getSeatScore(controller.matchState, 1)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 1 })}
            />
          </div>
          <div className="table-surface__south">
            <SeatPanel
              seatState={currentRound.seats[0]}
              isCurrent={controller.currentSeat === 0}
              isDealer={currentRound.firstLeader === 0}
              score={getSeatScore(controller.matchState, 0)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 0 })}
            />
          </div>
        </section>

        <ActionPanel
          seatState={controller.visibleActionSeatState}
          cardDefinitions={cardDefinitionMap}
          selectedCardIds={actionPanelSelectedCardIds}
          handCards={controller.visibleActionHandCards}
          hint={actionPanelHint}
          preparedActions={actionPanelPreparedActions}
          canInteract={canUseActionPanel}
          onCardToggle={toggleCardSelectionWithSound}
          onHandReorder={controller.reorderCurrentHand}
          onActionSubmit={controller.submitPreparedAction}
        />
      </section>

      <div className="table-footer">
        <SettlementPanel
          round={currentRound}
          seatConfigs={controller.matchState.seatConfigs}
          onInspectHistory={() => setDrawerState({ type: 'history' })}
          onNextRound={controller.startRound}
          onRestartMatch={controller.restartMatch}
        />
      </div>

      <InspectorDrawer
        open={drawerMeta !== null}
        title={drawerMeta?.title ?? ''}
        subtitle={drawerMeta?.subtitle}
        onClose={() => setDrawerState(null)}
      >
        {drawerMeta?.content}
      </InspectorDrawer>

      {isMenuOpen ? (
        <div className="lobby-overlay">
          <button
            type="button"
            aria-label="关闭菜单并返回牌桌"
            className="lobby-overlay__backdrop"
            onClick={() => setIsMenuOpen(false)}
          />
          <LobbyPanel
            onStart={startRoundFromMenu}
            onRestartMatch={restartMatchFromMenu}
            onClose={() => setIsMenuOpen(false)}
            canConfigureSeats={false}
            startLabel="强制新局"
            restartLabel="重置整场"
          />
        </div>
      ) : null}
    </main>
  )
}

export default App
