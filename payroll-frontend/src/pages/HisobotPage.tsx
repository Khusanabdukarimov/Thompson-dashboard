import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { getDisciplineStats, listEmployees } from '../lib/api/payroll';

const now = new Date();

export default function HisobotPage() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());

  const discQ = useQuery({ queryKey: ['discipline', year, month], queryFn: () => getDisciplineStats(year, month) });
  const empQ  = useQuery({ queryKey: ['employees'], queryFn: listEmployees });

  const employees = discQ.data?.employees ?? [];

  const BUCKET_LABEL: Record<string, string> = {
    'on-time': 'O\'z vaqtida', 'late-soft': 'Ozgina kech', 'late': 'Kech',
    'penalty': 'Jarima', 'absent': 'Kelmadi', 'missed': 'Topshirmadi',
  };
  const BUCKET_COLOR: Record<string, string> = {
    'on-time': 'var(--green)', 'late-soft': 'var(--amber)', 'late': 'orange',
    'penalty': 'var(--red)', 'absent': 'var(--red)', 'missed': 'var(--red)',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Hisobot" month={month} year={year} onMonthChange={(m, y) => { setMonth(m); setYear(y); }} />
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700 }}>
            Xodimlar bo'yicha intizom statistikasi
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Xodim</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Davomat</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Hisobot</th>
              </tr>
            </thead>
            <tbody>
              {discQ.isLoading ? (
                <tr><td colSpan={3} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Yuklanmoqda...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Ma'lumot yo'q</td></tr>
              ) : employees.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13 }}>{e.name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {Object.entries(e.attendance).filter(([, v]) => v > 0).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 12, color: BUCKET_COLOR[k] || 'var(--text-muted)' }}>
                          {BUCKET_LABEL[k] || k}: {v}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {Object.entries(e.report).filter(([, v]) => v > 0).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 12, color: BUCKET_COLOR[k] || 'var(--text-muted)' }}>
                          {BUCKET_LABEL[k] || k}: {v}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
