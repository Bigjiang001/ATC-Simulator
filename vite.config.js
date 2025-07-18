import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // 支持多个HTML入口文件
    rollupOptions: {
      input: {
        main: './index.html',
        game: './game.html'
      },
      output: {
        manualChunks: undefined
      }
    },
    // 强制内联所有CSS
    cssCodeSplit: false
  },
  base: '/ATC-Simulator/'
})
