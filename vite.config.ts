import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vite 配置同时服务开发构建与测试场景。
 */
export default defineConfig({
  plugins: [react()],
  ssr: {
    /* 联机服务发布为单文件产物，服务器上不需要再安装 node_modules。 */
    noExternal: true,
  },
  server: {
    /**
     * 开发服务需要监听所有网卡，手机或局域网设备才能访问本机 IP。
     */
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      /**
       * 预览构建产物时同样需要代理 WebSocket，
       * 否则构建产物联机只能依赖生产环境 Nginx 的 /ws 转发。
       */
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  preview: {
    /**
     * 预览构建产物时同样开放局域网访问，避免开发和预览行为不一致。
     */
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
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
    include: ['src/**/__tests__/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
