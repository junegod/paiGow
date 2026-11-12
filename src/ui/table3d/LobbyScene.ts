import * as THREE from 'three'

import type { PipMark } from '@/rules-core/types'
import { createDiceRig, orientDieForValue } from '@/ui/table3d/diceFactory'
import { buildRoom } from '@/ui/table3d/roomBuilder'
import { TILE_SIZE } from '@/ui/table3d/tableMetrics'
import { createTileObject, setTileFace } from '@/ui/table3d/tileFactory'

/**
 * 首页背景里立着展示的牌之间的横向间距。
 */
const SHOW_PITCH = TILE_SIZE.width + 0.34

/**
 * 首页画面横向需要完整露出的半宽，镜头视角按它反推，保证竖屏下一排展示牌不被裁掉。
 */
const SHOW_HALF_WIDTH = 3.5

/**
 * 镜头的基准位置和注视点。机位压得很低、贴近桌面，牌显得高大，桌面向远处退去，纵深感强。
 */
const CAMERA_BASE = new THREE.Vector3(0, 3.3, 10.6)
const CAMERA_LOOK = new THREE.Vector3(0, 1.5, 0)

/**
 * 画面整体上移的比例：屏幕下半部分要放按钮，展示牌需要落在屏幕中线偏上。
 * 屏幕较矮时标题和按钮之间本来就挤，上移得少一些，让牌落在标题下方。
 */
const VIEW_SHIFT_RATIO = 0.13
const VIEW_SHIFT_RATIO_SHORT = 0.03

/**
 * 宽高比超过这个值就按"较矮的屏幕"处理。
 */
const SHORT_SCREEN_ASPECT = 0.6

/**
 * 吊灯灯泡的位置。
 */
const LAMP_POSITION = new THREE.Vector3(0, 5.7, -2.6)

const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)

/**
 * 计算牌平放在桌面上的姿态。
 *
 * @param yaw 绕竖直轴的朝向（弧度）
 * @param faceDown 是否背面朝上
 * @returns 旋转四元数
 */
function flatPose(yaw: number, faceDown: boolean): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromAxisAngle(AXIS_Y, yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, faceDown ? Math.PI / 2 : -Math.PI / 2))
}

/**
 * 首页背景场景。
 *
 * 和牌桌用同一张木桌、同一套灯光和同样建模的牌，摆成前、中、后三层：
 * 近处是一摞垒好的牌和散牌，中间是一排立着的明牌，远处是骰碗和隐在暗处的一排牌背。
 * 镜头缓慢左右移动并跟随手指，近处和远处的物体移动幅度不同，立体感由此而来。
 */
export class LobbyScene {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  private readonly resizeObserver: ResizeObserver
  private readonly pointer = new THREE.Vector2()
  private readonly pointerEased = new THREE.Vector2()
  private frameHandle: number | null = null
  private disposed = false

  /**
   * 创建首页背景并挂到容器里。
   *
   * @param container 承载画布的元素
   * @param faces 立着展示的几张牌的牌面点位，从左到右
   * @throws 当前设备无法创建三维渲染上下文时抛出，由调用方退回纯色背景
   */
  constructor(container: HTMLElement, faces: PipMark[][]) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    container.appendChild(this.renderer.domElement)

    buildRoom(this.scene, this.renderer)
    /*
     * 首页的雾比牌桌更近更浓，远处的牌背只剩轮廓，把视线留在中间那排明牌上。
     */
    this.scene.fog = new THREE.Fog('#0b0705', 13, 30)
    this.placeShowTiles(faces)
    this.placeForeground(faces[2] ?? [])
    this.placeBackground()
    this.placeLamp()

