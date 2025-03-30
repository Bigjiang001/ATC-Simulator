import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 导入塔台无线电效果模块
import { radioEffects } from './sounds/radio_effects.js'

// 当用户首次交互时初始化音频上下文（浏览器安全策略要求）
document.addEventListener('click', () => {
  radioEffects.init();
}, { once: true });

createApp(App).mount('#app')
