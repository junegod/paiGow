import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'

import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'
import { DEFAULT_SEAT_CONFIGS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { RULE_ENGINE_REVISION } from '@/rules-variants/ji-an-da-suo-zi/engine'
import { arrangeJiAnDaSuoZiHandIds } from '@/rules-variants/ji-an-da-suo-zi/handArrangement'
import { DICE_TOTAL_DISPLAY_MS } from '@/ui/diceTiming'
import type {
  CardInstance,
  MatchState,
  PreparedAction,
  RoundState,
  SeatConfig,
  SeatId,
  SeatState,
  StartRoundOptions,
  TrickRecord,
} from '@/rules-core/types'

const COMPLETED_TRICK_REVIEW_MS = 2000
const HAND_AUTO_ORGANIZE_DELAY_MS = 220
const HAND_ORGANIZE_ANIMATION_MS = 720

interface OpeningCeremonyState {
  /** 当前仪式对应的局号，用来让动画组件在每一局重新播放。 */
  roundNumber: number
  /** 庄家就是本局先抓牌的人，也就是规则层的 firstLeader。 */
  dealerSeat: SeatId
  /** 动画使用的规则快照，避免播放过程中 React 状态变化导致仪式画面跳动。 */
  round: RoundState
}

/**
 * 判断两个字符串数组是否完全一致，用于避免拖拽排序时产生无意义重渲染。
 */
function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/**
 * 将已有手牌顺序与当前真实手牌对齐：保留仍在手中的牌序，补入新出现的牌，
 * 并清理已经打出的牌，保证 UI 排序永远不会脱离规则层真实手牌。
 */
function reconcileHandOrder(
  previousCardIds: string[] | undefined,
  hand: CardInstance[],
): string[] {
  const currentCardIds = hand.map((card) => card.id)
  const currentCardIdSet = new Set(currentCardIds)
  const preservedCardIds = (previousCardIds ?? []).filter((cardId) => currentCardIdSet.has(cardId))
  const preservedCardIdSet = new Set(preservedCardIds)
  const appendedCardIds = currentCardIds.filter((cardId) => !preservedCardIdSet.has(cardId))

  return [...preservedCardIds, ...appendedCardIds]
}

/**
 * 按 UI 保存的手牌顺序返回牌对象；若顺序缺失，则回落到规则层原始顺序。
 */
function orderHandCards(hand: CardInstance[], orderedCardIds: string[] | undefined): CardInstance[] {
  if (!orderedCardIds) {
    return hand
  }

  const orderIndexMap = new Map(orderedCardIds.map((cardId, index) => [cardId, index]))

  return [...hand].sort((leftCard, rightCard) => {
    const leftIndex = orderIndexMap.get(leftCard.id) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = orderIndexMap.get(rightCard.id) ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex
  })
}

/**
 * 按座位运行态读取 UI 保存的手牌顺序。底部手牌可能展示的不是当前行动位，
 * 因此需要把“当前行动手牌”和“底部玩家常驻手牌”共用同一套排序逻辑。
 */
function orderSeatStateHand(
  seatState: SeatState | null,
  handOrderBySeat: Partial<Record<SeatId, string[]>>,
): CardInstance[] {
  if (!seatState) {
    return []
  }

  return orderHandCards(seatState.hand, handOrderBySeat[seatState.seat])
}

/**
 * 前端控制器负责把 mock 服务桥接到 React 状态，并管理单真人对机器人模式。
 */
export function useGameController() {
  const apiRef = useRef(new MockMatchApi())
  const [matchState, setMatchState] = useState<MatchState>(() => apiRef.current.getState())
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [handOrderBySeat, setHandOrderBySeat] = useState<Partial<Record<SeatId, string[]>>>({})
  const [isHandOrganizing, setIsHandOrganizing] = useState(false)
  const [reviewTrick, setReviewTrick] = useState<TrickRecord | null>(null)
  const [diceReviewKey, setDiceReviewKey] = useState<string | null>(null)
  const [openingCeremony, setOpeningCeremony] = useState<OpeningCeremonyState | null>(null)
  const reviewTimerRef = useRef<number | null>(null)
  const diceReviewTimerRef = useRef<number | null>(null)
  const handOrganizeTimerRef = useRef<number | null>(null)
  const handOrganizeAnimationTimerRef = useRef<number | null>(null)
  const lastReviewTrickKeyRef = useRef<string | null>(null)

  const currentRound = matchState.currentRound
  const publicTrickLogLength = currentRound?.publicTrickLog.length ?? 0
  const reviewTrickKey =
    currentRound && reviewTrick
      ? `${currentRound.roundNumber}:${reviewTrick.trickIndex}`
      : null
  const latestPublicTrick =
    currentRound && publicTrickLogLength > 0
      ? currentRound.publicTrickLog[publicTrickLogLength - 1]
      : null
  const latestPublicTrickKey =
    currentRound && latestPublicTrick
      ? `${currentRound.roundNumber}:${latestPublicTrick.trickIndex}`
      : null
  const pendingDiceReviewKey = currentRound?.pendingDice
    ? [
        currentRound.roundNumber,
        currentRound.pendingDice.seat,
        publicTrickLogLength,
        currentRound.pendingDice.roll.first,
        currentRound.pendingDice.roll.second,
        currentRound.pendingDice.roll.key,
      ].join(':')
    : null
  const isTrickReviewing = Boolean(
    reviewTrick &&
    currentRound &&
    reviewTrickKey === latestPublicTrickKey &&
    !currentRound.currentTrick,
  )
  const isDiceReviewing = Boolean(
    pendingDiceReviewKey &&
    diceReviewKey === pendingDiceReviewKey,
  )
  const currentSeat = currentRound?.currentSeat ?? null
  const currentSeatState =
    currentRound && currentSeat !== null
      ? currentRound.seats.find((seatState) => seatState.seat === currentSeat) ?? null
      : null
  const southSeatState = currentRound?.seats.find((seatState) => seatState.seat === 0) ?? null
  const humanSeatState = currentRound?.seats.find((seatState) => seatState.config.mode === 'human') ?? null
  const currentHandSignature = currentSeatState?.hand.map((card) => card.id).join('|') ?? ''
  const humanHandSignature = humanSeatState?.hand.map((card) => card.id).join('|') ?? ''

  const syncState = useEffectEvent((nextState: MatchState) => {
    startTransition(() => {
      setMatchState(nextState)
    })
    setSelectedCardIds([])
  })

  const runApiAction = useEffectEvent((producer: () => MatchState) => {
    syncState(producer())
  })

  /**
   * 记录刚刚结算完成的一墩，并保留 2 秒给玩家看清四家出牌。
   */
  function holdCompletedTrickForReview(round: NonNullable<MatchState['currentRound']>): void {
    const latestTrick = round.publicTrickLog[round.publicTrickLog.length - 1]

    if (!latestTrick) {
      return
    }

    const nextReviewKey = `${round.roundNumber}:${latestTrick.trickIndex}`

    if (lastReviewTrickKeyRef.current === nextReviewKey) {
      return
    }

    lastReviewTrickKeyRef.current = nextReviewKey
    setReviewTrick(latestTrick)

    if (reviewTimerRef.current !== null) {
      window.clearTimeout(reviewTimerRef.current)
    }

    reviewTimerRef.current = window.setTimeout(() => {
      setReviewTrick((previousTrick) => {
        if (!previousTrick || lastReviewTrickKeyRef.current !== nextReviewKey) {
          return previousTrick
        }

        return null
      })
      reviewTimerRef.current = null
    }, COMPLETED_TRICK_REVIEW_MS)
  }

  /**
   * 清理理牌相关计时器。开新局、返回首页或组件卸载时调用，
   * 防止上一局延迟理牌误改到下一局手牌。
   */
  function clearHandOrganizeTimers(): void {
    if (handOrganizeTimerRef.current !== null) {
      window.clearTimeout(handOrganizeTimerRef.current)
      handOrganizeTimerRef.current = null
    }

    if (handOrganizeAnimationTimerRef.current !== null) {
      window.clearTimeout(handOrganizeAnimationTimerRef.current)
      handOrganizeAnimationTimerRef.current = null
    }
  }

  /**
   * 给指定座位应用吉安打索子的理牌顺序。这里仅调整 UI 顺序，
   * 不修改规则层真实手牌，因此不会影响出牌合法性判断。
   */
  function organizeSeatHand(seatState: SeatState): void {
    if (seatState.hand.length <= 1) {
      return
    }

    const nextOrder = arrangeJiAnDaSuoZiHandIds(seatState.hand)

    setHandOrderBySeat((previousOrderBySeat) => {
      const previousOrder = previousOrderBySeat[seatState.seat]

      if (previousOrder && areStringArraysEqual(previousOrder, nextOrder)) {
        return previousOrderBySeat
      }

      return {
        ...previousOrderBySeat,
        [seatState.seat]: nextOrder,
      }
    })

    setIsHandOrganizing(true)

    if (handOrganizeAnimationTimerRef.current !== null) {
      window.clearTimeout(handOrganizeAnimationTimerRef.current)
    }

    handOrganizeAnimationTimerRef.current = window.setTimeout(() => {
      setIsHandOrganizing(false)
      handOrganizeAnimationTimerRef.current = null
    }, HAND_ORGANIZE_ANIMATION_MS)
  }

  /**
   * 当前版本固定只有一个真人玩家。手动整理按钮和开局自动整理都调用这里，
   * 后续多人或联机时可以把 seat 参数开放出去。
   */
  function organizeHumanHand(): void {
    if (!humanSeatState || openingCeremony) {
      return
    }

    organizeSeatHand(humanSeatState)
  }

  /**
   * 开发期 Vite 热更新会保留 React hook 状态，导致旧 MockMatchApi 实例继续按旧规则走牌。
   * 规则版本变化时直接重建 mock 服务并回到首页，确保浏览器里的自动机器人使用最新规则。
   */
  useEffect(() => {
    if (apiRef.current.rulesRevision === RULE_ENGINE_REVISION) {
      return
    }

    apiRef.current = new MockMatchApi()
    syncState(apiRef.current.getState())
  }, [])

  useEffect(() => {
    if (currentRound?.phase !== 'playing' || currentSeat === null || !currentSeatState) {
      return
    }

    if (openingCeremony || isTrickReviewing || isDiceReviewing) {
      return
    }

    if (currentSeatState.config.mode !== 'bot') {
      return
    }

    const timerId = window.setTimeout(() => {
      runApiAction(() => apiRef.current.requestBotMove())
    }, 500)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [
    currentRound?.phase,
    currentRound?.pendingDice?.roll.key,
    currentRound?.currentTrick?.plays.length,
    currentSeat,
    currentSeatState,
    isDiceReviewing,
    isTrickReviewing,
    openingCeremony,
  ])

  useEffect(() => {
    if (!pendingDiceReviewKey) {
      if (diceReviewTimerRef.current !== null) {
        window.clearTimeout(diceReviewTimerRef.current)
        diceReviewTimerRef.current = null
      }

      setDiceReviewKey(null)
      return
    }

    setDiceReviewKey(pendingDiceReviewKey)

    if (diceReviewTimerRef.current !== null) {
      window.clearTimeout(diceReviewTimerRef.current)
    }

    diceReviewTimerRef.current = window.setTimeout(() => {
      setDiceReviewKey((previousKey) =>
        previousKey === pendingDiceReviewKey ? null : previousKey,
      )
      diceReviewTimerRef.current = null
    }, DICE_TOTAL_DISPLAY_MS)

    return () => {
      if (diceReviewTimerRef.current !== null) {
        window.clearTimeout(diceReviewTimerRef.current)
        diceReviewTimerRef.current = null
      }
    }
  }, [pendingDiceReviewKey])

  useEffect(() => {
    if (currentRound?.phase !== 'awaiting-reveal') {
      return
    }

    const timerId = window.setTimeout(() => {
      runApiAction(() => apiRef.current.finishRoundAndReveal())
    }, COMPLETED_TRICK_REVIEW_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [currentRound?.phase])

  useEffect(() => {
    if (!currentRound) {
      setReviewTrick(null)
      lastReviewTrickKeyRef.current = null
      return
    }

    if (currentRound.currentTrick || currentRound.publicTrickLog.length === 0) {
      return
    }

    holdCompletedTrickForReview(currentRound)
  }, [currentRound])

  useEffect(() => {
    return () => {
      if (reviewTimerRef.current !== null) {
        window.clearTimeout(reviewTimerRef.current)
      }

      if (diceReviewTimerRef.current !== null) {
        window.clearTimeout(diceReviewTimerRef.current)
      }

      clearHandOrganizeTimers()
    }
  }, [])

  useEffect(() => {
    setSelectedCardIds([])
  }, [currentSeat, currentRound?.currentTrick?.trickIndex, currentRound?.pendingDice?.roll.key])

  useEffect(() => {
    if (!currentSeatState) {
      return
    }

    setHandOrderBySeat((previousOrderBySeat) => {
      const previousOrder = previousOrderBySeat[currentSeatState.seat]
      const nextOrder = reconcileHandOrder(previousOrder, currentSeatState.hand)

      if (previousOrder && areStringArraysEqual(previousOrder, nextOrder)) {
        return previousOrderBySeat
      }

      return {
        ...previousOrderBySeat,
        [currentSeatState.seat]: nextOrder,
      }
    })
  }, [currentHandSignature, currentSeatState])

  useEffect(() => {
    if (!humanSeatState) {
      return
    }

    setHandOrderBySeat((previousOrderBySeat) => {
      const previousOrder = previousOrderBySeat[humanSeatState.seat]
      const nextOrder = reconcileHandOrder(previousOrder, humanSeatState.hand)

      if (previousOrder && areStringArraysEqual(previousOrder, nextOrder)) {
        return previousOrderBySeat
      }

      return {
        ...previousOrderBySeat,
        [humanSeatState.seat]: nextOrder,
      }
    })
  }, [humanHandSignature, humanSeatState])

  const currentHandCards = useMemo(() => {
    return orderSeatStateHand(currentSeatState, handOrderBySeat)
  }, [currentSeatState, handOrderBySeat])

  const southHandCards = useMemo(() => {
    return orderSeatStateHand(southSeatState, handOrderBySeat)
  }, [southSeatState, handOrderBySeat])

  const humanHandCards = useMemo(() => {
    return orderSeatStateHand(humanSeatState, handOrderBySeat)
  }, [humanSeatState, handOrderBySeat])

  const visibleActionSeatState =
    currentSeatState?.config.mode === 'human'
      ? currentSeatState
      : humanSeatState
  const visibleActionHandCards =
    visibleActionSeatState?.seat === currentSeatState?.seat
      ? currentHandCards
      : visibleActionSeatState?.seat === 0
        ? southHandCards
        : humanHandCards

  const selectionPreview = useMemo(() => {
    if (!currentRound || currentSeat === null || !currentSeatState) {
      return {
        selectedCardIds: [],
        actions: [] as PreparedAction[],
        hint: '先开始一局，再进行操作。',
      }
    }

    if (currentSeatState.config.mode === 'bot') {
      return {
        selectedCardIds,
        actions: [],
        hint: `${currentSeatState.config.name} 正在自动操作。`,
      }
    }

    return apiRef.current.previewSelection(currentSeat, selectedCardIds)
  }, [currentRound, currentSeat, currentSeatState, selectedCardIds])

  /**
   * 只允许当前真人座位切换选牌；机器人行动时手牌可看但不能误操作。
   */
  function toggleCardSelection(cardId: string): void {
    if (!currentRound || currentSeat === null || !currentSeatState || openingCeremony || isDiceReviewing) {
      return
    }

    if (currentSeatState.config.mode !== 'human') {
      return
    }

    setSelectedCardIds((previousCardIds) =>
      previousCardIds.includes(cardId)
        ? previousCardIds.filter((currentCardId) => currentCardId !== cardId)
        : [...previousCardIds, cardId],
    )
  }

  /**
   * 拖动手牌只调整当前玩家的本地显示顺序，不改规则层手牌对象。
   */
  function reorderCurrentHand(nextCardIds: string[]): void {
    if (!currentSeatState) {
      return
    }

    setHandOrderBySeat((previousOrderBySeat) => {
      const nextOrder = reconcileHandOrder(nextCardIds, currentSeatState.hand)
      const previousOrder = previousOrderBySeat[currentSeatState.seat]

      if (previousOrder && areStringArraysEqual(previousOrder, nextOrder)) {
        return previousOrderBySeat
      }

      return {
        ...previousOrderBySeat,
        [currentSeatState.seat]: nextOrder,
      }
    })
  }

  /**
   * 提交当前预备动作。
   */
  function submitPreparedAction(action: PreparedAction): void {
    if (currentSeat === null || openingCeremony || isDiceReviewing) {
      return
    }

    runApiAction(() =>
      apiRef.current.submitAction({
        seat: currentSeat,
        intent: action.intent,
        selectedCardIds: action.selectedCardIds,
      }),
    )
  }

  /**
   * 开始新一局或下一局时，清理本地手牌排序并把首页开局选项交给 mock 服务。
   */
  function startRound(options?: StartRoundOptions): void {
    clearHandOrganizeTimers()
    setIsHandOrganizing(false)
    setHandOrderBySeat({})
    setReviewTrick(null)
    setDiceReviewKey(null)
    lastReviewTrickKeyRef.current = null
    if (diceReviewTimerRef.current !== null) {
      window.clearTimeout(diceReviewTimerRef.current)
      diceReviewTimerRef.current = null
    }
    const nextState = apiRef.current.startRound(options)
    const nextRound = nextState.currentRound

    setOpeningCeremony(
      nextRound
        ? {
            roundNumber: nextRound.roundNumber,
            dealerSeat: nextRound.firstLeader,
            round: structuredClone(nextRound),
          }
        : null,
    )
    syncState(nextState)
  }

  /**
   * 重新开一场牌局，沿用当前座位配置。
   */
  function restartMatch(): void {
    clearHandOrganizeTimers()
    setIsHandOrganizing(false)
    setHandOrderBySeat({})
    setReviewTrick(null)
    setDiceReviewKey(null)
    lastReviewTrickKeyRef.current = null
    if (diceReviewTimerRef.current !== null) {
      window.clearTimeout(diceReviewTimerRef.current)
      diceReviewTimerRef.current = null
    }
    setOpeningCeremony(null)
    syncState(apiRef.current.createMatch())
  }

  /**
   * 开局仪式结束后放开真实牌局。机器人自动行动会在这个状态清空后继续。
   */
  function finishOpeningCeremony(): void {
    const humanSeatSnapshot = matchState.currentRound?.seats.find((seatState) =>
      seatState.config.mode === 'human') ?? null

    setOpeningCeremony(null)

    if (!humanSeatSnapshot) {
      return
    }

    clearHandOrganizeTimers()
    handOrganizeTimerRef.current = window.setTimeout(() => {
      organizeSeatHand(humanSeatSnapshot)
      handOrganizeTimerRef.current = null
    }, HAND_AUTO_ORGANIZE_DELAY_MS)
  }

  /**
   * 暴露给 UI 的一些便捷派生状态。
   */
  const controller = {
    matchState,
    currentRound,
    currentSeat,
    currentSeatState,
    currentHandCards,
    humanSeatState,
    visibleActionSeatState,
    visibleActionHandCards,
    reviewTrick,
    openingCeremony,
    isOpeningCeremonyActive: Boolean(openingCeremony),
    isTrickReviewing,
    isDiceReviewing,
    selectionPreview,
    selectedCardIds,
    isHandOrganizing,
    ruleSet: apiRef.current.getRuleSet(),
    replayState: apiRef.current.getReplayState(),
    toggleCardSelection,
    reorderCurrentHand,
    organizeHumanHand,
    setSelectedCardIds,
    submitPreparedAction,
    startRound,
    restartMatch,
    finishOpeningCeremony,
  }

  return controller
}

export type GameController = ReturnType<typeof useGameController>

/**
 * 导出默认座位模板，方便大厅页渲染固定顺序。
 */
export const DEFAULT_SEATS: SeatConfig[] = DEFAULT_SEAT_CONFIGS
