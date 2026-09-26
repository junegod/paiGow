import type { RoundState, SeatConfig } from '@/rules-core/types'
import { calculateSettlement } from '@/rules-variants/ji-an-da-suo-zi/scoring'

/** 结算展示与离局操作；落账门禁由上层统一处理。 */
interface SettlementPanelProps {
  /** 本机积分正在保存，期间禁止离局和重复点击。 */
  saving?: boolean
  /** 保存失败提示；保留结算内容并提供重试入口。 */
  saveError?: string | null
  /** 重试同一局幂等落账。 */
  onRetrySave?: () => void
  /** 当前已完成或待展示结算的单局状态。 */
  round: RoundState
  /** 四个座位配置，用于把座位编号转换为玩家名称。 */
  seatConfigs: SeatConfig[]
  /** 打开整局回合记录，方便结算后复盘每次出牌。 */
  onInspectHistory: () => void
  /** 进入下一局，沿用当前座位配置；允许上层先异步落账。 */
  onNextRound: () => void | Promise<void>
  /** 是否允许当前玩家开始下一局；联机时只有房主可以操作。 */
  canStartNextRound?: boolean
  /** 返回首页并重置整场；允许上层先异步落账。 */
  onRestartMatch: () => void | Promise<void>
}

function getSeatName(seatConfigs: SeatConfig[], seat: number): string {
  return seatConfigs.find((seatConfig) => seatConfig.seat === seat)?.name ?? `座位 ${seat}`
}

/**
 * 将结算数字转换成“收/出/保本”文案，结算卡片用它拆开基础分和赏钱。
 */
function formatDeltaDetail(label: string, delta: number): string {
  if (delta === 0) {
    return `${label}保本`
  }

  return delta > 0
    ? `${label}收 ${delta} 个`
    : `${label}出 ${Math.abs(delta)} 个`
}

/**
 * 结算规则开发期会持续校正，浏览器热更新可能保留旧 mock 状态里的旧 settlement。
 * 展示前基于当前 round 重新计算一次，保证复盘弹窗永远使用最新结算口径。
 */
function getDisplaySettlement(round: RoundState) {
  if (!round.settlement || round.lastTrickWinner === undefined) {
    return round.settlement
  }

  return calculateSettlement(round)
}

/**
 * 弹窗标题只保留结算核心结论，避免手机小屏里把规则解释挤成多行。
 */
function getSettlementTitle(round: RoundState, settlement: NonNullable<RoundState['settlement']>): string {
  if (settlement.isSweep) {
    return '满 8 墩结算'
  }

  const rewardText =
    round.rewardOutcome &&
    round.rewardOutcome.mode === 'live' &&
    !round.rewardOutcome.wasEaten
      ? round.rewardOutcome.wasLastTwo
        ? '，另算孵赏钱'
        : '，另算赏钱'
      : '，无额外赏钱'

  return `基础按 4 墩保本${rewardText}`
}

/**
 * 结算区负责展示输赢明细，并提供下一局入口。
 * 保存失败时保留本局，允许查看回合记录或显式重试。
 * @param props 已结算牌局、保存状态与受保护的导航入口。
 * @returns 结算界面；尚未结算时返回空。
 */
export function SettlementPanel({
  round,
  saving = false,
  saveError = null,
  onRetrySave,
  seatConfigs,
  onInspectHistory,
  onNextRound,
  canStartNextRound = true,
  onRestartMatch,
}: SettlementPanelProps) {
  const settlement = getDisplaySettlement(round)

  if (!settlement) {
    return null
  }

  const rewardDeltaLabel =
    round.rewardOutcome &&
    round.rewardOutcome.mode === 'live' &&
    !round.rewardOutcome.wasEaten &&
    round.rewardOutcome.wasLastTwo
      ? '孵赏钱'
      : '赏钱'

  return (
    <section className="settlement-panel">
      <div className="settlement-panel__summary">
        <p className="settlement-panel__eyebrow">整局复盘已开启</p>
        <h2>{getSettlementTitle(round, settlement)}</h2>
        <p>
          承接方：{getSeatName(seatConfigs, settlement.collector)}｜
          最后一回合赢家：{round.lastTrickWinner !== undefined ? getSeatName(seatConfigs, round.lastTrickWinner) : '未知'}
        </p>
      </div>

      <div className="settlement-panel__grid">
        {settlement.seats.map((seatResult) => (
          <article key={seatResult.seat} className="settlement-seat">
            <p className="settlement-seat__name">
              {getSeatName(seatConfigs, seatResult.seat)}
            </p>
            <p className="settlement-seat__score">
              {seatResult.totalDelta > 0 ? '+' : ''}
              {seatResult.totalDelta}
            </p>
            <p className="settlement-seat__meta">赢墩 {seatResult.wonPierCount}</p>
            <p className="settlement-seat__meta">
              {formatDeltaDetail('基础', seatResult.baseDelta)}
            </p>
            {seatResult.rewardDelta !== 0 ? (
              <p className="settlement-seat__meta settlement-seat__meta--reward">
                {formatDeltaDetail(rewardDeltaLabel, seatResult.rewardDelta)}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      {saving ? <p role="status">正在保存本局积分，请稍候…</p> : null}
      {saveError ? (
        <div className="settlement-save-error" role="alert">
          <p>{saveError}</p>
          <button type="button" className="hero-button hero-button--ghost" disabled={saving} onClick={onRetrySave}>
            重试保存
          </button>
        </div>
      ) : null}
      <div className="settlement-panel__actions">
        <button type="button" className="hero-button hero-button--ghost" onClick={onInspectHistory}>
          回合记录
        </button>
        <button
          type="button"
          className="hero-button hero-button--ghost"
          disabled={saving || Boolean(saveError)}
          onClick={() => {
            void onRestartMatch()
          }}
        >
          返回首页
        </button>
        <button
          type="button"
          className="hero-button hero-button--primary"
          disabled={!canStartNextRound || saving || Boolean(saveError)}
          title={canStartNextRound ? undefined : '等待房主开始下一局'}
          onClick={() => {
            void onNextRound()
          }}
        >
          {canStartNextRound ? '下一局' : '等待房主'}
        </button>
      </div>
    </section>
  )
}
