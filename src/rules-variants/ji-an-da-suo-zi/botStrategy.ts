import type {
  BotDecisionContext,
  BotDifficulty,
  BotStrategy,
  PreparedAction,
  TurnAction,
} from '@/rules-core/types'
import { scoreBotAction } from '@/rules-variants/ji-an-da-suo-zi/botStrategyScoring'

interface ScoredAction {
  /** 规则引擎为当前机器人生成的合法预备动作。 */
  action: PreparedAction
  /** 当前难度计算出的最终评分，分数越高越优先。 */
  score: number
}

/**
 * 将规则引擎生成的 PreparedAction 转换成最终 TurnAction。
 * 该函数只复制已选合法动作的意图和牌 id，不自行生成或修改动作内容。
 *
 * @param seat 当前机器人座位。
 * @param action 已从 legalActions 中选出的合法动作。
 * @returns 可以直接提交给规则引擎的动作。
 */
function toTurnAction(
  seat: TurnAction['seat'],
  action: PreparedAction,
): TurnAction {
  return {
    seat,
    intent: action.intent,
    selectedCardIds: [...action.selectedCardIds],
  }
}

/**
 * 对字符串计算稳定的无符号哈希值。
 * 入门难度使用该值在高分候选中做可复现选择，同一脱敏局面不会因运行环境变化而漂移。
 *
 * @param value 由公开局面、自己手牌和合法动作组成的稳定字符串。
 * @returns 可用于候选下标计算的无符号整数。
 */
function createStableHash(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

/**
 * 从脱敏观察构造入门难度的稳定随机键。
 * 键中只使用自己手牌、公开回合进度和合法动作，不包含任何对手手牌或暗牌身份。
 *
 * @param context 当前脱敏决策上下文。
 * @returns 用于稳定哈希的局面字符串。
 */
function createBeginnerChoiceKey(context: BotDecisionContext): string {
  const observation = context.observation
  const currentTrick = observation.round.currentTrick
  const publicProgress = observation.round.publicTrickLog
    .map((trick) => `${trick.trickIndex}:${trick.winner}:${trick.cardCount}`)
    .join('|')
  const opponentProgress = observation.opponents
    .map((opponent) =>
      `${opponent.seat}:${opponent.remainingCardCount}:${opponent.wonPierCount}`,
    )
    .join('|')
  const legalActionIds = context.legalActions.map((action) => action.id).sort().join('|')

  return [
    observation.seat,
    observation.round.roundNumber,
    currentTrick?.trickIndex ?? 0,
    currentTrick?.plays.length ?? 0,
    observation.self.hand.map((card) => card.id).sort().join('|'),
    publicProgress,
    opponentProgress,
    legalActionIds,
  ].join('#')
}

/**
 * 对全部合法动作打分并按分数、中文标签做稳定排序。
 *
 * @param context 当前脱敏决策上下文。
 * @param difficulty 当前机器人难度。
 * @returns 已完成稳定排序的合法动作评分列表。
 */
function scoreAndSortLegalActions(
  context: BotDecisionContext,
  difficulty: BotDifficulty,
): ScoredAction[] {
  const scoredActions: ScoredAction[] = context.legalActions.map((action) => ({
    action,
    score: scoreBotAction(context, action, difficulty),
  }))

  scoredActions.sort((leftItem, rightItem) => {
    if (rightItem.score !== leftItem.score) {
      return rightItem.score - leftItem.score
    }

    return leftItem.action.label.localeCompare(rightItem.action.label, 'zh-Hans-CN')
  })

  return scoredActions
}

/**
 * 按难度从规则引擎合法动作中选择候选。
 * 标准和专家档直接取最高分；入门档按稳定概率主动选择次优甚至较差动作，
 * 保证它不会违规，但会出现新人常见的贪眼前、错过吃牌或浪费控制牌。
 *
 * @param context 当前脱敏决策上下文。
 * @param difficulty 当前机器人难度。
 * @returns 从 context.legalActions 中选出的一个动作。
 */
function chooseScoredAction(
  context: BotDecisionContext,
  difficulty: BotDifficulty,
): PreparedAction {
  const scoredActions = scoreAndSortLegalActions(context, difficulty)
  const bestScoredAction = scoredActions[0]

  if (!bestScoredAction) {
    throw new Error('机器人没有可执行动作。')
  }

  if (difficulty !== 'beginner') {
    return bestScoredAction.action
  }

  if (scoredActions.length === 1) {
    return bestScoredAction.action
  }

  const choiceHash = createStableHash(createBeginnerChoiceKey(context))
  const mistakeRoll = choiceHash % 100
  let selectedIndex = 0

  if (mistakeRoll >= 45 && mistakeRoll < 75) {
    selectedIndex = Math.min(1, scoredActions.length - 1)
  } else if (mistakeRoll >= 75 && mistakeRoll < 92) {
    const nonBestCandidateCount = scoredActions.length - 1
    selectedIndex = 1 + (Math.floor(choiceHash / 100) % nonBestCandidateCount)
  } else if (mistakeRoll >= 92) {
    selectedIndex = scoredActions.length - 1
  }

  return scoredActions[selectedIndex].action
}

/**
 * 创建固定难度的吉安打索子启发式策略。
 * 策略只能读取脱敏 BotDecisionContext，并且最终动作必定来自规则引擎给出的 legalActions。
 *
 * @param difficulty 需要创建的机器人难度。
 * @returns 可直接执行当前难度决策的策略实例。
 */
function createHeuristicBotStrategy(difficulty: BotDifficulty): BotStrategy {
  return {
    id: `information-safe-${difficulty}-v5`,
    difficulty,
    chooseAction(context) {
      const selectedAction = chooseScoredAction(context, difficulty)
      return toTurnAction(context.observation.seat, selectedAction)
    },
  }
}

/** 三档机器人策略实例，按难度固定复用，避免每次决策重复创建对象。 */
const BOT_STRATEGIES: Record<BotDifficulty, BotStrategy> = {
  beginner: createHeuristicBotStrategy('beginner'),
  standard: createHeuristicBotStrategy('standard'),
  expert: createHeuristicBotStrategy('expert'),
}

/**
 * 获取指定难度的机器人策略。
 *
 * @param difficulty 需要执行的机器人难度。
 * @returns 对应难度且只读取脱敏上下文的策略实例。
 */
export function getHeuristicBotStrategy(difficulty: BotDifficulty): BotStrategy {
  return BOT_STRATEGIES[difficulty]
}

/**
 * 规则集默认使用的标准难度增强策略。
 * 保留原导出名称以兼容现有规则集，同时决策输入已经收口为脱敏上下文。
 */
export const heuristicBotStrategy: BotStrategy = BOT_STRATEGIES.standard
