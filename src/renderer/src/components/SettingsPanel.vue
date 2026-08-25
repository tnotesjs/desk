<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import EmojiInput from './EmojiInput.vue'
import { useWorkspaceStore } from '../stores/workspace'
import { pushToast } from '../stores/toast'

import type { AppSettings, DeskResult, ImageTokenStatus } from '../../../shared/contracts'

const emit = defineEmits<{ close: [] }>()
const store = useWorkspaceStore()
const draft = ref<AppSettings | null>(
  store.settings ? (JSON.parse(JSON.stringify(store.settings)) as AppSettings) : null
)
const token = ref('')
const clearToken = ref(false)
const tokenStatus = ref<ImageTokenStatus>({ configured: false, encryptionAvailable: false })
const busy = ref(false)
const fullscreen = ref(false)
const activeGroup = ref('general')
const configText = ref('')
const configBusy = ref(false)
const groups = [
  {
    id: 'general',
    label: '常规',
    icon: 'M4 7h10M18 7h2M4 12h2M10 12h10M4 17h10M18 17h2'
  },
  {
    id: 'tabs',
    label: '标签与导航',
    icon: 'M4 4h16v16H4zM4 8h16M9 8v2M5 12h14M5 17h10'
  },
  {
    id: 'toc',
    label: '目录管理',
    icon: 'M4 6h7M4 12h7M4 18h7M14 6h6M14 12h6M14 18h6'
  },
  {
    id: 'tools',
    label: '外部工具',
    icon: 'M5 7h14M5 12h14M5 17h14M8 5v4M12 10v4M16 15v4'
  },
  {
    id: 'image',
    label: '图片与图床',
    icon: 'M5 4h14v16H5zM8 9.5a2 2 0 1 0 3.9 0a2 2 0 1 0-3.9 0M7 17l4-4 3 3 3-3 2 2'
  },
  {
    id: 'config',
    label: '配置文件',
    icon: 'M6 3h9l4 4v14H6zM15 3v4h4M9 11h6M9 15h6M9 19h4'
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: 'M4 7h16v10H4zM7 10h2M12 10h2M16 10h0.1M7 14h10'
  }
]

const tokenHint = computed(() => {
  if (!tokenStatus.value.encryptionAvailable) return '当前系统暂不可用安全加密存储'
  if (clearToken.value) return '保存后会移除已经保存的 Token'
  if (tokenStatus.value.configured) return '已安全保存；留空不会修改现有 Token'
  return '仅保存在系统加密后的 Desk 私有配置中'
})

const currentKnowledgeBaseName = computed(() => store.selectedKnowledgeBase?.displayName ?? null)
const primaryKey = computed(() => (store.runtimePlatform === 'darwin' ? '⌘' : 'Ctrl'))
const altKey = computed(() => (store.runtimePlatform === 'darwin' ? '⌥' : 'Alt'))
const shortcutGroups = computed(() => [
  {
    title: '标签与导航',
    items: [
      ['关闭当前标签', `${primaryKey.value} W`],
      ['关闭已保存笔记', `${primaryKey.value} K  U`],
      ['全部关闭', `${primaryKey.value} K  W`],
      ['将预览标签保持打开', `${primaryKey.value} K  Enter`],
      ['固定 / 解除固定', `${primaryKey.value} K  Shift Enter`],
      ['下一个 / 上一个标签', 'Ctrl Tab / Ctrl Shift Tab'],
      ['复制笔记目录路径', `${altKey.value} ${primaryKey.value} C`],
      ['在系统文件管理器中显示', `${altKey.value} ${primaryKey.value} R`]
    ]
  },
  {
    title: 'Markdown 编辑',
    items: [
      ['保存', `${primaryKey.value} S`],
      ['撤销 / 重做', `${primaryKey.value} Z / ${primaryKey.value} Shift Z`],
      ['一级至六级标题', `${altKey.value} ${primaryKey.value} 1…6`],
      ['正文', `${altKey.value} ${primaryKey.value} 0`],
      ['粗体 / 斜体', `${primaryKey.value} B / ${primaryKey.value} I`],
      ['删除线', `${primaryKey.value} Shift X`],
      ['行内代码', `${primaryKey.value} E`],
      ['有序 / 无序列表', `${primaryKey.value} Shift 7 / 8`],
      ['任务列表', `${altKey.value} ${primaryKey.value} T`],
      ['引用', `${primaryKey.value} Shift U`],
      ['分割线', `${altKey.value} ${primaryKey.value} S`]
    ]
  }
])
const autoPushEnabled = computed({
  get: () => {
    const configId = store.selectedKnowledgeBase?.configId
    return configId ? Boolean(draft.value?.knowledgeBases[configId]?.autoPush?.enabled) : false
  },
  set: (enabled: boolean) => {
    const configId = store.selectedKnowledgeBase?.configId
    if (!configId || !draft.value) return
    const current = draft.value.knowledgeBases[configId] ?? {}
    draft.value.knowledgeBases[configId] = {
      ...current,
      autoPush: {
        enabled,
        idleMinutes: current.autoPush?.idleMinutes ?? 10
      }
    }
  }
})
const autoPushIdleMinutes = computed({
  get: () => {
    const configId = store.selectedKnowledgeBase?.configId
    return configId ? (draft.value?.knowledgeBases[configId]?.autoPush?.idleMinutes ?? 10) : 10
  },
  set: (idleMinutes: number) => {
    const configId = store.selectedKnowledgeBase?.configId
    if (!configId || !draft.value) return
    const current = draft.value.knowledgeBases[configId] ?? {}
    draft.value.knowledgeBases[configId] = {
      ...current,
      autoPush: {
        enabled: current.autoPush?.enabled ?? false,
        idleMinutes
      }
    }
  }
})

