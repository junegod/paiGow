import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, RoundedBox } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { DiceRoll } from '@/rules-core/types'
import { DICE_ROLL_ANIMATION_MS } from '@/ui/diceTiming'

type Vec3 = [number, number, number]

interface Dice3DDisplayProps {
  /** 规则引擎已经确定的骰子结果，3D 层只负责把结果演出来。 */
  roll: DiceRoll
  /** 是否播放滚动动画；静态结果会直接停在正向可读位置。 */
  animate?: boolean
  /** 右上角 HUD 使用的小尺寸模式。 */
  compact?: boolean
  /** 开局仪式使用的碗内掷骰模式。 */
  bowl?: boolean
  /** 只展示碗不展示骰子，用于还没掷骰前的右上角入口。 */
  hideDice?: boolean
}

interface DiceSceneConfig {
  /** 两颗骰子最终中心间距。 */
  spacing: number
  /** 单颗骰子缩放。 */
  diceScale: number
  /** 骰子落定时的高度。 */
  restingY: number
  /** 摄像机位置。 */
  cameraPosition: Vec3
  /** 摄像机视场角。 */
  fov: number
}

interface DiceModelProps {
  value: number
  rollKey: string
  animate: boolean
  compact?: boolean
  bowl?: boolean
  finalPosition: Vec3
  scale: number
  phaseOffset: number
}

interface DiceFaceConfig {
  name: 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left'
  position: Vec3
  rotation: Vec3
}

type DiceFaceName = DiceFaceConfig['name']
type DiceFaceValueMap = Record<DiceFaceName, number>

const HALF_DICE_SIZE = 0.5
const FACE_OFFSET = HALF_DICE_SIZE + 0.009
const PIP_SPACING = 0.21

const DICE_FACE_CONFIGS: DiceFaceConfig[] = [
  { name: 'top', position: [0, FACE_OFFSET, 0], rotation: [-Math.PI / 2, 0, 0] },
  { name: 'bottom', position: [0, -FACE_OFFSET, 0], rotation: [Math.PI / 2, 0, 0] },
  { name: 'front', position: [0, 0, FACE_OFFSET], rotation: [0, 0, 0] },
  { name: 'back', position: [0, 0, -FACE_OFFSET], rotation: [0, Math.PI, 0] },
  { name: 'right', position: [FACE_OFFSET, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { name: 'left', position: [-FACE_OFFSET, 0, 0], rotation: [0, -Math.PI / 2, 0] },
]

/**
 * 骰子最终停住时的六面朝向表。顶部点数来自规则结果，
 * 其余五面按真实骰子的对面相加为 7 来排，避免可见面出现两个相同点数。
 */
const DICE_ORIENTATION_BY_TOP: Record<number, DiceFaceValueMap> = {
  1: { top: 1, bottom: 6, front: 2, back: 5, right: 3, left: 4 },
  2: { top: 2, bottom: 5, front: 6, back: 1, right: 3, left: 4 },
  3: { top: 3, bottom: 4, front: 2, back: 5, right: 6, left: 1 },
  4: { top: 4, bottom: 3, front: 2, back: 5, right: 1, left: 6 },
  5: { top: 5, bottom: 2, front: 1, back: 6, right: 3, left: 4 },
  6: { top: 6, bottom: 1, front: 5, back: 2, right: 3, left: 4 },
}

const PIP_COORDS: Record<number, Vec3[]> = {
  1: [[0, 0, 0]],
  2: [
    [-PIP_SPACING, PIP_SPACING, 0],
    [PIP_SPACING, -PIP_SPACING, 0],
  ],
  3: [
    [-PIP_SPACING, PIP_SPACING, 0],
    [0, 0, 0],
    [PIP_SPACING, -PIP_SPACING, 0],
  ],
  4: [
    [-PIP_SPACING, PIP_SPACING, 0],
    [PIP_SPACING, PIP_SPACING, 0],
    [-PIP_SPACING, -PIP_SPACING, 0],
    [PIP_SPACING, -PIP_SPACING, 0],
  ],
  5: [
    [-PIP_SPACING, PIP_SPACING, 0],
    [PIP_SPACING, PIP_SPACING, 0],
    [0, 0, 0],
    [-PIP_SPACING, -PIP_SPACING, 0],
    [PIP_SPACING, -PIP_SPACING, 0],
  ],
  6: [
    [-PIP_SPACING, PIP_SPACING, 0],
    [PIP_SPACING, PIP_SPACING, 0],
    [-PIP_SPACING, 0, 0],
    [PIP_SPACING, 0, 0],
    [-PIP_SPACING, -PIP_SPACING, 0],
    [PIP_SPACING, -PIP_SPACING, 0],
  ],
}

/**
 * 缓出缓入函数，用来把脚本动画做得更像真实滚动后的自然停住。
 */
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3)
}

/**
 * 根据展示场景给出相机和骰子尺寸。所有尺寸都留在组件内部，
 * 避免外层牌桌再写一堆像素级 3D 参数。
 */
