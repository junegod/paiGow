import type {
  CardDefinition,
  CardInstance,
  CurrentTrickState,
  PipMark,
  PlayedAction,
  RoundState,
  SeatId,
  TrickRecord,
} from '@/rules-core/types'
import { advanceSeat } from '@/rules-core/collections'
import { shouldCoverCardForDeadReward } from '@/ui/cardPresentation'
import { locateArenaTile } from '@/ui/table3d/arenaLayout'
import { COLLECT_FLIGHT_MS } from '@/ui/table3d/collectionTiming'
import {
  CEREMONY_SCATTER,
  CEREMONY_LINE_MAX_LENGTH,
  CEREMONY_STACK_CENTER_Z,
  CEREMONY_STACK_PITCH,
  DEAL_ORIGIN,
  HAND_CENTER,
  HAND_LIFT,
  HAND_REVEAL_STAGGER_MS,
  HAND_SIZE,
  HAND_TILT,
  SEAT_LAYOUTS,
  TILE_PITCH,
  TILE_SIZE,
  type Point3,
} from '@/ui/table3d/tableMetrics'

/**
 * 牌局状态到三维摆位的纯计算。
 *
 * 输入是规则层的单局状态，输出是"每张实体牌应该在哪、朝哪"的清单。
 * 场景层只负责把清单里的牌平滑移动到位，不再理解任何规则。
 */

/**
 * 一张牌的姿态描述。
 */
export interface TilePose {
  /**
   * 摆放方式：upright 立在桌上，lean 向后仰着（本方手牌），flat 平放。
   */
  mode: 'upright' | 'lean' | 'flat'
  /**
   * 绕竖直轴的朝向（弧度）；手牌固定为零，不额外侧转。
   */
  yaw: number
  /**
   * 平放时是否背面朝上；本方手牌则表示是否背朝玩家，抓完后绕自身长轴翻至正面。
   */
  faceDown: boolean
}

/**
 * 点击一张牌时要触发的业务含义。
 */
export type TilePick =
  | { type: 'hand'; cardId: string }
  | { type: 'trick'; trickIndex: number }

/**
 * 收牌的落位类型：逐家叠牌或整摞收进赢墩区，界面据此区分轻碰与落桌声音。
 */
export type TileLandingKind = 'stack' | 'pile'

/**
 * 一张实体牌在某一时刻的目标摆位。
 */
export interface TilePlacement {
  /**
   * 实体牌的稳定标识。同一张实体牌在不同区域之间移动时标识不变，场景据此做连续动画。
   */
  key: string
  /**
   * 手牌打出后会换成出牌标识；这里指向它在手里时的标识，让场景沿用同一个实体而不是新建。
   */
  inheritKey?: string
  /**
   * 牌面点位。为空表示当前视角不知道或不该看到这张牌的牌面，只渲染牌背。
   */
  pips: PipMark[] | null
  /**
   * 牌面标识，用于判断牌面是否需要重建（例如整局结束后暗牌翻开）。
   */
  faceKey: string | null
  position: Point3
  pose: TilePose
  /**
   * 新出现的牌从哪里飞进来。
   */
  spawn: { position: Point3; pose: TilePose }
  /**
   * 新出现时延迟多久起飞（毫秒），用于跳过仪式直接发牌时一张张依次飞出。
   */
  spawnDelay: number
  /**
   * 已存在的牌换位置时延迟多久起飞（毫秒），用于开局仪式里各家依次抓牌。
   */
  moveDelay: number
  /**
   * 覆盖默认飞行时长；收牌使用短于步骤间隔的时长，确保逐次叠稳后再继续移动。
   */
  moveDuration?: number
  /**
   * 一次叠牌只由代表牌回报落位，避免同一摞里的多张牌叠加播放声音。
   */
  landingKind?: TileLandingKind
  /**
   * 牌的整体缩放，不填按原大小。只在开局垒墩排不下时用来把牌墩等比缩小。
   */
  scale?: number
  pick: TilePick | null
}

