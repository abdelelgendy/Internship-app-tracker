import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './nav.ts'

describe('navigation shortcuts', () => {
  it('gives every page a different single lowercase letter', () => {
    const keys = NAV_ITEMS.map((item) => item.shortcut)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^[a-z]$/)
  })

  it('never uses g, which starts every sequence', () => {
    expect(NAV_ITEMS.some((item) => item.shortcut === 'g')).toBe(false)
  })
})
