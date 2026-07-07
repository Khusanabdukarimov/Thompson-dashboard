import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Briefcase,
  TrendingUp,
  LayoutDashboard,
  GanttChart,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Moon,
  Sun,
  Users,
  Award,
  ClipboardCheck,
  PieChart,
  Phone,
  Grid3x3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { getStoredRole, type DashboardRole } from "@/lib/auth";

const ALL: DashboardRole[] = ["admin", "owner", "closer", "marketolog", "hunter"];
const MGMT: DashboardRole[] = ["admin", "owner"];
const MKT: DashboardRole[] = ["admin", "owner", "marketolog"];

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: DashboardRole[];
};

const MAIN_NAV: NavItem[] = [
  { to: "/lidlar",          label: "Lidlar",          icon: BarChart3,       roles: [...MKT, "hunter"] },
  { to: "/sdelkalar",          label: "Sdelkalar",          icon: Briefcase,  roles: MKT },
  { to: "/call-statistikasi",  label: "Call statistikasi",  icon: Phone,      roles: MKT },
  { to: "/kampaniyalar",       label: "Kampaniyalar",        icon: TrendingUp, roles: MKT },
  { to: "/kunlik-hisobot",  label: "Kunlik hisobot",  icon: LayoutDashboard, roles: MKT },
  { to: "/reja",            label: "Reja",             icon: GanttChart,      roles: [...MGMT, "closer", "hunter"] },
  { to: "/sozlamalar",      label: "Sozlamalar",       icon: Settings,        roles: MGMT },
];

// Payroll accordion sub-items
const PAYROLL_NAV: NavItem[] = [
  { to: "/payroll",             label: "Payroll Hisoblash", icon: Wallet,         roles: ALL  },
  { to: "/payroll/employees",   label: "Xodimlar",          icon: Users,          roles: MGMT },
  { to: "/payroll/attendance",  label: "Davomat",           icon: ClipboardCheck, roles: ALL  },
  { to: "/payroll/kpi",         label: "KPI Qoidalari",     icon: Award,          roles: MGMT },
  { to: "/payroll/bonus",       label: "Bonuslar",          icon: Award,          roles: MGMT },
  { to: "/payroll/tariflar",    label: "Tariflar",          icon: Grid3x3,        roles: MGMT },
  { to: "/taqsimot",            label: "Taqsimot",          icon: PieChart,       roles: MGMT },
];

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onMobileClose }: Props) {
  const { theme, toggle } = useDarkMode();
  const role = getStoredRole();
  const location = useLocation();
  const canSee = (roles?: DashboardRole[]) => !roles || roles.includes(role);

  const payrollActive = location.pathname.startsWith("/payroll") || location.pathname.startsWith("/taqsimot");
  const [payrollOpen, setPayrollOpen] = useState(payrollActive);

  const linkClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg transition-all mb-0.5 text-[12.5px] border font-normal group relative",
      collapsed
        ? "px-2.5 py-2 md:justify-center md:w-10 md:h-10 md:mx-auto md:px-0 md:py-0"
        : "px-2.5 py-2",
      isActive
        ? "bg-blue-bg border-blue-border text-blue font-semibold"
        : "border-transparent text-text2 hover:bg-bg3 hover:text-text",
    );

  return (
    <>
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "bg-bg2 border-r border-border flex flex-col shadow-md shrink-0 transition-[width] duration-200",
          collapsed ? "md:w-[64px]" : "md:w-[220px]",
          "fixed md:static inset-y-0 left-0 z-40 w-[240px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Logo */}
        <div className="px-3 py-3.5 border-b border-border flex items-center gap-2.5 min-h-[57px]">
          <div className="w-8 h-8 rounded-[9px] overflow-hidden shrink-0">
            <img src="/logo.png" alt="Thompson" className="w-full h-full object-cover" />
          </div>
          <div className={cn("flex-1 min-w-0", collapsed && "md:hidden")}>
            <div className="text-[14px] font-bold leading-none tracking-tight truncate">
              Thompson
            </div>
            <div className="text-[10px] text-text3 mono mt-0.5 truncate">CRM Analytics</div>
          </div>
          {/* Mobile close */}
          <button
            type="button"
            className="md:hidden w-7 h-7 rounded-md hover:bg-bg3 flex items-center justify-center shrink-0"
            onClick={onMobileClose}
          >
            <X className="w-4 h-4 text-text2" />
          </button>
          {/* Desktop collapse */}
          <button
            type="button"
            className={cn(
              "hidden md:flex w-7 h-7 rounded-md hover:bg-bg3 items-center justify-center shrink-0",
              collapsed && "mx-auto",
            )}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-text2" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-text2" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="px-2 py-3 flex-1 overflow-y-auto flex flex-col gap-0.5">

          {/* Main nav */}
          {MAIN_NAV.filter(i => canSee(i.roles)).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onMobileClose}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) => linkClass(isActive)}
              >
                {({ isActive }) => (
                  <>
                    {isActive && !collapsed && (
                      <span
                        className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-blue"
                        style={{ marginLeft: -8 }}
                      />
                    )}
                    <Icon className="w-[15px] h-[15px] shrink-0" />
                    <span className={cn("truncate", collapsed && "md:hidden")}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}

          {/* Payroll accordion */}
          {PAYROLL_NAV.some(i => canSee(i.roles)) && (
            <>
              <button
                type="button"
                onClick={() => setPayrollOpen(o => !o)}
                title={collapsed ? "Payroll" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg transition-all text-[12.5px] border font-normal w-full",
                  collapsed
                    ? "px-2.5 py-2 md:justify-center md:w-10 md:h-10 md:mx-auto md:px-0 md:py-0"
                    : "px-2.5 py-2",
                  payrollActive
                    ? "bg-blue-bg border-blue-border text-blue font-semibold"
                    : "border-transparent text-text2 hover:bg-bg3 hover:text-text",
                )}
              >
                <Wallet className="w-[15px] h-[15px] shrink-0" />
                <span className={cn("truncate flex-1 text-left", collapsed && "md:hidden")}>
                  Payroll
                </span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform",
                    payrollOpen && "rotate-180",
                    collapsed && "md:hidden",
                  )}
                />
              </button>

              {payrollOpen && !collapsed && (
                <div className="ml-4 pl-2 border-l border-border flex flex-col gap-0.5">
                  {PAYROLL_NAV.filter(i => canSee(i.roles)).map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/payroll"}
                        onClick={onMobileClose}
                        className={({ isActive }) => linkClass(isActive)}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span
                                className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-blue"
                                style={{ marginLeft: -8 }}
                              />
                            )}
                            <Icon className="w-[14px] h-[14px] shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Dark/Light toggle */}
          <div className="mt-auto pt-3 border-t border-border">
            <button
              type="button"
              onClick={toggle}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              className={cn(
                "flex items-center gap-2.5 rounded-lg text-[12.5px] text-text2 hover:bg-bg3 hover:text-text w-full transition-colors border border-transparent",
                collapsed
                  ? "px-2.5 py-2 md:justify-center md:w-10 md:h-10 md:mx-auto md:px-0 md:py-0"
                  : "px-2.5 py-2",
              )}
            >
              {theme === "dark" ? (
                <Sun className="w-[15px] h-[15px] shrink-0" />
              ) : (
                <Moon className="w-[15px] h-[15px] shrink-0" />
              )}
              <span className={cn("truncate", collapsed && "md:hidden")}>
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </span>
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
