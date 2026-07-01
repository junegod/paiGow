import type {
  RewardOutcome,
  RoundSettlement,
  RoundState,
  SeatSettlement,
} from '@/rules-core/types'

const REWARD_EXEMPT_MIN_PIERS = 3

/**
 * 计算非满 8 墩场景下，某个墩数相对 4 墩保本线的基础进出。
 * 正数表示该玩家基础进分，负数表示该玩家基础出分。
 */
export function getBaseDeltaFromWonPiers(wonPierCount: number): number {
  return wonPierCount - 4
}

/**
 * 判断当前赏是否真的产生赏钱。死赏只是不允许被吃的出牌方式，
 * 不产生赏钱；活赏被吃后赏钱也失效。
 */
function hasActiveRewardMoney(rewardOutcome?: RewardOutcome): rewardOutcome is RewardOutcome {
  if (!rewardOutcome || rewardOutcome.mode !== 'live' || rewardOutcome.wasEaten) {
    return false
  }

  return true
}

/**
 * 普通活赏每家出 2 个；最后两墩出的赏传统叫“孵赏”，每家出 4 个。
 */
function getNormalRewardValue(rewardOutcome: RewardOutcome): number {
  return rewardOutcome.wasLastTwo ? 4 : 2
}

/**
 * 结算文案里区分普通赏钱和孵赏钱，让玩家一眼知道这笔钱来自最后两墩赏。
 */
function getRewardMoneyLabel(rewardOutcome: RewardOutcome): string {
  return rewardOutcome.wasLastTwo ? '孵赏钱' : '赏钱'
}

/**
 * 非满 8 墩时，打到 3 墩及以上的人不用出赏钱。
 * 这里只筛出真正需要出赏钱的玩家，方便扣分和汇总文案保持一致。
 */
function getNormalRewardPayers(round: RoundState, rewardOutcome: RewardOutcome) {
  return round.seats.filter(
    (seat) =>
      seat.seat !== rewardOutcome.owner &&
      seat.wonPierCount < REWARD_EXEMPT_MIN_PIERS,
  )
}

/**
 * 根据活赏结果计算额外奖惩。普通局里只有未满 3 墩的玩家出赏钱；
 * 3 墩及以上免出，这条是系统结算最容易漏的本地口径。
 */
function applyRewardDelta(
  round: RoundState,
  seatDeltas: Map<number, { baseDelta: number; rewardDelta: number }>,
): void {
  const rewardOutcome = round.rewardOutcome

  if (!hasActiveRewardMoney(rewardOutcome)) {
    return
  }

  const rewardValue = getNormalRewardValue(rewardOutcome)
  const rewardPayers = getNormalRewardPayers(round, rewardOutcome)

  for (const payer of rewardPayers) {
    const delta = seatDeltas.get(payer.seat)

    if (delta) {
      delta.rewardDelta -= rewardValue
    }
  }

  const ownerDelta = seatDeltas.get(rewardOutcome.owner)

  if (ownerDelta) {
    ownerDelta.rewardDelta += rewardValue * rewardPayers.length
  }
}

/**
 * 满 8 墩时基础账固定是每家出 8 个；如果同局带活赏，
 * 赏钱需要另拆出来展示，避免把“8 墩钱”和“赏钱”混成一个数字。
 */
function getSweepRewardValue(rewardOutcome?: RewardOutcome): number {
  if (!hasActiveRewardMoney(rewardOutcome)) {
    return 0
  }

  return rewardOutcome.wasLastTwo ? 8 : 2
}

/**
 * 生成非满 8 墩的赏钱总结。这里必须写出“未满 3 墩才出”，
 * 否则玩家会误以为所有人都要出赏钱。
 */
function createNormalRewardSummary(round: RoundState): string {
  const rewardOutcome = round.rewardOutcome

  if (!hasActiveRewardMoney(rewardOutcome)) {
    return '本局无额外赏钱。'
  }

  const rewardValue = getNormalRewardValue(rewardOutcome)
  const rewardPayers = getNormalRewardPayers(round, rewardOutcome)
  const rewardLabel = getRewardMoneyLabel(rewardOutcome)
  const rewardName = rewardOutcome.wasLastTwo ? '孵赏' : '中途赏'

  if (rewardPayers.length === 0) {
    return `${rewardName}未被吃，但其他玩家都已打到 3 墩及以上，不出${rewardLabel}。`
  }

  return `${rewardName}未被吃，未满 3 墩的玩家每人另出 ${rewardValue} 个${rewardLabel}。`
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
    const rewardLabel =
      round.rewardOutcome && hasActiveRewardMoney(round.rewardOutcome)
        ? getRewardMoneyLabel(round.rewardOutcome)
        : '赏钱'

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
              ? `满 8 墩基础收 ${baseDelta} 个，${rewardLabel}收 ${rewardDelta} 个`
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
            ? `对方满 8 墩基础出 ${baseValue} 个，${rewardLabel}出 ${rewardValue} 个`
            : `对方满 8 墩，出 ${baseValue} 个`,
      }
    })
    const rewardSummary =
      rewardValue > 0
        ? `基础每家出 ${baseValue} 个，${rewardLabel}每家另出 ${rewardValue} 个。`
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

  applyRewardDelta(round, seatDeltas)

  const seats = round.seats.map<SeatSettlement>((seat) => {
    const delta = seatDeltas.get(seat.seat)

    if (!delta) {
      throw new Error('缺少玩家结算数据。')
    }

    const totalDelta = delta.baseDelta + delta.rewardDelta
    const rewardLabel =
      round.rewardOutcome && hasActiveRewardMoney(round.rewardOutcome)
        ? getRewardMoneyLabel(round.rewardOutcome)
        : '赏钱'
    const rewardText =
      delta.rewardDelta === 0
        ? ''
        : delta.rewardDelta > 0
          ? `，${rewardLabel}收 ${delta.rewardDelta} 个`
          : `，${rewardLabel}出 ${Math.abs(delta.rewardDelta)} 个`
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

  return {
    collector: round.lastTrickWinner,
    isSweep: false,
    seats,
    rewardOwner: round.rewardOutcome?.owner,
    rewardOutcome: round.rewardOutcome,
    summary: `基础分按 4 墩保本逐家进出，最后一回合赢家承接净额。${createNormalRewardSummary(round)}`,
  }
}
