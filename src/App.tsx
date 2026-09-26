import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { useSettlementPersistence } from '@/app/useSettlementPersistence'
import { useGameController } from '@/app/useGameController'
import { useOnlineController } from '@/app/useOnlineController'
import { DEFAULT_BOT_DIFFICULTY } from '@/app/botDifficulty'
import { useLocalPlayerData } from '@/local-data/useLocalPlayerData'
import type {
  CardDefinition,
  DiceRoll,
  MatchState,
  SeatConfig,
  SeatId,
} from '@/rules-core/types'
import {
  DEFAULT_GAME_AUDIO_PREFERENCES,
  playGameSound,
} from '@/ui/audio/gameAudio'
import { useGameAudio } from '@/ui/audio/useGameAudio'
import { GameHelpPanel } from '@/ui/components/GameHelpPanel'
import { TableMenu } from '@/ui/components/TableMenu'
import { describeTurnSelection } from '@/ui/turnGuidance'
import { ActionPanel } from '@/ui/components/ActionPanel'
import { DiceBowlControl } from '@/ui/components/DiceBowlControl'
import { InspectorDrawer } from '@/ui/components/InspectorDrawer'
import {
  LeaveConfirmDialog,
  type LeaveConfirmAction,
  type LeaveConfirmState,
} from '@/ui/components/LeaveConfirmDialog'
import { LobbyPanel } from '@/ui/components/LobbyPanel'
import { OpeningCeremonyLayer } from '@/ui/components/OpeningCeremonyLayer'
import { OnlineBrowserPanel } from '@/ui/components/OnlineBrowserPanel'
import { OnlineRoomPanel } from '@/ui/components/OnlineRoomPanel'
import { SeatPanel } from '@/ui/components/SeatPanel'
import { SettingsPanel } from '@/ui/components/SettingsPanel'
import { SettlementPanel } from '@/ui/components/SettlementPanel'
import { TrickArena } from '@/ui/components/TrickArena'
import { createGameDrawerMeta, type DrawerState } from '@/ui/gameInspection'
import { useAppGestureGuards } from '@/ui/hooks/useAppGestureGuards'

