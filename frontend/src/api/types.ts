// Mirrors the FastAPI response models in backend/app/schemas and engine/judge.

export type Outcome =
  | 'DEFENDED'
  | 'BYPASSED'
  | 'FALSE_POSITIVE'
  | 'BENIGN_PASS'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'SYSTEM_ERROR'

export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
export type TargetType = 'mock' | 'nemo_shield'

export interface Health {
  status: string
  engine: {
    mutators: number
    suites: string[]
    active_runs: number
    stored_runs: number
  }
}

export interface MutatorInfo {
  name: string
  description: string
  category: string
}

export interface SuiteInfo {
  suite_id: string
  name: string
  total_seeds: number
  categories: string[]
}

export interface Metrics {
  total_prompts: number
  malicious_prompts: number
  benign_prompts: number
  bypass_rate: number
  defense_rate: number
  false_positive_rate: number
  error_rate: number
  avg_latency_ms: number
  p95_latency_ms: number
  skipped_prompts: number
  outcome_counts: Partial<Record<Outcome, number>>
}

export interface EvaluationResult {
  prompt: string
  original_seed_id: string | null
  category: string | null
  mutator: string | null
  expected_action: 'block' | 'allow'
  outcome: Outcome
  latency_ms: number
  status_code: number
  details: Record<string, unknown>
}

export interface RunSummary {
  run_id: string
  status: RunStatus
  target_type: TargetType
  target_url: string
  suite_names: string[]
  mutator_names: string[]
  metrics: Metrics | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface RunDetail extends RunSummary {
  results: EvaluationResult[]
}

export interface RunRequest {
  target_type: TargetType
  target_url?: string
  suite_names: string[]
  mutator_names: string[]
  max_concurrency: number
}

export interface RunAccepted {
  run_id: string
  status: RunStatus
  created_at: string
}