/**
 * 开局仪式当前演到哪一步。
 */
export interface CeremonyStage {
  /**
   * shuffle 洗牌，stack 垒牌并掷骰，deal 各家依次抓牌，reveal 抓牌完成后亮出本方手牌。
   */
  phase: 'shuffle' | 'stack' | 'deal' | 'reveal'
  /**
   * 洗牌阶段的第几次搅动；每变一次，所有牌换一批随机位置。
   */
  shuffleStep: number
}

/**
 * 摆位计算的输入。
 */
export interface TableViewInput {
  round: RoundState
  /**
   * 一墩刚打完时停留展示的那一墩；展示期间它留在桌面中央，不进赢墩区。
   */
  reviewTrick: TrickRecord | null
  /**
   * 屏幕下方亮出手牌的座位。
   */
  handSeat: SeatId
  /**
   * 本方手牌，已经按界面上的显示顺序排好。
   */
  handCards: CardInstance[]
  selectedCardIds: string[]
  cardDefinitions: Record<string, CardDefinition>
  /**
   * 开局仪式的当前阶段；为空表示仪式已结束，按正常牌局摆放。
   */
  ceremony: CeremonyStage | null
  /**
   * 停留展示的那一墩已经收到第几步：0 表示四家的牌还各在各的出牌位，
   * 1 到 3 表示赢家的牌已经依次叠到了后面第几家的牌上。
   */
  collectStep: number
}

/**
 * 收墩时最多叠几步：赢家的牌依次叠到另外三家的牌上。
 */
export const COLLECT_STEP_COUNT = 3

/**
 * 收墩的叠牌顺序。
 *
 * 和线下用手收牌一样：赢家拿起自己的牌，先叠到左手边那家的牌上，再顺时针一家家叠过去。
 * 所以垒好的一摞从上到下依次是：赢家、赢家左手边、对家、赢家右手边。
 *
 * @param winner 赢下这一墩的座位
 * @returns 从最上层到最底层的座位顺序
 */
function getCollectOrder(winner: SeatId): SeatId[] {
  return [0, 1, 2, 3].map((step) => advanceSeat(winner, -step))
}

/**
 * 发牌时相邻两张牌起飞的间隔（毫秒）。
 */
const DEAL_STAGGER_MS = 18

/**
 * 开局仪式里相邻两手抓牌的间隔（毫秒）。
 */
const CEREMONY_GRAB_INTERVAL_MS = 150

/**
 * 开局仪式里每家每次抓几张牌。
 */
const CEREMONY_GRAB_SIZE = 2

/**
 * 开局仪式里随手垒出的牌墩数量范围，以及每墩最少几张。
 * 线下是人工随手垒的，墩数和每墩张数都不固定。
 */
const CEREMONY_STACK_COUNT_MIN = 6
const CEREMONY_STACK_COUNT_MAX = 9
const CEREMONY_STACK_MIN_SIZE = 2

const FLAT_UP: TilePose = { mode: 'flat', yaw: 0, faceDown: false }
const DEAL_SPAWN = { position: DEAL_ORIGIN, pose: { ...FLAT_UP, faceDown: true } }

/**
 * 把规则层座位换算成界面座位，保证亮手牌的一方永远在屏幕下方。
 *
 * @param seat 规则层座位
 * @param handSeat 亮手牌的座位
 * @returns 界面座位，0 为屏幕下方
 */
export function toViewSeat(seat: SeatId, handSeat: SeatId): number {
  return (seat - handSeat + 4) % 4
}

/**
 * 读取一张牌的牌面点位；同一种牌的不同副本可能有各自的点位。
 *
 * @param card 牌实例
 * @param cardDefinitions 牌定义映射
 * @returns 点位列表；找不到定义时返回空，按牌背渲染
 */
function readPips(card: CardInstance, cardDefinitions: Record<string, CardDefinition>): PipMark[] | null {
  const definition = cardDefinitions[card.definitionId]
  if (!definition) {
    return null
  }
  return definition.copyPips?.[card.copyIndex] ?? definition.pips
}

