import { describe, expect, it } from 'vitest'

import {
  collapseEmptyGroups,
  createGroup,
  cycleTab,
  findGroup,
  findTab,
  insertTab,
  listGroups,
  removeTab,
  setSplitRatio,
  splitGroupWithTab,
  tabAtNumber,
  activateTab
} from './layoutModel'

import type { EditorTab } from '../../../shared/contracts'

function webTab(id: string): EditorTab {
  return { id, type: 'web', url: `https://example.com/${id}`, title: id }
}

describe('editor layout model', () => {
  it('numbers tabs within each group without changing the other group', () => {
    const left = createGroup(['left-1', 'left-2', 'left-3'].map(webTab))
    const split = splitGroupWithTab(left, left.id, 'right', webTab('right-1'))
    let layout = split.layout
    for (const id of ['right-2', 'right-3', 'right-4']) {
      layout = insertTab(layout, split.groupId, webTab(id))
    }
    layout = activateTab(layout, left.id, 'left-2')
    for (const number of [1, 3]) {
      const target = tabAtNumber(findGroup(layout, left.id)!, number)!
      layout = activateTab(layout, left.id, target.id)
      expect(findGroup(layout, left.id)?.activeTabId).toBe(`left-${number}`)
      expect(findGroup(layout, split.groupId)?.activeTabId).toBe('right-4')
    }
    const target = tabAtNumber(findGroup(layout, split.groupId)!, 2)!
    layout = activateTab(layout, split.groupId, target.id)
    expect(findGroup(layout, split.groupId)?.activeTabId).toBe('right-2')
    expect(findGroup(layout, left.id)?.activeTabId).toBe('left-3')
    expect(tabAtNumber(findGroup(layout, left.id)!, 4)).toBeNull()
  })

  it('uses display order including pinned tabs and follows reordering without changing pin state', () => {
    const group = createGroup([
      webTab('regular-1'),
      { ...webTab('pinned-1'), pinned: true },
      webTab('regular-2'),
      { ...webTab('pinned-2'), pinned: true }
    ])
    expect([1, 2, 3, 4].map((number) => tabAtNumber(group, number)?.id)).toEqual([
      'pinned-1',
      'pinned-2',
      'regular-1',
      'regular-2'
    ])
    group.tabs.reverse()
    expect([1, 2, 3, 4].map((number) => tabAtNumber(group, number)?.id)).toEqual([
      'pinned-2',
      'pinned-1',
      'regular-2',
      'regular-1'
    ])
    expect(group.tabs.filter((tab) => tab.pinned)).toHaveLength(2)
  })

  it('ignores invalid numbers and missing tabs; nine means ninth, not last', () => {
    const group = createGroup(Array.from({ length: 10 }, (_, i) => webTab(String(i + 1))))
    expect(tabAtNumber(group, 9)?.id).toBe('9')
    for (const number of [0, -1, 1.5, 10, NaN, Infinity]) {
      expect(tabAtNumber(group, number)).toBeNull()
    }
    expect(tabAtNumber(createGroup(), 1)).toBeNull()
    expect(tabAtNumber(createGroup([webTab('only')]), 2)).toBeNull()
  })

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

  it('cycles active tabs in both directions and wraps at the ends', () => {
    const group = createGroup([webTab('one'), webTab('two'), webTab('three')])

    const previous = cycleTab(group, group.id, 'previous')
    expect(findGroup(previous, group.id)?.activeTabId).toBe('three')

    const next = cycleTab(previous, group.id, 'next')
    expect(findGroup(next, group.id)?.activeTabId).toBe('one')
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
