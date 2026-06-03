import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { createRejaPlan } from '@/lib/api/reja';

const MONTH_NAMES = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
];

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RejaCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const now = new Date();

  const initYear  = parseInt(searchParams.get('year')  ?? '') || now.getFullYear();
  const initMonth = parseInt(searchParams.get('month') ?? '') || (now.getMonth() + 1);

  const [selYear,  setSelYear]  = useState(initYear);
  const [selMonth, setSelMonth] = useState(initMonth);
  const [target,   setTarget]   = useState('');
  const [error,    setError]    = useState('');

  const YEARS = Array.from({ length: 2090 - 2020 + 1 }, (_, i) => 2020 + i);

  const createMutation = useMutation({
    mutationFn: () => {
      const start = localISO(new Date(selYear, selMonth - 1, 1));
      const end   = localISO(new Date(selYear, selMonth, 0));
      const totalTarget = parseFloat(target.replace(/,/g, '')) || 0;
      return createRejaPlan({ period_type: 'monthly', period_start: start, period_end: end, total_target: totalTarget });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reja/plans'] });
      navigate(`/reja?year=${selYear}&month=${selMonth}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--bg2)' }}>
      <Topbar
        title="Yangi reja yaratish"
        actions={
          <button
            onClick={() => navigate('/reja')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <ArrowLeft size={14} /> Orqaga
          </button>
        }
      />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 48px', width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Yangi reja</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>Oy va yilni tanlang, so'ngra umumiy maqsadni kiriting.</div>
          </div>

          {/* Year + Month */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Yil</label>
              <select
                value={selYear}
                onChange={e => setSelYear(Number(e.target.value))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Oy</label>
              <select
                value={selMonth}
                onChange={e => setSelMonth(Number(e.target.value))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
              </select>
            </div>
          </div>

          {/* Total target */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Umumiy maqsad (USD)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, fontWeight: 700, color: 'var(--text3)' }}>$</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={target}
                onChange={e => { setTarget(e.target.value); setError(''); }}
                placeholder="0"
                style={{ width: '100%', padding: '10px 12px 10px 28px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 15, fontWeight: 700, outline: 'none', boxSizing: 'border-box', WebkitAppearance: 'none' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#2563eb')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Keyinroq ham o'zgartirish mumkin</div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 13, color: '#ef4444' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => navigate('/reja')}
              style={{ flex: 1, padding: '12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 9, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 14, fontWeight: 700, cursor: createMutation.isPending ? 'default' : 'pointer', opacity: createMutation.isPending ? 0.7 : 1 }}
            >
              <Plus size={15} />
              {createMutation.isPending ? 'Yaratilmoqda…' : `${MONTH_NAMES[selMonth - 1]} ${selYear} rejasi yaratish`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
