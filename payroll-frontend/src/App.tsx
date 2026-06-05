import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { isLoggedIn } from './lib/auth';

import LoginPage           from './pages/LoginPage';
import DashboardPage       from './pages/DashboardPage';
import EmployeesPage       from './pages/EmployeesPage';
import EmployeeProfilePage from './pages/EmployeeProfilePage';
import AttendancePage      from './pages/AttendancePage';
import KpiRulesPage        from './pages/KpiRulesPage';
import BonusPage           from './pages/BonusPage';
import TariflarPage        from './pages/TariflarPage';
import TaqsimotPage        from './pages/TaqsimotPage';
import PayrollCalcPage     from './pages/PayrollCalcPage';
import HisobotPage         from './pages/HisobotPage';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

function ProtectedLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/:id" element={<EmployeeProfilePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="kpi" element={<KpiRulesPage />} />
          <Route path="bonus" element={<BonusPage />} />
          <Route path="tariflar" element={<TariflarPage />} />
          <Route path="taqsimot" element={<TaqsimotPage />} />
          <Route path="payroll" element={<PayrollCalcPage />} />
          <Route path="hisobot" element={<HisobotPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename="/payroll-app">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
