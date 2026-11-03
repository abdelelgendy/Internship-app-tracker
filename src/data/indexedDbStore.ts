import { COLLECTIONS, type Collection, type Contents, type DocStore } from './docStore.ts'

const DB_NAME = 'shortlist-demo'
const DB_VERSION = 1

/** Runs requests in one transaction and settles when it commits, or rejects if anything fails. */
function transact(
  db: IDBDatabase,
  names: readonly Collection[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('The IndexedDB transaction was aborted.'))
    try {
      work(transaction)
    } catch (error) {
      // A value that cannot be stored throws here; abort so earlier writes in the batch are undone.
      transaction.abort()
      reject(error)
    }
  })
}

function storeFor(db: IDBDatabase): DocStore {
  return {
    async getAll(name) {
      let values: unknown[] = []
      await transact(db, [name], 'readonly', (transaction) => {
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => {
          values = request.result
        }
      })
      return values
    },
    async get(name, key) {
      let value: unknown
      await transact(db, [name], 'readonly', (transaction) => {
        const request = transaction.objectStore(name).get(key)
        request.onsuccess = () => {
          value = request.result
        }
      })
      return value
    },
    putMany(name, entries) {
      return transact(db, [name], 'readwrite', (transaction) => {
        const store = transaction.objectStore(name)
        for (const [key, value] of entries) store.put(value, key)
      })
    },
    replaceAll(contents: Contents) {
      return transact(db, COLLECTIONS, 'readwrite', (transaction) => {
        for (const name of COLLECTIONS) {
          const store = transaction.objectStore(name)
          store.clear()
          for (const [key, value] of contents[name] ?? []) store.put(value, key)
        }
      })
    },
  }
}

/**
 * Opens the demo's database. Rejects when IndexedDB is missing, refused, or does not answer
 * within the timeout (another tab can hold an upgrade open), so the caller can fall back.
 */
export function openIndexedDbStore({ timeoutMs = 4000 }: { timeoutMs?: number } = {}): Promise<DocStore> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('IndexedDB did not open in time.')), timeoutMs)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      fail(error)
      return
    }
    request.onupgradeneeded = () => {
      for (const name of COLLECTIONS) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
      }
    }
    request.onerror = () => fail(request.error ?? new Error('IndexedDB refused to open.'))
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        db.close()
        return
      }
      settled = true
      clearTimeout(timer)
      // A newer version of the app in another tab needs this connection closed to upgrade.
      db.onversionchange = () => db.close()
      resolve(storeFor(db))
    }
  })
}
