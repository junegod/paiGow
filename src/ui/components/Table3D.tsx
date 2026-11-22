import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  CardDefinition,
  CardInstance,
  RoundState,
  SeatId,
  SeatState,
  TrickRecord,
} from '@/rules-core/types'
import { playGameSound } from '@/ui/audio/gameAudio'
import { COLLECT_START_DELAY_MS, COLLECT_STEP_INTERVAL_MS } from '@/ui/table3d/collectionTiming'
import { BOWL_DOCK, SEAT_LAYOUTS } from '@/ui/table3d/tableMetrics'
import type { DiceState } from '@/ui/table3d/diceAnimator'
import { TableScene } from '@/ui/table3d/TableScene'
import {
  buildTableView,
  COLLECT_STEP_COUNT,
  toViewSeat,
  type CeremonyStage,
  type TilePick,
} from '@/ui/table3d/tableView'

/**
 * 骰碗文字相对骰碗位置的偏移：贴在碗靠本方一侧的碗沿上，不挡住碗里的骰子。
 */
const BOWL_LABEL_POINT = { x: BOWL_DOCK.x, y: 0.7, z: BOWL_DOCK.z + 0.95 }

/**
 * 三维牌桌的入参。
 */
interface Table3DProps {
  /**
   * 当前单局状态。
   */
  round: RoundState
  /**
   * 一墩刚打完时停留展示的那一墩。
   */
  reviewTrick: TrickRecord | null
  /**
   * 屏幕下方亮出手牌的座位。
   */
  handSeat: SeatId
  /**
   * 本方手牌，已经按显示顺序排好。
   */
  handCards: CardInstance[]
  /**
   * 当前选中的手牌标识。
   */
  selectedCardIds: string[]
  /**
   * 牌定义映射。
   */
  cardDefinitions: Record<string, CardDefinition>
  /**
   * 开局仪式的当前阶段；为空表示按正常牌局摆放。
   */
  ceremony: CeremonyStage | null
  /**
   * 骰子点数与是否正在掷骰展示。
   */
  dice: DiceState
  /**
   * 骰碗下方显示的文字，例如"点碗掷骰"或掷骰结果；为空不显示。
   */
  bowlLabel: string | null
  /**
   * 当前是否轮到本方并且规则允许掷骰，用于让骰碗文字醒目提示。
   */
  canRollDice: boolean
  /**
   * 手牌当前是否允许点选和拖动。
   */
  canInteract: boolean
  /**
   * 当前行动的座位，用于高亮头像。
   */
  currentSeat: SeatId | null
  /**
   * 画面底部被操作栏占用的高度（像素）。
   */
  bottomInset: number
  /**
   * 读取某个座位姓名旁展示的积分，沿用上层统一的积分口径。
   */
  getSeatScore: (seat: SeatId) => number
  /**
   * 点选一张手牌。
   */
  onCardToggle: (cardId: string) => void
  /**
   * 拖动手牌改变顺序。
   */
  onHandReorder: (cardIds: string[]) => void
  /**
   * 点桌面上的一墩，查看这一墩的出牌详情。
   */
  onInspectTrick: (trickIndex: number) => void
  /**
   * 点头像，查看这一家赢的墩。
   */
  onInspectSeat: (seat: SeatId) => void
  /**
   * 手牌顶边到牌桌底边的像素距离，上层据此摆放出牌按钮。
   */
  onHandTop: (distanceFromBottom: number) => void
  /**
   * 点了骰碗。是否真的掷骰由上层按规则决定。
   */
  onRollDice: () => void
  /**
   * 骰碗回桌帧渲染完成，通知控制器结束本次掷骰展示。
   */
  onDiceDocked: () => void
}

/**
 * 三维牌桌。
 *
 * 用真三维场景渲染桌面、四家的牌、当前墩和赢墩，并叠加四家的头像信息。
 * 组件只做"牌局状态到摆位"的转换和手势转发，规则判断仍全部在规则层。
 *
 * @param props 牌局状态、本方视角信息与手势回调
 * @returns 牌桌画布与头像层；设备不支持三维渲染时返回提示文字
 */
