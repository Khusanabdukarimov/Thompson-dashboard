import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { getPenaltyConfig, setPenaltyConfig } from '@/lib/api/payroll';
import { useToast } from '@/components/Toast';
import type { PenaltyConfig } from '@/lib/api/payroll';
import { getConfig } from '@/lib/api/config';
import { fmtNum } from '@/lib/utils';

export default function SettingsPage() {
  const cfgQ = useQuery({ queryKey: ['app/config'], queryFn: getConfig, staleTime: Infinity });
  const penaltyQ = useQuery({ queryKey: ['payroll/penalty-config'], queryFn: getPenaltyConfig });

  return (
    <>
      <Topbar
        title="Sozlamalar"
        sub="Tizim parametrlari · Bitrix integratsiyasi · jarima tariflari"
      />
      <div className="flex-1 overflow-y-auto px-3 sm:px-[22px] py-3 sm:py-[18px] bg-bg space-y-4">
        {/* ── Tizim ma'lumoti ─────────────────────────────────── */}
        <Section title="Tizim ma'lumoti" subtitle="Server tomondan keladi (read-only)">
          {cfgQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Item label="Bitrix24 portal" value={cfgQ.data?.bitrix_portal || '— sozlanmagan —'} mono />
              <Item label="Asosiy valyuta" value={cfgQ.data?.currency.primary || '—'} />
              <Item label="Ikkilamchi valyuta" value={cfgQ.data?.currency.secondary || '—'} />
              <Item label="Frontend versiya" value="v2 (React + Vite)" />
            </div>
          )}
        </Section>

        {/* ── Jarima tariflari ────────────────────────────────── */}
        <Section title="Jarima tariflari" subtitle="Bucket bo'yicha incident jarimasi (so'mda)">
          {penaltyQ.isLoading || !penaltyQ.data ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
            </div>
          ) : (
            <PenaltyForm initial={penaltyQ.data} />
          )}
        </Section>

      </div>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[13px] font-semibold">{title}</div>
        {subtitle && <div className="text-[11px] text-text3 mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Item({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-text3 uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-[12.5px] mt-1 ${mono ? 'mono text-text2' : 'font-medium'}`}>{value}</div>
    </div>
  );
}

function PenaltyForm({ initial }: { initial: PenaltyConfig }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    attendance_late_soft_uzs: initial.attendance_late_soft_uzs,
    attendance_late_uzs:      initial.attendance_late_uzs,
    attendance_penalty_uzs:   initial.attendance_penalty_uzs,
    attendance_absent_uzs:    initial.attendance_absent_uzs,
    report_late_soft_uzs:     initial.report_late_soft_uzs,
    report_late_uzs:          initial.report_late_uzs,
    report_penalty_uzs:       initial.report_penalty_uzs,
    report_missed_uzs:        initial.report_missed_uzs,
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      await setPenaltyConfig(form);
      qc.invalidateQueries({ queryKey: ['payroll/penalty-config'] });
      setSavedAt(new Date().toLocaleTimeString('uz-UZ'));
      toast.success('Tariflar saqlandi', 'Yangi jarima qiymatlari hisob-kitobda qo\'llaniladi');
    } catch (e) {
      toast.error('Saqlashda xato', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const totalAttendance = form.attendance_late_soft_uzs + form.attendance_late_uzs + form.attendance_penalty_uzs + form.attendance_absent_uzs;
  const totalReport     = form.report_late_soft_uzs + form.report_late_uzs + form.report_penalty_uzs + form.report_missed_uzs;

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] text-text3 mb-2 font-semibold uppercase tracking-wider flex items-center justify-between">
            <span>Davomat (09:00 deadline)</span>
            <span className="mono text-text2 normal-case font-normal text-[11px]">jami {fmtNum(totalAttendance)} so'm/oy</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Kechroq (≤09:05)" value={form.attendance_late_soft_uzs} onChange={(v) => setForm(f => ({ ...f, attendance_late_soft_uzs: v }))} tone="amber" />
            <NumField label="Kech (≤09:10)"     value={form.attendance_late_uzs}      onChange={(v) => setForm(f => ({ ...f, attendance_late_uzs: v }))}      tone="orange" />
            <NumField label="Juda kech ⚡"      value={form.attendance_penalty_uzs}   onChange={(v) => setForm(f => ({ ...f, attendance_penalty_uzs: v }))}   tone="red" />
            <NumField label="Kelmadi"            value={form.attendance_absent_uzs}    onChange={(v) => setForm(f => ({ ...f, attendance_absent_uzs: v }))}    tone="gray" />
          </div>
        </div>

        <div>
          <div className="text-[11px] text-text3 mb-2 font-semibold uppercase tracking-wider flex items-center justify-between">
            <span>Hisobot (19:00 deadline)</span>
            <span className="mono text-text2 normal-case font-normal text-[11px]">jami {fmtNum(totalReport)} so'm/oy</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Kechroq (≤19:05)" value={form.report_late_soft_uzs} onChange={(v) => setForm(f => ({ ...f, report_late_soft_uzs: v }))} tone="amber" />
            <NumField label="Kech (≤19:10)"     value={form.report_late_uzs}      onChange={(v) => setForm(f => ({ ...f, report_late_uzs: v }))}      tone="orange" />
            <NumField label="Juda kech ⚡"      value={form.report_penalty_uzs}   onChange={(v) => setForm(f => ({ ...f, report_penalty_uzs: v }))}   tone="red" />
            <NumField label="Topshirmadi"        value={form.report_missed_uzs}    onChange={(v) => setForm(f => ({ ...f, report_missed_uzs: v }))}    tone="gray" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-border">
        {savedAt && <span className="text-[11px] text-green">✓ saqlandi {savedAt}</span>}
        <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</Button>
      </div>
    </>
  );
}

function NumField({
  label, value, onChange, tone = 'gray',
}: { label: string; value: number; onChange: (v: number) => void; tone: 'amber' | 'orange' | 'red' | 'gray' }) {
  const dotColor = {
    amber: 'bg-amber', orange: 'bg-orange', red: 'bg-red', gray: 'bg-text3',
  }[tone];
  return (
    <label className="flex items-center gap-2 bg-bg3 border border-border rounded-md p-2.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-text3 truncate">{label}</div>
        <input
          type="number"
          className="w-full bg-transparent border-0 outline-0 mono text-[13px] font-medium text-text"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      </div>
    </label>
  );
}
