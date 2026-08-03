// Rozstrzyganie punktów "Z tego materiału dowiesz się..." dla renderu
// publicznego - jeden seam dla WPISÓW i STRON.
//
// Dlaczego osobny moduł: gałąź renderu w `routes/$.tsx` liczyła to wyrażenie
// dwa razy (raz dla JSON-LD w head(), raz dla body), a dwa audyty z rzędu
// (2026-07-30, 2026-08-01) zapisały nieprawdę, że "dla stron gałąź renderu
// nigdy ich nie pokazuje". Weryfikacja pokazała odwrotnie: kolumny istnieją na
// `pages` (migracja 20260709100809 + trigger walidacyjny), loader stron je
// selectuje, a render nie ma bramki `isPost`. Skoro sam kod nie dawał się
// przeczytać jednoznacznie, kontrakt dostaje własny, testowany moduł.
import { normalizeTakeaways } from "./limits";

/** Minimalny kształt encji treści (wpis albo strona) potrzebny do rozstrzygnięcia. */
export interface TakeawaysSource {
  readonly takeaways_pl?: readonly string[] | null;
  readonly takeaways_en?: readonly string[] | null;
}

/**
 * Punkty dla aktywnego języka, znormalizowane.
 *
 * ŚWIADOMIE BEZ fallbacku między językami: polskie bullety na stronie EN są
 * gorsze niż brak sekcji (sekcja obiecuje "z tego materiału dowiesz się", a
 * dowiedziałby się w innym języku niż czyta). Brak punktów w aktywnym języku
 * daje pustą listę, a `KeyTakeaways` nie renderuje wtedy nic.
 *
 * Kontrakt jest identyczny dla wpisów i stron - typ przyjmuje obie encje,
 * bo obie mają te same kolumny.
 */
export function resolveTakeaways(source: TakeawaysSource | null | undefined, lang: "pl" | "en") {
  if (!source) return [];
  return normalizeTakeaways(lang === "en" ? source.takeaways_en : source.takeaways_pl);
}
