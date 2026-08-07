import './assets/main.css'

import { createApp } from 'vue'
import { install as VueMonacoEditorPlugin, loader } from '@guolao/vue-monaco-editor'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import App from './App.vue'

self.MonacoEnvironment = {
  getWorker(): Worker {
    return new editorWorker()
  }
}

loader.config({ monaco })

const app = createApp(App)
app.use(VueMonacoEditorPlugin)
app.mount('#app')
