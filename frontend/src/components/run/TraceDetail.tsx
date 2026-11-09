import { ArrowDown, Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { EvaluationResult } from '../../api/types'
import { categoryLabel, mutatorTitle, ORIGINAL } from '../../lib/catalog'
import { ms } from '../../lib/format'
import { OUTCOMES } from '../../lib/outcomes'
import { HiddenTrickLegend, VisibleText } from '../VisibleText'
import { Button, cx, Dialog } from '../ui'

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function targetMeta(result: EvaluationResult): Record<string, unknown> {
  const meta = result.details.target_metadata
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
}

export function TraceDetail({
  results,
  index,
  order,
  onNavigate,
  onClose,
}: {
  results: EvaluationResult[]
  index: number | null
  order: number[]
  onNavigate: (index: number) => void
  onClose: () => void
}) {
  const result = index === null ? undefined : results[index]
  const position = index === null ? -1 : order.indexOf(index)

  return (
    <Dialog
      open={result !== undefined}
      onClose={onClose}
      side
      title={result ? `${result.original_seed_id ?? 'Prompt'} · ${mutatorTitle(result.mutator)}` : ''}
      description={result ? categoryLabel(result.category) : undefined}
    >
      {result && (
        <div className="space-y-6">
          {order.length > 1 && position !== -1 && (
            <div className="flex items-center justify-between text-sm">
              <Button
                size="sm"
                icon={ChevronLeft}
                disabled={position <= 0}
                onClick={() => onNavigate(order[position - 1])}
              >
                Previous
              </Button>
              <span className="text-xs text-muted tabular">
                {position + 1} of {order.length}
              </span>
              <Button size="sm" disabled={position >= order.length - 1} onClick={() => onNavigate(order[position + 1])}>
                Next
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
          <TraceBody result={result} results={results} />
        </div>
      )}
    </Dialog>
  )
}

function TraceBody({ result, results }: { result: EvaluationResult; results: EvaluationResult[] }) {
  const meta = OUTCOMES[result.outcome]
  const target = targetMeta(result)
  const isOriginal = (result.mutator ?? ORIGINAL) === ORIGINAL
  const original = isOriginal
    ? result
    : results.find((r) => r.original_seed_id === result.original_seed_id && (r.mutator ?? ORIGINAL) === ORIGINAL)
  const reply =
    text(result.details.refusal_phrase) ?? text(target.reply) ?? text(result.details.message) ?? text(result.details.reason)
  const truncated = result.details.truncated === true

  const facts: [string, ReactNode][] = [
    ['Expected', result.expected_action === 'block' ? 'Should be blocked' : 'Should be allowed'],
    ['Gateway verdict', text(target.verdict) ?? (result.outcome === 'DEFENDED' || result.outcome === 'FALSE_POSITIVE' ? 'Blocked' : 'Not blocked')],
    ['Response time', ms(result.latency_ms)],
    ['HTTP status', result.status_code === 0 ? 'No response' : String(result.status_code)],
  ]
  const optional: [string, unknown][] = [
    ['Threat category', target.threat_category],
    ['Confidence', typeof target.confidence === 'number' ? `${Math.round(target.confidence * 100)}%` : undefined],
    ['Decided by', target.rail_path],
    ['Gateway time', typeof target.server_latency_ms === 'number' ? ms(target.server_latency_ms) : undefined],
    ['Matched phrase', target.matched_term],
    ['Error', text(result.details.error) ?? text(target.error)],
  ]
  for (const [label, value] of optional) {
    const v = typeof value === 'string' ? value : text(value)
    if (v) facts.push([label, v])
  }

  return (
    <>
      <div className={cx('rounded-xl p-4', meta.badge)}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Verdict</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{meta.label}</p>
        <p className="mt-1 text-sm text-ink">{meta.meaning}</p>
      </div>

      {!isOriginal && (
        <>
          <PromptBox title="Original prompt" text={original?.prompt} muted>
            {!original && <p className="text-sm text-muted">The undisguised prompt wasn't part of this run.</p>}
          </PromptBox>
          <div className="flex items-center gap-2 pl-4 text-xs font-medium text-muted">
            <ArrowDown className="size-4" aria-hidden />
            Disguised with: {mutatorTitle(result.mutator)}
          </div>
        </>
      )}
      <PromptBox title={isOriginal ? 'Prompt sent (no disguise)' : 'What was actually sent'} text={result.prompt}>
        {truncated && <p className="mt-2 text-xs text-alarm">This prompt was cut short to fit the gateway's length limit.</p>}
      </PromptBox>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Gateway's reply</h3>
        <div className="rounded-xl border border-line bg-sunken/60 p-4 text-sm">
          {reply ? (
            <p className="whitespace-pre-wrap break-words">{reply}</p>
          ) : (
            <p className="text-muted">No reply text was recorded for this prompt.</p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Details</h3>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="bg-panel px-3 py-2.5">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}

function PromptBox({
  title,
  text: value,
  muted = false,
  children,
}: {
  title: string
  text?: string
  muted?: boolean
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? Check : Copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // Clipboard blocked; nothing useful to do.
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
      {value && (
        <div className={cx('rounded-xl border p-4', muted ? 'border-line bg-paper' : 'border-ink/20 bg-panel')}>
          <p className="font-mono text-[13px] leading-relaxed">
            <VisibleText text={value} />
          </p>
          <HiddenTrickLegend text={value} />
        </div>
      )}
      {children}
    </section>
  )
}
