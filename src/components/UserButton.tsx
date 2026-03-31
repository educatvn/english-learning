import { useEffect, useRef, useState } from 'react';
import { LogOut, BarChart2, Shield, Clock, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function UserButton() {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="flex relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 rounded-full overflow-hidden ring-2 ring-transparent hover:ring-border transition-all"
        title={user.name}
      >
        <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
      </button>

      {open && (
        <div className="absolute top-9 right-0 w-52 rounded-xl border border-border bg-card shadow-xl py-1 z-50">
          {/* User info */}
          <div className="px-3 py-2.5 border-b border-border">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold truncate">{user.name}</p>
              {isAdmin && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded-full">
                  <Shield className="w-2.5 h-2.5" /> Admin
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{user.email}</p>
          </div>

          {/* Progress link */}
          <Link
            to="/progress"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            My Progress
          </Link>
          <Link
            to="/history"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <Clock className="w-3.5 h-3.5" />
            Watch History
          </Link>
          <Link
            to="/notes"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <StickyNote className="w-3.5 h-3.5" />
            My Notes
          </Link>

          <div className="border-t border-border my-1" />

          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
