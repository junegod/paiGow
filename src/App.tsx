import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useGameController } from '@/app/useGameController'
import { useOnlineController } from '@/app/useOnlineController'
import { DEFAULT_BOT_DIFFICULTY } from '@/app/botDifficulty'
import { useLocalPlayerData } from '@/local-data/useLocalPlayerData'
import type {
  CardDefinition,
  CurrentTrickState,
  DiceRoll,
  MatchState,
  PlayedAction,
  RoundState,
  SeatConfig,
  SeatId,
  TrickRecord,
} from '@/rules-core/types'
import {
  DEFAULT_GAME_AUDIO_PREFERENCES,
  playGameSound,
} from '@/ui/audio/gameAudio'
import { useGameAudio } from '@/ui/audio/useGameAudio'
import { ActionPanel } from '@/ui/components/ActionPanel'
import { CardStrip } from '@/ui/components/CardStrip'
import { DiceBowlControl } from '@/ui/components/DiceBowlControl'
import { InspectorDrawer } from '@/ui/components/InspectorDrawer'
import { LobbyPanel } from '@/ui/components/LobbyPanel'
import { OpeningCeremonyLayer } from '@/ui/components/OpeningCeremonyLayer'
import { SeatPanel } from '@/ui/components/SeatPanel'
import { SettingsPanel } from '@/ui/components/SettingsPanel'
import { SettlementPanel } from '@/ui/components/SettlementPanel'
import { TrickArena } from '@/ui/components/TrickArena'
import { useAppGestureGuards } from '@/ui/hooks/useAppGestureGuards'
import {
  getDeadRewardCoverLabel,
  shouldCoverCardForDeadReward,
} from '@/ui/cardPresentation'

type DrawerState =
  | { type: 'trick'; trickIndex: number }
  | { type: 'seat'; seat: SeatId }
  | { type: 'history' }
  | null

type LeaveConfirmAction = 'restart-round' | 'return-home'

type LeaveConfirmState = {
  /** 用户准备执行的离局动作，用于确认后继续调度对应菜单行为。 */
  action: LeaveConfirmAction
  /** 弹窗主标题，明确当前不是系统浏览器提示。 */
  title: string
  /** 弹窗正文，说明积分局中途离开会触发防刷牌扣分。 */
  message: string
  /** 确认按钮文案，按具体动作展示“重新开始”或“返回首页”。 */
  confirmLabel: string
}

