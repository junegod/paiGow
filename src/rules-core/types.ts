/**
 * 座位编号固定为 0-3，分别对应下、右、上、左四个方位。
 */
export type SeatId = 0 | 1 | 2 | 3

/**
 * 玩家座位支持真人与机器人两种模式。
 */
export type SeatMode = 'human' | 'bot'

/**
 * 机器人难度决定候选动作的评估深度与选择方式。
 * 入门档允许在相近高分动作中做可复现的稳定随机，标准档沿用增强启发式，
 * 专家档会进一步提高残局、赏、孵赏和最后一墩控制权的权重。
 */
export type BotDifficulty = 'beginner' | 'standard' | 'expert'

/**
 * 打索子当前只使用长门、幺门、点子门三种门类。
 */
export type DoorId = 'long' | 'yao' | 'point'

/**
 * 赏牌支持活赏与死赏两种模式。
 */
export type RewardMode = 'live' | 'dead'

/**
 * 当前牌局在前端需要区分的阶段。
 */
export type MatchPhase = 'lobby' | 'playing' | 'awaiting-reveal' | 'settled'

/**
 * 牌型比较组决定了“能不能吃、按什么顺序比较”。
 */
export type PlayGroup =
  | 'long-single'
  | 'yao-single'
  | 'point-single'
  | 'long-pair'
  | 'yao-pair'
  | 'point-pair'
  | 'long-combo-2'
  | 'long-combo-3'
  | 'long-combo-4'
  | 'safe-singles'
  | 'reward-live'
  | 'reward-dead'
  | 'hidden'

/**
 * SVG 牌面上的单个点位。
 */
export interface PipMark {
  x: number
  y: number
  color: 'red' | 'white'
  radius?: number
}

/**
 * 单张牌的静态定义，不随对局变化。
 */
export interface CardDefinition {
  id: string
  name: string
  shortName: string
  aliases: string[]
  door: DoorId
  count: number
  order: number
  pips: PipMark[]
  copyPips?: Record<number, PipMark[]>
  note?: string
  isBrain?: boolean
  singleStrength?: number
  pairStrength?: number
}

/**
 * 发到某位玩家手里的一张具体牌实例。
 */
export interface CardInstance {
  id: string
  definitionId: string
  copyIndex: number
  order: number
}

/**
 * 牌型是前端、规则引擎和机器人共享的统一动作描述。
 */
export interface PlayPattern {
  id: string
  label: string
  kind: 'single' | 'pair' | 'reward' | 'combo'
  group: PlayGroup
  cardDefinitionIds: string[]
  cardInstanceIds: string[]
  cardCount: number
  strength: number
  isOpen: boolean
  source: 'natural' | 'dice' | 'hidden'
  note: string
  door?: DoorId
  rewardMode?: RewardMode
}

/**
 * 座位配置由大厅页决定，进入每局后复制到玩家运行态。
 */
export interface SeatConfig {
  seat: SeatId
  name: string
  mode: SeatMode
  color: string
}

/**
 * 每位玩家在一局中的运行态数据。
 */
export interface SeatState {
  seat: SeatId
  config: SeatConfig
  hand: CardInstance[]
  wonTricks: TrickRecord[]
  wonPierCount: number
}

/**
 * 骰子结果会同时记录点数组合与对应门类。
 */
export interface DiceRoll {
  first: number
  second: number
  sum: number
  key: string
  door: DoorId
}

/**
 * 单次出牌记录既服务桌面展示，也服务复盘回看。
 */
export interface PlayedAction {
  seat: SeatId
  pattern: PlayPattern
  revealed: boolean
  cards: CardInstance[]
  message: string
}

/**
 * 一墩内的完整出牌过程。
 */
export interface TrickRecord {
  trickIndex: number
  leader: SeatId
  winner: SeatId
  cardCount: number
  visibleWinningSeat: SeatId
  /**
   * 掷骰后无门弃牌开墩时记录定到的门，方便复盘和机器人审计还原“后手同门可吃”规则。
   */
  forcedDoor?: DoorId
  plays: PlayedAction[]
  note: string
  rewardOwner?: SeatId
  rewardMode?: RewardMode
  rewardWasEaten?: boolean
  rewardWasLastTwo?: boolean
}

/**
 * 赏的结果单独落档，方便结算与 UI 展示说明。
 */
export interface RewardOutcome {
  owner: SeatId
  mode: RewardMode
  wasLastTwo: boolean
  wasEaten: boolean
  trickIndex: number
  winner: SeatId
}

/**
 * 每位玩家的结算明细。
 */
export interface SeatSettlement {
  seat: SeatId
  wonPierCount: number
  baseDelta: number
  rewardDelta: number
  totalDelta: number
  summary: string
}

/**
 * 一局结束后的统一结算结果。
 */
