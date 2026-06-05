import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, Pencil, Grid3x3 } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { listTariflar, createTarif, updateTarif, deleteTarif } from "@/lib/api/payroll";
import type { Tarif, TarifIn } from "@/lib/api/payroll";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

const EMPTY: TarifIn = {
  service_type: "dizayn",
  name: "",
  loyiha_summasi: 0,
  variant_klass: "",
  harf_oralighi: "",
  tekshiruvlar: 0,
  deadline_mijoz: "",
  hudud: "Mahalliy",
  jami_summa: 0,
  sort_order: 0,
  is_active: true,
};

function fmtUzs(n: number) {
  return n.toLocaleString("uz-UZ") + " UZS";
}

export default function TariflarPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"dizayn" | "neyming">("dizayn");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tarif | null>(null);
  const [form, setForm] = useState<TarifIn>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tariflar", tab],
    queryFn: () => listTariflar(tab).then(d => d.tariflar),
  });

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY, service_type: tab });
    setOpen(true);
  }

  function openEdit(t: Tarif) {
    setEditing(t);
    setForm({
      service_type: t.service_type,
      name: t.name,
      loyiha_summasi: t.loyiha_summasi,
      variant_klass: t.variant_klass,
      harf_oralighi: t.harf_oralighi,
      tekshiruvlar: t.tekshiruvlar,
      deadline_mijoz: t.deadline_mijoz,
      hudud: t.hudud,
      jami_summa: t.jami_summa,
      sort_order: t.sort_order,
      is_active: t.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Tarif nomi kiritilmadi"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateTarif(editing.id, form);
        toast.success("Tarif yangilandi");
      } else {
        await createTarif(form);
        toast.success("Tarif qo'shildi");
      }
      qc.invalidateQueries({ queryKey: ["tariflar"] });
      setOpen(false);
    } catch {
      toast.error("Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTarif(id);
      toast.success("O'chirildi");
      qc.invalidateQueries({ queryKey: ["tariflar"] });
    } catch {
      toast.error("O'chirishda xatolik");
    } finally {
      setDeleteId(null);
    }
  }

  const set = (k: keyof TarifIn, v: TarifIn[keyof TarifIn]) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <Topbar title="Tariflar" />

      <div className="flex-1 p-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          {(["dizayn", "neyming"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[13px] font-medium border transition-all",
                tab === t
                  ? "bg-blue text-white border-blue"
                  : "border-border text-text2 hover:bg-bg3"
              )}
            >
              {t === "dizayn" ? "Dizayn tariflari" : "Neyming tariflari"}
            </button>
          ))}
          <div className="flex-1" />
          <Button size="sm" onClick={openNew}>
            <Plus className="w-3.5 h-3.5" /> Yangi tarif
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-bg2 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-bg3 text-text3 text-[11px] uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left font-medium">Tarif nomi</th>
                <th className="px-4 py-2.5 text-left font-medium">Loyiha summasi</th>
                {tab === "dizayn" && <th className="px-4 py-2.5 text-left font-medium">Variant/Klass</th>}
                {tab === "neyming" && <th className="px-4 py-2.5 text-left font-medium">Harf oralig'i</th>}
                <th className="px-4 py-2.5 text-left font-medium">Tekshiruvlar</th>
                <th className="px-4 py-2.5 text-left font-medium">Deadline</th>
                <th className="px-4 py-2.5 text-left font-medium">Hudud</th>
                <th className="px-4 py-2.5 text-right font-medium">Jami summa</th>
                <th className="px-4 py-2.5 text-center font-medium">Holat</th>
                <th className="px-4 py-2.5 text-right font-medium">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && (!data || data.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-4 py-12">
                    <EmptyState icon={<Grid3x3 className="w-5 h-5" />} title="Tariflar yo'q" hint="Yangi tarif qo'shing" />
                  </td>
                </tr>
              )}
              {data?.map(t => (
                <tr key={t.id} className="border-b border-border hover:bg-bg3 transition-colors">
                  <td className="px-4 py-3 font-medium text-text">{t.name}</td>
                  <td className="px-4 py-3 text-text2">{fmtUzs(t.loyiha_summasi)}</td>
                  {tab === "dizayn" && <td className="px-4 py-3 text-text2">{t.variant_klass || "—"}</td>}
                  {tab === "neyming" && <td className="px-4 py-3 text-text2">{t.harf_oralighi || "—"}</td>}
                  <td className="px-4 py-3 text-text2">{t.tekshiruvlar}</td>
                  <td className="px-4 py-3 text-text2">{t.deadline_mijoz || "—"}</td>
                  <td className="px-4 py-3 text-text2">{t.hudud}</td>
                  <td className="px-4 py-3 text-right font-semibold text-text">{fmtUzs(t.jami_summa)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={t.is_active ? "green" : "gray"}>
                      {t.is_active ? "Faol" : "Nofaol"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded hover:bg-bg text-text2 hover:text-text transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(t.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-text2 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-bg2 border border-border rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <Dialog.Title className="text-[15px] font-semibold text-text">
              {editing ? "Tarifni tahrirlash" : "Yangi tarif"}
            </Dialog.Title>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[12px] text-text3 mb-1">Tarif nomi</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  placeholder="Light, Air, Marine..."
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Xizmat turi</label>
                <select
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.service_type}
                  onChange={e => set("service_type", e.target.value as "dizayn" | "neyming")}
                >
                  <option value="dizayn">Dizayn</option>
                  <option value="neyming">Neyming</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Hudud</label>
                <select
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.hudud}
                  onChange={e => set("hudud", e.target.value)}
                >
                  <option value="Mahalliy">Mahalliy</option>
                  <option value="Xalqaro">Xalqaro</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Loyiha summasi (UZS)</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.loyiha_summasi}
                  onChange={e => set("loyiha_summasi", Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Jami summa (UZS)</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.jami_summa}
                  onChange={e => set("jami_summa", Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Variant / Klass</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  placeholder="3+3 / 1 klass"
                  value={form.variant_klass}
                  onChange={e => set("variant_klass", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Harf oralig'i</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  placeholder="6-8 harf"
                  value={form.harf_oralighi}
                  onChange={e => set("harf_oralighi", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Tekshiruvlar soni</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.tekshiruvlar}
                  onChange={e => set("tekshiruvlar", Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Deadline / Mijoz tasdiqlanishi</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  placeholder="700k + 800k"
                  value={form.deadline_mijoz}
                  onChange={e => set("deadline_mijoz", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] text-text3 mb-1">Tartib raqami</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-blue"
                  value={form.sort_order}
                  onChange={e => set("sort_order", Number(e.target.value))}
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => set("is_active", e.target.checked)}
                  className="w-4 h-4 accent-blue"
                />
                <label htmlFor="is_active" className="text-[13px] text-text2">Faol</label>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete confirm */}
      <Dialog.Root open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-bg2 border border-border rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <Dialog.Title className="text-[15px] font-semibold text-text">Tarifni o'chirish</Dialog.Title>
            <p className="text-[13px] text-text2">Haqiqatan ham bu tarifni o'chirmoqchimisiz?</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setDeleteId(null)}>Bekor</Button>
              <Button variant="danger" onClick={() => deleteId !== null && handleDelete(deleteId)}>O'chirish</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
