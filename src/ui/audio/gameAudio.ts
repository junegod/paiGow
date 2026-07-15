import type { AudioPreferences } from '@/local-data/types'
import type { SeatId } from '@/rules-core/types'

export type GameSoundName =
  | 'cardSelect'
  | 'cardPlay'
  | 'cardDiscard'
  | 'cardShuffle'
  | 'diceRoll'
  | 'trickWin'
  | 'settlement'

export type VoiceCallName =
  | 'play'
  | 'eat'
  | 'rewardLive'
  | 'rewardDead'
  | 'catch1'
  | 'catch2'
  | 'catch3'
  | 'catch4'
  | 'catch5'
  | 'catch6'
  | 'catch7'

type GameSoundConfig = {
  /** 浏览器 public 目录下的音频地址，后期替换素材时保持文件名即可。 */
  src: string
  /** 单个素材的基础音量，最终还会乘以玩家设置的总音量。 */
  volume: number
}

/** 默认声音设置同时供本地数据加载前的首屏和旧数据迁移使用。 */
export const DEFAULT_GAME_AUDIO_PREFERENCES: AudioPreferences = {
  soundEffectsEnabled: true,
  soundEffectsVolume: 0.86,
  voiceCallsEnabled: true,
  voiceCallsVolume: 0.92,
}

const GAME_SOUND_CONFIGS: Record<GameSoundName, GameSoundConfig> = {
  cardSelect: { src: '/sounds/card-select.ogg', volume: 0.58 },
  cardPlay: { src: '/sounds/card-play.ogg', volume: 0.92 },
  cardDiscard: { src: '/sounds/card-discard.ogg', volume: 0.68 },
  cardShuffle: { src: '/sounds/card-shuffle.ogg', volume: 0.7 },
  diceRoll: { src: '/sounds/dice-roll.ogg', volume: 0.88 },
  trickWin: { src: '/sounds/trick-win.ogg', volume: 0.84 },
  settlement: { src: '/sounds/settlement.ogg', volume: 0.9 },
}

const VOICE_CALL_FILE_NAMES: Record<VoiceCallName, string> = {
  play: 'play',
  eat: 'eat',
  rewardLive: 'reward-live',
  rewardDead: 'reward-dead',
  catch1: 'catch-1',
  catch2: 'catch-2',
  catch3: 'catch-3',
  catch4: 'catch-4',
  catch5: 'catch-5',
  catch6: 'catch-6',
  catch7: 'catch-7',
}

const audioElements = new Map<GameSoundName, HTMLAudioElement>()
const voiceElements = new Map<string, HTMLAudioElement>()
let currentPreferences = DEFAULT_GAME_AUDIO_PREFERENCES
let isAudioUnlocked = false
let audioContext: AudioContext | null = null

/**
 * 判断当前是否处于浏览器环境，避免单元测试和服务端构建读取音频对象时报错。
 */
function canUseBrowserAudio(): boolean {
  return typeof window !== 'undefined' && typeof Audio !== 'undefined'
}

/**
 * 限制运行时音量，避免设置迁移异常或浮点误差传给播放器后抛出异常。
 *
 * @param volume 待校验的音量。
 * @returns 0 到 1 之间的安全音量。
 */
function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}

/**
 * 获取指定座位和动作的本地喊声地址。四个座位使用不同声线，
 * 文件直接打包进应用，离线状态也能稳定播放。
 *
 * @param seat 出牌座位。
 * @param callName 需要喊出的动作。
 * @returns public 目录下的音频地址。
 */
function getVoiceCallSource(seat: SeatId, callName: VoiceCallName): string {
  return `/sounds/voices/seat-${seat}-${VOICE_CALL_FILE_NAMES[callName]}.m4a`
}

/**
 * 预加载全部游戏音效和人物喊声。浏览器仍会遵守自动播放策略，
 * 所以这里只准备资源，不主动发声。
 */
export function preloadGameAudio(): void {
  if (!canUseBrowserAudio()) {
    return
  }

  Object.entries(GAME_SOUND_CONFIGS).forEach(([soundName, config]) => {
    const typedSoundName = soundName as GameSoundName

    if (!audioElements.has(typedSoundName)) {
      const audio = new Audio(config.src)
      audio.preload = 'auto'
      audioElements.set(typedSoundName, audio)
    }
  })

  for (let seat = 0; seat < 4; seat += 1) {
    Object.keys(VOICE_CALL_FILE_NAMES).forEach((callName) => {
      const typedCallName = callName as VoiceCallName
      const cacheKey = `${seat}:${typedCallName}`

      if (!voiceElements.has(cacheKey)) {
        const audio = new Audio(getVoiceCallSource(seat as SeatId, typedCallName))
        audio.preload = 'auto'
        voiceElements.set(cacheKey, audio)
      }
    })
  }
}