function getSeatConfig(seatConfigs: SeatConfig[], seat: SeatId): SeatConfig {
  const seatConfig = seatConfigs.find((item) => item.seat === seat)

  if (!seatConfig) {
    throw new Error(`缺少座位 ${seat} 的配置。`)
  }

  return seatConfig
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
 * 组合单机与联机控制器，统一牌桌展示、积分离局门禁和局内帮助入口。
 * @returns 当前大厅或牌桌界面。
 */
function App() {
  const localPlayerData = useLocalPlayerData()
  const botDifficulty =
    localPlayerData.snapshot?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY
  const skipOpeningCeremony = localPlayerData.snapshot?.skipOpeningCeremony ?? false
  const controller = useGameController(botDifficulty, skipOpeningCeremony)
  const online = useOnlineController(localPlayerData.snapshot?.activeUser?.nickname ?? '玩家')
  const activeController = online.mode === 'match' ? online.controller : controller
  const [drawerState, setDrawerState] = useState<DrawerState>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [onlineRoomCode, setOnlineRoomCode] = useState('')
  const [onlinePlayerName, setOnlinePlayerName] = useState('')
  const [browserPlayerName, setBrowserPlayerName] = useState('')
  const [isCurrentMatchScored, setIsCurrentMatchScored] = useState(true)
  const [leaveConfirmState, setLeaveConfirmState] = useState<LeaveConfirmState | null>(null)
  const [leaveConfirmError, setLeaveConfirmError] = useState<string | null>(null)
  const [isLeavePenaltySubmitting, setIsLeavePenaltySubmitting] = useState(false)
  const [lastVisibleDiceRoll, setLastVisibleDiceRoll] = useState<DiceRoll | null>(null)

  /** 本地用户加载完成后为联机大厅补上默认昵称，但不覆盖玩家已经输入的内容。 */
  useEffect(() => {
    const nickname = localPlayerData.snapshot?.activeUser?.nickname

    if (nickname) {
      setBrowserPlayerName((previousName) => previousName || nickname)
    }
  }, [localPlayerData.snapshot?.activeUser?.nickname])

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
    (online.mode !== 'match' || (online.connectionStatus === 'connected' && online.isSynchronized)) &&
    // 联机模式下面板展示的是"自己座位"，只要当前回合就是自己即可操作。
    (online.mode === 'match' || activeController.currentSeatState?.config.mode === 'human')
  const actionPanelSelectedCardIds = canUseActionPanel ? activeController.selectedCardIds : []
  const actionPanelPreparedActions = canUseActionPanel ? activeController.selectionPreview.actions : []
  const rollActionForBowl =
    canUseActionPanel
      ? actionPanelPreparedActions.find((action) => action.intent === 'roll-dice') ?? null
      : null
  const actionPanelHint = online.mode === 'match' && !online.isSynchronized
    ? '正在恢复连接并同步牌局，请稍候再出牌。'
    : activeController.isTrickReviewing
    ? '本回合出牌已完成，停留 2 秒方便看清牌面。'
    : activeController.isOpeningCeremonyActive
      ? '正在洗牌抓牌，抓完后只亮你的手牌。'
    : activeController.isDiceReviewing
      ? '骰子正在滚动并展示结果，稍等一下看清点数。'
    : rollActionForBowl
      ? '点右上角的碗掷骰。'
    : canUseActionPanel
      ? describeTurnSelection(currentRound, activeController.selectionPreview)
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
    online.mode === 'offline' &&
    isCurrentMatchScored &&
    activeLocalUserId &&
    currentRound?.phase === 'playing'
      ? `${activeLocalUserId}:${currentMatchState?.matchId}:${currentRound.roundNumber}`
      : null
  const shouldWarnBeforeLeavingScoredRound = Boolean(activeScoredRoundKey)

  const settlementPersistence = useSettlementPersistence({
    match: currentMatchState,
    userId: activeLocalUserId,
    enabled: isCurrentMatchScored && online.mode === 'offline',
    record: localPlayerData.recordSettledRound,
  })

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
    () => currentMatchState?.seatConfigs ?? [],
    [currentMatchState?.seatConfigs],
  )

  /**
   * 联机视角中只有界面座位 0 代表当前本机玩家，不能把本机钱包分数显示到其他真人头像上。
   */
  function getVisibleSeatScore(seat: SeatId): number {
    const localScore = online.mode === 'match' && seat !== 0 ? null : activeLocalScore
    return currentMatchState ? getTableDisplayScore(currentMatchState, seat, localScore) : 0
  }

  const drawerMeta = useMemo(() => {
    if (!currentRound || !currentMatchState) {
      return null
    }

    return createGameDrawerMeta({
      drawerState,
      round: currentRound,
      matchState: currentMatchState,
      cardDefinitions: cardDefinitionMap,
      seatConfigs: displaySeatConfigs,
      onSelectTrick: (trickIndex) => setDrawerState({ type: 'trick', trickIndex }),
    })
  }, [cardDefinitionMap, currentMatchState, currentRound, displaySeatConfigs, drawerState])

  /**
   * 判断菜单离开是否要走内部确认。只有正在进行的普通积分局才扣系统防刷牌分，
   * 定制牌局、结算页、联机对局和未加载本地用户时都直接执行原菜单动作。
   * 联机中途重开由房主在房间页控制，牌桌菜单不弹本地扣分确认。
   */
  function shouldConfirmMenuLeave(): boolean {
    if (online.mode !== 'offline') {
      return false
    }

    return isCurrentMatchScored && currentRound?.phase === 'playing' && Boolean(activeLocalUserId)
  }

  /**
   * 真正执行菜单动作。这里不负责扣分，只做牌桌状态切换，
   * 这样确认弹窗、免确认场景和后续扩展动作都能复用。
   * @param action 已通过上层确认或落账门禁的离局操作。
   */
  function executeMenuLeaveAction(action: LeaveConfirmAction): void {
    // 联机模式没有本地扣分逻辑；重开走联机重开，返回走联机离开。
    if (online.mode !== 'offline') {
      if (action === 'restart-round') {
        setIsCurrentMatchScored(true)
        online.startMatch()
        return
      }

      online.leaveOnlineMode()
      return
    }

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
   * 牌桌菜单动作入口。未完成的积分局先确认扣分，结算局先完成落账。
   * @param action 玩家申请的离局操作。
   */
  function requestMenuLeave(action: LeaveConfirmAction): void {
    // 菜单和结算按钮必须共用落账门禁，避免从菜单绕过保存失败提示。
    if (currentRound?.phase === 'settled' && online.mode === 'offline') {
      void settlementPersistence.persistAndRun(() => executeMenuLeaveAction(action))
      return
    }

    if (!shouldConfirmMenuLeave()) {
      executeMenuLeaveAction(action)
      return
    }

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
   * @returns 离局处理完成；写入失败时保留结算页并提示重试。
   */
  async function restartMatchFromSettlement(): Promise<void> {
    if (online.mode === 'match') {
      online.leaveOnlineMode()
      return
    }

    await settlementPersistence.persistAndRun(() => {
      setIsCurrentMatchScored(true)
      activeController.restartMatch()
    })
  }

  /**
   * 结算页继续下一局也要先完成本局落账，避免连续开局时漏记积分。
   * @returns 下一局申请处理完成；写入失败时不推进牌局。
   */
  async function startNextRoundFromSettlement(): Promise<void> {
    if (online.mode === 'match') {
      if (online.isHost) {
        online.startMatch()
      }
      return
    }

    await settlementPersistence.persistAndRun(() => activeController.startRound())
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
      <OnlineBrowserPanel
        connectionStatus={online.connectionStatus}
        rooms={online.roomList}
        loading={online.isRoomListLoading}
        playerName={browserPlayerName}
        error={online.error}
        onPlayerNameChange={setBrowserPlayerName}
        onCreateRoom={() => online.createRoomFromBrowser(browserPlayerName)}
        onJoinRoom={(roomCode) => online.joinRoomFromBrowser(roomCode, browserPlayerName)}
        onBack={online.exitBrowser}
      />
    )
  }

  if (online.mode === 'lobby' && online.room && online.player) {
    return (
      <OnlineRoomPanel
        room={online.room}
        playerSeat={online.player.seat}
        isHost={online.isHost}
        connectionStatus={online.connectionStatus}
        notice={online.notice}
        error={online.error}
        botNames={online.botNames}
        onSaveBotNames={online.saveBotNames}
        onStartMatch={online.startMatch}
        onLeaveRoom={online.leaveRoomToBrowser}
      />
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

        {online.mode === 'match' && online.room ? (
          <div className="online-table-status" aria-live="polite">
            <span>房间 {online.room.roomCode}</span>
            <strong className={`online-table-status__connection online-table-status__connection--${online.connectionStatus}`}>
              <i aria-hidden="true" />
              {online.connectionStatus !== 'connected' ? '正在重连' : online.isSynchronized ? '已连接' : '正在同步'}
            </strong>
          </div>
        ) : null}

        {online.mode === 'match' && (online.error || online.notice) ? (
          <p className="table-connection-notice" role={online.error ? 'alert' : 'status'}>
            {online.error ?? online.notice}
          </p>
        ) : null}

        <TableMenu
          onSettings={() => setIsSettingsOpen(true)}
          onHelp={() => setIsHelpOpen(true)}
          onLeave={requestMenuLeave}
          canRestart={online.mode !== 'match' || (online.isHost && online.isSynchronized && currentRound.phase === 'settled')}
        />

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
              score={getVisibleSeatScore(2)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 2 })}
            />
          </div>
          <div className="table-surface__west">
            <SeatPanel
              seatState={currentRound.seats[3]}
              isCurrent={activeController.currentSeat === 3}
              isDealer={currentRound.firstLeader === 3}
              score={getVisibleSeatScore(3)}
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
              score={getVisibleSeatScore(1)}
              onInspectWonTricks={() => setDrawerState({ type: 'seat', seat: 1 })}
            />
          </div>
          <div className="table-surface__south">
            <SeatPanel
              seatState={currentRound.seats[0]}
              isCurrent={activeController.currentSeat === 0}
              isDealer={currentRound.firstLeader === 0}
              score={getVisibleSeatScore(0)}
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
          onHelp={() => setIsHelpOpen(true)}
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

        <LeaveConfirmDialog
          state={leaveConfirmState}
          error={leaveConfirmError}
          submitting={isLeavePenaltySubmitting}
          onCancel={cancelMenuLeave}
          onConfirm={() => void confirmMenuLeaveWithPenalty()}
        />
      </section>

      <div className="table-footer">
        <SettlementPanel
          round={currentRound}
          seatConfigs={displaySeatConfigs}
          saving={settlementPersistence.isSaving}
          saveError={settlementPersistence.error}
          onRetrySave={() => { void settlementPersistence.retry() }}
          onInspectHistory={() => setDrawerState({ type: 'history' })}
          onNextRound={startNextRoundFromSettlement}
          canStartNextRound={online.mode !== 'match' || (online.isHost && online.isSynchronized)}
          onRestartMatch={restartMatchFromSettlement}
        />
      </div>

      <GameHelpPanel
        open={isHelpOpen}
        round={currentRound}
        ruleSet={activeController.ruleSet}
        seat={activeController.visibleActionSeatState?.seat ?? 0}
        hint={actionPanelHint}
        canInteract={canUseActionPanel}
        practice={online.mode === 'offline' && !isCurrentMatchScored}
        onSelect={activeController.setSelectedCardIds}
        onClose={() => setIsHelpOpen(false)}
      />
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
