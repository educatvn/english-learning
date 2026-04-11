import { useEffect, useState } from 'react'
import { X, Play, Pause } from 'lucide-react'
import type { StudyPlan } from '@/types'

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  plan: StudyPlan
  action: 'activate' | 'pause'
  onConfirm: (opts: { startDate?: string }) => void
  onClose: () => void
}

export function PlanStatusDialog({ plan, action, onConfirm, onClose }: Props) {
  // Initial start date: existing plan.startDate (re-activation) or today (first activation)
  const initial =
    plan.startDate && /^\d{4}-\d{2}-\d{2}$/.test(plan.startDate)
      ? plan.startDate
      : localDateStr(new Date())
  const [startDate, setStartDate] = useState(initial)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isActivate = action === 'activate'
  const hadPreviousStart = !!plan.startDate

  function handleConfirm() {
    if (isActivate) onConfirm({ startDate })
    else onConfirm({})
  }

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              {isActivate ? 'Activate plan' : 'Pause plan'}
            </p>
            <h2 className="text-lg font-bold text-foreground wrap-break-word">{plan.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {isActivate ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {hadPreviousStart
                ? 'Resuming this plan will keep the original start date so past activity stays in place. You can adjust it below if needed.'
                : 'Choose when this plan should start. The end date is computed from the duration.'}
            </p>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pausing keeps your progress and the original start date. You can resume this plan later without losing any activity.
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isActivate && !startDate}
            className={[
              'flex-1 h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors disabled:opacity-60',
              isActivate
                ? 'bg-green-500 text-white hover:bg-green-500/90'
                : 'bg-yellow-500 text-white hover:bg-yellow-500/90',
            ].join(' ')}
          >
            {isActivate ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isActivate ? 'Activate' : 'Pause'}
          </button>
        </div>
      </div>
    </div>
  )
}
