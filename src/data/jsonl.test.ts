import { describe, expect, it } from 'vitest'
import { readJsonl, rowsProblem, upsertJsonl } from './jsonl.ts'

describe('readJsonl', () => {
  it('returns one row per id, with the last value at the first position', () => {
    const text = '{"id":"a","v":1}\n{"id":"b","v":1}\n{"id":"a","v":2}\n'
    expect(readJsonl<{ id: string; v: number }>(text).rows).toEqual([
      { id: 'a', v: 2 },
      { id: 'b', v: 1 },
    ])
  })

  it('reports unreadable lines with their line numbers and skips blank ones', () => {
    const { rows, issues } = readJsonl('\n{"id":"a"}\nnot json\n[1,2]\n{"name":"no id"}\n{"id":""}\r\n\n')
    expect(rows).toEqual([{ id: 'a' }])
    expect(issues.map((issue) => issue.line)).toEqual([3, 4, 5, 6])
  })

  it('reads Windows line endings', () => {
    expect(readJsonl('{"id":"a"}\r\n{"id":"b"}\r\n').rows).toHaveLength(2)
  })

  it('reads an empty file as no rows', () => {
    expect(readJsonl('')).toEqual({ rows: [], issues: [] })
  })
})

describe('upsertJsonl', () => {
  it('replaces a row in place and appends new rows in the order given', () => {
    const text = '{"id":"a","v":1}\n{"id":"b","v":1}\n'
    expect(upsertJsonl(text, [{ id: 'c' }, { id: 'a', v: 2 }])).toBe('{"id":"a","v":2}\n{"id":"b","v":1}\n{"id":"c"}\n')
  })

  it('drops older copies of an updated id but leaves other duplicates alone', () => {
    const text = '{"id":"a","v":1}\n{"id":"b","v":1}\n{"id":"a","v":2}\n{"id":"b","v":2}\n'
    expect(upsertJsonl(text, [{ id: 'a', v: 3 }])).toBe('{"id":"a","v":3}\n{"id":"b","v":1}\n{"id":"b","v":2}\n')
  })

  it('keeps lines it cannot parse exactly as they were', () => {
    const text = '{"id":"a"}\n{broken\n{"no":"id"}\n'
    expect(upsertJsonl(text, [{ id: 'a', ok: true }])).toBe('{"id":"a","ok":true}\n{broken\n{"no":"id"}\n')
  })

  it('uses the last update when the same id is saved twice in one call', () => {
    expect(upsertJsonl('', [{ id: 'a', v: 1 }, { id: 'a', v: 2 }])).toBe('{"id":"a","v":2}\n')
  })

  it('agrees with readJsonl after any mix of appends and upserts', () => {
    let text = '{"id":"a","v":1}\n'
    text += '{"id":"a","v":2}\n' // a script appended a newer copy
    text = upsertJsonl(text, [{ id: 'b', v: 1 }])
    expect(readJsonl<{ id: string; v: number }>(text).rows).toEqual([
      { id: 'a', v: 2 },
      { id: 'b', v: 1 },
    ])
  })

  it('leaves an empty file empty', () => {
    expect(upsertJsonl('', [])).toBe('')
    expect(upsertJsonl('\n\n', [])).toBe('')
  })
})

describe('rowsProblem', () => {
  it('accepts an array of rows with string ids', () => {
    expect(rowsProblem([{ id: 'a' }, { id: 'b', x: 1 }])).toBeNull()
  })

  it('names the first row without an id', () => {
    expect(rowsProblem({ id: 'a' })).toMatch(/array/)
    expect(rowsProblem([{ id: 'a' }, { id: 2 }])).toBe('Row 1 is not an object with a string "id"')
    expect(rowsProblem([null])).toMatch(/Row 0/)
  })
})
