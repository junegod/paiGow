import * as THREE from 'three'

import { HAND_CENTER, HAND_TILT, TILE_SIZE } from '@/ui/table3d/tableMetrics'

/**
 * 拖牌只依赖实体、牌标识和固定牌槽，不读取规则状态，也不修改牌面或共享材质。
 */
export interface HandDragTile {
  /**
   * 当前玩家可操作手牌的实例标识，只用于本地显示排序。
   */
  cardId: string
  /**
   * 包含牌体和牌点的完整容器，拖动时必须一起移动。
   */
  object: THREE.Group
  /**
   * 规则展示层计算的目标槽位，不能使用动画途中的位置计算换位边界。
   */
  slot: THREE.Vector3
}

/**
 * 从按下到松手期间保留的牌槽和牌序，避免相邻牌移动时反复改变命中边界。
 */
interface HandDragSession {
  /**
   * 被拖动的完整牌实体，换位期间始终由当前手势控制。
   */
  tile: HandDragTile
  /**
   * 按下时的目标槽位，保留选中牌原有的抬起高度。
   */
  origin: THREE.Vector3
  /**
   * 按下点相对牌中心的横向偏移，防止启动拖动时跳变。
   */
  offsetX: number
  /**
   * 按横坐标排序的固定槽位，邻牌动画不能改变换位判断边界。
   */
  slots: number[]
  /**
   * 当前已经回报给界面层的本地牌序。
   */
  order: string[]
  /**
   * 系统取消时恢复的牌序；正常松手沿用移动中即时保存的顺序。
   */
  originalOrder: string[]
}

/**
 * 拖动牌沿牌面法线前移，分离量大于牌厚，使牌体和孔底完整位于相邻牌前方。
 */
const DRAG_FRONT_OFFSET = TILE_SIZE.depth + 0.12
/**
 * 在牌面内轻抬拖动牌，让前景预览和原牌槽更容易区分。
 */
const DRAG_UP_OFFSET = 0.24
/**
 * 手牌统一姿态对应的正面法线、竖直方向及指针投射平面。
 */
const HAND_NORMAL = new THREE.Vector3(0, Math.sin(HAND_TILT), Math.cos(HAND_TILT))
const HAND_UP = new THREE.Vector3(0, Math.cos(HAND_TILT), -Math.sin(HAND_TILT))
const HAND_PLANE = new THREE.Plane().setFromNormalAndCoplanarPoint(
  HAND_NORMAL,
  new THREE.Vector3(HAND_CENTER.x, HAND_CENTER.y, HAND_CENTER.z),
)

/**
 * 三维手牌的拖动预览与即时插入换位。
 *
 * 使用固定牌槽判断目标位置；牌跨过相邻槽位中点时立即回报新顺序，
 * 由现有手牌排序入口保存顺序并驱动其他牌平滑让位。
 */
export class HandDragController {
  private session: HandDragSession | null = null
  private readonly intersection = new THREE.Vector3()

  /**
   * 记录按下位置和当前牌序，此时不移动实体，普通点击仍可用于选牌。
   *
   * @param tile 被按下的手牌
   * @param hand 当前全部手牌及其目标牌槽
   * @param ray 按下位置的指针射线
   * @returns 无返回值
   */
  begin(tile: HandDragTile, hand: HandDragTile[], ray: THREE.Ray): void {
    const sorted = [...hand].sort((left, right) => left.slot.x - right.slot.x)
    const order = sorted.map((item) => item.cardId)
    const point = ray.intersectPlane(HAND_PLANE, this.intersection)
    this.session = {
      tile,
      origin: tile.slot.clone(),
      // 保留手指在牌内的按下偏移，拖动刚开始时不能把牌中心突然吸到指针上。
      offsetX: point ? point.x - tile.object.position.x : 0,
      slots: sorted.map((item) => item.slot.x),
      order,
      originalOrder: [...order],
    }
  }

  /**
   * 让实体在前景跟随指针，并在跨槽时立即生成新的本地显示顺序。
   *
   * @param ray 当前指针射线
   * @returns 发生换位时返回完整牌序；未跨槽、射线平行或没有会话时返回空
   */
  move(ray: THREE.Ray): string[] | null {
    const session = this.session
    const point = ray.intersectPlane(HAND_PLANE, this.intersection)
    if (!session || !point || session.slots.length === 0) {
      return null
    }
    const x = THREE.MathUtils.clamp(
      point.x - session.offsetX,
      session.slots[0],
      session.slots[session.slots.length - 1],
    )
    // 只移动整张牌的容器，不拆分孔底和牌体；前移后即使横向覆盖也不会发生深度穿插。
    session.tile.object.position.copy(session.origin)
      .addScaledVector(HAND_NORMAL, DRAG_FRONT_OFFSET)
      .addScaledVector(HAND_UP, DRAG_UP_OFFSET)
    session.tile.object.position.x = x
    const targetIndex = session.slots.reduce((nearest, slot, index) =>
      Math.abs(slot - x) < Math.abs(session.slots[nearest] - x) ? index : nearest, 0)
    const currentIndex = session.order.indexOf(session.tile.cardId)
    if (currentIndex < 0 || targetIndex === currentIndex) {
      return null
    }
    const [moving] = session.order.splice(currentIndex, 1)
    session.order.splice(targetIndex, 0, moving)
    return [...session.order]
  }

  /**
   * 结束会话并释放实体引用；正常松手保留已经即时保存的牌序。
   *
   * @param cancelled 是否由系统取消，取消时恢复按下前的顺序
   * @returns 取消且已发生换位时返回原牌序，其他情况返回空
   */
  end(cancelled = false): string[] | null {
    const session = this.session
    this.session = null
    if (!cancelled || !session || session.order.every((id, index) => id === session.originalOrder[index])) {
      return null
    }
    return session.originalOrder
  }
}
