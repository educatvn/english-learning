import { LogOut, BarChart2, Shield, StickyNote, BookOpen, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export function UserButton() {
  const { user, isAdmin, signOut } = useAuth();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full overflow-hidden ring-2 ring-transparent hover:ring-border transition-all w-7 h-7 p-0"
          title={user.name}
        >
          <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {/* User info */}
        <div className="px-3 py-2.5">
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

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/progress" className="flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5" />
            My Progress
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/notes" className="flex items-center gap-2">
            <StickyNote className="w-3.5 h-3.5" />
            My Notes
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/vocabulary" className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5" />
            My Vocabulary
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/plans" className="flex items-center gap-2">
            <ClipboardCheck className="w-3.5 h-3.5" />
            My Plans
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={signOut}>
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
