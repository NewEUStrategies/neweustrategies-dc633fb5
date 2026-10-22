// Miesiące i wartości siatki danych wejściowych (SPEC §2.2 `inputs`; S2:
// `admin_revenue_input_upsert`, Z-S2-06).
//
// MIESIĄCE LOKALNE. Atomu miesiąca w `components/ui` nie ma (`DateInput`
// zna tylko `date`/`datetime-local`), więc wybór idzie przez `FormSelect`
// z listy liczonej TU z LOKALNYCH pól daty (`getFullYear`/`getMonth`) -
// nigdy `toISOString().slice(0, 7)`: północ 1 listopada w Warszawie to
// 31 października w UTC i lista zaczynałaby się miesiąc za wcześnie.
//
// OKNO 24 MIESIĘCY. Odczyt `admin_revenue_inputs` przyjmuje najwyżej
// 24 miesiące (`p_to_month ≤ p_from_month + 23 months`), więc lista to
// 12 miesięcy wstecz, bieżący i 11 naprzód - plan pisze się z wyprzedzeniem,
// koszty po fakcie.
//
// WARTOŚCI BEZ CICHYCH POPRAWEK. Kwota ujemna, udział spoza [-100, 100] albo
// liczba klientów z ułamkiem to BŁĄD z komunikatem, nie obcięcie (AGENTS:
// odrzucać, nigdy `slice`); `new_customers_plan` to LICZBA klientów
// (Z-S2-06), a nie kwota w groszach.
//
// MODUŁ CZYSTY (bez Reacta).
import { currencyExponent } from "@/lib/analytics/semantic/format";
import { REVENUE_RATIO_INPUT_KINDS } from "@/lib/revenue/finance/dto";
import type { RevenueInputKind } from "@/lib/revenue/limits";
import { REVENUE_LIMITS } from "@/lib/revenue/limits";

/** Miesiące wstecz i naprzód od bieżącego - razem 24 (limit odczytu SQL). */
export const INPUT_MONTHS_BACK = 12;
export const INPUT_MONTHS_AHEAD = 11;

export type InputValueKind = "amount" | "ratio" | "count";

/**
 * Jak rodzaj danej jest zapisywany: udział bez waluty (`REVENUE_RATIO_INPUT_KINDS`
 * S2), liczba klientów (Z-S2-06) albo kwota z walutą.
 */
export function inputValueKind(kind: RevenueInputKind): InputValueKind {
  if (REVENUE_RATIO_INPUT_KINDS.includes(kind)) return "ratio";
  if (kind === "new_customers_plan") return "count";
  return "amount";
}

/** `YYYY-MM` z LOKALNYCH pól daty. */
export function localMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Miesiące siatki rosnąco: 12 wstecz, bieżący, 11 naprzód (lokalnie). */
export function inputMonths(nowMs: number): string[] {
  const now = new Date(nowMs);
  const out: string[] = [];
  for (let offset = -INPUT_MONTHS_BACK; offset <= INPUT_MONTHS_AHEAD; offset += 1) {
    out.push(localMonthKey(new Date(now.getFullYear(), now.getMonth() + offset, 1)));
  }
  return out;
}

/** `YYYY-MM` → `YYYY-MM-01` (kontrakt `periodMonth`). */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** Miesiąc do podpisu („listopad 2026") - data lokalna, bez strefy napisu. */
export function monthDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}

export type ParsedInput = { ok: true; value: number | null } | { ok: false };

function normalized(raw: string): string {
  return raw.replace(/\s/g, "").replace(",", ".");
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Wartość pola jako liczba w jednostkach zapisu. Puste pole = `null`
 * (usunięcie wartości), napis spoza wzoru = błąd.
 *
 * @param currency waluta kwoty - wykładnik jednostek drobnych (PLN 2, JPY 0)
 */
export function parseInputValue(
  raw: string,
  valueKind: InputValueKind,
  currency: string | null,
): ParsedInput {
  const text = normalized(raw);
  if (text === "") return { ok: true, value: null };
  if (!NUMBER.test(text)) return { ok: false };
  const number = Number(text);
  if (!Number.isFinite(number)) return { ok: false };

  if (valueKind === "ratio") {
    const ratio = number / 100;
    if (ratio < REVENUE_LIMITS.inputRatioMin || ratio > REVENUE_LIMITS.inputRatioMax) {
      return { ok: false };
    }
    return { ok: true, value: ratio };
  }
  if (number < 0) return { ok: false };
  if (valueKind === "count") {
    return Number.isSafeInteger(number) ? { ok: true, value: number } : { ok: false };
  }
  const exponent = currencyExponent(currency ?? "");
  const minor = number * 10 ** exponent;
  // Więcej miejsc po przecinku niż ma waluta = błąd, nie zaokrąglenie.
  if (Math.abs(minor - Math.round(minor)) > 1e-6) return { ok: false };
  const rounded = Math.round(minor);
  return Number.isSafeInteger(rounded) ? { ok: true, value: rounded } : { ok: false };
}

/** Wartość z bazy jako napis pola (separator dziesiętny języka panelu). */
export function inputFieldValue(
  stored: { amountMinor: number | null; ratio: number | null } | undefined,
  valueKind: InputValueKind,
  currency: string | null,
  lang: "pl" | "en",
): string {
  if (!stored) return "";
  let text: string;
  if (valueKind === "ratio") {
    if (stored.ratio === null) return "";
    text = String(Math.round(stored.ratio * 10_000) / 100);
  } else {
    if (stored.amountMinor === null) return "";
    if (valueKind === "count") return String(stored.amountMinor);
    const exponent = currencyExponent(currency ?? "");
    text = (stored.amountMinor / 10 ** exponent).toFixed(exponent);
  }
  return lang === "pl" ? text.replace(".", ",") : text;
}

/** Notatka po `btrim` - limit liczy się tak jak w SQL. */
export function noteLength(note: string): number {
  return note.trim().length;
}

/** Czy notatka mieści się w limicie zapisu (500 znaków) - za długa jest odrzucana. */
export function noteFits(note: string): boolean {
  return noteLength(note) <= REVENUE_LIMITS.inputNoteMax;
}
