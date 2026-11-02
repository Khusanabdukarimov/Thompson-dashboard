/**
 * The three states every data block can be in besides "has data": loading, failed, empty.
 * One look for all pages, so a 0 is never shown while numbers are still on their way and
 * an empty period reads as "nothing in this period", not as a broken page.
 */
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";

/** Shimmering table rows while a block loads. */
export function LoadingRows({ rows = 4, padding = "16px 20px" }: { rows?: number; padding?: string }) {
  return (
    <div style={{ padding, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true" aria-label="Yuklanmoqda">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Skeleton style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
          <Skeleton style={{ height: 12, width: `${22 + ((i * 13) % 18)}%` }} />
          <Skeleton style={{ height: 8, flex: 1, borderRadius: 4 }} />
          <Skeleton style={{ height: 12, width: 44 }} />
        </div>
      ))}
    </div>
  );
}

/** A number still loading: a shimmer the size of the figure, never a fake 0. */
export function LoadingValue({ width = 72, height = 28 }: { width?: number; height?: number }) {
  return <Skeleton style={{ width, height, borderRadius: 8, display: "inline-block" }} />;
}

export function ErrorState({ onRetry, text = "Ma'lumotni yuklab bo'lmadi" }: { onRetry?: () => void; text?: string }) {
  return (
    <div style={{ padding: "22px 20px", display: "flex", alignItems: "center", gap: 12, color: "var(--text2)", fontSize: 13 }}>
      <AlertTriangle size={18} style={{ color: "#F59E0B", flexShrink: 0 }} />
      <span>{text}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
          <RotateCw size={13} /> Qayta urinish
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: "var(--bg3)", display: "grid", placeItems: "center", color: "var(--text3)" }}>
        <Inbox size={20} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: "var(--text3)", maxWidth: 460, lineHeight: 1.5 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
