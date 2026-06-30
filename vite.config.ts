import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vite 配置同时服务开发构建与测试场景。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    /**
     * 开发服务需要监听所有网卡，手机或局域网设备才能访问本机 IP。
     */
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    /**
     * 预览构建产物时同样开放局域网访问，避免开发和预览行为不一致。
     */
    host: '0.0.0.0',
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