function resultValue<T>(result: DeskResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

async function refreshTokenStatus(): Promise<void> {
  tokenStatus.value = resultValue<ImageTokenStatus>(await window.desk.settings.imageTokenStatus())
}

async function validateGitHub(): Promise<void> {
  if (!draft.value || busy.value) return
  busy.value = true
  try {
    const result = await window.desk.settings.validateImageSettings({
      github: { ...draft.value.imageUpload.github },
      token: token.value.trim() || undefined
    })
    if (!result.ok) throw new Error(result.error.message)
    pushToast(
      `${result.value.repository} · ${result.value.branch}：${result.value.message}`,
      'success'
    )
  } catch (cause) {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    busy.value = false
  }
}

const groupDefaults: Record<string, Partial<AppSettings>> = {
  general: {
    theme: 'system',
    density: 'comfortable',
    defaultNoteView: 'visual',
    autosave: { enabled: true, delayMs: 1000 },
    workspaceLayout: 'kb-dir-content',
    prettier: true
  },
  tabs: {
    tabs: { maxOpenCount: 10, wrap: true, autoRevealInToc: true }
  },
  toc: {
    createNotePosition: 'top',
    toc: {
      showNoteIndex: true,
      showNoteStatus: true,
      doneEmoji: '✅',
      undoneEmoji: '⏰',
      changesCollapsedByDefault: true
    }
  },
  tools: {
    ide: 'vscode',
    gitPath: null,
    nodePath: null,
    confirmBeforeCommit: false
  },
  image: {
    imageUpload: {
      defaultTarget: 'local',
      github: {
        repository: '',
        branch: 'main',
        path: '/',
        cdnTemplate: 'https://cdn.jsdelivr.net/gh/${username}/${repository}@${branch}/${filepath}',
        fileNameFormat: '${YY}-${MM}-${DD}-${HH}-${mm}-${ss}'
      }
    }
  }
}

function resetGroup(id: string): void {
  if (!draft.value) return
  const defaults = groupDefaults[id]
  if (!defaults) return
  const next: AppSettings = { ...draft.value, ...defaults }
  if (id === 'tools') {
    const configId = store.selectedKnowledgeBase?.configId
    if (configId) {
      next.knowledgeBases = {
        ...next.knowledgeBases,
        [configId]: {
          ...next.knowledgeBases[configId],
          autoPush: { enabled: false, idleMinutes: 10 }
        }
      }
    }
  }
  draft.value = next
}

let applyTimer: ReturnType<typeof setTimeout> | null = null
let applying = false

function scheduleApply(): void {
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    applyTimer = null
    void applyDraft()
  }, 400)
}

async function applyDraft(): Promise<void> {
  if (!draft.value || applying) return
  applying = true
  try {
    const clone = JSON.parse(JSON.stringify(draft.value)) as AppSettings
    await store.updateSettings(clone)
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    applying = false
  }
}

