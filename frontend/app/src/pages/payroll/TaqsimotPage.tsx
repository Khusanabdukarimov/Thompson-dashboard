import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { Avatar } from "@/components/Avatar";
import { apiGet, authedFetch, API_URL_CRM } from "@/lib/api/client";
import { useToast } from "@/components/Toast";

type Responsible = {
  id: number;
  full_name: string;
  email: string | null;
  work_position: string | null;
  taqsimot_pct: number | null;
};

function fetchTaqsimot() {
  return apiGet<{ responsibles: Responsible[] }>("/api/dashboard/taqsimot", {}, API_URL_CRM);
}

async function saveTaqsimot(id: number, pct: number) {
  const res = await authedFetch(`/api/dashboard/taqsimot/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taqsimot_pct: pct }),
  }, API_URL_CRM);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function TaqsimotPage() {
  const qc    = useQueryClient();
  const toast = useToast();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["taqsimot"],
    queryFn: fetchTaqsimot,
  });

  const rows = data?.responsibles ?? [];
  const total = rows.reduce((s, r) => s + (r.taqsimot_pct ?? 0), 0);

  async function handleSave(id: number, pct: number) {
    try {
      await saveTaqsimot(id, pct);
      qc.invalidateQueries({ queryKey: ["taqsimot"] });
    } catch (e) {
      toast.error("Saqlashda xato", (e as Error).message);
    }
  }

  return (
    <>
      <Topbar
        title="Taqsimot"
        sub="Xodimlar bo'yicha foiz taqsimoti"
        actions={
          <Button onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="bg-bg2 border border-border rounded-xl shadow overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-bg3">
                <th className="text-left px-4 py-2.5 font-medium text-text3 uppercase tracking-wider text-[10.5px]">
                  Xodim
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-text3 uppercase tracking-wider text-[10.5px]">
                  Ish vaqti
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-text3 uppercase tracking-wider text-[10.5px] w-36">
                  Taqsimot %
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border animate-pulse">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-bg3" />
                          <div>
                            <div className="h-3 w-28 bg-bg3 rounded mb-1" />
                            <div className="h-2 w-20 bg-bg3 rounded" />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-16 bg-bg3 rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-10 bg-bg3 rounded" />
                      </td>
                    </tr>
                  ))
                : rows.map((r) => (
                    <TaqsimotRow key={r.id} row={r} onSave={handleSave} />
                  ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-bg3">
                <td className="px-4 py-2.5 font-semibold text-text" colSpan={2}>
                  Jami
                </td>
                <td className="px-4 py-2.5 font-semibold mono">
                  {total === 100 ? (
                    <span className="text-green-500">
                      {total}% ✓
                    </span>
                  ) : (
                    <span className="text-red-400">
                      Jami: {total}% (100% bo'lishi kerak)
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

function TaqsimotRow({
  row,
  onSave,
}: {
  row: Responsible;
  onSave: (id: number, pct: number) => Promise<void>;
}) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState("");
  const [flash,   setFlash]     = useState(false);
  const inputRef                = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(row.taqsimot_pct ?? ""));
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, row.taqsimot_pct]);

  async function commit() {
    const n = parseInt(draft, 10);
    if (isNaN(n) || n < 0 || n > 100) {
      setEditing(false);
      return;
    }
    setEditing(false);
    await onSave(row.id, n);
    setFlash(true);
    setTimeout(() => setFlash(false), 700);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter")  commit();
    if (e.key === "Escape") setEditing(false);
  }

  const pct    = row.taqsimot_pct ?? null;
  const hasVal = pct !== null && pct !== 0;

  // ISH VAQTI — not in the payroll response, show work_position as fallback
  const schedule = row.work_position ?? "09:00–18:00";

  return (
    <tr
      className={`border-b border-border transition-colors ${flash ? "bg-green-500/10" : "hover:bg-bg3/50"}`}
    >
      {/* XODIM */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={row.full_name} />
          <div>
            <div className="font-medium text-text">{row.full_name}</div>
            <div className="text-[10px] text-text3">{row.email ?? "—"}</div>
          </div>
        </div>
      </td>

      {/* ISH VAQTI */}
      <td className="px-4 py-3">
        <span className="mono text-text2 text-[11px]">{schedule}</span>
      </td>

      {/* TAQSIMOT % */}
      <td className="px-4 py-3 w-36">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="number"
              min={0}
              max={100}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={commit}
              className="w-16 px-2 py-1 rounded border border-blue bg-bg text-text text-[12px] mono focus:outline-none focus:shadow-[0_0_0_3px_rgba(34,102,245,0.18)]"
            />
            <span className="text-text3 text-[11px]">%</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`mono text-[12.5px] px-2 py-1 rounded hover:bg-blue/10 hover:text-blue transition-colors cursor-pointer min-w-[40px] text-left ${
              hasVal ? "text-text font-medium" : "text-text3"
            }`}
          >
            {hasVal ? `${pct}%` : "—"}
          </button>
        )}
      </td>
    </tr>
  );
}
