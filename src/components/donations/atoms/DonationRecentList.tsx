// Lista ostatnich wpłat (atom) - wyciągnięta z wariantu `thermometer`.
//
// Server fn `getDonationsPublicStats` nie oddaje darczyńcy (nigdy nie ujawnia
// donor_email ani message), więc pozycja to wyłącznie kwota + „ile temu".
//
// UWAGA, ekstrakcja NIE naprawia: kwota wiersza jest formatowana w walucie
// WIDGETU (`currency`), a nie w walucie zapisanej w wierszu (`r.currency`) -
// dokładnie jak w starym widoku. Pusta lista renderuje `null`, czyli to samo
// „nic", które w widoku dawał warunek `stats.recent.length > 0`.
import {
  fmtMoney,
  fmtRelative,
  type RecentDonation,
  type WidgetTranslate,
} from "../donationsWidgetModel";

export interface DonationRecentListProps {
  recent: RecentDonation[];
  /** Waluta WIDGETU (prop edytora bije walutę zbiórki - patrz model). */
  currency: string;
  lang: "pl" | "en";
  /**
   * Tłumacz przekazany PROPEM, a nie wzięty z `useTranslation()` w środku.
   * Powód: czas relatywny musi jechać w języku WIDGETU (`lang`), który może
   * różnić się od języka strony, a atom ma zostać deterministyczny.
   */
  t: WidgetTranslate;
}

export function DonationRecentList({ recent, currency, lang, t }: DonationRecentListProps) {
  if (recent.length === 0) return null;
  const money = (cents: number) => fmtMoney(cents, currency, lang);
  return (
    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
      {recent.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-2">
          <span className="tabular-nums">{money(r.amount_cents)}</span>
          <span>{fmtRelative(r.created_at, lang, t)}</span>
        </li>
      ))}
    </ul>
  );
}
