import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  DEFAULT_GAME_AUDIO_PREFERENCES,
  playGameSound,
  setGameAudioPreferences,
  unlockGameAudio,
} from '@/ui/audio/gameAudio'

describe('游戏音效即时设置', () => {
  afterEach(() => {
    setGameAudioPreferences(DEFAULT_GAME_AUDIO_PREFERENCES)
    vi.restoreAllMocks()
  })

  it('运行时关闭和重新开启音效不需要刷新页面', () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)

    unlockGameAudio()
    setGameAudioPreferences({
      ...DEFAULT_GAME_AUDIO_PREFERENCES,
      soundEffectsEnabled: false,
    })
    playGameSound('cardPlay')

    expect(playSpy).not.toHaveBeenCalled()

    setGameAudioPreferences({
      ...DEFAULT_GAME_AUDIO_PREFERENCES,
      soundEffectsEnabled: true,
    })
    playGameSound('cardPlay')

    expect(playSpy).toHaveBeenCalledTimes(1)
  })
})
