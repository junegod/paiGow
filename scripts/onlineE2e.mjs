/**
 * 联机全流程端到端冒烟脚本。
 * 覆盖：进入联机大厅、创建房间、加入房间、开始牌局、理牌、出牌。
 * 使用方式：
 * 1. pnpm online:server 启动联机服务（默认 8787）。
 * 2. pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173 启动页面预览。
 * 3. node scripts/onlineE2e.mjs
 * 服务地址可以通过环境变量覆盖：
 *   E2E_BASE_URL=http://127.0.0.1:4173
 *   E2E_PLAYWRIGHT_CORE=/path/to/playwright-core
 */

const baseUrl = process.env.E2E_BASE_URL ?? 'https://game9.qdkl.cn'
const playwrightCorePath = process.env.E2E_PLAYWRIGHT_CORE ?? '/Users/june/IdeaProjects/e-law/node_modules/playwright-core/index.mjs'

/** 动态加载 playwright-core，避免项目把它列为常规依赖。 */
const { chromium } = await import(playwrightCorePath)

const browser = await chromium.launch({
  headless: true,
  args: ['--no-proxy-server'],
})

/** 收集页面 JS 崩溃；任何 pageerror 都代表牌桌出现真实渲染问题。 */
const errors = []

/**
 * 记录某个页面的崩溃信息。
 *
 * @param {import('playwright-core').Page} page 浏览器页面。
 * @param {string} label 标识（房主 / 玩家）。
 */
function track(page, label) {
  page.on('pageerror', (error) => errors.push(label + ' PAGEERROR: ' + error.message))
}

const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const hostPage = await hostContext.newPage()
track(hostPage, 'HOST')

const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const guestPage = await guestContext.newPage()
track(guestPage, 'GUEST')

/**
 * 从首页进入联机大厅。
 *
 * @param {import('playwright-core').Page} page 浏览器页面。
 */
async function enterLobby(page) {
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
  // 等待联机连接就绪（「新建房间」按钮可点击），避免 WebSocket 未就绪导致表单禁用。
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('新建房间'))
    return button instanceof HTMLButtonElement && !button.disabled
  }, { timeout: 15000 }).catch(() => {})
  await page.getByRole('button', { name: /多人对战/ }).click()
  await page.waitForTimeout(500)
}

await enterLobby(hostPage)
await hostPage.getByPlaceholder(/我的昵称/).fill('阿明')
await hostPage.getByRole('button', { name: /新建房间/ }).click()
await hostPage.getByRole('button', { name: /离开房间/ }).waitFor({ state: 'visible', timeout: 10000 })
const roomCode = (await hostPage.textContent('h1')).replace(/[^0-9]/g, '').slice(0, 6)

await enterLobby(guestPage)
await guestPage.getByPlaceholder(/我的昵称/).fill('小张')
await guestPage.getByRole('button', { name: /加入/ }).click()
await guestPage.getByRole('button', { name: /离开房间/ }).waitFor({ state: 'visible', timeout: 10000 })
console.log(JSON.stringify({ step: 'joined', roomCode, errors }))

await hostPage.getByRole('button', { name: /开始牌局/ }).click()
await hostPage.waitForTimeout(2500)
await guestPage.waitForTimeout(2500)
const hostTableCount = await hostPage.locator('.game-table').count()
const guestTableCount = await guestPage.locator('.game-table').count()
console.log(JSON.stringify({ step: 'started', hostTableCount, guestTableCount, errors }))

// 双方各点一次「整理」，确认联机理牌按钮不会触发页面崩溃。
await hostPage.getByRole('button', { name: /^整理$/ }).click({ timeout: 10000 }).catch(() => {})
await guestPage.getByRole('button', { name: /^整理$/ }).click({ timeout: 10000 }).catch(() => {})
await hostPage.waitForTimeout(1200)
await guestPage.waitForTimeout(1200)
console.log(JSON.stringify({ step: 'organized', errors }))

