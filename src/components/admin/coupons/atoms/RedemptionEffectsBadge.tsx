// Atom: kolumna „Plan" w historii realizacji - TRZY stany, nie dwa.
//
// CO BYŁO W TRASIE. `admin.coupons.redemptions.tsx` (dawne 178-201): zagnieżdżony
// warunek w warunku, w środku wiersza tabeli, z tooltipem formatującym datę.
//
// DLACZEGO TO JEST DECYZJA, A NIE UKŁAD. Kolumna odpowiada na pytanie „czy ten
// kupon COŚ NADAŁ": kupon bez warstwy nie nadaje nic (kreska), kupon z warstwą
// i znacznikiem `effects_applied_at` już nadał, a kupon z warstwą BEZ znacznika
// czeka na potwierdzoną płatność. Trzeci stan jest jedynym miejscem w panelu,
// z którego widać zamówienie nieopłacone - i najłatwiejszym do zgubienia przy
// refaktorze („skoro jest warstwa, to nadano").
//
// PRZENIESIONE ZNAK W ZNAK: brak warstwy daje kreskę NIEZALEŻNIE od tego, czy
// `effects_applied_at` jest ustawiony - czyli realizacja z zastosowanymi
// efektami, ale bez warstwy, wygląda jak realizacja bez żadnych efektów.
import { Badge } from "@/components/ui/badge";

export function RedemptionEffectsBadge({
  tierKey,
  effectsAppliedAt,
  grantedLabel,
  awaitingLabel,
  lang,
}: {
  tierKey: string | null;
  effectsAppliedAt: string | null;
  grantedLabel: string;
  awaitingLabel: string;
  /** Język formatowania daty w tooltipie - `uiLocale` panelu. */
  lang: string;
}) {
  if (!tierKey) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{tierKey}</Badge>
      {effectsAppliedAt ? (
        <Badge variant="secondary" title={new Date(effectsAppliedAt).toLocaleString(lang)}>
          {grantedLabel}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-amber-600 border-amber-500/50">
          {awaitingLabel}
        </Badge>
      )}
    </div>
  );
}
