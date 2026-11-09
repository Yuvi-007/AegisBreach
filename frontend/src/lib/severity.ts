export type Level = 'good' | 'warn' | 'bad'

export const LEVEL_STYLE: Record<Level, { label: string; chip: string; bar: string }> = {
  good: { label: 'Good', chip: 'bg-defended-soft text-defended', bar: 'bg-defended' },
  warn: { label: 'Fair', chip: 'bg-alarm-soft text-alarm', bar: 'bg-alarm' },
  bad: { label: 'Poor', chip: 'bg-bypassed-soft text-bypassed', bar: 'bg-bypassed' },
}

export interface Scale {
  /** Where "good" ends and "warn" ends, on the metric's own scale. */
  good: number
  warn: number
  lowerIsBetter: boolean
}

export function levelFor(value: number, scale: Scale): Level {
  if (scale.lowerIsBetter) {
    if (value <= scale.good) return 'good'
    return value <= scale.warn ? 'warn' : 'bad'
  }
  if (value >= scale.good) return 'good'
  return value >= scale.warn ? 'warn' : 'bad'
}

// Thresholds chosen for guardrail evaluation; tweak to taste.
export const SCALES = {
  bypass: { good: 0.05, warn: 0.2, lowerIsBetter: true },
  defense: { good: 0.95, warn: 0.8, lowerIsBetter: false },
  falseAlarm: { good: 0.02, warn: 0.1, lowerIsBetter: true },
  p95LatencyMs: { good: 500, warn: 2000, lowerIsBetter: true },
} satisfies Record<string, Scale>
