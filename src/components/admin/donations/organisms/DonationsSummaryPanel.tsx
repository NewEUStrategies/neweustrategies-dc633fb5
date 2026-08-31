// Organizm: PODSUMOWANIE darowizn - trzy kafelki (suma, biezacy miesiac,
// liczba wplat). Wyniesione z `src/routes/admin.donations.tsx` bez zmiany
// zachowania: komponent jest prezentacyjny, zapytanie zostaje na stronie.
import { formatDonationAmount } from "@/lib/billing/donationsConfig";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";

interface DonationsSummaryPanelProps {
  /** Wynik zapytania statystyk; `undefined` dopoki nie wroci. */
  stats: DonationsPublicStats | undefined;
  /** Waluta z konfiguracji - uzywana, gdy statystyki jeszcze nie wrocily. */
  currency: string;
  lang: "pl" | "en";
}

export function DonationsSummaryPanel({ stats, currency, lang }: DonationsSummaryPanelProps) {
  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-3">
      {[
        { label: "Suma wpłat", value: stats?.totalCents ?? 0 },
        { label: "W tym miesiącu", value: stats?.monthCents ?? 0 },
      ].map((card) => (
        <div key={card.label} className="rounded-md border p-4">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-lg font-medium">
            {formatDonationAmount(card.value, stats?.currency ?? currency, lang)}
          </p>
        </div>
      ))}
      <div className="rounded-md border p-4">
        <p className="text-xs text-muted-foreground">Liczba wpłat</p>
        <p className="mt-1 text-lg font-medium">{stats?.count ?? 0}</p>
      </div>
    </section>
  );
}
