import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { OnlineClient, type OnlineClientStatus } from '@/services/online/OnlineClient'
import { DEFAULT_BOT_NAMES, orderHandBySavedIds, createWebSocketUrl, readRoomSnapshot, type OnlineMode } from '@/app/onlineControllerSupport'
import { createMatchStateForViewer } from '@/services/online/viewerState'
import { hasOnlineConsent, useOnlineConsent } from '@/app/useOnlineConsent'
import { useOnlineReadiness } from '@/app/useOnlineReadiness'

import { arrangeJiAnDaSuoZiHandIds } from '@/rules-variants/ji-an-da-suo-zi/handArrangement'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

import {
  clearOnlineSession,
  readOnlineSession,
  saveOnlineSession,
} from '@/services/online/onlineSession'
import type {
  OnlineSessionSnapshot,
} from '@/services/online/onlineSession'
import type {
  OnlinePlayer,
  OnlineRoomSummary,
  OnlineRoomState,
  OnlineServerMessage,
} from '@/services/online/types'
import type {
  MatchState,
  PreparedAction,
  RoundState,
  SeatId,
} from '@/rules-core/types'

/**
 * 联机控制器桥接 WebSocket 客户端和现有牌桌 UI。
 *
 * @param fallbackPlayerName 本地玩家昵称，作为创建或加入时的默认名字。
 * @returns 联机阶段状态和操作函数。
 */