/**
 * 统计某个座位本局已经打出的牌数。
 *
 * 联机视角下对手的手牌数组会被服务端清空，不能直接读长度，只能从公开的出牌记录反推。
 *
 * @param round 单局状态
 * @param seat 规则层座位
 * @returns 已打出的牌张数
 */
function countPlayedCards(round: RoundState, seat: SeatId): number {
  const plays = [...round.publicTrickLog.flatMap((trick) => trick.plays), ...(round.currentTrick?.plays ?? [])]
  return plays.filter((play) => play.seat === seat).reduce((total, play) => total + play.cards.length, 0)
}

/**
 * 判断一手出牌当前是否对所有人公开。
 *
 * @param play 出牌记录
 * @param round 单局状态
 * @returns 明出、已揭示或整局已结算时为 true
 */
function isPlayPublic(play: PlayedAction, round: RoundState): boolean {
  return play.pattern.isOpen || play.revealed || round.phase === 'settled'
}

/**
 * 生成一手出牌里某张牌的牌面信息。
 *
 * 未公开的暗牌不输出牌面，避免把隐藏信息带进渲染层；死赏盖住的那张牌型公开但背面朝上。
 *
 * @param play 出牌记录
 * @param cardIndex 这一手里的第几张
 * @param round 单局状态
 * @param cardDefinitions 牌定义映射
 * @returns 牌面点位、牌面标识和是否背面朝上
 */
function describeFace(
  play: PlayedAction,
  cardIndex: number,
  round: RoundState,
  cardDefinitions: Record<string, CardDefinition>,
): Pick<TilePlacement, 'pips' | 'faceKey'> & { faceDown: boolean } {
  const card = play.cards[cardIndex]
  const isPublic = isPlayPublic(play, round)
  if (!isPublic) {
    return { pips: null, faceKey: null, faceDown: true }
  }
  return {
    pips: readPips(card, cardDefinitions),
    faceKey: `${card.definitionId}:${card.copyIndex}`,
    faceDown: shouldCoverCardForDeadReward(play, card, cardIndex),
  }
}

/**
 * 摆出桌面中央正在进行（或停留展示）的一墩。
 *
 * 这一墩打完进入收墩后，赢家的牌会一步步叠到其他三家的牌上：
 * 第 n 步时，叠牌顺序里前 n 家的牌都压在第 n+1 家的出牌位上，越靠前的压得越高。
 *
 * @param trick 当前墩或展示墩
 * @param input 摆位输入
 * @param prefix 本局标识前缀
 * @returns 这一墩所有牌的摆位
 */
