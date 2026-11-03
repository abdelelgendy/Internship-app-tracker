import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown.tsx'
import { parseInline, parseMarkdown } from './markdown.ts'

function renderMarkdown(text: string) {
  return render(<Markdown>{text}</Markdown>).container
}

describe('Markdown', () => {
  it('renders paragraphs, bold, italic and inline code', () => {
    const container = renderMarkdown('First **bold** and *italic* with `code`.\nSame paragraph.\n\nSecond paragraph.')
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('First bold and italic with code. Same paragraph.')
    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelector('em')).toHaveTextContent('italic')
    expect(container.querySelector('code')).toHaveTextContent('code')
  })

  it('keeps snake_case words and lone stars as text', () => {
    expect(parseInline('call my_var_name and 5 * 3 * 2')).toEqual([{ type: 'text', text: 'call my_var_name and 5 * 3 * 2' }])
    expect(parseInline('**not closed')).toEqual([{ type: 'text', text: '**not closed' }])
  })

  it('does not read emphasis inside code spans', () => {
    expect(parseInline('**use `a**b` here**')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'use ' }, { type: 'code', text: 'a**b' }, { type: 'text', text: ' here' }] },
    ])
  })

  it('renders bullet and numbered lists, nested by indentation', () => {
    const container = renderMarkdown('1. Read the posting\n2. Score it\n   - title\n   - skills\n3. Decide\n\n- one\n- two')
    const ordered = container.querySelector('ol') as HTMLOListElement
    expect(ordered.children).toHaveLength(3)
    expect(ordered.querySelector('ul')?.children).toHaveLength(2)
    expect(ordered.children[1]).toHaveTextContent('Score it')
    const lists = container.querySelectorAll(':scope > div > ul')
    expect(lists).toHaveLength(1)
    expect(lists[0].children).toHaveLength(2)
  })

  it('keeps an ordered list start number', () => {
    const blocks = parseMarkdown('3. third\n4. fourth')
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })

  it('renders fenced code blocks verbatim', () => {
    const container = renderMarkdown('Before\n\n```ts\nconst a = **b** < 3\n\n// <b>not bold</b>\n```\n\nAfter')
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('const a = **b** < 3\n\n// <b>not bold</b>')
    expect(pre?.querySelector('b, strong')).toBeNull()
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders block quotes and safe links', () => {
    const container = renderMarkdown('> Quoted **answer**\n\nSee [Two Sum](https://leetcode.com/problems/two-sum/).')
    expect(container.querySelector('blockquote')).toHaveTextContent('Quoted answer')
    const link = screen.getByRole('link', { name: 'Two Sum' })
    expect(link).toHaveAttribute('href', 'https://leetcode.com/problems/two-sum/')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror="alert(1)">', 'img'],
    ['<iframe src="https://example.com"></iframe>', 'iframe'],
    ['**<svg onload=alert(1)>**', 'svg'],
    ['`<style>body{display:none}</style>`', 'style'],
  ])('shows HTML as text: %s', (attack, tag) => {
    const container = renderMarkdown(attack)
    expect(container.querySelector(tag)).toBeNull()
    expect(container.textContent).toContain(attack.replace(/\*\*|`/g, ''))
  })

  it.each([
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[click](vbscript:msgbox(1))',
    '[click](/relative/path)',
    '[click](https://example.com" onclick="alert(1))',
  ])('never links an unsafe address: %s', (attack) => {
    const container = renderMarkdown(attack)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[onclick]')).toBeNull()
    expect(container.textContent).toContain('click')
  })

  it('escapes HTML in headings, list items and quotes too', () => {
    const container = renderMarkdown('# <b>Title</b>\n\n- <a href="javascript:alert(1)">item</a>\n\n> <img src=x>')
    expect(container.querySelector('b, a, img')).toBeNull()
    expect(container.querySelector('h3')).toHaveTextContent('<b>Title</b>')
  })
})
