import * as THREE from 'three'

import type { TileLandingKind } from '@/ui/table3d/tableView'

/**
 * 实体牌的一次移动或翻面动画；落位事件随本次动画保存，改目标或移除实体后不再补播。
 */
export interface TileFlight {
  /**
   * 动画起点的位置、朝向和缩放快照，避免插值过程中起点跟着实体变化。
   */
  fromPosition: THREE.Vector3
  fromQuaternion: THREE.Quaternion
  fromScale: number
  /**
   * 允许延迟开始的时间戳，以及完整运动时长，单位均为毫秒。
   */
  start: number
  duration: number
  /**
   * 飞行弧线的最大抬高量。
   */
  arc: number
  /**
   * 原地亮手牌时采用对称缓动，普通飞牌沿用减速落位。
   */
  handFlip: boolean
  /**
   * 代表整摞牌的一张实体落稳时回报；没有标记的牌不触发碰撞音效。
   */
  landingKind?: TileLandingKind
}

/**
 * 推进实体牌动画所需的最小状态，不依赖场景、规则或音频播放器。
 */
export interface TileMotionTarget {
  /**
   * 待更新的实体及本次运动的最终摆位。
   */
  object: THREE.Group
  targetPosition: THREE.Vector3
  targetQuaternion: THREE.Quaternion
  targetScale: number
  /**
   * 当前动画；落稳后立即清空，后续渲染不会重复触发落位事件。
   */
  flight: TileFlight | null
}

/**
 * 推进单张实体牌的位置、旋转和缩放，落稳时回报一次碰撞类型。
 *
 * @param entity 实体牌及目标摆位。
 * @param time 当前渲染帧的时间戳，单位为毫秒。
 * @param onLanding 落稳后的回调，由界面层决定如何播放声音。
 * @returns 是否仍需后续动画帧；等待延迟起飞时也返回真。
 */
export function advanceTileMotion(
  entity: TileMotionTarget,
  time: number,
  onLanding: (kind: TileLandingKind) => void,
): boolean {
  const flight = entity.flight
  if (!flight) {
    return false
  }
  // 延迟起飞的牌保持原位，发牌节奏和拖牌回位都继续由原来的时间轴控制。
  if (time < flight.start) {
    return true
  }
  const progress = Math.min((time - flight.start) / flight.duration, 1)
  const eased = flight.handFlip ? progress * progress * (3 - 2 * progress) : 1 - (1 - progress) ** 3
  entity.object.position.lerpVectors(flight.fromPosition, entity.targetPosition, eased)
  entity.object.position.y += Math.sin(progress * Math.PI) * flight.arc
  entity.object.quaternion.slerpQuaternions(flight.fromQuaternion, entity.targetQuaternion, eased)
  entity.object.scale.setScalar(THREE.MathUtils.lerp(flight.fromScale, entity.targetScale, eased))
  if (progress < 1) {
    return true
  }
  // 先结束动画再回报，保证静止重绘、设置切换或再次渲染都不会重复发声。
  entity.flight = null
  if (flight.landingKind) {
    onLanding(flight.landingKind)
  }
  return false
}