function placeArenaTrick(
  trick: CurrentTrickState | TrickRecord,
  input: TableViewInput,
  prefix: string,
): TilePlacement[] {
  // 只有已经分出赢家的墩才会收牌；进行中的墩没有赢家，四家的牌都留在各自的出牌位。
  const collectOrder = 'winner' in trick ? getCollectOrder(trick.winner) : []
  const hostRank = Math.min(input.collectStep, COLLECT_STEP_COUNT, collectOrder.length - 1)

  return trick.plays.flatMap((play) => {
    const ownViewSeat = toViewSeat(play.seat, input.handSeat)
    const rank = collectOrder.indexOf(play.seat)
    // 排在当前“底牌”那一家前面的牌，都已经被拿起来叠到了它上面。
    const stackedLayers = hostRank > 0 && rank >= 0 && rank < hostRank ? hostRank - rank : 0
    const viewSeat = stackedLayers > 0 ? toViewSeat(collectOrder[hostRank], input.handSeat) : ownViewSeat
    const layout = SEAT_LAYOUTS[viewSeat]
    return play.cards.map((card, cardIndex) => {
      const face = describeFace(play, cardIndex, input.round, input.cardDefinitions)
      const slot = locateArenaTile(viewSeat, cardIndex, play.cards.length)
      // 收墩叠层使用出牌区域的实际厚度，缩放后仍按牌底相贴，不能悬空或穿插。
      slot.position.y += stackedLayers * TILE_SIZE.depth * slot.scale
      // 对手的牌从他面前那排牌的位置飞出；本方的牌沿用手里的实体牌，起点只是兜底。
      const ownLayout = SEAT_LAYOUTS[ownViewSeat]
      const spawnPosition = ownViewSeat === 0 ? HAND_CENTER : { ...ownLayout.row, y: TILE_SIZE.height / 2 }
      return {
        key: `${prefix}:play:${trick.trickIndex}:${play.seat}:${cardIndex}`,
        inheritKey: ownViewSeat === 0 ? `${prefix}:hand:${card.id}` : undefined,
        pips: face.pips,
        faceKey: face.faceKey,
        position: slot.position,
        pose: { mode: 'flat', yaw: layout.slotYaw, faceDown: face.faceDown },
        scale: slot.scale,
        spawn: { position: spawnPosition, pose: { mode: 'upright', yaw: ownLayout.rowYaw, faceDown: false } },
        spawnDelay: 0,
        moveDelay: 0,
        moveDuration: stackedLayers > 0 ? COLLECT_FLIGHT_MS : undefined,
        // 赢家的第一张牌代表整次叠牌，其余跟随移动的牌保持静音。
        landingKind: hostRank > 0 && rank === 0 && cardIndex === 0 ? 'stack' : undefined,
        pick: { type: 'trick', trickIndex: trick.trickIndex },
      } satisfies TilePlacement
    })
  })
}

/**
 * 把已经打完的墩垒到赢家手边。
 *
 * 一墩是四家各出一张垒成一摞；一次领出多张时按张数拆成多摞，赢家算赢了对应的墩数。
 * 垒牌时保持出牌时的朝向，赢家那张压在最上面；同一家的多摞并排摆放，每摞固定四张，不往上叠。
 *
 * @param tricks 需要垒起来的已完成墩，按先后顺序
 * @param input 摆位输入
 * @param prefix 本局标识前缀
 * @returns 所有赢墩牌的摆位
 */
function placeWonPiles(tricks: TrickRecord[], input: TableViewInput, prefix: string): TilePlacement[] {
  const pileCountBySeat = new Map<SeatId, number>()
  const placements: TilePlacement[] = []

  for (const trick of tricks) {
    const viewSeat = toViewSeat(trick.winner, input.handSeat)
    const layout = SEAT_LAYOUTS[viewSeat]
    /*
     * 每一摞从下到上的顺序和收墩时叠出来的一致，赢家的牌在最上面，收走时整摞不用重排。
     */
    const orderedPlays = [...getCollectOrder(trick.winner)]
      .reverse()
      .flatMap((seat) => trick.plays.filter((play) => play.seat === seat))
    const pierCount = Math.max(...trick.plays.map((play) => play.cards.length))

    for (let pier = 0; pier < pierCount; pier += 1) {
      const pileIndex = pileCountBySeat.get(trick.winner) ?? 0
      pileCountBySeat.set(trick.winner, pileIndex + 1)

      orderedPlays.forEach((play, layer) => {
        if (pier >= play.cards.length) {
          return
        }
        const face = describeFace(play, pier, input.round, input.cardDefinitions)
        placements.push({
          key: `${prefix}:play:${trick.trickIndex}:${play.seat}:${pier}`,
          pips: face.pips,
          faceKey: face.faceKey,
          position: {
            /*
             * 每一摞只有这一墩的四张牌；同一家的下一摞顺着自己面前那条边往后排，绝不叠到别的摞上。
             */
            x: layout.pile.x + layout.pileStep.x * pileIndex,
            y: TILE_SIZE.depth / 2 + layer * TILE_SIZE.depth,
            z: layout.pile.z + layout.pileStep.z * pileIndex,
          },
          pose: { mode: 'flat', yaw: layout.pileYaw, faceDown: face.faceDown },
          spawn: { position: layout.slot, pose: FLAT_UP },
          spawnDelay: 0,
          moveDelay: 0,
          moveDuration: COLLECT_FLIGHT_MS,
          // 多墩同时入堆也只响一次落桌声，不随牌张数放大音量。
          landingKind: play.seat === trick.winner && pier === 0 ? 'pile' : undefined,
          pick: { type: 'trick', trickIndex: trick.trickIndex },
        })
      })
    }
  }
  return placements
}

