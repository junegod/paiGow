import {
  useEffect,
  useRef,
} from 'react'

import type { AudioPreferences } from '@/local-data/types'
import type {
  PlayedAction,
  RoundState,
} from '@/rules-core/types'
import {
  playGameSound,
  playSeatVoice,
  preloadGameAudio,
  setGameAudioPreferences,
  unlockGameAudio,
  type GameSoundName,
  type VoiceCallName,
} from '@/ui/audio/gameAudio'

interface RoundAudioSnapshot {
  /** 当前局号；没有牌局时为空。 */
  roundNumber: number | null
  /** 当前牌局阶段。 */
  phase: string
  /** 当前待处理骰子的唯一键。 */
  pendingDiceKey: string | null
  /** 当前局累计出牌动作数。 */
  totalPlayCount: number
  /** 已经结束的出牌回合数。 */
  completedTrickCount: number
  /** 结算去重键。 */
  settlementKey: string | null
}

/** 统计当前局已经发生的全部出牌动作。 */
function getRoundTotalPlayCount(round: RoundState): number {
  const historyPlayCount = round.publicTrickLog.reduce(
    (total, trick) => total + trick.plays.length,
    0,
  )

  return historyPlayCount + (round.currentTrick?.plays.length ?? 0)
}

/** 读取当前局最近一次落桌动作，兼容回合刚结束并进入历史记录的状态。 */
function getLatestPlayedAction(round: RoundState): PlayedAction | null {
  const currentPlays = round.currentTrick?.plays ?? []

  if (currentPlays.length > 0) {
    return currentPlays[currentPlays.length - 1]
  }

  const latestTrick = round.publicTrickLog[round.publicTrickLog.length - 1]
  return latestTrick?.plays[latestTrick.plays.length - 1] ?? null
}

/**
 * 判断人物应该喊什么。弃牌不喊；赏使用专用喊声；
 * 当前回合第一家喊“出牌”，后手正面压过前牌时喊“吃”。
 */
function getLatestVoiceCallName(round: RoundState): VoiceCallName | null {
  const currentPlays = round.currentTrick?.plays ?? []
  const latestTrick = round.publicTrickLog[round.publicTrickLog.length - 1]
  const plays = currentPlays.length > 0 ? currentPlays : latestTrick?.plays ?? []
  const latestPlay = plays[plays.length - 1]

  if (!latestPlay?.pattern.isOpen) {
    return null
  }

  if (latestPlay.pattern.rewardMode === 'live') {
    return 'rewardLive'
  }

  if (latestPlay.pattern.rewardMode === 'dead') {
    return 'rewardDead'
  }

  return plays.length > 1 ? 'eat' : 'play'
}

/** 把完整局面压缩成音效关注的字段，避免普通重渲染重复发声。 */
function createRoundAudioSnapshot(round: RoundState | null): RoundAudioSnapshot {
  if (!round) {
    return {
      roundNumber: null,
      phase: 'none',
      pendingDiceKey: null,
      totalPlayCount: 0,
      completedTrickCount: 0,
      settlementKey: null,
    }
  }

  return {
    roundNumber: round.roundNumber,
    phase: round.phase,
    pendingDiceKey: round.pendingDice?.roll.key ?? null,
    totalPlayCount: getRoundTotalPlayCount(round),
    completedTrickCount: round.publicTrickLog.length,
    settlementKey: round.settlement
      ? `${round.roundNumber}:${round.settlement.summary}`
      : null,
  }
}

/** 根据最新牌面是否公开，选择正面落牌或背面弃牌音效。 */
function getPlaySoundName(round: RoundState): GameSoundName {
  return getLatestPlayedAction(round)?.pattern.isOpen ? 'cardPlay' : 'cardDiscard'
}

/**
 * 根据最后一回合赢家的总墩数生成传统“几接几”喊法。
 * 满 8 墩采用独立满墩结算，不套用 1 接 5 到 7 接 11 的口诀。
 */
function getSettlementVoiceCallName(round: RoundState): VoiceCallName | null {
  const settlement = round.settlement

  if (!settlement || settlement.isSweep) {
    return null
  }

  const collectorResult = settlement.seats.find((seat) => seat.seat === settlement.collector)
  const pierCount = collectorResult?.wonPierCount ?? 0

  if (pierCount < 1 || pierCount > 7) {
    return null
  }

  return `catch${pierCount}` as VoiceCallName
}

/**
 * 统一管理应用声音解锁、设置同步和牌局状态音效。
 * 规则层完全不知道声音存在，音频异常也不会影响牌局推进。
 *
 * @param round 当前局面；首页阶段为空。
 * @param isOpeningCeremonyActive 是否正在播放洗牌抓牌仪式。
 * @param audioPreferences 当前设备的声音偏好。
 */
export function useGameAudio(
  round: RoundState | null,
  isOpeningCeremonyActive: boolean,
  audioPreferences: AudioPreferences,
): void {
  const previousSnapshotRef = useRef<RoundAudioSnapshot | null>(null)

  /** 首次用户手势解锁移动端音频，并提前加载本地素材。 */
  useEffect(() => {
    preloadGameAudio()

    function handleFirstInteraction(): void {
      unlockGameAudio()
    }

    window.addEventListener('pointerdown', handleFirstInteraction, { passive: true })
    window.addEventListener('keydown', handleFirstInteraction)

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction)
      window.removeEventListener('keydown', handleFirstInteraction)
    }
  }, [])

  /** 设置变化后立即同步两个声音通道，不要求重启牌局。 */
  useEffect(() => {
    setGameAudioPreferences(audioPreferences)
  }, [audioPreferences])

  /** 根据局面差异播放落牌、喊声、骰子、赢墩和结算声音。 */
  useEffect(() => {
    const currentSnapshot = createRoundAudioSnapshot(round)
    const previousSnapshot = previousSnapshotRef.current

    previousSnapshotRef.current = currentSnapshot

    if (isOpeningCeremonyActive || !round) {
      return
    }

    if (!previousSnapshot || previousSnapshot.roundNumber !== currentSnapshot.roundNumber) {
      playGameSound('cardShuffle')
      return
    }

    if (
      currentSnapshot.pendingDiceKey &&
      previousSnapshot.pendingDiceKey !== currentSnapshot.pendingDiceKey
    ) {
      playGameSound('diceRoll')
    }

    if (currentSnapshot.totalPlayCount > previousSnapshot.totalPlayCount) {
      const latestPlay = getLatestPlayedAction(round)
      const voiceCallName = getLatestVoiceCallName(round)

      playGameSound(getPlaySoundName(round))

      if (latestPlay && voiceCallName) {
        playSeatVoice(latestPlay.seat, voiceCallName, 70)
      }
    }

    if (currentSnapshot.completedTrickCount > previousSnapshot.completedTrickCount) {
      playGameSound('trickWin')
    }

    if (
      currentSnapshot.phase === 'settled' &&
      currentSnapshot.settlementKey &&
      previousSnapshot.settlementKey !== currentSnapshot.settlementKey
    ) {
      playGameSound('settlement')

      const settlementCallName = getSettlementVoiceCallName(round)

      if (settlementCallName && round.settlement) {
        playSeatVoice(round.settlement.collector, settlementCallName, 320)
      }
    }
  }, [isOpeningCeremonyActive, round])
}
