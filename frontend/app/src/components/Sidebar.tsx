import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Briefcase,
  DollarSign,
  TrendingUp,
  Wallet,
  ClipboardCheck,
  Award,
  GanttChart,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { getStoredRole, type DashboardRole } from "@/lib/auth";

const ALL: DashboardRole[] = [
  "admin",
  "owner",
  "closer",
  "marketolog",
  "hunter",
];
const MGMT: DashboardRole[] = ["admin", "owner"];
const MKT: DashboardRole[] = ["admin", "owner", "marketolog"];

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  roles?: DashboardRole[];
};
type NavSection = { title: string; items: NavItem[]; roles?: DashboardRole[] };

const NAV: NavSection[] = [
  {
    title: "Marketing",
    roles: [...MKT, "hunter"],
    items: [
      {
        to: "/marketing/kunlik",
        label: "Kunlik hisobot",
        icon: LayoutDashboard,
        roles: MKT,
      },
      {
        to: "/marketing/kampaniyalar",
        label: "Kampaniyalar",
        icon: TrendingUp,
        roles: MKT,
      },
      {
        to: "/marketing/lidlar",
        label: "Lidlar analitika",
        icon: BarChart3,
        roles: [...MKT, "hunter"],
      },
      {
        to: "/marketing/sdelkalar",
        label: "Sdelkalar",
        icon: Briefcase,
        roles: MKT,
      },
      {
        to: "/marketing/byudjet",
        label: "Byudjet",
        icon: DollarSign,
        roles: MGMT,
      },
    ],
  },
  {
    title: "Payroll",
    roles: ALL,
    items: [
      {
        to: "/payroll/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        roles: ALL,
      },
      {
        to: "/payroll/reja",
        label: "Reja & Leadlar",
        icon: GanttChart,
        roles: [...MGMT, "closer", "hunter"],
      },
      { to: "/payroll/employees", label: "Xodimlar", icon: Users, roles: MGMT },
      {
        to: "/payroll/attendance",
        label: "Davomat",
        icon: ClipboardCheck,
        roles: ALL,
      },
      {
        to: "/payroll/hisobot",
        label: "Hisobot intizomi",
        icon: ClipboardCheck,
        roles: ALL,
      },
      { to: "/payroll/kpi", label: "KPI qoidalar", icon: Award, roles: MGMT },
      { to: "/payroll/bonus", label: "Bonuslar", icon: Award, roles: MGMT },
      {
        to: "/payroll/payroll",
        label: "Oylik hisob",
        icon: Wallet,
        roles: ALL,
      },
    ],
  },
  {
    title: "Tizim",
    roles: ALL,
    items: [
      { to: "/sozlamalar", label: "Sozlamalar", icon: Settings, roles: MGMT },
    ],
  },
];

type Props = {
  /** Collapsed (icon-only) on tablet+. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Open as drawer on mobile (<md). When closed on mobile, sidebar is hidden. */
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileClose,
}: Props) {
  const { theme, toggle } = useDarkMode();
  const role = getStoredRole();
  const canSee = (roles?: DashboardRole[]) => !roles || roles.includes(role);
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "bg-bg2 border-r border-border flex flex-col shadow shrink-0 transition-[width] duration-200",
          // Desktop: fixed width, collapsible
          collapsed ? "md:w-[64px]" : "md:w-[210px]",
          // Mobile: fixed drawer
          "fixed md:static inset-y-0 left-0 z-40 w-[230px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Header */}
        <div className="px-3 py-3.5 border-b border-border flex items-center gap-2.5 min-h-[57px]">
          <div className="w-8 h-8 bg-blue-2 rounded-[9px] flex items-center justify-center font-bold text-[14px] text-white tracking-tight shrink-0">
            M
          </div>
          {/* Logo text — always visible on mobile drawer; on desktop hidden when collapsed */}
          <div className={cn("flex-1 min-w-0", collapsed && "md:hidden")}>
            <div className="text-[14px] font-semibold leading-none truncate">
              Mountain
            </div>
            <div className="text-[10px] text-text3 mono mt-1 truncate">
              v2 · branding
            </div>
          </div>
          {/* Mobile close button */}
          <button
            type="button"
            className="md:hidden w-7 h-7 rounded-md hover:bg-bg3 flex items-center justify-center shrink-0"
            onClick={onMobileClose}
            aria-label="Sidebar yopish"
          >
            <X className="w-4 h-4 text-text2" />
          </button>
          {/* Desktop collapse toggle */}
          <button
            type="button"
            className={cn(
              "hidden md:flex w-7 h-7 rounded-md hover:bg-bg3 items-center justify-center shrink-0",
              collapsed && "mx-auto",
            )}
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Sidebar kengaytirish" : "Sidebar yig'ish"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-text2" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-text2" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="px-2 py-2.5 flex-1 overflow-y-auto flex flex-col">
          {NAV.filter(
            (s) => canSee(s.roles) && s.items.some((i) => canSee(i.roles)),
          ).map((section) => (
            <div key={section.title}>
              {/* Section title — always shown on mobile; on desktop hidden when collapsed */}
              <div
                className={cn(
                  "text-[10px] text-text3 px-2 pt-3 pb-1 uppercase tracking-wider font-medium",
                  collapsed && "md:hidden",
                )}
              >
                {section.title}
              </div>
              {section.items
                .filter((i) => canSee(i.roles))
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onMobileClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded transition-colors mb-px text-[12.5px] border border-transparent font-normal",
                          // On mobile drawer always padded full-width; on desktop conditional
                          collapsed
                            ? "px-2.5 py-2 md:justify-center md:w-10 md:h-10 md:mx-auto md:px-0 md:py-0"
                            : "px-2.5 py-2",
                          isActive
                            ? "bg-blue-bg text-blue border-blue-bd font-medium"
                            : "text-text2 hover:bg-bg3 hover:text-text",
                        )
                      }
                    >
                      <Icon className="w-[15px] h-[15px] shrink-0" />
                      <span
                        className={cn("truncate", collapsed && "md:hidden")}
                      >
                        {item.label}
                      </span>
                      {item.badge && (
                        <span
                          className={cn(
                            "ml-auto bg-red text-white text-[10px] px-1.5 py-px rounded-[10px] font-semibold",
                            collapsed && "md:hidden",
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
            </div>
          ))}

          {/* Dark mode toggle — pinned to bottom of nav */}
          <div className="mt-auto pt-3 border-t border-border">
            <button
              type="button"
              onClick={toggle}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              className={cn(
                "flex items-center gap-2.5 rounded text-[12.5px] text-text2 hover:bg-bg3 hover:text-text w-full transition-colors",
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
