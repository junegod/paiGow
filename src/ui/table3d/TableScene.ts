import * as THREE from 'three'

import { DiceAnimator, type DiceState } from '@/ui/table3d/diceAnimator'
import { HandDragController } from '@/ui/table3d/handDragController'
import { buildRoom } from '@/ui/table3d/roomBuilder'
import {
  CAMERA_HOME,
  CAMERA_TARGET,
  HAND_CENTER,
  HAND_LIFT,
  HAND_REVEAL_DURATION_MS,
  HAND_SIZE,
  HAND_TILT,
  TABLE_HALF,
  TILE_PITCH,
  TILE_SIZE,
  type Point3,
} from '@/ui/table3d/tableMetrics'
import type { TileLandingKind, TilePick, TilePlacement, TilePose } from '@/ui/table3d/tableView'
import { createTileObject, setTileFace } from '@/ui/table3d/tileFactory'
import { advanceTileMotion, type TileMotionTarget } from '@/ui/table3d/tileMotion'

/**
 * 场景向界面层回报的事件。
 */
export interface TableSceneCallbacks {
  /**
   * 玩家点了一张牌。
   */
  onPick: (pick: TilePick) => void
  /**
   * 玩家拖动手牌改变了顺序，参数是新的手牌标识顺序。
   */
  onHandReorder: (cardIds: string[]) => void
  /**
   * 手牌顶边到容器底边的像素距离变化，界面据此把出牌按钮放到手牌上方。
   */
  onHandTop: (distanceFromBottom: number) => void
  /**
   * 玩家点了骰碗。是否允许掷骰由界面层按规则判断。
   */
  onBowlPick: () => void
  /**
   * 局内掷骰的骰碗已回到桌面并完成渲染，可以展示已收到的出牌。
   */
  onDiceDocked: () => void
  /**
   * 收牌代表牌实际落稳；只回报碰撞类型，音频开关和播放由界面层统一处理。
   */
  onTileLand: (kind: TileLandingKind) => void
}

/**
 * 需要跟随三维位置移动的界面元素，例如对手头像和骰碗下方的文字。
 */
export interface SceneAnchor {
  /**
   * 需要定位的界面节点；未挂载时跳过投影更新。
   */
  element: HTMLElement | null
  /**
   * 界面节点在三维场景中的跟随位置。
   */
  point: Point3
}

/**
 * 场景里的一张实体牌。
 */
interface TileEntity extends TileMotionTarget {
  /**
   * 实体在当前场景内的稳定标识，用于跨帧复用牌体。
   */
  key: string
  /**
   * 当前使用的牌面定义标识；为空表示没有真实牌面。
   */
  faceKey: string | null
  /**
   * 点击时对应的业务对象；为空表示该实体只参与展示。
   */
  pick: TilePick | null
}

/**
 * 一次按下到抬起之间的指针状态，用来区分"点一下"和"拖动手牌"。
 */
interface PointerSession {
  /**
   * 按下时命中的牌；为空表示按下的是骰碗或桌面空白处。
   */
  entity: TileEntity | null
  /**
   * 按在桌面空白处时记下当时的视角偏转，拖动就在它的基础上转动视角；按在牌或骰碗上时为空。
   */
  orbitFrom: { yaw: number; pitch: number } | null
  startX: number
  startY: number
  dragging: boolean
}

/**
 * 指针移动超过这个像素数才算拖动，否则按点击处理，避免手指轻微抖动误判。
 */
const DRAG_THRESHOLD = 10

/**
 * 跟随元素距离屏幕左右、上边缘的最小留白（像素）。
 */
const ANCHOR_EDGE_MARGIN = 40

/**
 * 镜头垂直视角的上下限（度）。
 */
const CAMERA_FOV_MIN = 40
const CAMERA_FOV_MAX = 80

/**
 * 桌子远端在屏幕上距顶部至少留出的高度（像素），用来放对手头像。
 */
const TABLE_TOP_MARGIN = 150

