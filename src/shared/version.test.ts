import { describe, expect, it } from 'vitest'

import { compareVersions, parseVersion } from './version'

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseVersion('0.2.1')).toEqual([0, 2, 1])
    expect(parseVersion('v1.10.3')).toEqual([1, 10, 3])
  })

  it('pads short versions and strips prerelease suffixes', () => {
    expect(parseVersion('1.2')).toEqual([1, 2, 0])
    expect(parseVersion('v1.2.3-beta.1')).toEqual([1, 2, 3])
  })

  it('rejects malformed versions', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('v')).toBeNull()
    expect(parseVersion('1.x.0')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('0.2.1', '0.2.0')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('v0.2.1', '0.2.1')).toBe(0)
    expect(compareVersions('0.2.0', '0.2.1')).toBe(-1)
  })
})
