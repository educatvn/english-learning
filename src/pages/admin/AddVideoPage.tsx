import { useState } from 'react'
import { Loader2, Video, CheckCircle2, Download, Save, AlertCircle, ChevronRight } from 'lucide-react'
import {
  COMMON_LANGUAGES,
  type VideoInfo,
  type SavedSubtitle,
  fetchVideoInfo,
  fetchSubtitleContent,
  saveSubtitle,
} from '@/services/youtubeSubtitles'

type Step = 'idle' | 'fetching-info' | 'select-lang' | 'fetching-subs' | 'done'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function totalDuration(subtitle: SavedSubtitle): number {
  if (subtitle.cues.length === 0) return 0
  const last = subtitle.cues[subtitle.cues.length - 1]
  return last.start + last.duration
}

export default function AddVideoPage() {
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [selectedLang, setSelectedLang] = useState(COMMON_LANGUAGES[0])
  const [subtitle, setSubtitle] = useState<SavedSubtitle | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleFetchInfo() {
    if (!url.trim()) return
    setError(null)
    setSaved(false)
    setSubtitle(null)
    setVideoInfo(null)
    setStep('fetching-info')

    try {
      const info = await fetchVideoInfo(url.trim())
      setVideoInfo(info)
      setStep('select-lang')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setStep('idle')
    }
  }

  async function handleLoadSubtitles() {
    if (!videoInfo) return
    setError(null)
    setSaved(false)
    setStep('fetching-subs')

    try {
      const data = await fetchSubtitleContent(videoInfo, selectedLang.code, selectedLang.name)
      setSubtitle(data)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setStep('select-lang')
    }
  }

  function handleSave() {
    if (!subtitle) return
    saveSubtitle(subtitle)
    setSaved(true)
  }

  function handleDownload() {
    if (!subtitle) return
    const blob = new Blob([JSON.stringify(subtitle, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${subtitle.videoId}_${subtitle.languageCode}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function handleReset() {
    setUrl('')
    setStep('idle')
    setError(null)
    setVideoInfo(null)
    setSubtitle(null)
    setSaved(false)
  }

  const isLoading = step === 'fetching-info' || step === 'fetching-subs'

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Admin</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span>Add Video</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add Video</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Paste a YouTube URL to fetch and save its subtitles.
          </p>
        </div>

        {/* Step 1 — URL input */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Video URL</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleFetchInfo()}
              disabled={isLoading}
              className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              onClick={handleFetchInfo}
              disabled={!url.trim() || isLoading}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {step === 'fetching-info'
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching…</>
                : 'Fetch Info'
              }
            </button>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 2 — Select language */}
        {videoInfo && (step === 'select-lang' || step === 'fetching-subs' || step === 'done') && (
          <section className="bg-card border border-border rounded-xl p-6 space-y-5">
            {/* Video info */}
            <div className="flex items-start gap-3">
              <img
                src={`https://i.ytimg.com/vi/${videoInfo.videoId}/mqdefault.jpg`}
                alt=""
                className="w-24 h-13.5 rounded-md object-cover shrink-0 bg-muted"
              />
              <div className="min-w-0">
                <p className="font-medium text-sm leading-snug line-clamp-2">{videoInfo.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  youtube.com/watch?v={videoInfo.videoId}
                </p>
              </div>
            </div>

            {/* Language selector */}
            <div>
              <label className="text-sm font-medium mb-3 block">Select Language</label>
              <div className="flex flex-wrap gap-2">
                {COMMON_LANGUAGES.map((lang) => {
                  const isSelected = selectedLang.code === lang.code
                  return (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLang(lang)}
                      disabled={step === 'fetching-subs'}
                      className={[
                        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border hover:border-foreground/30',
                      ].join(' ')}
                    >
                      {lang.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {step !== 'done' && (
              <button
                onClick={handleLoadSubtitles}
                disabled={step === 'fetching-subs'}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {step === 'fetching-subs'
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading subtitles…</>
                  : 'Load Subtitles'
                }
              </button>
            )}
          </section>
        )}

        {/* Step 3 — Preview & Save */}
        {subtitle && step === 'done' && (
          <section className="bg-card border border-border rounded-xl p-6 space-y-5">
            {/* Stats + actions */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="font-medium">{subtitle.cues.length} cues</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{formatDuration(totalDuration(subtitle))}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{subtitle.languageName}</span>
                {subtitle.kind === 'asr' && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
                <button
                  onClick={handleDownload}
                  className="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-accent flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download JSON
                </button>
                <button
                  onClick={handleSave}
                  disabled={saved}
                  className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" /> {saved ? 'Saved' : 'Save to Library'}
                </button>
              </div>
            </div>

            {/* Preview */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Preview (first 30 cues)</p>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">Time</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Text</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {subtitle.cues.slice(0, 30).map((cue, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2 text-muted-foreground font-mono whitespace-nowrap">
                            {formatTime(cue.start)}
                          </td>
                          <td className="px-3 py-2 leading-relaxed">{cue.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {subtitle.cues.length > 30 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  +{subtitle.cues.length - 30} more cues not shown
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-border">
              <button
                onClick={handleReset}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                + Add another video
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
