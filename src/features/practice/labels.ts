import type { CardKind, PracticeCard } from '@/engine/types.ts'

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  concept: 'Concept',
  explain: 'Explain the code',
  design: 'Design decision',
  behavioral: 'Behavioral',
  code: 'Code',
  dsa: 'Algorithms',
  'system-design': 'System design',
  'ai-workflow': 'AI workflow',
}

export const DIFFICULTY_LABEL: Record<PracticeCard['difficulty'], string> = {
  1: 'Basic',
  2: 'Intermediate',
  3: 'Advanced',
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "45 min" or "1 h 30 min". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}
