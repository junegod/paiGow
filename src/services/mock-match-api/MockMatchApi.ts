import { SeededRandom } from '@/rules-core/random'
import type {
  BotDifficulty,
  MatchState,
  PreparedAction,
  SeatConfig,
  SeatId,
  SelectionPreview,
  StartRoundOptions,
  TurnAction,
} from '@/rules-core/types'
import {
  DEFAULT_SEAT_CONFIGS,
  getCardDefinition,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  getSeatState,
  RULE_ENGINE_REVISION,
} from '@/rules-variants/ji-an-da-suo-zi/engine'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { getHeuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

/**
 * 当前项目先用纯前端 mock 服务承载状态，后续替换真实后端时可保留同名接口。
 */
export class MockMatchApi {
  /**
   * 当前 mock 服务绑定的规则实现版本。浏览器热更新后，控制器会用它判断旧实例是否需要丢弃。
   */
  public readonly rulesRevision = RULE_ENGINE_REVISION

  private rng: SeededRandom

  private state: MatchState

  private shouldUseRuntimeEntropy: boolean

  /** 当前机器人决策使用的难度，默认保持标准增强策略。 */
  private botDifficulty: BotDifficulty

  /**
   * 创建纯前端牌局服务实例。
   *
   * @param seed 可选固定随机种子；不传时使用运行期熵生成种子。
   * @param botDifficulty 机器人默认难度，未指定时使用 standard。
   */
  public constructor(seed?: number, botDifficulty: BotDifficulty = 'standard') {
    this.shouldUseRuntimeEntropy = seed === undefined
    this.botDifficulty = botDifficulty
    const initialSeed = seed ?? createRuntimeSeed()
    this.rng = new SeededRandom(initialSeed)
    this.state = jiAnDaSuoZiRuleSet.createMatch(initialSeed, DEFAULT_SEAT_CONFIGS)
  }

  /**
   * 修改后续机器人回合使用的默认难度，不重建或清空当前牌局。
   *
   * @param difficulty 后续机器人决策使用的难度。
   */
  public setBotDifficulty(difficulty: BotDifficulty): void {
    this.botDifficulty = difficulty
  }

  /**
   * 返回当前服务实例配置的机器人默认难度。
   *
   * @returns beginner、standard 或 expert 中的当前值。
   */
  public getBotDifficulty(): BotDifficulty {
    return this.botDifficulty
  }

  /**
   * 返回当前状态快照，避免 UI 直接持有内部引用。
   */
  public getState(): MatchState {
    return structuredClone(this.state)
  }

  /**
   * 重建整场对局。
   */
  public createMatch(seed?: number): MatchState {
    this.shouldUseRuntimeEntropy = seed === undefined
    const nextSeed = seed ?? createRuntimeSeed()
    this.rng = new SeededRandom(nextSeed)
    this.state = jiAnDaSuoZiRuleSet.createMatch(nextSeed, DEFAULT_SEAT_CONFIGS)
    return this.getState()
  }

  /**
   * 设置四个座位的人机模式与名称。该接口只允许在大厅态使用，
   * 牌局进行中直接返回当前状态，避免误清空当前局。
   */
  public configureSeats(seatConfigs: SeatConfig[]): MatchState {
    if (this.state.currentRound) {
      return this.getState()
    }

    this.state = {
      ...this.state,
      seatConfigs: seatConfigs.map((seatConfig) => ({ ...seatConfig })),
      phase: 'lobby',
      currentRound: null,
    }
    return this.getState()
  }

  /**
   * 开始新一局。首页调试模式可以传入真人手牌，规则层会负责校验与随机补齐。
   */
  public startRound(options?: StartRoundOptions): MatchState {
    if (this.shouldUseRuntimeEntropy) {
      this.rng = new SeededRandom(createRuntimeSeed())
    }

    const result = jiAnDaSuoZiRuleSet.startRound(this.state, this.rng, options)
    this.state = result.match
    return this.getState()
  }

  /**
   * 查询当前玩家在当前选择下能触发的动作。
   */
  public previewSelection(seat: SeatId, selectedCardIds: string[]): SelectionPreview {
    if (!this.state.currentRound) {
      return {
        selectedCardIds,
        actions: [],
        hint: '当前还没有开始新一局。',
      }
    }

    return jiAnDaSuoZiRuleSet.previewSelection(
      this.state.currentRound,
      seat,
      selectedCardIds,
    )
  }

  /**
   * 列举当前玩家所有合法动作，主要供机器人使用。
   */
  public listTurnActions(seat: SeatId): PreparedAction[] {
    if (!this.state.currentRound) {
      return []
    }

    return jiAnDaSuoZiRuleSet.listTurnActions(this.state.currentRound, seat)
  }

  /**
   * 返回当前回合提示文案。
   */
  public getTurnHint(seat: SeatId): string {
    if (!this.state.currentRound) {
      return '先配置座位并开始新一局。'
    }

    return jiAnDaSuoZiRuleSet.getTurnHint(this.state.currentRound, seat)
  }

  /**
   * 提交一次玩家动作。
   */
  public submitAction(action: TurnAction): MatchState {
    const result = jiAnDaSuoZiRuleSet.submitAction(this.state, action, this.rng)
    this.state = result.match
    return this.getState()
  }

  /**
   * 请求机器人为当前轮次自动决策。
   * 完整 RoundState 只在本方法内用于构造脱敏上下文，策略本身无法读取其他玩家手牌或暗牌牌面。
   *
   * @param difficulty 可选单次难度覆盖；不传时使用服务实例当前配置的默认难度。
   * @returns 执行动作后的牌局状态快照；当前不是机器人回合时原样返回。
   */
  public requestBotMove(difficulty: BotDifficulty = this.botDifficulty): MatchState {
    const round = this.state.currentRound

    if (!round || round.currentSeat === null) {
      return this.getState()
    }

    const seatState = getSeatState(round, round.currentSeat)

    if (seatState.config.mode !== 'bot') {
      return this.getState()
    }

    const botStrategy = getHeuristicBotStrategy(difficulty)
    const legalActions = jiAnDaSuoZiRuleSet.listTurnActions(round, round.currentSeat)
    const decisionContext = createBotDecisionContext(
      round,
      round.currentSeat,
      legalActions,
    )
    const nextAction = botStrategy.chooseAction(decisionContext)

    return this.submitAction(nextAction)
  }

  /**
   * 整局结束后统一翻开背面弃牌并生成结算。
   */
  public finishRoundAndReveal(): MatchState {
    const result = jiAnDaSuoZiRuleSet.finishRoundAndReveal(this.state)
    this.state = result.match
    return this.getState()
  }

  /**
   * 回放态默认返回当前局或上一局的最终快照。
   */
  public getReplayState() {
    return jiAnDaSuoZiRuleSet.getReplayState(this.state)
  }

  /**
   * 读取单张牌的静态定义给 UI 用。
   */
  public getCardDefinition(cardDefinitionId: string) {
    return getCardDefinition(cardDefinitionId)
  }

  /**
   * 暴露规则集，方便 UI 直接读取牌目录。
   */
  public getRuleSet() {
    return jiAnDaSuoZiRuleSet
  }
}

/**
 * 生成运行期随机种子。默认游戏入口不再使用固定 seed，
 * 避免刷新页面后第一局永远发同一副牌；测试传入显式 seed 时仍保持可复现。
 */
function createRuntimeSeed(): number {
  let cryptoSeed = 0

  if (globalThis.crypto?.getRandomValues) {
    const randomValues = new Uint32Array(1)
    globalThis.crypto.getRandomValues(randomValues)
    cryptoSeed = randomValues[0] ?? 0
  }

  const timeSeed = Date.now() >>> 0
  const performanceSeed =
    typeof performance === 'undefined'
      ? 0
      : Math.floor(performance.now() * 1000) >>> 0
  const mathSeed = Math.floor(Math.random() * 0xffffffff) >>> 0

  return (cryptoSeed ^ timeSeed ^ performanceSeed ^ mathSeed) >>> 0
}
