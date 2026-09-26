// Napisy liczb ekranu "Lejek Google Ads" - jedno miejsce dla kwot, udzialow
// i ROAS, zeby kafle, tabela i eksport mowily to samo.
//
// `null` ZNACZY "NIE WIEM" i ekran rysuje wtedy kreske - pusta lista kwot,
// zerowy mianownik albo wskaznik niepoliczalny (kilka walut) nie udaja zera.
// Kwoty w roznych walutach stoja obok siebie ("499,00 zl + 10,00 EUR") - nigdy
// ich nie sumujemy.
import { formatMoney } from "@/lib/billing/types";
import { microsToCents, type CostAmount, type MoneyAmount } from "@/lib/events/adsFunnel";

export function formatAmounts(items: readonly MoneyAmount[], lang: string): string | null {
  if (items.length === 0) return null;
  return items.map((item) => formatMoney(item.cents, item.currency, lang)).join(" + ");
}

export function formatCosts(items: readonly CostAmount[], lang: string): string | null {
  return formatAmounts(
    items.map((item) => ({ currency: item.currency, cents: microsToCents(item.micros) })),
    lang,
  );
}

export function formatRate(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)}%`;
}

export function formatRoas(roas: number | null): string | null {
  return roas === null ? null : `${roas.toFixed(2)}×`;
}
