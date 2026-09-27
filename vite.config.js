import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    // 本地沙箱的安全删除机制会拦截目录清空，关闭后直接覆盖写入即可构建
    emptyOutDir: false,
  },
})
