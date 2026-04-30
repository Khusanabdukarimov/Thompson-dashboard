import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, Users, Briefcase, DollarSign,
  TrendingUp, Wallet, ClipboardCheck, Award, GanttChart, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string };
type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: 'Marketing',
    items: [
      { to: '/marketing/kunlik',      label: "Kunlik hisobot", icon: LayoutDashboard },
      { to: '/marketing/kampaniyalar', label: 'Kampaniyalar',  icon: TrendingUp },
      { to: '/marketing/lidlar',       label: 'Lidlar analitika', icon: BarChart3 },
      { to: '/marketing/sdelkalar',    label: 'Sdelkalar',     icon: Briefcase },
      { to: '/marketing/byudjet',      label: 'Byudjet',       icon: DollarSign },
    ],
  },
  {
    title: 'Payroll',
    items: [
      { to: '/payroll/dashboard',  label: 'Dashboard',         icon: LayoutDashboard },
      { to: '/payroll/reja',       label: 'Reja & Leadlar',    icon: GanttChart },
      { to: '/payroll/employees',  label: 'Xodimlar',          icon: Users },
      { to: '/payroll/attendance', label: 'Davomat',           icon: ClipboardCheck, badge: '3' },
      { to: '/payroll/hisobot',    label: 'Hisobot intizomi',  icon: ClipboardCheck },
      { to: '/payroll/kpi',        label: 'KPI qoidalar',      icon: Award },
      { to: '/payroll/bonus',      label: 'Bonuslar',          icon: Award },
      { to: '/payroll/payroll',    label: 'Oylik hisob',       icon: Wallet },
    ],
  },
  {
    title: 'Tizim',
    items: [
      { to: '/sozlamalar', label: 'Sozlamalar', icon: Settings },
    ],
  },
];

export function Sidebar() {
  return (
    <aside className="w-[210px] min-w-[210px] bg-bg2 border-r border-border flex flex-col shadow">
      <div className="px-3.5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 bg-blue-2 rounded-[9px] flex items-center justify-center font-bold text-[14px] text-white tracking-tight">M</div>
        <div>
          <div className="text-[14px] font-semibold leading-none">Mountain</div>
          <div className="text-[10px] text-text3 mono mt-1">v2 · branding</div>
        </div>
      </div>
      <nav className="px-2 py-2.5 flex-1 overflow-y-auto">
        {NAV.map(section => (
          <div key={section.title}>
            <div className="text-[10px] text-text3 px-2 pt-3 pb-1 uppercase tracking-wider font-medium">{section.title}</div>
            {section.items.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded transition-colors mb-px text-[12.5px] border border-transparent font-normal',
                    isActive
                      ? 'bg-blue-bg text-blue border-blue-bd font-medium'
                      : 'text-text2 hover:bg-bg3 hover:text-text',
                  )}
                >
                  <Icon className="w-[15px] h-[15px] shrink-0" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto bg-red text-white text-[10px] px-1.5 py-px rounded-[10px] font-semibold">{item.badge}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
