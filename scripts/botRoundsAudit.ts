import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { advanceSeat, countBy } from '@/rules-core/collections'
import { SeededRandom } from '@/rules-core/random'
import type {
  BotDifficulty,
  CardInstance,
  MatchState,
  PlayPattern,
  PreparedAction,
  RoundState,
  SeatConfig,
  SeatId,
  TrickRecord,
  TurnAction,
} from '@/rules-core/types'
import {
  createDeck,
  DEFAULT_SEAT_CONFIGS,
  getCardDefinition,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { getHeuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import { getSeatState } from '@/rules-variants/ji-an-da-suo-zi/engine'
import { LIVE_REWARD_EATERS } from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

interface BotAuditConfig {
  /** 本次审计要连续跑多少局机器人牌局。 */
  rounds: number
  /** 固定随机种子，保证发现的问题能复现到同一局同一手。 */
  seed: number
  /** 当前要审计的机器人难度；未传时保持兼容并使用标准档。 */
  difficulty?: BotDifficulty
  /** 审计产物目录，默认写入项目 artifacts/bot-audit。 */
  outputDir?: string
}

interface AuditError {
  /** 便于后续过滤的一致性错误编号。 */
  code: string
  /** 面向人阅读的问题说明。 */
  message: string
  /** 当前问题发生在哪一局。 */
  roundNumber: number
  /** 当前问题发生在第几次动作；非动作阶段用 0。 */
  step: number
  /** 额外上下文，尽量保留能复盘的最小信息。 */
  context?: Record<string, unknown>
}

interface AuditActionRecord {
  /** 当前局内第几步机器人动作。 */
  step: number
  /** 执行动作的座位。 */
  seat: SeatId
  /** 机器人最终提交给规则引擎的动作类型。 */
  intent: TurnAction['intent']
  /** 从合法动作列表中匹配到的按钮文案。 */
  label: string
  /** 本次动作实际使用的牌名，暗牌日志仅给审计看，不透出到 UI。 */
  cards: string[]
  /** 规则引擎返回的操作消息。 */
  messages: string[]
}

interface AuditRoundSummary {
  /** 当前局号。 */
  roundNumber: number
  /** 起手座位。 */
  firstLeader: SeatId
  /** 最后一墩赢家。 */
  lastTrickWinner: SeatId
  /** 每个座位最终赢墩数。 */
  wonPierCounts: number[]
  /** 本局完整回合数。 */
  trickCount: number
  /** 本局机器人动作数。 */
  actionCount: number
  /** 本局暗出次数，结算前必须仍为暗牌。 */
  hiddenPlayCount: number
  /** 本局赏出现次数，用于核查赏钱边界。 */
  rewardPlayCount: number
  /** 本局最终结算简述。 */
  settlementSummary: string
}

interface BotAuditReport {
  /** 审计配置。 */
  config: Required<BotAuditConfig>
  /** 每局的高层摘要。 */
  roundSummaries: AuditRoundSummary[]
  /** 所有审计发现的问题。 */
  errors: AuditError[]
  /** JSONL 过程日志文件路径。 */
  logPath: string
  /** JSON 汇总报告文件路径。 */
  summaryPath: string
}

const KNOWN_CARD_IDS = new Set(createDeck().map((card) => card.id))
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'artifacts/bot-audit')

/**
 * 创建四机器人座位配置，保证审计过程不被真人等待中断。
 */
function createBotSeatConfigs(): SeatConfig[] {
  return DEFAULT_SEAT_CONFIGS.map((seatConfig) => ({
    ...seatConfig,
    mode: 'bot',
  }))
}

/**
 * 取当前局状态；如果状态缺失，说明对局流程已经异常。
 */
function requireRound(match: MatchState): RoundState {
  if (!match.currentRound) {
    throw new Error('审计过程中缺少当前局状态。')
  }

  return match.currentRound
}

/**
 * 记录审计错误但不中断整局，除非后续规则引擎已经无法继续推进。
 */
function addError(
  errors: AuditError[],
  round: RoundState,
  step: number,
  code: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  errors.push({
    code,
    message,
    roundNumber: round.roundNumber,
    step,
    context,
  })
}

/**
 * 将牌实例转成可读名称，日志里同时保留副本序号，方便追踪重复牌。
 */
function formatCard(card: CardInstance): string {
  const definition = getCardDefinition(card.definitionId)
  return `${definition.name}#${card.copyIndex}`
}

/**
 * 判断两个动作是否是同一个合法动作；选牌顺序按规则引擎返回的顺序比较。
 */
function isSameAction(action: TurnAction, legalAction: PreparedAction): boolean {
  return (
    action.intent === legalAction.intent &&
    action.selectedCardIds.length === legalAction.selectedCardIds.length &&
    action.selectedCardIds.every((cardId, index) => cardId === legalAction.selectedCardIds[index])
  )
}

/**
 * 依据规则文档复核“candidate 是否能吃 target”，不调用引擎私有实现，避免自证。
 */
function canEatByAuditRule(target: PlayPattern, candidate: PlayPattern): boolean {
  if (!candidate.isOpen || candidate.cardCount !== target.cardCount) {
    return false
  }

  if (target.group === 'reward-live') {
    return (
      candidate.group === 'point-pair' &&
      LIVE_REWARD_EATERS.includes(candidate.cardDefinitionIds[0] ?? '')
    )
  }

  if (target.group === 'reward-dead' || target.group === 'hidden' || target.group === 'safe-singles') {
    return false
  }

  return candidate.group === target.group && candidate.strength > target.strength
}

/**
 * 卖屁股开墩时，领出牌背面不可比，但骰子定门仍然保留。
 * 后手只要明出该门单张，就能先成为本墩明面最大牌。
 */
function canEatForcedDoorByAuditRule(trick: TrickRecord, candidate: PlayPattern): boolean {
  return Boolean(
    trick.forcedDoor &&
    candidate.isOpen &&
    candidate.cardCount === 1 &&
    candidate.door === trick.forcedDoor,
  )
}

/**
 * 收集当前状态里真正占用牌堆的区域，排除 wonTricks 这种 publicTrickLog 的重复引用。
 */
function collectOwnedCards(round: RoundState): CardInstance[] {
  const handCards = round.seats.flatMap((seat) => seat.hand)
  const settledCards = round.publicTrickLog.flatMap((trick) =>
    trick.plays.flatMap((play) => play.cards),
  )
  const currentCards = round.currentTrick
    ? round.currentTrick.plays.flatMap((play) => play.cards)
    : []

  return [...handCards, ...settledCards, ...currentCards]
}

/**
 * 任意阶段都必须满足 32 张牌不丢、不重、不产生未知牌。
 */
function auditCardConservation(round: RoundState, step: number, errors: AuditError[]): void {
  const ownedCards = collectOwnedCards(round)
  const idCounts = countBy(ownedCards.map((card) => card.id))
  const duplicateIds = Object.entries(idCounts)
    .filter(([, count]) => count > 1)
    .map(([cardId]) => cardId)
  const missingIds = [...KNOWN_CARD_IDS].filter((cardId) => !idCounts[cardId])
  const unknownIds = ownedCards.map((card) => card.id).filter((cardId) => !KNOWN_CARD_IDS.has(cardId))

  if (ownedCards.length !== 32 || duplicateIds.length > 0 || missingIds.length > 0 || unknownIds.length > 0) {
    addError(errors, round, step, 'CARD_CONSERVATION', '牌堆守恒失败。', {
      ownedCount: ownedCards.length,
      duplicateIds,
      missingIds,
      unknownIds,
    })
  }
}

/**
 * 复核单个已结算回合：张数、座位顺序、吃牌比较、暗牌状态都必须满足规则。
 */
function auditTrickRecord(
  round: RoundState,
  step: number,
  trick: TrickRecord,
  beforeReveal: boolean,
  errors: AuditError[],
): void {
  if (trick.plays.length !== 4) {
    addError(errors, round, step, 'TRICK_PLAY_COUNT', '每回合必须四家都出牌。', {
      trickIndex: trick.trickIndex,
      playCount: trick.plays.length,
    })
  }

  let targetPattern = trick.plays[0]?.pattern.isOpen ? trick.plays[0].pattern : null
  let winner = trick.leader

  trick.plays.forEach((play, index) => {
    const expectedSeat = advanceSeat(trick.leader, index)

    if (play.seat !== expectedSeat) {
      addError(errors, round, step, 'TRICK_SEAT_ORDER', '出牌顺序必须从领出者开始顺时针推进。', {
        trickIndex: trick.trickIndex,
        index,
        expectedSeat,
        actualSeat: play.seat,
      })
    }

    if (play.cards.length !== trick.cardCount || play.pattern.cardCount !== trick.cardCount) {
      addError(errors, round, step, 'TRICK_CARD_COUNT', '同一回合每家必须出相同张数。', {
        trickIndex: trick.trickIndex,
        seat: play.seat,
        trickCardCount: trick.cardCount,
        actualCards: play.cards.length,
        patternCardCount: play.pattern.cardCount,
      })
    }

    if (!play.pattern.isOpen && beforeReveal && play.revealed) {
      addError(errors, round, step, 'HIDDEN_REVEALED_EARLY', '暗牌不能在整局结束前翻开。', {
        trickIndex: trick.trickIndex,
        seat: play.seat,
      })
    }

    if (index === 0 && !play.pattern.isOpen && (play.pattern.source !== 'dice' || play.cards.length !== 1)) {
      addError(errors, round, step, 'ILLEGAL_HIDDEN_LEAD', '领出暗牌只能是掷骰无门后的单张卖屁股。', {
        trickIndex: trick.trickIndex,
        source: play.pattern.source,
        cardCount: play.cards.length,
      })
    }

    if (index > 0 && play.pattern.isOpen) {
      if (!targetPattern && canEatForcedDoorByAuditRule(trick, play.pattern)) {
        targetPattern = play.pattern
        winner = play.seat
        return
      }

      if (!targetPattern || !canEatByAuditRule(targetPattern, play.pattern)) {
        addError(errors, round, step, 'ILLEGAL_EAT', '明吃必须同组同张数且牌力更大。', {
          trickIndex: trick.trickIndex,
          seat: play.seat,
          target: targetPattern?.label,
          candidate: play.pattern.label,
        })
      } else {
        targetPattern = play.pattern
        winner = play.seat
      }
    }
  })

  if (trick.winner !== winner) {
    addError(errors, round, step, 'TRICK_WINNER', '回合赢家与明面比较结果不一致。', {
      trickIndex: trick.trickIndex,
      expectedWinner: winner,
      actualWinner: trick.winner,
    })
  }
}

/**
 * 审计机器人选择前的合法动作列表，尤其关注活赏强制吃与掷骰定门。
 */
function auditLegalActions(
  round: RoundState,
  step: number,
  legalActions: PreparedAction[],
  errors: AuditError[],
): void {
  if (legalActions.length === 0) {
    addError(errors, round, step, 'NO_LEGAL_ACTION', '当前玩家没有任何合法动作。')
    return
  }

  if (round.pendingDice) {
    const invalidDiceActions = legalActions.filter((action) => {
      if (action.selectedCardIds.length !== 1) {
        return true
      }

      return round.pendingDice?.hasMatchingDoor
        ? action.intent !== 'resolve-dice-open'
        : action.intent !== 'resolve-dice-hidden'
    })

    if (invalidDiceActions.length > 0) {
      addError(errors, round, step, 'INVALID_DICE_ACTIONS', '掷骰定门后只能列出一张牌动作。', {
        labels: invalidDiceActions.map((action) => action.label),
      })
    }
  }

  if (round.currentTrick?.currentTargetPattern?.group === 'reward-live') {
    const hasEat = legalActions.some((action) => action.intent === 'respond-eat')
    const hasPass = legalActions.some((action) => action.intent === 'respond-pass-hidden')

    if (hasEat && hasPass) {
      addError(errors, round, step, 'LIVE_REWARD_MUST_EAT', '活赏有可吃对子时不能同时允许暗出。')
    }
  }
}

/**
 * 对机器人提交动作做额外复核，确认它确实来自规则引擎枚举的合法动作。
 */
function auditChosenAction(
  round: RoundState,
  step: number,
  action: TurnAction,
  legalActions: PreparedAction[],
  errors: AuditError[],
): PreparedAction {
  const matchedAction = legalActions.find((legalAction) => isSameAction(action, legalAction))

  if (!matchedAction) {
    addError(errors, round, step, 'BOT_ILLEGAL_ACTION', '机器人提交了不在合法动作列表里的动作。', {
      action,
      legalLabels: legalActions.map((legalAction) => legalAction.label),
    })
    throw new Error(`机器人非法动作：${action.intent}`)
  }

  return matchedAction
}

/**
 * 掷骰动作提交前后需要满足定门约束，尤其是有门必须明出、无门只能暗出一张。
 */
function auditDiceAction(
  beforeRound: RoundState,
  step: number,
  action: TurnAction,
  errors: AuditError[],
): void {
  if (!beforeRound.pendingDice) {
    return
  }

  const [selectedCardId] = action.selectedCardIds
  const seatState = getSeatState(beforeRound, beforeRound.pendingDice.seat)
  const selectedCard = seatState.hand.find((card) => card.id === selectedCardId)

  if (!selectedCard || action.selectedCardIds.length !== 1) {
    addError(errors, beforeRound, step, 'DICE_SELECTED_COUNT', '掷骰后必须且只能出一张手牌。', {
      selectedCardIds: action.selectedCardIds,
    })
    return
  }

  const selectedDoor = getCardDefinition(selectedCard.definitionId).door

  if (beforeRound.pendingDice.hasMatchingDoor && selectedDoor !== beforeRound.pendingDice.forcedDoor) {
    addError(errors, beforeRound, step, 'DICE_FORCED_DOOR', '掷骰有对应门类时必须出该门单张。', {
      forcedDoor: beforeRound.pendingDice.forcedDoor,
      selectedDoor,
    })
  }

  if (!beforeRound.pendingDice.hasMatchingDoor && action.intent !== 'resolve-dice-hidden') {
    addError(errors, beforeRound, step, 'DICE_NO_DOOR_HIDDEN', '掷骰无对应门类时只能卖屁股暗出。')
  }
}

/**
 * 审计一次动作推进后的全局状态，确保没有因为某个动作破坏牌局不变量。
 */
function auditAfterAction(
  beforeRound: RoundState,
  afterRound: RoundState,
  step: number,
  action: TurnAction,
  errors: AuditError[],
): void {
  auditCardConservation(afterRound, step, errors)
  auditDiceAction(beforeRound, step, action, errors)

  if (action.intent === 'respond-pass-hidden' && beforeRound.currentTrick) {
    if (action.selectedCardIds.length !== beforeRound.currentTrick.expectedCardCount) {
      addError(errors, beforeRound, step, 'PASS_HIDDEN_COUNT', '不吃暗出必须与当前回合张数相同。', {
        expected: beforeRound.currentTrick.expectedCardCount,
        actual: action.selectedCardIds.length,
      })
    }
  }

  afterRound.publicTrickLog.forEach((trick) =>
    auditTrickRecord(afterRound, step, trick, afterRound.phase !== 'settled', errors),
  )
}

/**
 * 整局结束但未翻牌时，所有暗牌都必须保持不可见。
 */
function auditBeforeReveal(round: RoundState, step: number, errors: AuditError[]): void {
  auditCardConservation(round, step, errors)

  round.publicTrickLog.forEach((trick) =>
    auditTrickRecord(round, step, trick, true, errors),
  )

  const hiddenPlays = round.publicTrickLog.flatMap((trick) =>
    trick.plays.filter((play) => !play.pattern.isOpen),
  )
  const revealedEarlyCount = hiddenPlays.filter((play) => play.revealed).length

  if (revealedEarlyCount > 0) {
    addError(errors, round, step, 'HIDDEN_BEFORE_REVEAL', '结算前存在提前翻开的暗牌。', {
      revealedEarlyCount,
    })
  }
}

/**
 * 整局翻牌结算后，复核墩数、暗牌揭示、结算零和与收分人。
 */
function auditSettledRound(round: RoundState, step: number, errors: AuditError[]): void {
  auditCardConservation(round, step, errors)

  const wonPierTotal = round.seats.reduce((total, seat) => total + seat.wonPierCount, 0)
  const trickPierTotal = round.publicTrickLog.reduce((total, trick) => total + trick.cardCount, 0)

  if (wonPierTotal !== 8 || trickPierTotal !== 8) {
    addError(errors, round, step, 'PIER_TOTAL', '整局墩数合计必须为 8。', {
      wonPierTotal,
      trickPierTotal,
    })
  }

  round.publicTrickLog.forEach((trick) =>
    auditTrickRecord(round, step, trick, false, errors),
  )

  const unrevealedHiddenCount = round.publicTrickLog
    .flatMap((trick) => trick.plays)
    .filter((play) => !play.pattern.isOpen && !play.revealed).length

  if (unrevealedHiddenCount > 0 || round.hiddenPlaysPendingReveal !== 0) {
    addError(errors, round, step, 'HIDDEN_AFTER_REVEAL', '整局结束后所有暗牌都必须统一翻开。', {
      unrevealedHiddenCount,
      hiddenPlaysPendingReveal: round.hiddenPlaysPendingReveal,
    })
  }

  const settlement = round.settlement

  if (!settlement) {
    addError(errors, round, step, 'MISSING_SETTLEMENT', '整局翻牌后缺少结算结果。')
    return
  }

  const totalDelta = settlement.seats.reduce((total, seat) => total + seat.totalDelta, 0)

  if (totalDelta !== 0) {
    addError(errors, round, step, 'SETTLEMENT_ZERO_SUM', '结算分数必须零和。', {
      totalDelta,
    })
  }

  if (round.lastTrickWinner === undefined || settlement.collector !== round.lastTrickWinner) {
    addError(errors, round, step, 'SETTLEMENT_COLLECTOR', '最后一墩赢家必须是基础分收分人。', {
      lastTrickWinner: round.lastTrickWinner,
      collector: settlement.collector,
    })
  }
}

/**
 * 将当前动作压缩成 JSONL 过程日志，后续可以直接定位到局、手、牌。
 */
function createActionRecord(
  step: number,
  seat: SeatId,
  action: TurnAction,
  legalAction: PreparedAction,
  beforeRound: RoundState,
  messages: string[],
): AuditActionRecord {
  const seatState = getSeatState(beforeRound, seat)
  const cards = action.selectedCardIds.map((cardId) => {
    const card = seatState.hand.find((handCard) => handCard.id === cardId)
    return card ? formatCard(card) : cardId
  })

  return {
    step,
    seat,
    intent: action.intent,
    label: legalAction.label,
    cards,
    messages,
  }
}

/**
 * 汇总单局关键信息，给最终报告和人工复盘使用。
 */
function createRoundSummary(round: RoundState, actionCount: number): AuditRoundSummary {
  const hiddenPlayCount = round.publicTrickLog
    .flatMap((trick) => trick.plays)
    .filter((play) => !play.pattern.isOpen).length
  const rewardPlayCount = round.publicTrickLog
    .flatMap((trick) => trick.plays)
    .filter((play) => play.pattern.group === 'reward-live' || play.pattern.group === 'reward-dead')
    .length

  if (round.lastTrickWinner === undefined || !round.settlement) {
    throw new Error('创建局摘要前必须已经完成结算。')
  }

  return {
    roundNumber: round.roundNumber,
    firstLeader: round.firstLeader,
    lastTrickWinner: round.lastTrickWinner,
    wonPierCounts: round.seats.map((seat) => seat.wonPierCount),
    trickCount: round.publicTrickLog.length,
    actionCount,
    hiddenPlayCount,
    rewardPlayCount,
    settlementSummary: round.settlement.summary,
  }
}

/**
 * 写入 JSONL 与 JSON 总结产物；JSONL 保存完整动作过程，JSON 保存汇总和错误。
 */
async function writeAuditArtifacts(
  outputDir: string,
  report: Omit<BotAuditReport, 'logPath' | 'summaryPath'>,
  logLines: string[],
): Promise<Pick<BotAuditReport, 'logPath' | 'summaryPath'>> {
  await mkdir(outputDir, { recursive: true })

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const logPath = path.join(outputDir, `${stamp}-100-rounds.jsonl`)
  const summaryPath = path.join(outputDir, `${stamp}-summary.json`)

  await writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8')
  await writeFile(summaryPath, `${JSON.stringify({ ...report, logPath, summaryPath }, null, 2)}\n`, 'utf8')

  return { logPath, summaryPath }
}

/**
 * 连续运行四机器人牌局并按规则文档做自审计。
 */
export async function runBotRoundsAudit(config: BotAuditConfig): Promise<BotAuditReport> {
  const normalizedConfig: Required<BotAuditConfig> = {
    difficulty: config.difficulty ?? 'standard',
    outputDir: config.outputDir ?? DEFAULT_OUTPUT_DIR,
    rounds: config.rounds,
    seed: config.seed,
  }
  const rng = new SeededRandom(normalizedConfig.seed)
  const errors: AuditError[] = []
  const roundSummaries: AuditRoundSummary[] = []
  const logLines: string[] = []
  let match = jiAnDaSuoZiRuleSet.createMatch(normalizedConfig.seed, createBotSeatConfigs())

  for (let roundIndex = 0; roundIndex < normalizedConfig.rounds; roundIndex += 1) {
    match = jiAnDaSuoZiRuleSet.startRound(match, rng).match
    let actionCount = 0
    let settled = false

    logLines.push(JSON.stringify({
      type: 'round-start',
      difficulty: normalizedConfig.difficulty,
      roundNumber: requireRound(match).roundNumber,
      firstLeader: requireRound(match).firstLeader,
      ceremony: requireRound(match).ceremony,
    }))

    for (let step = 1; step <= 320; step += 1) {
      const round = requireRound(match)

      if (round.phase === 'awaiting-reveal') {
        auditBeforeReveal(round, step, errors)
        match = jiAnDaSuoZiRuleSet.finishRoundAndReveal(match).match
        const settledRound = requireRound(match)
        auditSettledRound(settledRound, step, errors)
        roundSummaries.push(createRoundSummary(settledRound, actionCount))
        logLines.push(JSON.stringify({
          type: 'round-settled',
          summary: roundSummaries.at(-1),
          settlement: settledRound.settlement,
        }))
        settled = true
        break
      }

      if (round.currentSeat === null) {
        addError(errors, round, step, 'MISSING_CURRENT_SEAT', '进行中牌局缺少当前操作座位。')
        break
      }

      auditCardConservation(round, step, errors)
      const legalActions = jiAnDaSuoZiRuleSet.listTurnActions(round, round.currentSeat)
      auditLegalActions(round, step, legalActions, errors)
      const decisionContext = createBotDecisionContext(
        round,
        round.currentSeat,
        legalActions,
      )
      const action = getHeuristicBotStrategy(normalizedConfig.difficulty).chooseAction(decisionContext)
      const legalAction = auditChosenAction(round, step, action, legalActions, errors)
      const beforeRound = structuredClone(round)
      const result = jiAnDaSuoZiRuleSet.submitAction(match, action, rng)
      match = result.match
      actionCount += 1
      const afterRound = requireRound(match)
      auditAfterAction(beforeRound, afterRound, step, action, errors)

      logLines.push(JSON.stringify({
        type: 'action',
        roundNumber: beforeRound.roundNumber,
        trickIndex: beforeRound.currentTrick?.trickIndex ?? beforeRound.publicTrickLog.length + 1,
        pendingDice: beforeRound.pendingDice,
        record: createActionRecord(step, action.seat, action, legalAction, beforeRound, result.messages),
      }))
    }

    if (!settled) {
      addError(errors, requireRound(match), actionCount, 'ROUND_NOT_SETTLED', '单局超过步数上限仍未结束。')
      break
    }
  }

  const partialReport = {
    config: normalizedConfig,
    roundSummaries,
    errors,
  }
  const paths = await writeAuditArtifacts(normalizedConfig.outputDir, partialReport, logLines)
  const report = {
    ...partialReport,
    ...paths,
  }

  if (errors.length > 0) {
    throw new Error(`机器人审计发现 ${errors.length} 个问题，详见 ${paths.summaryPath}`)
  }

  return report
}