export interface RoundSettlement {
  collector: SeatId
  isSweep: boolean
  seats: SeatSettlement[]
  summary: string
  rewardOwner?: SeatId
  rewardOutcome?: RewardOutcome
}

/**
 * 事件流既做操作提示，也可在测试里辅助断言回合推进。
 */
export interface EventLogEntry {
  id: string
  tone: 'info' | 'action' | 'result'
  message: string
  trickIndex?: number
}

/**
 * 掷骰后若需要继续选牌，前端会进入这个等待态。
 */
export interface PendingDiceChoice {
  seat: SeatId
  roll: DiceRoll
  forcedDoor: DoorId
  hasMatchingDoor: boolean
}

/**
 * 当前正在进行的一墩信息。
 */
export interface CurrentTrickState {
  trickIndex: number
  leader: SeatId
  expectedCardCount: number
  plays: PlayedAction[]
  currentWinningSeat: SeatId
  currentTargetPattern: PlayPattern | null
  /**
   * 掷骰后无门弃牌开墩时，保留骰子定到的门。
   * 后手有该门单张时可以明吃，并成为本回合当前明面最大。
   */
  forcedDoor?: DoorId
  responseSeat: SeatId | null
  isHiddenLead: boolean
  rewardOwner?: SeatId
  rewardMode?: RewardMode
  rewardWasLastTwo?: boolean
}

/**
 * 开局掷骰流程需要保留原始仪式信息，方便 UI 展示。
 */
export interface DiceCeremony {
  stage: 'first-round' | 'regular-round'
  roller: SeatId
  roll: DiceRoll
  firstLeader: SeatId
  firstRoller?: SeatId
  firstRoll?: DiceRoll
  secondRoller?: SeatId
  secondRoll?: DiceRoll
}

/**
 * 单局运行态，包含当前出牌、公开历史、背面弃牌揭示状态等信息。
 */
export interface RoundState {
  ruleSetId: string
  roundNumber: number
  phase: MatchPhase
  seats: SeatState[]
  currentSeat: SeatId | null
  firstLeader: SeatId
  lastTrickWinner?: SeatId
  ceremony: DiceCeremony
  currentTrick: CurrentTrickState | null
  pendingDice: PendingDiceChoice | null
  lastDiceRoll?: DiceRoll
  publicTrickLog: TrickRecord[]
  hiddenPlaysPendingReveal: number
  rewardOutcome?: RewardOutcome
  settlement?: RoundSettlement
  eventLog: EventLogEntry[]
}

/**
 * 整个对局匹配态，允许连续开始下一局并保留上一局的收尾信息。
 */
export interface MatchState {
  matchId: string
  ruleSetId: string
  seed: number
  phase: MatchPhase
  seatConfigs: SeatConfig[]
  roundNumber: number
  currentRound: RoundState | null
  lastRoundLastTrickWinner: SeatId | null
  replayRounds: RoundState[]
}

/**
 * 开局选项用于本地测试与未来后端开局接口扩展。
 * 当前主要支持指定真人座位和真人手牌；未指定或不足 8 张时，规则引擎会继续随机补齐。
 */
export interface StartRoundOptions {
  /** 本局真人所在座位；不传时按当前座位配置里的第一个真人座位推断。 */
  humanSeat?: SeatId
  /** 希望发给真人的具体牌实例 id，最多 8 张，重复或非法 id 会被规则层拒绝。 */
  selectedHandCardIds?: string[]
}

/**
 * 预备动作用于前端按钮展示，也会直接喂给机器人策略打分。
 */
export interface PreparedAction {
  id: string
  label: string
  description: string
  intent: TurnAction['intent']
  selectedCardIds: string[]
  emphasis: 'primary' | 'secondary'
}

/**
 * 当前选牌在规则引擎中的解释结果。
 */
export interface SelectionPreview {
  selectedCardIds: string[]
  actions: PreparedAction[]
  hint: string
}

/**
 * 前端提交给规则引擎的动作。
 */
export interface TurnAction {
  seat: SeatId
  intent:
    | 'lead-open'
    | 'lead-final-open'
    | 'lead-reward-live'
    | 'lead-reward-dead'
    | 'respond-eat'
    | 'respond-pass-hidden'
    | 'roll-dice'
    | 'resolve-dice-open'
    | 'resolve-dice-hidden'
  selectedCardIds: string[]
}

/**
 * 规则引擎每次推进后都会带回新的对局状态与消息。
 */
export interface ActionResult {
  match: MatchState
  messages: string[]
}

/**
 * 机器人能够看到的公开牌型信息。
 * 该模型刻意不复用完整 PlayPattern，避免暗牌的牌面、实例 id 或隐藏来源
 * 通过策略上下文被意外透传；只有已经正面公开的动作才允许构造此对象。
 */