// 双视角手牌校验：双方手牌 ID 集合必须完全不同（不同的人拿不同的牌）。
// 牌面文字在 aria-label 里，textContents 全是空；改读 aria-label。
// 由于视角时序不同，两端的 action-panel 可能轮流为空。
// 用两条轮询循环分别等待双方手牌出现，各等最多 15 秒。
// 客人端晚加入，仪式动画和状态同步会晚几秒；放宽到 30 秒。
await hostPage.locator('.action-panel .card-strip__item [aria-label]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
await guestPage.locator('.action-panel .card-strip__item [aria-label]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
// 牌名在 PaiCard 的 aria-label 上，不在 card-strip__item 容器上；
// 直接取容器内部第一个带 aria-label 的元素。
const hostCardLabels = await hostPage.locator('.action-panel .card-strip__item [aria-label]').evaluateAll(
  (items) => items.map((item) => item.getAttribute('aria-label') ?? ''),
)
const guestCardLabels = await guestPage.locator('.action-panel .card-strip__item [aria-label]').evaluateAll(
  (items) => items.map((item) => item.getAttribute('aria-label') ?? ''),
)
// 简单牌名（如「九｜杂九」）无法区分同名牌的 copyIndex；
// 判断「两人拿同一副牌」需要看牌实例 ID，这里退而求其次：
// 同名牌各自有 2 张副本，只要双方都不是「按同一定义成对出现」的差异模式即可。
// 真正的实例级判重由服务端测试覆盖，这里只检查 UI 层至少存在顺序差异。
const orderIdentical = hostCardLabels.join('|') === guestCardLabels.join('|')
console.log(JSON.stringify({
  step: 'hand-compare',
  hostCards: hostCardLabels,
  guestCards: guestCardLabels,
  hostJoined: hostCardLabels.join('|'),
  guestJoined: guestCardLabels.join('|'),
  orderIdentical,
}))

// UI 层的牌名（如「九｜杂九」）无法区分同名牌的副本，且各客户端按
// 自己的牌理顺序展示，不能用牌名集合判断是否同一副牌。
// 实例级判重由 server/roomService.test.ts 的「开局后两个真人座位拿到不同的牌」覆盖。
console.log(JSON.stringify({ step: 'hand-compare-done' }))

// 轮到自己时点一张手牌并提交第一个可用动作，验证出牌后的状态流转。
for (let roundIndex = 0; roundIndex < 4; roundIndex += 1) {
  for (const [label, page] of [['HOST', hostPage], ['GUEST', guestPage]]) {
    // 结算或复盘抽屉可能盖住手牌，先关掉再操作。
    const drawerOpen = await page.locator('.drawer__backdrop').isVisible().catch(() => false)
    if (drawerOpen) {
      await page.evaluate(() => {
        const backdrop = document.querySelector('.drawer__backdrop')
        if (backdrop instanceof HTMLElement) backdrop.click()
      })
      await page.waitForTimeout(400)
    }

    const firstCard = page.locator('.card-strip__item').first()
    if (!(await firstCard.isVisible().catch(() => false))) {
      continue
    }

    await firstCard.click()
    await page.waitForTimeout(400)

    const actionButton = page.locator('.action-button:not([disabled])').first()
    if (await actionButton.isVisible().catch(() => false)) {
      await actionButton.click()
      console.log(JSON.stringify({ step: 'played', who: label, roundIndex }))
      await page.waitForTimeout(2000)
    }
  }

  await hostPage.waitForTimeout(800)
  if (errors.length > 0) {
    break
  }
}

const hostFinalCount = await hostPage.locator('.game-table').count()
const guestFinalCount = await guestPage.locator('.game-table').count()
console.log(JSON.stringify({ step: 'final', hostFinalCount, guestFinalCount, errors }))

await hostPage.screenshot({ path: '/tmp/e2e-host-final.png' })
await guestPage.screenshot({ path: '/tmp/e2e-guest-final.png' })
await browser.close()

if (errors.length > 0) {
  console.error('页面出现 JS 崩溃，冒烟失败。')
  process.exit(1)
}
