import { describe, expect, it } from 'vitest'

import {
  collapseEmptyGroups,
  createGroup,
  findGroup,
  findTab,
  insertTab,
  listGroups,
  removeTab,
  setSplitRatio,
  splitGroupWithTab
} from './layoutModel'

import type { EditorTab } from '../../../shared/contracts'

function webTab(id: string): EditorTab {
  return { id, type: 'web', url: `https://example.com/${id}`, title: id }
}

describe('editor layout model', () => {
  it('inserts, activates and removes tabs without losing the neighboring active tab', () => {
    const group = createGroup([webTab('one')])
    const withSecond = insertTab(group, group.id, webTab('two'))
    expect(findGroup(withSecond, group.id)?.activeTabId).toBe('two')

    const withoutSecond = removeTab(withSecond, group.id, 'two')
    expect(findGroup(withoutSecond, group.id)?.activeTabId).toBe('one')
    expect(findTab(withoutSecond, 'one')?.group.id).toBe(group.id)
  })

  it('creates horizontal and vertical split trees and clamps ratios', () => {
    const group = createGroup([webTab('one')])
    const right = splitGroupWithTab(group, group.id, 'right', webTab('two'))
    expect(right.layout.type).toBe('split')
    expect(right.layout.type === 'split' && right.layout.direction).toBe('horizontal')
    expect(listGroups(right.layout)).toHaveLength(2)

    if (right.layout.type !== 'split') throw new Error('expected split')
    const resized = setSplitRatio(right.layout, right.layout.id, 0.99)
    expect(resized.type === 'split' && resized.ratio).toBe(0.85)

    const bottom = splitGroupWithTab(right.layout, right.groupId, 'bottom', webTab('three'))
    expect(listGroups(bottom.layout)).toHaveLength(3)
  })

  it('collapses empty leaves after the last tab moves away', () => {
    const group = createGroup([webTab('one')])
    const split = splitGroupWithTab(group, group.id, 'right', webTab('two'))
    const emptied = removeTab(split.layout, group.id, 'one')
    const collapsed = collapseEmptyGroups(emptied)
    expect(collapsed.type).toBe('group')
    expect(listGroups(collapsed)[0].tabs.map((tab) => tab.id)).toEqual(['two'])
  })
})