async function applyToken(): Promise<void> {
  try {
    const result = await window.desk.settings.updateImageToken({
      token: token.value.trim() || undefined,
      clear: clearToken.value
    })
    tokenStatus.value = resultValue<ImageTokenStatus>(result)
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(draft, () => scheduleApply(), { deep: true })

async function loadConfigText(): Promise<void> {
  try {
    configText.value = resultValue<string>(await window.desk.settings.readRaw())
  } catch (cause) {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  }
}

function activateGroup(id: string): void {
  activeGroup.value = id
  if (id === 'config') void loadConfigText()
}

function syncSettings(settings: AppSettings): void {
  store.applySettings(settings)
  draft.value = JSON.parse(JSON.stringify(settings)) as AppSettings
  configText.value = JSON.stringify(settings, null, 2)
}

async function applyConfig(): Promise<void> {
  if (configBusy.value) return
  configBusy.value = true
  try {
    const settings = resultValue<AppSettings>(await window.desk.settings.writeRaw(configText.value))
    syncSettings(settings)
    pushToast('配置已保存', 'success')
  } catch {
    try {
      const defaults = resultValue<AppSettings>(await window.desk.settings.reset())
      syncSettings(defaults)
      pushToast('配置无效，已回退到默认配置', 'error')
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
    }
  } finally {
    configBusy.value = false
  }
}

async function exportConfig(): Promise<void> {
  configBusy.value = true
  try {
    const result = await window.desk.settings.export()
    if (!result.ok) throw new Error(result.error.message)
    pushToast('配置已导出', 'success')
  } catch (cause) {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    configBusy.value = false
  }
}

async function importConfig(): Promise<void> {
  configBusy.value = true
  try {
    const settings = resultValue<AppSettings>(await window.desk.settings.import())
    syncSettings(settings)
    pushToast('配置已导入', 'success')
  } catch (cause) {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    configBusy.value = false
  }
}

async function resetConfig(): Promise<void> {
  configBusy.value = true
  try {
    const defaults = resultValue<AppSettings>(await window.desk.settings.reset())
    syncSettings(defaults)
    pushToast('已恢复到默认配置', 'success')
  } catch (cause) {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    configBusy.value = false
  }
}

function closeConfigMenu(event: Event, action: () => void): void {
  action()
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

onMounted(() => {
  void refreshTokenStatus().catch((cause) => {
    pushToast(cause instanceof Error ? cause.message : String(cause), 'error')
  })
})
</script>

<template>
  <div class="settings-backdrop" @mousedown.self="emit('close')">
    <section v-if="draft" class="settings-panel" :class="{ fullscreen }" aria-label="设置">
      <header class="settings-header">
        <span class="settings-title">TNotes Desk 设置</span>
        <div class="settings-header-actions">
          <button
            type="button"
            class="icon-btn"
            :aria-label="fullscreen ? '退出全屏' : '全屏'"
            :title="fullscreen ? '退出全屏' : '全屏'"
            @click="fullscreen = !fullscreen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                :d="
                  fullscreen
                    ? 'M9 4v7H4M15 4v7h5M9 20v-7H4M15 20v-7h5'
                    : 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'
                "
              />
            </svg>
          </button>
          <button type="button" class="icon-btn" aria-label="关闭设置" @click="emit('close')">
            ×
          </button>
        </div>
      </header>

      <div class="settings-body">
        <nav class="settings-nav" aria-label="设置分组">
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            class="nav-item"
            :class="{ active: activeGroup === group.id }"
            @click="activateGroup(group.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="group.icon" />
            </svg>
            <span>{{ group.label }}</span>
          </button>
        </nav>
        <div class="settings-content">
          <section v-if="activeGroup === 'general'" class="settings-section">
            <header class="section-heading">
              <strong>外观与编辑</strong>
              <span>适用于整个 Desk 工作区</span>
            </header>
            <button type="button" class="reset-group" @click="resetGroup('general')">重置</button>
            <div class="field-grid cols-3">
              <label class="field">
                <span>主题</span>
                <select v-model="draft.theme">
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </label>
              <label class="field">
                <span>界面密度</span>
                <select v-model="draft.density">
                  <option value="comfortable">舒适</option>
                  <option value="compact">紧凑</option>
                </select>
              </label>
              <label class="field">
                <span>笔记默认视图</span>
                <select v-model="draft.defaultNoteView">
                  <option value="visual">可视化编辑</option>
                  <option value="readonly">只读</option>
                  <option value="source">源码</option>
                </select>
              </label>
            </div>
            <div class="layout-picker">
              <button
                type="button"
                class="layout-option"
                :class="{ active: draft.workspaceLayout === 'kb-dir-content' }"
                @click="draft.workspaceLayout = 'kb-dir-content'"
              >
                <svg viewBox="0 0 120 56" aria-hidden="true">
                  <rect x="0" width="24" height="56" rx="3" />
                  <rect x="28" width="32" height="56" rx="3" />
                  <rect x="64" width="52" height="56" rx="3" />
                </svg>
                <span>知识库 · 目录 · 内容</span>
              </button>
              <button
                type="button"
                class="layout-option"
                :class="{ active: draft.workspaceLayout === 'content-dir-kb' }"
                @click="draft.workspaceLayout = 'content-dir-kb'"
              >
                <svg viewBox="0 0 120 56" aria-hidden="true">
                  <rect x="0" width="52" height="56" rx="3" />
                  <rect x="56" width="32" height="56" rx="3" />
                  <rect x="92" width="24" height="56" rx="3" />
                </svg>
                <span>内容 · 目录 · 知识库</span>
              </button>
            </div>
            <div class="settings-row">
              <label class="switch-field">
                <input v-model="draft.autosave.enabled" type="checkbox" />
                <span>自动保存</span>
              </label>
              <label class="field inline-number">
                <span>延迟</span>
                <span class="input-with-unit">
                  <input
                    v-model.number="draft.autosave.delayMs"
                    type="number"
                    min="250"
                    max="30000"
                    step="250"
                  />
                  <em>ms</em>
                </span>
              </label>
              <label class="switch-field">
                <input v-model="draft.prettier" type="checkbox" />
                <span>按 Core 规则格式化</span>
              </label>
            </div>
          </section>

          <section v-else-if="activeGroup === 'tabs'" class="settings-section">
            <header class="section-heading">
              <strong>标签与导航</strong>
              <span>控制标签容量、布局和目录联动</span>
            </header>
            <button type="button" class="reset-group" @click="resetGroup('tabs')">重置</button>
            <div class="field-grid cols-3">
              <label class="field">
                <span>最多打开标签数</span>
                <input v-model.number="draft.tabs.maxOpenCount" type="number" min="1" max="30" />
              </label>
              <label class="card-toggle">
                <input v-model="draft.tabs.wrap" type="checkbox" />
                <span><strong>标签自动换行</strong><small>横向空间不足时显示为多行</small></span>
              </label>
              <label class="card-toggle">
                <input v-model="draft.tabs.autoRevealInToc" type="checkbox" />
                <span><strong>跟随活动标签</strong><small>自动切换知识库并定位目录项</small></span>
              </label>
            </div>
            <button type="button" class="entry-row" @click="activateGroup('shortcuts')">
              <span class="entry-row__label">
                <strong>快捷键清单</strong>
                <small>查看 Desk 当前支持的标签与编辑快捷键</small>
              </span>
              <span class="entry-row__hint" aria-hidden="true">⌘K</span>
            </button>
          </section>

          <section v-else-if="activeGroup === 'toc'" class="settings-section">
            <header class="section-heading">
              <strong>目录管理</strong>
              <span>控制目录树与变更区域显示</span>
            </header>
            <button type="button" class="reset-group" @click="resetGroup('toc')">重置</button>
            <div class="field-grid cols-3">
              <label class="field">
                <span>新增笔记位置</span>
                <select v-model="draft.createNotePosition">
                  <option value="top">顶部新增</option>
                  <option value="end">末尾追加</option>
                </select>
              </label>
            </div>
            <div class="settings-row">
              <label class="switch-field">
                <input v-model="draft.toc.showNoteIndex" type="checkbox" />
                <span>显示笔记编号</span>
              </label>
              <label class="switch-field">
                <input v-model="draft.toc.showNoteStatus" type="checkbox" />
                <span>显示完成状态标识</span>
              </label>
            </div>
            <div class="field-grid cols-2">
              <label class="field">
                <span>已完成 emoji</span>
                <EmojiInput
                  v-model="draft.toc.doneEmoji"
                  :disabled="!draft.toc.showNoteStatus"
                  placeholder="✅（留空不显示）"
                />
              </label>
              <label class="field">
                <span>未完成 emoji</span>
                <EmojiInput
                  v-model="draft.toc.undoneEmoji"
                  :disabled="!draft.toc.showNoteStatus"
                  placeholder="⏰（留空不显示）"
                />
              </label>
            </div>
            <div class="settings-row">
              <label class="switch-field">
                <input v-model="draft.toc.changesCollapsedByDefault" type="checkbox" />
                <span>变更区域默认折叠</span>
              </label>
            </div>
          </section>

          <section v-else-if="activeGroup === 'tools'" class="settings-section">
            <header class="section-heading">
              <strong>外部工具</strong>
              <span>冲突处理和右键快捷入口会使用这里的 IDE</span>
            </header>
            <button type="button" class="reset-group" @click="resetGroup('tools')">重置</button>
            <div class="field-grid cols-3">
              <label class="field">
                <span>默认 IDE</span>
                <select v-model="draft.ide">
                  <option value="vscode">VSCode</option>
                  <option value="cursor">Cursor</option>
                </select>
              </label>
              <label class="field">
                <span>Git 可执行文件（可选）</span>
                <input v-model="draft.gitPath" placeholder="自动检测" />
              </label>
              <label class="field">
                <span>Node 可执行文件（可选）</span>
                <input v-model="draft.nodePath" placeholder="自动检测" />
              </label>
            </div>
            <div class="settings-row">
              <label class="switch-field">
                <input v-model="draft.confirmBeforeCommit" type="checkbox" />
                <span>提交前再次弹窗确认变更</span>
              </label>
            </div>
            <div v-if="currentKnowledgeBaseName" class="knowledge-git-setting">
              <header class="sub-heading">
                <strong>{{ currentKnowledgeBaseName }}</strong>
                <span>空闲后自动提交并推送</span>
              </header>
              <div class="settings-row">
                <label class="switch-field">
                  <input v-model="autoPushEnabled" type="checkbox" />
                  <span>启用自动推送</span>
                </label>
                <label class="field inline-number">
                  <span>连续无内容更新</span>
                  <span class="input-with-unit">
                    <input v-model.number="autoPushIdleMinutes" type="number" min="1" max="1440" />
                    <em>分钟</em>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section v-else-if="activeGroup === 'image'" class="settings-section image-settings">
            <header class="section-heading">
              <strong>图片处理与 GitHub 图床</strong>
              <span>图床上传失败时始终自动回退到当前笔记的 assets 目录</span>
            </header>
            <button type="button" class="reset-group" @click="resetGroup('image')">重置</button>

            <div class="target-choice">
              <label :class="{ selected: draft.imageUpload.defaultTarget === 'local' }">
                <input v-model="draft.imageUpload.defaultTarget" type="radio" value="local" />
                <span><strong>本地 assets</strong><small>默认、离线可用</small></span>
              </label>
              <label :class="{ selected: draft.imageUpload.defaultTarget === 'github' }">
                <input v-model="draft.imageUpload.defaultTarget" type="radio" value="github" />
                <span><strong>GitHub 图床</strong><small>失败后自动本地落盘</small></span>
              </label>
            </div>

            <div class="sub-block">
              <header class="sub-heading">
                <strong>GitHub 图床配置</strong>
                <span>仅在上传图片到 GitHub 时使用</span>
              </header>
              <div class="field-grid cols-2">
                <label class="field">
                  <span>仓库</span>
                  <input
                    v-model="draft.imageUpload.github.repository"
                    placeholder="tnotesjs/imgs-2026 或 GitHub 地址"
                  />
                </label>
                <label class="field">
                  <span>分支</span>
                  <input v-model="draft.imageUpload.github.branch" placeholder="main" />
                </label>
                <label class="field">
                  <span>仓库内路径</span>
                  <input v-model="draft.imageUpload.github.path" placeholder="/" />
                </label>
                <label class="field">
                  <span>文件名格式</span>
                  <input
                    v-model="draft.imageUpload.github.fileNameFormat"
                    placeholder="${YY}-${MM}-${DD}-${HH}-${mm}-${ss}"
                  />
                </label>
              </div>
              <label class="field">
                <span>CDN 模板</span>
                <input v-model="draft.imageUpload.github.cdnTemplate" />
                <small>支持 ${username}、${repository}、${branch}、${filepath}</small>
              </label>
              <label class="field">
                <span>GitHub Token</span>
                <input
                  v-model="token"
                  type="password"
                  autocomplete="off"
                  :disabled="clearToken"
                  :placeholder="
                    tokenStatus.configured
                      ? '已配置；输入新值可替换'
                      : 'fine-grained PAT（Contents: write）'
                  "
                  @change="applyToken"
                />
                <small>{{ tokenHint }}</small>
              </label>
              <div class="token-actions">
                <label v-if="tokenStatus.configured" class="switch-field danger">
                  <input v-model="clearToken" type="checkbox" @change="applyToken" />
                  <span>移除已保存的 Token</span>
                </label>
                <button
                  type="button"
                  class="btn-ghost"
                  :disabled="busy || clearToken"
                  @click="validateGitHub"
                >
                  验证 GitHub 配置
                </button>
              </div>
            </div>
          </section>

          <section v-else-if="activeGroup === 'config'" class="settings-section config-section">
            <header class="section-heading">
              <strong>配置文件</strong>
              <span>.tn-desk-config.json · 修改非法值会自动回退到默认配置</span>
            </header>
            <details class="config-actions">
              <summary class="config-actions-trigger" title="配置操作" aria-label="配置操作">
                ⋮
              </summary>
              <div class="config-actions-popover">
                <button
                  type="button"
                  :disabled="configBusy"
                  @click="closeConfigMenu($event, applyConfig)"
                >
                  保存并校验
                </button>
                <button
                  type="button"
                  :disabled="configBusy"
                  @click="closeConfigMenu($event, exportConfig)"
                >
                  导出配置
                </button>
                <button
                  type="button"
                  :disabled="configBusy"
                  @click="closeConfigMenu($event, importConfig)"
                >
                  导入配置
                </button>
                <button
                  type="button"
                  class="danger"
                  :disabled="configBusy"
                  @click="closeConfigMenu($event, resetConfig)"
                >
                  恢复默认
                </button>
              </div>
            </details>
            <textarea v-model="configText" class="config-editor" spellcheck="false" />
          </section>

          <section v-else class="settings-section">
            <header class="section-heading">
              <strong>快捷键清单</strong>
              <span>Desk 当前支持的标签与编辑快捷键</span>
            </header>
            <div v-for="group in shortcutGroups" :key="group.title" class="shortcut-group">
              <h3>{{ group.title }}</h3>
              <div v-for="item in group.items" :key="item[0]" class="shortcut-row">
                <span>{{ item[0] }}</span>
                <kbd>{{ item[1] }}</kbd>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  background: rgba(3, 6, 12, 0.64);
  backdrop-filter: blur(4px);
}

.settings-panel {
  width: min(780px, calc(100% - 44px));
  max-height: min(780px, calc(100% - 54px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--raised);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
}

.settings-panel > header,
.settings-panel > footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
}

.settings-panel > header > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.settings-panel > header span {
  color: var(--muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-panel > header strong {
  font-size: 14px;
}

.settings-panel > header button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 20px;
}

.settings-scroll {
  flex: 1;
  overflow: auto;
  padding: 2px 16px 18px;
}

.settings-section {
  padding: 17px 0;
  border-bottom: 1px solid var(--border);
}

.settings-section:last-child {
  border-bottom: 0;
}

.section-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.section-heading strong {
  font-size: 12px;
}

.section-heading span,
.wide-field small,
.target-choice small {
  color: var(--muted);
  font-size: 9px;
}

.settings-grid {
  display: grid;
  gap: 10px;
}

.settings-grid.thirds {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.settings-grid.two-columns {
  grid-template-columns: minmax(0, 2fr) minmax(130px, 1fr);
}

.settings-grid label,
.wide-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--muted);
  font-size: 9px;
}

.setting-card-toggle {
  min-height: 52px;
  flex-direction: row !important;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  padding: 8px 10px;
}

.setting-card-toggle > span,
.shortcut-entry > span:first-child {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.setting-card-toggle strong,
.shortcut-entry strong {
  color: var(--text);
  font-size: 10px;
}

.setting-card-toggle small,
.shortcut-entry small {
  color: var(--muted);
  font-size: 9px;
}

.shortcut-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 9px 11px;
  text-align: left;
}

.shortcut-entry:hover {
  border-color: var(--accent);
  background: var(--hover);
}

.settings-panel input:not([type='checkbox']):not([type='radio']),
.settings-panel select {
  width: 100%;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--text);
  padding: 0 9px;
  font-size: 11px;
}

.settings-panel input:focus,
.settings-panel select:focus {
  border-color: var(--accent);
}

.toggle-row,
.token-actions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 11px;
}

