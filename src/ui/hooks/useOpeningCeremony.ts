import { useEffect, useRef, useState } from 'react'

import type { RoundState } from '@/rules-core/types'
import { playGameSound } from '@/ui/audio/gameAudio'
import type { CeremonyStage } from '@/ui/table3d/tableView'
import { HAND_REVEAL_DURATION_MS, HAND_REVEAL_STAGGER_MS, HAND_SIZE } from '@/ui/table3d/tableMetrics'

/**
 * 开局仪式的阶段：洗牌、垒牌成墩、掷骰定先手、各家抓牌、抓完亮牌。
 */
type CeremonyPhase = 'shuffle' | 'stack' | 'dice' | 'deal' | 'reveal'

/**
 * 各阶段相对仪式开始的起始时间（毫秒）。
 */
const PHASE_START_MS: Record<CeremonyPhase, number> = {
  shuffle: 0,
  stack: 1650,
  dice: 3000,
  deal: 4900,
  // 最后一手抓牌存在延迟和飞行动画，留出落位余量后再亮牌，避免剩余牌墩提前暴露点位。
  reveal: 8000,
}

/**
 * 翻牌完成后的短暂停留（毫秒），让最后一张落稳后再开放操作。
 */
const REVEAL_SETTLE_MS = 160

/**
 * 仪式总时长（毫秒），必须覆盖整排手牌错峰翻面的完整过程。
 */
const TOTAL_DURATION_MS = PHASE_START_MS.reveal + (HAND_SIZE - 1) * HAND_REVEAL_STAGGER_MS +
  HAND_REVEAL_DURATION_MS + REVEAL_SETTLE_MS

/**
 * 洗牌阶段每隔多久把牌搅动一次（毫秒）。
 */
const SHUFFLE_STIR_MS = 520

/**
 * 仪式开始多久后才允许跳过（毫秒），避免刚点开始就误触跳过。
 */
const SKIP_UNLOCK_MS = 1200

/**
 * 抓牌阶段一共抓多少手，以及每手之间的音效间隔（毫秒）。
 */
const GRAB_COUNT = 16
const GRAB_SOUND_INTERVAL_MS = 150

/**
 * 各阶段显示在牌桌上方的说明文字。
 */
const PHASE_CAPTIONS: Record<CeremonyPhase, { title: string; detail: string }> = {
  shuffle: { title: '洗牌中', detail: '模拟线下开局流程' },
  stack: { title: '垒牌成墩', detail: '随手垒成几墩，每墩张数不一' },
  dice: { title: '掷骰定先手', detail: '' },
  deal: { title: '从先手开始抓牌', detail: '每人每次抓 2 张' },
  reveal: { title: '抓牌完成', detail: '准备入局' },
}

/**
 * 开局仪式对外提供的状态。
 */
export interface OpeningCeremonyState {
  /**
   * 三维牌桌当前应该摆出的仪式阶段；仪式未进行时为空。
   */
  stage: CeremonyStage | null
  /**
   * 是否正处于掷骰阶段，牌桌据此播放骰子翻滚。
   */
  isRollingDice: boolean
  /**
   * 当前阶段的说明文字；仪式未进行时为空。
   */
  caption: { title: string; detail: string } | null
  /**
   * 当前是否允许跳过。
   */
  canSkip: boolean
  /**
   * 跳过仪式，立即进入正式牌局。
   */
  skip: () => void
}

/**
 * 驱动开局仪式的时间轴：按固定节奏推进阶段、播放对应音效，到点后放开正式牌局。
 *
 * 仪式只是演出，规则层在仪式开始前就已经发完牌并确定了先手；这里不改变任何牌局数据。
 *
 * @param round 正在演出仪式的那一局；为空表示当前没有仪式
 * @param onDone 仪式正常结束或被跳过时调用，通知控制器放开牌局
 * @returns 仪式当前阶段、说明文字和跳过入口
 */
export function useOpeningCeremony(round: RoundState | null, onDone: () => void): OpeningCeremonyState {
  const [phase, setPhase] = useState<CeremonyPhase>('shuffle')
  const [shuffleStep, setShuffleStep] = useState(0)
  const [canSkip, setCanSkip] = useState(false)
  // 控制器每次渲染都会给出新的回调函数，用引用保存最新值，避免时间轴因此被反复重置。
  const onDoneRef = useRef(onDone)
  const roundNumber = round?.roundNumber ?? null
  const dealerName = round?.seats.find((seat) => seat.seat === round.firstLeader)?.config.name ?? ''

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    if (roundNumber === null) {
      return
    }
    setPhase('shuffle')
    setShuffleStep(0)
    setCanSkip(false)
    const timers = (Object.entries(PHASE_START_MS) as [CeremonyPhase, number][])
      .filter(([, delay]) => delay > 0)
      .map(([nextPhase, delay]) => window.setTimeout(() => setPhase(nextPhase), delay))
    timers.push(window.setTimeout(() => setCanSkip(true), SKIP_UNLOCK_MS))
    timers.push(window.setTimeout(() => onDoneRef.current(), TOTAL_DURATION_MS))
    const stirTimer = window.setInterval(() => setShuffleStep((step) => step + 1), SHUFFLE_STIR_MS)

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearInterval(stirTimer)
    }
  }, [roundNumber])

  useEffect(() => {
    if (roundNumber === null) {
      return
    }
    if (phase === 'shuffle' || phase === 'stack') {
      playGameSound('cardShuffle')
    } else if (phase === 'dice') {
      playGameSound('diceRoll')
    } else if (phase === 'reveal') {
      playGameSound('cardPlay')
    }
    if (phase !== 'deal') {
      return
    }
    // 抓牌阶段每抓一手响一声，响够手数后自动停止，避免跨阶段继续播放。
    let played = 0
    const grabTimer = window.setInterval(() => {
      playGameSound('cardDiscard')
      played += 1
      if (played >= GRAB_COUNT) {
        window.clearInterval(grabTimer)
      }
    }, GRAB_SOUND_INTERVAL_MS)
    return () => window.clearInterval(grabTimer)
  }, [phase, roundNumber])

  if (roundNumber === null) {
    return { stage: null, isRollingDice: false, caption: null, canSkip: false, skip: () => undefined }
  }

  const caption = PHASE_CAPTIONS[phase]
  return {
    stage: {
      // 掷骰期间保持牌墩；抓牌与亮牌必须分成不同阶段，避免未抓到的牌提前带上点位。
      phase: phase === 'dice' ? 'stack' : phase,
      shuffleStep,
    },
    isRollingDice: phase === 'dice',
    caption: phase === 'dice' ? { title: caption.title, detail: `先手：${dealerName}` } : caption,
    canSkip,
    skip: () => {
      if (canSkip) {
        onDoneRef.current()
      }
    },
  }
}
