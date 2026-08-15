// Warstwa danych widgetów auth (login / register / lost-password / reset-password).
//
// Czysty moduł: zero Reacta, zero DOM-u, zero Supabase. Trzyma dokładnie te
// decyzje, które wcześniej były rozsypane po komponencie i przez to nietestowalne:
//   - jak czytać przełącznik zapisany raz jako `true`, raz jako string "0",
//   - jak czytać ustawienie, którego klucz rozjechał się między schematem a
//     komponentem (nowy klucz kanoniczny + stary alias),
//   - jaki wariant powłoki renderer naprawdę umie narysować i jakie klasy
//     układu z niego wynikają.
//
// Koercja wartości idzie przez `contentValue.ts` - to jedyne miejsce, które
// wie, że "0" znaczy false.
import { asBool, asOneOf, asStr } from "./contentValue";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export type AuthLang = "pl" | "en";

/** Dowolny worek treści widgetu. */
export type AuthContent = Record<string, unknown>;

/** Warianty powłoki, które renderer naprawdę rysuje inaczej. */
export type AuthVariant = "card" | "flat" | "inline";

export const AUTH_VARIANTS: ReadonlyArray<AuthVariant> = ["card", "flat", "inline"];

/**
 * Historyczne wartości `variant` w zapisanych dokumentach. `plain` był dawnym
 * układem bez ramki, `split` istniał tylko w typie i renderował się jak karta.
 */
const LEGACY_VARIANT_ALIAS: Readonly<Record<string, AuthVariant>> = {
  plain: "flat",
  split: "card",
};

/** Zawęża zapisany `variant` do wariantu, który realnie istnieje w renderze. */
export function readAuthVariant(value: unknown): AuthVariant {
  const raw = asStr(value).trim().toLowerCase();
  const alias = LEGACY_VARIANT_ALIAS[raw];
  if (alias) return alias;
  return asOneOf(raw, AUTH_VARIANTS, "card");
}

/**
 * Odczyt przełącznika z listy aliasów kluczy (kanoniczny -> historyczny).
 *
 * `asBool` zwraca `fallback` dla wartości nierozpoznanej, więc sondujemy go
 * dwoma różnymi fallbackami: zgodny wynik znaczy "ta wartość naprawdę coś
 * mówi". Bez tej sondy klucz obecny, ale zaśmiecony (np. `{}`) blokowałby
 * fallback na starszy klucz.
 */
export function readAuthFlag(
  data: AuthContent,
  keys: ReadonlyArray<string>,
  fallback: boolean,
): boolean {
  for (const key of keys) {
    const raw = data[key];
    if (raw === undefined || raw === null) continue;
    const asTrue = asBool(raw, true);
    if (asTrue === asBool(raw, false)) return asTrue;
  }
  return fallback;
}

/**
 * Odczyt tekstu i18n (`${key}_pl` / `${key}_en`) z listy aliasów kluczy.
 * Pusty / białoznakowy wpis nie blokuje kolejnego aliasu ani fallbacku.
 * Polityka języka jest w całości delegowana do `pickLocalized`.
 */
export function pickAuthText(
  data: AuthContent,
  keys: ReadonlyArray<string>,
  lang: AuthLang,
  fallback = "",
): string {
  for (const key of keys) {
    const value = pickLocalized(data, key, lang, "");
    if (value) return value;
  }
  return fallback;
}

/** Klasy powłoki per wariant. Każdy wariant ma inny obrys, szerokość i padding. */
export const AUTH_SHELL_CLASS: Readonly<Record<AuthVariant, string>> = {
  // Karta: obramowanie + cień, wąska kolumna wyśrodkowana.
  card: "auth-shell--card my-6 mx-auto w-full max-w-md rounded-xl border border-border bg-transparent shadow-sm p-6",
  // Płaski: bez ramki, bez cienia, bez paddingu - wtapia się w sekcję strony.
  flat: "auth-shell--flat my-6 mx-auto w-full max-w-md",
  // Inline: kompaktowy pasek na całą szerokość, pola układają się poziomo.
  inline:
    "auth-shell--inline my-4 mx-auto w-full max-w-3xl rounded-lg border border-border/60 bg-transparent px-4 py-3",
};

export interface AuthLayout {
  /** Klasa dla <form>. */
  form: string;
  /** Klasa dla elementu, który ma zająć całą szerokość układu. */
  wide: string;
  /** Klasa dla wiersza pomocniczego (zapamiętaj mnie / zapomniałem hasła). */
  meta: string;
}

/**
 * Układ pól per wariant. `card` i `flat` to klasyczna kolumna, `inline` to
 * siatka dwukolumnowa od breakpointu `sm` (na telefonie nadal jedna kolumna).
 */
export const AUTH_LAYOUT: Readonly<Record<AuthVariant, AuthLayout>> = {
  card: { form: "space-y-4", wide: "", meta: "flex items-center justify-between gap-3 text-sm" },
  flat: { form: "space-y-4", wide: "", meta: "flex items-center justify-between gap-3 text-sm" },
  inline: {
    form: "grid grid-cols-1 gap-3 sm:grid-cols-2",
    wide: "sm:col-span-2",
    meta: "sm:col-span-2 flex flex-wrap items-center justify-between gap-3 text-sm",
  },
};
