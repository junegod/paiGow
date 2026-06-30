import type {
  CardDefinition,
  CardInstance,
  DoorId,
  PipMark,
  SeatConfig,
} from '@/rules-core/types'
import { createStableId } from '@/rules-core/collections'

const TILE_WIDTH = 84
const TILE_HEIGHT = 200

type PipColor = PipMark['color']
type HalfPosition = 'top' | 'bottom'

const LEFT_X = 25
const CENTER_X = 42
const RIGHT_X = 59
const HALF_ROWS: Record<HalfPosition, [number, number, number]> = {
  top: [28, 55, 82],
  bottom: [118, 145, 172],
}

/**
 * 创建一个牌面孔位。坐标按参考图里的单块窄骨牌比例手工配置，
 * 规则判断只读取 definitionId，不依赖这些可视坐标。
 */
function mark(x: number, y: number, color: PipColor, radius = 10.4): PipMark {
  return { x, y, color, radius }
}

/**
 * 取某个半区的三行纵向坐标，方便把传统牌九的几点牌转换成孔位。
 */
function rows(position: HalfPosition): [number, number, number] {
  return HALF_ROWS[position]
}

/**
 * 传统一点牌不是放在半区正中，而是上半区靠上、下半区靠下；
 * 地牌、丁三、杂五的红点都依赖这个位置。
 */
function one(position: HalfPosition, color: PipColor): PipMark[] {
  const [topY, , bottomY] = rows(position)
  return [mark(CENTER_X, position === 'top' ? topY : bottomY, color)]
}

/**
 * 传统二点牌按参考图采用横向双孔，而不是现代骰子的斜向双孔。
 */
function two(position: HalfPosition, color: PipColor): PipMark[] {
  const [topY, , bottomY] = rows(position)
  const y = position === 'top' ? topY : bottomY
  return [mark(LEFT_X, y, color), mark(RIGHT_X, y, color)]
}

/**
 * 三点牌使用从左上到右下的斜线孔位，对应图中的丁三、和牌下半区。
 */
function three(position: HalfPosition, color: PipColor): PipMark[] {
  const [topY, middleY, bottomY] = rows(position)
  return [
    mark(LEFT_X, topY, color),
    mark(CENTER_X, middleY, color),
    mark(RIGHT_X, bottomY, color),
  ]
}

/**
 * 长三的六个白点不是上下两组斜三点，而是整张牌纵向排布：
 * 上方两点竖排，中间两点横排，下方两点再竖排。
 */
function longThree(color: PipColor): PipMark[] {
  const [topY, topMiddleY, topBottomY] = rows('top')
  const [bottomTopY, bottomMiddleY, bottomY] = rows('bottom')
  const centerY = (topBottomY + bottomTopY) / 2

  return [
    mark(CENTER_X, topY, color),
    mark(CENTER_X, topMiddleY, color),
    mark(LEFT_X, centerY, color),
    mark(RIGHT_X, centerY, color),
    mark(CENTER_X, bottomMiddleY, color),
    mark(CENTER_X, bottomY, color),
  ]
}

/**
 * 四点牌使用方形四孔，红头、杂七第二张等牌会复用这个结构。
 */
function four(position: HalfPosition, color: PipColor): PipMark[] {
  const [topY, , bottomY] = rows(position)
  return [
    mark(LEFT_X, topY, color),
    mark(RIGHT_X, topY, color),
    mark(LEFT_X, bottomY, color),
    mark(RIGHT_X, bottomY, color),
  ]
}

/**
 * 五点牌是在四孔基础上增加中孔，主要用于梅花、麽五和杂牌。
 */
function five(position: HalfPosition, color: PipColor): PipMark[] {
  const [, middleY] = rows(position)
  return [...four(position, color), mark(CENTER_X, middleY, color)]
}

/**
 * 六点牌按两列三行排列。天牌会在这个结构上使用交错红白孔。
 */
function six(position: HalfPosition, color: PipColor): PipMark[] {
  const [topY, middleY, bottomY] = rows(position)
  return [
    mark(LEFT_X, topY, color),
    mark(RIGHT_X, topY, color),
    mark(LEFT_X, middleY, color),
    mark(RIGHT_X, middleY, color),
    mark(LEFT_X, bottomY, color),
    mark(RIGHT_X, bottomY, color),
  ]
}

/**
 * 天牌的六点不是纯色，参考图里左右列按红白交错呈现。
 */
