/**
 * Status in lists: an icon in a status colour + a word in normal ink. Colour is kept for
 * meaning only (good / warning / serious / critical); the text itself always stays
 * readable ink, so a row never turns into a wall of coloured pills.
 */
import type { LucideIcon } from "lucide-react";
import { TONE, type Tone } from "@/lib/status";

export function StatusMark({ tone, icon: Icon, children, muted = false, title }: {
  tone: Tone; icon?: LucideIcon; children: React.ReactNode; muted?: boolean; title?: string;
}) {
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: muted ? "var(--text2)" : "var(--text)", whiteSpace: "nowrap" }}>
      {Icon
        ? <Icon size={14} strokeWidth={2.2} style={{ color: TONE[tone], flexShrink: 0 }} />
        : <span style={{ width: 7, height: 7, borderRadius: "50%", background: TONE[tone], flexShrink: 0 }} />}
      {children}
    </span>
  );
}

/** A small coloured dot before a label (stage, source): identity, not status. */
export function Dot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
      {children}
    </span>
  );
}
