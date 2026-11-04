import { describe, expect, it } from 'vitest'
import { contentProblem, dataFileFormat, idFile, INITIAL_FILES, isIdFolder } from './layout.ts'

describe('dataFileFormat', () => {
  it('knows every contract file the app reads and writes', () => {
    expect(dataFileFormat('profile.json')).toBe('object')
    expect(dataFileFormat('jobs.jsonl')).toBe('jsonl')
    expect(dataFileFormat('applications.jsonl')).toBe('jsonl')
    expect(dataFileFormat('companies.json')).toBe('array')
    expect(dataFileFormat('practice/exercises.json')).toBe('array')
    expect(dataFileFormat('practice/stories.json')).toBe('array')
    expect(dataFileFormat('practice/progress.json')).toBe('object')
    expect(dataFileFormat('practice/decks/react-basics.json')).toBe('object')
    expect(dataFileFormat('covers/1b4e28ba-2fa1-11d2-883f-0016d3cca427.md')).toBe('markdown')
  })

  it('refuses everything else, including the denylist and anything that looks like a path', () => {
    for (const path of [
      'denylist.txt',
      '.gitignore',
      'profile.yaml',
      'practice/decks/../profile.json',
      'practice/decks/a/b.json',
      'practice/decks/.json',
      'practice/decks/x.md',
      'covers/x.json',
      'covers/x y.md',
      '/etc/passwd',
      '',
      'constructor',
      'valueOf',
      'toString',
      'hasOwnProperty',
      '__proto__',
      'constructor/x.json',
      '__proto__/x.md',
    ]) {
      expect(dataFileFormat(path), path).toBeNull()
    }
  })
})

describe('isIdFolder', () => {
  it('accepts only the contract folders, never an Object.prototype name', () => {
    expect(isIdFolder('practice/decks')).toBe(true)
    expect(isIdFolder('covers')).toBe(true)
    for (const name of ['toString', 'constructor', '__proto__', 'practice']) expect(isIdFolder(name), name).toBe(false)
  })
})

describe('idFile', () => {
  it('builds a file name from a slug or UUID and refuses anything else', () => {
    expect(idFile('covers', 'sample-app-02')).toBe('covers/sample-app-02.md')
    expect(idFile('practice/decks', 'deck_1')).toBe('practice/decks/deck_1.json')
    expect(() => idFile('covers', '../profile')).toThrow('Not a valid file id')
    expect(() => idFile('covers', '')).toThrow()
    expect(() => idFile('covers', 'a.b')).toThrow()
  })
})

describe('contentProblem', () => {
  it('checks JSON shape before a write', () => {
    expect(contentProblem('object', '{"a":1}')).toBeNull()
    expect(contentProblem('object', '[]')).toBe('Expected a JSON object')
    expect(contentProblem('object', 'null')).toBe('Expected a JSON object')
    expect(contentProblem('array', '[]')).toBeNull()
    expect(contentProblem('array', '{}')).toBe('Expected a JSON array')
    expect(contentProblem('object', '{ nope')).toBe('Body is not valid JSON')
    expect(contentProblem('markdown', 'anything at all')).toBeNull()
    expect(contentProblem('jsonl', '')).toMatch(/row upserts/)
  })

  it('writes initial files that pass the same checks', () => {
    for (const [file, text] of Object.entries(INITIAL_FILES)) {
      const format = dataFileFormat(file)
      if (format && format !== 'jsonl') expect(contentProblem(format, text), file).toBeNull()
    }
  })
})
