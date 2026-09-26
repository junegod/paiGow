import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** 仓库路径与打包类型；产物放在已忽略的目录，避免把二进制和签名资料提交入库。 */
const root = fileURLToPath(new URL('../', import.meta.url))
const mode = process.argv[2] ?? 'simulator'
const output = path.join(root, 'artifacts/ios')
const release = path.join(root, 'release')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const environment = { ...process.env }

// 本机可能只把命令行工具设为默认；仅为子进程选择 Xcode，不修改全局开发环境。
if (!environment.DEVELOPER_DIR && existsSync('/Applications/Xcode.app/Contents/Developer')) {
  environment.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'
}
if (!['simulator', 'archive'].includes(mode)) {
  throw new Error('仅支持 simulator 或 archive 打包模式。')
}
mkdirSync(output, { recursive: true })
mkdirSync(release, { recursive: true })

/**
 * 执行原生工具并保留退出码；构建失败时立即停止，不输出可能误认成功的安装包。
 * @param {string} command 可执行程序名称。
 * @param {string[]} args 独立参数数组，不交给 shell 拼接。
 * @returns {void} 成功时返回，失败时结束当前脚本。
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const derivedData = path.join(output, mode)
const archive = path.join(release, 'DaSuoZi-unsigned.xcarchive')
// 两种产物都不绑定用户团队：模拟器包可以本地测试，未签名归档不能安装到真机或上传商店。
run('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release',
  '-destination', mode === 'archive' ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator',
  '-derivedDataPath', derivedData,
  ...(mode === 'archive' ? ['-archivePath', archive, 'archive'] : ['build']),
  'CODE_SIGNING_ALLOWED=NO', `MARKETING_VERSION=${version}`,
])
const product = mode === 'archive'
  ? archive
  : path.join(derivedData, 'Build/Products/Release-iphonesimulator/App.app')
const archiveName = mode === 'archive' ? 'unsigned-archive' : 'simulator'
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', product,
  path.join(release, `da-suo-zi-${version}-ios-${archiveName}.zip`)])
console.log(mode === 'archive'
  ? '已生成未签名归档；真机分发和 App Store 上传仍需开发者团队、描述文件与正式签名。'
  : '已生成 iOS 模拟器应用；不适用于真机安装。')