export interface BotPublicPattern {
  /** 面向玩家展示的公开牌型名称。 */
  label: string
  /** 公开动作所属的基础牌型类别。 */
  kind: PlayPattern['kind']
  /** 公开动作参与大小比较的牌型组。 */
  group: PlayGroup
  /** 已经正面公开的牌定义 id。 */
  cardDefinitionIds: string[]
  /** 本次公开动作包含的牌张数。 */
  cardCount: number
  /** 规则引擎已经计算出的公开牌力。 */
  strength: number
  /** 公开动作的形成来源，暗牌来源不会进入机器人观察。 */
  source: Exclude<PlayPattern['source'], 'hidden'>
  /** 单门牌型公开后对应的门类。 */
  door?: DoorId
  /** 赏牌公开后对应的活赏或死赏模式。 */
  rewardMode?: RewardMode
}

/**
 * 机器人视角中的单次桌面出牌。
 * 暗牌只保留座位和张数，publicPattern 与 publicCards 必须为空，
 * 从类型和数据构造两层阻断机器人读取暗牌身份。
 */
export interface BotObservedPlay {
  /** 执行动作的座位。 */
  seat: SeatId
  /** 当前动作是否已经以正面牌公开。 */
  revealed: boolean
  /** 本次动作实际使用的牌张数。 */
  cardCount: number
  /** 正面公开时可见的牌型；暗牌固定为 null。 */
  publicPattern: BotPublicPattern | null
  /** 正面公开时可见的牌实例；暗牌固定为空数组。 */
  publicCards: CardInstance[]
}

/**
 * 机器人视角中的已完成墩记录。
 * 记录只包含桌面上所有玩家都能确认的赢家、墩数、赏状态和脱敏出牌，
 * 不携带原始 TrickRecord 中可能保存的暗牌牌面。
 */
export interface BotObservedTrick {
  /** 当前记录对应的局内墩序号。 */
  trickIndex: number
  /** 本墩领打座位。 */
  leader: SeatId
  /** 本墩最终赢家。 */
  winner: SeatId
  /** 本墩对应的基础墩数。 */
  cardCount: number
  /** 桌面明面上显示为领先的座位。 */
  visibleWinningSeat: SeatId
  /** 掷骰无门弃牌时公开确定的门类。 */
  forcedDoor?: DoorId
  /** 本墩各座位的脱敏出牌记录。 */
  plays: BotObservedPlay[]
  /** 本墩存在赏时的赏牌发起座位。 */
  rewardOwner?: SeatId
  /** 本墩赏牌采用的公开模式。 */
  rewardMode?: RewardMode
  /** 赏牌是否被其他座位吃走。 */
  rewardWasEaten?: boolean
  /** 赏牌是否在最后两墩作为孵赏打出。 */
  rewardWasLastTwo?: boolean
}

/**
 * 机器人视角中的当前未完成墩。
 * 当前目标牌型仅在目标已经明牌时提供；暗领和背面弃牌不会暴露牌面身份。
 */
export interface BotObservedCurrentTrick {
  /** 当前进行到的局内墩序号。 */
  trickIndex: number
  /** 本墩领打座位。 */
  leader: SeatId
  /** 后续玩家需要跟随的牌张数。 */
  expectedCardCount: number
  /** 当前已经发生的脱敏出牌。 */
  plays: BotObservedPlay[]
  /** 当前桌面明面领先座位。 */
  currentWinningSeat: SeatId
  /** 当前可被明吃的公开目标牌型；暗领时固定为 null。 */
  currentTargetPattern: BotPublicPattern | null
  /** 掷骰无门弃牌时公开确定的门类。 */
  forcedDoor?: DoorId
  /** 下一位需要响应的座位。 */
  responseSeat: SeatId | null
  /** 本墩是否由暗牌领出。 */
  isHiddenLead: boolean
  /** 当前赏牌发起座位。 */
  rewardOwner?: SeatId
  /** 当前赏牌公开模式。 */
  rewardMode?: RewardMode
  /** 当前赏牌是否属于最后两墩的孵赏。 */
  rewardWasLastTwo?: boolean
}

/**
 * 机器人自己的私有观察信息。
 * 自己手牌可以完整读取，但已赢牌堆只提供统计值，避免其中夹带其他玩家暗出的牌面。
 */
export interface BotSelfObservation {
  /** 机器人所在座位。 */
  seat: SeatId
  /** 机器人当前仍持有的完整手牌。 */
  hand: CardInstance[]
  /** 机器人当前已经赢得的基础墩数。 */
  wonPierCount: number
  /** 机器人当前已经赢得的完整回合数。 */
  wonTrickCount: number
}

/**
 * 机器人能够观察到的对手摘要。
 * 对手只提供座位、剩余张数和公开计分统计，严禁出现 hand、wonTricks
 * 或任何可以反推出暗牌牌面的字段。
 */
