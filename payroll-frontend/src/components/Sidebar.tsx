import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Wallet,
  TrendingUp, Award, Grid3x3, LogOut,
} from 'lucide-react';
import { clearAuth, getRole } from '../lib/auth';

const NAV = [
  { to: '/',          label: 'Dashboard',        icon: LayoutDashboard, end: true },
  { to: '/employees', label: 'Xodimlar',         icon: Users },
  { to: '/attendance',label: 'Davomat',           icon: Clock },
  { to: '/kpi',       label: 'KPI Qoidalari',    icon: TrendingUp },
  { to: '/bonus',     label: 'Bonuslar',          icon: Award },
  { to: '/tariflar',  label: 'Tariflar',          icon: Grid3x3 },
  { to: '/payroll',   label: 'Payroll Hisoblash', icon: Wallet },
];

export function Sidebar() {
  const navigate = useNavigate();
  const role = getRole();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <aside style={{
      width: 220, height: '100vh', background: 'var(--sidebar-bg)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 16, fontWeight: 800,
          }}>B</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13.5, lineHeight: 1.25 }}>Brand Payroll</div>
            <div style={{ color: 'rgba(160,174,192,0.8)', fontSize: 10.5 }}>Management System</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              borderRadius: 7, marginBottom: 2, fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#fff' : 'rgba(160,174,192,0.85)',
              background: isActive ? 'rgba(59,130,246,0.22)' : 'transparent',
              textDecoration: 'none', transition: 'background .15s, color .15s',
            })}
            onMouseEnter={e => {
              const el = e.currentTarget;
              if (!el.getAttribute('aria-current')) el.style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              if (!el.getAttribute('aria-current')) el.style.background = 'transparent';
            }}
          >
            {({ isActive }) => (
              <>
                <item.icon size={16} color={isActive ? '#fff' : 'rgba(160,174,192,0.7)'} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: 'rgba(59,130,246,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>A</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Admin User</div>
            <div style={{ color: 'rgba(160,174,192,0.7)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {role || 'Manager'}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', borderRadius: 7, color: 'rgba(160,174,192,0.7)',
            fontSize: 13, transition: 'background .15s', background: 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut size={15} />
          Chiqish
        </button>
      </div>
    </aside>
  );
}