function getDiceSceneConfig(compact?: boolean, bowl?: boolean): DiceSceneConfig {
  if (bowl && compact) {
    return {
      spacing: 0.72,
      diceScale: 0.46,
      restingY: 0.42,
      cameraPosition: [0, 4.55, 4.1],
      fov: 43,
    }
  }

  if (bowl) {
    return {
      spacing: 1.02,
      diceScale: 0.72,
      restingY: 0.46,
      cameraPosition: [0, 4.72, 4.18],
      fov: 36,
    }
  }

  if (compact) {
    return {
      spacing: 1.16,
      diceScale: 1.08,
      restingY: 0.56,
      cameraPosition: [0, 4.1, 3.35],
      fov: 24,
    }
  }

  return {
    spacing: 1.72,
    diceScale: 1.56,
    restingY: 0.78,
    cameraPosition: [0, 4.85, 4.05],
    fov: 23,
  }
}

/**
 * 点数颜色跟实物骰一致：1 点和 4 点整面红色，其余点数蓝色。
 */
function getPipColor(value: number): string {
  return value === 1 || value === 4 ? '#c92321' : '#173fd8'
}

/**
 * 给非主视面的点数做一个稳定排布。顶部永远是规则点数，
 * 其他面只用于增加真实感，不参与规则判断。
 */
function getFaceValue(topValue: number, faceName: DiceFaceName): number {
  return DICE_ORIENTATION_BY_TOP[topValue]?.[faceName] ?? DICE_ORIENTATION_BY_TOP[1][faceName]
}

/**
 * 单个骰子点位。外圈先画浅凹槽，再覆盖一层漆面圆点，
 * 让点子看起来是嵌在白瓷骰体里的。
 */
function DicePip({ position, value }: { position: Vec3; value: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0, 0.001]}>
        <circleGeometry args={[0.083, 30]} />
        <meshStandardMaterial
          color="#d8e1e8"
          roughness={0.92}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
      <mesh position={[0, 0, 0.005]}>
        <circleGeometry args={[0.064, 30]} />
        <meshPhysicalMaterial
          color={getPipColor(value)}
          roughness={0.18}
          metalness={0}
          clearcoat={0.9}
          clearcoatRoughness={0.16}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
      <mesh position={[0.018, 0.025, 0.008]}>
        <circleGeometry args={[0.018, 18]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.46} />
      </mesh>
    </group>
  )
}

/**
 * 骰子单面点位。每一面都是独立平面，便于让顶部点数始终和规则结果一致。
 */
function DiceFace({ face, value }: { face: DiceFaceConfig; value: number }) {
  return (
    <group position={face.position} rotation={face.rotation}>
      {(PIP_COORDS[value] ?? PIP_COORDS[1]).map((position, index) => (
        <DicePip key={`${face.name}-${value}-${index}`} position={position} value={value} />
      ))}
    </group>
  )
}

/**
 * 一颗白瓷圆角骰。这里不用贴图，全部由 R3F 原生几何和 PBR 材质组成，
 * 后续要继续调质感也不依赖外部素材。
 */
function DiceBody({
  value,
  compact,
}: {
  value: number
  compact?: boolean
}) {
  return (
    <group>
      <RoundedBox
        args={[1, 1, 1]}
        radius={compact ? 0.16 : 0.2}
        smoothness={7}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color="#f8fcff"
          roughness={0.34}
          metalness={0}
          clearcoat={0.82}
          clearcoatRoughness={0.18}
        />
      </RoundedBox>
      {DICE_FACE_CONFIGS.map((face) => (
        <DiceFace key={face.name} face={face} value={getFaceValue(value, face.name)} />
      ))}
    </group>
  )
}

/**
 * 可控滚动动画。前 80% 做翻滚和弹跳，最后 20% 收敛到正向结果，
 * 这样既像真实掷骰，又不会和规则点数冲突。
 */
function DiceModel({
  value,
  rollKey,
  animate,
  compact,
  bowl,
  finalPosition,
  scale,
  phaseOffset,
}: DiceModelProps) {
  const groupRef = useRef<THREE.Group>(null)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    startedAtRef.current = null
  }, [animate, rollKey])

  useFrame(({ clock }) => {
    const group = groupRef.current

    if (!group) {
      return
    }

    if (!animate) {
      group.position.set(...finalPosition)
      group.rotation.set(0, 0, 0)
      return
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = clock.elapsedTime
    }

    const elapsed = clock.elapsedTime - startedAtRef.current
    const rawProgress = THREE.MathUtils.clamp(elapsed / (DICE_ROLL_ANIMATION_MS / 1000), 0, 1)
    const settleProgress = easeOutCubic(rawProgress)
    const rollingWeight = 1 - settleProgress
    const orbitRadius = bowl ? 0.36 : 0.48
    const spin = rawProgress * Math.PI * (bowl ? 7.5 : 6.2) + phaseOffset
    const bounce = Math.abs(Math.sin(rawProgress * Math.PI * 5.2 + phaseOffset)) * rollingWeight

    group.position.set(
      finalPosition[0] + Math.cos(spin) * orbitRadius * rollingWeight,
      finalPosition[1] + bounce * (bowl ? 0.34 : 0.52),
      finalPosition[2] + Math.sin(spin) * orbitRadius * 0.55 * rollingWeight,
    )
    group.rotation.set(
      spin * 1.15 * rollingWeight,
      spin * 0.86 * rollingWeight,
      spin * 1.34 * rollingWeight,
    )
  })

  return (
    <group ref={groupRef} position={finalPosition} scale={scale}>
      <DiceBody value={value} compact={compact} />
    </group>
  )
}

