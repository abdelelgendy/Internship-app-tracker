import { normalizeText, phraseRegex } from './normalize.ts'
import type { Profile, SkillLevel } from './types.ts'

/**
 * The skill vocabulary: one canonical name per technology plus the spellings postings use.
 *
 * An alias with an uppercase letter matches case-sensitively, because the lowercase form is an
 * ordinary English word ("React" the library, "react quickly" the verb; "REST" vs "the rest").
 * Words too ambiguous to match at all ("go", "r", "spring") are left out.
 */
interface SkillDef {
  name: string
  aliases: readonly (string | RegExp)[]
}

// "C" needs its own rule: never inside C++/C#, never "Series C", "Plan C" or "C-suite".
const C_LANGUAGE = /(?<![\p{L}\p{N}+#-])(?<!(?:Series|Plan|Grade|Vitamin|Type|Class) )C(?![\p{L}\p{N}+#-])/u

const VOCABULARY: readonly SkillDef[] = [
  { name: 'JavaScript', aliases: ['javascript', 'JS', 'ecmascript', 'es6'] },
  { name: 'TypeScript', aliases: ['typescript'] },
  { name: 'React', aliases: ['React', 'react.js', 'reactjs'] },
  { name: 'React Native', aliases: ['react native'] },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Vue', aliases: ['Vue', 'vue.js', 'vuejs', 'nuxt'] },
  { name: 'Angular', aliases: ['Angular', 'angularjs'] },
  { name: 'Svelte', aliases: ['svelte', 'sveltekit'] },
  { name: 'Redux', aliases: ['redux'] },
  { name: 'Node.js', aliases: ['Node', 'node.js', 'nodejs'] },
  { name: 'Express', aliases: ['Express', 'express.js', 'expressjs'] },
  { name: 'NestJS', aliases: ['nestjs', 'nest.js'] },
  { name: 'Hono', aliases: ['hono'] },
  { name: 'HTML', aliases: ['html', 'html5'] },
  { name: 'CSS', aliases: ['css', 'css3'] },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss', 'tailwind css'] },
  { name: 'Sass', aliases: ['sass', 'scss'] },
  { name: 'Python', aliases: ['python'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Java', aliases: ['java'] },
  { name: 'Spring Boot', aliases: ['spring boot'] },
  { name: 'Kotlin', aliases: ['kotlin'] },
  { name: 'Swift', aliases: ['Swift', 'swiftui'] },
  { name: 'Go', aliases: ['golang', 'Go lang'] },
  { name: 'Rust', aliases: ['Rust'] },
  { name: 'C', aliases: [C_LANGUAGE] },
  { name: 'C++', aliases: ['c++', 'cpp'] },
  { name: 'C#', aliases: ['c#', 'csharp'] },
  { name: '.NET', aliases: ['.net', 'dotnet', 'asp.net'] },
  { name: 'Ruby', aliases: ['Ruby'] },
  { name: 'Ruby on Rails', aliases: ['ruby on rails', 'Rails'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'Laravel', aliases: ['laravel'] },
  { name: 'Scala', aliases: ['scala'] },
  { name: 'Elixir', aliases: ['elixir'] },
  { name: 'SQL', aliases: ['sql'] },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'psql'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'SQLite', aliases: ['sqlite'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo', 'mongoose'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'DynamoDB', aliases: ['dynamodb'] },
  { name: 'Supabase', aliases: ['supabase'] },
  { name: 'Firebase', aliases: ['firebase'] },
  { name: 'Prisma', aliases: ['prisma'] },
  { name: 'Drizzle ORM', aliases: ['drizzle', 'drizzle orm'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'REST APIs', aliases: ['REST', 'restful', 'rest api', 'rest apis'] },
  { name: 'gRPC', aliases: ['grpc'] },
  { name: 'WebSockets', aliases: ['websocket', 'websockets'] },
  { name: 'OAuth', aliases: ['oauth', 'oauth2'] },
  { name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { name: 'Google Cloud', aliases: ['gcp', 'google cloud', 'google cloud platform'] },
  { name: 'Azure', aliases: ['azure'] },
  { name: 'Vercel', aliases: ['vercel'] },
  { name: 'Cloudflare', aliases: ['cloudflare'] },
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'Terraform', aliases: ['terraform'] },
  { name: 'Linux', aliases: ['linux'] },
  { name: 'Git', aliases: ['git'] },
  { name: 'GitHub', aliases: ['github'] },
  { name: 'GitHub Actions', aliases: ['github actions'] },
  { name: 'CI/CD', aliases: ['ci/cd', 'continuous integration', 'continuous delivery', 'continuous deployment'] },
  { name: 'Jest', aliases: ['jest'] },
  { name: 'Vitest', aliases: ['vitest'] },
  { name: 'Playwright', aliases: ['playwright'] },
  { name: 'Cypress', aliases: ['cypress'] },
  { name: 'Selenium', aliases: ['selenium'] },
  { name: 'pytest', aliases: ['pytest'] },
  { name: 'Vite', aliases: ['vite'] },
  { name: 'Webpack', aliases: ['webpack'] },
  { name: 'Figma', aliases: ['figma'] },
  { name: 'WebAssembly', aliases: ['webassembly', 'wasm'] },
  { name: 'Accessibility', aliases: ['accessibility', 'a11y', 'wcag'] },
  { name: 'Machine learning', aliases: ['machine learning', 'ML'] },
  { name: 'Deep learning', aliases: ['deep learning'] },
  { name: 'LLMs', aliases: ['llm', 'llms', 'large language model', 'large language models'] },
  { name: 'RAG', aliases: ['RAG', 'retrieval-augmented generation', 'retrieval augmented generation'] },
  { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'TensorFlow', aliases: ['tensorflow'] },
  { name: 'pandas', aliases: ['pandas'] },
  { name: 'NumPy', aliases: ['numpy'] },
  { name: 'scikit-learn', aliases: ['scikit-learn', 'sklearn'] },
]

const LEVEL_RANK: Record<SkillLevel, number> = { strong: 3, working: 2, familiar: 1 }

function aliasRegex(alias: string | RegExp, ignoreCase: boolean): RegExp {
  return typeof alias === 'string' ? phraseRegex(alias, !ignoreCase && /[A-Z]/.test(alias)) : alias
}

const BY_ALIAS = new Map<string, string>()
for (const skill of VOCABULARY) {
  BY_ALIAS.set(skill.name.toLowerCase(), skill.name)
  for (const alias of skill.aliases) if (typeof alias === 'string') BY_ALIAS.set(alias.toLowerCase(), skill.name)
}

/** The canonical name for a spelling ("postgres" -> "PostgreSQL"), or null when it is not a known skill. */
export function canonicalSkill(raw: string): string | null {
  return BY_ALIAS.get(normalizeText(raw).toLowerCase()) ?? null
}

function firstIndex(clean: string, skill: SkillDef, ignoreCase: boolean): number {
  let first = -1
  for (const alias of skill.aliases) {
    const index = clean.search(aliasRegex(alias, ignoreCase))
    if (index !== -1 && (first === -1 || index < first)) first = index
  }
  return first
}

/**
 * Canonical names of every known skill the text mentions, in order of first mention.
 * `ignoreCase` is for short text where the subject is clearly a skill, such as a form question
 * typed in lowercase ("experience with react?"); postings keep the case-sensitive rules.
 */
export function findSkills(text: string, ignoreCase = false): string[] {
  const clean = normalizeText(text)
  return VOCABULARY.map((skill) => ({ name: skill.name, index: firstIndex(clean, skill, ignoreCase) }))
    .filter((hit) => hit.index !== -1)
    .sort((a, b) => a.index - b.index)
    .map((hit) => hit.name)
}

export interface ProfileSkill {
  name: string
  level: SkillLevel
  /** Canonical names from the entry's head: what the entry is about. */
  primary: string[]
  /** `primary` plus known tools named in parentheses, which the entry also vouches for. */
  canonical: string[]
  /** Plain phrases for entries the vocabulary does not know, such as "Bunny Stream video and DRM". */
  phrases: string[]
}

/**
 * Splits a profile skill like "PostgreSQL and row-level security" or "Supabase (Postgres, Auth)"
 * into what it covers. The head and its " and " parts count; items in parentheses count only
 * when they are known skills, since they usually describe the head rather than name a tool.
 */
export function indexProfileSkills(skills: Profile['skills']): ProfileSkill[] {
  return skills.map((skill) => {
    const clean = normalizeText(skill.name)
    const head = clean.replace(/\s*\(.*$/, '')
    const inner = clean.match(/\(([^)]*)\)/)?.[1] ?? ''
    const parts = [head, ...head.split(/\s+and\s+|,\s*/)].map((part) => part.trim()).filter(Boolean)
    const canonical = new Set<string>()
    const phrases = new Set<string>()
    for (const part of parts) {
      const name = canonicalSkill(part)
      // "Linux servers" or "Firebase Authentication" name a known tool inside a longer phrase.
      const found = name ? [name] : findSkills(part)
      for (const skillName of found) canonical.add(skillName)
      if (found.length === 0 && part.length >= 3 && part !== head) phrases.add(part)
    }
    if (canonical.size === 0 && head.length >= 3) phrases.add(head)
    const primary = [...canonical]
    for (const item of inner.split(',')) {
      const name = canonicalSkill(item)
      if (name) canonical.add(name)
    }
    return { name: skill.name, level: skill.level, primary, canonical: [...canonical], phrases: [...phrases] }
  })
}

/** The best level the profile claims for a canonical skill, or null when it claims none. */
export function profileLevelFor(index: readonly ProfileSkill[], canonical: string): SkillLevel | null {
  let best: SkillLevel | null = null
  for (const entry of index) {
    if (entry.canonical.includes(canonical) && (best === null || LEVEL_RANK[entry.level] > LEVEL_RANK[best])) {
      best = entry.level
    }
  }
  return best
}
