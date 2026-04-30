import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import LidlarPage from '@/pages/marketing/LidlarPage';
import Placeholder from '@/pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/marketing/lidlar" replace />} />

        {/* Marketing */}
        <Route path="/marketing/lidlar"       element={<LidlarPage />} />
        <Route path="/marketing/kunlik"       element={<Placeholder title="Kunlik hisobot" />} />
        <Route path="/marketing/kampaniyalar" element={<Placeholder title="Kampaniyalar" />} />
        <Route path="/marketing/sdelkalar"    element={<Placeholder title="Sdelkalar" />} />
        <Route path="/marketing/byudjet"      element={<Placeholder title="Byudjet" />} />

        {/* Payroll */}
        <Route path="/payroll/dashboard"  element={<Placeholder title="Dashboard" />} />
        <Route path="/payroll/reja"       element={<Placeholder title="Reja & Leadlar" />} />
        <Route path="/payroll/employees"  element={<Placeholder title="Xodimlar" />} />
        <Route path="/payroll/attendance" element={<Placeholder title="Davomat" />} />
        <Route path="/payroll/hisobot"    element={<Placeholder title="Hisobot intizomi" />} />
        <Route path="/payroll/kpi"        element={<Placeholder title="KPI qoidalar" />} />
        <Route path="/payroll/bonus"      element={<Placeholder title="Bonuslar" />} />
        <Route path="/payroll/payroll"    element={<Placeholder title="Oylik hisob" />} />

        <Route path="/sozlamalar" element={<Placeholder title="Sozlamalar" />} />
        <Route path="*" element={<Navigate to="/marketing/lidlar" replace />} />
      </Route>
    </Routes>
  );
}