type InspectableTrick = {
  trick: TrickRecord | CurrentTrickState
  isCurrent: boolean
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
 * 牌桌头像下方展示的是“当前可用积分”。真人座位读取本地钱包，
 * 机器人暂时没有本地档案，继续展示本场内累计输赢，方便观察机器人表现。
 */
function getTableDisplayScore(
  matchState: MatchState,
  seat: SeatId,
  localUserScore: number | null,
): number {
  const seatConfig = getSeatConfig(matchState.seatConfigs, seat)

  if (seatConfig.mode === 'human' && localUserScore !== null) {
    return localUserScore
  }

  return getSeatScore(matchState, seat)
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
  const localPlayerData = useLocalPlayerData()
  const botDifficulty =
    localPlayerData.snapshot?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY
  const skipOpeningCeremony = localPlayerData.snapshot?.skipOpeningCeremony ?? false
  const controller = useGameController(botDifficulty, skipOpeningCeremony)
  const online = useOnlineController(localPlayerData.snapshot?.activeUser?.nickname ?? '玩家')
  const activeController = online.mode === 'match' ? online.controller : controller
  const [drawerState, setDrawerState] = useState<DrawerState>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [onlineRoomCode, setOnlineRoomCode] = useState('')
  const [onlinePlayerName, setOnlinePlayerName] = useState('')
  const [browserPlayerName, setBrowserPlayerName] = useState('')
  const [isCurrentMatchScored, setIsCurrentMatchScored] = useState(true)
  const [leaveConfirmState, setLeaveConfirmState] = useState<LeaveConfirmState | null>(null)
  const [leaveConfirmError, setLeaveConfirmError] = useState<string | null>(null)
  const [isLeavePenaltySubmitting, setIsLeavePenaltySubmitting] = useState(false)
  const [lastVisibleDiceRoll, setLastVisibleDiceRoll] = useState<DiceRoll | null>(null)
  const recordedLocalRoundKeyRef = useRef<string | null>(null)

  const cardDefinitionMap = useMemo(
    () => createCardDefinitionMap(activeController.ruleSet.getAllCardDefinitions()),
    [activeController.ruleSet],
  )

  const currentRound = activeController.currentRound
  const currentMatchState = activeController.matchState
  const activeLocalUserId = localPlayerData.snapshot?.activeUserId ?? null
  const activeLocalStats =
    localPlayerData.snapshot?.activeUser
      ? localPlayerData.snapshot.statsByUserId[localPlayerData.snapshot.activeUser.id] ?? null
      : null
  const activeLocalScore = activeLocalStats?.totalScore ?? null
  const audioPreferences =
    localPlayerData.snapshot?.audioPreferences ?? DEFAULT_GAME_AUDIO_PREFERENCES
  const canUseActionPanel =
    !activeController.isOpeningCeremonyActive &&
    !activeController.isTrickReviewing &&
    !activeController.isDiceReviewing &&
    activeController.visibleActionSeatState?.seat === activeController.currentSeat &&
    activeController.currentSeatState?.config.mode === 'human'
  const actionPanelSelectedCardIds = canUseActionPanel ? activeController.selectedCardIds : []
  const actionPanelPreparedActions = canUseActionPanel ? activeController.selectionPreview.actions : []
  const rollActionForBowl =
    canUseActionPanel
      ? actionPanelPreparedActions.find((action) => action.intent === 'roll-dice') ?? null
      : null
  const actionPanelHint = activeController.isTrickReviewing
    ? '本回合出牌已完成，停留 2 秒方便看清牌面。'
    : activeController.isOpeningCeremonyActive
      ? '正在洗牌抓牌，抓完后只亮你的手牌。'
    : activeController.isDiceReviewing
      ? '骰子正在滚动并展示结果，稍等一下看清点数。'
    : rollActionForBowl
      ? '点右上角的碗掷骰。'
    : activeController.selectionPreview.hint
  const activeDiceRoll =
    currentRound?.pendingDice?.roll ??
    (
      currentRound?.currentTrick?.plays[0]?.pattern.source === 'dice'
        ? currentRound.lastDiceRoll
        : null
    ) ??
    null
  const fallbackDiceRoll =
    activeDiceRoll ??
    currentRound?.lastDiceRoll ??
    currentRound?.ceremony.roll ??
    null
  const bowlDisplayRoll = fallbackDiceRoll ?? lastVisibleDiceRoll
  const activeDiceResultLabel = activeDiceRoll
    ? `${activeDiceRoll.first}+${activeDiceRoll.second} ${formatDoorName(activeDiceRoll.door)}`
    : null
  const activeScoredRoundKey =
    isCurrentMatchScored &&
    activeLocalUserId &&
    currentRound?.phase === 'playing'
      ? `${activeLocalUserId}:${currentMatchState?.matchId}:${currentRound.roundNumber}`
      : null
  const shouldWarnBeforeLeavingScoredRound = Boolean(activeScoredRoundKey)

  const recordSettledRoundLocally = useEffectEvent((round: RoundState, matchState: MatchState) =>
    localPlayerData.recordSettledRound(matchState, round),
  )

  /**
   * 骰碗作为桌面常驻物件时不能空着；没有当前掷骰态时，
   * 继续保留最近一次能公开看到的骰子结果。
   */
  useEffect(() => {
    if (fallbackDiceRoll) {
      setLastVisibleDiceRoll(fallbackDiceRoll)
    }
  }, [fallbackDiceRoll])

  /**
   * 刷新浏览器、关闭标签页或跳转离开时只显示二次确认，不提前写入扣分登记。
   * 扣 4 分只发生在玩家通过牌桌菜单确认“返回首页 / 重新开始”的强制离开动作里。
   */
  useEffect(() => {
    if (!shouldWarnBeforeLeavingScoredRound) {
      return
    }

    function handleBeforeUnload(event: BeforeUnloadEvent): string {
      event.preventDefault()
      event.returnValue = '当前积分局未完成，确认离开会放弃当前局。'
      return event.returnValue
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [shouldWarnBeforeLeavingScoredRound])

  useAppGestureGuards()
  useGameAudio(currentRound, activeController.isOpeningCeremonyActive, audioPreferences)

  /**
   * 每局结算后给当前本机用户记一条积分流水。服务层按局唯一键去重，
   * 这里的 ref 只是减少同一轮 React 渲染里的重复写入。
   */
  useEffect(() => {
    if (
      !isCurrentMatchScored ||
      !currentMatchState ||
      !currentRound?.settlement ||
      currentRound.phase !== 'settled' ||
      !activeLocalUserId
    ) {
      return
    }

    const localRoundKey = `${activeLocalUserId}:${currentMatchState.matchId}:${currentRound.roundNumber}`

    if (recordedLocalRoundKeyRef.current === localRoundKey) {
      return
    }

    recordedLocalRoundKeyRef.current = localRoundKey
    void recordSettledRoundLocally(currentRound, currentMatchState)
  }, [
    activeLocalUserId,
    currentMatchState,
    currentMatchState?.matchId,
    currentRound,
    currentRound?.phase,
    currentRound?.roundNumber,
    currentRound?.settlement,
    isCurrentMatchScored,
  ])

  /**
   * 选牌属于明确的手势反馈，直接播放轻触音。
   */
  function toggleCardSelectionWithSound(cardId: string): void {
    playGameSound('cardSelect')
    activeController.toggleCardSelection(cardId)
  }

  /**
   * 联机时使用服务端房间座位配置，单机时使用本地牌局配置。
   * 仪式层和抽屉都复用同一个来源，避免大厅改名后界面显示不一致。
   */
  const displaySeatConfigs = useMemo(
    () => (online.mode === 'match' && online.room
      ? online.room.seatConfigs
      : currentMatchState?.seatConfigs ?? []),
    [currentMatchState?.seatConfigs, online.mode, online.room],
  )

  const drawerMeta = useMemo(() => {
    if (!currentRound || !currentMatchState || !drawerState) {
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
            ? `赢家：${getSeatConfig(currentMatchState.seatConfigs, trick.winner).name}｜本回合 ${getTrickPierCount(trick)} 墩`
            : `仍在进行中，本回合 ${getTrickPierCount(trick)} 墩，当前明面最大为 ${trick.currentTargetPattern?.label ?? '无公开牌'}`,
        content: (
          <TrickPlayList
            plays={trick.plays}
            round={currentRound}
            cardDefinitions={cardDefinitionMap}
            seatConfigs={displaySeatConfigs}
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
                    领出 {getSeatConfig(currentMatchState.seatConfigs, trick.leader).name}
                    ｜{formatTrickStatus(trick, currentMatchState.seatConfigs)}
                  </span>
                  <span className="drawer-history-tile__summary">
                    {formatTrickPlaySummary(
                      trick,
                      currentRound,
                      currentMatchState.seatConfigs,
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
  }, [
    currentMatchState,
    cardDefinitionMap,
    currentRound,
    drawerState,
    displaySeatConfigs,
  ])

  /**
   * 判断菜单离开是否要走内部确认。只有正在进行的普通积分局才扣系统防刷牌分，
   * 定制牌局、结算页和未加载本地用户时都直接执行原菜单动作。
   */
  function shouldConfirmMenuLeave(): boolean {
    return isCurrentMatchScored && currentRound?.phase === 'playing' && Boolean(activeLocalUserId)
  }

  /**
   * 真正执行菜单动作。这里不负责扣分，只做牌桌状态切换，
   * 这样确认弹窗、免确认场景和后续扩展动作都能复用。
   */
  function executeMenuLeaveAction(action: LeaveConfirmAction): void {
    setIsMenuOpen(false)
    setIsCurrentMatchScored(true)

    if (action === 'restart-round') {
      activeController.startRound()
      return
    }

    activeController.restartMatch()
  }

  /**
   * 构造内部确认弹窗的展示内容。文案放在这里集中管理，
   * 避免菜单按钮和弹窗 JSX 各自拼字符串导致以后不好改。
   */
  function createLeaveConfirmState(action: LeaveConfirmAction): LeaveConfirmState {
    if (action === 'restart-round') {
      return {
        action,
        title: '中途重新开始？',
        message: '当前积分局还没打完，重新开始会扣 4 分，防止反复刷好牌。余额不足 4 分时只扣剩余积分。',
        confirmLabel: '扣 4 分并重新开始',
      }
    }

    return {
      action,
      title: '中途返回首页？',
      message: '当前积分局还没打完，返回首页会扣 4 分，防止反复刷好牌。余额不足 4 分时只扣剩余积分。',
      confirmLabel: '扣 4 分并返回首页',
    }
  }

  /**
   * 牌桌菜单动作入口。需要扣分时先打开游戏内弹窗，不再使用浏览器系统 confirm。
   */
  function requestMenuLeave(action: LeaveConfirmAction): void {
    if (!shouldConfirmMenuLeave()) {
      executeMenuLeaveAction(action)
      return
    }

    setIsMenuOpen(false)
    setLeaveConfirmError(null)
    setLeaveConfirmState(createLeaveConfirmState(action))
  }

  /**
   * 用户在内部弹窗中确认离局后，先写入离局扣分流水，再执行对应菜单动作。
   * 如果本地写入失败，留在当前牌桌并显示错误，避免未扣分就重新开局。
   */
  async function confirmMenuLeaveWithPenalty(): Promise<void> {
    if (!leaveConfirmState || isLeavePenaltySubmitting) {
      return
    }

    if (!currentMatchState || !currentRound || currentRound.phase !== 'playing') {
      executeMenuLeaveAction(leaveConfirmState.action)
      setLeaveConfirmState(null)
      return
    }

    setIsLeavePenaltySubmitting(true)
    setLeaveConfirmError(null)

    try {
      await localPlayerData.recordAbandonedRoundPenalty(currentMatchState, currentRound)
      executeMenuLeaveAction(leaveConfirmState.action)
      setLeaveConfirmState(null)
    } catch {
      setLeaveConfirmError('本地扣分记录失败，先别离开。请再点一次。')
    } finally {
      setIsLeavePenaltySubmitting(false)
    }
  }

  /**
   * 取消内部离局弹窗只回到牌桌，不扣分、不重开、不回首页。
   */
  function cancelMenuLeave(): void {
    if (isLeavePenaltySubmitting) {
      return
    }

    setLeaveConfirmState(null)
    setLeaveConfirmError(null)
  }

  /**
   * 结算页离开或进入下一局前强制等待本机积分落账。
   * 自动记账 effect 仍保留用于即时刷新，这里兜底解决用户快速点击返回时分数还没写入的问题。
   */
  async function persistCurrentSettlementForScore(): Promise<void> {
    if (
      !isCurrentMatchScored ||
      !currentMatchState ||
      !currentRound?.settlement ||
      currentRound.phase !== 'settled' ||
      !activeLocalUserId
    ) {
      return
    }

    const localRoundKey = `${activeLocalUserId}:${currentMatchState.matchId}:${currentRound.roundNumber}`

    recordedLocalRoundKeyRef.current = localRoundKey
    await localPlayerData.recordSettledRound(currentMatchState, currentRound)
  }

  /**
   * 首页普通单机开始，结算会写入本机积分。
   */
  function startScoredRound(options?: Parameters<typeof activeController.startRound>[0]): void {
    setIsCurrentMatchScored(true)
    activeController.startRound(options)
  }

  /**
   * 定制牌局用于验规则和赏钱，不写入积分流水。
   */
  function startCustomRound(options?: Parameters<typeof activeController.startRound>[0]): void {
    setIsCurrentMatchScored(false)
    activeController.startRound(options)
  }

  /**
   * 结算页返回首页时先落积分，再恢复普通积分模式。
   */
  async function restartMatchFromSettlement(): Promise<void> {
    await persistCurrentSettlementForScore()
    setIsCurrentMatchScored(true)
    activeController.restartMatch()
  }

  /**
   * 结算页继续下一局也要先完成本局落账，避免连续开局时漏记积分。
   */
  async function startNextRoundFromSettlement(): Promise<void> {
    await persistCurrentSettlementForScore()
    activeController.startRound()
  }

  const settingsPanel = isSettingsOpen ? (
    <SettingsPanel
      audioPreferences={audioPreferences}
      disabled={localPlayerData.status !== 'ready'}
      skipOpeningCeremony={skipOpeningCeremony}
      onClose={() => setIsSettingsOpen(false)}
      onAudioPreferencesChange={localPlayerData.setAudioPreferences}
      onSkipOpeningCeremonyChange={localPlayerData.setSkipOpeningCeremony}
    />
  ) : null

  if (online.mode === 'browser') {
    return (
      <main className="app-shell">
        <section className="lobby-panel online-browser">
          <p className="lobby-panel__eyebrow">朋友局</p>
          <h1>联机大厅</h1>
          <p className="online-room__status">
            {online.connectionStatus === 'connected'
              ? (online.isRoomListLoading && online.roomList.length === 0
                  ? '正在加载房间列表...'
                  : '已连接服务器')
              : '正在连接服务器...'}
          </p>

          <div className="online-browser__create">
            <input
              placeholder="我的昵称"
              value={browserPlayerName}
              maxLength={12}
              onChange={(event) => setBrowserPlayerName(event.target.value)}
            />
            <button
              type="button"
              className="home-action home-action--primary"
              onClick={() => online.createRoomFromBrowser(browserPlayerName)}
              disabled={online.connectionStatus !== 'connected'}
            >
              新建房间
            </button>
          </div>

          <div className="online-browser__list">
            {online.roomList.length === 0 && !online.isRoomListLoading ? (
              <p className="online-browser__empty">
                暂时没有等待中的房间，创建一个叫朋友来吧。
              </p>
            ) : null}
            {online.roomList.map((room) => (
              <article key={room.roomCode} className="online-browser__room">
                <div className="online-browser__room-main">
                  <strong>{room.hostName} 的房间</strong>
                  <span>
                    房间码 {room.roomCode}｜{room.onlineCount}/{room.maxCount} 人
                  </span>
                </div>
                <button
                  type="button"
                  className="home-action"
                  disabled={room.onlineCount >= room.maxCount}
                  onClick={() => online.joinRoomFromBrowser(room.roomCode, browserPlayerName)}
                >
                  加入
                </button>
              </article>
            ))}
          </div>

          {online.error ? <p className="online-room__error">{online.error}</p> : null}
          <button type="button" className="home-action" onClick={online.exitBrowser}>
            返回首页
          </button>
        </section>
      </main>
    )
  }

  if (online.mode === 'lobby') {
    return (
      <main className="app-shell">
        <section className="lobby-panel">
          <div className="online-room">
            <p className="lobby-panel__eyebrow">朋友局</p>
            <h1>房间 {online.room?.roomCode ?? online.session?.roomCode}</h1>
            <p className="online-room__status">
              {online.connectionStatus === 'connected' ? '已连接服务器' : '正在连接服务器...'}
              {online.notice ? `｜${online.notice}` : ''}
            </p>
            <p className="online-room__notice">
              把房间码告诉朋友。人齐后由房主点击开始，空座位会用机器人补位。
            </p>
            <div className="online-room__seats">
              {online.room?.seatConfigs.map((seatConfig) => (
                <article
                  key={seatConfig.seat}
                  className={`online-room__seat ${online.room?.onlineSeats.includes(seatConfig.seat) ? 'online-room__seat--online' : ''}`}
                >
                  <strong>{seatConfig.name}</strong>
                  <span>
                    座位 {seatConfig.seat + 1}
                    {online.room?.onlineSeats.includes(seatConfig.seat) ? '｜在线' : '｜等待'}
                    {seatConfig.mode === 'bot' ? '｜机器人' : '｜真人'}
                  </span>
                </article>
              ))}
            </div>
            {online.player?.seat === 0 && online.room && !online.room.isPlaying ? (
              <>
                <label className="online-room__bot-label">
                  机器人名字（用空格分隔）
                  <input
                    value={online.botNames.join(' ')}
                    onChange={(event) => online.saveBotNames(event.target.value.split(/\s+/).filter(Boolean))}
                  />
                </label>
                <button type="button" className="home-action home-action--primary" onClick={online.startMatch}>
                  开始牌局
                </button>
              </>
            ) : null}
            {online.error ? <p className="online-room__error">{online.error}</p> : null}
            <button
              type="button"
              className="home-action"
              onClick={() => {
                online.leaveOnlineMode()
                window.location.reload()
              }}
            >
              离开房间
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (!currentRound) {
    return (
      <main className="app-shell">
        <LobbyPanel
          onCreateRoom={(playerName) => {
            setOnlinePlayerName(playerName)
            online.createRoom(playerName)
          }}
          onJoinRoom={(roomCode, playerName) => {
            setOnlineRoomCode(roomCode)
            setOnlinePlayerName(playerName)
            online.joinRoom(roomCode, playerName)
          }}
          onOpenBrowser={online.enterBrowser}
          onlineConnectionStatus={online.mode === 'offline' ? online.connectionStatus : undefined}
          onlineRoomCode={online.mode === 'offline' ? onlineRoomCode : undefined}
          onlinePlayerName={online.mode === 'offline' ? onlinePlayerName : undefined}
          onlineError={online.mode === 'offline' ? online.error : undefined}
          onStart={startScoredRound}
          onStartCustom={startCustomRound}
          canConfigureSeats
          botDifficulty={botDifficulty}
          onBotDifficultyChange={localPlayerData.setBotDifficulty}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isBotDifficultyReady={localPlayerData.status === 'ready'}
          localUserPanel={{
            users: localPlayerData.snapshot?.users ?? [],
            activeUser: localPlayerData.snapshot?.activeUser ?? null,
            activeStats: activeLocalStats,
            recentHistories: localPlayerData.snapshot?.recentHistories ?? [],
            status: localPlayerData.status,
            errorMessage: localPlayerData.errorMessage,
            onCreateUser: localPlayerData.createUser,
            onSwitchUser: localPlayerData.switchUser,
          }}
        />
        {settingsPanel}
      </main>
    )
  }

  if (!currentMatchState) {
    return (
      <main className="app-shell">
        <section className="lobby-panel">
          <p className="lobby-panel__summary">正在同步牌局状态...</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className={`game-table ${activeController.isOpeningCeremonyActive ? 'game-table--ceremony' : ''}`}>
        <span className="table-corner table-corner--top-left" aria-hidden="true" />
        <span className="table-corner table-corner--top-right" aria-hidden="true" />
        <span className="table-corner table-corner--bottom-left" aria-hidden="true" />
        <span className="table-corner table-corner--bottom-right" aria-hidden="true" />

        <button
          type="button"
          className={`table-menu-button ${isMenuOpen ? 'table-menu-button--open' : ''}`}
          aria-label="打开菜单"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((previousValue) => !previousValue)}
        >
          <span className="table-menu-button__icon" aria-hidden="true" />
        </button>
        {isMenuOpen ? (
          <>
            <button
              type="button"
              aria-label="收起菜单"
              className="table-menu-dismiss"
              onClick={() => setIsMenuOpen(false)}
            />
            <div className="table-menu-dropdown" role="menu" aria-label="牌桌菜单">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMenuOpen(false)
                  setIsSettingsOpen(true)
                }}
              >
                设置
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestMenuLeave('restart-round')
                }}
              >
                重新开始
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestMenuLeave('return-home')
                }}
              >
                返回首页
              </button>
            </div>
          </>
        ) : null}

        <DiceBowlControl
          roll={bowlDisplayRoll}
          rolling={activeController.isDiceReviewing}
          rollAction={rollActionForBowl}
          resultLabel={activeDiceResultLabel}
          onRoll={activeController.submitPreparedAction}
        />

        <section className="table-surface">
          <div className="table-surface__north">
            <SeatPanel
              seatState={currentRound.seats[2]}
              isCurrent={activeController.currentSeat === 2}
              isDealer={currentRound.firstLeader === 2}
              score={getTableDisplayScore(currentMatchState, 2, activeLocalScore)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 2 })}
            />
          </div>
          <div className="table-surface__west">
            <SeatPanel
              seatState={currentRound.seats[3]}
              isCurrent={activeController.currentSeat === 3}
              isDealer={currentRound.firstLeader === 3}
              score={getTableDisplayScore(currentMatchState, 3, activeLocalScore)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 3 })}
            />
          </div>
          <div className="table-surface__center">
            <TrickArena
              round={currentRound}
              reviewTrick={activeController.reviewTrick}
              seatConfigs={displaySeatConfigs}
              cardDefinitions={cardDefinitionMap}
              onInspectTrick={(trickIndex) => setDrawerState({ type: 'trick', trickIndex })}
            />
          </div>
          <div className="table-surface__east">
            <SeatPanel
              seatState={currentRound.seats[1]}
              isCurrent={activeController.currentSeat === 1}
              isDealer={currentRound.firstLeader === 1}
              score={getTableDisplayScore(currentMatchState, 1, activeLocalScore)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 1 })}
            />
          </div>
          <div className="table-surface__south">
            <SeatPanel
              seatState={currentRound.seats[0]}
              isCurrent={activeController.currentSeat === 0}
              isDealer={currentRound.firstLeader === 0}
              score={getTableDisplayScore(currentMatchState, 0, activeLocalScore)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 0 })}
            />
          </div>
        </section>

        <ActionPanel
          seatState={activeController.visibleActionSeatState}
          cardDefinitions={cardDefinitionMap}
          selectedCardIds={actionPanelSelectedCardIds}
          handCards={activeController.visibleActionHandCards}
          hint={actionPanelHint}
          roundNumber={currentRound.roundNumber}
          preparedActions={actionPanelPreparedActions}
          canInteract={canUseActionPanel}
          isOrganizingHand={activeController.isHandOrganizing}
          useBowlForRoll={Boolean(rollActionForBowl)}
          onCardToggle={toggleCardSelectionWithSound}
          onHandReorder={activeController.reorderCurrentHand}
          onOrganizeHand={activeController.organizeHumanHand}
          onActionSubmit={activeController.submitPreparedAction}
        />

        {activeController.openingCeremony ? (
          <OpeningCeremonyLayer
            round={activeController.openingCeremony.round}
            seatConfigs={displaySeatConfigs}
            cardDefinitions={cardDefinitionMap}
            onDone={activeController.finishOpeningCeremony}
          />
        ) : null}

        {leaveConfirmState ? (
          <div
            className="leave-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-confirm-title"
            aria-describedby="leave-confirm-desc"
          >
            <button
              type="button"
              className="leave-confirm__backdrop"
              aria-label="继续牌桌"
              onClick={cancelMenuLeave}
              disabled={isLeavePenaltySubmitting}
            />
            <section className="leave-confirm__panel">
              <p className="leave-confirm__eyebrow">积分局保护</p>
              <h2 id="leave-confirm-title">{leaveConfirmState.title}</h2>
              <p id="leave-confirm-desc">{leaveConfirmState.message}</p>
              {leaveConfirmError ? (
                <p className="leave-confirm__error">{leaveConfirmError}</p>
              ) : null}
              <div className="leave-confirm__actions">
                <button
                  type="button"
                  className="hero-button hero-button--ghost"
                  onClick={cancelMenuLeave}
                  disabled={isLeavePenaltySubmitting}
                >
                  继续牌桌
                </button>
                <button
                  type="button"
                  className="hero-button hero-button--primary leave-confirm__danger"
                  onClick={() => {
                    void confirmMenuLeaveWithPenalty()
                  }}
                  disabled={isLeavePenaltySubmitting}
                >
                  {isLeavePenaltySubmitting ? '扣分中...' : leaveConfirmState.confirmLabel}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>

      <div className="table-footer">
        <SettlementPanel
          round={currentRound}
          seatConfigs={displaySeatConfigs}
          onInspectHistory={() => setDrawerState({ type: 'history' })}
          onNextRound={startNextRoundFromSettlement}
          onRestartMatch={restartMatchFromSettlement}
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
      {settingsPanel}
    </main>
  )
}

export default App
