const RESOURCE_SCHEME = /^[a-z][a-z\d+.-]*:/i
const SAFE_RASTER_DATA = /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,[a-z\d+/\s]*={0,2}$/i
const MAX_INLINE_IMAGE_SOURCE_LENGTH = 7_000_000

/**
 * Maps a note-local Markdown image to Desk's guarded asset protocol.
 *
 * The ProseMirror node keeps `source` unchanged; this URL is only used by its DOM view.
 */
export function resolveMarkdownImageUrl(
  source: string,
  knowledgeBaseId: string,
  noteUuid: string
): string {
  if (!source) return ''
  if (source.startsWith('https://')) return source
  if (
    source.length <= MAX_INLINE_IMAGE_SOURCE_LENGTH &&
    source.startsWith('data:') &&
    SAFE_RASTER_DATA.test(source)
  ) {
    return source
  }
  // Internal, executable and renderer-relative schemes must never be trusted from note text.
  if (RESOURCE_SCHEME.test(source) || source.startsWith('//') || source.startsWith('#')) return ''
  const params = new URLSearchParams({
    knowledgeBaseId,
    noteUuid,
    path: source.split(/[?#]/, 1)[0]
  })
  return `tnotes-asset://asset?${params.toString()}`
}
