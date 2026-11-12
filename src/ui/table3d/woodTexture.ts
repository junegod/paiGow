import * as THREE from 'three'

/**
 * 程序生成的实木桌面贴图。
 *
 * 不依赖外部图片素材，避免授权和包体问题；后续如需换成真实木纹照片，只替换本文件即可。
 */

/**
 * 贴图边长（像素）。
 */
const TEXTURE_SIZE = 1024

/**
 * 桌面由几块木板拼成。
 */
const PLANK_COUNT = 3

/**
 * 木纹最深处和最浅处的颜色（红绿蓝分量）。
 */
const WOOD_DARK = [44, 20, 10]
const WOOD_LIGHT = [124, 68, 34]

/**
 * 已生成的木纹画布。逐像素计算较慢，同一次运行里只算一遍，多次进入牌桌时复用。
 */
let cachedCanvas: HTMLCanvasElement | null = null

/**
 * 二维取值噪声，用于让木纹的走向自然弯曲。
 *
 * @param x 横向采样坐标
 * @param y 纵向采样坐标
 * @returns 0 到 1 之间的平滑随机值
 */
function valueNoise(x: number, y: number): number {
  /**
   * 获取整数格点的固定伪随机值，保证同一坐标的木纹采样始终一致。
   *
   * @param ix 横向整数格点坐标。
   * @param iy 纵向整数格点坐标。
   * @returns 零到一之间的固定采样值。
   */
  const hash = (ix: number, iy: number): number => {
    const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx
  return top + (bottom - top) * sy
}

/**
 * 逐像素绘制木纹：宽木板拼缝、被噪声扭曲的宽年轮带、顺纹方向的细木丝。
 *
 * 年轮带宽且弯曲才读得出是木头；等距的细直条会像竹子。
 *
 * @returns 画好木纹的画布
 */
function paintWoodCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const context = canvas.getContext('2d')
  /*
   * 极少数环境拿不到二维画布上下文，此时返回空白画布，桌面退化为材质底色而不是报错。
   */
  if (!context) {
    return canvas
  }
  const image = context.createImageData(TEXTURE_SIZE, TEXTURE_SIZE)
  const plankWidth = TEXTURE_SIZE / PLANK_COUNT

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const plank = Math.floor(x / plankWidth)
      /*
       * 每块木板用不同的噪声偏移和明暗，拼在一起才不像同一张图平铺。
       */
      const warp =
        valueNoise(x * 0.005 + plank * 9.7, y * 0.0016 + plank * 3.1) * 150 + valueNoise(x * 0.02, y * 0.006) * 14
      const ring = Math.sin((x + warp) * 0.034 + plank * 2.3)
      const fibre = valueNoise(x * 0.42 + plank * 17, y * 0.012) - 0.5
      const pore = valueNoise(x * 0.9, y * 0.05) - 0.5
      const plankTone = (valueNoise(plank * 5.3, 0.5) - 0.5) * 0.16
      let tone = 0.46 + ring * 0.26 + fibre * 0.2 + pore * 0.08 + plankTone
      /*
       * 拼缝两侧压暗，形成木板之间的细缝。
       */
      const seam = Math.min(x % plankWidth, plankWidth - (x % plankWidth))
      if (seam < 2.5) {
        tone *= 0.35
      }
      tone = Math.min(Math.max(tone, 0), 1)
      const offset = (y * TEXTURE_SIZE + x) * 4
      image.data[offset] = WOOD_DARK[0] + (WOOD_LIGHT[0] - WOOD_DARK[0]) * tone
      image.data[offset + 1] = WOOD_DARK[1] + (WOOD_LIGHT[1] - WOOD_DARK[1]) * tone
      image.data[offset + 2] = WOOD_DARK[2] + (WOOD_LIGHT[2] - WOOD_DARK[2]) * tone
      image.data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * 创建实木贴图。
 *
 * @param anisotropy 各向异性过滤级别，斜着看桌面时让远处木纹保持清晰
 * @returns 可用作颜色贴图和凹凸贴图的纹理
 */
export function createWoodTexture(anisotropy: number): THREE.CanvasTexture {
  cachedCanvas ??= paintWoodCanvas()
  const texture = new THREE.CanvasTexture(cachedCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}
