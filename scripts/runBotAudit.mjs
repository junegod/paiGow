import { createServer } from 'vite'

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
    const report = await module.runBotRoundsAudit({
      rounds: 100,
      seed: 2026062901,
    })

    console.log(`机器人审计完成：${report.roundSummaries.length} 局，发现 ${report.errors.length} 个问题。`)
    console.log(`过程日志：${report.logPath}`)
    console.log(`汇总报告：${report.summaryPath}`)
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
