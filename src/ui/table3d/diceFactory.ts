import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * 骰碗和骰子的建模。
 *
 * 骰子点数由规则层决定，这里只负责把指定点数朝上摆好，以及提供掷骰时用到的对象。
 */

/**
 * 骰子边长。
 */
export const DIE_SIZE = 0.46

/**
 * 两颗骰子落定后在碗里的位置（相对骰碗）。
 */
export const DIE_REST_POSITIONS = [
  new THREE.Vector3(-0.3, 0.42, 0.06),
  new THREE.Vector3(0.3, 0.42, -0.08),
]

/**
 * 骰子六个面的朝向和点数：上 1、下 6、前 2、后 5、右 3、左 4，对面相加为 7。
 */
const DIE_FACES: { value: number; normal: THREE.Vector3 }[] = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
]

/**
 * 各点数在一个面上的点位，坐标是相对面中心的比例。
 */
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
}

const FACE_FORWARD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)

const dieGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.07)
const dieMaterial = new THREE.MeshPhysicalMaterial({ color: '#f6f2e6', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 })
const pipGeometry = new THREE.CircleGeometry(1, 24)
/*
 * 传统骰子的一点和四点是红色，其余是黑色。
 */
const redPipMaterial = new THREE.MeshBasicMaterial({ color: '#c8140f' })
const darkPipMaterial = new THREE.MeshBasicMaterial({ color: '#14110f' })

/**
 * 创建一颗六面都带点数的骰子。
 *
 * @returns 骰子对象
 */
function createDie(): THREE.Group {
  const die = new THREE.Group()
  const body = new THREE.Mesh(dieGeometry, dieMaterial)
  body.castShadow = true
  die.add(body)

  for (const face of DIE_FACES) {
    /*
     * 每个面先在自身平面里摆好点子，再整体转到对应的朝向并贴到骰子表面。
     */
    const panel = new THREE.Group()
    panel.quaternion.setFromUnitVectors(FACE_FORWARD, face.normal)
    panel.position.copy(face.normal).multiplyScalar(DIE_SIZE / 2 + 0.003)
    const material = face.value === 1 || face.value === 4 ? redPipMaterial : darkPipMaterial
    for (const [column, row] of PIP_LAYOUTS[face.value]) {
      const pip = new THREE.Mesh(pipGeometry, material)
      pip.scale.setScalar(face.value === 1 ? DIE_SIZE * 0.17 : DIE_SIZE * 0.095)
      pip.position.set(column * DIE_SIZE * 0.25, row * DIE_SIZE * 0.25, 0)
      panel.add(pip)
    }
    die.add(panel)
  }
  return die
}

/**
 * 创建白瓷骰碗。
 *
 * @returns 骰碗网格，可用于点击拾取
 */
function createBowl(): THREE.Mesh {
  /*
   * 碗的剖面轮廓：先画外壁再折回画内壁，绕竖直轴旋转一圈得到碗。
   */
  const profile = [
    [0.01, 0.02],
    [0.5, 0.04],
    [0.56, 0.14],
    [0.95, 0.34],
    [1.24, 0.7],
    [1.35, 0.9],
    [1.28, 0.88],
    [1.15, 0.68],
    [0.86, 0.36],
    [0.01, 0.18],
  ].map(([radius, height]) => new THREE.Vector2(radius, height))
  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 64),
    new THREE.MeshPhysicalMaterial({
      color: '#f1efe8',
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      side: THREE.DoubleSide,
    }),
  )
  bowl.castShadow = true
  bowl.receiveShadow = true
  return bowl
}

/**
 * 骰碗和两颗骰子的组合。
 */
export interface DiceRig {
  /**
   * 整体对象，移动它就是端着碗走。
   */
  group: THREE.Group
  bowl: THREE.Mesh
  dice: THREE.Group[]
}

/**
 * 创建骰碗和两颗骰子。
 *
 * @returns 骰碗组合；骰子初始隐藏，有掷骰结果后再显示
 */
export function createDiceRig(): DiceRig {
  const group = new THREE.Group()
  const bowl = createBowl()
  group.add(bowl)
  const dice = DIE_REST_POSITIONS.map((position) => {
    const die = createDie()
    die.position.copy(position)
    die.visible = false
    group.add(die)
    return die
  })
  return { group, bowl, dice }
}

/**
 * 计算让指定点数朝上的骰子姿态。
 *
 * @param value 朝上的点数，1 到 6
 * @param yaw 绕竖直轴的额外转角（弧度），让两颗骰子落定后的朝向不完全一样
 * @returns 骰子姿态
 */
export function orientDieForValue(value: number, yaw: number): THREE.Quaternion {
  const face = DIE_FACES.find((item) => item.value === value) ?? DIE_FACES[0]
  const lift = new THREE.Quaternion().setFromUnitVectors(face.normal, UP)
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(lift)
}
