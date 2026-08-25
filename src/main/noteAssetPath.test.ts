import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolvePathInsideDirectory } from './noteAssetPath'

const temporaryDirectories: string[] = []

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-note-asset-'))
  temporaryDirectories.push(root)
  await fs.mkdir(path.join(root, 'assets'))
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('resolvePathInsideDirectory', () => {
  it('prefers a literal percent filename before trying one decoded fallback', async () => {
    const root = await fixture()
    const literal = path.join(root, 'assets', '100%20.png')
    const spaced = path.join(root, 'assets', '100 .png')
    await fs.writeFile(literal, 'literal')
    await fs.writeFile(spaced, 'spaced')
    const literalRealPath = await fs.realpath(literal)
    const spacedRealPath = await fs.realpath(spaced)

    await expect(resolvePathInsideDirectory(root, './assets/100%20.png')).resolves.toBe(
      literalRealPath
    )
    await fs.unlink(literal)
    await expect(resolvePathInsideDirectory(root, './assets/100%20.png')).resolves.toBe(
      spacedRealPath
    )
  })

  it('decodes Chinese and spaces only when the raw path does not exist', async () => {
    const root = await fixture()
    const image = path.join(root, 'assets', '中文 图片.png')
    await fs.writeFile(image, 'image')
    const imageRealPath = await fs.realpath(image)

    await expect(
      resolvePathInsideDirectory(root, './assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png')
    ).resolves.toBe(imageRealPath)
  })

  it('rejects traversal, encoded traversal, git internals and symlink escapes', async () => {
    const root = await fixture()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-note-outside-'))
    temporaryDirectories.push(outside)
    const outsideImage = path.join(outside, 'image.png')
    await fs.writeFile(outsideImage, 'outside')
    await fs.symlink(outside, path.join(root, 'assets', 'escape'))
    const traversal = path.relative(root, outsideImage)

    await expect(resolvePathInsideDirectory(root, traversal)).rejects.toThrow(
      '引用路径超出当前笔记目录'
    )
    await expect(resolvePathInsideDirectory(root, encodeURIComponent(traversal))).rejects.toThrow(
      '引用路径超出当前笔记目录'
    )
    await expect(resolvePathInsideDirectory(root, './.GIT/config')).rejects.toThrow('引用路径无效')
    await expect(resolvePathInsideDirectory(root, './assets/escape/image.png')).rejects.toThrow(
      '引用路径超出当前笔记目录'
    )
  })
})
