import { useSyncExternalStore } from 'react';

const KEY = 'theme';
export type Theme = 'light' | 'dark';

function getInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// The theme lives in one module-level store rather than per-component state.
// Previously every caller of useDarkMode() held its own useState, so toggling
// in the Topbar re-rendered only the Topbar: pages that pick colours in JS
// (`isDark ? darkGradient : lightGradient`) kept their stale value and stayed
// dark until a reload. CSS variables switched instantly, which is why only the
// JS-driven backgrounds looked wrong.
let theme: Theme = getInitial();
const listeners = new Set<() => void>();

function apply(next: Theme) {
  theme = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  localStorage.setItem(KEY, next);
  listeners.forEach((l) => l());
}

// Match the class to the stored value once at load, before first paint.
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useDarkMode() {
  const current = useSyncExternalStore(subscribe, () => theme, () => 'light' as Theme);
  return {
    theme: current,
    toggle: () => apply(current === 'dark' ? 'light' : 'dark'),
    set: apply,
  };
}
