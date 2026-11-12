import { TILE_METRICS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'

/**
 * 三维牌桌的尺寸与摆位常量。
 *
 * 这里只放纯数据，不依赖渲染库，方便摆位计算和单元测试共用。
 */

/**
 * 三维空间里的一个点。
 */
export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * 牌目录坐标到三维单位的换算比例；牌目录按 84x200 配置，一张牌高 2 个单位。
 */
export const TILE_UNIT = 1 / 100

/**
 * 牌的三维尺寸，厚度按常见硬质骨牌的宽厚比估算。
 */
export const TILE_SIZE = {
  width: TILE_METRICS.width * TILE_UNIT,
  height: TILE_METRICS.height * TILE_UNIT,
  depth: 0.34,
}

/**
 * 每家起手牌数，用于在联机视角下反推对手剩余牌数。
 */
export const HAND_SIZE = 8

/**
 * 一排牌里相邻两张的中心间距。
 */
export const TILE_PITCH = TILE_SIZE.width + 0.06

/**
 * 相邻两摞赢墩之间的中心间距。
 */
export const PILE_PITCH = TILE_SIZE.width + 0.14

/**
 * 桌面半边长。
 */
export const TABLE_HALF = 7.2

/**
 * 本方手牌向后仰的角度（弧度），牌面正对标准机位，保持整排竖直、端正。
 */
export const HAND_TILT = 1.45

/**
 * 本方手牌一排的中心位置。手牌抬离桌面并靠近镜头，像握在手里，
 * 这样手牌在屏幕上够大，同时桌面能露出更大的范围。
 */
export const HAND_CENTER: Point3 = { x: 0, y: 6.4, z: 7.4 }

/**
 * 手牌被选中时沿牌面向上抬起的距离。
 */
export const HAND_LIFT = 0.42

/**
 * 开局手牌从背面翻至正面的时长与相邻牌的启动间隔（毫秒）。
 * 时间轴与场景共用，最后一张翻完后才允许操作，避免动画被出牌打断。
 */
export const HAND_REVEAL_DURATION_MS = 520
export const HAND_REVEAL_STAGGER_MS = 48

/**
 * 镜头位置与注视点。
 */
export const CAMERA_HOME: Point3 = { x: 0, y: 18.5, z: 8.8 }
export const CAMERA_TARGET: Point3 = { x: 0, y: 0, z: -1 }

/**
 * 发牌时牌从桌面中央飞向各家，这里是飞出的起点。
 */
export const DEAL_ORIGIN: Point3 = { x: 0, y: 0.6, z: 1.6 }

/**
 * 开局仪式垒牌成墩时的摆法：牌竖着放（长边朝向本方和对家），牌墩从近到远排成一条线。
 * 这条线最长不能超过桌面可用的长度；墩数多、排不下时把牌墩整体等比缩小，而不是另起一列。
 */
export const CEREMONY_STACK_CENTER_Z = -0.2
export const CEREMONY_STACK_PITCH = TILE_SIZE.height + 0.14
export const CEREMONY_LINE_MAX_LENGTH = 13.4

/**
 * 开局仪式洗牌时，牌在桌面中央散开的范围。
 */
export const CEREMONY_SCATTER = { halfWidth: 2.5, halfDepth: 3.1, centerZ: -0.3 }

/**
 * 骰碗平时放在桌子正中，四家出牌位围着它；掷骰时端到镜头前。
 */
export const BOWL_DOCK: Point3 = { x: 0, y: 0, z: -0.55 }
export const BOWL_SHOWCASE: Point3 = { x: 0, y: 8, z: 3.4 }

/**
 * 开局洗牌垒墩期间骰碗暂放的位置：靠左侧桌边，把桌子中央让给牌墩。
 */
export const BOWL_ASIDE: Point3 = { x: -4.7, y: 0, z: -0.4 }

/**
 * 一个界面座位在桌面上的摆位。界面座位 0 固定是屏幕下方的本方。
 */
export interface SeatLayout {
  /**
   * 立牌一排的中心点；本方手牌不使用。
   */
  row: Point3
  /**
   * 立牌牌背的朝向（弧度）。
   */
  rowYaw: number
  /**
   * 这一家出牌落在桌面上的中心位置。
   */
  slot: Point3
  /**
   * 出牌平放时牌长边的朝向（弧度）。
   */
  slotYaw: number
  /**
   * 第一摞赢墩的位置。
   */
  pile: Point3
  /**
   * 相邻两摞之间的位移。一局总共八墩，每家都留足八摞并排的位置，任何情况下都不往上叠。
   */
  pileStep: Point3
  /**
   * 赢墩牌长边的朝向（弧度）。
   */
  pileYaw: number
  /**
   * 头像跟随的三维锚点。
   */
  anchor: Point3
}

/**
 * 四个界面座位的摆位：0 本方，1 右家，2 对家，3 左家。
 *
 * 每家的赢墩沿自己面前那条边排成一排：本方和对家横着排，左右两家竖着排，
 * 一眼能看出每一摞是谁赢的。出牌位围着桌子中央的骰碗。
 * 出牌区按完整占地预留间隔，赢墩和对手手牌依次在外侧，避免多行出牌与已有牌摞交叠。
 */
export const SEAT_LAYOUTS: SeatLayout[] = [
  {
    row: HAND_CENTER,
    rowYaw: 0,
    slot: { x: 0, y: 0, z: 1.8 },
    slotYaw: 0,
    pile: { x: 3.5 * PILE_PITCH, y: 0, z: 4 },
    pileStep: { x: -PILE_PITCH, y: 0, z: 0 },
    pileYaw: 0,
    anchor: HAND_CENTER,
  },
  {
    row: { x: 5.8, y: 0, z: -0.4 },
    rowYaw: Math.PI / 2,
    slot: { x: 2.3, y: 0, z: -0.5 },
    slotYaw: Math.PI / 2,
    pile: { x: 4.5, y: 0, z: -3.7 },
    pileStep: { x: 0, y: 0, z: PILE_PITCH },
    pileYaw: Math.PI / 2,
    anchor: { x: 5.3, y: 4.2, z: -7.6 },
  },
  {
    row: { x: 0, y: 0, z: -6.45 },
    rowYaw: Math.PI,
    slot: { x: 0, y: 0, z: -2.8 },
    slotYaw: 0,
    pile: { x: -3.5 * PILE_PITCH, y: 0, z: -5.15 },
    pileStep: { x: PILE_PITCH, y: 0, z: 0 },
    pileYaw: 0,
    anchor: { x: 0, y: 5, z: -8.4 },
  },
  {
    row: { x: -5.8, y: 0, z: -0.4 },
    rowYaw: -Math.PI / 2,
    slot: { x: -2.3, y: 0, z: -0.5 },
    slotYaw: -Math.PI / 2,
    pile: { x: -4.5, y: 0, z: -3.7 },
    pileStep: { x: 0, y: 0, z: PILE_PITCH },
    pileYaw: Math.PI / 2,
    anchor: { x: -5.3, y: 4.2, z: -7.6 },
  },
]
