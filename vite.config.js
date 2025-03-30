import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // 生成单个HTML文件
    rollupOptions: {
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true
      }
    },
    // 尝试将CSS内联到HTML中
    cssCodeSplit: false
  },
  base: '/ATC-Simulator/'
})
