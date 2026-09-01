// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  parseSwiperSlides,
  serializeSwiperSlides,
  swiperSlideTabTitle,
  withSwiperSlideTitle,
  wrapSlideIndex
} from './swiperSlides'

describe('swiperSlides', () => {
  it('parses markdown image lines and ignores blanks', () => {
    expect(
      parseSwiperSlides('![one](./a.png)\n\n![two](https://cdn.example/b.png)\n\n')
    ).toEqual([
      { alt: 'one', src: './a.png' },
      { alt: 'two', src: 'https://cdn.example/b.png' }
    ])
  })

  it('uses img as the default tab title when alt is empty', () => {
    expect(swiperSlideTabTitle({ alt: '', src: './x.png' })).toBe('img')
    expect(swiperSlideTabTitle({ alt: ' 封面 ', src: './x.png' })).toBe('封面')
  })

  it('renames via alt and round-trips serialize', () => {
    const renamed = withSwiperSlideTitle({ alt: '1', src: './a.png' }, '封面')
    expect(renamed).toEqual({ alt: '封面', src: './a.png' })
    expect(serializeSwiperSlides([renamed, { alt: '', src: './b.png' }])).toBe(
      '![封面](./a.png)\n\n![](./b.png)'
    )
  })

  it('wraps slide indices for prev/next nav', () => {
    expect(wrapSlideIndex(0, 3, -1)).toBe(2)
    expect(wrapSlideIndex(2, 3, 1)).toBe(0)
    expect(wrapSlideIndex(1, 3, 1)).toBe(2)
  })
})
