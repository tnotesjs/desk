<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useWorkspaceStore } from '../stores/workspace'

import type { AppSettings, ImageTokenStatus } from '../../../shared/contracts'

const emit = defineEmits<{ close: [] }>()
const store = useWorkspaceStore()
const draft = ref<AppSettings | null>(
  store.settings ? (JSON.parse(JSON.stringify(store.settings)) as AppSettings) : null
)
const token = ref('')
const clearToken = ref(false)
const tokenStatus = ref<ImageTokenStatus>({ configured: false, encryptionAvailable: false })
const busy = ref(false)
const validationMessage = ref('')
const validationError = ref(false)

const tokenHint = computed(() => {
  if (!tokenStatus.value.encryptionAvailable) return '当前系统暂不可用安全加密存储'
  if (clearToken.value) return '保存后会移除已经保存的 Token'
  if (tokenStatus.value.configured) return '已安全保存；留空不会修改现有 Token'
  return '仅保存在系统加密后的 Desk 私有配置中'
})

function resultValue<T>(
  result: Awaited<ReturnType<typeof window.desk.settings.imageTokenStatus>>
): T {
  if (result.ok) return result.value as T
  throw new Error(result.error.message)
}

async function refreshTokenStatus(): Promise<void> {
  tokenStatus.value = resultValue<ImageTokenStatus>(await window.desk.settings.imageTokenStatus())
}

async function validateGitHub(): Promise<void> {
  if (!draft.value || busy.value) return
  busy.value = true
  validationMessage.value = ''
  validationError.value = false
  try {
    const result = await window.desk.settings.validateImageSettings({
      github: { ...draft.value.imageUpload.github },
      token: token.value.trim() || undefined
    })
    if (!result.ok) throw new Error(result.error.message)
    validationMessage.value = `${result.value.repository} · ${result.value.branch}：${result.value.message}`
  } catch (cause) {
    validationError.value = true
    validationMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  if (!draft.value || busy.value) return
  busy.value = true
  validationMessage.value = ''
  try {
    await store.updateSettings(JSON.parse(JSON.stringify(draft.value)) as AppSettings)
    const secretResult = await window.desk.settings.updateImageToken({
      token: token.value.trim() || undefined,
      clear: clearToken.value
    })
    if (!secretResult.ok) throw new Error(secretResult.error.message)
    tokenStatus.value = secretResult.value
    store.status = '设置已保存'
    emit('close')
  } catch (cause) {
    validationError.value = true
    validationMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refreshTokenStatus().catch((cause) => {
    validationError.value = true
    validationMessage.value = cause instanceof Error ? cause.message : String(cause)
  })
})
</script>

<template>
  <div class="settings-backdrop" @mousedown.self="emit('close')">
    <section v-if="draft" class="settings-panel" aria-label="设置">
      <header>
        <div>
          <span>Desk 设置</span>
          <strong>编辑与集成</strong>
        </div>
        <button type="button" aria-label="关闭设置" @click="emit('close')">×</button>
      </header>

      <div class="settings-scroll">
        <section class="settings-section">
          <div class="section-heading">
            <strong>外观与编辑</strong>
            <span>适用于整个 Desk 工作区</span>
          </div>
          <div class="settings-grid thirds">
            <label>
              <span>主题</span>
              <select v-model="draft.theme">
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label>
              <span>界面密度</span>
              <select v-model="draft.density">
                <option value="comfortable">舒适</option>
                <option value="compact">紧凑</option>
              </select>
            </label>
            <label>
              <span>笔记默认视图</span>
              <select v-model="draft.defaultNoteView">
                <option value="visual">可视化</option>
                <option value="source">源码</option>
              </select>
            </label>
          </div>
          <div class="toggle-row">
            <label class="toggle"
              ><input v-model="draft.autosave.enabled" type="checkbox" />自动保存</label
            >
            <label class="inline-field">
              <span>等待时间</span>
              <input
                v-model.number="draft.autosave.delayMs"
                type="number"
                min="250"
                max="30000"
                step="250"
              />
              <span>ms</span>
            </label>
            <label class="toggle"
              ><input v-model="draft.prettier" type="checkbox" />按 Core 规则格式化</label
            >
          </div>
        </section>

        <section class="settings-section">
          <div class="section-heading">
            <strong>外部工具</strong>
            <span>冲突处理和右键快捷入口会使用这里的 IDE</span>
          </div>
          <div class="settings-grid thirds">
            <label>
              <span>默认 IDE</span>
              <select v-model="draft.ide">
                <option value="vscode">VSCode</option>
                <option value="cursor">Cursor</option>
              </select>
            </label>
            <label>
              <span>Git 可执行文件（可选）</span>
              <input v-model="draft.gitPath" placeholder="自动检测" />
            </label>
            <label>
              <span>Node 可执行文件（可选）</span>
              <input v-model="draft.nodePath" placeholder="自动检测" />
            </label>
          </div>
          <label class="toggle">
            <input v-model="draft.confirmBeforeCommit" type="checkbox" />提交前再次弹窗确认变更
          </label>
        </section>

        <section class="settings-section image-settings">
          <div class="section-heading">
            <strong>图片处理与 GitHub 图床</strong>
            <span>图床上传失败时始终自动回退到当前笔记的 assets 目录</span>
          </div>

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

          <div class="settings-grid two-columns">
            <label>
              <span>仓库</span>
              <input
                v-model="draft.imageUpload.github.repository"
                placeholder="tnotesjs/imgs-2026 或 GitHub 地址"
              />
            </label>
            <label>
              <span>分支</span>
              <input v-model="draft.imageUpload.github.branch" placeholder="main" />
            </label>
            <label>
              <span>仓库内路径</span>
              <input v-model="draft.imageUpload.github.path" placeholder="/" />
            </label>
            <label>
              <span>文件名格式</span>
              <input
                v-model="draft.imageUpload.github.fileNameFormat"
                placeholder="${YY}-${MM}-${DD}-${HH}-${mm}-${ss}"
              />
            </label>
          </div>
          <label class="wide-field">
            <span>CDN 模板</span>
            <input v-model="draft.imageUpload.github.cdnTemplate" />
            <small>支持 ${username}、${repository}、${branch}、${filepath}</small>
          </label>
          <label class="wide-field">
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
            />
            <small>{{ tokenHint }}</small>
          </label>
          <div class="token-actions">
            <label v-if="tokenStatus.configured" class="toggle danger-toggle">
              <input v-model="clearToken" type="checkbox" />移除已保存的 Token
            </label>
            <button
              type="button"
              class="validate"
              :disabled="busy || clearToken"
              @click="validateGitHub"
            >
              验证 GitHub 配置
            </button>
          </div>
          <p v-if="validationMessage" class="validation" :class="{ error: validationError }">
            {{ validationMessage }}
          </p>
        </section>
      </div>

      <footer>
        <span>Token 不会写入 settings.v1.json，也不会显示原值。</span>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="busy" @click="save">保存设置</button>
      </footer>
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

@media (max-width: 760px) {
  .settings-grid.thirds,
  .settings-grid.two-columns {
    grid-template-columns: 1fr;
  }
}
</style>
