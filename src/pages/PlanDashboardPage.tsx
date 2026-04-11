import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Check, Target, Flame, Calendar,
  TrendingUp, Trophy,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { AppHeader } from '@/components/AppHeader'
import { getPlans, getDailyProgress, togglePlanItem, activatePlan, pausePlan } from '@/services/plans'
import type { StudyPlan, DailyProgress } from '@/types'

// ─── Date helpers (always local timezone) ────────────────────────────────────

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr() {
  return localDateStr(new Date())
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function buildDaysList(start: string, end: string): string[] {
  const days: string[] = []
  const d = parseLocalDate(start)
  const endD = parseLocalDate(end)
  while (d <= endD) {
    days.push(localDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function calcStreak(progressMap: Map<string, DailyProgress>, totalItems: number): number {
  let streak = 0
  const d = new Date()
  for (let i = 0; i < 365; i++) {
    const day = localDateStr(d)
    const prog = progressMap.get(day)
    if (prog && prog.completedItemIds.length >= totalItems) {
      streak++
    } else if (i > 0) {
      break
    }
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// ─── 12-month calendar builder ───────────────────────────────────────────────

type CalendarDay = { date: string }

function build12MonthWeeks(): CalendarDay[][] {
  const now = new Date()
  // Start from the 1st of this month
  const startD = new Date(now.getFullYear(), now.getMonth(), 1)
  // End at the last day of month + 11
  const endD = new Date(now.getFullYear(), now.getMonth() + 12, 0)

  // Align start to Monday
  const dow = startD.getDay()
  startD.setDate(startD.getDate() - ((dow + 6) % 7))

  // Pad end to Sunday
  const endDow = endD.getDay()
  if (endDow !== 0) endD.setDate(endD.getDate() + (7 - endDow))

  const weeks: CalendarDay[][] = []
  let currentWeek: CalendarDay[] = []
  const d = new Date(startD)
  while (d <= endD) {
    currentWeek.push({ date: localDateStr(d) })
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    d.setDate(d.getDate() + 1)
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push({ date: '' })
    weeks.push(currentWeek)
  }
  return weeks
}

function buildMonthLabels(weeks: CalendarDay[][]): { label: string; col: number; monthKey: string }[] {
  // A month label should anchor to the first week where that month has the
  // dominant share of days, which naturally prevents a fringe week (e.g. one
  // Mar day spilling into an Apr-dominant week) from showing as its own label
  // and overlapping the next one.
  const labels: { label: string; col: number; monthKey: string }[] = []
  let lastMonth = ''
  for (let wi = 0; wi < weeks.length; wi++) {
    const counts = new Map<string, number>()
    for (const d of weeks[wi]) {
      if (!d.date) continue
      const key = d.date.slice(0, 7)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    // Pick the month with the most days in this week (ties → earliest month)
    let dominant = ''
    let best = 0
    for (const [key, c] of counts) {
      if (c > best || (c === best && (!dominant || key < dominant))) {
        dominant = key
        best = c
      }
    }
    if (!dominant || dominant === lastMonth) continue
    const [y, m] = dominant.split('-').map(Number)
    const monthName = new Date(y, m - 1).toLocaleString('en-US', { month: 'short' })
    labels.push({ label: monthName, col: wi, monthKey: dominant })
    lastMonth = dominant
  }
  return labels
}

/** True if the given month key (YYYY-MM) intersects the [start, end] plan range. */
function monthInPlan(monthKey: string, planStart: string, planEnd: string): boolean {
  if (!monthKey || !planStart || !planEnd) return false
  const [y, m] = monthKey.split('-').map(Number)
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return monthEnd >= planStart && monthStart <= planEnd
}

/** Normalize a date that may be YYYY-MM-DD or a raw Date.toString() into YYYY-MM-DD */
function normalizeDateStr(s: string): string {
  if (!s) return ''
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Try parsing as Date
  const d = new Date(s)
  if (!isNaN(d.getTime())) return localDateStr(d)
  return ''
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PlanDashboardPage() {
  const { user } = useAuth()
  const { planId } = useParams<{ planId: string }>()
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [progress, setProgress] = useState<DailyProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const today = todayStr()

  // Pending toggle queue for debounced API calls
  const pendingToggles = useRef<string[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Snapshot of server-confirmed progress, used to revert on failure
  const lastConfirmed = useRef<DailyProgress[]>([])
  // Pending plan status change (debounced)
  const pendingStatus = useRef<'active' | 'paused' | null>(null)
  const statusFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastConfirmedPlan = useRef<StudyPlan | null>(null)

  useEffect(() => {
    if (!user || !planId) return
    Promise.all([
      getPlans(user.sub),
      getDailyProgress(user.sub, planId),
    ])
      .then(([plans, prog]) => {
        const found = plans.find((p) => p.id === planId)
        setPlan(found ?? null)
        setProgress(prog ?? [])
        lastConfirmed.current = prog ?? []
        lastConfirmedPlan.current = found ?? null
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user, planId])

  // Flush pending toggles to the API
  const flushToggles = useCallback(async () => {
    if (!user || !planId) return
    // Collapse by parity: toggling the same item an even number of times is a no-op
    const counts = new Map<string, number>()
    for (const id of pendingToggles.current) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    pendingToggles.current = []
    const ids = [...counts.entries()].filter(([, c]) => c % 2 === 1).map(([id]) => id)
    if (ids.length === 0) return

    setSaveStatus('saving')
    if (savedTimer.current) {
      clearTimeout(savedTimer.current)
      savedTimer.current = null
    }

    try {
      // Fire sequentially to avoid race conditions on the same sheet row
      let latest: DailyProgress | null = null
      for (const itemId of ids) {
        latest = await togglePlanItem(user.sub, planId, today, itemId)
      }
      // Sync confirmed snapshot with what the server returned
      if (latest) {
        lastConfirmed.current = (() => {
          const idx = lastConfirmed.current.findIndex((p) => p.date === today)
          if (idx >= 0) {
            const next = [...lastConfirmed.current]
            next[idx] = latest!
            return next
          }
          return [...lastConfirmed.current, latest!]
        })()
      }
      setSaveStatus('saved')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (e) {
      console.error(e)
      // Revert UI to last confirmed state and show error
      setProgress(lastConfirmed.current)
      setSaveStatus('error')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [user, planId, today])

  // Flush pending plan status change to the API
  const flushStatus = useCallback(async () => {
    if (!user || !planId) return
    const target = pendingStatus.current
    pendingStatus.current = null
    if (!target) return
    // No-op if server already matches
    if (lastConfirmedPlan.current?.status === target) return

    setSaveStatus('saving')
    if (savedTimer.current) {
      clearTimeout(savedTimer.current)
      savedTimer.current = null
    }

    try {
      if (target === 'active') await activatePlan(planId, user.sub)
      else await pausePlan(planId, user.sub)
      // Refetch to pick up server-computed startDate/endDate on activate
      const plans = await getPlans(user.sub)
      const fresh = plans.find((p) => p.id === planId) ?? null
      lastConfirmedPlan.current = fresh
      if (fresh) setPlan(fresh)
      setSaveStatus('saved')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (e) {
      console.error(e)
      if (lastConfirmedPlan.current) setPlan(lastConfirmedPlan.current)
      setSaveStatus('error')
      savedTimer.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [user, planId])

  // Cleanup: flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      if (statusFlushTimer.current) clearTimeout(statusFlushTimer.current)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      if (pendingToggles.current.length > 0) flushToggles()
      if (pendingStatus.current) flushStatus()
    }
  }, [flushToggles, flushStatus])

  function handleToggleStatus() {
    if (!plan) return
    const next: 'active' | 'paused' = plan.status === 'active' ? 'paused' : 'active'
    // Optimistic update
    setPlan((prev) => {
      if (!prev) return prev
      if (next === 'active') {
        // Compute start/end locally so title and heatmap update immediately
        const now = new Date()
        const startDate = localDateStr(now)
        const endObj = new Date(now)
        endObj.setMonth(endObj.getMonth() + prev.durationMonths)
        const endDate = localDateStr(endObj)
        return { ...prev, status: next, startDate, endDate }
      }
      return { ...prev, status: next }
    })
    pendingStatus.current = next
    if (statusFlushTimer.current) clearTimeout(statusFlushTimer.current)
    statusFlushTimer.current = setTimeout(flushStatus, 500)
  }

  // Progress for this plan
  const progressMap = useMemo(() => {
    const map = new Map<string, DailyProgress>()
    for (const p of progress) map.set(p.date, p)
    return map
  }, [progress])

  const todayProgress = progressMap.get(today)
  const todayCompleted = todayProgress?.completedItemIds ?? []

  function handleToggle(itemId: string) {
    if (!user || !planId) return
    // Don't allow toggling when the plan isn't active
    if (plan?.status !== 'active') return

    // Optimistic UI update
    setProgress((prev) => {
      const idx = prev.findIndex((p) => p.date === today)
      if (idx >= 0) {
        const existing = prev[idx]
        const ids = existing.completedItemIds.includes(itemId)
          ? existing.completedItemIds.filter((id) => id !== itemId)
          : [...existing.completedItemIds, itemId]
        const next = [...prev]
        next[idx] = { ...existing, completedItemIds: ids }
        return next
      }
      return [...prev, { planId, userId: user.sub, date: today, completedItemIds: [itemId] }]
    })

    // Queue the toggle and debounce the API call
    pendingToggles.current.push(itemId)
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flushToggles, 800)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <AppHeader breadcrumb="Plan Dashboard" hideAddVideo />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <AppHeader breadcrumb="Plan Dashboard" hideAddVideo />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Plan not found
        </div>
      </div>
    )
  }

  const totalItems = plan.items.length
  const streak = calcStreak(progressMap, totalItems)

  const progressDates = Array.from(progressMap.keys()).sort()
  const startDate = normalizeDateStr(plan.startDate) || progressDates[0] || today
  // Always derive endDate from startDate + durationMonths so edits to duration
  // take effect immediately (the stored plan.endDate may be stale from the
  // last activation).
  const endDate = (() => {
    const startD = parseLocalDate(startDate)
    const endD = new Date(startD)
    endD.setMonth(endD.getMonth() + plan.durationMonths)
    endD.setDate(endD.getDate() - 1)
    return localDateStr(endD)
  })()
  const allDays = buildDaysList(startDate, endDate > today ? today : endDate)
  const completedDays = allDays.filter((d) => {
    const p = progressMap.get(d)
    return p && p.completedItemIds.length >= totalItems
  }).length
  const completionRate = allDays.length > 0 ? Math.round((completedDays / allDays.length) * 100) : 0

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader breadcrumb={plan.name} hideAddVideo />

      <main className="flex-1 px-4 py-4 md:px-6 md:py-6 max-w-4xl mx-auto w-full">
        <Link
          to="/plans"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Plans
        </Link>

        {/* Page title */}
        <div className="mb-5 md:mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg md:text-2xl font-bold tracking-tight wrap-break-word">{plan.name}</h1>
            <p className="text-[11px] md:text-xs text-muted-foreground mt-1">
              {startDate} → {endDate}
            </p>
          </div>
          <StatusToggle active={plan.status === 'active'} onToggle={handleToggleStatus} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 mb-5 md:mb-6">
          <StatCard
            icon={<Flame className="w-4 h-4 text-orange-500" />}
            label="Streak"
            value={`${streak} day${streak !== 1 ? 's' : ''}`}
          />
          <StatCard
            icon={<Trophy className="w-4 h-4 text-yellow-500" />}
            label="Completed Days"
            value={`${completedDays}/${allDays.length}`}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-green-500" />}
            label="Completion Rate"
            value={`${completionRate}%`}
            sub={`${completedDays} of ${allDays.length} days`}
          />
          <StatCard
            icon={<Calendar className="w-4 h-4 text-blue-500" />}
            label="Plan Duration"
            value={`${plan.durationMonths} mo`}
            sub={startDate && endDate ? `${startDate} → ${endDate}` : ''}
          />
        </div>

        {/* Today's checklist */}
        <div className="rounded-xl border border-border bg-card p-3 md:p-4 mb-5 md:mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 min-w-0">
              <Target className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">Today's Tasks</span>
            </p>
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
              <span className="text-[11px] md:text-xs text-muted-foreground whitespace-nowrap">
                {todayCompleted.length}/{totalItems} done
              </span>
            </div>
          </div>

          <div className="h-1.5 rounded-full bg-muted mb-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: `${totalItems > 0 ? (todayCompleted.length / totalItems) * 100 : 0}%` }}
            />
          </div>

          {todayCompleted.length >= totalItems && totalItems > 0 && (
            <div className="mb-3 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-center">
              <p className="text-sm font-semibold text-green-600">All tasks completed today!</p>
            </div>
          )}

          <div className="space-y-1">
            {plan.items.map((item) => {
              const done = todayCompleted.includes(item.id)
              const disabled = plan.status !== 'active'
              return (
                <button
                  key={item.id}
                  onClick={() => handleToggle(item.id)}
                  disabled={disabled}
                  className={[
                    'w-full flex items-center gap-3 px-2.5 md:px-3 py-3 md:py-2.5 rounded-lg text-left transition-colors',
                    done ? 'bg-green-500/5' : '',
                    disabled ? 'cursor-not-allowed opacity-60' : done ? 'hover:bg-green-500/10' : 'hover:bg-muted',
                  ].join(' ')}
                >
                  <span className={[
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                    done ? 'bg-green-500 border-green-500 text-white' : 'border-border',
                  ].join(' ')}>
                    {done && <Check className="w-3 h-3" />}
                  </span>
                  <span className={[
                    'text-sm min-w-0 wrap-break-word',
                    done ? 'line-through text-muted-foreground' : '',
                  ].join(' ')}>
                    {item.text}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 12-month heatmap for this plan */}
        <ActivityHeatmap
          progressMap={progressMap}
          totalItems={totalItems}
          planStart={startDate}
          planEnd={endDate}
          today={today}
        />
      </main>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── HeatmapGrid ─────────────────────────────────────────────────────────────

type CellInfo = { ratio: number; inPlan: boolean; completed?: number }

function HeatmapGrid({
  weeks,
  monthLabels,
  getCellInfo,
  progressMap,
  totalItems,
  today,
  planStart,
  planEnd,
  fluid = false,
  cellPx,
  gapPx = 2,
}: {
  weeks: { date: string }[][]
  monthLabels: { label: string; col: number; monthKey: string }[]
  getCellInfo: (date: string) => CellInfo
  progressMap: Map<string, DailyProgress>
  totalItems: number
  today: string
  planStart: string
  planEnd: string
  fluid?: boolean
  cellPx?: number
  gapPx?: number
}) {
  const totalWeeks = weeks.length
  const dowLabelWidth = fluid ? 24 : 16

  // Grid template: first column is DOW labels (fixed), then one col per week.
  const weekCol = fluid ? '1fr' : `${cellPx}px`
  const gridTemplate = `${dowLabelWidth}px repeat(${totalWeeks}, ${weekCol})`
  const rowMarginBottom = `${gapPx}px`
  const gap = `${gapPx}px`

  return (
    <div>
      {/* Month labels row */}
      <div
        className="grid mb-1 h-3.5"
        style={{ gridTemplateColumns: gridTemplate, gap }}
      >
        <div />
        {weeks.map((_, wi) => {
          const label = monthLabels.find((l) => l.col === wi)
          const inPlan = label ? monthInPlan(label.monthKey, planStart, planEnd) : false
          return (
            <div key={wi} className="min-w-0 relative">
              {label && (
                <span
                  className={`absolute left-0 text-[9px] whitespace-nowrap ${
                    inPlan ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
                  }`}
                >
                  {label.label}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* 7 rows */}
      {Array.from({ length: 7 }, (_, rowIdx) => (
        <div
          key={rowIdx}
          className="grid"
          style={{ gridTemplateColumns: gridTemplate, gap, marginBottom: rowMarginBottom }}
        >
          <div className="flex items-center justify-end pr-1">
            <span className="text-[9px] text-muted-foreground leading-none">{DAY_LABELS[rowIdx]}</span>
          </div>

          {weeks.map((week, wi) => {
            const day = week[rowIdx]
            if (!day || !day.date) {
              return <div key={`e-${wi}`} className="aspect-square" />
            }

            const isFuture = day.date > today
            const { ratio, inPlan } = getCellInfo(day.date)

            let bg: string
            if (!inPlan) {
              bg = 'bg-muted/60'
            } else if (isFuture) {
              bg = 'bg-muted-foreground/20'
            } else if (ratio >= 1) {
              bg = 'bg-green-500'
            } else if (ratio >= 0.5) {
              bg = 'bg-green-400/80'
            } else if (ratio > 0) {
              bg = 'bg-green-300/70'
            } else {
              bg = 'bg-muted-foreground/40'
            }

            const prog = progressMap.get(day.date)
            const completed = prog?.completedItemIds.length ?? 0

            return (
              <div
                key={day.date}
                className="relative aspect-square min-w-0"
                title={`${day.date}${inPlan ? `: ${completed}/${totalItems}` : ''}`}
              >
                <div className={`absolute inset-0 rounded-[3px] ${bg}`} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StatusToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={active}
      title={active ? 'Active — click to pause' : 'Paused — click to activate'}
      className="inline-flex items-center gap-2 shrink-0 group"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
        {active ? 'Active' : 'Paused'}
      </span>
      <span
        className={[
          'relative w-10 h-6 rounded-full transition-colors',
          active ? 'bg-green-500' : 'bg-muted-foreground/30',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
            active ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
    </button>
  )
}

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 md:p-3 min-w-0">
      <div className="flex items-center gap-1.5 mb-1 md:mb-1.5">
        {icon}
        <span className="text-[9px] md:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className="text-base md:text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="hidden md:block text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// ─── Activity Heatmap (12 months, single plan) ──────────────────────────────

const DAY_LABELS = ['M', '', 'W', '', 'F', '', '']

function ActivityHeatmap({
  progressMap,
  totalItems,
  planStart,
  planEnd,
  today,
}: {
  progressMap: Map<string, DailyProgress>
  totalItems: number
  planStart: string
  planEnd: string
  today: string
}) {
  const weeks = useMemo(() => build12MonthWeeks(), [])
  const monthLabels = useMemo(() => buildMonthLabels(weeks), [weeks])

  function getCellInfo(date: string) {
    const inPlan = date >= planStart && date <= planEnd
    if (!inPlan) return { ratio: -1, inPlan: false }
    const prog = progressMap.get(date)
    const completed = prog?.completedItemIds.length ?? 0
    const ratio = totalItems > 0 ? completed / totalItems : 0
    return { ratio, inPlan: true, completed }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" /> Activity
      </p>

      {/*
        Two layouts:
        - Mobile (< md): fixed 11x11 cells, horizontally scrollable. Sticky DOW column.
        - md+: fluid grid that stretches to fill width with 1fr columns.
      */}

      {/* Mobile: horizontally scrollable fixed grid */}
      <div className="md:hidden -mx-1 overflow-x-auto">
        <div className="px-1 inline-block min-w-full">
          <HeatmapGrid
            weeks={weeks}
            monthLabels={monthLabels}
            getCellInfo={getCellInfo}
            progressMap={progressMap}
            totalItems={totalItems}
            today={today}
            planStart={planStart}
            planEnd={planEnd}
            cellPx={12}
            gapPx={2}
          />
        </div>
      </div>

      {/* md+: fluid layout */}
      <div className="hidden md:block">
        <HeatmapGrid
          weeks={weeks}
          monthLabels={monthLabels}
          getCellInfo={getCellInfo}
          progressMap={progressMap}
          totalItems={totalItems}
          today={today}
          planStart={planStart}
          planEnd={planEnd}
          fluid
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Less</span>
          <div className="w-2.5 h-2.5 rounded-[4px] bg-muted-foreground/40" />
          <div className="w-2.5 h-2.5 rounded-[4px] bg-green-300/70" />
          <div className="w-2.5 h-2.5 rounded-[4px] bg-green-400/80" />
          <div className="w-2.5 h-2.5 rounded-[4px] bg-green-500" />
          <span>More</span>
        </div>
      </div>
    </div>
  )
}
