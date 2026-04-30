import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Skeleton } from '@/components/Skeleton';
import Placeholder from '@/pages/Placeholder';

const LidlarPage       = lazy(() => import('@/pages/marketing/LidlarPage'));
const SdelkalarPage    = lazy(() => import('@/pages/marketing/SdelkalarPage'));
const KunlikPage       = lazy(() => import('@/pages/marketing/KunlikPage'));
const KampaniyalarPage = lazy(() => import('@/pages/marketing/KampaniyalarPage'));
const ByudjetPage      = lazy(() => import('@/pages/marketing/ByudjetPage'));
const DashboardPage    = lazy(() => import('@/pages/payroll/DashboardPage'));
const EmployeesPage    = lazy(() => import('@/pages/payroll/EmployeesPage'));
const AttendancePage   = lazy(() => import('@/pages/payroll/AttendancePage'));
const PayrollCalcPage  = lazy(() => import('@/pages/payroll/PayrollCalcPage'));
const KpiRulesPage     = lazy(() => import('@/pages/payroll/KpiRulesPage'));
const BonusPage        = lazy(() => import('@/pages/payroll/BonusPage'));
const RejaPage         = lazy(() => import('@/pages/payroll/RejaPage'));
const HisobotPage      = lazy(() => import('@/pages/payroll/HisobotPage'));
const SettingsPage     = lazy(() => import('@/pages/SettingsPage'));

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

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/payroll/dashboard" replace />} />

        {/* Marketing */}
        <Route path="/marketing/kunlik"       element={<Suspense fallback={<PageLoader />}><KunlikPage /></Suspense>} />
        <Route path="/marketing/kampaniyalar" element={<Suspense fallback={<PageLoader />}><KampaniyalarPage /></Suspense>} />
        <Route path="/marketing/lidlar"       element={<Suspense fallback={<PageLoader />}><LidlarPage /></Suspense>} />
        <Route path="/marketing/sdelkalar"    element={<Suspense fallback={<PageLoader />}><SdelkalarPage /></Suspense>} />
        <Route path="/marketing/byudjet"      element={<Suspense fallback={<PageLoader />}><ByudjetPage /></Suspense>} />

        {/* Payroll */}
        <Route path="/payroll/dashboard"  element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
        <Route path="/payroll/reja"       element={<Suspense fallback={<PageLoader />}><RejaPage /></Suspense>} />
        <Route path="/payroll/employees"  element={<Suspense fallback={<PageLoader />}><EmployeesPage /></Suspense>} />
        <Route path="/payroll/attendance" element={<Suspense fallback={<PageLoader />}><AttendancePage /></Suspense>} />
        <Route path="/payroll/hisobot"    element={<Suspense fallback={<PageLoader />}><HisobotPage /></Suspense>} />
        <Route path="/payroll/kpi"        element={<Suspense fallback={<PageLoader />}><KpiRulesPage /></Suspense>} />
        <Route path="/payroll/bonus"      element={<Suspense fallback={<PageLoader />}><BonusPage /></Suspense>} />
        <Route path="/payroll/payroll"    element={<Suspense fallback={<PageLoader />}><PayrollCalcPage /></Suspense>} />

        <Route path="/sozlamalar" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        <Route path="*" element={<Placeholder title="Sahifa topilmadi" sub="404" />} />
      </Route>
    </Routes>
  );
}
