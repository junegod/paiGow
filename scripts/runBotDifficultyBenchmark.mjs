import { createServer } from 'vite'

/**
 * 使用 Vite SSR 执行 TypeScript 难度基准，复用项目别名和编译配置。
 */
async function main() {
  const server = await createServer({
    configFile: 'vite.config.ts',
    server: {
      middlewareMode: true,
    },
  })

  try {
    const module = await server.ssrLoadModule('/scripts/botDifficultyBenchmark.ts')
    const report = module.runBotDifficultyBenchmark()
    const beginnerDifferenceRate =
      report.beginnerStandardDifferences / report.comparedDecisions
    const expertDifferenceRate =
      report.standardExpertDifferences / report.comparedDecisions

    console.log(`完成 ${report.rounds} 局、${report.comparedDecisions} 次同局面难度比较。`)
    console.log(`入门与标准动作差异率：${(beginnerDifferenceRate * 100).toFixed(2)}%`)
    console.log(`标准与专家动作差异率：${(expertDifferenceRate * 100).toFixed(2)}%`)
    console.log(JSON.stringify(report.behaviorByDifficulty, null, 2))

    if (beginnerDifferenceRate < 0.2) {
      throw new Error('入门与标准差异率不足 20%。')
    }

    if (expertDifferenceRate < 0.06) {
      throw new Error('标准与专家差异率不足 6%。')
    }
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
