import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  LayoutDashboard, BarChart3, Users, Briefcase, DollarSign,
  TrendingUp, Wallet, ClipboardCheck, Award, GanttChart, Settings,
  Search, ArrowRight, Moon, Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/useDarkMode';

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const nav = useNavigate();
  const { theme, toggle } = useDarkMode();

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setQuery('');
        setHighlighted(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const commands: Cmd[] = useMemo(() => [
    // Marketing
    { id: 'm-kunlik',       label: "Kunlik hisobot",      hint: 'Marketing', icon: LayoutDashboard, action: () => nav('/marketing/kunlik') },
    { id: 'm-kampaniyalar', label: 'Kampaniyalar',         hint: 'Marketing · Meta Ads', icon: TrendingUp, action: () => nav('/marketing/kampaniyalar') },
    { id: 'm-lidlar',       label: 'Lidlar analitika',     hint: 'Marketing · Bitrix CRM', icon: BarChart3, action: () => nav('/marketing/lidlar') },
    { id: 'm-sdelkalar',    label: 'Sdelkalar',            hint: 'Marketing · Bitrix CRM', icon: Briefcase, action: () => nav('/marketing/sdelkalar') },
    { id: 'm-byudjet',      label: 'Byudjet',              hint: 'Marketing', icon: DollarSign, action: () => nav('/marketing/byudjet') },
    // Payroll
    { id: 'p-dashboard',    label: 'Dashboard',            hint: 'Payroll', icon: LayoutDashboard, action: () => nav('/payroll/dashboard') },
    { id: 'p-reja',         label: 'Reja & Leadlar',       hint: 'Payroll', icon: GanttChart, action: () => nav('/payroll/reja') },
    { id: 'p-employees',    label: 'Xodimlar',             hint: 'Payroll', icon: Users, action: () => nav('/payroll/employees') },
    { id: 'p-attendance',   label: 'Davomat',              hint: 'Payroll · realtime', icon: ClipboardCheck, action: () => nav('/payroll/attendance') },
    { id: 'p-hisobot',      label: 'Hisobot intizomi',     hint: 'Payroll', icon: ClipboardCheck, action: () => nav('/payroll/hisobot') },
    { id: 'p-kpi',          label: 'KPI qoidalar',         hint: 'Payroll', icon: Award, action: () => nav('/payroll/kpi') },
    { id: 'p-bonus',        label: 'Bonuslar',             hint: 'Payroll', icon: Award, action: () => nav('/payroll/bonus') },
    { id: 'p-payroll',      label: 'Oylik hisob',          hint: 'Payroll · breakdown', icon: Wallet, action: () => nav('/payroll/payroll') },
    // System
    { id: 's-settings',     label: 'Sozlamalar',           hint: 'Tizim', icon: Settings, action: () => nav('/sozlamalar') },
    { id: 's-theme',        label: theme === 'dark' ? 'Light mode' : 'Dark mode', hint: 'Tizim · ko\'rinish', icon: theme === 'dark' ? Sun : Moon, action: toggle },
  ], [nav, theme, toggle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      (c.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [commands, query]);

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered, highlighted]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[highlighted];
      if (cmd) { cmd.action(); setOpen(false); }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[400]" />
        <Dialog.Content className="fixed top-[10vh] left-1/2 -translate-x-1/2 bg-bg2 border border-border rounded-xl shadow-lg z-[401] w-[560px] max-w-[calc(100vw-32px)] overflow-hidden">
          <Dialog.Title className="sr-only">Tezkor qidiruv</Dialog.Title>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-text3" />
            <input
              autoFocus
              className="flex-1 border-0 outline-0 bg-transparent text-[14px] text-text placeholder:text-text3"
              placeholder="Sahifa nomini yozing..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
              onKeyDown={handleKey}
            />
            <kbd className="text-[10px] text-text3 px-1.5 py-0.5 border border-border rounded mono">esc</kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <div className="text-center text-text3 text-[13px] py-12">Hech narsa topilmadi</div>
            )}
            {filtered.map((c, i) => {
              const Icon = c.icon;
              const active = i === highlighted;
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => { c.action(); setOpen(false); }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                    active ? 'bg-blue-bg text-blue' : 'text-text2 hover:bg-bg3',
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active && 'text-blue')} />
                  <span className="flex-1 text-[13px] font-medium">{c.label}</span>
                  {c.hint && <span className="text-[11px] text-text3">{c.hint}</span>}
                  {active && <ArrowRight className="w-3.5 h-3.5 text-blue shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-2 flex items-center justify-between text-[10px] text-text3">
            <div className="flex items-center gap-3">
              <span><kbd className="mono px-1 border border-border rounded">↑↓</kbd> tanlash</span>
              <span><kbd className="mono px-1 border border-border rounded">↵</kbd> ochish</span>
            </div>
            <span><kbd className="mono px-1 border border-border rounded">⌘K</kbd> palette</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
