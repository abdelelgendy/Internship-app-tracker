/**
 * The storage under the browser repo: named collections of values by string key.
 * IndexedDB backs it in the public demo; a Map backs it in tests and in browsers that
 * refuse IndexedDB (some private windows).
 */

export const COLLECTIONS = ['jobs', 'applications', 'decks', 'covers', 'docs'] as const
export type Collection = (typeof COLLECTIONS)[number]

export type Entries = readonly (readonly [key: string, value: unknown])[]
export type Contents = Partial<Record<Collection, Entries>>

export interface DocStore {
  /** Every value in the collection, in key order. */
  getAll(collection: Collection): Promise<unknown[]>
  get(collection: Collection, key: string): Promise<unknown>
  /** Writes the entries in one transaction. */
  putMany(collection: Collection, entries: Entries): Promise<void>
  /** Clears every collection and writes the contents, all or nothing. */
  replaceAll(contents: Contents): Promise<void>
}

/** Values are copied in and out, like IndexedDB does, so callers cannot change stored data by accident. */
export function createMemoryStore(): DocStore {
  const data = new Map<Collection, Map<string, unknown>>(COLLECTIONS.map((name) => [name, new Map()]))
  const collection = (name: Collection) => data.get(name) as Map<string, unknown>
  const write = (contents: Contents) => {
    for (const [name, entries] of Object.entries(contents) as [Collection, Entries][]) {
      for (const [key, value] of entries) collection(name).set(key, structuredClone(value))
    }
  }

  return {
    async getAll(name) {
      return [...collection(name).entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, value]) => structuredClone(value))
    },
    async get(name, key) {
      return structuredClone(collection(name).get(key))
    },
    async putMany(name, entries) {
      write({ [name]: entries })
    },
    async replaceAll(contents) {
      for (const map of data.values()) map.clear()
      write(contents)
    },
  }
}
