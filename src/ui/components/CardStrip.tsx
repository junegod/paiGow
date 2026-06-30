import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

import type { CardDefinition, CardInstance } from '@/rules-core/types'

import { PaiCard } from '@/ui/components/PaiCard'

interface CardStripProps {
  /** 需要展示的具体牌实例列表。 */
  cards: CardInstance[]
  /** 牌定义映射，渲染时只通过实例的 definitionId 查找。 */
  cardDefinitions: Record<string, CardDefinition>
  /** 是否整体按背面显示，背面弃牌查看入口会使用这个状态保护信息。 */
  hidden?: boolean
  /** 单张牌背面判断，适合死赏这类“牌型公开但一张盖牌”的传统展示。 */
  getCardHidden?: (card: CardInstance, index: number) => boolean
  /** 单张背面牌说明，避免把死赏盖牌误读成真正弃牌。 */
  getCardHiddenLabel?: (card: CardInstance, index: number) => string | undefined
  /** 紧凑尺寸，适合弹窗详情。 */
  compact?: boolean
  /** 手牌大尺寸，专用于底部当前玩家手牌。 */
  hand?: boolean
  /** 桌面当前墩尺寸，介于手牌和赢墩预览之间。 */
  arena?: boolean
  /** 微缩尺寸，适合赢墩堆、座位预览和弹窗里的小牌。 */
  mini?: boolean
  /** 是否完整展开；关闭时可用于自然叠放。 */
  spread?: boolean
  /** 当前选中的手牌 id，用于顶起和高亮反馈。 */
  selectedCardIds?: string[]
  /** 点击单张牌时触发，通常只在当前真人手牌区开启。 */
  onCardClick?: (cardId: string) => void
  /** 是否允许横向拖动重排；首版只开放给底部当前真人手牌。 */
  draggable?: boolean
  /** 拖动结束或吸附到新位置时返回当前牌 id 顺序。 */
  onCardReorder?: (cardIds: string[]) => void
}

type DragSession = {
  cardId: string
  startX: number
  startY: number
  pointerOffsetX: number
  pointerOffsetY: number
  width: number
  height: number
  hasMoved: boolean
}

