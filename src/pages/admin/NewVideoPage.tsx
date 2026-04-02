import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Video, CheckCircle2, AlertCircle, ChevronRight, Play, Plus, Check, ListVideo, RefreshCw } from 'lucide-react';
import { extractVideoId } from '@/services/youtubeSubtitles';
import { loadPlaylists, savePlaylist } from '@/services/playlists';
import { saveVideo, loadVideos } from '@/services/videos';
import { parseJSON3 } from '@/utils/captionParser';
import { indexVideoWords, getIndexedVideoIds } from '@/services/vocabulary';
import type { Playlist, VideoMeta } from '@/types';

// ── Word extractor ────────────────────────────────────────────────────────────

function extractWords(cues: { text: string }[]): string[] {
  const wordRe = /[a-zA-Z][a-zA-Z']*[a-zA-Z]|[a-zA-Z]/g;
  const set = new Set<string>();
  for (const cue of cues) {
    const matches = cue.text.toLowerCase().match(wordRe) ?? [];
    for (const w of matches) set.add(w.replace(/^'+|'+$/g, ''));
  }
  return [...set];
}

type Step = 'idle' | 'fetching-info' | 'preview' | 'saving' | 'done';

export default function NewVideoPage() {
  const [input, setInput] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [savedVideoId, setSavedVideoId] = useState<string | null>(null);

  // Playlist state — loaded when preview opens
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  async function handleFetchInfo() {
    const raw = input.trim();
    if (!raw) return;

    const videoId = raw.length === 11 && !raw.includes('/') ? raw : extractVideoId(raw);

    if (!videoId) {
      setError('Không nhận ra video ID hoặc URL YouTube');
      return;
    }

    setError(null);
    setMeta(null);
    setSavedVideoId(null);
    setStep('fetching-info');

    try {
      const res = await fetch(`/youtube-proxy/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
      if (!res.ok) throw new Error('Không fetch được thông tin video');
      const oembed = (await res.json()) as { title?: string; author_name?: string };

      setMeta({
        videoId,
        title: oembed.title ?? videoId,
        channelName: oembed.author_name ?? '',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        addedAt: new Date().toISOString(),
      });
      // Load playlists for the selector (system playlists only — use empty userId)
      const pls = await loadPlaylists('');
      setPlaylists(pls);
      setSelectedPlaylistIds(new Set());
      setCreatingPlaylist(false);
      setNewPlaylistName('');
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
      setStep('idle');
    }
  }

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim();
    if (!name) return;
    const playlist: Playlist = {
      id: Date.now().toString(),
      name,
      videoIds: [],
      createdAt: new Date().toISOString(),
      ownerId: '',
      isSystem: true,
      isPublic: true,
    };
    // Optimistic UI then async save
    setPlaylists(prev => [...prev, playlist]);
    setSelectedPlaylistIds(prev => new Set([...prev, playlist.id]));
    setNewPlaylistName('');
    setCreatingPlaylist(false);
    void savePlaylist(playlist);
  }

  function togglePlaylist(id: string) {
    setSelectedPlaylistIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!meta) return;
    setError(null);
    setStep('saving');

    const base = import.meta.env.BASE_URL;
    try {
      // 1. Fetch + validate captions first (required)
      const captionPaths = [`${base}videos/${meta.videoId}/captions.json`, `${base}captions/${meta.videoId}.json`];
      let captions: unknown = null;
      for (const path of captionPaths) {
        try {
          const res = await fetch(path);
          if (res.ok) {
            captions = await res.json();
            break;
          }
        } catch {
          /* try next */
        }
      }
      if (!captions) throw new Error('Không tìm thấy caption cho video này. Vui lòng thêm file captions.json trước.');
      const { cues } = parseJSON3(captions);
      if (cues.length === 0) throw new Error('File captions.json rỗng hoặc không hợp lệ.');

      // 2. Save video meta + index words
      await saveVideo(meta);
      await indexVideoWords(meta.videoId, extractWords(cues));

      // 3. Add to selected playlists
      for (const playlistId of selectedPlaylistIds) {
        const playlist = playlists.find(p => p.id === playlistId);
        if (!playlist || playlist.videoIds.includes(meta.videoId)) continue;
        void savePlaylist({ ...playlist, videoIds: [...playlist.videoIds, meta.videoId] });
      }

      setSavedVideoId(meta.videoId);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi khi lưu');
      setStep('preview');
    }
  }

  function handleReset() {
    setInput('');
    setStep('idle');
    setError(null);
    setMeta(null);
    setSavedVideoId(null);
    setSelectedPlaylistIds(new Set());
    setNewPlaylistName('');
    setCreatingPlaylist(false);
  }

  const isSaving = step === 'saving';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/" className="font-medium text-foreground hover:text-foreground/70 transition-colors">
            English Learning
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span>New Video</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add New Video</h1>
          <p className="text-muted-foreground mt-1 text-sm">Nhập video ID hoặc URL YouTube để thêm vào thư viện.</p>
        </div>

        {/* Step 1 — Input */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Video ID hoặc URL</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="S7mfygW40Cs  hoặc  https://www.youtube.com/watch?v=..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && step === 'idle' && handleFetchInfo()}
              disabled={step !== 'idle'}
              className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            {step === 'idle' && (
              <button
                onClick={handleFetchInfo}
                disabled={!input.trim()}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                Tìm kiếm
              </button>
            )}
            {step === 'fetching-info' && (
              <button
                disabled
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium opacity-60 flex items-center gap-2"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải…
              </button>
            )}
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 2 — Preview + Language + Playlist + Save (all in one) */}
        {meta && (step === 'preview' || step === 'saving') && (
          <section className="bg-card border border-border rounded-xl p-6 space-y-6">
            {/* Video info */}
            <div className="flex gap-4">
              <img src={meta.thumbnailUrl} alt="" className="w-36 rounded-lg object-cover bg-muted shrink-0" />
              <div className="min-w-0 flex flex-col gap-1 justify-center">
                <p className="font-semibold text-sm leading-snug line-clamp-3">{meta.title}</p>
                {meta.channelName && <p className="text-xs text-muted-foreground">{meta.channelName}</p>}
                <p className="text-xs text-muted-foreground font-mono mt-1">{meta.videoId}</p>
              </div>
            </div>

            <div className="border-t border-border" />

            <div className="border-t border-border" />

            {/* Playlist selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ListVideo className="w-3.5 h-3.5" /> Thêm vào playlist
                  <span className="normal-case font-normal text-muted-foreground">(tùy chọn)</span>
                </label>
                <button
                  onClick={() => setCreatingPlaylist(true)}
                  disabled={isSaving || creatingPlaylist}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> New playlist
                </button>
              </div>

              {/* Inline new playlist form */}
              {creatingPlaylist && (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newPlaylistName}
                    onChange={e => setNewPlaylistName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreatePlaylist();
                      if (e.key === 'Escape') {
                        setCreatingPlaylist(false);
                        setNewPlaylistName('');
                      }
                    }}
                    placeholder="Tên playlist…"
                    className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={handleCreatePlaylist}
                    disabled={!newPlaylistName.trim()}
                    className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    Tạo
                  </button>
                  <button
                    onClick={() => {
                      setCreatingPlaylist(false);
                      setNewPlaylistName('');
                    }}
                    className="h-8 px-2 rounded-md border border-border text-xs hover:bg-accent transition-colors"
                  >
                    Hủy
                  </button>
                </div>
              )}

              {playlists.length === 0 && !creatingPlaylist ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có playlist nào.{' '}
                  <button onClick={() => setCreatingPlaylist(true)} className="underline hover:text-foreground transition-colors">
                    Tạo playlist mới
                  </button>
                </p>
              ) : playlists.length > 0 ? (
                <div className="rounded-lg border border-border overflow-hidden">
                  {playlists.map(playlist => {
                    const checked = selectedPlaylistIds.has(playlist.id);
                    return (
                      <button
                        key={playlist.id}
                        onClick={() => togglePlaylist(playlist.id)}
                        disabled={isSaving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent border-b border-border/60 last:border-b-0 transition-colors text-left disabled:opacity-50"
                      >
                        <div
                          className={[
                            'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                            checked ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                          ].join(' ')}
                        >
                          {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                        </div>
                        <span className="text-sm flex-1">{playlist.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {playlist.videoIds.length} video{playlist.videoIds.length !== 1 ? 's' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="border-t border-border" />

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lưu…
                  </>
                ) : (
                  'Lưu vào thư viện'
                )}
              </button>
              <button
                onClick={handleReset}
                disabled={isSaving}
                className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-accent transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
            </div>
          </section>
        )}

        {/* Re-index tool */}
        {step === 'idle' && <ReindexSection />}

        {/* Done */}
        {step === 'done' && savedVideoId && (
          <section className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium text-sm">
                Đã lưu{selectedPlaylistIds.size > 0 ? ` và thêm vào ${selectedPlaylistIds.size} playlist` : ''}!
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to={`/play/${savedVideoId}`}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center gap-2 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Xem ngay
              </Link>
              <Link
                to="/"
                className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-accent flex items-center gap-1.5 transition-colors"
              >
                Về trang chủ
              </Link>
              <button onClick={handleReset} className="h-9 px-4 text-sm text-muted-foreground hover:text-foreground transition-colors">
                + Thêm video khác
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ── ReindexSection ────────────────────────────────────────────────────────────

function ReindexSection() {
  const [loading, setLoading] = useState(true);
  const [unindexed, setUnindexed] = useState<VideoMeta[]>([]);
  const [indexingAll, setIndexingAll] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    loadUnindexed();
  }, []);

  async function loadUnindexed() {
    setLoading(true);
    try {
      const [videos, indexedIds] = await Promise.all([loadVideos(), getIndexedVideoIds()]);
      const indexedSet = new Set(indexedIds);
      setUnindexed(videos.filter(v => !indexedSet.has(v.videoId)));
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  async function indexOne(video: VideoMeta): Promise<boolean> {
    const paths = [`${base}videos/${video.videoId}/captions.json`, `${base}captions/${video.videoId}.json`];
    for (const path of paths) {
      try {
        const res = await fetch(path);
        if (!res.ok) continue;
        const data = await res.json();
        const { cues } = parseJSON3(data);
        if (cues.length === 0) continue;
        await indexVideoWords(video.videoId, extractWords(cues));
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async function handleIndexOne(video: VideoMeta) {
    setIndexingId(video.videoId);
    const ok = await indexOne(video);
    if (ok) setUnindexed(prev => prev.filter(v => v.videoId !== video.videoId));
    setIndexingId(null);
  }

  async function handleIndexAll() {
    setIndexingAll(true);
    setProgress({ done: 0, total: unindexed.length });
    const remaining: VideoMeta[] = [];
    for (const video of unindexed) {
      const ok = await indexOne(video);
      if (!ok) remaining.push(video);
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setUnindexed(remaining);
    setIndexingAll(false);
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            Caption index
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Videos chưa được index sẽ không xuất hiện trong "In other videos".</p>
        </div>
        <button
          onClick={loadUnindexed}
          disabled={loading || indexingAll}
          className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors shrink-0"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang kiểm tra…
        </div>
      ) : unindexed.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 className="w-4 h-4" />
          Tất cả video đã được index.
        </div>
      ) : (
        <>
          {/* Index all */}
          {indexingAll ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Đang index {progress.done}/{progress.total}…
              </div>
              <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-200"
                  style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleIndexAll}
              className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Index tất cả ({unindexed.length} video)
            </button>
          )}

          {/* Per-video list */}
          <div className="rounded-lg border border-border overflow-hidden">
            {unindexed.map(video => (
              <div key={video.videoId} className="flex items-center gap-3 px-3 py-2.5 border-b border-border/60 last:border-b-0">
                <img src={video.thumbnailUrl} alt="" className="w-14 aspect-video rounded object-cover shrink-0" />
                <p className="flex-1 text-xs text-foreground line-clamp-2 min-w-0">{video.title}</p>
                <button
                  onClick={() => handleIndexOne(video)}
                  disabled={indexingId === video.videoId || indexingAll}
                  className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors shrink-0"
                >
                  {indexingId === video.videoId ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Index'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
