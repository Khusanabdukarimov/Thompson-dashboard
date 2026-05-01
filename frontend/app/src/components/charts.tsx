import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, Legend,
} from 'recharts';
import type { ReactNode } from 'react';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r)',
    fontSize: '12px',
    boxShadow: 'var(--shadow-md)',
  },
  labelStyle: { color: 'var(--text2)', fontSize: '11px', fontWeight: 600 },
  itemStyle: { color: 'var(--text)', fontSize: '12px' },
};

const AXIS_PROPS = {
  stroke: 'var(--text3)',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: 'var(--border)' },
};

export function CardChart({ title, hint, action, children, height = 240 }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; height?: number }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <span className="text-[13px] font-semibold">{title}</span>
          {hint && <span className="text-[11px] text-text3 ml-2">{hint}</span>}
        </div>
        {action}
      </div>
      <div className="p-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type SimpleBarDatum = { name: string } & Record<string, number | string>;

export function SimpleBar({
  data, dataKey = 'value', fill = 'var(--blue)',
}: { data: SimpleBarDatum[]; dataKey?: string; fill?: string }) {
  return (
    <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis dataKey="name" {...AXIS_PROPS} />
      <YAxis {...AXIS_PROPS} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Bar dataKey={dataKey} fill={fill} radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}

export type StackedBarDatum = { name: string } & Record<string, number | string>;

export function StackedBar({
  data, series,
}: { data: StackedBarDatum[]; series: { dataKey: string; fill: string; name?: string }[] }) {
  return (
    <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis dataKey="name" {...AXIS_PROPS} />
      <YAxis {...AXIS_PROPS} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
      {series.map((s) => (
        <Bar key={s.dataKey} dataKey={s.dataKey} stackId="a" fill={s.fill} name={s.name ?? s.dataKey} radius={[2, 2, 0, 0]} />
      ))}
    </BarChart>
  );
}

export type LineDatum = { name: string } & Record<string, number | string>;

export function MultiLine({
  data, lines,
}: { data: LineDatum[]; lines: { dataKey: string; stroke: string; name?: string }[] }) {
  return (
    <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis dataKey="name" {...AXIS_PROPS} />
      <YAxis {...AXIS_PROPS} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
      {lines.map((l) => (
        <Line key={l.dataKey} type="monotone" dataKey={l.dataKey} stroke={l.stroke} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name={l.name ?? l.dataKey} />
      ))}
    </LineChart>
  );
}

/** Funnel-like bars (decreasing horizontal bars). Value sits to the right of the bar. */
export function FunnelBars({ steps }: { steps: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...steps.map(s => s.value));
  return (
    <div className="flex flex-col gap-2.5 px-1">
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-[12.5px] text-text2 w-32 shrink-0">{s.label}</span>
            <div className="flex-1 h-7 rounded overflow-hidden bg-bg3">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${pct}%`, background: s.color }}
              />
            </div>
            <span className="mono text-[13px] font-semibold text-text w-24 text-right tabular-nums">
              {s.value.toLocaleString('ru-RU')}
            </span>
            <span className="mono text-[11px] text-text3 w-10 text-right">
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