    window.addEventListener('pointermove', this.handlePointerMove)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.frameHandle = requestAnimationFrame(this.renderFrame)
  }

  /**
   * 销毁场景，停止动画并释放显存。
   *
   * @returns 无返回值
   */
  dispose(): void {
    this.disposed = true
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle)
    }
    window.removeEventListener('pointermove', this.handlePointerMove)
    this.resizeObserver.disconnect()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      }
    })
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /**
   * 中景：一排立着的明牌，沿一道浅弧排开、微微后仰，正对镜头。
   *
   * @param faces 每张牌的牌面点位
   * @returns 无返回值
   */
  private placeShowTiles(faces: PipMark[][]): void {
    faces.forEach((pips, index) => {
      const offset = index - (faces.length - 1) / 2
      const tile = createTileObject()
      setTileFace(tile, pips)
      const lean = 0.1
      /*
       * 先转向再后仰，牌才会沿弧线朝向镜头；底边贴着桌面，所以中心高度随后仰角略降。
       */
      tile.quaternion
        .setFromAxisAngle(AXIS_Y, -offset * 0.2)
        .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, -lean))
      tile.position.set(
        offset * SHOW_PITCH,
        (Math.cos(lean) * TILE_SIZE.height) / 2 + (Math.sin(lean) * TILE_SIZE.depth) / 2,
        offset * offset * 0.34,
      )
      this.scene.add(tile)
    })
  }

  /**
   * 前景：左前方一摞垒好的牌（一墩四张，最上面一张亮着牌面），右前方两张随手放的牌背；
   * 都摆在明牌和底部操作面板之间露出的那一条桌面上，不会被面板挡住。
   * 它们离镜头最近，镜头移动时位移最大，是立体感的主要来源。
   *
   * @param topFace 那一墩最上面一张的牌面点位
   * @returns 无返回值
   */
  private placeForeground(topFace: PipMark[]): void {
    for (let layer = 0; layer < 4; layer += 1) {
      const tile = createTileObject()
      const isTop = layer === 3
      if (isTop) {
        setTileFace(tile, topFace)
      }
      tile.position.set(-2.8 + layer * 0.02, TILE_SIZE.depth / 2 + layer * TILE_SIZE.depth, 3.2)
      tile.quaternion.copy(flatPose(0.5 + layer * 0.05, !isTop))
      this.scene.add(tile)
    }

    const loose = [
      { x: 2.2, z: 2.6, yaw: -0.6 },
      { x: 3.4, z: 3.1, yaw: 0.5 },
    ]
    for (const item of loose) {
      const tile = createTileObject()
      tile.position.set(item.x, TILE_SIZE.depth / 2, item.z)
      tile.quaternion.copy(flatPose(item.yaw, true))
      this.scene.add(tile)
    }
  }

  /**
   * 远景：一只装着骰子的碗，和更远处隐在暗里的一排牌背。
   *
   * @returns 无返回值
   */
  private placeBackground(): void {
    /*
     * 碗里摆三点和六点，对应玩法里的"赏"。
     */
    const rig = createDiceRig()
    rig.group.position.set(2.5, 0, -3)
    ;[3, 6].forEach((value, index) => {
      rig.dice[index].visible = true
      rig.dice[index].quaternion.copy(orientDieForValue(value, 0.6 + index * 1.3))
    })
    this.scene.add(rig.group)

    for (let index = 0; index < 8; index += 1) {
      const tile = createTileObject()
      tile.position.set((index - 3.5) * (TILE_SIZE.width + 0.06), TILE_SIZE.height / 2, -6.6)
      tile.rotation.y = Math.PI + Math.sin(index * 12.9898) * 0.04
      this.scene.add(tile)
    }
  }

  /**
   * 吊灯：一根灯绳、一颗发光的灯泡和一圈光晕，交代光从哪里来，也让画面上方不是一片死黑。
   *
   * @returns 无返回值
   */
  private placeLamp(): void {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#fff3cf' }),
    )
    bulb.position.copy(LAMP_POSITION)
    this.scene.add(bulb)

    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#1a120c' }),
    )
    cord.position.copy(LAMP_POSITION).setY(LAMP_POSITION.y + 4.2)
    this.scene.add(cord)

    /*
     * 光晕是一张径向渐变贴图，叠加混合；不受雾影响，否则会被压成一团灰。
     */
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
      gradient.addColorStop(0, 'rgba(255, 226, 170, 0.95)')
      gradient.addColorStop(0.25, 'rgba(255, 190, 110, 0.38)')
      gradient.addColorStop(1, 'rgba(255, 170, 90, 0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 256, 256)
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    )
    glow.position.copy(LAMP_POSITION)
    glow.scale.setScalar(7.5)
    this.scene.add(glow)

    /*
     * 灯泡自己再补一盏近处的暖光，照亮牌的顶边和碗沿。
     */
    const warm = new THREE.PointLight('#ffcf8f', 60, 16, 1.8)
    warm.position.copy(LAMP_POSITION)
    this.scene.add(warm)
  }

  /**
   * 记录首页指针位置，作为镜头轻微偏移的输入，不改变牌桌业务状态。
   *
   * @param event 浏览器指针移动事件。
   * @returns 无返回值。
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1)
  }

  /**
   * 按容器大小调整画布和镜头视角。
   *
   * @returns 无返回值
   */
  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    /*
     * 容器尚未布局时宽高为 0，不能计算宽高比。
     */
    if (width === 0 || height === 0) {
      return
    }
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    const vertical = 2 * Math.atan(SHOW_HALF_WIDTH / CAMERA_BASE.length() / this.camera.aspect)
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vertical), 34, 74)
    const shiftRatio = this.camera.aspect > SHORT_SCREEN_ASPECT ? VIEW_SHIFT_RATIO_SHORT : VIEW_SHIFT_RATIO
    this.camera.setViewOffset(width, height, 0, height * shiftRatio, width, height)
  }

  /**
   * 推进首页镜头的慢速环绕与指针缓动，销毁后停止申请动画帧。
   *
   * @param time 浏览器动画帧时间戳，单位为毫秒。
   * @returns 无返回值。
   */
  private readonly renderFrame = (time: number): void => {
    if (this.disposed) {
      return
    }
    /*
     * 镜头沿一条很慢的环线自己移动，再叠加手指或鼠标带来的偏移；偏移做缓动，避免跟手抖动。
     */
    this.pointerEased.lerp(this.pointer, 0.05)
    const drift = time / 1000
    this.camera.position.set(
      CAMERA_BASE.x + Math.sin(drift * 0.28) * 1.15 + this.pointerEased.x * 1.3,
      CAMERA_BASE.y + Math.sin(drift * 0.21) * 0.22 - this.pointerEased.y * 0.4,
      CAMERA_BASE.z + Math.cos(drift * 0.28) * 0.35,
    )
    this.camera.lookAt(CAMERA_LOOK)
    this.renderer.render(this.scene, this.camera)
    this.frameHandle = requestAnimationFrame(this.renderFrame)
  }
}