.knowledge-git-setting {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 11px;
  border-radius: 7px;
  background: var(--input-bg);
  padding: 9px;
}

.toggle,
.inline-field {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 10px;
}

.inline-field input {
  width: 88px !important;
}

.target-choice {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 12px;
}

.target-choice > label {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
}

.target-choice > label.selected {
  border-color: var(--accent);
  background: var(--selected);
}

.target-choice span {
  display: flex;
  flex-direction: column;
}

.target-choice strong {
  font-size: 10px;
}

.wide-field {
  margin-top: 10px;
}

.token-actions {
  justify-content: space-between;
}

.validate {
  margin-left: auto;
  height: 29px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 0 10px;
  font-size: 10px;
}

.danger-toggle {
  color: var(--danger);
}

.validation {
  margin: 10px 0 0;
  border-radius: 6px;
  background: var(--success-soft);
  color: var(--success);
  padding: 7px 9px;
  font-size: 10px;
}

.validation.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.settings-panel > footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  border-bottom: 0;
}

.settings-panel > footer > span {
  flex: 1;
  color: var(--muted);
  font-size: 9px;
}

.settings-panel > footer button {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  padding: 0 12px;
  font-size: 10px;
}

.settings-panel > footer .secondary {
  background: transparent;
  color: var(--text);
}