export function useOnlineController(fallbackPlayerName = '玩家') {
  /** 只接收当前仍等待恢复的身份；主动离局后拒绝迟到的恢复快照。 */
  const resumingTokenRef = useRef<string | null>(null)
  const latestRevisionRef = useRef(0)
  const activeRoomCodeRef = useRef<string | null>(null)
  const consent = useOnlineConsent()
  const [client] = useState(() => new OnlineClient(createWebSocketUrl()))
  const readiness = useOnlineReadiness(client)
  const resetReadiness = readiness.reset
  const [mode, setMode] = useState<OnlineMode>('offline')
  const [roomList, setRoomList] = useState<OnlineRoomSummary[]>([])
  const [isRoomListLoading, setIsRoomListLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<OnlineClientStatus>(client.status)
  const [session, setSession] = useState<OnlineSessionSnapshot | null>(() => readOnlineSession())
  const [player, setPlayer] = useState<OnlinePlayer | null>(null)
  const [room, setRoom] = useState<OnlineRoomState | null>(null)
  const [botNames, setBotNames] = useState<string[]>(DEFAULT_BOT_NAMES)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [matchState, setMatchState] = useState<MatchState | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  /**
   * 联机本地手牌顺序：座位号 -> 牌实例 ID 数组。
   * 服务端状态只保存牌实例，界面排序属于纯展示，不回传服务端。
   */
  const [handOrder, setHandOrder] = useState<Partial<Record<SeatId, string[]>>>({})
  const [isHandOrganizing, setIsHandOrganizing] = useState(false)
  const organizeAnimationTimerRef = useRef<number | null>(null)
  const [isOpeningCeremonyVisible, setIsOpeningCeremonyVisible] = useState(false)
  const lastSeenRoundNumberRef = useRef(0)

  /**
   * 联机开局仪式快照。
   * 服务端已经开始真实牌局；这里只保留一份不改动的牌局数据，供动画层播放，关闭后再解锁出牌。
   */
  const [openingCeremony, setOpeningCeremony] = useState<RoundState | null>(null)

  /**
   * 接受同一房间内不小于当前版本的快照；切换房间时重新开始计数。
   *
   * @param roomCode 消息所属房间。
   * @param revision 服务端状态版本。
   * @returns 是否应继续应用该消息。
   */
  function acceptServerRevision(roomCode: string, revision: number): boolean {
    if (activeRoomCodeRef.current !== roomCode) {
      activeRoomCodeRef.current = roomCode
      latestRevisionRef.current = revision
      return true
    }

    if (revision < latestRevisionRef.current) {
      return false
    }

    latestRevisionRef.current = revision
    return true
  }

  /**
   * 将服务端状态转换成当前玩家视角。
   *
   * @param nextState 服务端状态。
   * @param viewerSeat 当前玩家座位。
   */
  const applyViewerState = useEffectEvent((nextState: MatchState, viewerSeat: SeatId) => {
    // 服务端状态推进后，界面上的旧选牌必然失效；同步清空避免残留引用崩溃。
    setSelectedCardIds([])
    setMatchState(createMatchStateForViewer(nextState, viewerSeat))
  })

  /**
   * 关闭联机开局仪式并清空快照，避免新牌局开始后继续占用旧引用。
   */
  const finishOpeningCeremony = useEffectEvent(() => {
    setSelectedCardIds([])
    setOpeningCeremony(null)
    setIsOpeningCeremonyVisible(false)
  })

  /**
   * 统一处理房间快照，并判断是否已经进入牌桌。
   *
   * @param snapshot 服务端房间和牌局快照。
   */
  const applyRoomSnapshot = useEffectEvent((snapshot: {
    room: OnlineRoomState
    state: MatchState
  }) => {
    if (!acceptServerRevision(snapshot.room.roomCode, snapshot.room.revision)) {
      return
    }

    setRoom(snapshot.room)

    if (!player) {
      return
    }

    applyViewerState(snapshot.state, player.seat)

    if (snapshot.state.currentRound && snapshot.room.isPlaying) {
      setMode('match')
      return
    }

    setMode('lobby')
  })

  /**
   * 处理所有服务端消息。
   *
   * @param message 服务端消息。
   */
  const handleServerMessage = useEffectEvent((message: OnlineServerMessage) => {
    if (message.type === 'room-resumed' && message.player.token !== resumingTokenRef.current) {
      return
    }
    const roomSnapshot = readRoomSnapshot(message)

    if (roomSnapshot) {
      applyRoomSnapshot(roomSnapshot)
    }

    if (
      message.type === 'room-created' ||
      message.type === 'room-joined' ||
      message.type === 'room-resumed'
    ) {
      const nextSession: OnlineSessionSnapshot = {
        roomCode: message.roomCode,
        playerToken: message.player.token,
        playerName: message.player.name,
        seat: message.player.seat,
      }
      setPlayer(message.player)
      setSession(nextSession)
      saveOnlineSession(nextSession)
      setError(null)
      readiness.finish()
      applyViewerState(message.state, message.player.seat)
      setMode(message.state.currentRound && message.room.isPlaying ? 'match' : 'lobby')
      return
    }

    if (message.type === 'match-state') {
      if (player && acceptServerRevision(message.roomCode, message.revision)) {
        setError(null)
        applyViewerState(message.state, player.seat)
      }
      return
    }

    if (message.type === 'player-disconnected') {
      setNotice(`${message.name} 暂时断线，座位会保留三分钟。`)
      return
    }

    if (message.type === 'player-reconnected') {
      setNotice(`${message.name} 已重新连接。`)
      return
    }

    if (message.type === 'host-changed') {
      setNotice(`房主已转移给 ${message.name}。`)
      return
    }

    if (message.type === 'error') {
      setError(message.message)

      if (message.code === 'seat-token-invalid' || message.code === 'protocol-mismatch') {
        readiness.reset()
        clearOnlineSession()
        setSession(null)
        setPlayer(null)
        setRoom(null)
        setMatchState(null)
        setMode('offline')
        activeRoomCodeRef.current = null
        latestRevisionRef.current = 0
      }
    }

    if (message.type === 'room-list') {
      setRoomList(message.rooms)
      setIsRoomListLoading(false)
    }
  })

  /**
   * 连接恢复后自动恢复已保存座位。
   */
  const handleConnectionStatus = useEffectEvent((status: OnlineClientStatus) => {
    setConnectionStatus(status)

    readiness.reset()
    resumingTokenRef.current = null
    if (status === 'connected' && session) {
      readiness.begin()
      resumingTokenRef.current = session.playerToken
      client.resumeRoom(session)
    }
  })

  useEffect(() => {
    const unsubscribeMessage = client.onMessage(handleServerMessage)
    const unsubscribeStatus = client.onStatus(handleConnectionStatus)
    // 只有已确认说明且确有待恢复座位时才自动建连；首次首页和单机不接触服务器。
    if (hasOnlineConsent() && readOnlineSession()) client.connect()

    return () => {
      unsubscribeMessage()
      unsubscribeStatus()
      client.disconnect()
    }
  }, [client])

  /** 房间座位变化后从服务端快照同步机器人名称，真人座位不进入编辑列表。 */
  useEffect(() => {
    if (!room || room.isPlaying) {
      return
    }

    const humanSeats = new Set(room.players.map((roomPlayer) => roomPlayer.seat))
    setBotNames(room.seatConfigs
      .filter((seatConfig) => !humanSeats.has(seatConfig.seat))
      .map((seatConfig) => seatConfig.name))
  }, [room])

  /**
   * 大厅页打开时每 3 秒刷新一次房间列表，离开页面或隐藏时停止。
   */
  useEffect(() => {
    if (mode !== 'browser') {
      return
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        client.requestRoomList()
      }
    }, 3000)

    return () => {
      window.clearInterval(timer)
    }
  }, [client, mode])

  /**
   * 移动端切后台后连接可能处于半开状态；回到页面时重新握手恢复身份与牌局。
   */
  useEffect(() => {
    function refreshAfterVisible(): void {
      if (document.visibilityState === 'visible' && player) {
        // 前台恢复时重新握手并获取身份快照，不能仅向可能半开的旧连接发送查询。
        resetReadiness()
        client.reconnect()
      }
    }

    document.addEventListener('visibilitychange', refreshAfterVisible)

    return () => {
      document.removeEventListener('visibilitychange', refreshAfterVisible)
    }
  }, [client, player, resetReadiness])

  /** 恢复连接和房主变更只短暂提示，避免通知长时间占据牌桌。 */
  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 6_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** 组件卸载或离开页面时清理理牌动画计时器，避免卸载后继续写 React 状态。 */
  useEffect(() => {
    return () => {
      if (organizeAnimationTimerRef.current !== null) {
        window.clearTimeout(organizeAnimationTimerRef.current)
      }
    }
  }, [])

  /**
   * 每个玩家在新一局开局时播放同一段仪式；断线重连不重复打断当前局。
   */
  useEffect(() => {
    const round = matchState?.currentRound

    if (!round) {
      setIsOpeningCeremonyVisible(false)
      return
    }

    if (round.roundNumber <= lastSeenRoundNumberRef.current) {
      return
    }

    lastSeenRoundNumberRef.current = round.roundNumber
    setSelectedCardIds([])

    // 仪式必须使用当前玩家的座位视角，否则动画里的庄家和抓牌方向会指向别人。
    setOpeningCeremony(round)
    setIsOpeningCeremonyVisible(true)
  }, [matchState])

  /**
   * 允许当前真人座位选牌。
   *
   * @param cardId 被点选的牌实例 ID。
   */
  const toggleCardSelection = useCallback((cardId: string) => {
    const currentRound = matchState?.currentRound

    if (!currentRound || currentRound.phase !== 'playing' || !player) {
      return
    }

    // 只有轮到自己时才允许选牌，避免机器人代打后残留旧选牌。
    if (currentRound.currentSeat !== 0 || isOpeningCeremonyVisible) {
      return
    }

    setSelectedCardIds((previousCardIds) =>
      previousCardIds.includes(cardId)
        ? previousCardIds.filter((currentCardId) => currentCardId !== cardId)
        : [...previousCardIds, cardId],
    )
  }, [isOpeningCeremonyVisible, matchState, player])

  /**
   * 联机第一版拖拽只作为手势反馈，真实牌序仍以规则层为准。
   *
   * @param nextCardIds 拖拽后的界面牌序。
   */
  const reorderCurrentHand = useCallback((nextCardIds: string[]) => {
    if (!matchState?.currentRound || !player) {
      return
    }

    setHandOrder((previousOrder) => ({
      ...previousOrder,
      0: nextCardIds,
    }))
    setSelectedCardIds((previousCardIds) =>
      nextCardIds.filter((cardId) => previousCardIds.includes(cardId)),
    )
  }, [matchState, player])

  /**
   * 手动触发一次界面理牌反馈。
   */
  const organizeHumanHand = useCallback(() => {
    const currentRound = matchState?.currentRound

    if (!currentRound || !player) {
      return
    }

    const seatState = currentRound.seats.find((seat) => seat.seat === 0)

    if (!seatState || seatState.hand.length <= 1) {
      return
    }

    const nextOrder = arrangeJiAnDaSuoZiHandIds(seatState.hand)
    setHandOrder((previousOrder) => ({
      ...previousOrder,
      0: nextOrder,
    }))
    setIsHandOrganizing(true)

    if (organizeAnimationTimerRef.current !== null) {
      window.clearTimeout(organizeAnimationTimerRef.current)
    }

    organizeAnimationTimerRef.current = window.setTimeout(() => {
      setIsHandOrganizing(false)
      organizeAnimationTimerRef.current = null
    }, 900)
  }, [matchState, player])

  /**
   * 进入联机大厅页面。首次进入时立即拉取一次房间列表，之后由轮询定时刷新。
   */
  function enterBrowser(): void {
    consent.request(() => {
      setMode('browser')
      setIsRoomListLoading(true)
      client.connect()
      client.requestRoomList()
    })
  }

  /**
   * 离开联机大厅页面，回到首页。
   */
  function exitBrowser(): void {
    setMode('offline')
    client.disconnect()
    setRoomList([])
    setIsRoomListLoading(false)
  }

  /**
   * 在大厅页发起创建房间。
   *
   * @param playerName 创建者名字。
   */
  function createRoomFromBrowser(playerName: string): void {
    consent.request(() => {
      setError(null)
      client.connect()
      client.createRoom(playerName.trim() || fallbackPlayerName)
    })
  }

  /**
   * 在大厅页点击某个房间加入。
   *
   * @param roomCode 目标房间码。
   * @param playerName 加入者名字。
   */
  function joinRoomFromBrowser(roomCode: string, playerName: string): void {
    consent.request(() => {
      setError(null)
      client.connect()
      client.joinRoom(roomCode, playerName.trim() || fallbackPlayerName)
    })
  }

  /**
   * 创建新房间。
   *
   * @param playerName 创建者名字。
   */
  function createRoom(playerName: string): void {
    consent.request(() => {
      setError(null)
      client.connect()
      client.createRoom(playerName.trim() || fallbackPlayerName)
    })
  }

  /**
   * 加入房间。
   *
   * @param roomCode 房间码。
   * @param playerName 加入者名字。
   */
  function joinRoom(roomCode: string, playerName: string): void {
    consent.request(() => {
      setError(null)
      client.connect()
      client.joinRoom(roomCode, playerName.trim() || fallbackPlayerName)
    })
  }

  /**
   * 房主保存机器人名字。
   *
   * @param nextBotNames 三个机器人名字。
   */
  function saveBotNames(nextBotNames: string[]): void {
    setBotNames(nextBotNames)

    if (player?.token && room && !room.isPlaying) {
      client.configureBots(player.token, nextBotNames)
    }
  }

  /**
   * 房主开始新一局。
   */
  const startMatch = useCallback(() => {
    setError(null)

    if (player?.token) {
      if (client.status !== 'connected' || !readiness.isReady) {
        return
      }
      // 已开局后只请求下一局，不能再次发送仅大厅允许的改名请求。
      if (!room?.isPlaying) {
        client.configureBots(player.token, botNames)
      }
      client.startMatch(player.token)
    }
  }, [botNames, client, player, readiness.isReady, room?.isPlaying])

  /**
   * 主动离开联机房间。
   * 先通知服务端把座位交给机器人，再清掉本地会话和牌桌状态；回首页时停止网络连接。
   * @param targetMode 返回单机首页或联机大厅。
   */
  function leaveRoom(targetMode: OnlineMode = 'offline'): void {
    resumingTokenRef.current = null
    readiness.reset()
    if (player?.token) {
      client.leaveRoom(player.token)
    }

    clearOnlineSession()
    finishOpeningCeremony()
    setPlayer(null)
    setSession(null)
    setRoom(null)
    setMatchState(null)
    setSelectedCardIds([])
    setHandOrder({})
    activeRoomCodeRef.current = null
    latestRevisionRef.current = 0
    lastSeenRoundNumberRef.current = 0
    setMode(targetMode)
    // 明确回到单机后停止心跳；回联机大厅时保留连接供房间列表使用。
    if (targetMode === 'offline') client.disconnect()
  }

  /**
   * 把界面动作座位转换回服务端座位后提交。
   *
   * @param action 当前玩家看到的动作。
   */
  const submitViewerAction = useCallback((action: PreparedAction) => {
    const currentSeat = matchState?.currentRound?.currentSeat
    const currentPhase = matchState?.currentRound?.phase

    if (!player || client.status !== 'connected' || !readiness.isReady) {
      return
    }

    if (currentSeat !== 0) {
      return
    }

    // 机器人代打时服务端状态已推进，旧选牌动作可能已经失效；静默丢弃即可。
    if (currentPhase !== 'playing') {
      return
    }

    client.submitAction(player.token, {
      seat: player.seat,
      intent: action.intent,
      selectedCardIds: action.selectedCardIds,
    })
  }, [client, matchState, player, readiness.isReady])

  /**
   * 派生成现有牌桌 UI 能直接使用的控制器形态。
   */
  const controller = useMemo(() => {
    const currentRound = matchState?.currentRound ?? null
    const currentSeat = currentRound?.currentSeat ?? null
    const currentSeatState = currentRound && currentSeat !== null
      ? currentRound.seats.find((seatState) => seatState.seat === currentSeat) ?? null
      : null
    /*
     * 服务端状态使用真实座位，但客户端 createMatchStateForViewer 会把当前玩家
     * 重排成 UI 底部座位 0。这里必须统一在客户端视角座位列表里找自己，
     * 否则座位 1/2/3 的玩家会误用服务端座位号查找，导致手牌永远是空。
     */
    const humanSeatState = player && currentRound
      ? currentRound.seats.find((seatState) => seatState.seat === 0) ?? null
      : null
    const humanHandCards = humanSeatState
      ? orderHandBySavedIds(handOrder[0], humanSeatState.hand)
      : []
    /*
     * 底部操作面板永远展示"自己视角"：
     * - 自己回合：显示自己的座位和手牌（服务端已保证只有自己座位带牌）。
     * - 他人回合：仍显示自己的座位和手牌，但按钮不可用（canUseActionPanel 由 App 层控制）。
     * 不再回落到"当前出牌座位的手牌"，那会导致看到别人的牌。
     */
    const visibleActionSeatState = humanSeatState ?? currentSeatState
    const visibleHandCards = humanHandCards

    return {
      matchState,
      currentRound,
      currentSeat,
      currentSeatState,
      currentHandCards: humanHandCards,
      humanSeatState,
      visibleActionSeatState,
      visibleActionHandCards: visibleHandCards,
      reviewTrick: null,
      openingCeremony: openingCeremony
        ? {
            roundNumber: openingCeremony.roundNumber,
            dealerSeat: openingCeremony.firstLeader,
            round: openingCeremony,
          }
        : null,
      isOpeningCeremonyActive: isOpeningCeremonyVisible,
      isTrickReviewing: false,
      isDiceReviewing: false,
      /*
       * 选牌预览必须基于"自己的座位"而不是"当前出牌座位"。
       * 否则别人出牌时，自己点牌会被 previewSelection 判成"不是你的回合"而没有任何按钮。
       */
      selectionPreview: currentRound && humanSeatState
        ? jiAnDaSuoZiRuleSet.previewSelection(currentRound, humanSeatState.seat, selectedCardIds)
        : {
            selectedCardIds,
            actions: [] as PreparedAction[],
            hint: '等待开局。',
          },
      selectedCardIds,
      isHandOrganizing,
      ruleSet: jiAnDaSuoZiRuleSet,
      replayState: null,
      toggleCardSelection,
      reorderCurrentHand,
      organizeHumanHand,
      setSelectedCardIds,
      submitPreparedAction: submitViewerAction,
      startRound: startMatch,
      restartMatch: startMatch,
      finishOpeningCeremony: finishOpeningCeremony,
    }
  }, [handOrder, openingCeremony, isHandOrganizing, isOpeningCeremonyVisible, matchState, player, selectedCardIds, startMatch, submitViewerAction, toggleCardSelection, reorderCurrentHand, organizeHumanHand])

  return {
    consent,
    mode,
    roomList,
    isRoomListLoading,
    connectionStatus,
    isSynchronized: readiness.isReady,
    session,
    player,
    room,
    botNames,
    error,
    notice,
    controller,
    isOpeningCeremonyVisible,
    createRoom,
    joinRoom,
    enterBrowser,
    exitBrowser,
    createRoomFromBrowser,
    joinRoomFromBrowser,
    saveBotNames,
    startMatch,
    submitViewerAction,
    leaveOnlineMode: () => leaveRoom('offline'),
    leaveRoomToBrowser: () => leaveRoom('browser'),
    isHost: Boolean(player && room && player.seat === room.hostSeat),
    rulesRevision: '2026-08-28-online-v1',
  }
}

export type OnlineController = ReturnType<typeof useOnlineController>
