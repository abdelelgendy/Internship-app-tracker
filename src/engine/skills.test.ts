import { describe, expect, it } from 'vitest'
import { samProfile } from './fixtures.ts'
import { canonicalSkill, findSkills, indexProfileSkills, profileLevelFor } from './skills.ts'

describe('canonicalSkill', () => {
  it.each([
    ['postgres', 'PostgreSQL'],
    ['NodeJS', 'Node.js'],
    ['react.js', 'React'],
    ['k8s', 'Kubernetes'],
    ['Tailwind', 'Tailwind CSS'],
    ['Claude Code', null],
  ])('%s -> %s', (raw, expected) => {
    expect(canonicalSkill(raw)).toBe(expected)
  })
})

describe('findSkills', () => {
  it('lists skills in order of first mention', () => {
    expect(findSkills('TypeScript and React, then PostgreSQL. Also React again.')).toEqual(['TypeScript', 'React', 'PostgreSQL'])
  })

  it('does not read English words as tools', () => {
    expect(findSkills('Help the rest of the team react quickly to the next steps in a node graph.')).toEqual([])
  })

  it('does not read the ".js" in Node.js or Next.js as JavaScript', () => {
    expect(findSkills('experience with node.js and next.js?', true)).toEqual(['Node.js', 'Next.js'])
    expect(findSkills('Do you know JS? We use Node.js.', true)).toEqual(['JavaScript', 'Node.js'])
  })

  it('keeps C apart from C++, C#, Series C and the C-suite', () => {
    expect(findSkills('C++ and C# shop, Series C, reports to the C-suite')).toEqual(['C++', 'C#'])
    expect(findSkills('Systems work in C and Rust')).toEqual(['C', 'Rust'])
  })

  it('does not read TS/SCI as TypeScript', () => {
    expect(findSkills('Requires TS/SCI clearance')).toEqual([])
  })

  it('can ignore case for short questions', () => {
    expect(findSkills('experience with react?')).toEqual([])
    expect(findSkills('experience with react?', true)).toEqual(['React'])
  })
})

describe('indexProfileSkills', () => {
  const index = indexProfileSkills(samProfile().skills)

  it('splits "A and B" and keeps known tools in parentheses', () => {
    const git = index.find((entry) => entry.name.startsWith('Git'))
    expect(git?.canonical).toEqual(['Git', 'GitHub'])
    const supabase = index.find((entry) => entry.name.startsWith('Supabase'))
    expect(supabase?.canonical).toEqual(['Supabase', 'PostgreSQL'])
  })

  it('keeps plain phrases for skills the vocabulary does not know', () => {
    const qa = index.find((entry) => entry.name.startsWith('Manual QA'))
    expect(qa?.canonical).toEqual([])
    expect(qa?.phrases).toContain('Manual QA')
  })

  it('takes the best level when two entries cover one tool', () => {
    expect(profileLevelFor(index, 'PostgreSQL')).toBe('working')
    expect(profileLevelFor(index, 'React')).toBe('strong')
    expect(profileLevelFor(index, 'Docker')).toBe('familiar')
    expect(profileLevelFor(index, 'Kubernetes')).toBeNull()
  })
})