.settings-panel > footer .primary {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.shortcut-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  background: rgba(3, 6, 12, 0.52);
}

.shortcut-panel {
  width: min(620px, calc(100% - 48px));
  max-height: min(720px, calc(100% - 60px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--raised);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}

.shortcut-panel > header {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding: 13px 16px;
}

.shortcut-panel > header > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.shortcut-panel > header span {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shortcut-panel > header strong {
  font-size: 14px;
}

.shortcut-panel > header button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 20px;
}

.shortcut-scroll {
  overflow: auto;
  padding: 6px 18px 18px;
}

.shortcut-scroll section + section {
  margin-top: 20px;
}

.shortcut-scroll h3 {
  margin: 12px 0 6px;
  color: var(--muted);
  font-size: 10px;
}

.shortcut-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-height: 35px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.shortcut-row kbd {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  padding: 3px 7px;
  font: inherit;
}

@media (max-width: 760px) {
  .settings-grid.thirds,
  .settings-grid.two-columns {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.settings-panel.fullscreen {
  width: 100%;
  height: 100%;
  max-height: 100%;
  border: 0;
  border-radius: 0;
}

.settings-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.settings-nav {
  flex: none;
  width: 168px;
  overflow-y: auto;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 8px 10px;
  font-size: 11px;
  text-align: left;
}

.nav-item svg {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--selected);
  color: var(--accent-strong);
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 18px 22px;
}

.settings-panel > header .icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.settings-panel > header .icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.settings-panel > header .icon-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.config-section {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.config-editor {
  width: 100%;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--editor-text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  padding: 12px;
  resize: none;
  outline: none;
  tab-size: 2;
}

.config-editor:focus {
  border-color: var(--accent);
}

.btn-ghost.danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.btn-ghost.danger:hover:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger-soft);
}

.config-actions {
  position: absolute;
  top: 12px;
  right: 12px;
}

.config-actions-trigger {
  width: 30px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  list-style: none;
}

.config-actions-trigger::-webkit-details-marker {
  display: none;
}

.config-actions-trigger:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--hover);
}

