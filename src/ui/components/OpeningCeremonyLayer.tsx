import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

import type {
  CardDefinition,
  CardInstance,
  RoundState,
  SeatConfig,
  SeatId,
} from '@/rules-core/types'
import { advanceSeat } from '@/rules-core/collections'
import { DiceDisplay } from '@/ui/components/DiceDisplay'
import { PaiCard } from '@/ui/components/PaiCard'
import { playGameSound } from '@/ui/audio/gameAudio'

type CeremonyPhase = 'shuffle' | 'stack' | 'dice' | 'deal' | 'reveal'

interface OpeningCeremonyLayerProps {
  /** 当前局快照，动画只读这里的数据，不参与真实规则推进。 */
  round: RoundState
  /** 四个座位配置，用于显示庄家和抓牌方向。 */
  seatConfigs: SeatConfig[]
  /** 牌定义映射，背面牌也复用同一个 PaiCard 组件保持质感一致。 */
  cardDefinitions: Record<string, CardDefinition>
  /** 仪式正常播放结束或用户跳过时通知控制器放开牌局。 */
  onDone: () => void
}

interface CeremonyPile {
  /** 本墩在桌面上的横向百分比。 */
  x: number
  /** 本墩在桌面上的纵向百分比。 */
  y: number
  /** 本墩的随机旋转角度。 */
  rotate: number
  /** 本墩模拟的牌张数量，用来画出厚度和随机层数。 */
  size: number
}

interface DealPair {
  /** 抓牌顺序中的第几手。 */
  order: number
  /** 抓到牌的座位。 */
  seat: SeatId
  /** 该座位第几墩两张牌。 */
  pairIndex: number
  /** 本次抓到的两张真实牌实例。 */
  cards: CardInstance[]
}

const PHASE_TIMING: Record<CeremonyPhase, number> = {
  shuffle: 0,
  stack: 1650,
  dice: 3000,
  deal: 4700,
  reveal: 7600,
}

const TOTAL_DURATION_MS = 9800

/**
 * 简单确定性随机数，确保同一局动画布局稳定，不会因为 React 重渲染乱跳。
 */
function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647

  if (value <= 0) {
    value += 2147483646
  }

  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

/**
 * 读取座位展示名。动画层只做展示，缺失配置时用座位号兜底。
 */
function getSeatName(seatConfigs: SeatConfig[], seat: SeatId): string {
  return seatConfigs.find((seatConfig) => seatConfig.seat === seat)?.name ?? `座位${seat}`
}

/**
 * 将 32 张牌随机拆成 6-8 墩，并沿桌面长轴竖向排成一条线。
 */
function createCeremonyPiles(seed: number): CeremonyPile[] {
  const random = createSeededRandom(seed)
  const pileCount = 6 + Math.floor(random() * 3)
  const sizes = Array.from({ length: pileCount }, () => 3)
  let remaining = 32 - pileCount * 3

  while (remaining > 0) {
    const index = Math.floor(random() * pileCount)
    sizes[index] += 1
    remaining -= 1
  }

  return sizes.map((size, index) => {
    const progress = pileCount === 1 ? 0.5 : index / (pileCount - 1)
    return {
      x: 50 + (random() - 0.5) * 14,
      y: 21 + progress * 49 + (random() - 0.5) * 2.4,
      rotate: -4.4 + random() * 8.8,
      size,
    }
  })
}

/**
 * 从庄开始每家每次抓两张，四轮后每人 8 张。
 */
function createDealPairs(round: RoundState): DealPair[] {
  return Array.from({ length: 4 }, (_, pairIndex) =>
    Array.from({ length: 4 }, (_, seatOffset) => {
      const seat = advanceSeat(round.firstLeader, seatOffset)
      const seatState = round.seats.find((item) => item.seat === seat)

      return {
        order: pairIndex * 4 + seatOffset,
        seat,
        pairIndex,
        cards: seatState?.hand.slice(pairIndex * 2, pairIndex * 2 + 2) ?? [],
      }
    }),
  ).flat()
}

/**
 * 计算抓牌后两张牌最终停在头像附近的位置。
 */
function getDealTarget(pair: DealPair): { x: number; y: number; rotate: number } {
  if (pair.seat === 0) {
    return { x: 33 + pair.pairIndex * 11.5, y: 80, rotate: -2 + pair.pairIndex * 1.2 }
  }

  if (pair.seat === 2) {
    return { x: 33 + pair.pairIndex * 11.5, y: 21, rotate: 2 - pair.pairIndex * 1.2 }
  }

  if (pair.seat === 1) {
    return { x: 80, y: 37 + pair.pairIndex * 7.5, rotate: 4 }
  }

  return { x: 20, y: 37 + pair.pairIndex * 7.5, rotate: -4 }
}

