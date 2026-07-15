import { createServer } from 'vite'
import path from 'node:path'

/** 三档机器人都必须经过完整随机对局审计，避免只验证默认标准档。 */
const BOT_DIFFICULTIES = ['beginner', 'standard', 'expert']

/**
 * 通过 Vite 的 SSR 加载能力执行 TypeScript 审计脚本，复用项目别名与模块解析配置。
 */
async function main() {
  const server = await createServer({
    configFile: 'vite.config.ts',
    server: {
      middlewareMode: true,
    },
  })

  try {
    const module = await server.ssrLoadModule('/scripts/botRoundsAudit.ts')
    for (const [index, difficulty] of BOT_DIFFICULTIES.entries()) {
      const report = await module.runBotRoundsAudit({
        rounds: 100,
        seed: 2026062901 + index,
        difficulty,
        outputDir: path.resolve(process.cwd(), 'artifacts/bot-audit', difficulty),
      })

      console.log(
        `${difficulty} 机器人审计完成：${report.roundSummaries.length} 局，发现 ${report.errors.length} 个问题。`,
      )
      console.log(`过程日志：${report.logPath}`)
      console.log(`汇总报告：${report.summaryPath}`)
    }
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