.config-actions-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  min-width: 150px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  padding: 5px;
}

.config-actions-popover button {
  width: 100%;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 7px 9px;
  font-size: 11px;
  text-align: left;
}

.config-actions-popover button:hover:not(:disabled) {
  background: var(--hover);
}

.config-actions-popover button:disabled {
  opacity: 0.5;
  cursor: default;
}

.config-actions-popover button.danger {
  color: var(--danger);
}

.shortcut-group + .shortcut-group {
  margin-top: 18px;
}

.shortcut-group h3 {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
}

.shortcut-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-height: 35px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.shortcut-row kbd {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  padding: 3px 7px;
  font: inherit;
}
</style>

<style scoped>
/* Redesigned settings panel layout (overrides the legacy block above). */
.settings-panel {
  width: min(860px, calc(100% - 44px));
  height: min(720px, calc(100% - 44px));
  max-height: min(800px, calc(100% - 54px));
}

.settings-panel > .settings-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid var(--border);
}

.settings-header .settings-title {
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-header .settings-header-actions {
  flex: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
}

.settings-header .icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.settings-header .icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.settings-header .icon-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.settings-panel > header button {
  font-size: 16px;
}

.settings-section {
  position: relative;
}

.reset-group {
  position: absolute;
  top: 12px;
  right: 12px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 0 9px;
  font-size: 9px;
}

.reset-group:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--hover);
}

