import { useState } from 'react'
import { Play, Pause } from 'lucide-react'
import type { StudyPlan } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

  const isActivate = action === 'activate'
  const hadPreviousStart = !!plan.startDate

  function handleConfirm() {
    if (isActivate) onConfirm({ startDate })
    else onConfirm({})
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton>
        {/* Header */}
        <DialogHeader>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            {isActivate ? 'Activate plan' : 'Pause plan'}
          </p>
          <DialogTitle className="text-lg font-bold text-foreground wrap-break-word">
            {plan.name}
          </DialogTitle>
        </DialogHeader>

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
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pausing keeps your progress and the original start date. You can resume this plan later without losing any activity.
          </p>
        )}

        {/* Actions */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isActivate && !startDate}
            className={
              isActivate
                ? 'bg-green-500 text-white hover:bg-green-500/90'
                : 'bg-yellow-500 text-white hover:bg-yellow-500/90'
            }
          >
            {isActivate ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isActivate ? 'Activate' : 'Pause'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
