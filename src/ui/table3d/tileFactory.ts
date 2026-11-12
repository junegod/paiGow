import * as THREE from 'three'

import type { PipMark } from '@/rules-core/types'
import { TILE_SIZE } from '@/ui/table3d/tableMetrics'
import { createPipWellGeometry, getTileGeometry, readPipLayout, TILE_EDGE_BEVEL } from '@/ui/table3d/tileGeometry'
import { createTileSurfaceTextures } from '@/ui/table3d/tileSurface'

/**
 * 同一套微表面纹理供所有牌共用，细纹只影响反光和法线，不绘制人为亮斑。
 */
const surfaceTextures = createTileSurfaceTextures()

/**
 * 所有摆放状态共用的黑色骨牌材质。
 *
 * 保留柔和的抛光光泽与微表面变化，配合偏轴面光形成明暗过渡，控制整面泛白。
 */
const tileMaterial = new THREE.MeshPhysicalMaterial({
  color: '#101214',
  metalness: 0,
  roughness: 0.44,
  roughnessMap: surfaceTextures.roughness,
  bumpMap: surfaceTextures.bump,
  bumpScale: 0.0015,
  specularIntensity: 0.58,
  clearcoat: 0.12,
  clearcoatRoughness: 0.38,
  envMapIntensity: 0.5,
})

/**
 * 侧壁与窄倒角略亮于正面，用克制的边缘高光交代厚度，避免黑牌轮廓融成剪影。
 */
const edgeMaterial = new THREE.MeshPhysicalMaterial({
  color: '#202327',
  metalness: 0,
  roughness: 0.35,
  roughnessMap: surfaceTextures.roughness,
  bumpMap: surfaceTextures.bump,
  bumpScale: 0.001,
  specularIntensity: 0.7,
  clearcoat: 0.18,
  clearcoatRoughness: 0.32,
  envMapIntensity: 0.7,
})

/**
 * 孔底共用的浅凹曲面及填色材质；保留填漆的柔和光泽，顶点颜色补充孔沿遮蔽。
 */
const wellGeometry = createPipWellGeometry()
const pipMaterials = {
  red: new THREE.MeshPhysicalMaterial({
    color: '#bd221b', roughness: 0.48, specularIntensity: 0.35, vertexColors: true, envMapIntensity: 0.25,
  }),
  white: new THREE.MeshPhysicalMaterial({
    color: '#e9e2d4', roughness: 0.54, specularIntensity: 0.3, vertexColors: true, envMapIntensity: 0.25,
  }),
}

/**
 * 完整背板位于牌壳背面之外，盖住贯穿建模的孔及孔沿，防止背面露出点位轮廓。
 */
const backingGeometry = new THREE.PlaneGeometry(
  TILE_SIZE.width - TILE_EDGE_BEVEL * 2 - 0.004,
  TILE_SIZE.height - TILE_EDGE_BEVEL * 2 - 0.004,
)

/**
 * 创建一张小倒角、直边和完整牌背的三维骨牌。
 *
 * @returns 正面朝本地 +Z 的牌对象；前两个直接子对象固定为牌体与完整背板
 */
export function createTileObject(): THREE.Group {
  const tile = new THREE.Group()
  // 挤出几何的第零材质组是前后平面，第一组是侧壁和倒角，分别控制可读性与立体层次。
  const body = new THREE.Mesh(getTileGeometry([]), [tileMaterial, edgeMaterial])
  body.castShadow = true
  body.receiveShadow = true
  const backing = new THREE.Mesh(backingGeometry, tileMaterial)
  backing.rotation.y = Math.PI
  // 背板必须略靠外：放在壳内只能挡住孔底，孔沿仍会在反光中暴露点位。
  backing.position.z = -TILE_SIZE.depth / 2 - 0.0005
  backing.receiveShadow = true
  // 所有网格直接挂在牌对象下，保持现有射线拾取通过 parent 查找实体牌的约定。
  tile.add(body, backing)
  return tile
}

/**
 * 根据原始牌点设置带真实开孔的牌面，或恢复完整暗牌。
 *
 * @param tile 由 createTileObject 创建的牌对象
 * @param pips 牌目录点位；空值或空数组表示不显示牌点
 * @returns 无返回值
 */
export function setTileFace(tile: THREE.Group, pips: PipMark[] | null): void {
  // 仅移除旧孔底，保留固定牌体和背板；几何体、材质共享，切换时不能单独释放。
  while (tile.children.length > 2) {
    tile.remove(tile.children[tile.children.length - 1])
  }
  const layout = readPipLayout(pips ?? [])
  const body = tile.children[0] as THREE.Mesh
  body.geometry = getTileGeometry(layout)
  for (const mark of layout) {
    const well = new THREE.Mesh(wellGeometry, pipMaterials[mark.color])
    well.scale.setScalar(mark.radius)
    well.castShadow = true
    // 孔沿低于牌面，孔底继续下凹；从侧面观察也不会出现凸起的玻璃珠。
    well.position.set(mark.x, mark.y, TILE_SIZE.depth / 2 - 0.014)
    tile.add(well)
  }
}