export interface BotOpponentObservation {
  /** 对手所在座位。 */
  seat: SeatId
  /** 对手当前剩余手牌张数。 */
  remainingCardCount: number
  /** 对手当前已经赢得的基础墩数。 */
  wonPierCount: number
  /** 对手当前已经赢得的完整回合数。 */
  wonTrickCount: number
}

/**
 * 机器人能够读取的单局公开信息。
 * 该对象由完整 RoundState 显式投影而来，不保留 seats、eventLog、原始暗牌记录
 * 等可能泄露其他玩家私有信息的字段。
 */
export interface BotRoundObservation {
  /** 当前局号。 */
  roundNumber: number
  /** 当前牌局阶段。 */
  phase: MatchPhase
  /** 当前应操作的座位。 */
  currentSeat: SeatId | null
  /** 本局首位领打座位。 */
  firstLeader: SeatId
  /** 上一墩赢家；尚未完成首墩时为空。 */
  lastTrickWinner?: SeatId
  /** 当前公开的掷骰仪式结果。 */
  ceremony: DiceCeremony
  /** 当前未完成墩的脱敏观察；尚未开墩时为空。 */
  currentTrick: BotObservedCurrentTrick | null
  /** 当前等待处理的公开骰子选择。 */
  pendingDice: PendingDiceChoice | null
  /** 最近一次公开骰子结果。 */
  lastDiceRoll?: DiceRoll
  /** 已完成墩的脱敏公开历史。 */
  publicTrickLog: BotObservedTrick[]
  /** 尚未在结算阶段翻开的暗牌动作数量。 */
  hiddenPlaysPendingReveal: number
  /** 已经公开确认的赏牌结果。 */
  rewardOutcome?: RewardOutcome
}

/**
 * 机器人决策时唯一允许读取的局面观察。
 * 自己手牌与公开桌面信息分别存放，对手只能通过统计摘要出现，
 * 因而策略实现无法从类型层访问完整 RoundState 或其他座位的真实手牌。
 */
export interface BotObservation {
  /** 当前机器人所在座位。 */
  seat: SeatId
  /** 机器人自己的私有手牌与公开计分信息。 */
  self: BotSelfObservation
  /** 三位对手的脱敏统计摘要。 */
  opponents: BotOpponentObservation[]
  /** 当前单局的公开桌面状态。 */
  round: BotRoundObservation
}

/**
 * 机器人策略输入上下文。
 * 上下文只包含经过脱敏的观察与规则引擎生成的合法动作，策略不得接收或缓存
 * 完整 RoundState、其他 SeatState 或任何暗牌牌面数据。
 */
export interface BotDecisionContext {
  /** 当前机器人允许读取的脱敏局面。 */
  observation: BotObservation
  /** 规则引擎为当前座位生成的全部合法动作。 */
  legalActions: PreparedAction[]
}

/**
 * 机器人策略是规则层可替换的一部分。
 * 每个策略实例固定对应一个难度，并且只能从 BotDecisionContext 中的合法动作里选择。
 */
export interface BotStrategy {
  /** 策略实现的稳定标识。 */
  id: string
  /** 当前策略实例对应的机器人难度。 */
  difficulty: BotDifficulty
  /**
   * 从脱敏上下文的合法动作中选择一次最终动作。
   *
   * @param context 只包含自己手牌、公开信息和合法动作的决策上下文。
   * @returns 可以直接提交给规则引擎的合法动作。
   */
  chooseAction(context: BotDecisionContext): TurnAction
}

/**
 * RuleSet 是未来挂载不同骨牌玩法的统一扩展点。
 */
export interface RuleSet {
  id: string
  name: string
  createMatch(seed: number, seatConfigs: SeatConfig[]): MatchState
  startRound(match: MatchState, rng: RandomSource, options?: StartRoundOptions): ActionResult
  previewSelection(
    round: RoundState,
    seat: SeatId,
    selectedCardIds: string[],
  ): SelectionPreview
  listTurnActions(round: RoundState, seat: SeatId): PreparedAction[]
  getTurnHint(round: RoundState, seat: SeatId): string
  submitAction(
    match: MatchState,
    action: TurnAction,
    rng: RandomSource,
  ): ActionResult
  finishRoundAndReveal(match: MatchState): ActionResult
  getReplayState(match: MatchState): RoundState | null
  getBotStrategy(): BotStrategy
  getCardDefinition(cardDefinitionId: string): CardDefinition
  getAllCardDefinitions(): CardDefinition[]
}

/**
 * 随机源抽象用于洗牌、掷骰与测试复现。
 */
export interface RandomSource {
  next(): number
  nextInt(maxExclusive: number): number
  shuffle<T>(items: T[]): T[]
}