/**
 * 拖动桌面空白处转动视角的范围（弧度）：左右各能转多少，以及上下能抬高、压低多少。
 */
const ORBIT_YAW_LIMIT = 0.6
const ORBIT_PITCH_UP_LIMIT = 0.14
const ORBIT_PITCH_DOWN_LIMIT = 0.3

/**
 * 手指横向划过整个屏幕宽度、纵向划过整个屏幕高度时，视角分别转过的弧度。
 */
const ORBIT_YAW_PER_SCREEN = 1.5
const ORBIT_PITCH_PER_SCREEN = 0.9

/**
 * 松手后视角每帧回正的比例，以及小于多少弧度就直接归零。
 */
const ORBIT_RETURN_RATE = 0.14
const ORBIT_EPSILON = 0.002

const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)

/**
 * 把纯数据的点转成向量。
 *
 * @param point 三维点
 * @returns 新的向量对象
 */
function toVector(point: Point3): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z)
}

/**
 * 把姿态描述换算成旋转。
 *
 * @param pose 姿态描述
 * @returns 对应的旋转四元数
 */
function poseToQuaternion(pose: TilePose): THREE.Quaternion {
  if (pose.mode === 'lean') {
    // 抓牌时背朝玩家，亮牌时沿自身长轴翻半圈；翻完的标准姿态仍保持端正朝向。
    return new THREE.Quaternion().setFromAxisAngle(AXIS_X, -HAND_TILT)
      .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, pose.faceDown ? Math.PI : 0))
  }
  const turn = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, pose.yaw)
  if (pose.mode === 'upright') {
    return turn
  }
  // 出牌和牌墩仅按座位转向并平放，正反面都与桌面平行，不再应用多张牌的侧倾。
  const lay = new THREE.Quaternion().setFromAxisAngle(AXIS_X, pose.faceDown ? Math.PI / 2 : -Math.PI / 2)
  return turn.multiply(lay)
}

/**
 * 三维牌桌场景。
 *
 * 只负责渲染和动画：外部给出每张牌的目标摆位，场景把牌平滑移动到位，
 * 并把点牌、拖牌等手势回报给界面层。场景本身不理解任何规则。
 */
export class TableScene {
  private readonly container: HTMLElement
  private readonly callbacks: TableSceneCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  private readonly raycaster = new THREE.Raycaster()
  private readonly resizeObserver: ResizeObserver
  private readonly tiles = new Map<string, TileEntity>()
  private readonly entityByObject = new WeakMap<THREE.Object3D, TileEntity>()
  private readonly dice = new DiceAnimator()
  /**
   * 本次回桌需要回报落位；开局仪式中骰碗的移动不触发这个回调。
   */
  private notifyDiceDocked = false
  /**
   * 维护拖动中的固定牌槽和即时牌序，避免把邻牌动画位置当成排序依据。
   */
  private readonly handDrag = new HandDragController()
  private anchors: SceneAnchor[] = []
  private orbitYaw = 0
  private orbitPitch = 0
  private orbitHeld = false
  private pointerSession: PointerSession | null = null
  private handInteractive = false
  private bottomInset = 0
  private frameHandle: number | null = null
  private disposed = false

  /**
   * 创建场景并挂到容器里。
   *
   * @param container 承载画布的元素，场景大小始终跟随它
   * @param callbacks 手势与布局回调
   * @throws 当前设备无法创建三维渲染上下文时抛出，由调用方给出降级提示
   */
  constructor(container: HTMLElement, callbacks: TableSceneCallbacks) {
    this.container = container
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    /*
     * 高分屏最多按 2 倍渲染，避免手机上像素数过大导致掉帧。
     */
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)

