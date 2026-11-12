import * as THREE from 'three'

import type { PipMark } from '@/rules-core/types'
import { TILE_METRICS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { TILE_SIZE, TILE_UNIT } from '@/ui/table3d/tableMetrics'

/**
 * 牌体倒角保留方正轮廓，并提供可读的曲面高光；孔沿另用更小尺度，避免吞掉牌点间隔。
 */
export const TILE_EDGE_BEVEL = 0.028
const PIP_BEVEL = 0.012
const FACE_CORNER = 0.008
const DEFAULT_PIP_RADIUS = 10.4
const WELL_SEGMENTS = 32
const WELL_RINGS = 6

/**
 * 按孔位缓存牌壳，重复牌和翻面动画共用几何体，避免每次更新反复三角剖分。
 */
const geometryCache = new Map<string, THREE.ExtrudeGeometry>()

/**
 * 换算到三维牌面坐标的孔位。
 */
export interface TilePip {
  /**
   * 孔中心相对牌中心的横向坐标。
   */
  x: number
  /**
   * 孔中心相对牌中心的纵向坐标。
   */
  y: number
  /**
   * 保留相邻孔间黑色实体间隔后的孔底半径。
   */
  radius: number
  /**
   * 沿用牌目录的红白填色，不参与规则判断。
   */
  color: PipMark['color']
}

/**
 * 将牌目录点位转换为模型孔位。
 *
 * @param pips 原始牌点，仅做可视坐标换算
 * @returns 不相交的孔位，点数、颜色与中心位置保持不变
 */
export function readPipLayout(pips: PipMark[]): TilePip[] {
  return pips.map((mark, index) => {
    const nearest = pips.reduce((distance, other, otherIndex) => otherIndex === index
      ? distance
      : Math.min(distance, Math.hypot(mark.x - other.x, mark.y - other.y)), Infinity)
    // 部分旧牌目录的圆半径大于孔距的一半，真实开孔必须留下实体间隔，防止孔相交破坏剖分。
    const radius = Math.min(mark.radius ?? DEFAULT_PIP_RADIUS, nearest * 0.4) * TILE_UNIT
    return {
      x: (mark.x - TILE_METRICS.width / 2) * TILE_UNIT,
      y: (TILE_METRICS.height / 2 - mark.y) * TILE_UNIT,
      radius,
      color: mark.color,
    }
  })
}

/**
 * 获取直边、小倒角且带圆孔的完整牌壳。
 *
 * @param pips 已换算的三维孔位；空数组生成没有开孔的牌背模型
 * @returns 可供同类牌共享的牌壳几何体
 */
export function getTileGeometry(pips: TilePip[]): THREE.ExtrudeGeometry {
  const key = pips.map(({ x, y, radius }) => `${x},${y},${radius}`).join('|')
  const cached = geometryCache.get(key)
  if (cached) return cached
  const shape = createTileOutline()
  for (const pip of pips) {
    const hole = new THREE.Path()
    hole.absarc(pip.x, pip.y, pip.radius + PIP_BEVEL, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TILE_SIZE.depth - TILE_EDGE_BEVEL * 2,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: TILE_EDGE_BEVEL,
    bevelSize: TILE_EDGE_BEVEL,
    bevelSegments: 4,
    curveSegments: 16,
  })
  // 挤出默认从零开始，平移后保持现有摆位、翻面和碰撞使用的牌体中心及外尺寸。
  geometry.translate(0, 0, -TILE_SIZE.depth / 2 + TILE_EDGE_BEVEL)
  refineTileSurface(geometry, pips)
  geometryCache.set(key, geometry)
  return geometry
}

/**
 * 生成近似直角的牌面轮廓，极小的平面圆角只消除尖角，不把骨牌变成圆头牌。
 *
 * @returns 供牌壳挤出的封闭外轮廓
 */
function createTileOutline(): THREE.Shape {
  const x = TILE_SIZE.width / 2 - TILE_EDGE_BEVEL
  const y = TILE_SIZE.height / 2 - TILE_EDGE_BEVEL
  const radius = FACE_CORNER
  const shape = new THREE.Shape()
  shape.moveTo(-x + radius, -y)
  shape.lineTo(x - radius, -y)
  shape.absarc(x - radius, -y + radius, radius, -Math.PI / 2, 0)
  shape.lineTo(x, y - radius)
  shape.absarc(x - radius, y - radius, radius, 0, Math.PI / 2)
  shape.lineTo(-x + radius, y)
  shape.absarc(-x + radius, y - radius, radius, Math.PI / 2, Math.PI)
  shape.lineTo(-x, -y + radius)
  shape.absarc(-x + radius, -y + radius, radius, Math.PI, Math.PI * 1.5)
  shape.closePath()
  return shape
}

/**
 * 分别校准外倒角与孔沿，并写入连续曲面法线。
 *
 * @param geometry 已平移到牌中心的挤出几何体，直接原位更新
 * @param pips 牌面孔位，用于识别孔壁与外轮廓
 * @returns 无返回值
 */
function refineTileSurface(geometry: THREE.ExtrudeGeometry, pips: TilePip[]): void {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const halfDepth = TILE_SIZE.depth / 2
  for (let index = 0; index < positions.count; index += 1) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, index)
    const pip = pips.find((mark) => Math.hypot(point.x - mark.x, point.y - mark.y)
      <= mark.radius + PIP_BEVEL + 0.00001)
    const normal = pip ? refinePipEdge(point, pip) : readOuterNormal(point)
    positions.setXYZ(index, point.x, point.y, point.z)
    normals.setXYZ(index, normal.x, normal.y, normal.z)
  }
  // 内孔校准只改变孔壁，外包围尺寸仍保持原值，拖动、选牌与落桌高度不受影响。
  positions.needsUpdate = true
  normals.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.boundingBox?.min.setZ(-halfDepth)
  geometry.boundingBox?.max.setZ(halfDepth)
}

