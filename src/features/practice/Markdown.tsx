import { useMemo, type ReactNode } from 'react'
import { cx } from '@/ui/cx.ts'
import { parseMarkdown, type Block, type Inline } from './markdown.ts'

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'code':
        return (
          <code key={index} className="rounded bg-surface-2 px-1 py-px font-mono text-[0.92em] break-words">
            {node.text}
          </code>
        )
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-fg">
            {renderInline(node.children)}
          </strong>
        )
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2 break-words hover:text-fg-muted">
            {renderInline(node.children)}
          </a>
        )
    }
  })
}

const headingClass = 'font-semibold text-fg'

function renderBlocks(blocks: Block[], headingOffset: number): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'paragraph':
        return <p key={index}>{renderInline(block.children)}</p>
      case 'heading': {
        const Tag = `h${Math.min(6, block.level + headingOffset)}` as 'h3'
        return (
          <Tag key={index} className={headingClass}>
            {renderInline(block.children)}
          </Tag>
        )
      }
      case 'code':
        return (
          <pre key={index} className="overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed">
            <code>{block.text}</code>
          </pre>
        )
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} className="pl-1">
            {renderInline(item.children)}
            {item.blocks.length > 0 ? <div className="mt-1.5 space-y-2">{renderBlocks(item.blocks, headingOffset)}</div> : null}
          </li>
        ))
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start} className="list-decimal space-y-1 pl-5 marker:text-fg-subtle">
            {items}
          </ol>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5 marker:text-fg-subtle">
            {items}
          </ul>
        )
      }
      case 'quote':
        return (
          <blockquote key={index} className="space-y-2 border-l-2 border-line-strong pl-3 text-fg">
            {renderBlocks(block.children, headingOffset)}
          </blockquote>
        )
      case 'rule':
        return <hr key={index} className="border-line" />
    }
  })
}

export interface MarkdownProps {
  /** Markdown from a card, a spec or a story. It is never treated as HTML. */
  children: string
  /** Added to heading levels so a "#" in the text fits under the page's own headings. Default 2 (# becomes h3). */
  headingOffset?: number
  className?: string
}

/** Renders Markdown as React elements. No dangerouslySetInnerHTML: all text goes through React's escaping. */
export function Markdown({ children, headingOffset = 2, className }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(children), [children])
  return <div className={cx('min-w-0 space-y-3 leading-relaxed break-words text-fg', className)}>{renderBlocks(blocks, headingOffset)}</div>
}
