import {
  useEffect,
  useState,
} from 'react'

import type { AudioPreferences } from '@/local-data/types'
import {
  playGameSound,
  playSeatVoice,
  setGameAudioPreferences,
} from '@/ui/audio/gameAudio'

export interface SettingsPanelProps {
  /** 当前设备已经保存的声音设置。 */
  audioPreferences: AudioPreferences
  /** 设置保存期间用于禁止重复操作。 */
  disabled?: boolean
  /** 是否跳过每局开场的洗牌、定庄和抓牌演出。 */
  skipOpeningCeremony: boolean
  /** 关闭设置弹窗。 */
  onClose: () => void
  /** 保存一项或多项声音设置。 */
  onAudioPreferencesChange: (patch: Partial<AudioPreferences>) => void | Promise<void>
  /** 保存开局动画偏好。 */
  onSkipOpeningCeremonyChange: (skip: boolean) => void | Promise<void>
}

/**
 * 将 0 到 1 的内部音量转换为滑杆使用的整数百分比。
 *
 * @param volume 内部音量。
 * @returns 0 到 100 的整数。
 */
function toPercentage(volume: number): number {
  return Math.round(volume * 100)
}

/**
 * 应用设置弹窗。当前只放与实际游戏体验直接相关的音效和喊声，
 * 后续若增加震动、动画速度等设备级选项，可继续沿用同一设置面板。
 */
export function SettingsPanel({
  audioPreferences,
  disabled = false,
  skipOpeningCeremony,
  onClose,
  onAudioPreferencesChange,
  onSkipOpeningCeremonyChange,
}: SettingsPanelProps) {
  const [effectEnabled, setEffectEnabled] = useState(audioPreferences.soundEffectsEnabled)
  const [voiceEnabled, setVoiceEnabled] = useState(audioPreferences.voiceCallsEnabled)
  const [effectVolume, setEffectVolume] = useState(toPercentage(audioPreferences.soundEffectsVolume))
  const [voiceVolume, setVoiceVolume] = useState(toPercentage(audioPreferences.voiceCallsVolume))

  /** 外部设置加载或保存完成后，同步滑杆显示值。 */
  useEffect(() => {
    setEffectEnabled(audioPreferences.soundEffectsEnabled)
    setVoiceEnabled(audioPreferences.voiceCallsEnabled)
    setEffectVolume(toPercentage(audioPreferences.soundEffectsVolume))
    setVoiceVolume(toPercentage(audioPreferences.voiceCallsVolume))
  }, [audioPreferences])

  /**
   * 保存滑杆当前值。拖动过程只更新视觉状态，松手或键盘改值后再写 IndexedDB，
   * 避免一次拖动产生大量本地事务。
   */
  function saveVolume(channel: 'effect' | 'voice', percentage: number): void {
    if (channel === 'effect') {
      void onAudioPreferencesChange({ soundEffectsVolume: percentage / 100 })
      return
    }

    void onAudioPreferencesChange({ voiceCallsVolume: percentage / 100 })
  }

  /**
   * 在 IndexedDB 异步保存完成前先更新内存播放器，保证开关和音量滑杆立即生效。
   *
   * @param patch 当前交互产生的声音设置变化。
   */
  function applyLiveAudioPatch(patch: Partial<AudioPreferences>): void {
    setGameAudioPreferences({
      soundEffectsEnabled: patch.soundEffectsEnabled ?? effectEnabled,
      soundEffectsVolume: patch.soundEffectsVolume ?? effectVolume / 100,
      voiceCallsEnabled: patch.voiceCallsEnabled ?? voiceEnabled,
      voiceCallsVolume: patch.voiceCallsVolume ?? voiceVolume / 100,
    })
  }

  return (
    <div
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-panel-title"
    >
      <button
        type="button"
        className="settings-panel__backdrop"
        aria-label="关闭设置"
        onClick={onClose}
      />
      <section className="settings-panel__card">
        <header className="settings-panel__head">
          <div>
            <p>本机设置</p>
            <h2 id="settings-panel-title">设置</h2>
          </div>
          <button
            type="button"
            className="settings-panel__close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-panel__group">
          <div className="settings-panel__row">
            <div>
              <strong>游戏音效</strong>
              <span>选牌、落牌、洗牌、骰子和结算</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={effectEnabled}
              className="settings-switch"
              disabled={disabled}
              onClick={() => {
                const nextEnabled = !effectEnabled
                const patch = { soundEffectsEnabled: nextEnabled }

                setEffectEnabled(nextEnabled)
                applyLiveAudioPatch(patch)
                void onAudioPreferencesChange(patch)
              }}
            >
              <span />
            </button>
          </div>
          <label className="settings-volume">
            <span>音效音量</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={effectVolume}
              disabled={disabled || !effectEnabled}
              onChange={(event) => {
                const percentage = Number(event.target.value)
                setEffectVolume(percentage)
                applyLiveAudioPatch({ soundEffectsVolume: percentage / 100 })
              }}
              onPointerUp={(event) => saveVolume('effect', Number(event.currentTarget.value))}
              onKeyUp={(event) => saveVolume('effect', Number(event.currentTarget.value))}
            />
            <em>{effectVolume}%</em>
          </label>
          <button
            type="button"
            className="settings-panel__preview"
            disabled={!effectEnabled}
            onClick={() => playGameSound('cardPlay')}
          >
            试听落牌声
          </button>
        </div>

        <div className="settings-panel__group">
          <div className="settings-panel__row">
            <div>
              <strong>人物喊声</strong>
              <span>出牌、吃、活赏和死赏，弃牌不喊</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={voiceEnabled}
              className="settings-switch"
              disabled={disabled}
              onClick={() => {
                const nextEnabled = !voiceEnabled
                const patch = { voiceCallsEnabled: nextEnabled }

                setVoiceEnabled(nextEnabled)
                applyLiveAudioPatch(patch)
                void onAudioPreferencesChange(patch)
              }}
            >
              <span />
            </button>
          </div>
          <label className="settings-volume">
            <span>喊声音量</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={voiceVolume}
              disabled={disabled || !voiceEnabled}
              onChange={(event) => {
                const percentage = Number(event.target.value)
                setVoiceVolume(percentage)
                applyLiveAudioPatch({ voiceCallsVolume: percentage / 100 })
              }}
              onPointerUp={(event) => saveVolume('voice', Number(event.currentTarget.value))}
              onKeyUp={(event) => saveVolume('voice', Number(event.currentTarget.value))}
            />
            <em>{voiceVolume}%</em>
          </label>
          <button
            type="button"
            className="settings-panel__preview"
            disabled={!voiceEnabled}
            onClick={() => playSeatVoice(0, 'play')}
          >
            试听人物喊声
          </button>
        </div>

        <div className="settings-panel__group">
          <div className="settings-panel__row">
            <div>
              <strong>跳过抓牌动画</strong>
              <span>每局直接进入手牌，规则和发牌结果不变</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={skipOpeningCeremony}
              className="settings-switch"
              disabled={disabled}
              onClick={() => {
                void onSkipOpeningCeremonyChange(!skipOpeningCeremony)
              }}
            >
              <span />
            </button>
          </div>
        </div>

        <p className="settings-panel__note">四个座位使用不同声线，所有声音均保存在本机。</p>
      </section>
    </div>
  )
}
