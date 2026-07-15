import type {
  BotDecisionContext,
  BotObservation,
  BotObservedCurrentTrick,
  BotObservedPlay,
  BotObservedTrick,
  BotPublicPattern,
  CardInstance,
  DiceCeremony,
  DiceRoll,
  PendingDiceChoice,
  PlayPattern,
  PreparedAction,
  RoundState,
  SeatId,
} from '@/rules-core/types'

/**
 * 复制一张机器人有权看到的牌实例，避免策略修改规则引擎内部状态引用。
 *
 * @param card 自己手牌或已经正面公开的牌实例。
 * @returns 与规则状态断开引用的新牌实例。
 */
function cloneVisibleCard(card: CardInstance): CardInstance {
  return { ...card }
}

/**
 * 复制公开骰子结果，确保观察对象不会与规则引擎运行态共享引用。
 *
 * @param roll 已经公开的骰子结果。
 * @returns 可安全交给机器人读取的骰子结果副本。
 */
function cloneDiceRoll(roll: DiceRoll): DiceRoll {
  return { ...roll }
}

/**
 * 将完整牌型投影成机器人可见的公开牌型。
 * 暗牌来源即使误传到本函数，也会被直接拒绝，避免 cardDefinitionIds 泄露暗牌身份。
 *
 * @param pattern 规则引擎保存的完整牌型。
 * @returns 正面公开牌型的脱敏副本；暗牌返回 null。
 */
function createPublicPattern(pattern: PlayPattern): BotPublicPattern | null {
  if (!pattern.isOpen || pattern.source === 'hidden') {
    return null
  }

  return {
    label: pattern.label,
    kind: pattern.kind,
    group: pattern.group,
    cardDefinitionIds: [...pattern.cardDefinitionIds],
    cardCount: pattern.cardCount,
    strength: pattern.strength,
    source: pattern.source,
    door: pattern.door,
    rewardMode: pattern.rewardMode,
  }
}

/**
 * 将规则引擎出牌记录转换成机器人可见记录。
 * 只有牌型本身为明牌且已经翻开时才复制牌面；暗牌始终只保留座位和张数。
 *
 * @param play 完整出牌记录。
 * @returns 不包含暗牌牌面、实例 id 或隐藏牌型身份的观察记录。
 */
function createObservedPlay(
  play: RoundState['publicTrickLog'][number]['plays'][number],
): BotObservedPlay {
  const publicPattern = play.revealed ? createPublicPattern(play.pattern) : null

  return {
    seat: play.seat,
    revealed: publicPattern !== null,
    cardCount: play.pattern.cardCount,
    publicPattern,
    publicCards: publicPattern ? play.cards.map(cloneVisibleCard) : [],
  }
}

/**
 * 将已完成墩转换成仅包含桌面公开信息的机器人观察记录。
 *
 * @param trick 规则引擎保存的完整墩记录。
 * @returns 已剥离所有暗牌身份的墩记录。
 */
function createObservedTrick(
  trick: RoundState['publicTrickLog'][number],
): BotObservedTrick {
  return {
    trickIndex: trick.trickIndex,
    leader: trick.leader,
    winner: trick.winner,
    cardCount: trick.cardCount,
    visibleWinningSeat: trick.visibleWinningSeat,
    forcedDoor: trick.forcedDoor,
    plays: trick.plays.map(createObservedPlay),
    rewardOwner: trick.rewardOwner,
    rewardMode: trick.rewardMode,
    rewardWasEaten: trick.rewardWasEaten,
    rewardWasLastTwo: trick.rewardWasLastTwo,
  }
}

/**
 * 将当前未完成墩转换成机器人可见状态。
 * 当前目标牌型只有在正面公开时才保留，暗领时固定返回 null。
 *
 * @param currentTrick 规则引擎当前未完成墩。
 * @returns 脱敏后的当前墩观察；尚未开墩时返回 null。
 */
function createObservedCurrentTrick(
  currentTrick: RoundState['currentTrick'],
): BotObservedCurrentTrick | null {
  if (!currentTrick) {
    return null
  }

  return {
    trickIndex: currentTrick.trickIndex,
    leader: currentTrick.leader,
    expectedCardCount: currentTrick.expectedCardCount,
    plays: currentTrick.plays.map(createObservedPlay),
    currentWinningSeat: currentTrick.currentWinningSeat,
    currentTargetPattern: currentTrick.currentTargetPattern
      ? createPublicPattern(currentTrick.currentTargetPattern)
      : null,
    forcedDoor: currentTrick.forcedDoor,
    responseSeat: currentTrick.responseSeat,
    isHiddenLead: currentTrick.isHiddenLead,
    rewardOwner: currentTrick.rewardOwner,
    rewardMode: currentTrick.rewardMode,
    rewardWasLastTwo: currentTrick.rewardWasLastTwo,
  }
}