/**
 * 获取用于洗牌散牌动画的真实牌实例，全部背面展示，不泄露牌面。
 */
function getAllRoundCards(round: RoundState): CardInstance[] {
  return round.seats.flatMap((seatState) => seatState.hand)
}

/**
 * 单张动画背面牌。即使背面不显示点数，也传入真实定义保证尺寸和阴影一致。
 */
function CeremonyBackCard({
  card,
  cardDefinitions,
}: {
  card: CardInstance
  cardDefinitions: Record<string, CardDefinition>
}) {
  return (
    <PaiCard
      card={card}
      definition={cardDefinitions[card.definitionId]}
      hidden
      compact
    />
  )
}

/**
 * 开局仪式层：洗牌、垒墩、掷骰、抓牌，结束后直接回到真实手牌区。
 */
export function OpeningCeremonyLayer({
  round,
  seatConfigs,
  cardDefinitions,
  onDone,
}: OpeningCeremonyLayerProps) {
  const [phase, setPhase] = useState<CeremonyPhase>('shuffle')
  const [canSkip, setCanSkip] = useState(false)
  const allCards = useMemo(() => getAllRoundCards(round), [round])
  const piles = useMemo(
    () => createCeremonyPiles(round.roundNumber * 97 + round.firstLeader * 13),
    [round.firstLeader, round.roundNumber],
  )
  const dealPairs = useMemo(() => createDealPairs(round), [round])
  const dealerName = getSeatName(seatConfigs, round.firstLeader)

  useEffect(() => {
    setCanSkip(false)
    const phaseTimers = (Object.entries(PHASE_TIMING) as [CeremonyPhase, number][])
      .map(([nextPhase, delay]) =>
        window.setTimeout(() => setPhase(nextPhase), delay),
      )
    const skipTimer = window.setTimeout(() => setCanSkip(true), 1200)
    const doneTimer = window.setTimeout(onDone, TOTAL_DURATION_MS)

    return () => {
      phaseTimers.forEach((timerId) => window.clearTimeout(timerId))
      window.clearTimeout(skipTimer)
      window.clearTimeout(doneTimer)
    }
  }, [onDone, round.roundNumber])

  useEffect(() => {
    if (phase === 'shuffle' || phase === 'stack') {
      playGameSound('cardShuffle')
      return
    }

    if (phase === 'dice') {
      playGameSound('diceRoll')
      return
    }

    if (phase === 'reveal') {
      playGameSound('cardPlay')
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'deal') {
      return
    }

    let dealSoundCount = 0
    const intervalId = window.setInterval(() => {
      playGameSound('cardDiscard')
      dealSoundCount += 1

      if (dealSoundCount >= dealPairs.length) {
        window.clearInterval(intervalId)
      }
    }, 155)

    return () => window.clearInterval(intervalId)
  }, [dealPairs.length, phase])

  return (
    <motion.div
      key={round.roundNumber}
      className="opening-ceremony"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="opening-ceremony__felt" />

      <div className="opening-ceremony__seat opening-ceremony__seat--north">
        {getSeatName(seatConfigs, 2)}
      </div>
      <div className="opening-ceremony__seat opening-ceremony__seat--east">
        {getSeatName(seatConfigs, 1)}
      </div>
      <div className="opening-ceremony__seat opening-ceremony__seat--south">
        {getSeatName(seatConfigs, 0)}
      </div>
      <div className="opening-ceremony__seat opening-ceremony__seat--west">
        {getSeatName(seatConfigs, 3)}
      </div>

      {phase === 'shuffle' ? (
        <div className="opening-ceremony__shuffle">
          {allCards.slice(0, 26).map((card, index) => {
            const random = createSeededRandom(round.roundNumber * 1000 + index * 31)
            const x = -120 + random() * 240
            const y = -132 + random() * 228

            return (
              <motion.div
                key={`shuffle-${card.id}`}
                className="opening-ceremony__shuffle-card"
                initial={{ x: 0, y: 0, rotate: index * 11, opacity: 0.7 }}
                animate={{
                  x,
                  y,
                  rotate: -40 + random() * 80,
                  opacity: 0.92,
                }}
                transition={{
                  duration: 0.58,
                  delay: index * 0.015,
                  repeat: 2,
                  repeatType: 'mirror',
                  ease: 'easeInOut',
                }}
              >
                <CeremonyBackCard card={card} cardDefinitions={cardDefinitions} />
              </motion.div>
            )
          })}
        </div>
      ) : null}

      {phase !== 'shuffle' && phase !== 'reveal' ? (
        <div className="opening-ceremony__piles">
          {piles.map((pile, pileIndex) => {
            const card = allCards[pileIndex] ?? allCards[0]

            if (!card) {
              return null
            }

            const visibleLayers = 4

            return (
              <motion.div
                key={`pile-${pileIndex}`}
                className="opening-ceremony__pile"
                style={{
                  left: `${pile.x}%`,
                  top: `${pile.y}%`,
                }}
                initial={{ opacity: 0, scale: 0.7, rotate: 0 }}
                animate={{
                  opacity: phase === 'deal' ? 0.52 : 1,
                  scale: phase === 'deal' ? 0.82 : 1,
                  rotate: pile.rotate,
                }}
                transition={{ duration: 0.55, delay: pileIndex * 0.05 }}
              >
                {Array.from({ length: visibleLayers }, (_, layerIndex) => {
                  const stackIndex = visibleLayers - layerIndex - 1

                  return (
                    <span
                      key={`${pileIndex}-${layerIndex}`}
                      className="opening-ceremony__pile-layer"
                      style={{
                        zIndex: layerIndex + 1,
                        transform: `translate(${stackIndex * 0.65}px, ${stackIndex * 6.2}px)`,
                      }}
                    >
                      <CeremonyBackCard card={card} cardDefinitions={cardDefinitions} />
                    </span>
                  )
                })}
              </motion.div>
            )
          })}
        </div>
      ) : null}

      {phase === 'dice' ? (
        <motion.div
          className="opening-ceremony__dice"
          initial={{ opacity: 0, scale: 0.72, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.42 }}
        >
          <span className="opening-ceremony__dice-title">掷骰定庄</span>
          <div className="opening-ceremony__bowl opening-ceremony__bowl--3d" aria-hidden="true">
            <DiceDisplay roll={round.ceremony.roll} animate={phase === 'dice'} bowl />
          </div>
          <strong>庄：{dealerName}</strong>
        </motion.div>
      ) : null}

      {phase === 'deal' || phase === 'reveal' ? (
        <div className="opening-ceremony__deal">
          {dealPairs.map((pair) => {
            const target = getDealTarget(pair)
            const firstCard = pair.cards[0]

            if (!firstCard) {
              return null
            }

            return (
              <motion.div
                key={`deal-${pair.order}-${pair.seat}`}
                className={`opening-ceremony__deal-pair opening-ceremony__deal-pair--seat-${pair.seat}`}
                initial={{
                  left: '50%',
                  top: '49%',
                  opacity: 0,
                  scale: 0.72,
                  rotate: 0,
                }}
                animate={{
                  left: `${target.x}%`,
                  top: `${target.y}%`,
                  opacity: phase === 'reveal' && pair.seat === 0 ? 0 : 1,
                  scale: 1,
                  rotate: target.rotate,
                }}
                transition={{
                  duration: 0.5,
                  delay: phase === 'deal' ? pair.order * 0.145 : 0,
                  ease: [0.24, 0.82, 0.32, 1],
                }}
              >
                {pair.cards.map((card, cardIndex) => (
                  <span
                    key={card.id}
                    className="opening-ceremony__deal-card"
                    style={{
                      zIndex: cardIndex + 1,
                      transform: `translate(${(pair.cards.length - cardIndex - 1) * 1.3}px, ${
                        (pair.cards.length - cardIndex - 1) * 14
                      }px) rotate(${cardIndex ? 0.8 : -0.8}deg)`,
                    }}
                  >
                    <CeremonyBackCard card={card} cardDefinitions={cardDefinitions} />
                  </span>
                ))}
              </motion.div>
            )
          })}
        </div>
      ) : null}

      {phase === 'reveal' ? (
        <motion.div
          className="opening-ceremony__reveal"
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.38, ease: 'easeOut' }}
        >
          <span>抓牌完成，准备入局</span>
        </motion.div>
      ) : null}

      <div className="opening-ceremony__caption">
        <strong>
          {phase === 'shuffle'
            ? '洗牌中'
            : phase === 'stack'
              ? '垒牌成墩'
              : phase === 'dice'
                ? '骰子落定'
                : phase === 'deal'
                  ? '从庄家开始抓牌'
                  : '抓牌完成'}
        </strong>
        <span>{phase === 'deal' ? '每次抓 2 张，每家抓 4 墩' : '模拟线下开局流程'}</span>
      </div>

      <button
        type="button"
        className="opening-ceremony__skip"
        disabled={!canSkip}
        onClick={() => {
          if (canSkip) {
            onDone()
          }
        }}
      >
        跳过抓牌
      </button>
    </motion.div>
  )
}
