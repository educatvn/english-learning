import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, X, GripVertical } from 'lucide-react'
import type { StudyPlan, PlanItem } from '@/types'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function PlanForm({
  existing,
  userId,
  onSave,
  onCancel,
  title,
}: {
  existing: StudyPlan | null
  userId: string
  onSave: (plan: StudyPlan) => void | Promise<void>
  onCancel: () => void
  /** Optional override for the form heading. Defaults to "Edit Plan" / "New Plan". */
  title?: string
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

      <h2 className="text-lg font-bold mb-4">{title ?? (existing ? 'Edit Plan' : 'New Plan')}</h2>

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