function sixMixed(position: HalfPosition, colors: [PipColor, PipColor][]): PipMark[] {
  const [topY, middleY, bottomY] = rows(position)
  const yRows = [topY, middleY, bottomY]

  return yRows.flatMap((y, index) => [
    mark(LEFT_X, y, colors[index][0]),
    mark(RIGHT_X, y, colors[index][1]),
  ])
}

/**
 * 组合上下半区孔位，让每张基础牌的画法能直接对照参考图阅读。
 */
function face(...segments: PipMark[][]): PipMark[] {
  return segments.flat()
}

/**
 * 组装基础牌定义，统一保证 order、数量和可视别名齐全。
 */
function defineCard(options: {
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
}): CardDefinition {
  return {
    id: options.id,
    name: options.name,
    shortName: options.shortName,
    aliases: options.aliases,
    door: options.door,
    count: options.count,
    order: options.order,
    note: options.note,
    isBrain: options.isBrain,
    singleStrength: options.singleStrength,
    pairStrength: options.pairStrength,
    pips: options.pips,
    copyPips: options.copyPips,
  }
}

/**
 * 32 张牌拆成 17 种静态定义，便于规则与渲染分层。
 */
export const CARD_DEFINITIONS: CardDefinition[] = [
  defineCard({
    id: 'long_tian',
    name: '天',
    shortName: '天',
    aliases: ['天牌'],
    door: 'long',
    count: 2,
    order: 1,
    pips: face(
      sixMixed('top', [
        ['white', 'red'],
        ['white', 'red'],
        ['white', 'red'],
      ]),
      sixMixed('bottom', [
        ['red', 'white'],
        ['red', 'white'],
        ['red', 'white'],
      ]),
    ),
    isBrain: true,
    singleStrength: 7,
    pairStrength: 7,
  }),
  defineCard({
    id: 'long_di',
    name: '地',
    shortName: '地',
    aliases: ['地牌'],
    door: 'long',
    count: 2,
    order: 2,
    pips: face(one('top', 'red'), one('bottom', 'red')),
    singleStrength: 6,
    pairStrength: 6,
  }),
  defineCard({
    id: 'long_ren',
    name: '人',
    shortName: '人',
    aliases: ['人牌'],
    door: 'long',
    count: 2,
    order: 3,
    pips: face(four('top', 'red'), four('bottom', 'red')),
    singleStrength: 5,
    pairStrength: 5,
  }),
  defineCard({
    id: 'long_he',
    name: '和',
    shortName: '和',
    aliases: ['和牌', '鹅牌'],
    door: 'long',
    count: 2,
    order: 4,
    pips: face(one('top', 'red'), three('bottom', 'white')),
    singleStrength: 4,
    pairStrength: 4,
  }),
  defineCard({
    id: 'long_mei',
    name: '梅',
    shortName: '梅',
    aliases: ['梅花'],
    door: 'long',
    count: 2,
    order: 5,
    pips: face(five('top', 'white'), five('bottom', 'white')),
    singleStrength: 3,
    pairStrength: 3,
  }),
  defineCard({
    id: 'long_chang',
    name: '长',
    shortName: '长',
    aliases: ['长三'],
    door: 'long',
    count: 2,
    order: 6,
    pips: longThree('white'),
    singleStrength: 2,
    pairStrength: 2,
  }),
  defineCard({
    id: 'long_ban',
    name: '板',
    shortName: '板',
    aliases: ['板凳'],
    door: 'long',
    count: 2,
    order: 7,
    pips: face(two('top', 'white'), two('bottom', 'white')),
    singleStrength: 1,
    pairStrength: 1,
  }),
  defineCard({
    id: 'yao_fu',
    name: '斧头',
    shortName: '斧',
    aliases: ['虎头'],
    door: 'yao',
    count: 2,
    order: 8,
    pips: face(six('top', 'white'), five('bottom', 'white')),
    isBrain: true,
    singleStrength: 4,
    pairStrength: 4,
  }),
  defineCard({
    id: 'yao_si_liu',
    name: '四六',
    shortName: '四六',
    aliases: ['红头', '屏风'],
    door: 'yao',
    count: 2,
    order: 9,
    pips: face(four('top', 'red'), six('bottom', 'white')),
    singleStrength: 3,
    pairStrength: 3,
  }),
  defineCard({
    id: 'yao_yao_liu',
    name: '幺六',
    shortName: '幺六',
    aliases: ['高脚七', '铜锤'],
    door: 'yao',
    count: 2,
    order: 10,
    pips: face(one('top', 'red'), six('bottom', 'white')),
    singleStrength: 2,
    pairStrength: 2,
  }),
  defineCard({
    id: 'yao_yao_wu',
    name: '幺五',
    shortName: '幺五',
    aliases: ['麽五', '零霖六', '玲珑'],
    door: 'yao',
    count: 2,
    order: 11,
    pips: face(one('top', 'red'), five('bottom', 'white')),
    singleStrength: 1,
    pairStrength: 1,
  }),
  defineCard({
    id: 'point_nine',
    name: '九',
    shortName: '九',
    aliases: ['杂九'],
    door: 'point',
    count: 2,
    order: 12,
    pips: face(four('top', 'red'), five('bottom', 'white')),
    copyPips: {
      1: face(four('top', 'red'), five('bottom', 'white')),
      2: face(three('top', 'white'), six('bottom', 'white')),
    },
    isBrain: true,
    singleStrength: 6,
    pairStrength: 4,
  }),
  defineCard({
    id: 'point_eight',
    name: '八',
    shortName: '八',
    aliases: ['杂八'],
    door: 'point',
    count: 2,
    order: 13,
    pips: face(three('top', 'white'), five('bottom', 'white')),
    copyPips: {
      1: face(three('top', 'white'), five('bottom', 'white')),
      2: face(four('top', 'white'), four('bottom', 'white')),
    },
    singleStrength: 5,
    pairStrength: 3,
  }),
  defineCard({
    id: 'point_seven',
    name: '七',
    shortName: '七',
    aliases: ['杂七'],
    door: 'point',
    count: 2,
    order: 14,
    pips: face(two('top', 'white'), five('bottom', 'white')),
    copyPips: {
      1: face(two('top', 'white'), five('bottom', 'white')),
      2: face(three('top', 'white'), four('bottom', 'red')),
    },
    singleStrength: 4,
    pairStrength: 2,
  }),
  defineCard({
    id: 'point_six',
    name: '六',
    shortName: '六',
    aliases: ['大头六', '丁六'],
    door: 'point',
    count: 1,
    order: 15,
    pips: face(two('top', 'white'), four('bottom', 'red')),
    singleStrength: 3,
  }),
  defineCard({
    id: 'point_five',
    name: '五',
    shortName: '五',
    aliases: ['杂五'],
    door: 'point',
    count: 2,
    order: 16,
    pips: face(one('top', 'red'), four('bottom', 'red')),
    copyPips: {
      1: face(one('top', 'red'), four('bottom', 'red')),
      2: face(three('top', 'white'), two('bottom', 'white')),
    },
    singleStrength: 2,
    pairStrength: 1,
  }),
  defineCard({
    id: 'point_three',
    name: '三',
    shortName: '三',
    aliases: ['丁三'],
    door: 'point',
    count: 1,
    order: 17,
    pips: face(one('top', 'red'), two('bottom', 'white')),
    singleStrength: 1,
  }),
]

