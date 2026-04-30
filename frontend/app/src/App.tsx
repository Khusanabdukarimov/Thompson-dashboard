import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import LidlarPage from '@/pages/marketing/LidlarPage';
import SdelkalarPage from '@/pages/marketing/SdelkalarPage';
import KunlikPage from '@/pages/marketing/KunlikPage';
import KampaniyalarPage from '@/pages/marketing/KampaniyalarPage';
import ByudjetPage from '@/pages/marketing/ByudjetPage';
import DashboardPage from '@/pages/payroll/DashboardPage';
import EmployeesPage from '@/pages/payroll/EmployeesPage';
import AttendancePage from '@/pages/payroll/AttendancePage';
import PayrollCalcPage from '@/pages/payroll/PayrollCalcPage';
import Placeholder from '@/pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/payroll/dashboard" replace />} />

        {/* Marketing */}
        <Route path="/marketing/kunlik"       element={<KunlikPage />} />
        <Route path="/marketing/kampaniyalar" element={<KampaniyalarPage />} />
        <Route path="/marketing/lidlar"       element={<LidlarPage />} />
        <Route path="/marketing/sdelkalar"    element={<SdelkalarPage />} />
        <Route path="/marketing/byudjet"      element={<ByudjetPage />} />

        {/* Payroll */}
        <Route path="/payroll/dashboard"  element={<DashboardPage />} />
        <Route path="/payroll/reja"       element={<Placeholder title="Reja & Leadlar" sub="Tez kunda — Bitrix-style filter + Lead jadvali" />} />
        <Route path="/payroll/employees"  element={<EmployeesPage />} />
        <Route path="/payroll/attendance" element={<AttendancePage />} />
        <Route path="/payroll/hisobot"    element={<Placeholder title="Hisobot intizomi" sub="Tez kunda — kunlik hisobot deadline tracking" />} />
        <Route path="/payroll/kpi"        element={<Placeholder title="KPI qoidalar" sub="Tez kunda — tier-based commission CRUD UI" />} />
        <Route path="/payroll/bonus"      element={<Placeholder title="Bonuslar" sub="Tez kunda — bonus rules + awards CRUD" />} />
        <Route path="/payroll/payroll"    element={<PayrollCalcPage />} />

        <Route path="/sozlamalar" element={<Placeholder title="Sozlamalar" />} />
        <Route path="*" element={<Navigate to="/payroll/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