/**
 * 将孔沿收回较小加工尺度，避免外倒角加宽后使密集牌点相互侵入。
 *
 * @param point 当前孔沿或孔壁顶点，原位更新位置
 * @param pip 顶点所属的孔位
 * @returns 朝向孔腔的连续曲面法线
 */
function refinePipEdge(point: THREE.Vector3, pip: TilePip): THREE.Vector3 {
  const dx = point.x - pip.x
  const dy = point.y - pip.y
  const distance = Math.hypot(dx, dy)
  const sin = THREE.MathUtils.clamp((pip.radius + PIP_BEVEL - distance) / TILE_EDGE_BEVEL, 0, 1)
  const radius = pip.radius + PIP_BEVEL * (1 - sin)
  point.x = pip.x + dx / distance * radius
  point.y = pip.y + dy / distance * radius
  const halfDepth = TILE_SIZE.depth / 2
  const side = Math.sign(point.z)
  const depth = Math.abs(point.z)
  // 挤出器对内外轮廓共用一个倒角，孔沿的深度和半径必须同时缩小，才能保持真实圆弧截面。
  point.z = side * (depth >= halfDepth - TILE_EDGE_BEVEL
    ? halfDepth - (halfDepth - depth) * PIP_BEVEL / TILE_EDGE_BEVEL
    : depth * (halfDepth - PIP_BEVEL) / (halfDepth - TILE_EDGE_BEVEL))
  return new THREE.Vector3(-dx / distance * sin, -dy / distance * sin, side * Math.sqrt(1 - sin * sin))
}

/**
 * 计算方正牌体外缘的连续法线，消除挤出分段留下的硬折线高光。
 *
 * @param point 外轮廓顶点，坐标已经以牌体中心为原点
 * @returns 平面、直边或微小圆角对应的单位法线
 */
function readOuterNormal(point: THREE.Vector3): THREE.Vector3 {
  const dx = Math.max(Math.abs(point.x) - (TILE_SIZE.width / 2 - TILE_EDGE_BEVEL - FACE_CORNER), 0)
  const dy = Math.max(Math.abs(point.y) - (TILE_SIZE.height / 2 - TILE_EDGE_BEVEL - FACE_CORNER), 0)
  const distance = Math.hypot(dx, dy)
  const sin = THREE.MathUtils.clamp((distance - FACE_CORNER) / TILE_EDGE_BEVEL, 0, 1)
  const normal = new THREE.Vector3(Math.sign(point.x) * dx, Math.sign(point.y) * dy, 0).normalize()
  normal.multiplyScalar(sin)
  normal.z = Math.sign(point.z) * Math.sqrt(1 - sin * sin)
  return normal
}

/**
 * 创建半径为一、向牌内凹陷的浅碟形孔底。
 *
 * @returns 带曲面法线和孔沿遮蔽的共享几何体，调用方按实际孔半径等比缩放
 */
export function createPipWellGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let ring = 0; ring <= WELL_RINGS; ring += 1) {
    const radius = ring / WELL_RINGS
    const shade = 1 - 0.42 * radius ** 6
    for (let segment = 0; segment <= WELL_SEGMENTS; segment += 1) {
      const angle = segment / WELL_SEGMENTS * Math.PI * 2
      positions.push(radius * Math.cos(angle), radius * Math.sin(angle), 0.24 * (radius ** 2 - 1))
      colors.push(shade, shade, shade)
      if (ring === WELL_RINGS || segment === WELL_SEGMENTS) continue
      const vertex = ring * (WELL_SEGMENTS + 1) + segment
      const nextRing = vertex + WELL_SEGMENTS + 1
      // 由中心向外连接，正面法线始终朝 +Z，保证凹面正确受光且可被正常拾取。
      indices.push(vertex, nextRing, nextRing + 1, vertex, nextRing + 1, vertex + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
