import * as THREE from 'three'

import { DICE_ROLL_ANIMATION_MS } from '@/shared/diceTiming'
import { createDiceRig, DIE_REST_POSITIONS, orientDieForValue, type DiceRig } from '@/ui/table3d/diceFactory'
import { BOWL_ASIDE, BOWL_DOCK, BOWL_SHOWCASE, type Point3 } from '@/ui/table3d/tableMetrics'

/**
 * 骰子的展示状态。
 */
export interface DiceState {
  /**
   * 两颗骰子的点数；为空表示还没有掷骰结果，碗里不放骰子。
   */
  values: [number, number] | null
  /**
   * 是否正处于掷骰动画和结果停留阶段，此时骰碗端到镜头前。
   */
  rolling: boolean
  /**
   * 骰碗是否暂时挪到桌边。开局洗牌垒墩要用桌子中央，这期间碗放在一旁。
   */
  aside: boolean
}

/**
 * 骰碗在两个位置之间移动一次的时长（毫秒）。
 */
const BOWL_TRAVEL_MS = 420

/**
 * 骰碗放在桌上时的缩放。端到镜头前时恢复原始大小，放回桌上时缩小，少占桌面。
 */
const BOWL_TABLE_SCALE = 0.75

/**
 * 掷骰时每颗骰子翻滚的圈数。
 */
const DIE_TUMBLE_TURNS = 5

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
 * 骰碗与骰子的动画。
 *
 * 负责三件事：碗在桌子中央、桌边和镜头前之间移动；掷骰时骰子翻滚并停在规则层给出的点数上；
 * 没有掷骰结果时碗里不放骰子。点数永远以外部传入的结果为准，这里不产生任何随机结果。
 */
export class DiceAnimator {
  private readonly rig: DiceRig = createDiceRig()
  private readonly moveFrom = new THREE.Vector3()
  private readonly moveTarget = toVector(BOWL_DOCK)
  private moveStart = 0
  private scaleFrom = BOWL_TABLE_SCALE
  private scaleTarget = BOWL_TABLE_SCALE
  private restPoses: THREE.Quaternion[] = []
  private spinAxes: THREE.Vector3[] = []
  private rollStart: number | null = null
  private rolling = false
  private valueKey = ''

  /**
   * 创建骰碗并放到桌子中央。
   */
  constructor() {
    this.rig.group.position.copy(this.moveTarget)
    this.rig.group.scale.setScalar(BOWL_TABLE_SCALE)
  }

  /**
   * 骰碗和骰子的整体对象，由场景加入画面。
   *
   * @returns 整体对象
   */
  get object(): THREE.Group {
    return this.rig.group
  }

  /**
   * 骰碗网格，场景用它判断玩家是否点到了碗。
   *
   * @returns 骰碗网格
   */
  get bowl(): THREE.Mesh {
    return this.rig.bowl
  }

  /**
   * 当前是否处于掷骰展示阶段；此时碗在半空中，不接受点击。
   *
   * @returns 是否正在掷骰展示
   */
  get isRolling(): boolean {
    return this.rolling
  }

  /**
   * 更新骰子的展示状态。
   *
   * @param state 点数、是否处于掷骰展示阶段、是否挪到桌边
   * @returns 无返回值
   */
  setState(state: DiceState): void {
    const now = performance.now()
    const key = state.values ? state.values.join('+') : ''
    this.rig.dice.forEach((die) => {
      die.visible = state.values !== null
    })
    if (state.values) {
      /*
       * 落定朝向由点数决定，再按点数给一个固定的偏转，同一结果每次摆法一致。
       */
      this.restPoses = state.values.map((value, index) => orientDieForValue(value, value * 0.9 + index * 1.7))
      this.spinAxes = state.values.map((value, index) =>
        new THREE.Vector3(Math.cos(value + index), 0.35, Math.sin(value * 2 + index)).normalize(),
      )
    }
    /*
     * 刚进入掷骰阶段，或掷骰阶段内结果换了一次，都重新播放翻滚。
     */
    if (state.rolling && state.values && (!this.rolling || key !== this.valueKey)) {
      this.rollStart = now
    }
    if (!state.rolling) {
      this.rollStart = null
      this.rig.dice.forEach((die, index) => {
        die.position.copy(DIE_REST_POSITIONS[index])
        if (this.restPoses[index]) {
          die.quaternion.copy(this.restPoses[index])
        }
      })
    }

    /*
     * 掷骰时端到镜头前；否则按是否需要让出桌子中央，放在桌边或桌子正中。
     */
    const target = toVector(state.rolling ? BOWL_SHOWCASE : state.aside ? BOWL_ASIDE : BOWL_DOCK)
    if (!target.equals(this.moveTarget)) {
      this.moveFrom.copy(this.rig.group.position)
      this.moveTarget.copy(target)
      this.scaleFrom = this.rig.group.scale.x
      this.scaleTarget = state.rolling ? 1 : BOWL_TABLE_SCALE
      this.moveStart = now
    }
    this.rolling = state.rolling
    this.valueKey = key
  }

  /**
   * 推进骰碗移动和骰子翻滚。
   *
   * @param time 当前时间戳（毫秒）
   * @returns 骰碗或骰子是否仍在运动，场景据此决定是否继续渲染
   */
  advance(time: number): boolean {
    const travel = Math.min((time - this.moveStart) / BOWL_TRAVEL_MS, 1)
    const eased = 1 - (1 - travel) ** 3
    this.rig.group.position.lerpVectors(this.moveFrom, this.moveTarget, eased)
    this.rig.group.scale.setScalar(THREE.MathUtils.lerp(this.scaleFrom, this.scaleTarget, eased))
    let moving = travel < 1

    if (this.rollStart !== null) {
      const progress = Math.min((time - this.rollStart) / DICE_ROLL_ANIMATION_MS, 1)
      const remaining = (1 - progress) ** 2
      this.rig.dice.forEach((die, index) => {
        /*
         * 翻滚量随时间衰减到零，最后一帧正好停在规则层给出的点数上。
         */
        const spin = new THREE.Quaternion().setFromAxisAngle(
          this.spinAxes[index],
          remaining * DIE_TUMBLE_TURNS * Math.PI * 2,
        )
        die.quaternion.copy(this.restPoses[index]).multiply(spin)
        const swirl = time / 90 + index * Math.PI
        die.position.copy(DIE_REST_POSITIONS[index])
        die.position.x += Math.cos(swirl) * 0.38 * remaining
        die.position.z += Math.sin(swirl) * 0.38 * remaining
        die.position.y += Math.abs(Math.sin(time / 70 + index)) * 0.5 * remaining
      })
      if (progress >= 1) {
        this.rollStart = null
      } else {
        moving = true
      }
    }
    return moving
  }
}