/**
 * 白瓷小碗。用旋转曲面加碗口圆环表现真实厚度，
 * 碗内只作为展示容器，不参与碰撞计算。
 */
function PorcelainBowl() {
  const bowlProfile = useMemo(
    () => [
      new THREE.Vector2(0, -0.62),
      new THREE.Vector2(0.48, -0.62),
      new THREE.Vector2(0.96, -0.48),
      new THREE.Vector2(1.42, -0.16),
      new THREE.Vector2(1.78, 0.32),
      new THREE.Vector2(1.9, 0.68),
      new THREE.Vector2(1.74, 0.82),
      new THREE.Vector2(1.5, 0.68),
      new THREE.Vector2(1.22, 0.28),
      new THREE.Vector2(0.78, -0.08),
      new THREE.Vector2(0.34, -0.32),
      new THREE.Vector2(0, -0.4),
      new THREE.Vector2(0, -0.62),
    ],
    [],
  )

  return (
    <group position={[0, -0.16, 0]} scale={[1.08, 1.34, 0.74]}>
      <mesh castShadow>
        <latheGeometry args={[bowlProfile, 128]} />
        <meshPhysicalMaterial
          color="#fff8e9"
          roughness={0.31}
          metalness={0}
          clearcoat={0.95}
          clearcoatRoughness={0.11}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.82, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[1.74, 0.105, 24, 144]} />
        <meshPhysicalMaterial
          color="#fffdf4"
          roughness={0.22}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
      <mesh position={[0, -0.64, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.46, 0.052, 18, 96]} />
        <meshPhysicalMaterial
          color="#ead9b8"
          roughness={0.42}
          metalness={0}
          clearcoat={0.62}
          clearcoatRoughness={0.22}
        />
      </mesh>
    </group>
  )
}

/**
 * 3D 场景灯光。小屏手机上尽量少用灯和阴影，靠一盏主光、
 * 一盏补光和接触阴影支撑体积感。
 */
function DiceSceneLights() {
  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[3.5, 5.2, 4.2]} intensity={2.1} castShadow />
      <pointLight position={[-2.8, 2.6, 2.4]} intensity={0.55} color="#fff0ca" />
    </>
  )
}

/**
 * 3D 骰子场景主体。静态 HUD 使用 demand 渲染，动画场景才持续跑帧。
 */
function DiceScene({ roll, animate, compact, bowl, hideDice }: Dice3DDisplayProps) {
  const config = getDiceSceneConfig(compact, bowl)
  const rollKey = `${roll.first}-${roll.second}-${bowl ? 'bowl' : compact ? 'compact' : 'table'}`
  const leftPosition: Vec3 = [-config.spacing / 2, config.restingY, bowl ? 0.02 : 0]
  const rightPosition: Vec3 = [config.spacing / 2, config.restingY, bowl ? 0.02 : 0]

  return (
    <>
      <DiceSceneLights />
      {bowl ? <PorcelainBowl /> : null}
      {!hideDice ? (
        <>
          <DiceModel
            value={roll.first}
            rollKey={rollKey}
            animate={Boolean(animate)}
            compact={compact}
            bowl={bowl}
            finalPosition={leftPosition}
            scale={config.diceScale}
            phaseOffset={0.25}
          />
          <DiceModel
            value={roll.second}
            rollKey={rollKey}
            animate={Boolean(animate)}
            compact={compact}
            bowl={bowl}
            finalPosition={rightPosition}
            scale={config.diceScale}
            phaseOffset={1.72}
          />
        </>
      ) : null}
      {bowl ? null : (
        <ContactShadows
          position={[0, -0.035, 0]}
          opacity={0.42}
          scale={2.9}
          blur={1.8}
          far={2.2}
          resolution={256}
          color="#000000"
          frames={animate ? Infinity : 1}
        />
      )}
    </>
  )
}

/**
 * 对外的 R3F 骰子展示组件。Canvas 透明铺满容器，
 * 外层尺寸仍由 CSS 控制，便于适配牌桌不同位置。
 */
export function Dice3DDisplay({
  roll,
  animate = false,
  compact = false,
  bowl = false,
  hideDice = false,
}: Dice3DDisplayProps) {
  const config = getDiceSceneConfig(compact, bowl)

  return (
    <Canvas
      className="dice-display__canvas"
      shadows="basic"
      dpr={[1, 2]}
      frameloop={animate ? 'always' : 'demand'}
      camera={{
        position: config.cameraPosition,
        fov: config.fov,
        near: 0.1,
        far: 24,
      }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0, 0)
        gl.setClearColor(0x000000, 0)
      }}
    >
      <DiceScene
        roll={roll}
        animate={animate}
        compact={compact}
        bowl={bowl}
        hideDice={hideDice}
      />
    </Canvas>
  )
}
