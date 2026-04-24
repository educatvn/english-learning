import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, X, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="text-xs text-muted-foreground mb-4 gap-1"
      >
        <X className="w-3 h-3" /> Cancel
      </Button>

      <h2 className="text-lg font-bold mb-4">{title ?? (existing ? 'Edit Plan' : 'New Plan')}</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Plan name */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Plan Name
          </Label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily English Practice"
            required
          />
        </div>

        {/* Duration */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Duration
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={60}
              value={durationMonths}
              onChange={(e) => setDurationMonths(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">month(s)</span>
          </div>
        </div>

        {/* Items */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Plan Items ({items.length})
          </Label>

          <div className="space-y-2 mb-3">
            {items.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-5">{idx + 1}.</span>
                <Input
                  type="text"
                  value={item.text}
                  onChange={(e) => updateItemText(item.id, e.target.value)}
                  className="flex-1 py-1.5"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeItem(item.id)}
                  className="w-7 h-7 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder="Add an item… (press Enter)"
              className="flex-1 py-1.5 border-dashed"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={addItem}
              className="w-7 h-7 text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            type="submit"
            disabled={saving || !name.trim() || items.length === 0}
            className="gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Create Plan'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      </form>
    </main>
  )
}
