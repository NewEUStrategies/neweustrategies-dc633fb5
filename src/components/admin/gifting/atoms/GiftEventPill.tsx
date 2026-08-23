// Atom: plakietka typu zdarzenia w audycie gifting.
//
// `event_type` jest CELOWO otwartym stringiem (patrz komentarz przy
// GiftEventAdminRow w lib/gifting-admin.functions.ts): audyt ma pokazać
// zdarzenie, którego ten build jeszcze nie zna, zamiast je przekłamać albo
// wysypać render. Dlatego nieznany typ dostaje tonację neutralną, a etykietę
// przekazuje wołający (w praktyce: surowy `event_type` przez `defaultValue`).
import type { GiftEventType } from "@/lib/gifting-admin.functions";

export const EVENT_PILL_CLS: Record<GiftEventType, string> = {
  created: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  redeemed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground border-border",
  exhausted: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

export function isKnownEventType(type: string): type is GiftEventType {
  return type in EVENT_PILL_CLS;
}

/** Nieznane typy zdarzen dostaja neutralna tonacje zamiast wysypywac render. */
export function GiftEventPill({ type, label }: { type: string; label: string }) {
  const cls = isKnownEventType(type) ? EVENT_PILL_CLS[type] : EVENT_PILL_CLS.expired;
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}
