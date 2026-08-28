import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

import {
  clearOnlineSession,
  createMatchStateForViewer,
  mapSeatFromViewer,
  OnlineClient,
  readOnlineSession,
  saveOnlineSession,
} from '@/services/online/OnlineClient'
import type {
  OnlineClientStatus,
  OnlineSessionSnapshot,
} from '@/services/online/OnlineClient'
import type {
  OnlinePlayer,
  OnlineRoomState,
  OnlineServerMessage,
} from '@/services/online/types'
import type {
  MatchState,
  PreparedAction,
  RoundState,
  SeatId,
} from '@/rules-core/types'

/** 大厅等待开始时的机器人默认名字。 */
const DEFAULT_BOT_NAMES = ['村里的阿明', '村里的老周', '村里的细妹']

/** 联机界面所处阶段。 */
export type OnlineMode = 'offline' | 'lobby' | 'match'

/**
 * 根据当前页面地址推导 WebSocket 地址，支持 Vite 代理和同域名部署。
 *
 * @returns 例如 wss://game9.qdkl.cn/ws。
 */
function createWebSocketUrl(): string {
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

/**
 * 从服务端消息提取完整房间和牌局快照。
 *
 * @param message 服务端消息。
 * @returns 能提取时返回快照，否则返回 null。
 */
function readRoomSnapshot(message: OnlineServerMessage): {
  room: OnlineRoomState
  state: MatchState
} | null {
  if (
    message.type === 'room-created' ||
    message.type === 'room-joined' ||
    message.type === 'room-resumed'
  ) {
    return {
      room: message.room,
      state: message.state,
    }
  }

  if (message.type === 'room-state') {
    return {
      room: message.room,
      state: message.state,
    }
  }

  return null
}

/**
 * 联机控制器桥接 WebSocket 客户端和现有牌桌 UI。
 *
 * @param fallbackPlayerName 本地玩家昵称，作为创建或加入时的默认名字。
 * @returns 联机阶段状态和操作函数。
 */
export function useOnlineController(fallbackPlayerName = '玩家') {
  const latestServerStateRef = useRef<MatchState | null>(null)
  const pendingOpeningRoundRef = useRef<RoundState | null>(null)
  const [client] = useState(() => new OnlineClient(createWebSocketUrl()))
  const [mode, setMode] = useState<OnlineMode>('offline')
  const [connectionStatus, setConnectionStatus] = useState<OnlineClientStatus>(client.status)
  const [session, setSession] = useState<OnlineSessionSnapshot | null>(() => readOnlineSession())
  const [player, setPlayer] = useState<OnlinePlayer | null>(null)
  const [room, setRoom] = useState<OnlineRoomState | null>(null)
  const [botNames, setBotNames] = useState<string[]>(DEFAULT_BOT_NAMES)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [matchState, setMatchState] = useState<MatchState | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [isOpeningCeremonyVisible, setIsOpeningCeremonyVisible] = useState(false)
  const lastSeenRoundNumberRef = useRef(0)

  /**
   * 将服务端状态转换成当前玩家视角。
   *
   * @param nextState 服务端状态。
   * @param viewerSeat 当前玩家座位。
   */
  const applyViewerState = useEffectEvent((nextState: MatchState, viewerSeat: SeatId) => {
    latestServerStateRef.current = structuredClone(nextState)
    setMatchState(createMatchStateForViewer(nextState, viewerSeat))
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
      applyViewerState(message.state, message.player.seat)
      setMode(message.state.currentRound && message.room.isPlaying ? 'match' : 'lobby')
      return
    }

    if (message.type === 'match-state') {
      if (player) {
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

    if (message.type === 'error') {
      setError(message.message)

      if (message.code === 'seat-token-invalid') {
        clearOnlineSession()
        setSession(null)
        setPlayer(null)
        setRoom(null)
        setMatchState(null)
        setMode('offline')
      }
    }
  })

  /**
   * 连接恢复后自动恢复已保存座位。
   */
  const handleConnectionStatus = useEffectEvent((status: OnlineClientStatus) => {
    setConnectionStatus(status)

    if (status === 'connected' && session) {
      client.resumeRoom(session)
    }
  })

  useEffect(() => {
    const unsubscribeMessage = client.onMessage(handleServerMessage)
    const unsubscribeStatus = client.onStatus(handleConnectionStatus)
    client.connect()

    return () => {
      unsubscribeMessage()
      unsubscribeStatus()
    }
  }, [client])

  /**
   * 移动端切后台后 WebSocket 可能被系统断开；回到页面时立即拉取最新状态。
   */
  useEffect(() => {
    function refreshAfterVisible(): void {
      if (document.visibilityState === 'visible' && player) {
        client.refreshRoom(player.token)
      }
    }

    document.addEventListener('visibilitychange', refreshAfterVisible)

    return () => {
      document.removeEventListener('visibilitychange', refreshAfterVisible)
    }
  }, [client, player])

  /**
   * 每个玩家在新一局开局时播放同一段仪式；断线重连不重复打断当前局。
   */
  useEffect(() => {
    const round = matchState?.currentRound

    if (!round) {
      setIsOpeningCeremonyVisible(false)
      pendingOpeningRoundRef.current = null
      return
    }

    if (round.roundNumber <= lastSeenRoundNumberRef.current) {
      return
    }

    lastSeenRoundNumberRef.current = round.roundNumber
    pendingOpeningRoundRef.current = structuredClone(round)
    setSelectedCardIds([])
    setIsOpeningCeremonyVisible(true)
  }, [matchState])

  /**
   * 允许当前真人座位选牌。
   *
   * @param cardId 被点选的牌实例 ID。
   */
  const toggleCardSelection = useCallback((cardId: string) => {
    const currentRound = matchState?.currentRound

    if (!currentRound || currentRound.currentSeat === null || isOpeningCeremonyVisible) {
      return
    }

    setSelectedCardIds((previousCardIds) =>
      previousCardIds.includes(cardId)
        ? previousCardIds.filter((currentCardId) => currentCardId !== cardId)
        : [...previousCardIds, cardId],
    )
  }, [isOpeningCeremonyVisible, matchState])

  /**
   * 联机第一版拖拽只作为手势反馈，真实牌序仍以规则层为准。
   *
   * @param nextCardIds 拖拽后的界面牌序。
   */
  function reorderCurrentHand(nextCardIds: string[]): void {
    setSelectedCardIds((previousCardIds) =>
      nextCardIds.filter((cardId) => previousCardIds.includes(cardId)),
    )
  }

  /**
   * 手动触发一次界面理牌反馈。
   */
  function organizeHumanHand(): void {
    setSelectedCardIds((previousCardIds) => [...previousCardIds])
  }

  /**
   * 创建新房间。
   *
   * @param playerName 创建者名字。
   */
  function createRoom(playerName: string): void {
    setError(null)
    client.createRoom(playerName.trim() || fallbackPlayerName)
  }

  /**
   * 加入房间。
   *
   * @param roomCode 房间码。
   * @param playerName 加入者名字。
   */
  function joinRoom(roomCode: string, playerName: string): void {
    setError(null)
    client.joinRoom(roomCode, playerName.trim() || fallbackPlayerName)
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
      client.configureBots(player.token, botNames)
      client.startMatch(player.token)
    }
  }, [botNames, client, player])

  /**
   * 把界面动作座位转换回服务端座位后提交。
   *
   * @param action 当前玩家看到的动作。
   */
  const submitViewerAction = useCallback((action: PreparedAction) => {
    const currentSeat = matchState?.currentRound?.currentSeat

    if (!player) {
      return
    }

    if (currentSeat === null || currentSeat === undefined) {
      return
    }

    client.submitAction(player.token, {
      seat: mapSeatFromViewer(currentSeat, player.seat),
      intent: action.intent,
      selectedCardIds: action.selectedCardIds,
    })
  }, [client, matchState, player])

  /**
   * 当前玩家请求统一翻开背面弃牌。服务端只需要一个合法座位触发。
   */
  function finishRoundAndReveal(): void {
    if (!player || latestServerStateRef.current?.currentRound?.phase !== 'awaiting-reveal') {
      return
    }

    client.submitAction(player.token, {
      seat: 0,
      intent: 'respond-pass-hidden',
      selectedCardIds: [],
    })
  }

  /**
   * 派生成现有牌桌 UI 能直接使用的控制器形态。
   */
  const controller = useMemo(() => {
    const currentRound = matchState?.currentRound ?? null
    const currentSeat = currentRound?.currentSeat ?? null
    const currentSeatState = currentRound && currentSeat !== null
      ? currentRound.seats.find((seatState) => seatState.seat === currentSeat) ?? null
      : null
    const humanSeatState = currentRound?.seats.find((seatState) =>
      seatState.seat === 0) ?? null

    return {
      matchState,
      currentRound,
      currentSeat,
      currentSeatState,
      currentHandCards: currentSeatState?.hand ?? [],
      humanSeatState,
      visibleActionSeatState: currentSeatState,
      visibleActionHandCards: currentSeatState?.hand ?? [],
      reviewTrick: null,
      openingCeremony: null,
      isOpeningCeremonyActive: isOpeningCeremonyVisible,
      isTrickReviewing: false,
      isDiceReviewing: false,
      selectionPreview: currentRound && currentSeat !== null
        ? jiAnDaSuoZiRuleSet.previewSelection(currentRound, currentSeat, selectedCardIds)
        : {
            selectedCardIds,
            actions: [] as PreparedAction[],
            hint: '等待开局。',
          },
      selectedCardIds,
      isHandOrganizing: false,
      ruleSet: jiAnDaSuoZiRuleSet,
      replayState: null,
      toggleCardSelection,
      reorderCurrentHand,
      organizeHumanHand,
      setSelectedCardIds,
      submitPreparedAction: submitViewerAction,
      startRound: startMatch,
      restartMatch: startMatch,
      finishOpeningCeremony: () => setIsOpeningCeremonyVisible(false),
    }
  }, [
    isOpeningCeremonyVisible,
    matchState,
    selectedCardIds,
    startMatch,
    submitViewerAction,
    toggleCardSelection,
  ])

  return {
    mode,
    connectionStatus,
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
    saveBotNames,
    startMatch,
    submitViewerAction,
    finishRoundAndReveal,
    leaveOnlineMode: clearOnlineSession,
    rulesRevision: '2026-08-28-online-v1',
  }
}

export type OnlineController = ReturnType<typeof useOnlineController>
