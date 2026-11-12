import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

import { HAND_CENTER, TABLE_HALF } from '@/ui/table3d/tableMetrics'
import { createWoodTexture } from '@/ui/table3d/woodTexture'

/**
 * 牌桌所在房间的搭建：桌子、长凳、地面、灯光和反光环境。
 */
/**
 * 房间背景与雾的颜色，和页面底色保持一致，桌子远处自然融进黑暗。
 */
const ROOM_COLOR = '#0b0705'

/**
 * 面光积分查找表只初始化一次，首页与多次牌局共享，避免每次进桌重新分配纹理。
 */
RectAreaLightUniformsLib.init()

/**
 * 搭建反光环境。
 *
 * 环境贴图提供柔和的间接光，强度压低，避免黑牌和孔底被亮色环境洗灰。
 *
 * @param scene 场景
 * @param renderer 渲染器
 * @returns 无返回值
 */
function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const generator = new THREE.PMREMGenerator(renderer)
  scene.environment = generator.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.4
  /*
   * 生成器只在烘焙环境贴图时需要，烘焙完立即释放它占用的中间缓冲。
   */
  generator.dispose()
  scene.background = new THREE.Color(ROOM_COLOR)
  scene.fog = new THREE.Fog(ROOM_COLOR, 30, 52)
}

/**
 * 搭建桌子、桌沿、地面和对面的长凳。
 *
 * @param scene 场景
 * @param renderer 渲染器，用于读取贴图过滤能力
 * @returns 无返回值
 */
function buildFurniture(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const wood = createWoodTexture(renderer.capabilities.getMaxAnisotropy())
  const top = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE_HALF * 2, 0.6, TABLE_HALF * 2, 4, 0.12),
    /*
     * 老木桌只有一层薄包浆：粗糙度偏高、清漆很弱，并用同一张图做凹凸让木纹有手感。
     */
    new THREE.MeshPhysicalMaterial({
      map: wood,
      bumpMap: wood,
      bumpScale: 0.5,
      roughness: 0.62,
      clearcoat: 0.18,
      clearcoatRoughness: 0.5,
    }),
  )
  top.position.y = -0.3
  top.receiveShadow = true
  scene.add(top)

  /*
   * 桌沿用更深的实木围一圈，增加桌面的厚重感和边缘高光。
   */
  const rim = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE_HALF * 2 + 0.7, 0.9, TABLE_HALF * 2 + 0.7, 4, 0.16),
    new THREE.MeshPhysicalMaterial({ color: '#1f0e06', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  )
  rim.position.y = -0.52
  rim.receiveShadow = true
  scene.add(rim)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -7.5
  floor.receiveShadow = true
  scene.add(floor)

  /*
   * 对面摆一条长凳，让桌子后方不是一片纯黑，能读出这是一间屋子。
   */
  const bench = new THREE.Mesh(
    new RoundedBoxGeometry(9.5, 0.5, 2.2, 3, 0.1),
    new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.7 }),
  )
  bench.position.set(0, -3.4, -11.2)
  bench.castShadow = true
  scene.add(bench)
}

/**
 * 布置灯光。
 *
 * @param scene 场景
 * @returns 无返回值
 */
function buildLights(scene: THREE.Scene): void {
  // 吊灯从左上方照出牌体厚度和落桌阴影，降低亮度，保留木桌纹理与黑牌的明暗层次。
  const lamp = new THREE.SpotLight('#ffe0b8', 340, 60, 0.75, 0.75, 1.6)
  lamp.position.set(-3.5, 15, 1)
  lamp.target.position.set(0, 0, 0.3)
  lamp.castShadow = true
  lamp.shadow.mapSize.set(2048, 2048)
  lamp.shadow.bias = -0.0004
  lamp.shadow.radius = 5
  scene.add(lamp, lamp.target)

  // 中性偏冷的侧后补光只勾勒窄倒角，避免明显蓝边干扰黑色骨牌材质。
  const edgeLight = new THREE.DirectionalLight('#c5d3e5', 0.7)
  edgeLight.position.set(8, 6, -8)
  scene.add(edgeLight)

  /*
   * 偏轴矩形面光模拟柔光箱，在牌面与倒角上产生有宽度的渐变光泽，避免点光源形成刺眼亮斑。
   * 面光不投影，落桌阴影仍由吊灯负责；朝向统一手牌中心，换视角时光泽自然随法线变化。
   */
  const handLight = new THREE.RectAreaLight('#fff1dc', 6, 5.5, 3.5)
  handLight.position.set(-4.8, 13, 10.5)
  handLight.lookAt(HAND_CENTER.x, HAND_CENTER.y, HAND_CENTER.z)
  scene.add(handLight)

  /*
   * 低位暖光照亮桌子后方的地面和长凳。
   */
  const floorGlow = new THREE.PointLight('#ffb978', 420, 34, 1.6)
  floorGlow.position.set(0, -1, -12.4)
  scene.add(floorGlow)
  scene.add(new THREE.HemisphereLight('#f4e8d8', '#211914', 0.32))
}

/**
 * 搭建整间屋子。
 *
 * @param scene 场景
 * @param renderer 渲染器
 * @returns 无返回值，直接把对象加入场景
 */
export function buildRoom(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  buildEnvironment(scene, renderer)
  buildFurniture(scene, renderer)
  buildLights(scene)
}