    buildRoom(this.scene, this.renderer)
    this.scene.add(this.dice.object)
    this.camera.position.copy(toVector(CAMERA_HOME))

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel)
    this.resizeObserver = new ResizeObserver(() => this.fitCamera())
    this.resizeObserver.observe(container)
    this.fitCamera()
  }

  /**
   * 更新每张牌的目标摆位。
   *
   * 已存在的牌飞向新位置，新出现的牌从出生点飞入，清单里没有的牌直接移除。
   *
   * @param placements 当前牌局对应的全部摆位
   * @returns 无返回值
   */
  setPlacements(placements: TilePlacement[]): void {
    const now = performance.now()
    const seenKeys = new Set<string>()

    for (const placement of placements) {
      seenKeys.add(placement.key)
      let entity = this.tiles.get(placement.key)
      let spawned = false

      /*
       * 手牌打出后标识会变，沿用手里那张实体牌，动画才是"这张牌飞出去"而不是凭空出现。
       */
      if (!entity && placement.inheritKey) {
        const inherited = this.tiles.get(placement.inheritKey)
        if (inherited) {
          this.tiles.delete(placement.inheritKey)
          inherited.key = placement.key
          this.tiles.set(placement.key, inherited)
          entity = inherited
        }
      }
      if (!entity) {
        entity = this.spawnTile(placement)
        spawned = true
      }
      if (spawned || entity.faceKey !== placement.faceKey) {
        setTileFace(entity.object, placement.pips)
        entity.faceKey = placement.faceKey
      }
      entity.pick = placement.pick
      this.retarget(entity, placement, now + (spawned ? placement.spawnDelay : placement.moveDelay), spawned)
    }

    for (const [key, entity] of this.tiles) {
      if (!seenKeys.has(key)) {
        this.scene.remove(entity.object)
        this.tiles.delete(key)
        /*
         * 被移除的牌如果正被拖着，必须结束这次拖动，否则抬手时会操作一张已不存在的牌。
         */
        if (this.pointerSession?.entity === entity) {
          this.handDrag.end()
          this.pointerSession = null
        }
      }
    }
    this.requestRender()
  }

  /**
   * 登记需要跟随三维位置移动的界面元素。
   *
   * @param anchors 元素及其对应的三维位置
   * @returns 无返回值
   */
  setAnchors(anchors: SceneAnchor[]): void {
    this.anchors = anchors
    this.fitCamera()
  }

  /**
   * 更新骰子的展示状态。
   *
   * 开始掷骰时把碗端到镜头前并让骰子翻滚，结束后放回桌上；点数始终以传入的结果为准。
   *
   * @param state 骰子点数及骰碗展示、回桌或避让的位置状态。
   * @returns 无返回值
   */
  setDice(state: DiceState): void {
    this.dice.setState(state)
    this.notifyDiceDocked = state.returning
    this.requestRender()
  }

  /**
   * 设置手牌是否可操作。不可操作时点手牌和拖手牌都不响应。
   *
   * @param enabled 是否可操作
   * @returns 无返回值
   */
  setHandInteractive(enabled: boolean): void {
    this.handInteractive = enabled
    /*
     * 交互被关闭时如果正在拖牌，放弃这次拖动并让牌回到原位。
     */
    if (!enabled && this.pointerSession?.dragging && this.pointerSession.entity) {
      this.handDrag.end()
      this.settle(this.pointerSession.entity)
      this.pointerSession = null
    }
  }

  /**
   * 设置画面底部被操作栏占用的高度，手牌会摆在这段高度之上。
   *
   * @param inset 底部占用高度（像素）
   * @returns 无返回值
   */
  setBottomInset(inset: number): void {
    if (inset !== this.bottomInset) {
      this.bottomInset = inset
      this.fitCamera()
    }
  }

  /**
   * 销毁场景，释放显存并移除事件监听。
   *
   * @returns 无返回值
   */
  dispose(): void {
    this.disposed = true
    this.handDrag.end()
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle)
    }
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.handlePointerDown)
    canvas.removeEventListener('pointermove', this.handlePointerMove)
    canvas.removeEventListener('pointerup', this.handlePointerUp)
    canvas.removeEventListener('pointercancel', this.handlePointerCancel)
    /*
     * 只释放显卡侧资源；共用的牌几何体和材质下次进入牌桌时会自动重新上传。
     */
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      }
    })
    this.scene.environment?.dispose()
    this.renderer.dispose()
    canvas.remove()
  }

  /**
   * 在出生点创建一张新牌。
   *
   * @param placement 这张牌的摆位
   * @returns 新建的实体牌，目标暂时等于出生点
   */
  private spawnTile(placement: TilePlacement): TileEntity {
    const object = createTileObject()
    object.position.copy(toVector(placement.spawn.position))
    object.quaternion.copy(poseToQuaternion(placement.spawn.pose))
    this.scene.add(object)
    const entity: TileEntity = {
      key: placement.key,
      object,
      faceKey: null,
      pick: null,
      targetPosition: object.position.clone(),
      targetQuaternion: object.quaternion.clone(),
      targetScale: 1,
      flight: null,
    }
    this.tiles.set(placement.key, entity)
    this.entityByObject.set(object, entity)
    return entity
  }

  /**
   * 给一张牌设定新的目标摆位，目标有变化时启动飞行动画。
   *
   * @param entity 实体牌
   * @param placement 新摆位
   * @param start 动画开始时间戳（毫秒）
   * @param force 是否无条件启动动画，新出现的牌使用
   * @returns 无返回值
   */
  private retarget(entity: TileEntity, placement: TilePlacement, start: number, force: boolean): void {
    const position = toVector(placement.position)
    const quaternion = poseToQuaternion(placement.pose)
    const scale = placement.scale ?? 1
    const hasMoved = entity.targetPosition.distanceToSquared(position) >= 1e-6
    const unchanged =
      !hasMoved &&
      entity.targetQuaternion.angleTo(quaternion) < 1e-3 &&
      entity.targetScale === scale
    if (unchanged && !force) {
      return
    }
    entity.targetPosition.copy(position)
    entity.targetQuaternion.copy(quaternion)
    entity.targetScale = scale
    /*
     * 正在被拖动的牌位置由手指决定，只记住新目标，抬手后再飞过去。
     */
    if (this.pointerSession?.dragging && this.pointerSession.entity === entity) {
      return
    }
    // 首次恢复历史牌堆和原地翻面都不算新收牌，只有已有实体真正换位置时才允许发声。
    this.settle(entity, start, {
      moveDuration: placement.moveDuration,
      landingKind: !force && hasMoved ? placement.landingKind : undefined,
    })
  }

  /**
   * 让一张牌从当前位置飞向它的目标摆位。
   *
   * @param entity 实体牌
   * @param start 动画开始时间戳（毫秒），默认立即开始
   * @param motion 可选的移动时长和落位类型，普通手势动画不传入。
   * @returns 无返回值
   */
  private settle(
    entity: TileEntity,
    start = performance.now(),
    motion?: Pick<TilePlacement, 'moveDuration' | 'landingKind'>,
  ): void {
    const distance = entity.object.position.distanceTo(entity.targetPosition)
    const turn = entity.object.quaternion.angleTo(entity.targetQuaternion)
    // 开局翻牌位于手牌区域，只需轻抬；桌面翻牌仍抬高避开桌面与下面的牌。
    const handFlip = entity.pick?.type === 'hand' && distance < 0.1 && turn > Math.PI / 2
    let arc = distance > 1.2 ? Math.min(1.6, 0.35 + distance * 0.14) : 0
    if (turn > 0.5) {
      arc = Math.max(arc, handFlip ? 0.12 : 0.9)
    }
    entity.flight = {
      fromPosition: entity.object.position.clone(),
      fromQuaternion: entity.object.quaternion.clone(),
      fromScale: entity.object.scale.x,
      start,
      duration: motion?.moveDuration ?? (handFlip
        ? HAND_REVEAL_DURATION_MS
        : THREE.MathUtils.clamp(170 + distance * 42 + turn * 60, 170, 480)),
      arc,
      handFlip,
      landingKind: motion?.landingKind,
    }
    this.requestRender()
  }

  /**
   * 按容器大小调整镜头，并重新摆放头像。
   *
   * 以"八张手牌的宽度"反推视角，保证手牌一排完整可见；画面偏宽时再放大视角让整张桌子入镜；
   * 最后整体上移画面，让手牌底边正好落在底部操作栏上方。
   *
   * @returns 无返回值
   */
  private fitCamera(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    /*
     * 容器尚未布局或被隐藏时宽高为 0，此时不能计算宽高比。
     */
    if (this.disposed || width === 0 || height === 0) {
      return
    }
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    /*
     * 视角和画面偏移都按"没有转动视角"的标准机位来算，算完再把玩家转动的角度叠加回去。
     */
    this.camera.position.copy(toVector(CAMERA_HOME))
    const handCenter = toVector(HAND_CENTER)
    const up = new THREE.Vector3(0, Math.cos(HAND_TILT), -Math.sin(HAND_TILT))
    const handBottom = handCenter.clone().addScaledVector(up, -TILE_SIZE.height / 2)
    const tableFarEdge = new THREE.Vector3(0, 0, -TABLE_HALF)
    const halfWidth = (HAND_SIZE * TILE_PITCH) / 2 + 0.3
    const widthFit = 2 * Math.atan(halfWidth / this.camera.position.distanceTo(handCenter) / this.camera.aspect)
    let fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(widthFit), CAMERA_FOV_MIN, CAMERA_FOV_MAX)

    /*
     * 竖屏按手牌宽度定视角即可；画面偏宽（平板、桌面窗口）时这样算出的视角太小，
     * 桌子远端和对家会被顶出屏幕。此时逐步放大视角，直到桌子远端回到顶部留白以内。
     */
    for (;;) {
      this.camera.fov = fov
      this.camera.clearViewOffset()
      this.camera.lookAt(toVector(CAMERA_TARGET))
      this.camera.updateProjectionMatrix()
      this.camera.updateMatrixWorld()
      const shift = this.projectToPixels(handBottom, width, height).y - (height - this.bottomInset)
      this.camera.setViewOffset(width, height, 0, shift, width, height)
      const farEdgeTop = this.projectToPixels(tableFarEdge, width, height).y
      if (farEdgeTop >= TABLE_TOP_MARGIN || fov >= CAMERA_FOV_MAX) {
        break
      }
      fov = Math.min(fov + 2, CAMERA_FOV_MAX)
    }

    const handTop = handCenter.clone().addScaledVector(up, TILE_SIZE.height / 2 + HAND_LIFT)
    this.callbacks.onHandTop(height - this.projectToPixels(handTop, width, height).y)
    this.applyOrbit()
    this.placeAnchors(width, height)
    this.requestRender()
  }

  /**
   * 把三维点投影成容器内的像素坐标。
   *
   * @param point 三维点
   * @param width 容器宽度
   * @param height 容器高度
   * @returns 像素坐标，原点在容器左上角
   */
  private projectToPixels(point: THREE.Vector3, width: number, height: number): { x: number; y: number } {
    const projected = point.clone().project(this.camera)
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height }
  }

  /**
   * 把跟随元素摆到各自三维位置在屏幕上的投影处。
   *
   * @param width 容器宽度
   * @param height 容器高度
   * @returns 无返回值
   */
  private placeAnchors(width: number, height: number): void {
    for (const anchor of this.anchors) {
      if (!anchor.element) {
        continue
      }
      const pixel = this.projectToPixels(toVector(anchor.point), width, height)
      /*
       * 竖屏很窄，左右两家的锚点可能落到屏幕外，这里夹回屏幕边缘内侧。
       */
      const x = THREE.MathUtils.clamp(pixel.x, ANCHOR_EDGE_MARGIN, width - ANCHOR_EDGE_MARGIN)
      const y = Math.max(pixel.y, ANCHOR_EDGE_MARGIN)
      anchor.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    }
  }

  /**
   * 按当前的视角偏转摆放镜头：以桌面注视点为圆心，在标准机位的基础上左右转、上下抬压。
   *
   * @returns 无返回值
   */
  private applyOrbit(): void {
    const target = toVector(CAMERA_TARGET)
    const offset = new THREE.Spherical().setFromVector3(toVector(CAMERA_HOME).sub(target))
    offset.theta += this.orbitYaw
    offset.phi -= this.orbitPitch
    this.camera.position.setFromSpherical(offset).add(target)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
  }

  /**
   * 推进视角回正：玩家松手后视角缓缓转回标准机位，保证手牌和头像回到原来的位置。
   *
   * @returns 视角是否仍偏离标准机位，场景据此决定是否继续渲染
   */
  private advanceOrbit(): boolean {
    if (this.orbitYaw === 0 && this.orbitPitch === 0) {
      return false
    }
    if (!this.orbitHeld) {
      this.orbitYaw *= 1 - ORBIT_RETURN_RATE
      this.orbitPitch *= 1 - ORBIT_RETURN_RATE
      if (Math.abs(this.orbitYaw) < ORBIT_EPSILON && Math.abs(this.orbitPitch) < ORBIT_EPSILON) {
        this.orbitYaw = 0
        this.orbitPitch = 0
      }
    }
    this.applyOrbit()
    /*
     * 头像和骰碗文字跟着三维位置走，视角一动就要重新摆。
     */
    this.placeAnchors(this.container.clientWidth, this.container.clientHeight)
    return !this.orbitHeld
  }

  /**
   * 找出指针位置下最靠前的一张可点击的牌。
   *
   * @param event 指针事件
   * @returns 命中的实体牌；没有命中可点击的牌时返回空
   */
  private pickEntity(event: PointerEvent): TileEntity | null {
    this.updateRay(event)
    const objects = [...this.tiles.values()].filter((entity) => entity.pick).map((entity) => entity.object)
    const hit = this.raycaster.intersectObjects(objects, true)[0]
    const owner = hit?.object.parent
    return owner ? this.entityByObject.get(owner) ?? null : null
  }

  /**
   * 按指针位置更新拾取射线。
   *
   * @param event 指针事件
   * @returns 无返回值
   */
  private updateRay(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(pointer, this.camera)
  }

  /**
   * 建立点击或拖动会话；按下手牌时记录固定牌槽，达到拖动阈值后才启动换位。
   *
   * @param event 指针按下事件
   * @returns 无返回值
   */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    const entity = this.pickEntity(event)
    // 没点到牌时再看是否点到骰碗；掷骰展示期间碗在半空中，不接受点击。
    if (!entity && !this.dice.isRolling && this.raycaster.intersectObject(this.dice.bowl).length > 0) {
      this.pointerSession = { entity: null, orbitFrom: null, startX: event.clientX, startY: event.clientY, dragging: false }
      return
    }
    // 按在桌面空白处才允许转动视角，避免拖牌同时带动镜头。
    if (!entity) {
      this.orbitHeld = true
      this.pointerSession = {
        entity: null,
        orbitFrom: { yaw: this.orbitYaw, pitch: this.orbitPitch },
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      }
      this.renderer.domElement.setPointerCapture(event.pointerId)
      return
    }
    // 手牌不可操作时不建立会话，点和拖都不会生效；桌面上的墩仍可点开查看。
    if (entity.pick?.type === 'hand' && !this.handInteractive) {
      return
    }
    this.pointerSession = { entity, orbitFrom: null, startX: event.clientX, startY: event.clientY, dragging: false }
    if (entity.pick?.type === 'hand') {
      const hand = [...this.tiles.values()].flatMap((item) => item.pick?.type === 'hand'
        ? [{ cardId: item.pick.cardId, object: item.object, slot: item.targetPosition }]
        : [])
      this.handDrag.begin({ cardId: entity.pick.cardId, object: entity.object, slot: entity.targetPosition }, hand, this.raycaster.ray)
    }
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }

  /**
   * 移动视角或拖动手牌；拖牌跨槽时立即保存新牌序，让相邻牌在松手前就平滑让位。
   *
   * @param event 指针移动事件
   * @returns 无返回值
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    const session = this.pointerSession
    if (session?.orbitFrom) {
      // 仅桌面手势改变视角，限制偏转范围以保持手牌仍在可见区域。
      const turn = ((event.clientX - session.startX) / this.container.clientWidth) * ORBIT_YAW_PER_SCREEN
      const tilt = ((event.clientY - session.startY) / this.container.clientHeight) * ORBIT_PITCH_PER_SCREEN
      this.orbitYaw = THREE.MathUtils.clamp(session.orbitFrom.yaw - turn, -ORBIT_YAW_LIMIT, ORBIT_YAW_LIMIT)
      this.orbitPitch = THREE.MathUtils.clamp(
        session.orbitFrom.pitch - tilt,
        -ORBIT_PITCH_DOWN_LIMIT,
        ORBIT_PITCH_UP_LIMIT,
      )
      this.requestRender()
      return
    }
    const entity = session?.entity
    if (!session || !entity || entity.pick?.type !== 'hand') {
      return
    }
    if (!session.dragging && Math.abs(event.clientX - session.startX) < DRAG_THRESHOLD) {
      return
    }
    session.dragging = true
    entity.flight = null
    this.updateRay(event)
    const order = this.handDrag.move(this.raycaster.ray)
    if (order) {
      this.callbacks.onHandReorder(order)
    }
    this.requestRender()
  }

  /**
   * 松手后将前景预览吸附到已经换好的槽位；点击仍走原来的选牌或查看入口。
   *
   * @param event 指针释放事件
   * @returns 无返回值
   */
  private readonly handlePointerUp = (event: PointerEvent): void => {
    const session = this.pointerSession
    this.pointerSession = null
    this.handDrag.end()
    if (!session) {
      return
    }
    const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
    if (session.orbitFrom) {
      this.orbitHeld = false
      this.requestRender()
      return
    }
    if (!session.entity) {
      if (moved < DRAG_THRESHOLD) {
        this.callbacks.onBowlPick()
      }
      return
    }
    if (session.dragging) {
      // 顺序已在移动时保存，释放时只吸附到新槽，避免先飞回旧位置又折返。
      this.settle(session.entity)
      return
    }
    if (moved < DRAG_THRESHOLD && session.entity.pick) {
      this.callbacks.onPick(session.entity.pick)
    }
  }

  /**
   * 系统手势取消时恢复原牌序并结束前景预览，不触发点击选牌。
   *
   * @returns 无返回值
   */
  private readonly handlePointerCancel = (): void => {
    const originalOrder = this.handDrag.end(true)
    if (originalOrder) {
      this.callbacks.onHandReorder(originalOrder)
    }
    if (this.pointerSession?.dragging && this.pointerSession.entity) {
      this.settle(this.pointerSession.entity)
    }
    this.orbitHeld = false
    this.pointerSession = null
    this.requestRender()
  }

  /**
   * 申请渲染下一帧。没有动画时场景是静止的，不持续渲染，减少手机发热和耗电。
   *
   * @returns 无返回值
   */
  private requestRender(): void {
    if (this.frameHandle === null && !this.disposed) {
      this.frameHandle = requestAnimationFrame(this.renderFrame)
    }
  }

  /**
   * 推进骰子、视角和实体牌动画，再渲染当前帧；静止后不持续申请重绘。
   *
   * @param time 浏览器动画帧的时间戳，单位为毫秒。
   * @returns 无返回值。
   */
  private readonly renderFrame = (time: number): void => {
    this.frameHandle = null
    const diceMoving = this.dice.advance(time)
    let animating = this.advanceOrbit() || diceMoving
    for (const entity of this.tiles.values()) {
      animating = advanceTileMotion(entity, time, this.callbacks.onTileLand) || animating
    }
    this.renderer.render(this.scene, this.camera)
    // 先画出落桌这一帧，再解锁出牌，避免慢帧时仅凭计时器就提前切换牌面。
    if (this.notifyDiceDocked && !diceMoving) {
      this.notifyDiceDocked = false
      this.callbacks.onDiceDocked()
    }
    if (animating) {
      this.requestRender()
    }
  }
}
