import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Wallet, ClipboardList,
  TrendingUp, Award, Grid3x3, PieChart, LogOut, ChevronDown, ChevronRight
} from 'lucide-react';
import { clearAuth, isAdmin } from '../lib/auth';

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number }> };
type Section = { label: string | null; items: NavItem[]; adminOnly?: boolean };

const SECTIONS: Section[] = [
  {
    label: null,
    items: [
      { to: '/',           label: 'Dashboard',        icon: LayoutDashboard },
      { to: '/employees',  label: 'Xodimlar',         icon: Users },
      { to: '/attendance', label: 'Davomat',           icon: Clock },
      { to: '/payroll',    label: 'Payroll Hisoblash', icon: Wallet },
      { to: '/hisobot',    label: 'Hisobot',           icon: ClipboardList },
    ],
  },
  {
    label: 'BOSHQARUV',
    adminOnly: true,
    items: [
      { to: '/kpi',       label: 'KPI Qoidalari',  icon: TrendingUp },
      { to: '/bonus',     label: 'Bonuslar',        icon: Award },
      { to: '/tariflar',  label: 'Tariflar',        icon: Grid3x3 },
      { to: '/taqsimot',  label: 'Taqsimot',        icon: PieChart },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const admin = isAdmin();

  const adminSectionActive = SECTIONS[1].items.some(i => location.pathname.startsWith(i.to));
  const [adminOpen, setAdminOpen] = useState(adminSectionActive);

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <aside style={{
      width: 220, minHeight: '100vh', background: 'var(--sidebar-bg)',
      display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700,
          }}>B</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>Brand Payroll</div>
            <div style={{ color: 'var(--sidebar-text)', fontSize: 11 }}>Management System</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {SECTIONS.map((section, si) => {
          if (section.adminOnly && !admin) return null;
          return (
            <div key={si} style={{ marginBottom: 4 }}>
              {section.label && (
                <button
                  onClick={() => setAdminOpen(o => !o)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', color: 'var(--sidebar-section)', fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.08em', borderRadius: 6, transition: 'background .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {section.label}
                  {adminOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              )}
              {(section.label === null || adminOpen) && section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderRadius: 7, marginBottom: 2, fontSize: 13, fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--sidebar-active)' : 'var(--sidebar-text)',
                    background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
                    transition: 'background .15s, color .15s',
                  })}
                  onMouseEnter={e => { const el = e.currentTarget; if (!el.dataset.active) el.style.background = 'var(--sidebar-hover)'; }}
                  onMouseLeave={e => { const el = e.currentTarget; if (!el.dataset.active) el.style.background = ''; }}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={16} />
                      <span>{item.label}</span>
                      {isActive && <span data-active="1" style={{ display: 'none' }} />}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 7, color: 'var(--sidebar-text)',
            fontSize: 13, transition: 'background .15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut size={16} />
          Chiqish
        </button>
      </div>
    </aside>
  );
}
