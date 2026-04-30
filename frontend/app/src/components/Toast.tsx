import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: ToastKind; title: string; message?: string; ttl: number };

type ToastCtx = {
  show: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return c;
}

let _seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = ++_seq;
    const ttl = kind === 'error' ? 6000 : 3500;
    setToasts(t => [...t, { id, kind, title, message, ttl }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ttl);
  }, []);

  const api: ToastCtx = {
    show,
    success: (t, m) => show('success', t, m),
    error:   (t, m) => show('error', t, m),
    info:    (t, m) => show('info', t, m),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-[400] flex flex-col gap-2 max-w-[calc(100vw-32px)] sm:max-w-[400px]">
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onClose={() => setToasts(s => s.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { kind, title, message } = toast;
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'error' ? AlertCircle : Info;
  const colors = {
    success: 'bg-green-bg border-green-bd text-green',
    error:   'bg-red-bg   border-red-bd   text-red',
    info:    'bg-blue-bg  border-blue-bd  text-blue',
  }[kind];

  return (
    <div
      className={cn(
        'transition-all duration-200 transform',
        mounted ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0',
      )}
    >
      <div className={cn('rounded-lg border shadow-lg p-3 pr-8 flex items-start gap-2.5 bg-bg2 relative', 'border-border')}>
        <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0 border', colors)}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-text">{title}</div>
          {message && <div className="text-[11.5px] text-text2 mt-0.5">{message}</div>}
        </div>
        <button
          type="button"
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-text3 hover:bg-bg3"
          onClick={onClose}
          aria-label="Yopish"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