/**
 * 摆出本方手牌：一排端正、正对镜头的明牌，选中的牌沿牌面长边向上抬起。
 *
 * @param input 摆位输入
 * @param prefix 本局标识前缀
 * @returns 本方手牌的摆位
 */
function placeHand(input: TableViewInput, prefix: string): TilePlacement[] {
  return input.handCards.map((card, index) => {
    const lifted = input.selectedCardIds.includes(card.id)
    return {
      key: `${prefix}:hand:${card.id}`,
      pips: readPips(card, input.cardDefinitions),
      faceKey: `${card.definitionId}:${card.copyIndex}`,
      position: {
        x: HAND_CENTER.x + (index - (input.handCards.length - 1) / 2) * TILE_PITCH,
        y: HAND_CENTER.y + (lifted ? Math.cos(HAND_TILT) * HAND_LIFT : 0),
        z: HAND_CENTER.z - (lifted ? Math.sin(HAND_TILT) * HAND_LIFT : 0),
      },
      pose: { mode: 'lean', yaw: 0, faceDown: false },
      spawn: DEAL_SPAWN,
      spawnDelay: index * DEAL_STAGGER_MS,
      moveDelay: 0,
      pick: { type: 'hand', cardId: card.id },
    }
  })
}

/**
 * 摆出三家对手面前立着的牌背。
 *
 * @param input 摆位输入
 * @param prefix 本局标识前缀
 * @returns 对手牌背的摆位
 */
function placeOpponentBacks(input: TableViewInput, prefix: string): TilePlacement[] {
  return input.round.seats.flatMap((seatState) => {
    const viewSeat = toViewSeat(seatState.seat, input.handSeat)
    if (viewSeat === 0) {
      return []
    }
    const layout = SEAT_LAYOUTS[viewSeat]
    const remaining = Math.max(0, HAND_SIZE - countPlayedCards(input.round, seatState.seat))
    /*
     * 立牌沿这排的走向排开，走向与牌背朝向垂直。
     */
    const alongX = Math.cos(layout.rowYaw)
    const alongZ = -Math.sin(layout.rowYaw)
    return Array.from({ length: remaining }, (_, index) => {
      const offset = (index - (remaining - 1) / 2) * TILE_PITCH
      return {
        key: `${prefix}:back:${seatState.seat}:${index}`,
        pips: null,
        faceKey: null,
        position: {
          x: layout.row.x + alongX * offset,
          y: TILE_SIZE.height / 2,
          z: layout.row.z + alongZ * offset,
        },
        pose: { mode: 'upright', yaw: layout.rowYaw, faceDown: false },
        spawn: DEAL_SPAWN,
        spawnDelay: (viewSeat * HAND_SIZE + index) * DEAL_STAGGER_MS,
        moveDelay: 0,
        pick: null,
      } satisfies TilePlacement
    })
  })
}

/**
 * 由整数种子得到 0 到 1 之间的伪随机数，保证同一局的洗牌画面稳定，不随界面重绘乱跳。
 *
 * @param seed 整数种子
 * @returns 0 到 1 之间的数
 */
function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

/**
 * 仪式结束后某张牌的最终摆位，以及它是哪一家的第几张牌。
 */
interface CeremonyTile {
  placement: TilePlacement
  seat: SeatId
  index: number
}

/**
 * 按局数随机决定这一局垒成几墩、每墩几张。
 *
 * 线下是人工随手垒的：墩数在六到九之间，每墩张数不一样，合计三十二张。
 *
 * @param seed 随机种子，同一局固定，保证界面重绘时牌墩不会变
 * @returns 每一墩的张数，按抓牌时先后被抓的顺序排列
 */