.settings-scroll {
  padding: 16px 18px 22px;
}

.settings-section {
  padding: 15px 16px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
}

.settings-section:last-child {
  margin-bottom: 0;
  border-bottom: 1px solid var(--border);
}

.section-heading {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  margin-bottom: 14px;
}

.section-heading strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}

.section-heading span {
  color: var(--muted);
  font-size: 10px;
}

.field-grid {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.field-grid.cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field-grid.cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field > span {
  color: var(--muted);
  font-size: 10px;
}

.field > small {
  color: var(--muted);
  font-size: 9px;
}

.settings-panel input:not([type='checkbox']):not([type='radio']),
.settings-panel select {
  height: 32px;
  border-radius: 7px;
  padding: 0 28px 0 10px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--input-bg)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%2391a0b5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    no-repeat right 9px center / 12px 12px;
  font-size: 11px;
}

.settings-panel input:focus,
.settings-panel select:focus {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.settings-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
}

.layout-picker {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}

.layout-option {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--muted);
  cursor: pointer;
  padding: 10px;
  font-size: 10px;
}

.layout-option svg {
  width: 128px;
  height: 60px;
}

.layout-option svg rect {
  fill: var(--raised);
  stroke: var(--border);
}

.layout-option.active {
  border-color: var(--accent);
  background: var(--selected);
  color: var(--text);
}

