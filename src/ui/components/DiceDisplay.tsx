import { lazy, Suspense, useEffect, useState } from 'react'

import type { DiceRoll } from '@/rules-core/types'
import { DICE_ROLL_ANIMATION_MS } from '@/ui/diceTiming'

interface DiceDisplayProps {
  roll: DiceRoll | null
  animate?: boolean
  compact?: boolean
  bowl?: boolean
  hideDice?: boolean
}

let webGLSupportCache: boolean | null = null

const dice3DDisplayModulePromise = import('@/ui/components/Dice3DDisplay')

const LazyDice3DDisplay = lazy(() =>
  dice3DDisplayModulePromise.then((module) => ({
    default: module.Dice3DDisplay,
  })),
)

const EMPTY_BOWL_ROLL: DiceRoll = {
  first: 1,
  second: 1,
  sum: 2,
  key: 'empty-bowl-placeholder',
  door: 'long',
}

const PIP_POSITIONS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/**
 * 返回骰子需要点亮的九宫格孔位。组件只处理展示，
 * 真实骰子点数仍由规则引擎的 DiceRoll 决定。
 */
function getPipPositions(value: number): number[] {
  return PIP_POSITIONS[value] ?? PIP_POSITIONS[1]
}

/**
 * 判断当前骰面点色。传统实物骰子里 1 点和 4 点为红色，
 * 其余点数为蓝色，颜色跟随整面点数而不是单个孔位。
 */
function getDicePipTone(value: number): 'red' | 'blue' {
  return value === 1 || value === 4 ? 'red' : 'blue'
}

/**
 * 检测当前浏览器是否能创建 WebGL 上下文。部分安卓 WebView 或省电模式下
 * 可能禁用 WebGL，此时继续使用 CSS 骰子兜底，保证游戏可玩。
 */
function isWebGLRenderingAvailable(): boolean {
  if (webGLSupportCache !== null) {
    return webGLSupportCache
  }

  if (typeof document === 'undefined') {
    webGLSupportCache = false
    return webGLSupportCache
  }

  try {
    const canvas = document.createElement('canvas')
    webGLSupportCache = Boolean(
      canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'),
    )
  } catch {
    webGLSupportCache = false
  }

  return webGLSupportCache
}

/**
 * 单颗 CSS 兜底骰子。主流程优先使用 R3F，只有 WebGL 不可用或 3D chunk
 * 还没加载完成时才会显示这个轻量版本。
 */
function DiceCube({ value }: { value: number }) {
  const activePositions = new Set(getPipPositions(value))
  const pipTone = getDicePipTone(value)

  return (
    <div className="dice-cube" aria-label={`${value} 点`}>
      <span className="dice-cube__side dice-cube__side--right" aria-hidden="true" />
      <span className="dice-cube__side dice-cube__side--bottom" aria-hidden="true" />
      <div className="dice-cube__face">
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className={[
              'dice-cube__pip',
              activePositions.has(index) ? 'dice-cube__pip--active' : '',
              activePositions.has(index) ? `dice-cube__pip--${pipTone}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * CSS 兜底骰子。WebGL 不可用或 3D chunk 首次加载时使用，
 * 保证页面不会因为 3D 初始化失败而空白。
 */
function CssDiceDisplay({
  displayValues,
  compact,
  isRolling,
}: {
  displayValues: [number, number]
  compact: boolean
  isRolling: boolean
}) {
  return (
    <div
      className={[
        'dice-display',
        compact ? 'dice-display--compact' : '',
        isRolling ? 'dice-display--rolling' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <DiceCube value={displayValues[0]} />
      <DiceCube value={displayValues[1]} />
    </div>
  )
}

/**
 * 开局碗内掷骰的 CSS 兜底。3D chunk 首次加载如果慢半拍，
 * 至少先显示一个轻量小碗，避免开局动画突然空白。
 */
function BowlCssFallback({
  displayValues,
  isRolling,
  hideDice,
}: {
  displayValues: [number, number]
  isRolling: boolean
  hideDice: boolean
}) {
  return (
    <div
      className={[
        'dice-display-bowl-fallback',
        hideDice ? 'dice-display-bowl-fallback--empty' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hideDice ? null : (
        <CssDiceDisplay displayValues={displayValues} compact={false} isRolling={isRolling} />
      )}
    </div>
  )
}

/**
 * 掷骰展示组件：中心态会先随机跳动，结束后落到规则引擎给出的最终点数。
 * 当作为碗入口且尚未掷骰时，可以只展示空碗，避免误导玩家已有点数。
 */
export function DiceDisplay({
  roll,
  animate = false,
  compact = false,
  bowl = false,
  hideDice = false,
}: DiceDisplayProps) {
  const [displayValues, setDisplayValues] = useState<[number, number]>([1, 1])
  const [isRolling, setIsRolling] = useState(false)
  const shouldUse3D = isWebGLRenderingAvailable()
  const displayRoll = roll ?? EMPTY_BOWL_ROLL

  useEffect(() => {
    if (!roll) {
      setIsRolling(false)
      return
    }

    if (shouldUse3D || !animate) {
      setDisplayValues([roll.first, roll.second])
      setIsRolling(false)
      return
    }

    setIsRolling(true)
    const intervalId = window.setInterval(() => {
      setDisplayValues([
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ])
    }, 82)
    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId)
      setDisplayValues([roll.first, roll.second])
      setIsRolling(false)
    }, DICE_ROLL_ANIMATION_MS)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [animate, roll, shouldUse3D])

  if (!roll && !(bowl && hideDice)) {
    return null
  }

  if (shouldUse3D) {
    return (
      <Suspense
        fallback={
          bowl ? (
            <BowlCssFallback
              displayValues={displayValues}
              isRolling={animate || isRolling}
              hideDice={hideDice && !roll}
            />
          ) : (
            <CssDiceDisplay
              displayValues={displayValues}
              compact={compact}
              isRolling={animate || isRolling}
            />
          )
        }
      >
        <div
          className={[
            'dice-display',
            'dice-display--r3f',
            compact ? 'dice-display--compact' : '',
            bowl ? 'dice-display--bowl' : '',
            animate ? 'dice-display--rolling' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <LazyDice3DDisplay
            roll={displayRoll}
            animate={animate}
            compact={compact}
            bowl={bowl}
            hideDice={hideDice && !roll}
          />
        </div>
      </Suspense>
    )
  }

  if (bowl) {
    return (
      <BowlCssFallback
        displayValues={displayValues}
        isRolling={isRolling}
        hideDice={hideDice && !roll}
      />
    )
  }

  return <CssDiceDisplay displayValues={displayValues} compact={compact} isRolling={isRolling} />
}
