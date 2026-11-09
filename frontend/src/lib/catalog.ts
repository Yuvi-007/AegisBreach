import type { RunRequest } from '../api/types'

export const DEFAULT_NEMO_URL = 'https://nemo-shield-api.onrender.com'
export const ORIGINAL = 'original'

export interface MutatorGuide {
  title: string
  /** One line, plain words. */
  short: string
  /** Variants the backend produces per prompt (used for size estimates). */
  variants: number
}

export const MUTATOR_GUIDE: Record<string, MutatorGuide> = {
  leetspeak: { title: 'Leetspeak', short: "Letters become digits: 'ignore' -> '1gn0r3'.", variants: 1 },
  case_jitter: { title: 'Mixed case', short: "Scrambled capitals: 'iGnOrE'.", variants: 2 },
  homoglyph: { title: 'Look-alikes', short: 'Swaps letters for identical-looking Cyrillic ones.', variants: 1 },
  zero_width: { title: 'Invisible chars', short: 'Hides zero-width characters inside words.', variants: 2 },
  base64_wrapper: { title: 'Base64', short: 'Encodes the prompt and asks the model to decode it.', variants: 3 },
  crescendo_framing: { title: 'Framing', short: 'Wraps the prompt in a harmless-looking story.', variants: 3 },
}

export const MUTATOR_ORDER = Object.keys(MUTATOR_GUIDE)

export const SUITE_GUIDE: Record<string, { title: string; short: string; expect: 'block' | 'allow' }> = {
  owasp_llm_top10: { title: 'Attacks', short: 'OWASP LLM Top 10 attacks. Should be blocked.', expect: 'block' },
  benign_controls: { title: 'Everyday', short: 'Normal business requests. Should be allowed.', expect: 'allow' },
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

/** 'original' -> 'Original'; 'leetspeak>base64_wrapper' -> 'Leetspeak, then Base64'. */
export function mutatorTitle(name: string | null): string {
  if (!name || name === ORIGINAL) return 'Original'
  return name
    .split('>')
    .map((part) => MUTATOR_GUIDE[part]?.title ?? part)
    .join(', then ')
}

export function suiteTitle(suiteId: string): string {
  return SUITE_GUIDE[suiteId]?.title ?? suiteId.replace(/_/g, ' ')
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
    blurb: 'Every prompt once, no disguises.',
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
    blurb: 'All six disguises on every prompt.',
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
    blurb: 'Everyday requests only.',
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
    blurb: 'Attacks and three disguises against the deployed gateway.',
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
