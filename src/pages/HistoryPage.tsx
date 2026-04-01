import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Play, BarChart2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getProgressData } from '@/services/googleSheets'
import { AppHeader } from '@/components/AppHeader'
import type { WatchSession } from '@/types'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.getTime() === today.getTime()) return 'Today'
  if (d.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function buildLast30Days(): string[] {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (29 - i))
    return d.toISOString().slice(0, 10)
  })
}

// ─── HistoryPage ──────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<WatchSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    getProgressData(user.sub)
      .then(({ sessions }) => setSessions(sessions))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const days = buildLast30Days()
  const byDate = new Map(sessions.map((s) => [s.date, s.seconds]))

  const todayStr = new Date().toISOString().slice(0, 10)
  const todaySecs = byDate.get(todayStr) ?? 0
  const last7Secs = days.slice(-7).reduce((sum, d) => sum + (byDate.get(d) ?? 0), 0)
  const last30Secs = days.reduce((sum, d) => sum + (byDate.get(d) ?? 0), 0)

  const maxSecs = Math.max(...days.map((d) => byDate.get(d) ?? 0), 1)

  const activeDays = days.filter((d) => (byDate.get(d) ?? 0) > 0)
  const isEmpty = !loading && last30Secs === 0

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader breadcrumb="Watch History" hideAddVideo />

      <main className="flex-1 px-4 py-4 md:px-6 md:py-6 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <Clock className="w-4 h-4 animate-pulse" />
            Loading history…
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <BarChart2 className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No watch history yet.</p>
            <Link
              to="/"
              className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Browse videos
            </Link>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
              <SummaryCard label="Today" value={fmtDuration(todaySecs)} />
              <SummaryCard label="Last 7 days" value={fmtDuration(last7Secs)} />
              <SummaryCard label="Last 30 days" value={fmtDuration(last30Secs)} />
            </div>

            {/* Bar chart — 30 days */}
            <div className="rounded-xl border border-border bg-card px-5 pt-4 pb-3 mb-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Daily watch time — last 30 days
              </p>
              <div className="flex items-end gap-0.5 h-24">
                {days.map((d) => {
                  const secs = byDate.get(d) ?? 0
                  const pct = secs / maxSecs
                  const isToday = d === todayStr
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                      <div
                        className={[
                          'w-full rounded-t-sm transition-all',
                          isToday ? 'bg-primary' : 'bg-primary/30 group-hover:bg-primary/50',
                        ].join(' ')}
                        style={{ height: `${Math.max(pct * 100, secs > 0 ? 4 : 0)}%` }}
                      />
                      {/* Tooltip */}
                      {secs > 0 && (
                        <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-popover border border-border text-[10px] text-foreground px-2 py-1 rounded shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                          {dayLabel(d)}: {fmtDuration(secs)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/60">
                <span>{days[0]?.slice(5)}</span>
                <span>Today</span>
              </div>
            </div>

            {/* Day list — only days with activity */}
            {activeDays.length > 0 && (
              <div className="space-y-2">
                {[...activeDays].reverse().map((d) => (
                  <div
                    key={d}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm">{dayLabel(d)}</span>
                      <span className="text-xs text-muted-foreground">{d}</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{fmtDuration(byDate.get(d)!)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