/**
 * 供规则层快速索引静态牌信息。
 */
export const CARD_DEFINITION_MAP = Object.fromEntries(
  CARD_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<string, CardDefinition>

/**
 * 默认四个座位配置，首版保留明显的方位色彩，便于移动端识别。
 */
export const DEFAULT_SEAT_CONFIGS: SeatConfig[] = [
  { seat: 0, name: '我', mode: 'human', color: '#f08f68' },
  { seat: 1, name: '机器人甲', mode: 'bot', color: '#f3d46c' },
  { seat: 2, name: '机器人乙', mode: 'bot', color: '#7bd5c1' },
  { seat: 3, name: '机器人丙', mode: 'bot', color: '#8aa6ff' },
]

/**
 * 生成 32 张具体牌实例。
 */
export function createDeck(): CardInstance[] {
  return CARD_DEFINITIONS.flatMap((definition) =>
    Array.from({ length: definition.count }, (_, index) => ({
      id: createStableId('card', [definition.id, index + 1]),
      definitionId: definition.id,
      copyIndex: index + 1,
      order: definition.order * 10 + index,
    })),
  )
}

/**
 * 用于手牌、公开牌历史和复盘列表的统一排序。
 */
export function sortCardInstances(cards: CardInstance[]): CardInstance[] {
  return [...cards].sort((leftCard, rightCard) => leftCard.order - rightCard.order)
}

/**
 * 从具体实例回到定义信息。
 */
export function getCardDefinition(cardDefinitionId: string): CardDefinition {
  return CARD_DEFINITION_MAP[cardDefinitionId]
}

/**
 * 获取完整牌目录，UI 会用它渲染说明和牌名。
 */
export function getAllCardDefinitions(): CardDefinition[] {
  return CARD_DEFINITIONS
}

export const TILE_METRICS = {
  width: TILE_WIDTH,
  height: TILE_HEIGHT,
}
