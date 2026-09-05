/**
 * 联机双客户端端到端验收。
 * 覆盖：精确加入目标房间、双视角手牌实例隔离、客人理牌、房主和客人真实出牌。
 */

const baseUrl = process.env.E2E_BASE_URL ?? 'https://game9.qdkl.cn'
const playwrightCorePath = process.env.E2E_PLAYWRIGHT_CORE ?? '/Users/june/IdeaProjects/e-law/node_modules/playwright-core/index.mjs'
const { chromium } = await import(playwrightCorePath)
const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const errors = []

/** 记录页面崩溃和明确的浏览器控制台错误。 */
function track(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} PAGEERROR: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`${label} CONSOLE: ${message.text()}`)
    }
  })
}
/** 从首页进入联机大厅，并等待创建按钮真正可用。 */
async function enterOnlineBrowser(page) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '多人对战' }).click()
  await page.getByRole('button', { name: '新建房间' }).waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent?.trim() === '新建房间')
    return button instanceof HTMLButtonElement && !button.disabled
  }, { timeout: 15_000 })
}

/** 读取底部当前玩家手牌实例 ID，避免用可能重复的中文牌名判断。 */
async function readHandIds(page) {
  return page.locator('.action-panel .card-strip__item[data-card-id]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-card-id')).filter(Boolean))
}

/**
 * 当前页面轮到真人时完成一个合法动作。优先点击选牌按钮，只有规则要求时才点骰碗。
 *
 * @returns 是否实际提交了一个动作。
 */
async function playCurrentTurn(page) {
  const hand = page.locator('.action-panel .card-strip--draggable .card-strip__item[data-card-id]')
  const handCount = await hand.count()

  if (handCount === 0) {
    return false
  }

  const beforeIds = await readHandIds(page)
  for (let index = 0; index < handCount; index += 1) {
    await hand.nth(index).click()
    const action = page.locator('.action-button:not([disabled])').first()

    if (await action.isVisible()) {
      await action.click()
      await page.waitForFunction(
        (count) => document.querySelectorAll('.action-panel .card-strip__item[data-card-id]').length < count,
        beforeIds.length,
        { timeout: 10_000 },
      )
      return true
    }
  }

  const diceBowl = page.locator('.dice-bowl-control--ready')
  if (await diceBowl.isVisible()) {
    await diceBowl.click()
    await page.waitForTimeout(700)
    return true
  }

  throw new Error('轮到真人但没有找到可提交的选牌动作或掷骰动作。')
}

const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const hostPage = await hostContext.newPage()
const guestPage = await guestContext.newPage()
track(hostPage, 'HOST')
track(guestPage, 'GUEST')

try {
  await enterOnlineBrowser(hostPage)
  await hostPage.getByPlaceholder('例如：阿明').fill('阿明')
  await hostPage.getByRole('button', { name: '新建房间' }).click()
  await hostPage.getByRole('button', { name: '开始牌局' }).waitFor({ state: 'visible', timeout: 10_000 })
  const roomHeading = await hostPage.locator('.online-room-code-panel > strong').innerText()
  const roomCode = roomHeading.replace(/\D/g, '')

  await enterOnlineBrowser(guestPage)
  await guestPage.getByPlaceholder('例如：阿明').fill('小张')
  const targetRoom = guestPage.locator('.online-room-row', { hasText: roomCode })
  await targetRoom.getByRole('button', { name: '加入' }).click()
  await guestPage.getByText('等待房主开始').waitFor({ state: 'visible', timeout: 10_000 })

  await hostPage.getByRole('button', { name: '开始牌局' }).click()
  await hostPage.locator('.game-table').waitFor({ state: 'visible', timeout: 15_000 })
  await guestPage.locator('.game-table').waitFor({ state: 'visible', timeout: 15_000 })
  await hostPage.locator('.action-panel .card-strip__item[data-card-id]').first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  await guestPage.locator('.action-panel .card-strip__item[data-card-id]').first()
    .waitFor({ state: 'visible', timeout: 30_000 })

  const hostHandIds = await readHandIds(hostPage)
  const guestHandIds = await readHandIds(guestPage)
  if (hostHandIds.length !== 8 || guestHandIds.length !== 8) {
    throw new Error(`开局手牌数量错误：host=${hostHandIds.length}, guest=${guestHandIds.length}`)
  }
  if (hostHandIds.some((cardId) => guestHandIds.includes(cardId))) {
    throw new Error('两个客户端收到了重复的牌实例。')
  }

  await guestPage.getByRole('button', { name: '整理' }).click()
  await guestPage.getByText('整理中').waitFor({ state: 'visible', timeout: 2_000 })

  let hostPlayed = false
  let guestPlayed = false
  const deadline = Date.now() + 45_000

  while ((!hostPlayed || !guestPlayed) && Date.now() < deadline) {
    if (!hostPlayed && await hostPage.locator('.action-panel .card-strip--draggable').isVisible()) {
      hostPlayed = await playCurrentTurn(hostPage)
    }
    if (!guestPlayed && await guestPage.locator('.action-panel .card-strip--draggable').isVisible()) {
      guestPlayed = await playCurrentTurn(guestPage)
    }
    await hostPage.waitForTimeout(350)
  }

  if (!hostPlayed || !guestPlayed) {
    throw new Error(`真实出牌未完成：hostPlayed=${hostPlayed}, guestPlayed=${guestPlayed}`)
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  await hostPage.screenshot({ path: '/tmp/paigow-online-host-final.png' })
  await guestPage.screenshot({ path: '/tmp/paigow-online-guest-final.png' })
  console.log(JSON.stringify({
    ok: true,
    roomCode,
    hostPlayed,
    guestPlayed,
    hostHandCount: hostHandIds.length,
    guestHandCount: guestHandIds.length,
    errors,
  }))
} finally {
  await browser.close()
}
