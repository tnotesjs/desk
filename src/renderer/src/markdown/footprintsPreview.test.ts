import { describe, expect, it } from 'vitest'
import { parseFootprintsSource, type FootprintsPayload } from '@tnotesjs/ui'
import { rebuildContainerSource, parseContainerSource } from '../editor/markdown/containerBody'
import { resolveMarkdownImageUrl } from './markdownAssetUrl'

/** Mirrors MilkdownMarkdownEditor footprints preview mapping. */
function resolveFootprintsPreview(
  source: string,
  knowledgeBaseId: string,
  noteUuid: string
): FootprintsPayload {
  const payload = parseFootprintsSource(source)
  return {
    ...payload,
    images: payload.images.map((src) =>
      resolveMarkdownImageUrl(src, knowledgeBaseId, noteUuid)
    )
  }
}

describe('Footprints Desk preview mapping', () => {
  const source = `::: footprints 2025-03-15 00:43

正在整理文档

不早了

![img](./assets/1.png)

![img](./assets/2.png)

:::
`

  it('resolves relative images for preview while parse keeps source paths', () => {
    const raw = parseFootprintsSource(source)
    expect(raw.images).toEqual(['./assets/1.png', './assets/2.png'])
    expect(raw.paragraphs).toEqual(['正在整理文档', '不早了'])
    expect(raw.times).toEqual([2025, 3, 15, 0, 43])

    const preview = resolveFootprintsPreview(source, 'kb-1', 'note-1')
    expect(preview.paragraphs).toEqual(raw.paragraphs)
    expect(preview.times).toEqual(raw.times)
    for (const url of preview.images) {
      const parsed = new URL(url)
      expect(parsed.protocol).toBe('tnotes-asset:')
      expect(parsed.searchParams.get('knowledgeBaseId')).toBe('kb-1')
      expect(parsed.searchParams.get('noteUuid')).toBe('note-1')
    }
    expect(new URL(preview.images[0]!).searchParams.get('path')).toBe('./assets/1.png')
  })

  it('keeps fence datetime when only body is rebuilt (structured edit)', () => {
    const parsed = parseContainerSource(source)
    expect(parsed.name).toBe('footprints')
    expect(parsed.title).toBe('2025-03-15 00:43')

    const next = rebuildContainerSource(source, {
      title: parsed.title,
      body: '新的一段\n\n![x](./assets/3.png)',
      name: parsed.name
    })
    expect(next.startsWith('::: footprints 2025-03-15 00:43')).toBe(true)
    const again = parseFootprintsSource(next)
    expect(again.times).toEqual([2025, 3, 15, 0, 43])
    expect(again.paragraphs).toEqual(['新的一段'])
    expect(again.images).toEqual(['./assets/3.png'])
  })
})
