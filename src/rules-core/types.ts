/**
 * 座位编号固定为 0-3，分别对应下、右、上、左四个方位。
 */
export type SeatId = 0 | 1 | 2 | 3

/**
 * 玩家座位支持真人与机器人两种模式。
 */
export type SeatMode = 'human' | 'bot'

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
   * 掷骰无门卖屁股开墩时记录定到的门，方便复盘和机器人审计还原“后手同门可吃”规则。
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
   * 掷骰无门卖屁股开墩时，保留骰子定到的门。
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
 * 机器人策略输入上下文。
 */
export interface BotDecisionContext {
  round: RoundState
  seat: SeatId
  seatState: SeatState
  legalActions: PreparedAction[]
}

/**
 * 机器人策略是规则层可替换的一部分，方便未来扩多难度。
 */
export interface BotStrategy {
  id: string
  chooseAction(context: BotDecisionContext): TurnAction
}

/**
 * RuleSet 是未来挂载不同牌九玩法的统一扩展点。
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
