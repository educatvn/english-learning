import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Plus, Trash2, Play, Pause, Pencil, Check, X, GripVertical,
  Target, Calendar, Clock, ChevronRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AppHeader } from '@/components/AppHeader'
import { getPlans, upsertPlan, deletePlan, activatePlan, pausePlan } from '@/services/plans'
import { PlanStatusDialog } from '@/components/PlanStatusDialog'
import type { StudyPlan, PlanItem } from '@/types'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type View = 'list' | 'form'

type PendingOp =
  | { type: 'delete'; planId: string }
  | { type: 'activate'; planId: string; startDate?: string }
  | { type: 'pause'; planId: string }

export default function PlansPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<StudyPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('list')
  const [editingPlan, setEditingPlan] = useState<StudyPlan | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [statusDialog, setStatusDialog] = useState<{ plan: StudyPlan; action: 'activate' | 'pause' } | null>(null)

  // Pending operation queue for debounced API calls
  const pendingOps = useRef<PendingOp[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Snapshot of server-confirmed plans, used to revert on failure
  const lastConfirmed = useRef<StudyPlan[]>([])

  useEffect(() => {
    if (!user) return
    getPlans(user.sub)
      .then((p) => {
        setPlans(p)
        lastConfirmed.current = p
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const flushOps = useCallback(async () => {
    if (!user) return
    const ops = [...pendingOps.current]
    pendingOps.current = []
    if (ops.length === 0) return

    setSaveStatus('saving')
    if (savedTimer.current) {
      clearTimeout(savedTimer.current)
      savedTimer.current = null
    }

    try {
      for (const op of ops) {
        if (op.type === 'delete') await deletePlan(op.planId, user.sub)
        else if (op.type === 'activate') await activatePlan(op.planId, user.sub, op.startDate)
        else if (op.type === 'pause') await pausePlan(op.planId, user.sub)
      }
      // Refetch to sync with server-computed fields (startDate/endDate on activate)
      const fresh = await getPlans(user.sub)
      lastConfirmed.current = fresh
      setPlans(fresh)
      setSaveStatus('saved')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (e) {
      console.error(e)
      setPlans(lastConfirmed.current)
      setSaveStatus('error')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [user])

  // Cleanup: flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      if (pendingOps.current.length > 0) flushOps()
    }
  }, [flushOps])

  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flushOps, 800)
  }

  function reload() {
    if (!user) return
    getPlans(user.sub)
      .then((p) => {
        setPlans(p)
        lastConfirmed.current = p
      })
      .catch(console.error)
  }

  function handleNew() {
    setEditingPlan(null)
    setView('form')
  }

  function handleEdit(plan: StudyPlan) {
    setEditingPlan(plan)
    setView('form')
  }

  function handleDelete(plan: StudyPlan) {
    if (!user || !confirm(`Delete plan "${plan.name}"?`)) return
    setPlans((prev) => prev.filter((p) => p.id !== plan.id))
    pendingOps.current.push({ type: 'delete', planId: plan.id })
    scheduleFlush()
  }

  function handleActivateClick(plan: StudyPlan) {
    setStatusDialog({ plan, action: 'activate' })
  }

  function handlePauseClick(plan: StudyPlan) {
    setStatusDialog({ plan, action: 'pause' })
  }

  function confirmStatusChange(opts: { startDate?: string }) {
    if (!statusDialog || !user) return
    const { plan, action } = statusDialog
    setStatusDialog(null)

    if (action === 'activate') {
      const startDate = opts.startDate || plan.startDate || localDateStr(new Date())
      const startD = new Date(
        Number(startDate.slice(0, 4)),
        Number(startDate.slice(5, 7)) - 1,
        Number(startDate.slice(8, 10)),
      )
      const endObj = new Date(startD)
      endObj.setMonth(endObj.getMonth() + plan.durationMonths)
      endObj.setDate(endObj.getDate() - 1)
      const endDate = localDateStr(endObj)
      setPlans((prev) =>
        prev.map((p) =>
          p.id === plan.id ? { ...p, status: 'active', startDate, endDate } : p,
        ),
      )
      pendingOps.current.push({ type: 'activate', planId: plan.id, startDate: opts.startDate })
    } else {
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, status: 'paused' } : p)))
      pendingOps.current.push({ type: 'pause', planId: plan.id })
    }
    scheduleFlush()
  }

  async function handleSave(plan: StudyPlan) {
    await upsertPlan(plan)
    setView('list')
    reload()
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader breadcrumb="My Plans" hideAddVideo />

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading plans…
        </div>
      ) : view === 'form' ? (
        <PlanForm
          existing={editingPlan}
          userId={user!.sub}
          onSave={handleSave}
          onCancel={() => setView('list')}
        />
      ) : (
        <main className="flex-1 px-4 py-4 md:px-6 md:py-6 max-w-4xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-5 md:mb-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold">Manage your plans</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create plans, activate them, and track your daily progress
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {saveStatus === 'saving' && (
                <span className="text-[10px] text-muted-foreground italic">Saving…</span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-[10px] text-green-600 inline-flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> Updated
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-[10px] text-red-500">Failed</span>
              )}
              <button
                onClick={handleNew}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors whitespace-nowrap shrink-0"
                title="New Plan"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Plan</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>

          {plans.length === 0 ? (
            <div className="text-center py-20">
              <Target className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No plans yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first study plan to get started</p>
              <button
                onClick={handleNew}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Create Plan
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onEdit={() => handleEdit(plan)}
                  onDelete={() => handleDelete(plan)}
                  onActivate={() => handleActivateClick(plan)}
                  onPause={() => handlePauseClick(plan)}
                />
              ))}
            </div>
          )}
        </main>
      )}

      {statusDialog && (
        <PlanStatusDialog
          plan={statusDialog.plan}
          action={statusDialog.action}
          onClose={() => setStatusDialog(null)}
          onConfirm={confirmStatusChange}
        />
      )}
    </div>
  )
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  onEdit,
  onDelete,
  onActivate,
  onPause,
}: {
  plan: StudyPlan
  onEdit: () => void
  onDelete: () => void
  onActivate: () => void
  onPause: () => void
}) {
  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/15 text-gray-500',
    active: 'bg-green-500/15 text-green-600',
    paused: 'bg-yellow-500/15 text-yellow-600',
    completed: 'bg-blue-500/15 text-blue-600',
  }

  const statusLabels: Record<string, string> = {
    draft: 'Draft',
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
  }

  const daysRemaining = plan.status === 'active' && plan.endDate
    ? Math.max(0, Math.ceil((new Date(plan.endDate).getTime() - Date.now()) / 86400000))
    : null

  const actionButtons = (
    <>
      <Link
        to={`/plans/${plan.id}/dashboard`}
        className="w-8 h-8 md:w-7 md:h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Dashboard"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
      {(plan.status === 'draft' || plan.status === 'paused') && (
        <button
          onClick={onActivate}
          className="w-8 h-8 md:w-7 md:h-7 rounded-lg border border-border flex items-center justify-center hover:bg-green-500/10 transition-colors text-muted-foreground hover:text-green-600"
          title="Activate"
        >
          <Play className="w-3 h-3" />
        </button>
      )}
      {plan.status === 'active' && (
        <button
          onClick={onPause}
          className="w-8 h-8 md:w-7 md:h-7 rounded-lg border border-border flex items-center justify-center hover:bg-yellow-500/10 transition-colors text-muted-foreground hover:text-yellow-600"
          title="Pause"
        >
          <Pause className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={onEdit}
        className="w-8 h-8 md:w-7 md:h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Edit"
      >
        <Pencil className="w-3 h-3" />
      </button>
      <button
        onClick={onDelete}
        className="w-8 h-8 md:w-7 md:h-7 rounded-lg border border-border flex items-center justify-center hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-500"
        title="Delete"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </>
  )

  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Link
              to={`/plans/${plan.id}/dashboard`}
              className="text-sm font-semibold hover:underline hover:text-primary transition-colors wrap-break-word min-w-0"
            >
              {plan.name}
            </Link>
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusColors[plan.status]}`}>
              {statusLabels[plan.status]}
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground mt-1.5">
            <span className="inline-flex items-center gap-1">
              <Target className="w-3 h-3" /> {plan.items.length} items
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {plan.durationMonths} month{plan.durationMonths !== 1 ? 's' : ''}
            </span>
            {daysRemaining !== null && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {daysRemaining} days left
              </span>
            )}
          </div>

          {/* Item preview */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {plan.items.slice(0, 4).map((item) => (
              <span key={item.id} className="text-[10px] bg-muted px-2 py-0.5 rounded-md text-muted-foreground truncate max-w-[180px]">
                {item.text}
              </span>
            ))}
            {plan.items.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{plan.items.length - 4} more</span>
            )}
          </div>
        </div>

        {/* md+: inline action buttons */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {actionButtons}
        </div>
      </div>

      {/* Mobile: action buttons on their own row below the card body */}
      <div className="flex md:hidden items-center gap-1.5 mt-3 pt-3 border-t border-border justify-end">
        {actionButtons}
      </div>
    </div>
  )
}

// ─── PlanForm ─────────────────────────────────────────────────────────────────

function PlanForm({
  existing,
  userId,
  onSave,
  onCancel,
}: {
  existing: StudyPlan | null
  userId: string
  onSave: (plan: StudyPlan) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [durationMonths, setDurationMonths] = useState(existing?.durationMonths ?? 1)
  const [items, setItems] = useState<PlanItem[]>(existing?.items ?? [])
  const [newItemText, setNewItemText] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset form state when switching between new/edit
  useEffect(() => {
    setName(existing?.name ?? '')
    setDurationMonths(existing?.durationMonths ?? 1)
    setItems(existing?.items ?? [])
    setNewItemText('')
  }, [existing])

  function addItem() {
    const text = newItemText.trim()
    if (!text) return
    setItems((prev) => [...prev, { id: genId(), text }])
    setNewItemText('')
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function updateItemText(id: string, text: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, text } : i)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || items.length === 0) return
    setSaving(true)

    const now = new Date().toISOString()
    const plan: StudyPlan = {
      id: existing?.id ?? genId(),
      userId,
      name: name.trim(),
      items,
      durationMonths,
      startDate: existing?.startDate ?? '',
      endDate: existing?.endDate ?? '',
      status: existing?.status ?? 'draft',
      createdAt: existing?.createdAt ?? now,
    }

    try {
      await onSave(plan)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex-1 px-4 py-4 md:px-6 md:py-6 max-w-2xl mx-auto w-full">
      <button
        onClick={onCancel}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 inline-flex items-center gap-1"
      >
        <X className="w-3 h-3" /> Cancel
      </button>

      <h2 className="text-lg font-bold mb-4">{existing ? 'Edit Plan' : 'New Plan'}</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Plan name */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Plan Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily English Practice"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>

        {/* Duration */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Duration
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              value={durationMonths}
              onChange={(e) => setDurationMonths(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">month(s)</span>
          </div>
        </div>

        {/* Items */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Plan Items ({items.length})
          </label>

          <div className="space-y-2 mb-3">
            {items.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-5">{idx + 1}.</span>
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => updateItemText(item.id, e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder="Add an item… (press Enter)"
              className="flex-1 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={addItem}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || items.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Create Plan'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  )
}