/**
 * 同步最新声音设置。该函数只更新内存配置，不触发播放，
 * 因此可以安全地在 React 设置变化时调用。
 *
 * @param preferences 本地保存的完整声音偏好。
 */
export function setGameAudioPreferences(preferences: AudioPreferences): void {
  currentPreferences = {
    ...preferences,
    soundEffectsVolume: clampVolume(preferences.soundEffectsVolume),
    voiceCallsVolume: clampVolume(preferences.voiceCallsVolume),
  }
}

/**
 * 在用户首次触摸或点击后解锁音频，并恢复 Web Audio 上下文。
 * Android WebView 和移动浏览器都要求这一步发生在用户手势之后。
 */
export function unlockGameAudio(): void {
  if (!canUseBrowserAudio()) {
    return
  }

  isAudioUnlocked = true
  preloadGameAudio()

  const AudioContextConstructor = window.AudioContext

  if (AudioContextConstructor) {
    audioContext ??= new AudioContextConstructor()
    void audioContext.resume().catch(() => undefined)
  }
}

/**
 * 给关键落牌动作补一层极短的低频冲击，弥补手机扬声器播放原素材时偏软的问题。
 * 该层只负责瞬态，不替代真实牌声，也不会在关闭音效时继续播放。
 *
 * @param soundName 当前播放的音效类型。
 */
function playTransientAccent(soundName: GameSoundName): void {
  if (!audioContext || !['cardSelect', 'cardPlay', 'cardDiscard', 'trickWin'].includes(soundName)) {
    return
  }

  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  const isHeavyImpact = soundName === 'cardPlay' || soundName === 'trickWin'

  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(isHeavyImpact ? 185 : 420, now)
  oscillator.frequency.exponentialRampToValueAtTime(isHeavyImpact ? 72 : 180, now + 0.07)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(
    clampVolume(currentPreferences.soundEffectsVolume * (isHeavyImpact ? 0.32 : 0.14)),
    now + 0.004,
  )
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (isHeavyImpact ? 0.1 : 0.055))
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.11)
}

/**
 * 播放指定游戏音效。每次克隆音频节点，允许机器人连续出牌时的声音自然叠加，
 * 同时通过总音量和瞬态增强让落牌声更干脆。
 *
 * @param soundName 需要播放的游戏音效。
 */
export function playGameSound(soundName: GameSoundName): void {
  if (!canUseBrowserAudio() || !isAudioUnlocked || !currentPreferences.soundEffectsEnabled) {
    return
  }

  preloadGameAudio()
  const config = GAME_SOUND_CONFIGS[soundName]
  const cachedAudio = audioElements.get(soundName)
  const clonedAudio = cachedAudio?.cloneNode(true)
  const audio = clonedAudio instanceof HTMLAudioElement ? clonedAudio : new Audio(config.src)

  audio.volume = clampVolume(config.volume * currentPreferences.soundEffectsVolume)
  audio.currentTime = 0
  playTransientAccent(soundName)

  void audio.play().catch(() => {
    /** 音效是增强体验，标签页静音或系统拒绝播放时不能阻塞牌局。 */
  })
}

/**
 * 播放指定座位的人物喊声。弃牌不会调用该函数，避免每回合声音过密；
 * 同一座位的不同动作共享声线，让玩家能仅凭声音分辨是谁出的牌。
 *
 * @param seat 当前出牌座位。
 * @param callName 出牌、吃、赏或结算接法。
 * @param delayMs 延迟播放毫秒数，用于让喊声避开落牌或结算音效的瞬态。
 */
export function playSeatVoice(seat: SeatId, callName: VoiceCallName, delayMs = 0): void {
  if (!canUseBrowserAudio() || !isAudioUnlocked || !currentPreferences.voiceCallsEnabled) {
    return
  }

  preloadGameAudio()
  const cacheKey = `${seat}:${callName}`
  const source = getVoiceCallSource(seat, callName)
  const cachedAudio = voiceElements.get(cacheKey)
  const clonedAudio = cachedAudio?.cloneNode(true)
  const audio = clonedAudio instanceof HTMLAudioElement ? clonedAudio : new Audio(source)

  window.setTimeout(() => {
    audio.volume = clampVolume(currentPreferences.voiceCallsVolume)
    audio.currentTime = 0

    void audio.play().catch(() => {
      /** 人物喊声加载失败时保留落牌音效，不能影响规则状态推进。 */
    })
  }, Math.max(0, delayMs))
}
