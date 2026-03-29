import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function UserButton() {
  const { user, signOut } = useAuth();
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
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold truncate">{user.name}</p>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{user.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
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
