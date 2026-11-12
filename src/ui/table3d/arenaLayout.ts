import { SEAT_LAYOUTS, TILE_PITCH, TILE_SIZE, type Point3 } from '@/ui/table3d/tableMetrics'

/**
 * 每家出牌区域的完整占地上限；四家的区域之间保留间隔，不侵入骰碗和赢墩区域。
 */
const ARENA_WIDTH = 2.2
const ARENA_DEPTH = 2.2
const MAX_COLUMNS = 4
const ROW_GAP = 0.14

/**
 * 一张出牌在本家区域内的平放摆位。
 */
interface ArenaTileLayout {
  /**
   * 牌体中心位置，底面始终贴住桌面。
   */
  position: Point3
  /**
   * 多张牌统一缩放到区域内，保持宽高厚比例，避免压缩间距后互相穿插。
   */
  scale: number
}

/**
 * 按规则行列摆放一手出牌，所有牌均平放且朝向一致。
 *
 * @param viewSeat 界面座位，决定出牌区域与朝向
 * @param index 这一手中的牌序号，从零开始
 * @param count 这一手的总张数
 * @returns 牌的中心位置与统一缩放比例；最多四列，超出后另起一行
 */
export function locateArenaTile(viewSeat: number, index: number, count: number): ArenaTileLayout {
  const layout = SEAT_LAYOUTS[viewSeat]
  const columns = Math.min(MAX_COLUMNS, Math.max(1, count))
  const rows = Math.ceil(Math.max(1, count) / columns)
  const width = (columns - 1) * TILE_PITCH + TILE_SIZE.width
  const depth = rows * TILE_SIZE.height + (rows - 1) * ROW_GAP
  // 同一手牌采用相同比例，完整限制在本家的区域内，不能靠侧倾或重叠来腾出空间。
  const scale = Math.min(1, ARENA_WIDTH / width, ARENA_DEPTH / depth)
  const row = Math.floor(index / columns)
  const rowColumns = Math.min(columns, count - row * columns)
  const across = (index % columns - (rowColumns - 1) / 2) * TILE_PITCH * scale
  const along = (row - (rows - 1) / 2) * (TILE_SIZE.height + ROW_GAP) * scale
  const cosine = Math.cos(layout.slotYaw)
  const sine = Math.sin(layout.slotYaw)
  return {
    position: {
      x: layout.slot.x + cosine * across + sine * along,
      y: TILE_SIZE.depth * scale / 2,
      z: layout.slot.z - sine * across + cosine * along,
    },
    scale,
  }
}
