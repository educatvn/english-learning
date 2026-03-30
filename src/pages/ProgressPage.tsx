import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Clock, Brain, TrendingUp, ExternalLink, Check, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getProgressData } from '@/services/googleSheets'
import { loadVideos } from '@/services/videos'
import { UserButton } from '@/components/UserButton'
import type { ProgressData } from '@/services/googleSheets'
import type { VideoMeta } from '@/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

type Period = 'today' | '7d' | '30d'

function buildDaysList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}

// ─── ProgressPage ─────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const { user } = useAuth()
  const [data, setData] = useState<ProgressData | null>(null)
  const [videos, setVideos] = useState<Map<string, VideoMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('7d')
  const [histTab, setHistTab] = useState<'watch' | 'quiz'>('watch')

  useEffect(() => {
    if (!user) return
    Promise.all([getProgressData(user.sub), loadVideos()])
      .then(([progress, allVideos]) => {
        setData(progress)
        setVideos(new Map(allVideos.map((v) => [v.videoId, v])))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  // ── Derived data ─────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)

  // Chart always shows context: 7 bars for today/7d, 30 bars for 30d
  const chartDaysList = buildDaysList(period === '30d' ? 30 : 7)

  // Stats filtered by selected period
  const periodDays = new Set(period === 'today' ? [todayStr] : chartDaysList)

  const secondsByDay = (() => {
    const map = new Map<string, number>()
    for (const s of data?.sessions ?? []) {
      map.set(s.date, (map.get(s.date) ?? 0) + s.seconds)
    }
    return map
  })()

  const periodSessions = (data?.sessions ?? []).filter((s) => periodDays.has(s.date))
  const periodQuizzes = (data?.quizzes ?? []).filter((q) => periodDays.has(q.answeredAt.slice(0, 10)))
  const periodWatchSecs = periodSessions.reduce((sum, s) => sum + s.seconds, 0)
  const periodQuizCount = periodQuizzes.length
  const periodCorrect = periodQuizzes.filter((q) => q.correct).length
  const periodAccuracy = periodQuizCount > 0 ? Math.round((periodCorrect / periodQuizCount) * 100) : null

  // Watch time by video (all-time, for Watch History tab)
  const watchByVideo = (() => {
    if (!data) return []
    const map = new Map<string, number>()
    for (const s of data.sessions) map.set(s.videoId, (map.get(s.videoId) ?? 0) + s.seconds)
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([videoId, seconds]) => ({ videoId, seconds, video: videos.get(videoId) }))
  })()

  const quizHistory = [...(data?.quizzes ?? [])].sort(
    (a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime(),
  )

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors font-medium">
              English Learning
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold">My Progress</span>
          </div>
          <UserButton />
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading your progress…
        </div>
      ) : (
        <main className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">

          {/* Period selector */}
          <div className="flex gap-0.5 mb-6 p-1 rounded-lg bg-muted w-fit">
            {(['today', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={[
                  'px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
                  period === p
                    ? 'bg-card shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {p === 'today' ? 'Today' : p === '7d' ? 'Last 7 days' : 'Last 30 days'}
              </button>
            ))}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard
              icon={<Clock className="w-4 h-4 text-blue-500" />}
              label="Watch Time"
              value={fmtDuration(periodWatchSecs)}
              sub={`${periodSessions.length} session${periodSessions.length !== 1 ? 's' : ''}`}
            />
            <StatCard
              icon={<Brain className="w-4 h-4 text-purple-500" />}
              label="Quiz Attempts"
              value={periodQuizCount.toString()}
              sub={periodCorrect > 0 ? `${periodCorrect} correct` : 'No quizzes yet'}
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4 text-green-500" />}
              label="Accuracy"
              value={periodAccuracy !== null ? `${periodAccuracy}%` : '—'}
              sub={periodAccuracy !== null ? `${periodQuizCount} attempts` : 'Do some quizzes first'}
            />
          </div>

          {/* Daily chart */}
          <DailyChart
            days={chartDaysList}
            secondsByDay={secondsByDay}
            todayStr={todayStr}
            highlightToday={period === 'today'}
          />

          {/* History tabs */}
          <div className="mt-8">
            <div className="flex gap-1 mb-5 border-b border-border">
              <TabButton active={histTab === 'watch'} onClick={() => setHistTab('watch')}>
                <Clock className="w-3.5 h-3.5" /> Watch History
              </TabButton>
              <TabButton active={histTab === 'quiz'} onClick={() => setHistTab('quiz')}>
                <Brain className="w-3.5 h-3.5" /> Quiz History
              </TabButton>
            </div>

            {histTab === 'watch' && (
              watchByVideo.length === 0 ? (
                <EmptyState message="No watch history yet. Start watching some videos!" />
              ) : (
                <div className="space-y-2">
                  {watchByVideo.map(({ videoId, seconds, video }) => (
                    <div
                      key={videoId}
                      className="flex items-center gap-4 p-3 rounded-xl border border-border bg-card hover:border-foreground/20 transition-colors"
                    >
                      {video?.thumbnailUrl && (
                        <img src={video.thumbnailUrl} alt="" className="w-20 rounded-lg aspect-video object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{video?.title ?? videoId}</p>
                        {video?.channelName && (
                          <p className="text-xs text-muted-foreground mt-0.5">{video.channelName}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">{fmtDuration(seconds)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">total</p>
                      </div>
                      <Link
                        to={`/play/${videoId}`}
                        className="shrink-0 w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                        title="Open video"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  ))}
                </div>
              )
            )}

            {histTab === 'quiz' && (
              quizHistory.length === 0 ? (
                <EmptyState message="No quiz history yet. Enable Quiz mode and practice some cues!" />
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Result</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target word</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your answer</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Video</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {quizHistory.map((q, i) => {
                        const video = videos.get(q.videoId)
                        return (
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              {q.correct ? (
                                <span className="inline-flex items-center gap-1 text-green-600 font-medium text-xs">
                                  <Check className="w-3.5 h-3.5" /> Correct
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-500 font-medium text-xs">
                                  <X className="w-3.5 h-3.5" /> Incorrect
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-medium">{q.targetWord}</td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {q.correct
                                ? <span className="text-green-600">{q.userAnswer}</span>
                                : <span className="text-red-500">{q.userAnswer}</span>}
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              <p className="text-xs text-muted-foreground truncate">{video?.title ?? q.videoId}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              <p>{fmtDate(q.answeredAt)}</p>
                              <p className="text-[10px] mt-0.5">{fmtTime(q.answeredAt)}</p>
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                to={`/play/${q.videoId}?t=${q.cueStartMs}`}
                                className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                                title="Play at this moment"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </main>
      )}
    </div>
  )
}

// ─── DailyChart ───────────────────────────────────────────────────────────────

const CHART_H = 96 // px

function DailyChart({
  days,
  secondsByDay,
  todayStr,
  highlightToday,
}: {
  days: string[]
  secondsByDay: Map<string, number>
  todayStr: string
  highlightToday: boolean
}) {
  const maxSecs = Math.max(...days.map((d) => secondsByDay.get(d) ?? 0), 1)
  const show30Labels = days.length > 14

  return (
    <div className="rounded-xl border border-border bg-card px-5 pt-4 pb-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Daily watch time
      </p>

      {/* Bars */}
      <div className="flex items-end gap-1" style={{ height: CHART_H }}>
        {days.map((day) => {
          const secs = secondsByDay.get(day) ?? 0
          const barH = secs > 0 ? Math.max(Math.round((secs / maxSecs) * CHART_H), 4) : 2
          const isToday = day === todayStr
          const label = new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
            month: 'short', day: 'numeric',
          })

          return (
            <div key={day} className="group relative flex-1 flex flex-col justify-end items-center">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] rounded-md px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                <span className="font-medium">{label}</span>
                <span className="text-gray-400 ml-1.5">{secs > 0 ? fmtDuration(secs) : '—'}</span>
              </div>

              {/* Bar */}
              <div
                className={[
                  'w-full rounded-t-sm transition-opacity',
                  secs > 0
                    ? (isToday && highlightToday)
                      ? 'bg-blue-500'
                      : isToday
                        ? 'bg-blue-500'
                        : 'bg-blue-400/60 hover:bg-blue-400/90'
                    : 'bg-border/40',
                ].join(' ')}
                style={{ height: barH }}
              />
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1 mt-1.5">
        {days.map((day) => {
          const isToday = day === todayStr
          const d = new Date(day + 'T12:00:00Z')
          const label = show30Labels
            ? d.getUTCDate().toString()
            : d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)

          return (
            <div key={day} className="flex-1 text-center">
              <span className={[
                'text-[9px]',
                isToday ? 'text-foreground font-bold' : 'text-muted-foreground',
              ].join(' ')}>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Y-axis hint */}
      {maxSecs > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Peak: {fmtDuration(maxSecs)}
        </p>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground text-sm">{message}</div>
  )
}
