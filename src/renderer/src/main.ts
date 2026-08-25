import './assets/main.css'
import 'katex/dist/katex.min.css'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
