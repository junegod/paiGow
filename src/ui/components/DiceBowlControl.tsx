import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { DiceRoll, PreparedAction } from '@/rules-core/types'
import { DiceDisplay } from '@/ui/components/DiceDisplay'

interface DiceBowlControlProps {
  /** 当前需要展示的骰子结果；没有结果时只显示空碗作为掷骰入口。 */
  roll: DiceRoll | null
  /** 是否处于掷骰动画和结果停留阶段。 */
  rolling: boolean
  /** 规则层允许当前真人主动掷骰时传入对应动作。 */
  rollAction: PreparedAction | null
  /** 右上角展示的结果文字，统一由外层按规则门类生成。 */
  resultLabel: string | null
  /** 点击骰碗后提交规则层的掷骰动作。 */
  onRoll: (action: PreparedAction) => void
}

interface BowlPosition {
  /** 骰碗左上角相对牌桌容器的横坐标。 */
  left: number
  /** 骰碗左上角相对牌桌容器的纵坐标。 */
  top: number
}

interface BowlDragSession {
  /** 指针按下时的横坐标，用于判断点击还是拖动。 */
  startX: number
  /** 指针按下时的纵坐标，用于判断点击还是拖动。 */
  startY: number
  /** 拖动开始前骰碗相对牌桌的横坐标。 */
  originLeft: number
  /** 拖动开始前骰碗相对牌桌的纵坐标。 */
  originTop: number
  /** 当前骰碗宽度，限制拖动边界时使用。 */
  width: number
  /** 当前骰碗高度，限制拖动边界时使用。 */
  height: number
  /** 牌桌容器宽度，限制拖动边界时使用。 */
  containerWidth: number
  /** 牌桌容器高度，限制拖动边界时使用。 */
  containerHeight: number
  /** 是否已经超过拖动阈值，避免轻点碗时误判为拖动。 */
  hasMoved: boolean
}

/**
 * 将数值限制在指定区间内，拖动骰碗时防止被拖出牌桌可见区域。
 */
function clampValue(value: number, min: number, max: number): number {
  if (max <= min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}

/**
 * 牌桌上的骰碗入口。平时固定在右上角，玩家需要掷骰时点击碗；
 * 规则结果生成后，同一个碗飞到桌面中间播放 3D 动画，再收回右上角显示点数。
 */
export function DiceBowlControl({
  roll,
  rolling,
  rollAction,
  resultLabel,
  onRoll,
}: DiceBowlControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dragSessionRef = useRef<BowlDragSession | null>(null)
  const cleanupDragListenersRef = useRef<() => void>(() => {})
  const suppressNextClickRef = useRef(false)
  const [bowlPosition, setBowlPosition] = useState<BowlPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const canRoll = Boolean(rollAction) && !rolling
  const label = !rolling && canRoll
    ? '点碗掷骰'
    : !rolling && roll
      ? resultLabel
      : null
  const controlStyle: CSSProperties = !rolling && bowlPosition
    ? { left: `${bowlPosition.left}px`, top: `${bowlPosition.top}px` }
    : {}

  /**
   * 根据当前指针位置更新骰碗坐标。超过 6 像素才进入拖动，
   * 这样普通点击掷骰不会被误吞掉。
   */
  function updateBowlDrag(clientX: number, clientY: number): void {
    const dragSession = dragSessionRef.current

    if (!dragSession) {
      return
    }

    const deltaX = clientX - dragSession.startX
    const deltaY = clientY - dragSession.startY
    const dragDistance = Math.hypot(deltaX, deltaY)

    if (!dragSession.hasMoved && dragDistance < 6) {
      return
    }

    dragSession.hasMoved = true
    suppressNextClickRef.current = true
    setIsDragging(true)
    setBowlPosition({
      left: clampValue(
        dragSession.originLeft + deltaX,
        4,
        dragSession.containerWidth - dragSession.width - 4,
      ),
      top: clampValue(
        dragSession.originTop + deltaY,
        0,
        dragSession.containerHeight - dragSession.height - 6,
      ),
    })
  }

  /**
   * 结束拖动后短暂保留点击抑制标记，防止浏览器补发 click 导致误掷骰。
   */
  function endBowlDrag(): void {
    const hadMoved = dragSessionRef.current?.hasMoved ?? false
    dragSessionRef.current = null
    cleanupDragListenersRef.current()
    cleanupDragListenersRef.current = () => {}
    setIsDragging(false)

    if (hadMoved) {
      window.setTimeout(() => {
        suppressNextClickRef.current = false
      }, 120)
    }
  }

  /**
   * 初始化骰碗拖动。拖动边界以最近的牌桌容器为准，
   * 因此在不同手机分辨率下不会依赖写死的屏幕坐标。
   */
  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || rolling) {
      return
    }

    const buttonElement = buttonRef.current
    const tableElement = buttonElement?.closest('.game-table') as HTMLElement | null

    if (!buttonElement || !tableElement) {
      return
    }

    const buttonRect = buttonElement.getBoundingClientRect()
    const tableRect = tableElement.getBoundingClientRect()

    dragSessionRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: buttonRect.left - tableRect.left,
      originTop: buttonRect.top - tableRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
      containerWidth: tableRect.width,
      containerHeight: tableRect.height,
      hasMoved: false,
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateBowlDrag(moveEvent.clientX, moveEvent.clientY)
    }
    const handlePointerUp = () => {
      endBowlDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
    cleanupDragListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }

  useEffect(() => {
    return () => {
      cleanupDragListenersRef.current()
    }
  }, [])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        'dice-bowl-control',
        rolling ? 'dice-bowl-control--rolling' : '',
        canRoll ? 'dice-bowl-control--ready' : '',
        roll ? 'dice-bowl-control--has-result' : '',
        isDragging ? 'dice-bowl-control--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={canRoll ? '点击骰碗掷骰子' : label ?? '骰碗'}
      aria-disabled={!canRoll}
      style={controlStyle}
      onPointerDown={handlePointerDown}
      onClick={() => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false
          return
        }

        if (rollAction && !rolling) {
          onRoll(rollAction)
        }
      }}
    >
      <DiceDisplay roll={roll} animate={rolling} bowl compact={!rolling} hideDice={!roll} />
      {label ? <span className="dice-bowl-control__label">{label}</span> : null}
    </button>
  )
}
