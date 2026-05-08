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

const LoginPage = lazy(() => import("@/pages/LoginPage"));

const LidlarPage = lazy(() => import("@/pages/marketing/LidlarPage"));
const SdelkalarPage = lazy(() => import("@/pages/marketing/SdelkalarPage"));
const KunlikPage = lazy(() => import("@/pages/marketing/KunlikPage"));
const KampaniyalarPage = lazy(
  () => import("@/pages/marketing/KampaniyalarPage"),
);
const ByudjetPage = lazy(() => import("@/pages/marketing/ByudjetPage"));
const DashboardPage = lazy(() => import("@/pages/payroll/DashboardPage"));
const EmployeesPage = lazy(() => import("@/pages/payroll/EmployeesPage"));
const AttendancePage = lazy(() => import("@/pages/payroll/AttendancePage"));
const PayrollCalcPage = lazy(() => import("@/pages/payroll/PayrollCalcPage"));
const KpiRulesPage = lazy(() => import("@/pages/payroll/KpiRulesPage"));
const BonusPage = lazy(() => import("@/pages/payroll/BonusPage"));
const RejaPage = lazy(() => import("@/pages/payroll/RejaPage"));
const HisobotPage = lazy(() => import("@/pages/payroll/HisobotPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

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
            <div
              key={i}
              className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow"
            >
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<"loading" | "ok" | "login">(
    "loading",
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (!status.enabled) {
          setAuthState("ok");
          return;
        }
        const token = getStoredToken();
        if (!token) {
          setAuthState("login");
          return;
        }
        setAuthState("ok");
      } catch {
        if (!cancelled) setAuthState("ok"); // fail-open if status endpoint unreachable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "loading") return <PageLoader />;
  if (authState === "login") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRoute({
  roles,
  children,
}: {
  roles: DashboardRole[];
  children: React.ReactNode;
}) {
  const role = getStoredRole();
  if (!roles.includes(role))
    return <Navigate to="/payroll/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<PageLoader />}>
            <LoginPage />
          </Suspense>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/payroll/dashboard" replace />} />

        {/* Marketing — admin/owner/marketolog; lidlar also for hunter */}
        <Route
          path="/marketing/kunlik"
          element={
            <RoleRoute roles={["admin", "owner", "marketolog"]}>
              <Suspense fallback={<PageLoader />}>
                <KunlikPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/marketing/kampaniyalar"
          element={
            <RoleRoute roles={["admin", "owner", "marketolog"]}>
              <Suspense fallback={<PageLoader />}>
                <KampaniyalarPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/marketing/lidlar"
          element={
            <RoleRoute roles={["admin", "owner", "marketolog", "hunter"]}>
              <Suspense fallback={<PageLoader />}>
                <LidlarPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/marketing/sdelkalar"
          element={
            <RoleRoute roles={["admin", "owner", "marketolog"]}>
              <Suspense fallback={<PageLoader />}>
                <SdelkalarPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/marketing/byudjet"
          element={
            <RoleRoute roles={["admin", "owner"]}>
              <Suspense fallback={<PageLoader />}>
                <ByudjetPage />
              </Suspense>
            </RoleRoute>
          }
        />

        {/* Payroll */}
        <Route
          path="/payroll/dashboard"
          element={
            <Suspense fallback={<PageLoader />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="/payroll/reja"
          element={
            <RoleRoute roles={["admin", "owner", "closer", "hunter"]}>
              <Suspense fallback={<PageLoader />}>
                <RejaPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/payroll/employees"
          element={
            <RoleRoute roles={["admin", "owner"]}>
              <Suspense fallback={<PageLoader />}>
                <EmployeesPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/payroll/attendance"
          element={
            <Suspense fallback={<PageLoader />}>
              <AttendancePage />
            </Suspense>
          }
        />
        <Route
          path="/payroll/hisobot"
          element={
            <Suspense fallback={<PageLoader />}>
              <HisobotPage />
            </Suspense>
          }
        />
        <Route
          path="/payroll/kpi"
          element={
            <RoleRoute roles={["admin", "owner"]}>
              <Suspense fallback={<PageLoader />}>
                <KpiRulesPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/payroll/bonus"
          element={
            <RoleRoute roles={["admin", "owner"]}>
              <Suspense fallback={<PageLoader />}>
                <BonusPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="/payroll/payroll"
          element={
            <Suspense fallback={<PageLoader />}>
              <PayrollCalcPage />
            </Suspense>
          }
        />

        <Route
          path="/sozlamalar"
          element={
            <RoleRoute roles={["admin", "owner"]}>
              <Suspense fallback={<PageLoader />}>
                <SettingsPage />
              </Suspense>
            </RoleRoute>
          }
        />
        <Route
          path="*"
          element={<Placeholder title="Sahifa topilmadi" sub="404" />}
        />
      </Route>
    </Routes>
  );
}
