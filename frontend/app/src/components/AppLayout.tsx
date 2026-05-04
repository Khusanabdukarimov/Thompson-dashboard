import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ErrorBoundary } from './ErrorBoundary';
import { CommandPalette } from './CommandPalette';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export function AppLayout() {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Auto-collapse on tablet (<1280px) but only on first mount
  useEffect(() => {
    const w = window.innerWidth;
    if (w >= 768 && w < 1280) setCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Powered by badge */}
      <a
        href="https://www.data365.uz/en"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2 rounded-2xl text-[13px] font-medium transition-all hover:scale-105"
        style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.5)', color: '#374151' }}
      >
        <span style={{ color: '#9ca3af', fontWeight: 400 }}>Powered by</span>
        <span style={{ fontWeight: 700, color: '#111827' }}>data365.uz</span>
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(c => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        {/* Mobile burger floating button — visible only on <md and when sidebar closed */}
        <button
          type="button"
          className="md:hidden fixed top-3 left-3 z-20 w-9 h-9 rounded-lg bg-bg2 border border-border shadow-md flex items-center justify-center hover:bg-bg3"
          onClick={() => setMobileOpen(true)}
          aria-label="Sidebar ochish"
        >
          <Menu className="w-4 h-4 text-text" />
        </button>
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}
