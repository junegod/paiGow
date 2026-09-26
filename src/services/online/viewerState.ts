import type { MatchState, SeatId, TrickRecord } from '@/rules-core/types'
import { mapSeatForViewer } from '@/services/online/viewerSeats'

/**
 * 转换可为 null 的必填座位字段，null 语义保持不变。
 *
 * @param seat 原座位。
 * @param viewerSeat 当前玩家座位。
 * @returns 视角座位。
 */
function remapNullableSeat(
  seat: SeatId | null,
  viewerSeat: SeatId,
): SeatId | null {
  return seat === null ? null : mapSeatForViewer(seat, viewerSeat)
}

/**
 * 转换可选座位字段，undefined 语义保持不变。
 *
 * @param seat 原座位。
 * @param viewerSeat 当前玩家座位。
 * @returns 视角座位。
 */
function remapOptionalSeat(
  seat: SeatId | undefined,
  viewerSeat: SeatId,
): SeatId | undefined {
  return seat === undefined ? undefined : mapSeatForViewer(seat, viewerSeat)
}

/**
 * 把服务端 MatchState 转成当前玩家的牌桌视角。
 * 服务端已经裁剪对手手牌；这里进一步保证 UI 底部永远是自己的座位。
 *
 * @param state 服务端原始状态。
 * @param viewerSeat 当前玩家逻辑座位。
 * @returns 当前视角的状态快照。
 */
export function createMatchStateForViewer(
  state: MatchState,
  viewerSeat: SeatId,
): MatchState {
  if (viewerSeat === 0) {
    return structuredClone(state)
  }

  const nextState = structuredClone(state)
  nextState.seatConfigs = nextState.seatConfigs
    .map((seatConfig) => ({
      ...seatConfig,
      seat: mapSeatForViewer(seatConfig.seat, viewerSeat),
    }))
    .sort((left, right) => left.seat - right.seat)
  nextState.lastRoundLastTrickWinner = remapNullableSeat(
    nextState.lastRoundLastTrickWinner,
    viewerSeat,
  )

  if (nextState.currentRound) {
    const round = nextState.currentRound
    /** 将一条已完成回合记录中的所有座位转换为当前玩家视角。 */
    const remapTrick = (trick: TrickRecord): TrickRecord => ({
      ...trick,
      leader: mapSeatForViewer(trick.leader, viewerSeat),
      winner: mapSeatForViewer(trick.winner, viewerSeat),
      visibleWinningSeat: mapSeatForViewer(trick.visibleWinningSeat, viewerSeat),
      rewardOwner: remapOptionalSeat(trick.rewardOwner, viewerSeat),
      plays: trick.plays.map((play) => ({
        ...play,
        seat: mapSeatForViewer(play.seat, viewerSeat),
      })),
    })

    round.seats = round.seats
      .map((seatState) => ({
        ...seatState,
        seat: mapSeatForViewer(seatState.seat, viewerSeat),
        config: {
          ...seatState.config,
          seat: mapSeatForViewer(seatState.config.seat, viewerSeat),
        },
        wonTricks: seatState.wonTricks.map(remapTrick),
      }))
      .sort((left, right) => left.seat - right.seat)
    round.currentSeat = remapNullableSeat(round.currentSeat, viewerSeat)
    round.firstLeader = mapSeatForViewer(round.firstLeader, viewerSeat)
    round.lastTrickWinner = remapOptionalSeat(round.lastTrickWinner, viewerSeat)
    round.ceremony = {
      ...round.ceremony,
      roller: mapSeatForViewer(round.ceremony.roller, viewerSeat),
      firstLeader: mapSeatForViewer(round.ceremony.firstLeader, viewerSeat),
      firstRoller: remapOptionalSeat(round.ceremony.firstRoller, viewerSeat),
      secondRoller: remapOptionalSeat(round.ceremony.secondRoller, viewerSeat),
    }
    round.pendingDice = round.pendingDice
      ? {
          ...round.pendingDice,
          seat: mapSeatForViewer(round.pendingDice.seat, viewerSeat),
        }
      : null

    if (round.currentTrick) {
      round.currentTrick = {
        ...round.currentTrick,
        leader: mapSeatForViewer(round.currentTrick.leader, viewerSeat),
        currentWinningSeat: mapSeatForViewer(round.currentTrick.currentWinningSeat, viewerSeat),
        responseSeat: remapNullableSeat(round.currentTrick.responseSeat, viewerSeat),
        rewardOwner: remapOptionalSeat(round.currentTrick.rewardOwner, viewerSeat),
        plays: round.currentTrick.plays.map((play) => ({
          ...play,
          seat: mapSeatForViewer(play.seat, viewerSeat),
        })),
      }
    }

    round.publicTrickLog = round.publicTrickLog.map(remapTrick)

    if (round.rewardOutcome) {
      round.rewardOutcome = {
        ...round.rewardOutcome,
        owner: mapSeatForViewer(round.rewardOutcome.owner, viewerSeat),
        winner: mapSeatForViewer(round.rewardOutcome.winner, viewerSeat),
      }
    }

    if (round.settlement) {
      round.settlement = {
        ...round.settlement,
        collector: mapSeatForViewer(round.settlement.collector, viewerSeat),
        rewardOwner: remapOptionalSeat(round.settlement.rewardOwner, viewerSeat),
        rewardOutcome: round.settlement.rewardOutcome
          ? {
              ...round.settlement.rewardOutcome,
              owner: mapSeatForViewer(round.settlement.rewardOutcome.owner, viewerSeat),
              winner: mapSeatForViewer(round.settlement.rewardOutcome.winner, viewerSeat),
            }
          : undefined,
        seats: round.settlement.seats.map((seatSettlement) => ({
          ...seatSettlement,
          seat: mapSeatForViewer(seatSettlement.seat, viewerSeat),
        })),
      }
    }
  }

  /*
   * 历史局同样属于当前玩家视角；否则第二局以后累计积分和复盘座位会回到服务端坐标。
   * 这里用空 replayRounds 的临时 MatchState 复用同一套完整转换，避免遗漏深层座位字段。
   */
  nextState.replayRounds = state.replayRounds.map((replayRound) => {
    const replayView = createMatchStateForViewer({
      ...state,
      currentRound: replayRound,
      replayRounds: [],
    }, viewerSeat)

    if (!replayView.currentRound) {
      throw new Error('联机历史局缺少牌局状态。')
    }

    return replayView.currentRound
  })

  return nextState
}

/**
 * 将界面动作座位还原为服务端逻辑座位。
 *
 * @param seat 当前玩家看到的界面座位。
 * @param viewerSeat 当前玩家逻辑座位。
 * @returns 服务端座位。
 */
export function mapSeatFromViewer(seat: SeatId, viewerSeat: SeatId): SeatId {
  return (((seat + viewerSeat) % 4) as SeatId)
}
