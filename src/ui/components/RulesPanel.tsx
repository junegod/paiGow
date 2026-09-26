import { useMemo } from 'react'

import type {
  CardInstance,
} from '@/rules-core/types'
import {
  CARD_DEFINITION_MAP,
  createDeck,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { PaiCard } from '@/ui/components/PaiCard'

/** 共享规则页，首页与牌桌使用各自的返回入口。 */
interface RulesPanelProps {
  /** 返回按钮文案；局内使用“返回牌桌”。 */
  backLabel?: string
  /** 返回调用页面，保留首页已选牌或当前牌桌状态。 */
  onBack: () => void
}

interface RuleCardsProps {
  /** 按定义 ID 读取真实牌实例；重复 ID 会自动取同名牌的下一张副本。 */
  definitionIds: string[]
  /** 需要盖背面的牌序号，主要用于死赏和弃牌示例。 */
  hiddenIndexes?: number[]
  /** 背面牌的辅助说明，避免玩家误会死赏盖牌等同于弃牌。 */
  hiddenLabel?: string
}

interface RuleExampleProps extends RuleCardsProps {
  /** 示例标题，必须尽量使用本地口语牌名。 */
  title: string
  /** 示例解释，说明这个牌型在规则里的作用。 */
  desc: string
}

interface ScoreRow {
  /** 玩家赢到的墩数。 */
  pierCount: string
  /** 相对 4 墩保本的基础进出。 */
  result: string
}

interface SettlementFormulaRow {
  /** 最后一墩赢家自己的墩数。 */
  pierCount: string
  /** 传统口语里的接法口诀。 */
  formula: string
}

const SCORE_ROWS: ScoreRow[] = [
  { pierCount: '0 墩', result: '出 4 个' },
  { pierCount: '1 墩', result: '出 3 个' },
  { pierCount: '2 墩', result: '出 2 个' },
  { pierCount: '3 墩', result: '出 1 个' },
  { pierCount: '4 墩', result: '保本' },
  { pierCount: '5 墩', result: '进 1 个' },
  { pierCount: '6 墩', result: '进 2 个' },
  { pierCount: '7 墩', result: '进 3 个' },
]

/**
 * 最后一墩赢家的接法口诀。这里按本地口语直接展示“几接几”，帮助玩家快速核对结算。
 */
const SETTLEMENT_FORMULA_ROWS: SettlementFormulaRow[] = [
  { pierCount: '1 墩', formula: '1 接 5' },
  { pierCount: '2 墩', formula: '2 接 6' },
  { pierCount: '3 墩', formula: '3 接 7' },
  { pierCount: '4 墩', formula: '4 接 8' },
  { pierCount: '5 墩', formula: '5 接 9' },
  { pierCount: '6 墩', formula: '6 接 10' },
  { pierCount: '7 墩', formula: '7 接 11' },
]

/**
 * 按定义 ID 从 32 张真实牌实例里取牌。规则页展示的是当前项目真实自绘牌，
 * 不是文字占位或额外图片，因此能和游戏桌面上的牌面保持一致。
 */
function pickRuleCards(deck: CardInstance[], definitionIds: string[]): CardInstance[] {
  const usedCountByDefinition = new Map<string, number>()

  return definitionIds.map((definitionId) => {
    const usedCount = usedCountByDefinition.get(definitionId) ?? 0
    const card = deck.filter((item) => item.definitionId === definitionId)[usedCount]

    if (!card) {
      throw new Error(`规则示例缺少牌：${definitionId}`)
    }

    usedCountByDefinition.set(definitionId, usedCount + 1)
    return card
  })
}

/**
 * 渲染一组真实牌面。组件内部按示例独立取牌，重复展示同一张牌名时不会互相影响。
 */
function RuleCards({
  definitionIds,
  hiddenIndexes = [],
  hiddenLabel,
}: RuleCardsProps) {
  const deck = useMemo(() => sortCardInstances(createDeck()), [])
  const cards = pickRuleCards(deck, definitionIds)
  const hiddenIndexSet = new Set(hiddenIndexes)

  return (
    <div className="rules-card-row">
      {cards.map((card, index) => (
        <PaiCard
          key={`${card.id}-${index}`}
          card={card}
          definition={CARD_DEFINITION_MAP[card.definitionId]}
          mini
          hidden={hiddenIndexSet.has(index)}
          hiddenLabel={hiddenLabel}
        />
      ))}
    </div>
  )
}

/**
 * 带标题和说明的真牌示例块，用于把“能出什么、怎么吃、怎么算赏”讲清楚。
 */
function RuleExample({
  title,
  desc,
  definitionIds,
  hiddenIndexes,
  hiddenLabel,
}: RuleExampleProps) {
  return (
    <article className="rules-example">
      <RuleCards
        definitionIds={definitionIds}
        hiddenIndexes={hiddenIndexes}
        hiddenLabel={hiddenLabel}
      />
      <div>
        <strong>{title}</strong>
        <p>{desc}</p>
      </div>
    </article>
  )
}

/**
 * 门类展示条：一边显示同门真实牌，一边说明门内大小顺序。
 */
function DoorLine({
  title,
  desc,
  definitionIds,
}: {
  /** 门类标题，例如长门、幺门、点子门。 */
  title: string
  /** 门内排序和比较说明。 */
  desc: string
  /** 该门类从大到小的真实牌实例。 */
  definitionIds: string[]
}) {
  return (
    <article className="rules-door-line">
      <div>
        <strong>{title}</strong>
        <p>{desc}</p>
      </div>
      <RuleCards definitionIds={definitionIds} />
    </article>
  )
}

/**
 * 打索子规则页。规则按玩家实际思考顺序组织：先认识牌，再看能出什么，
 * 然后理解吃牌、骰子、赏和结算。
 * @param props 返回入口与调用页面对应的按钮文案。
 * @returns 可滚动的规则说明与真实牌面示例。
 */
export function RulesPanel({ onBack, backLabel = '返回首页' }: RulesPanelProps) {
  return (
    <div className="rules-panel">
      <header className="rules-panel__head">
        <div>
          <p>江西吉安新居村非物质文化遗产</p>
          <h2>打索子规则</h2>
        </div>
        <button type="button" onClick={onBack}>{backLabel}</button>
      </header>

      <div className="rules-panel__content">
        <section className="rules-section rules-section--intro">
          <h3>先记住一句话</h3>
          <p>
            打索子就是四个人各拿 8 张牌，按回合出牌、吃牌、抢墩。一张牌算 1 墩，
            两张牌算 2 墩，三张牌算 3 墩，四张牌算 4 墩。每回合赢的人收下这一墩，
            并获得下一回合领出权。
          </p>
          <div className="rules-pill-grid">
            <span>4 人</span>
            <span>32 张牌</span>
            <span>每人 8 张</span>
            <span>4 墩保本</span>
          </div>
        </section>

        <section className="rules-section">
          <h3>1. 三大门和大小</h3>
          <p>
            吃牌时先看门类：长门只能吃长门，幺门只能吃幺门，点子只能吃点子。
            不同门之间平时不能直接比大小。
          </p>
          <DoorLine
            title="长门：天 ＞ 地 ＞ 人 ＞ 和 ＞ 梅 ＞ 长 ＞ 板"
            desc="每种 2 张。长门还能组成天九、地八、人七、和五这些组合。"
            definitionIds={[
              'long_tian',
              'long_di',
              'long_ren',
              'long_he',
              'long_mei',
              'long_chang',
              'long_ban',
            ]}
          />
          <DoorLine
            title="幺门：斧头 ＞ 四六 ＞ 幺六 ＞ 幺五"
            desc="每种 2 张。斧头是幺门脑子，单张最大。"
            definitionIds={[
              'yao_fu',
              'yao_si_liu',
              'yao_yao_liu',
              'yao_yao_wu',
            ]}
          />
          <DoorLine
            title="点子门：九 ＞ 八 ＞ 七 ＞ 六 ＞ 五 ＞ 三"
            desc="九、八、七、五各 2 张，六和三各 1 张；三加六就是一对赏。"
            definitionIds={[
              'point_nine',
              'point_eight',
              'point_seven',
              'point_six',
              'point_five',
              'point_three',
            ]}
          />
        </section>

        <section className="rules-section">
          <h3>2. 轮到自己领出，能主动打什么</h3>
          <p>
            普通领出不能乱出牌，必须是下面这些合法牌型。第一回合第一个领出的人，
            在这些牌型之外，还可以任意明出一张单牌。
          </p>
          <div className="rules-example-grid">
            <RuleExample
              title="任意脑子"
              desc="天、斧头、九分别是三门最大的单牌，轮到自己领出时可以单独明打。"
              definitionIds={['long_tian', 'yao_fu', 'point_nine']}
            />
            <RuleExample
              title="任意对子"
              desc="同名两张都可以作为对子明打，例如地地、斧头斧头、九九、七七、五五。"
              definitionIds={['long_di', 'long_di']}
            />
            <RuleExample
              title="一对赏"
              desc="三加六叫一对赏，一次出 2 张，可以选择活赏或死赏。"
              definitionIds={['point_three', 'point_six']}
            />
            <RuleExample
              title="长门两张组合"
              desc="天九最大，其次地八、人七、和五；这些都是 2 墩。"
              definitionIds={['long_tian', 'point_nine']}
            />
            <RuleExample
              title="长门三张组合"
              desc="天天九、天九九最大；地地八和地八八同级，人人七和七七人同级。"
              definitionIds={['long_di', 'long_di', 'point_eight']}
            />
            <RuleExample
              title="长门四张组合"
              desc="天天九九最大，其次地地八八、人人七七、和和五五；几张牌就是几墩。"
              definitionIds={['long_ren', 'long_ren', 'point_seven', 'point_seven']}
            />
          </div>
        </section>

        <section className="rules-section">
          <h3>3. 已经没有更大明牌时，可以提速一起出</h3>
          <p>
            如果某张单牌所属门类里，所有比它大的牌都已经牌面朝上出现过，
            这张牌就可以直接明打，不用再掷骰。多张牌都满足这个条件时，可以合在一起出。
          </p>
          <div className="rules-example-grid">
            <RuleExample
              title="脑子可以一起出"
              desc="九点和斧头都是各自门里的最大单张，没人能压，可以合并领出。"
              definitionIds={['point_nine', 'yao_fu']}
            />
            <RuleExample
              title="看见九后，八可以放开"
              desc="如果两张九点都已经明面出现，八点就没有更大的点子能压，可以直接出。"
              definitionIds={['point_nine', 'point_nine', 'point_eight']}
            />
          </div>
        </section>

        <section className="rules-section">
          <h3>4. 吃牌和弃牌</h3>
          <p>
            后手要吃别人，必须张数相同、比较组相同、牌力更大，而且吃牌一定是明牌。
            不吃就叫弃牌：只要张数一样即可，牌必须背面朝上，别人整局结束前不能看。
          </p>
          <div className="rules-example-grid">
            <RuleExample
              title="同张数同组合才能吃"
              desc="别人出人七，你可以用地八吃；后面如果有人出天九，还能继续吃。"
              definitionIds={['long_ren', 'point_seven', 'long_di', 'point_eight', 'long_tian', 'point_nine']}
            />
            <RuleExample
              title="对子按门内大小吃"
              desc="别人出七七，八八或九九能吃；别人出八八，只有九九能吃。"
              definitionIds={['point_seven', 'point_seven', 'point_eight', 'point_eight']}
            />
            <RuleExample
              title="弃牌只看张数"
              desc="别人出了 2 张，你不吃就背面弃任意 2 张；不要求同门，也不要求同牌型。"
              definitionIds={['long_mei', 'yao_yao_wu']}
              hiddenIndexes={[0, 1]}
              hiddenLabel="弃牌背面朝上，整局结束后统一翻开"
            />
          </div>
        </section>

        <section className="rules-section">
          <h3>5. 掷骰子和卖屁股</h3>
          <p>
            轮到自己领出时，如果不想打当前可明打的牌，可以掷两颗骰子。骰子定到哪一门，
            有那一门就必须明出 1 张；没有那一门，才能背面弃 1 张，这才叫卖屁股。
          </p>
          <div className="rules-note-list">
            <p>长门骰：11、13、22、33、44、55、66。</p>
            <p>幺门骰：15、16、46、56。</p>
            <p>点子门骰：12、14、23、24、25、26、34、35、36、45。</p>
          </div>
          <div className="rules-example-grid">
            <RuleExample
              title="掷到点子门，有点子必须出"
              desc="例如手里有八点或五点，就必须选一张点子明出，不能直接弃牌。"
              definitionIds={['point_eight', 'point_five']}
            />
            <RuleExample
              title="没有该门才卖屁股"
              desc="掷到点子门但手里没有点子，才可以背面弃 1 张；后手仍可用点子明吃。"
              definitionIds={['yao_si_liu']}
              hiddenIndexes={[0]}
              hiddenLabel="卖屁股：没有骰子定门时的背面弃牌"
            />
          </div>
          <p className="rules-footnote">
            最后一张牌不用掷骰子；如果最后剩牌刚好是一对、合法三张、合法四张或一对赏，
            也不用掷骰，直接按合法牌型出完。
          </p>
        </section>

        <section className="rules-section">
          <h3>6. 活赏、死赏和赏钱</h3>
          <p>
            三加六是一对赏。活赏两张都朝上，可以被九九、七七、五五吃，而且有就必须吃；
            八八不能吃赏。最后两墩牌出的一对赏叫孵赏。死赏通常盖住三或六中的一张，
            表示不能被吃，但死赏没有赏钱。
          </p>
          <div className="rules-example-grid">
            <RuleExample
              title="活赏"
              desc="三和六都明出。若别人用九九、七七或五五吃掉，赏钱失效，吃牌的人赢这 2 墩。"
              definitionIds={['point_three', 'point_six']}
            />
            <RuleExample
              title="死赏"
              desc="传统摆法会把其中一张背面朝上，一眼看出是死赏；死赏不能被吃，但也没有赏钱。"
              definitionIds={['point_three', 'point_six']}
              hiddenIndexes={[0]}
              hiddenLabel="死赏盖牌标记：不是普通弃牌"
            />
            <RuleExample
              title="能吃活赏的对子"
              desc="九九、七七、五五能吃活赏；八八不能吃活赏。"
              definitionIds={['point_nine', 'point_nine', 'point_seven', 'point_seven']}
            />
          </div>
          <div className="rules-note-list">
            <p>中途打一对赏且没被吃：未满 3 墩的玩家每人额外出 2 个，3 墩及以上免出赏钱。</p>
            <p>最后两墩牌出的赏叫孵赏：未满 3 墩的玩家每人额外出 4 个孵赏钱。</p>
            <p>打满 8 墩带赏：满 8 墩基础钱和赏钱一起算。</p>
          </div>
        </section>

        <section className="rules-section">
          <h3>7. 明牌、弃牌和复盘</h3>
          <p>
            明打和吃牌都是公开信息，牌面朝上，任何时候都可以点玩家墩数查看。
            弃牌和卖屁股都必须背面朝上，不能在每墩结束后偷看，必须等整局结束统一翻开复盘。
          </p>
          <div className="rules-example-grid">
            <RuleExample
              title="明牌可随时查看"
              desc="例如人七、地八、天九这些吃牌过程，进了赢墩堆以后仍然能查看牌面。"
              definitionIds={['long_ren', 'point_seven', 'long_di', 'point_eight']}
            />
            <RuleExample
              title="弃牌整局结束才翻"
              desc="弃牌不会在当前墩结算后翻开，必须等整局结束统一复盘。"
              definitionIds={['long_ban', 'point_five']}
              hiddenIndexes={[0, 1]}
              hiddenLabel="弃牌背面朝上，整局结束后统一翻开"
            />
          </div>
        </section>

        <section className="rules-section">
          <h3>8. 结算怎么想</h3>
          <p>
            4 墩是保本线。少于 4 墩要出，多于 4 墩要进；非最后一墩赢家先按自己墩数独立进出，
            最后一墩赢家承接其他三家的基础净额。赏钱另算，并和基础进出合并抵扣；
            但已经打到 3 墩及以上的人不用再出赏钱。
          </p>
          <div className="rules-score-grid">
            {SCORE_ROWS.map((row) => (
              <span key={row.pierCount}>
                <strong>{row.pierCount}</strong>
                <em>{row.result}</em>
              </span>
            ))}
          </div>
          <div className="rules-catch-formula" aria-label="最后一墩赢家接法口诀">
            <strong>接法口诀</strong>
            <div>
              {SETTLEMENT_FORMULA_ROWS.map((row) => (
                <span key={row.formula}>
                  <em>{row.pierCount}</em>
                  {row.formula}
                </span>
              ))}
            </div>
          </div>
          <div className="rules-note-list">
            <p>例：你赢 5 墩但最后一墩不是你赢，没有赏时你基础进 1 个。</p>
            <p>例：你赢 7 墩，基础就是进 3 个。</p>
            <p>例：最后赢家赢 6 墩，按“6 接 10”，其他三家基础出分合计 10 个给最后赢家。</p>
            <p>例：打满 8 墩不带赏，其他三家每人出 8 个。</p>
            <p>例：普通局里 A 打活赏没被吃，B 已赢 3 墩，B 不出赏钱；0、1、2 墩的人才出。</p>
            <p>例：满 8 墩中间带赏，其他三家每人出 10 个，拆成基础 8 个加赏钱 2 个。</p>
            <p>例：满 8 墩最后两墩是孵赏，其他三家每人出 16 个。</p>
          </div>
        </section>

        <section className="rules-section rules-section--summary">
          <h3>最后的口诀</h3>
          <p>
            同门同张数才能吃，吃牌必须明；不吃只看张数，背面弃；骰子定门后有门必须出，
            无门才卖屁股；没有更大明牌能压的单张可以提速一起出；活赏能被九九、七七、五五吃，
            死赏不能吃但没有赏钱；最后两墩的赏叫孵赏；3 墩及以上免出赏钱；
            4 墩保本，最后一墩赢家承接基础净额，背面牌整局结束才翻。
          </p>
        </section>
      </div>
    </div>
  )
}
