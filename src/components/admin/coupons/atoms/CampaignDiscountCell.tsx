// Atom: komórka „Rabat" w tabeli KAMPANII.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 251-255):
//   c.discount_kind === "percent"
//     ? `${c.discount_percent}%`
//     : `${((c.discount_cents ?? 0) / 100).toFixed(2)} ${c.currency ?? ""}`
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI - i one są tu przedmiotem dowodu:
//   * `discount_percent` równe null wypisuje literalnie „null%";
//   * `discount_cents` równe null udaje kupon darmowy („0.00");
//   * brak waluty zostawia wiszącą liczbę ze spacją na końcu;
//   * kwota ujemna wychodzi na ekran jako „-25.00" (wygląda jak dopłata).
// Repo ma poprawny formatter z walutą (`formatDiscountLabel` w
// `@/lib/billing/coupons`), którego ta powierzchnia NIE UŻYWA. Podmiana to
// zmiana zachowania, więc nie tutaj - defekty są zgłoszone przez `it.fails`.
//
// WĘŻSZY NIŻ MÓGŁBY BYĆ, ŚWIADOMIE. Ta sama pięciolinijka stoi też w tabeli
// pojedynczych kuponów (`admin.coupons.index.tsx`). Wspólny atom dla obu
// tabel jest sensowny, ale powstaje w innym zadaniu na tej samej powierzchni -
// żeby nie pisać go dwa razy w dwóch gałęziach, ten nazywa się „Campaign…"
// i obsługuje wyłącznie wiersz kampanii.
import type { CampaignDiscountKind } from "@/lib/billing/couponCampaignForm";

export function CampaignDiscountCell({
  kind,
  percent,
  cents,
  currency,
}: {
  kind: CampaignDiscountKind;
  percent: number | null;
  cents: number | null;
  currency: string | null;
}) {
  return (
    <>
      {kind === "percent" ? `${percent}%` : `${((cents ?? 0) / 100).toFixed(2)} ${currency ?? ""}`}
    </>
  );
}
