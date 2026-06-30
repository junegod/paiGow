export type GameSoundName =
  | 'cardSelect'
  | 'cardPlay'
  | 'cardDiscard'
  | 'cardShuffle'
  | 'diceRoll'
  | 'trickWin'
  | 'settlement'

type GameSoundConfig = {
  /** 浏览器 public 目录下的音频地址，后期换素材时保持文件名即可。 */
  src: string
  /** 不同声音天然响度差异较大，这里统一做轻量归一化。 */
  volume: number
}

const GAME_SOUND_CONFIGS: Record<GameSoundName, GameSoundConfig> = {
  cardSelect: { src: '/sounds/card-select.ogg', volume: 0.36 },
  cardPlay: { src: '/sounds/card-play.ogg', volume: 0.58 },
  cardDiscard: { src: '/sounds/card-discard.ogg', volume: 0.5 },
  cardShuffle: { src: '/sounds/card-shuffle.ogg', volume: 0.44 },
  diceRoll: { src: '/sounds/dice-roll.ogg', volume: 0.62 },
  trickWin: { src: '/sounds/trick-win.ogg', volume: 0.56 },
  settlement: { src: '/sounds/settlement.ogg', volume: 0.62 },
}

const audioElements = new Map<GameSoundName, HTMLAudioElement>()

let isAudioUnlocked = false

/**
 * 判断当前是否处于浏览器环境，避免测试和服务端构建读取 window 报错。
 */
function canUseBrowserAudio(): boolean {
  return typeof window !== 'undefined' && typeof Audio !== 'undefined'
}

/**
 * 预加载全部游戏音效。浏览器仍然会遵守自动播放策略，
 * 所以这里只准备资源，不主动发声。
 */
export function preloadGameAudio(): void {
  if (!canUseBrowserAudio()) {
    return
  }

  Object.entries(GAME_SOUND_CONFIGS).forEach(([soundName, config]) => {
    const typedSoundName = soundName as GameSoundName

    if (audioElements.has(typedSoundName)) {
      return
    }

    const audio = new Audio(config.src)
    audio.preload = 'auto'
    audio.volume = config.volume
    audioElements.set(typedSoundName, audio)
  })
}

/**
 * 在用户首次触摸或点击后解锁音频。移动端浏览器通常要求有用户手势，
 * 所以所有自动音效都会等到这里执行后才真正播放。
 */
export function unlockGameAudio(): void {
  if (!canUseBrowserAudio()) {
    return
  }

  isAudioUnlocked = true
  preloadGameAudio()
}

/**
 * 播放指定游戏音效。为了支持连续出牌和机器人快速操作，
 * 每次播放都克隆一个音频节点，避免同一个 Audio 被 currentTime 互相打断。
 */
export function playGameSound(soundName: GameSoundName): void {
  if (!canUseBrowserAudio() || !isAudioUnlocked) {
    return
  }

  preloadGameAudio()

  const config = GAME_SOUND_CONFIGS[soundName]
  const cachedAudio = audioElements.get(soundName)
  const clonedAudio = cachedAudio?.cloneNode(true)
  const audio = clonedAudio instanceof HTMLAudioElement
    ? clonedAudio
    : new Audio(config.src)

  audio.volume = config.volume
  audio.currentTime = 0

  void audio.play().catch(() => {
    /**
     * 浏览器可能因为标签页静音、系统策略或尚未完成解锁而拒绝播放。
     * 音效是增强体验，不应该阻塞牌局操作。
     */
  })
}