/**
 * 复制公开掷骰仪式，包含首轮可能存在的两次骰子结果。
 *
 * @param ceremony 当前局的公开掷骰仪式。
 * @returns 与规则状态断开引用的仪式副本。
 */
function cloneDiceCeremony(ceremony: DiceCeremony): DiceCeremony {
  return {
    ...ceremony,
    roll: cloneDiceRoll(ceremony.roll),
    firstRoll: ceremony.firstRoll ? cloneDiceRoll(ceremony.firstRoll) : undefined,
    secondRoll: ceremony.secondRoll ? cloneDiceRoll(ceremony.secondRoll) : undefined,
  }
}

/**
 * 复制当前公开的骰子待选择状态。
 *
 * @param pendingDice 规则引擎中的骰子待选择状态。
 * @returns 可安全读取的状态副本；当前没有骰子选择时返回 null。
 */
function clonePendingDice(pendingDice: PendingDiceChoice | null): PendingDiceChoice | null {
  if (!pendingDice) {
    return null
  }

  return {
    ...pendingDice,
    roll: cloneDiceRoll(pendingDice.roll),
  }
}

/**
 * 从完整单局状态构造机器人唯一允许读取的脱敏观察。
 * 自己手牌会完整复制；其他座位只保留剩余张数、赢墩数和已赢回合数，
 * 已完成墩与当前墩中的暗牌也只保留张数，不保留任何牌面或实例信息。
 *
 * @param round 规则引擎内部的完整单局状态，仅允许在观察构造边界内读取。
 * @param seat 即将决策的机器人座位。
 * @returns 与完整 RoundState 断开引用的机器人观察。
 */
export function createBotObservation(round: RoundState, seat: SeatId): BotObservation {
  const selfSeatState = round.seats.find((seatState) => seatState.seat === seat)

  if (!selfSeatState) {
    throw new Error(`无法为不存在的座位 ${seat} 构造机器人观察。`)
  }

  return {
    seat,
    self: {
      seat,
      hand: selfSeatState.hand.map(cloneVisibleCard),
      wonPierCount: selfSeatState.wonPierCount,
      wonTrickCount: selfSeatState.wonTricks.length,
    },
    opponents: round.seats
      .filter((seatState) => seatState.seat !== seat)
      .map((seatState) => ({
        seat: seatState.seat,
        remainingCardCount: seatState.hand.length,
        wonPierCount: seatState.wonPierCount,
        wonTrickCount: seatState.wonTricks.length,
      })),
    round: {
      roundNumber: round.roundNumber,
      phase: round.phase,
      currentSeat: round.currentSeat,
      firstLeader: round.firstLeader,
      lastTrickWinner: round.lastTrickWinner,
      ceremony: cloneDiceCeremony(round.ceremony),
      currentTrick: createObservedCurrentTrick(round.currentTrick),
      pendingDice: clonePendingDice(round.pendingDice),
      lastDiceRoll: round.lastDiceRoll ? cloneDiceRoll(round.lastDiceRoll) : undefined,
      publicTrickLog: round.publicTrickLog.map(createObservedTrick),
      hiddenPlaysPendingReveal: round.hiddenPlaysPendingReveal,
      rewardOutcome: round.rewardOutcome ? { ...round.rewardOutcome } : undefined,
    },
  }
}

/**
 * 构造一次机器人决策上下文，并复制合法动作以阻止策略修改规则引擎返回值。
 * 该函数是完整 RoundState 进入机器人模块的唯一边界，策略实现只能接收返回的脱敏对象。
 *
 * @param round 规则引擎内部的完整单局状态。
 * @param seat 当前需要决策的机器人座位。
 * @param legalActions 规则引擎为该座位枚举出的全部合法动作。
 * @returns 只含脱敏观察和合法动作副本的决策上下文。
 */
export function createBotDecisionContext(
  round: RoundState,
  seat: SeatId,
  legalActions: PreparedAction[],
): BotDecisionContext {
  return {
    observation: createBotObservation(round, seat),
    legalActions: legalActions.map((action) => ({
      ...action,
      selectedCardIds: [...action.selectedCardIds],
    })),
  }
}
