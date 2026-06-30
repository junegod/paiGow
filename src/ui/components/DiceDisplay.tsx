import { useEffect, useState } from 'react'

import type { DiceRoll } from '@/rules-core/types'
import { DICE_ROLL_ANIMATION_MS } from '@/ui/diceTiming'

interface DiceDisplayProps {
  roll: DiceRoll | null
  animate?: boolean
  compact?: boolean
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
 * 单颗 3D 骰子。通过 CSS 透视、侧边阴影和凹点高光模拟参考截图里的白色圆角骰子。
 */
function DiceCube({ value }: { value: number }) {
  const activePositions = new Set(getPipPositions(value))
  const pipTone = getDicePipTone(value)

  return (
    <div className="dice-cube" aria-label={`${value} 点`}>
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
 * 掷骰展示组件：中心态会先随机跳动，结束后落到规则引擎给出的最终点数。
 */
export function DiceDisplay({
  roll,
  animate = false,
  compact = false,
}: DiceDisplayProps) {
  const [displayValues, setDisplayValues] = useState<[number, number]>([1, 1])
  const [isRolling, setIsRolling] = useState(false)

  useEffect(() => {
    if (!roll) {
      setIsRolling(false)
      return
    }

    if (!animate) {
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
  }, [animate, roll])

  if (!roll) {
    return null
  }

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
