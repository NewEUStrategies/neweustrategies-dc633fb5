// Czyste pomocniki panelu prezentow: mapa klas pigulki zdarzenia i straznik
// znanego typu zdarzenia. Wyniesione z `src/routes/admin.gifting.tsx`.
import { type GiftEventType } from "@/lib/gifting-admin.functions";

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
