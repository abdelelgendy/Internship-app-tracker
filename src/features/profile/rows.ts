/**
 * Stable React keys for rows in the profile editor's lists (skills, answers, facts). Rows have no
 * reliable id of their own while being edited, and index keys would move focus and open/closed
 * state to the wrong row when a row is removed or moved. Every edit goes through these helpers,
 * which carry a row's key over to its edited copy.
 */
const keys = new WeakMap<object, string>()
let next = 0

export function rowKey(row: object): string {
  let key = keys.get(row)
  if (key === undefined) {
    next += 1
    key = `row-${next}`
    keys.set(row, key)
  }
  return key
}

export function replaceRow<T extends object>(rows: readonly T[], index: number, row: T): T[] {
  keys.set(row, rowKey(rows[index]))
  return rows.map((current, position) => (position === index ? row : current))
}

export function removeRow<T>(rows: readonly T[], index: number): T[] {
  return rows.filter((_, position) => position !== index)
}

export function moveRow<T>(rows: readonly T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset
  if (target < 0 || target >= rows.length) return [...rows]
  const moved = [...rows]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]
  return moved
}
