import { ChevronRight, Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EvaluationResult, Outcome } from '../../api/types'
import { categoryLabel, mutatorTitle, ORIGINAL } from '../../lib/catalog'
import { ms } from '../../lib/format'
import { ERROR_OUTCOMES, OUTCOMES } from '../../lib/outcomes'
import { VisibleText } from '../VisibleText'
import { Button, cx, EmptyState } from '../ui'

type OutcomeFilter = 'all' | 'attention' | Outcome | 'errors'

const PAGE_SIZE = 60

const FILTERS: { value: OutcomeFilter; label: string; match: (o: Outcome) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'attention', label: 'Needs attention', match: (o) => o === 'BYPASSED' || o === 'FALSE_POSITIVE' },
  { value: 'BYPASSED', label: 'Bypassed', match: (o) => o === 'BYPASSED' },
  { value: 'DEFENDED', label: 'Defended', match: (o) => o === 'DEFENDED' },
  { value: 'FALSE_POSITIVE', label: 'False alarm', match: (o) => o === 'FALSE_POSITIVE' },
  { value: 'BENIGN_PASS', label: 'Allowed', match: (o) => o === 'BENIGN_PASS' },
  { value: 'errors', label: 'Errors', match: (o) => ERROR_OUTCOMES.has(o) },
]

/** Filterable list of every prompt. Reports the visible order so the detail panel can step through it. */
export function TraceExplorer({
  results,
  onSelect,
}: {
  results: EvaluationResult[]
  onSelect: (index: number, visibleOrder: number[]) => void
}) {
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const [disguise, setDisguise] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const disguises = useMemo(() => unique(results.map((r) => r.mutator ?? ORIGINAL)), [results])
  const categories = useMemo(() => unique(results.map((r) => r.category ?? 'unknown')), [results])

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match
    const q = query.trim().toLowerCase()
    return results
      .map((result, index) => ({ result, index }))
      .filter(
        ({ result }) =>
          match(result.outcome) &&
          (disguise === 'all' || (result.mutator ?? ORIGINAL) === disguise) &&
          (category === 'all' || (result.category ?? 'unknown') === category) &&
          (!q || result.prompt.toLowerCase().includes(q) || (result.original_seed_id ?? '').toLowerCase().includes(q)),
      )
  }, [results, filter, disguise, category, query])

  const order = visible.map((v) => v.index)
  const filtersActive = filter !== 'all' || disguise !== 'all' || category !== 'all' || query !== ''

  function reset() {
    setFilter('all')
    setDisguise('all')
    setCategory('all')
    setQuery('')
  }

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="space-y-3 border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Every prompt, in detail</h3>
          <p className="text-xs text-muted tabular">
            Showing {visible.length} of {results.length}
          </p>
        </div>

        <div role="group" aria-label="Filter by outcome" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count = results.filter((r) => f.match(r.outcome)).length
            if (count === 0 && f.value !== 'all' && f.value !== filter) return null
            const active = filter === f.value
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFilter(f.value)
                  setLimit(PAGE_SIZE)
                }}
                className={cx(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  active ? 'border-ink bg-ink text-paper' : 'border-line bg-panel text-ink-soft hover:border-line-strong',
                )}
              >
                {f.label}
                <span className={cx('tabular', active ? 'text-paper/70' : 'text-muted')}>{count}</span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <span className="sr-only">Search prompts</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompt text or ID"
              className="h-9 w-full rounded-lg border border-line-strong bg-panel pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <Select label="Disguise" value={disguise} onChange={setDisguise} options={disguises} format={mutatorTitle} />
          <Select label="Prompt type" value={category} onChange={setCategory} options={categories} format={categoryLabel} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={SearchX}
            title="No prompts match these filters"
            action={
              <Button size="sm" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {visible.slice(0, limit).map(({ result, index }) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => onSelect(index, order)}
                aria-label={`${OUTCOMES[result.outcome].label}: ${result.original_seed_id ?? 'prompt'}, ${mutatorTitle(result.mutator)}, ${categoryLabel(result.category)}, ${ms(result.latency_ms)}. Open details`}
                className="group grid w-full grid-cols-[4px_1fr_auto] items-stretch gap-x-3 px-4 py-3 text-left transition-colors hover:bg-sunken/70 sm:px-5"
              >
                <span className={cx('rounded-full', OUTCOMES[result.outcome].swatch)} aria-hidden />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className={cx('rounded-full px-2 py-0.5 font-semibold', OUTCOMES[result.outcome].badge)}>
                      {OUTCOMES[result.outcome].label}
                    </span>
                    <span className="font-mono text-muted">{result.original_seed_id}</span>
                    <span className="text-ink-soft">{mutatorTitle(result.mutator)}</span>
                    <span className="text-muted">· {categoryLabel(result.category)}</span>
                  </span>
                  <span className="mt-1.5 line-clamp-2 block font-mono text-[13px] leading-relaxed text-ink">
                    <VisibleText text={result.prompt} />
                  </span>
                </span>
                <span className="flex items-center gap-1 self-center text-xs text-muted tabular">
                  {ms(result.latency_ms)}
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {visible.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, visible.length - limit)} more
          </Button>
        </div>
      )}
      {filtersActive && visible.length > 0 && (
        <div className="border-t border-line p-3 text-center">
          <Button size="sm" variant="ghost" onClick={reset}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function Select({
  label,
  value,
  onChange,
  options,
  format,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  format: (v: string) => string
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <option value="all">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  )
}
