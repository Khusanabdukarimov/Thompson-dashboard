import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Skeleton } from "@/components/Skeleton";
import Placeholder from "@/pages/Placeholder";
import {
  getAuthStatus,
  getStoredToken,
  getStoredRole,
  type DashboardRole,
} from "@/lib/auth";

// ── Pages ────────────────────────────────────────────────────────
const LoginPage        = lazy(() => import("@/pages/LoginPage"));

// Marketing / analytics
const LidlarPage       = lazy(() => import("@/pages/marketing/LidlarPage"));
const SdelkalarPage    = lazy(() => import("@/pages/marketing/SdelkalarPage"));
const KampaniyalarPage  = lazy(() => import("@/pages/marketing/KampaniyalarPage"));
const CallStatistikasi  = lazy(() => import("@/pages/marketing/CallStatistikasi"));
const KunlikPage       = lazy(() => import("@/pages/marketing/KunlikPage"));
const ByudjetPage      = lazy(() => import("@/pages/marketing/ByudjetPage"));

// New standalone pages (built step-by-step; show Placeholder until built)
const RejaNewPage      = lazy(() => import("@/pages/RejaPage"));
const HisobotNewPage   = lazy(() => import("@/pages/HisobotPage"));

// Payroll
const PayrollCalcPage  = lazy(() => import("@/pages/payroll/PayrollCalcPage"));
const SettingsPage     = lazy(() => import("@/pages/SettingsPage"));

// Payroll management (admin, backward compat)
const DashboardPage    = lazy(() => import("@/pages/payroll/DashboardPage"));
const EmployeesPage    = lazy(() => import("@/pages/payroll/EmployeesPage"));
const AttendancePage   = lazy(() => import("@/pages/payroll/AttendancePage"));
const KpiRulesPage     = lazy(() => import("@/pages/payroll/KpiRulesPage"));
const BonusPage        = lazy(() => import("@/pages/payroll/BonusPage"));
const RejaPage         = lazy(() => import("@/pages/payroll/RejaPage"));
const HisobotPage      = lazy(() => import("@/pages/payroll/HisobotPage"));
const TaqsimotPage     = lazy(() => import("@/pages/payroll/TaqsimotPage"));

// ── Loader ───────────────────────────────────────────────────────
function PageLoader() {
  return (
    <>
      <div className="px-[22px] py-[13px] border-b border-border bg-bg2 shadow flex items-center justify-between shrink-0">
        <div>
          <Skeleton className="h-4 w-40 mb-1.5" />
          <Skeleton className="h-2.5 w-64" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="grid grid-cols-5 gap-2.5 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
              <Skeleton className="h-2.5 w-20 mb-2.5" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </>
  );
}

// ── Auth guards ──────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<"loading" | "ok" | "login">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (!status.enabled) { setAuthState("ok"); return; }
        const token = getStoredToken();
        setAuthState(token ? "ok" : "login");
      } catch {
        if (!cancelled) setAuthState("ok");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (authState === "loading") return <PageLoader />;
  if (authState === "login")   return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRoute({ roles, children }: { roles: DashboardRole[]; children: React.ReactNode }) {
  const role = getStoredRole();
  if (!roles.includes(role)) return <Navigate to="/lidlar" replace />;
  return <>{children}</>;
}

const MGMT: DashboardRole[] = ["admin", "owner"];
const MKT:  DashboardRole[] = ["admin", "owner", "marketolog"];

function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// ── App ──────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<S><LoginPage /></S>} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>

        {/* Default → /lidlar */}
        <Route index element={<Navigate to="/lidlar" replace />} />

        {/* ── New flat routes (design doc) ── */}
        <Route path="/lidlar" element={
          <RoleRoute roles={[...MKT, "hunter"]}>
            <S><LidlarPage /></S>
          </RoleRoute>
        } />
        <Route path="/sdelkalar" element={
          <RoleRoute roles={MKT}>
            <S><SdelkalarPage /></S>
          </RoleRoute>
        } />
        <Route path="/call-statistikasi" element={
          <RoleRoute roles={MKT}>
            <S><CallStatistikasi /></S>
          </RoleRoute>
        } />
        <Route path="/kampaniyalar" element={
          <RoleRoute roles={MKT}>
            <S><KampaniyalarPage /></S>
          </RoleRoute>
        } />
        <Route path="/kunlik-hisobot" element={
          <RoleRoute roles={MKT}>
            <S><KunlikPage /></S>
          </RoleRoute>
        } />
        <Route path="/byudjet" element={
          <RoleRoute roles={MGMT}>
            <S><ByudjetPage /></S>
          </RoleRoute>
        } />
        <Route path="/reja" element={
          <RoleRoute roles={[...MGMT, "closer", "hunter"]}>
            <S><RejaNewPage /></S>
          </RoleRoute>
        } />
        <Route path="/hisobot" element={
          <S><HisobotNewPage /></S>
        } />
        <Route path="/payroll" element={
          <S><PayrollCalcPage /></S>
        } />
        <Route path="/sozlamalar" element={
          <RoleRoute roles={MGMT}>
            <S><SettingsPage /></S>
          </RoleRoute>
        } />

        {/* ── Old routes → redirect (backward compat) ── */}
        <Route path="/marketing/lidlar"       element={<Navigate to="/lidlar"         replace />} />
        <Route path="/marketing/sdelkalar"    element={<Navigate to="/sdelkalar"      replace />} />
        <Route path="/marketing/kampaniyalar" element={<Navigate to="/kampaniyalar"   replace />} />
        <Route path="/marketing/kunlik"       element={<Navigate to="/kunlik-hisobot" replace />} />
        <Route path="/marketing/byudjet"      element={<Navigate to="/byudjet"        replace />} />
        <Route path="/payroll/payroll"        element={<Navigate to="/payroll"        replace />} />

        {/* ── Payroll management (secondary nav, admin/owner) ── */}
        <Route path="/payroll/dashboard"  element={<S><DashboardPage /></S>} />
        <Route path="/payroll/employees"  element={<RoleRoute roles={MGMT}><S><EmployeesPage /></S></RoleRoute>} />
        <Route path="/payroll/attendance" element={<S><AttendancePage /></S>} />
        <Route path="/payroll/hisobot"    element={<S><HisobotPage /></S>} />
        <Route path="/payroll/kpi"        element={<RoleRoute roles={MGMT}><S><KpiRulesPage /></S></RoleRoute>} />
        <Route path="/payroll/bonus"      element={<RoleRoute roles={MGMT}><S><BonusPage /></S></RoleRoute>} />
        <Route path="/taqsimot"          element={<RoleRoute roles={MGMT}><S><TaqsimotPage /></S></RoleRoute>} />
        <Route path="/payroll/reja"       element={
          <RoleRoute roles={[...MGMT, "closer", "hunter"]}>
            <S><RejaPage /></S>
          </RoleRoute>
        } />

        <Route path="*" element={<Placeholder title="Sahifa topilmadi" sub="404" />} />
      </Route>
    </Routes>
  );
}
