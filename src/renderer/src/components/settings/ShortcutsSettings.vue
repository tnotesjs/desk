<script setup lang="ts">
import { computed } from 'vue'

import { TN_NOTES_SLASH_ITEMS } from '../../markdown/slashMenu'
import {
  MARKDOWN_BLOCK_SHORTCUTS,
  MARKDOWN_INLINE_SHORTCUTS
} from '../../markdown/markdownInputRules'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
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
  },
  {
    title: 'Markdown 快速输入',
    items: [
      ...TN_NOTES_SLASH_ITEMS.map((item) => [
        `${item.label} · ${item.keywords.join(', ')}`,
        item.shortcut
      ]),
      ...MARKDOWN_BLOCK_SHORTCUTS.map((item) => [
        `${item.label} · ${[item.syntax, ...item.aliases].join(' / ')}`,
        item.trigger
      ]),
      ...MARKDOWN_INLINE_SHORTCUTS.map((item) => [item.label + ' · ' + item.syntax, item.trigger])
    ]
  }
])
</script>

<template>
  <section class="settings-section">
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
</template>

<style src="./settingsShared.css" scoped></style>

<style scoped>
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

.shortcut-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.45;
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
