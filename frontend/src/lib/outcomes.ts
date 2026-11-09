import type { Outcome } from '../api/types'

export interface OutcomeMeta {
  label: string
  /** Solid swatch for tiles and bars. */
  swatch: string
  /** Tinted background + text for badges. */
  badge: string
  /** One sentence a beginner can act on. */
  meaning: string
}

export const OUTCOMES: Record<Outcome, OutcomeMeta> = {
  BYPASSED: {
    label: 'Bypassed',
    swatch: 'bg-bypassed',
    badge: 'bg-bypassed-soft text-bypassed',
    meaning: 'This attack got through. The guard should have blocked it but let it pass.',
  },
  DEFENDED: {
    label: 'Defended',
    swatch: 'bg-defended',
    badge: 'bg-defended-soft text-defended',
    meaning: 'The guard blocked this attack, as it should.',
  },
  FALSE_POSITIVE: {
    label: 'False alarm',
    swatch: 'bg-alarm',
    badge: 'bg-alarm-soft text-alarm',
    meaning: 'An ordinary request was blocked. A real user would have been wrongly refused.',
  },
  BENIGN_PASS: {
    label: 'Allowed',
    swatch: 'bg-pass',
    badge: 'bg-pass-soft text-pass',
    meaning: 'An ordinary request was let through, as it should be.',
  },
  VALIDATION_ERROR: {
    label: 'Input rejected',
    swatch: 'bg-error hatch',
    badge: 'bg-error-soft text-error',
    meaning:
      'The target refused the request format (HTTP 422), usually because the disguised prompt was too long. It counts as neither blocked nor bypassed.',
  },
  RATE_LIMITED: {
    label: 'Rate limited',
    swatch: 'bg-error hatch',
    badge: 'bg-error-soft text-error',
    meaning: 'The target asked us to slow down (HTTP 429). Try again with lower parallel requests.',
  },
  SYSTEM_ERROR: {
    label: 'Error',
    swatch: 'bg-error hatch',
    badge: 'bg-error-soft text-error',
    meaning: 'The request failed (network problem or server error), so there is no verdict.',
  },
}

/** Display order: what matters most first. */
export const OUTCOME_ORDER: Outcome[] = [
  'BYPASSED',
  'DEFENDED',
  'FALSE_POSITIVE',
  'BENIGN_PASS',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'SYSTEM_ERROR',
]

export const ERROR_OUTCOMES = new Set<Outcome>(['VALIDATION_ERROR', 'RATE_LIMITED', 'SYSTEM_ERROR'])