.layout-option.active svg rect {
  fill: color-mix(in srgb, var(--accent) 24%, var(--raised));
  stroke: var(--accent);
}

.switch-field {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
}

.switch-field input {
  accent-color: var(--accent);
  margin: 0;
}

.switch-field.danger {
  color: var(--danger);
}

.inline-number {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.inline-number > span:first-child {
  color: var(--muted);
  font-size: 10px;
}

.input-with-unit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.input-with-unit input {
  width: 92px;
}

.input-with-unit em {
  color: var(--muted);
  font-size: 10px;
  font-style: normal;
}

.card-toggle {
  min-height: 56px;
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  padding: 9px 11px;
  cursor: pointer;
}

.card-toggle input {
  accent-color: var(--accent);
  margin: 0;
}

.card-toggle > span {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.card-toggle strong {
  color: var(--text);
  font-size: 10px;
}

.card-toggle small {
  color: var(--muted);
  font-size: 9px;
}

.card-toggle:hover {
  border-color: var(--accent);
}

.entry-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 9px 11px;
  text-align: left;
}

.entry-row:hover {
  border-color: var(--accent);
  background: var(--hover);
}

.entry-row__label {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.entry-row__label strong {
  color: var(--text);
  font-size: 10px;
}

.entry-row__label small {
  color: var(--muted);
  font-size: 9px;
}

.entry-row__hint {
  color: var(--muted);
  font-size: 10px;
  font-family: var(--font-mono);
}

.sub-block,
.knowledge-git-setting {
  display: block;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--input-bg);
  padding: 12px 13px;
}

.sub-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.sub-heading strong {
  color: var(--text);
  font-size: 11px;
}

.sub-heading span {
  color: var(--muted);
  font-size: 9px;
}

.sub-block .settings-row,
.knowledge-git-setting .settings-row {
  margin-top: 8px;
}

.target-choice {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.target-choice > label {
  border-radius: 9px;
  background: var(--input-bg);
  padding: 10px 11px;
}

.target-choice > label input {
  accent-color: var(--accent);
  margin: 0;
}

.target-choice span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.target-choice strong {
  color: var(--text);
  font-size: 10px;
}

.target-choice small {
  color: var(--muted);
  font-size: 9px;
}

.token-actions {
  margin-top: 10px;
}

.btn-ghost {
  margin-left: auto;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 0 12px;
  font-size: 10px;
}

.btn-ghost:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--hover);
}

.btn-ghost:disabled {
  opacity: 0.5;
  cursor: default;
}

.validation {
  border-radius: 7px;
  margin: 10px 0 0;
  background: var(--success-soft);
  color: var(--success);
  padding: 8px 10px;
  font-size: 10px;
}

.validation.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.settings-panel > footer > button {
  height: 32px;
  border-radius: 7px;
  padding: 0 13px;
}

.settings-panel > footer .secondary:hover {
  background: var(--hover);
}

.settings-panel > footer .primary {
  color: #fff;
}

@media (max-width: 760px) {
  .field-grid.cols-3,
  .field-grid.cols-2 {
    grid-template-columns: 1fr;
  }
}
</style>
