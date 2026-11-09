import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
} from 'react'

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

// --- Button ----------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[0_1px_0_rgb(0_0_0/0.15)]',
  secondary: 'bg-panel text-ink border border-line-strong hover:bg-sunken',
  ghost: 'text-ink-soft hover:bg-sunken',
  danger: 'bg-panel text-bypassed border border-bypassed/40 hover:bg-bypassed-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: IconType
  busy?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  busy = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' }
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px',
        sizes[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  )
}

// --- Small pieces -------------------------------------------------------------------

export function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-sunken', className)} aria-hidden />
}

// --- Notice -------------------------------------------------------------------------

const NOTICE_TONES = {
  info: { icon: Info, box: 'border-accent/25 bg-accent-soft', iconColor: 'text-accent' },
  warn: { icon: AlertTriangle, box: 'border-alarm/30 bg-alarm-soft', iconColor: 'text-alarm' },
  error: { icon: XCircle, box: 'border-bypassed/30 bg-bypassed-soft', iconColor: 'text-bypassed' },
  success: { icon: CheckCircle2, box: 'border-defended/30 bg-defended-soft', iconColor: 'text-defended' },
}

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const { icon: Icon, box, iconColor } = NOTICE_TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start', box, className)}
    >
      <Icon className={cx('size-5 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 text-ink-soft">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: IconType
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-sunken">
        <Icon className="size-6 text-muted" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Inline code for commands a beginner may need to copy. */
export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
}

// --- Dialog (native <dialog>: focus trap, Esc to close, backdrop) ---------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  side = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** Slide-over panel on wide screens instead of a centred modal. */
  side?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose() // click on backdrop
      }}
      aria-labelledby="dialog-title"
      className={cx(
        'm-0 max-h-none max-w-none bg-transparent p-0 text-ink',
        side
          ? 'ml-auto h-dvh w-full sm:w-[min(640px,92vw)]'
          : 'fixed inset-0 m-auto h-fit w-[min(520px,calc(100vw-2rem))]',
      )}
    >
      {open && (
        <div
          className={cx(
            'flex flex-col bg-panel shadow-2xl',
            side ? 'h-full border-l border-line' : 'max-h-[85dvh] rounded-2xl border border-line',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" className="-mr-2" />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}
