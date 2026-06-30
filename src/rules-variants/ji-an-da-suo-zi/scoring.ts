import type {
  RewardOutcome,
  RoundSettlement,
  RoundState,
  SeatSettlement,
} from '@/rules-core/types'

/**
 * 计算非满 8 墩场景下，某个墩数相对 4 墩保本线的基础进出。
 * 正数表示该玩家基础进分，负数表示该玩家基础出分。
 */
export function getBaseDeltaFromWonPiers(wonPierCount: number): number {
  return wonPierCount - 4
}

/**
 * 根据活赏结果计算额外奖惩。死赏只是不允许被吃的出牌方式，
 * 不产生赏钱，因此这里必须明确排除 dead。
 */
function applyRewardDelta(
  seatDeltas: Map<number, { baseDelta: number; rewardDelta: number }>,
  rewardOutcome?: RewardOutcome,
): void {
  if (!rewardOutcome || rewardOutcome.mode !== 'live' || rewardOutcome.wasEaten) {
    return
  }

  const rewardValue = rewardOutcome.wasLastTwo ? 4 : 2

  for (const [seat] of seatDeltas) {
    if (seat === rewardOutcome.owner) {
      continue
    }

    const delta = seatDeltas.get(seat)

    if (delta) {
      delta.rewardDelta -= rewardValue
    }
  }

  const ownerDelta = seatDeltas.get(rewardOutcome.owner)

  if (ownerDelta) {
    ownerDelta.rewardDelta += rewardValue * 3
  }
}

/**
 * 满 8 墩时基础账固定是每家出 8 个；如果同局带活赏，
 * 赏钱需要另拆出来展示，避免把“8 墩钱”和“赏钱”混成一个数字。
 */
function getSweepRewardValue(rewardOutcome?: RewardOutcome): number {
  if (!rewardOutcome || rewardOutcome.mode !== 'live' || rewardOutcome.wasEaten) {
    return 0
  }

  return rewardOutcome.wasLastTwo ? 8 : 2
}

/**
 * 计算一局完整结算，默认正数表示赢分、负数表示出分。
 */
export function calculateSettlement(round: RoundState): RoundSettlement {
  if (round.lastTrickWinner === undefined) {
    throw new Error('结算前缺少最后一回合赢家。')
  }

  const sweepWinner = round.seats.find((seat) => seat.wonPierCount === 8)

  if (sweepWinner) {
    const baseValue = 8
    const rewardValue = getSweepRewardValue(round.rewardOutcome)
    const totalValue = baseValue + rewardValue

    const seats = round.seats.map<SeatSettlement>((seat) => {
      if (seat.seat === sweepWinner.seat) {
        const baseDelta = baseValue * 3
        const rewardDelta = rewardValue * 3

        return {
          seat: seat.seat,
          wonPierCount: seat.wonPierCount,
          baseDelta,
          rewardDelta,
          totalDelta: baseDelta + rewardDelta,
          summary:
            rewardDelta > 0
              ? `满 8 墩基础收 ${baseDelta} 个，赏钱收 ${rewardDelta} 个`
              : `满 8 墩，收 ${baseDelta} 个`,
        }
      }

      return {
        seat: seat.seat,
        wonPierCount: seat.wonPierCount,
        baseDelta: -baseValue,
        rewardDelta: -rewardValue,
        totalDelta: -totalValue,
        summary:
          rewardValue > 0
            ? `对方满 8 墩基础出 ${baseValue} 个，赏钱出 ${rewardValue} 个`
            : `对方满 8 墩，出 ${baseValue} 个`,
      }
    })
    const rewardSummary =
      rewardValue > 0
        ? `基础每家出 ${baseValue} 个，赏钱每家另出 ${rewardValue} 个。`
        : `每家出 ${baseValue} 个。`

    return {
      collector: sweepWinner.seat,
      isSweep: true,
      seats,
      rewardOwner: round.rewardOutcome?.owner,
      rewardOutcome: round.rewardOutcome,
      summary: `满 8 墩结算，${rewardSummary}`,
    }
  }

  const seatDeltas = new Map(
    round.seats.map((seat) => [
      seat.seat,
      { baseDelta: 0, rewardDelta: 0 },
    ]),
  )

  const collectorDelta = seatDeltas.get(round.lastTrickWinner)

  if (!collectorDelta) {
    throw new Error('无法找到最后一回合赢家的结算记录。')
  }

  /**
   * 非满 8 墩时，非最后赢家先按“赢墩数 - 4”独立进出。
   * 最后一回合赢家承接其余三家的净额：别人该出则他收，别人该进则他出。
   */
  const collectorGain = round.seats.reduce((total, seat) => {
    if (seat.seat === round.lastTrickWinner) {
      return total
    }

    const baseDelta = getBaseDeltaFromWonPiers(seat.wonPierCount)
    const seatDelta = seatDeltas.get(seat.seat)

    if (seatDelta) {
      seatDelta.baseDelta = baseDelta
    }

    return total - baseDelta
  }, 0)

  collectorDelta.baseDelta = collectorGain

  applyRewardDelta(seatDeltas, round.rewardOutcome)

  const seats = round.seats.map<SeatSettlement>((seat) => {
    const delta = seatDeltas.get(seat.seat)

    if (!delta) {
      throw new Error('缺少玩家结算数据。')
    }

    const totalDelta = delta.baseDelta + delta.rewardDelta
    const rewardText =
      delta.rewardDelta === 0
        ? ''
        : delta.rewardDelta > 0
          ? `，赏钱收 ${delta.rewardDelta} 个`
          : `，赏钱出 ${Math.abs(delta.rewardDelta)} 个`
    const baseText =
      delta.baseDelta === 0
        ? '基础保本'
        : delta.baseDelta > 0
          ? `基础进 ${delta.baseDelta} 个`
          : `基础出 ${Math.abs(delta.baseDelta)} 个`

    return {
      seat: seat.seat,
      wonPierCount: seat.wonPierCount,
      baseDelta: delta.baseDelta,
      rewardDelta: delta.rewardDelta,
      totalDelta,
      summary: `${baseText}${rewardText}`,
    }
  })

  const rewardSummary =
    round.rewardOutcome &&
    round.rewardOutcome.mode === 'live' &&
    !round.rewardOutcome.wasEaten
      ? round.rewardOutcome.wasLastTwo
        ? '最后两张一对赏，每家另出 4 个。'
        : '中途赏未被吃，每家另出 2 个。'
      : '本局无额外赏钱。'

  return {
    collector: round.lastTrickWinner,
    isSweep: false,
    seats,
    rewardOwner: round.rewardOutcome?.owner,
    rewardOutcome: round.rewardOutcome,
    summary: `基础分按 4 墩保本逐家进出，最后一回合赢家承接净额。${rewardSummary}`,
  }
}
