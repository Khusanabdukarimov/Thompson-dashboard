import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import LidlarPage from '@/pages/marketing/LidlarPage';
import SdelkalarPage from '@/pages/marketing/SdelkalarPage';
import KunlikPage from '@/pages/marketing/KunlikPage';
import KampaniyalarPage from '@/pages/marketing/KampaniyalarPage';
import ByudjetPage from '@/pages/marketing/ByudjetPage';
import Placeholder from '@/pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/marketing/kunlik" replace />} />

        {/* Marketing */}
        <Route path="/marketing/kunlik"       element={<KunlikPage />} />
        <Route path="/marketing/kampaniyalar" element={<KampaniyalarPage />} />
        <Route path="/marketing/lidlar"       element={<LidlarPage />} />
        <Route path="/marketing/sdelkalar"    element={<SdelkalarPage />} />
        <Route path="/marketing/byudjet"      element={<ByudjetPage />} />

        {/* Payroll — pending v2 redesign */}
        <Route path="/payroll/dashboard"  element={<Placeholder title="Dashboard" />} />
        <Route path="/payroll/reja"       element={<Placeholder title="Reja & Leadlar" />} />
        <Route path="/payroll/employees"  element={<Placeholder title="Xodimlar" />} />
        <Route path="/payroll/attendance" element={<Placeholder title="Davomat" />} />
        <Route path="/payroll/hisobot"    element={<Placeholder title="Hisobot intizomi" />} />
        <Route path="/payroll/kpi"        element={<Placeholder title="KPI qoidalar" />} />
        <Route path="/payroll/bonus"      element={<Placeholder title="Bonuslar" />} />
        <Route path="/payroll/payroll"    element={<Placeholder title="Oylik hisob" />} />

        <Route path="/sozlamalar" element={<Placeholder title="Sozlamalar" />} />
        <Route path="*" element={<Navigate to="/marketing/kunlik" replace />} />
      </Route>
    </Routes>
  );
}
