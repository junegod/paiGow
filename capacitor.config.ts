import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 打索子原生应用容器配置。
 *
 * Web 资源统一由 Vite 输出到 dist 目录，执行同步命令后会复制到 Android / iOS 工程。
 */
const config: CapacitorConfig = {
  appId: 'com.junegod.dasuozi',
  appName: '打索子',
  webDir: 'dist',
  // iOS 由 WebView 自动避让状态栏和底部手势区，避免牌桌按钮被系统区域覆盖。
  ios: { contentInset: 'automatic', preferredContentMode: 'mobile' },
}

export default config