function planCeremonyStacks(seed: number): number[] {
  const span = CEREMONY_STACK_COUNT_MAX - CEREMONY_STACK_COUNT_MIN + 1
  const count = CEREMONY_STACK_COUNT_MIN + Math.floor(seededUnit(seed) * span)
  const sizes = Array.from({ length: count }, () => CEREMONY_STACK_MIN_SIZE)
  /*
   * 先保证每墩有最少张数，剩下的牌一张张随机加到某一墩上，自然得到高矮不一的牌墩。
   */
  for (let extra = 0; extra < 4 * HAND_SIZE - count * CEREMONY_STACK_MIN_SIZE; extra += 1) {
    sizes[Math.floor(seededUnit(seed + extra + 1) * count)] += 1
  }
  return sizes
}

/**
 * 找出抓牌顺序里第 sequence 张牌垒在第几墩、从下往上第几层。
 *
 * 抓牌时从第一墩的最上面开始拿，一墩拿完接着拿下一墩，所以越早被抓的牌在墩里越靠上。
 *
 * @param sizes 每一墩的张数
 * @param sequence 这张牌在抓牌顺序里的序号，从 0 开始
 * @returns 牌墩序号和所在层数
 */
function locateInStacks(sizes: number[], sequence: number): { stack: number; layer: number } {
  let remaining = sequence
  for (let stack = 0; stack < sizes.length; stack += 1) {
    if (remaining < sizes[stack]) {
      return { stack, layer: sizes[stack] - 1 - remaining }
    }
    remaining -= sizes[stack]
  }
  /*
   * 序号超出总张数属于调用错误，兜底放到最后一墩的最底层，不让界面崩溃。
   */
  return { stack: sizes.length - 1, layer: 0 }
}

/**
 * 把开局仪式某一阶段的摆法套到"仪式结束后的最终摆位"上。
 *
 * 仪式里用的就是开局后四家手里的那 32 张实体牌，标识保持不变，
 * 所以抓牌结束时牌已经在各家手里，进入正式牌局不需要再发一遍。
 *
 * @param tiles 仪式结束后本方手牌和三家牌背的最终摆位
 * @param stage 仪式当前阶段
 * @param round 单局状态，用于读取先手和局数
 * @returns 仪式当前阶段每张牌的摆位
 */
