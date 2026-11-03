/**
 * A small Markdown parser for practice cards and exercise specs. It returns a tree that
 * Markdown.tsx renders as React elements, so nothing in the text is ever read as HTML: a
 * "<script>" in a card is shown as the characters "<script>".
 *
 * Supported: paragraphs, headings, bullet and numbered lists (nested by indentation), block
 * quotes, fenced code blocks, horizontal rules, inline code, bold, italic and links. Links are
 * kept only for http, https and mailto addresses; any other link is shown as its text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }

export interface ListItem {
  children: Inline[]
  /** Indented content under the item: a nested list, a code block, more paragraphs. */
  blocks: Block[]
}

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}> ?/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** The address if it is safe to link to, otherwise null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol) ? href : null
  } catch {
    return null
  }
}

function indentOf(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4
    else break
  }
  return width
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line)
}

// ---------- Inline ----------

/** The index of the backtick run of exactly `length` that closes a code span, or -1. */
function closingTicks(text: string, from: number, length: number): number {
  let index = from
  while (index < text.length) {
    const start = text.indexOf('`', index)
    if (start === -1) return -1
    let end = start
    while (text[end] === '`') end += 1
    if (end - start === length) return start
    index = end
  }
  return -1
}

/** The index where `delimiter` closes, skipping code spans and longer runs of the same character, or -1. */
function findClosing(text: string, from: number, delimiter: string): number {
  let index = from
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '`') {
      let end = index
      while (text[end] === '`') end += 1
      const close = closingTicks(text, end, end - index)
      index = close === -1 ? end : close + (end - index)
      continue
    }
    if (char !== delimiter[0]) {
      index += 1
      continue
    }
    if (delimiter === ']') return index
    let end = index
    while (text[end] === char) end += 1
    const run = end - index
    const after = text[end] ?? ''
    const before = text[index - 1] ?? ' '
    if (run === delimiter.length && before !== ' ' && (char !== '_' || !/[\p{L}\p{N}]/u.test(after))) return index
    index = end
  }
  return -1
}

/** "[text](url)" starting at `start`: the text, the url and where it ends, or null. */
function readLink(text: string, start: number): { label: string; url: string; end: number } | null {
  const close = findClosing(text, start + 1, ']')
  if (close === -1 || text[close + 1] !== '(') return null
  let depth = 0
  for (let index = close + 2; index < text.length; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) return null
    if (char === '(') depth += 1
    if (char === ')') {
      if (depth === 0) return { label: text.slice(start + 1, close), url: text.slice(close + 2, index), end: index + 1 }
      depth -= 1
    }
  }
  return null
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer })
    buffer = ''
  }
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '\\' && next !== undefined && /[\\`*_[\]()#+\-.!>~|{}]/.test(next)) {
      buffer += next
      index += 2
      continue
    }

    if (char === '`') {
      let end = index
      while (text[end] === '`') end += 1
      const length = end - index
      const close = closingTicks(text, end, length)
      if (close === -1) {
        buffer += text.slice(index, end)
        index = end
        continue
      }
      let code = text.slice(end, close)
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1)
      flush()
      out.push({ type: 'code', text: code })
      index = close + length
      continue
    }

    if (char === '[') {
      const link = readLink(text, index)
      if (link) {
        flush()
        const children = parseInline(link.label)
        const href = safeHref(link.url)
        if (href) out.push({ type: 'link', href, children })
        else out.push(...children)
        index = link.end
        continue
      }
    }

    if ((char === '*' || char === '_') && next === char && text[index + 2] !== ' ') {
      const delimiter = char + char
      const opens = char === '*' || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '')
      const close = opens ? findClosing(text, index + 3, delimiter) : -1
      if (close !== -1) {
        flush()
        out.push({ type: 'strong', children: parseInline(text.slice(index + 2, close)) })
        index = close + 2
      } else {
        buffer += delimiter
        index += 2
      }
      continue
    }

    if ((char === '*' || char === '_') && next !== undefined && next !== ' ' && next !== char) {
      const opens = char === '*' || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '')
      const close = opens ? findClosing(text, index + 2, char) : -1
      if (close !== -1) {
        flush()
        out.push({ type: 'em', children: parseInline(text.slice(index + 1, close)) })
        index = close + 1
        continue
      }
    }

    buffer += char
    index += 1
  }
  flush()
  return out
}

// ---------- Blocks ----------

function dedent(lines: string[]): string[] {
  const widths = lines.filter((line) => line.trim() !== '').map(indentOf)
  const width = widths.length > 0 ? Math.min(...widths) : 0
  return lines.map((line) => line.slice(Math.min(width, line.length - line.trimStart().length)))
}

function parseList(lines: string[], start: number): { block: Extract<Block, { type: 'list' }>; next: number } {
  const first = LIST_ITEM.exec(lines[start]) as RegExpExecArray
  const indent = indentOf(first[1])
  const ordered = /\d/.test(first[2])
  const items: { text: string; childLines: string[] }[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index]
    const match = LIST_ITEM.exec(line)
    const lineIndent = indentOf(line)
    const current = items[items.length - 1]
    if (match && lineIndent === indent && /\d/.test(match[2]) === ordered) {
      items.push({ text: match[3], childLines: [] })
    } else if (line.trim() === '') {
      // A blank line ends the list unless the list goes on after it.
      const after = lines.slice(index + 1).find((candidate) => candidate.trim() !== '')
      if (after === undefined || indentOf(after) < indent || (indentOf(after) === indent && !LIST_ITEM.test(after))) break
      if (current.childLines.length > 0) current.childLines.push('')
    } else if (lineIndent > indent && (current.childLines.length > 0 || startsBlock(line.trimStart()))) {
      current.childLines.push(line)
    } else if (lineIndent > indent || !startsBlock(line)) {
      // A wrapped line of the item's own text.
      if (current.childLines.length > 0) current.childLines.push(line)
      else current.text += ` ${line.trim()}`
    } else {
      break
    }
    index += 1
  }
  return {
    block: {
      type: 'list',
      ordered,
      start: ordered ? Number.parseInt(first[2], 10) : 1,
      items: items.map(({ text, childLines }) => ({ children: parseInline(text), blocks: parseLines(dedent(childLines)) })),
    },
    next: index,
  }
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') })
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(heading[2]) })
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (index < lines.length && lines[index].trim() !== '' && (QUOTE.test(lines[index]) || !startsBlock(lines[index]))) {
        body.push(lines[index].replace(QUOTE, ''))
        index += 1
      }
      blocks.push({ type: 'quote', children: parseLines(body) })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, index)
      blocks.push(block)
      index = next
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() !== '' && (paragraph.length === 0 || !startsBlock(lines[index]))) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }
  return blocks
}

export function parseMarkdown(markdown: string): Block[] {
  return parseLines(markdown.replace(/\r\n?/g, '\n').split('\n'))
}
