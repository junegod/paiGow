import * as THREE from 'three'

/**
 * 骨牌微表面纹理的采样尺寸；纹理全局共用，不为每张牌重新生成。
 */
const SURFACE_SIZE = 256

/**
 * 黑色硬质骨牌的微表面纹理。
 */
interface TileSurfaceTextures {
  /**
   * 极浅的细纹高度，只打散高光，不改变硬质平面的轮廓。
   */
  bump: THREE.DataTexture
  /**
   * 抛光程度的细微差异，避免整张牌像没有材质的纯色平面。
   */
  roughness: THREE.DataTexture
}

/**
 * 生成细密、稳定的抛光纹理，不依赖外部图片或每帧随机噪声。
 *
 * @returns 可供所有牌体材质共享的高度与粗糙度纹理
 */
export function createTileSurfaceTextures(): TileSurfaceTextures {
  const bump = new Uint8Array(SURFACE_SIZE * SURFACE_SIZE * 4)
  const roughness = new Uint8Array(bump.length)
  for (let y = 0; y < SURFACE_SIZE; y += 1) {
    for (let x = 0; x < SURFACE_SIZE; x += 1) {
      const sample = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
      const grain = sample - Math.floor(sample)
      const polish = Math.sin(x * 0.13 + Math.sin(y * 0.07))
      const offset = (y * SURFACE_SIZE + x) * 4
      // 高度变化控制在很小范围，保留细腻的硬质抛光表面，避免变成粗砂或石材。
      const height = Math.round(128 + (grain - 0.5) * 14 + polish * 3)
      const finish = Math.round(232 + (grain - 0.5) * 16 + polish * 5)
      bump.set([height, height, height, 255], offset)
      roughness.set([finish, finish, finish, 255], offset)
    }
  }
  return { bump: createSurfaceTexture(bump), roughness: createSurfaceTexture(roughness) }
}

/**
 * 配置非颜色纹理的过滤与重复方式。
 *
 * @param pixels 四通道纹理数据，保持线性采样，不进行颜色空间转换
 * @returns 带多级缩小过滤的纹理，远近观察都不会闪烁或出现明显颗粒
 */
function createSurfaceTexture(pixels: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(pixels, SURFACE_SIZE, SURFACE_SIZE)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 2)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
