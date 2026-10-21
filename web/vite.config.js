import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// base 必须 './'：GitHub Pages 部署在 https://<user>.github.io/<repo>/ 子路径下
export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
})