export function Table3D(props: Table3DProps) {
  const { round, reviewTrick, handSeat, handCards, selectedCardIds, cardDefinitions, ceremony, dice } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<TableScene | null>(null)
  const seatRefs = useRef<(HTMLButtonElement | null)[]>([])
  const bowlLabelRef = useRef<HTMLSpanElement>(null)
  /*
   * 场景只创建一次，回调通过引用读取最新值，避免每次渲染都重建场景。
   */
  const latestProps = useRef(props)
  const [unsupported, setUnsupported] = useState(false)
  const [collectStep, setCollectStep] = useState(0)
  const reviewTrickIndex = reviewTrick?.trickIndex ?? null

  useEffect(() => {
    /*
     * 每来一墩新的展示牌都从"还没开始收"算起；没有展示牌时不需要计时。
     */
    setCollectStep(0)
    if (reviewTrickIndex === null) {
      return
    }
    const timers = Array.from({ length: COLLECT_STEP_COUNT }, (_, index) =>
      window.setTimeout(
        () => setCollectStep(index + 1),
        COLLECT_START_DELAY_MS + index * COLLECT_STEP_INTERVAL_MS,
      ),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [reviewTrickIndex])

  useEffect(() => {
    latestProps.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let scene: TableScene
    try {
      scene = new TableScene(container, {
        onPick: (pick: TilePick) => {
          if (pick.type === 'hand') {
            latestProps.current.onCardToggle(pick.cardId)
          } else {
            latestProps.current.onInspectTrick(pick.trickIndex)
          }
        },
        onHandReorder: (cardIds) => latestProps.current.onHandReorder(cardIds),
        onHandTop: (distance) => latestProps.current.onHandTop(distance),
        onBowlPick: () => latestProps.current.onRollDice(),
        onDiceDocked: () => latestProps.current.onDiceDocked(),
        // 声音跟随真实落位回调，仍经统一播放器校验音效开关、总音量和移动端解锁状态。
        onTileLand: (kind) => playGameSound(kind === 'stack' ? 'cardStack' : 'pileDrop'),
      })
    } catch {
      /*
       * 设备或浏览器无法创建三维渲染上下文时不能白屏，改为明确提示。
       */
      setUnsupported(true)
      return
    }
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene.dispose()
    }
  }, [])

  const placements = useMemo(
    () =>
      buildTableView({
        round,
        reviewTrick,
        handSeat,
        handCards,
        selectedCardIds,
        cardDefinitions,
        ceremony,
        collectStep,
      }),
    [round, reviewTrick, handSeat, handCards, selectedCardIds, cardDefinitions, ceremony, collectStep],
  )

  useEffect(() => {
    sceneRef.current?.setPlacements(placements)
  }, [placements])

  useEffect(() => {
    sceneRef.current?.setHandInteractive(props.canInteract)
  }, [props.canInteract])

  useEffect(() => {
    sceneRef.current?.setBottomInset(props.bottomInset)
  }, [props.bottomInset])

  useEffect(() => {
    // 无法创建画布时不会有落位帧，展示计时结束即可解除操作锁定。
    if (unsupported && dice.returning) {
      latestProps.current.onDiceDocked()
      return
    }
    sceneRef.current?.setDice(dice)
  }, [dice, unsupported])

  const hasBowlLabel = props.bowlLabel !== null
  useEffect(() => {
    /*
     * 三家对手的头像和骰碗文字跟随三维位置；本方头像由样式固定在手牌旁边，不参与。
     */
    sceneRef.current?.setAnchors([
      ...[1, 2, 3].map((viewSeat) => ({ element: seatRefs.current[viewSeat], point: SEAT_LAYOUTS[viewSeat].anchor })),
      { element: bowlLabelRef.current, point: BOWL_LABEL_POINT },
    ])
  }, [handSeat, hasBowlLabel])

  if (unsupported) {
    return <p className="table3d__unsupported">当前设备或浏览器不支持 3D 牌桌，请更新系统或更换浏览器后再试。</p>
  }

  /*
   * 开局仪式里掷骰落定之前不能提前标出先手，否则掷骰就没有悬念了。
   */
  const showFirstLeader = !ceremony || ceremony.phase === 'deal' || ceremony.phase === 'reveal'
  /*
   * 头像按界面座位排序，下标 0 永远是屏幕下方的本方。
   */
  const seatsByView: SeatState[] = []
  for (const seatState of round.seats) {
    seatsByView[toViewSeat(seatState.seat, handSeat)] = seatState
  }

  return (
    <div className="table3d">
      <div ref={containerRef} className="table3d__stage" />
      <div className="table3d__vignette" aria-hidden="true" />
      {props.bowlLabel ? (
        <span
          ref={bowlLabelRef}
          className={`table3d__bowl-label ${props.canRollDice ? 'table3d__bowl-label--ready' : ''}`}
        >
          {props.bowlLabel}
        </span>
      ) : null}
      {seatsByView.map((seatState, viewSeat) => (
        <button
          key={seatState.seat}
          ref={(element) => {
            seatRefs.current[viewSeat] = element
          }}
          type="button"
          className={[
            'table3d__seat',
            viewSeat === 0 ? 'table3d__seat--self' : '',
            props.currentSeat === seatState.seat ? 'table3d__seat--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => props.onInspectSeat(seatState.seat)}
          aria-label={`${seatState.config.name}，积分 ${props.getSeatScore(seatState.seat)}，点击查看赢牌`}
        >
          <span className="table3d__face" style={{ background: seatState.config.color }} aria-hidden="true">
            {seatState.config.name.slice(-1)}
            {showFirstLeader && round.firstLeader === seatState.seat ? <i className="table3d__first">先</i> : null}
          </span>
          <span className="table3d__meta">
            {seatState.config.name}
            <b>积分 {props.getSeatScore(seatState.seat)}</b>
          </span>
        </button>
      ))}
    </div>
  )
}
