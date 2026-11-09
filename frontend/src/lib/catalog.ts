import type { RunRequest } from '../api/types'

export const DEFAULT_NEMO_URL = 'https://nemo-shield-api.onrender.com'
export const ORIGINAL = 'original'

export interface MutatorGuide {
  title: string
  /** What it does, in plain words. */
  plain: string
  /** What weakness it probes. */
  why: string
  /** Variants the backend produces per prompt (used for size estimates). */
  variants: number
}

export const MUTATOR_GUIDE: Record<string, MutatorGuide> = {
  leetspeak: {
    title: 'Leetspeak',
    plain: "Swaps letters for look-alike numbers, so 'ignore' becomes '1gn0r3'.",
    why: 'Catches filters that only match the exact spelling of bad words.',
    variants: 1,
  },
  case_jitter: {
    title: 'Mixed capitals',
    plain: "Scrambles upper and lower case, like 'iGnOrE'.",
    why: 'Catches filters that forget to ignore capital letters.',
    variants: 2,
  },
  homoglyph: {
    title: 'Look-alike letters',
    plain: 'Replaces normal letters with Cyrillic twins. Identical to a person, completely different to a computer.',
    why: 'Tests whether text is normalised before it is checked.',
    variants: 1,
  },
  zero_width: {
    title: 'Invisible characters',
    plain: "Hides invisible characters inside every word, so 'ignore' is no longer one word to a computer.",
    why: 'Tests whether hidden characters are stripped before checking.',
    variants: 2,
  },
  base64_wrapper: {
    title: 'Base64 encoding',
    plain: 'Encodes the request as Base64 and asks the model to decode it and follow it.',
    why: 'Tests whether the guard looks inside encoded content.',
    variants: 3,
  },
  crescendo_framing: {
    title: 'Innocent framing',
    plain: 'Wraps the request in a research paper, screenplay or debugging story.',
    why: 'Tests whether a harmless-looking story talks the guard out of blocking.',
    variants: 3,
  },
}

export const MUTATOR_ORDER = Object.keys(MUTATOR_GUIDE)

export const MUTATOR_CATEGORY_GUIDE: Record<string, { label: string; plain: string }> = {
  typographic: { label: 'Spelling tricks', plain: 'Change how words are spelled.' },
  unicode: { label: 'Hidden characters', plain: 'Change the characters themselves.' },
  encoding: { label: 'Encoding', plain: 'Hide the request inside an encoded blob.' },
  framing: { label: 'Storytelling', plain: 'Surround the request with harmless context.' },
}

export const SUITE_GUIDE: Record<string, { title: string; plain: string; expect: 'block' | 'allow' }> = {
  owasp_llm_top10: {
    title: 'Attack prompts',
    plain:
      'Known attack patterns from the OWASP LLM Top 10: prompt injection, system-prompt leaks, jailbreaks and personal-data extraction. A good guard blocks every one.',
    expect: 'block',
  },
  benign_controls: {
    title: 'Everyday requests',
    plain:
      'Ordinary business questions: support, summaries, code, general knowledge. A good guard lets every one through. Any block here is a false alarm.',
    expect: 'allow',
  },
}

export const SEED_CATEGORY_LABELS: Record<string, string> = {
  prompt_injection: 'Prompt injection',
  system_prompt_leakage: 'System prompt leak',
  jailbreak: 'Jailbreak',
  pii_extraction: 'Personal data extraction',
  customer_support: 'Customer support',
  summarization: 'Summarization',
  code_generation: 'Code generation',
  general_qa: 'General questions',
}

export function categoryLabel(category: string | null): string {
  if (!category) return 'Unknown'
  return SEED_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')
}

/** 'original' -> 'No disguise'; 'leetspeak>base64_wrapper' -> 'Leetspeak, then Base64 encoding'. */
export function mutatorTitle(name: string | null): string {
  if (!name || name === ORIGINAL) return 'No disguise'
  return name
    .split('>')
    .map((part) => MUTATOR_GUIDE[part]?.title ?? part)
    .join(', then ')
}

export function estimatePrompts(seedCount: number, mutatorNames: string[]): number {
  const variants = mutatorNames.reduce((sum, name) => sum + (MUTATOR_GUIDE[name]?.variants ?? 1), 0)
  return seedCount * (1 + variants)
}

export type PresetIcon = 'zap' | 'shuffle' | 'bell' | 'radio'

export interface Preset {
  id: string
  title: string
  blurb: string
  icon: PresetIcon
  /** Sends real traffic to a deployed service. */
  live?: boolean
  request: RunRequest
}

export const PRESETS: Preset[] = [
  {
    id: 'quick',
    title: 'Quick check',
    blurb: 'Every attack and everyday prompt once, against the offline practice gateway.',
    icon: 'zap',
    request: {
      target_type: 'mock',
      suite_names: ['owasp_llm_top10', 'benign_controls'],
      mutator_names: [],
      max_concurrency: 5,
    },
  },
  {
    id: 'evasion',
    title: 'Disguise stress test',
    blurb: 'Disguises each prompt every way we know and shows which tricks slip through.',
    icon: 'shuffle',
    request: {
      target_type: 'mock',
      suite_names: ['owasp_llm_top10', 'benign_controls'],
      mutator_names: [...MUTATOR_ORDER],
      max_concurrency: 10,
    },
  },
  {
    id: 'false-alarms',
    title: 'False alarm check',
    blurb: 'Only everyday requests. Shows whether the guard gets in the way of real users.',
    icon: 'bell',
    request: {
      target_type: 'mock',
      suite_names: ['benign_controls'],
      mutator_names: [],
      max_concurrency: 5,
    },
  },
  {
    id: 'nemo-live',
    title: 'NeMo-Shield live',
    blurb: 'Attacks plus three disguises against the deployed NeMo-Shield gateway.',
    icon: 'radio',
    live: true,
    request: {
      target_type: 'nemo_shield',
      target_url: DEFAULT_NEMO_URL,
      suite_names: ['owasp_llm_top10', 'benign_controls'],
      mutator_names: ['leetspeak', 'homoglyph', 'zero_width'],
      max_concurrency: 3,
    },
  },
]