type DragPreviewState = {
  cardId: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * 按横向扇形、叠放或完整展开方式展示一组牌，适合手牌、明牌和赢墩详情复用。
 */
export function CardStrip({
  cards,
  cardDefinitions,
  hidden = false,
  getCardHidden,
  getCardHiddenLabel,
  compact = false,
  hand = false,
  arena = false,
  mini = false,
  spread = false,
  selectedCardIds = [],
  onCardClick,
  draggable = false,
  onCardReorder,
}: CardStripProps) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null)
  const suppressNextClickRef = useRef(false)
  const dragSessionRef = useRef<DragSession | null>(null)
  const cleanupDragListenersRef = useRef<() => void>(() => {})
  const itemElementMapRef = useRef(new Map<string, HTMLDivElement>())
  const latestCardIdsRef = useRef<string[]>([])
  const lastPointerStartAtRef = useRef(0)
  const canReorder = draggable && cards.length > 1 && onCardReorder
  const cardIds = cards.map((card) => card.id)
  latestCardIdsRef.current = cardIds
  const className = [
    'card-strip',
    compact ? 'card-strip--compact' : '',
    hand ? 'card-strip--hand' : '',
    arena ? 'card-strip--arena' : '',
    mini ? 'card-strip--mini' : '',
    spread ? 'card-strip--spread' : '',
    canReorder ? 'card-strip--draggable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  /**
   * 拖动释放后浏览器可能补发一次 click，这里短暂吞掉，避免“拖牌排序”同时变成“选牌”。
   */
  function handleCardClick(cardId: string): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    onCardClick?.(cardId)
  }

  /**
   * 计算当前指针最接近的牌槽，拖过相邻牌中心点后立即重排，释放时自然吸附。
   */
  function reorderDraggedCard(cardId: string, clientX: number): void {
    if (!onCardReorder) {
      return
    }

    const currentCardIds = latestCardIdsRef.current
    const currentIndex = currentCardIds.indexOf(cardId)

    if (currentIndex < 0) {
      return
    }

    const targetIndex = currentCardIds.reduce((nearestIndex, currentCardId, index) => {
      const currentElement = itemElementMapRef.current.get(currentCardId)
      const nearestElement = itemElementMapRef.current.get(currentCardIds[nearestIndex])

      if (!currentElement || !nearestElement) {
        return nearestIndex
      }

      const currentRect = currentElement.getBoundingClientRect()
      const nearestRect = nearestElement.getBoundingClientRect()
      const currentDistance = Math.abs(clientX - (currentRect.left + currentRect.width / 2))
      const nearestDistance = Math.abs(clientX - (nearestRect.left + nearestRect.width / 2))

      return currentDistance < nearestDistance ? index : nearestIndex
    }, currentIndex)

    if (targetIndex === currentIndex) {
      return
    }

    const nextCardIds = [...currentCardIds]
    const [movingCardId] = nextCardIds.splice(currentIndex, 1)
    nextCardIds.splice(targetIndex, 0, movingCardId)
    onCardReorder(nextCardIds)
  }

  /**
   * 拖动超过轻微阈值才进入排序态，避免普通点击选牌时误触发拖拽。
   */
  function updateDragSession(clientX: number, clientY: number): void {
    const dragSession = dragSessionRef.current

    if (!dragSession) {
      return
    }

    const dragDistance = Math.hypot(clientX - dragSession.startX, clientY - dragSession.startY)

    if (!dragSession.hasMoved && dragDistance < 7) {
      return
    }

    dragSession.hasMoved = true
    suppressNextClickRef.current = true
    setDraggingCardId(dragSession.cardId)
    setDragPreview({
      cardId: dragSession.cardId,
      left: clientX - dragSession.pointerOffsetX,
      top: clientY - dragSession.pointerOffsetY - 24,
      width: dragSession.width,
      height: dragSession.height,
    })
    reorderDraggedCard(dragSession.cardId, clientX)
  }

  /**
   * 结束拖动后短暂吞掉释放时补发的 click，再恢复正常点选。
   */
  function endDragSession(): void {
    const hadMoved = dragSessionRef.current?.hasMoved ?? false
    dragSessionRef.current = null
    cleanupDragListenersRef.current()
    cleanupDragListenersRef.current = () => {}

    window.setTimeout(() => {
      if (hadMoved) {
        suppressNextClickRef.current = false
      }
      setDraggingCardId(null)
      setDragPreview(null)
    }, 120)
  }

  /**
   * 指针事件用于手机和现代浏览器，是真正触屏拖拽的主路径。
   */
  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    cardId: string,
  ): void {
    if (!canReorder || event.button !== 0) {
      return
    }

    lastPointerStartAtRef.current = Date.now()
    const cardRect = itemElementMapRef.current.get(cardId)?.getBoundingClientRect()

    if (!cardRect) {
      return
    }

    dragSessionRef.current = {
      cardId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - cardRect.left,
      pointerOffsetY: event.clientY - cardRect.top,
      width: cardRect.width,
      height: cardRect.height,
      hasMoved: false,
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateDragSession(moveEvent.clientX, moveEvent.clientY)
    }
    const handlePointerUp = () => {
      endDragSession()
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

  /**
   * 鼠标事件作为桌面与浏览器自动化兜底；紧跟 pointerdown 的合成 mousedown 会被忽略。
   */
  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>, cardId: string): void {
    if (!canReorder || event.button !== 0 || Date.now() - lastPointerStartAtRef.current < 80) {
      return
    }

    const cardRect = itemElementMapRef.current.get(cardId)?.getBoundingClientRect()

    if (!cardRect) {
      return
    }

    dragSessionRef.current = {
      cardId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - cardRect.left,
      pointerOffsetY: event.clientY - cardRect.top,
      width: cardRect.width,
      height: cardRect.height,
      hasMoved: false,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateDragSession(moveEvent.clientX, moveEvent.clientY)
    }
    const handleMouseUp = () => {
      endDragSession()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
    cleanupDragListenersRef.current = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }

  useEffect(() => {
    return () => {
      cleanupDragListenersRef.current()
    }
  }, [])

  /**
   * 统一渲染单张牌，拖动模式和普通模式共用同一套选中态与牌面绘制。
   */
  function renderCard(card: CardInstance, interactive = true, index = cards.indexOf(card)) {
    const definition = cardDefinitions[card.definitionId]
    const isSelected = selectedCardIds.includes(card.id)
    const isHidden = hidden || Boolean(getCardHidden?.(card, index))
    const hiddenLabel = hidden ? undefined : getCardHiddenLabel?.(card, index)

    return (
      <PaiCard
        card={card}
        compact={compact}
        hand={hand}
        arena={arena}
        mini={mini}
        definition={definition}
        hidden={isHidden}
        hiddenLabel={hiddenLabel}
        selected={isSelected}
        onClick={interactive && onCardClick ? () => handleCardClick(card.id) : undefined}
      />
    )
  }

  if (canReorder) {
    const previewCard = dragPreview
      ? cards.find((card) => card.id === dragPreview.cardId) ?? null
      : null

    return (
      <div
        className={className}
      >
        {cards.map((card, index) => {
          const isSelected = selectedCardIds.includes(card.id)

          return (
            <motion.div
              layout
              key={card.id}
              className={[
                'card-strip__item',
                isSelected ? 'card-strip__item--selected' : '',
                draggingCardId === card.id ? 'card-strip__item--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              ref={(element) => {
                if (element) {
                  itemElementMapRef.current.set(card.id, element)
                } else {
                  itemElementMapRef.current.delete(card.id)
                }
              }}
              style={{ '--card-index': index } as CSSProperties}
              animate={{
                y: isSelected && draggingCardId !== card.id ? -20 : 0,
                zIndex: draggingCardId === card.id ? 30 : isSelected ? 3 : 1,
              }}
              transition={{ type: 'spring', stiffness: 720, damping: 34, mass: 0.48 }}
              onPointerDown={(event) => handlePointerDown(event, card.id)}
              onMouseDown={(event) => handleMouseDown(event, card.id)}
            >
              {renderCard(card, true, index)}
            </motion.div>
          )
        })}
        {dragPreview && previewCard && typeof document !== 'undefined'
          ? createPortal(
            /**
             * 拖动预览放到 body 顶层，避免被牌桌容器的 overflow、transform 或 z-index 裁掉。
             */
            <div
              className="card-strip__drag-preview"
              style={{
                left: dragPreview.left,
                top: dragPreview.top,
                width: dragPreview.width,
                height: dragPreview.height,
              }}
            >
              {renderCard(
                previewCard,
                false,
                cards.findIndex((card) => card.id === previewCard.id),
              )}
            </div>,
            document.body,
          )
          : null}
      </div>
    )
  }

  return (
    <div
      className={[
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {cards.map((card, index) => {
        const isSelected = selectedCardIds.includes(card.id)

        return (
          <div
            key={card.id}
            className={[
              'card-strip__item',
              isSelected ? 'card-strip__item--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--card-index': index } as CSSProperties}
          >
            {renderCard(card, true, index)}
          </div>
        )
      })}
    </div>
  )
}