function applyCeremony(tiles: CeremonyTile[], stage: CeremonyStage, round: RoundState): TilePlacement[] {
  const seed = round.roundNumber * 1000 + round.firstLeader * 13
  const stackSizes = planCeremonyStacks(seed)

  return tiles.map(({ placement, seat, index }, tileIndex) => {
    if (stage.phase === 'reveal') {
      // 只翻开本方手牌，三家对手继续保持牌背；轻微错峰让整排翻牌有连续节奏。
      return { ...placement, moveDelay: placement.pose.mode === 'lean' ? index * HAND_REVEAL_STAGGER_MS : 0 }
    }
    // 规则层已发牌不代表动画已抓牌；亮牌阶段之前不传点位和牌面标识，模型中也不能生成孔位。
    const hiddenPlacement = { ...placement, pips: null, faceKey: null, pick: null }
    // 抓牌从先手开始按出牌方向轮流进行，每家每次抓两张；据此计算抓牌顺序，保持拿牌延迟与牌墩一致。
    const turn = Math.floor(index / CEREMONY_GRAB_SIZE)
    const grabOrder = turn * 4 + ((seat - round.firstLeader + 4) % 4)
    const withinGrab = index % CEREMONY_GRAB_SIZE
    const sequence = grabOrder * CEREMONY_GRAB_SIZE + withinGrab

    if (stage.phase === 'deal') {
      // 抓到手里时仍背朝玩家；亮牌阶段再做真实半圈旋转，不能只在同一朝向下突然换点位。
      const pose = placement.pose.mode === 'lean' ? { ...placement.pose, faceDown: true } : placement.pose
      return { ...hiddenPlacement, pose, moveDelay: grabOrder * CEREMONY_GRAB_INTERVAL_MS + withinGrab * 60 }
    }

    if (stage.phase === 'stack') {
      const { stack, layer } = locateInStacks(stackSizes, sequence)
      /*
       * 牌竖着放，牌墩从近到远排成一条线，第一墩（最先被抓的）在离本方最近的一端。
       * 墩数多时这条线会比桌面长，此时把牌墩整体等比缩小到刚好放下；抓到手里时恢复原大小。
       */
      const scale = Math.min(1, CEREMONY_LINE_MAX_LENGTH / (stackSizes.length * CEREMONY_STACK_PITCH))
      // 开局模拟线下随手垒放：每墩略微错位、偏转，层间只做小幅横向错位，保持牌墩有支撑。
      const stackSeed = seed + stack * 17
      return {
        ...hiddenPlacement,
        position: {
          x: ((seededUnit(stackSeed) - 0.5) * 0.5 + (seededUnit(seed + sequence * 3) - 0.5) * 0.06) * scale,
          y: (TILE_SIZE.depth / 2 + layer * TILE_SIZE.depth) * scale,
          z:
            CEREMONY_STACK_CENTER_Z +
            ((stackSizes.length - 1) / 2 - stack) * CEREMONY_STACK_PITCH * scale +
            (seededUnit(stackSeed + 2) - 0.5) * 0.1 * scale,
        },
        pose: {
          mode: 'flat',
          yaw: (seededUnit(stackSeed + 1) - 0.5) * 0.44 + (seededUnit(seed + sequence * 5) - 0.5) * 0.09,
          faceDown: true,
        },
        scale,
        moveDelay: sequence * 12,
        pick: null,
      }
    }

    // 洗牌时随机散开搅动，垒墩后保留小幅自然错位；正式手牌与桌面出牌仍使用各自端正摆位。
    const scatterSeed = seed + tileIndex * 31 + stage.shuffleStep * 7
    return {
      ...hiddenPlacement,
      position: {
        x: (seededUnit(scatterSeed) - 0.5) * 2 * CEREMONY_SCATTER.halfWidth,
        y: TILE_SIZE.depth / 2 + (tileIndex % 3) * TILE_SIZE.depth * 1.02,
        z: CEREMONY_SCATTER.centerZ + (seededUnit(scatterSeed + 1) - 0.5) * 2 * CEREMONY_SCATTER.halfDepth,
      },
      pose: { mode: 'flat', yaw: seededUnit(scatterSeed + 2) * Math.PI * 2, faceDown: true },
      moveDelay: 0,
      pick: null,
    }
  })
}

/**
 * 根据牌局状态计算桌面上每张实体牌的目标摆位。
 *
 * @param input 牌局状态与本方视角信息
 * @returns 所有实体牌的摆位清单
 */
export function buildTableView(input: TableViewInput): TilePlacement[] {
  const { round } = input
  /*
   * 标识带上局数，下一局的牌不会误沿用上一局同位置的实体牌。
   */
  const prefix = `r${round.roundNumber}`

  if (input.ceremony) {
    /*
     * 仪式期间规则层已经发完牌但还没人出牌，四家各八张；按座位记下每张牌是这一家的第几张。
     */
    const hand = placeHand(input, prefix).map((placement, index) => ({ placement, seat: input.handSeat, index }))
    const backs = placeOpponentBacks(input, prefix).map((placement) => {
      const [, , seat, index] = placement.key.split(':')
      return { placement, seat: Number(seat) as SeatId, index: Number(index) }
    })
    return applyCeremony([...hand, ...backs], input.ceremony, round)
  }

  const arenaTrick = round.currentTrick ?? input.reviewTrick
  const pileTricks = round.publicTrickLog.filter((trick) => trick.trickIndex !== arenaTrick?.trickIndex)

  return [
    ...placeHand(input, prefix),
    ...placeOpponentBacks(input, prefix),
    ...(arenaTrick ? placeArenaTrick(arenaTrick, input, prefix) : []),
    ...placeWonPiles(pileTricks, input, prefix),
  ]
}
