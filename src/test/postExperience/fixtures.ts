// Atomy testowe MODUŁU 1 („Wpisy: doświadczenie czytelnika").
//
// Ta sama zasada, co w `src/test/{chat,profile,network,paywall}/fixtures.ts`:
// atomic design zastosowany do TESTÓW. Jedno źródło prawdy dla fabryk bloków,
// ustawień i atrap, więc zmiana kontraktu warstwy danych psuje JEDEN plik, a nie
// wszystkie testy modułu.
//
// Atrapa łańcucha PostgREST NIE jest tu kopiowana - jest JEDNA w repo
// (`src/test/supabaseChain.ts`) i stąd tylko przechodzi dalej.
//
// UWAGA - NIE IMPORTUJ TEGO PLIKU Z FABRYKI `vi.mock`. Fixture'y sięgają po
// wartości runtime'owe warstwy ustawień (`TOC_DEFAULTS`,
// `KEY_TAKEAWAYS_DEFAULTS`), a te moduły importują klienta Supabase. Fabryka
// mocka klienta, która czeka na te fixture'y, domyka cykl inicjalizacji i
// ZAWIESZA cały plik testowy (nie wywala go - zawiesza, co jest znacznie
// trudniejsze do zdiagnozowania). W fabryce mocka importuj bezpośrednio
// `@/test/supabaseChain` - ten moduł nie ma ANI JEDNEGO importu z produkcji.
import type { Mock } from "vitest";

import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { TOC_DEFAULTS, type TocDefaults, type TocOverride } from "@/lib/toc/settings";
import { KEY_TAKEAWAYS_DEFAULTS, type KeyTakeawaysSettings } from "@/lib/keyTakeaways/settings";

export {
  fail,
  ok,
  okCount,
  pgError,
  supabaseFromStub,
  type PostgrestErrorLike,
  type RecordedCall,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabaseChain";

/**
 * Identyfikatory testowe. Tenant jest JAWNY, bo cała warstwa ustawień modułu
 * zapisuje przez `upsert(..., { onConflict: "tenant_id,key" })` - test zapisu
 * ma z czym porównać właściciela wiersza, zamiast ufać domyślnej wartości bazy.
 */
export const POST_IDS = {
  tenant: "11111111-1111-1111-1111-111111111111",
  otherTenant: "99999999-9999-9999-9999-999999999999",
  post: "22222222-2222-2222-2222-222222222222",
  otherPost: "33333333-3333-3333-3333-333333333333",
  user: "44444444-4444-4444-4444-444444444444",
  author: "55555555-5555-5555-5555-555555555555",
} as const;

/** Klucz zbiorczego zapytania `site_settings` - patrz `lib/useSiteSetting`. */
export const SITE_SETTINGS_QUERY_KEY = ["site_settings_public", "all"] as const;

// --- bloki treści -----------------------------------------------------------

/** Blok nagłówka. Poziom i tekst to jedyne, co czyta ekstrakcja spisu treści. */
export function headingBlock(
  level: number,
  text: string,
  id = `h-${level}-${text.slice(0, 12)}`,
): Block {
  return { id, type: "heading", data: { level, text } };
}

export function paragraphBlock(text: string, id = `p-${text.slice(0, 12)}`): Block {
  return { id, type: "paragraph", data: { text } };
}

export function blocksDoc(...blocks: Block[]): BlocksDoc {
  return { version: 1, blocks };
}

export function localizedBlocks(pl: BlocksDoc, en: BlocksDoc = blocksDoc()): LocalizedBlocks {
  return { pl, en };
}

/**
 * Dokument z pełną drabinką nagłówków H1-H6. Używany tam, gdzie test dowodzi
 * ZAKRESU poziomów (minLevel/maxLevel) albo liczników per poziom.
 */
export function headingLadderDoc(): BlocksDoc {
  return blocksDoc(
    headingBlock(1, "Tytuł główny"),
    headingBlock(2, "Sekcja druga"),
    headingBlock(3, "Podsekcja trzecia"),
    headingBlock(4, "Poziom czwarty"),
    headingBlock(5, "Poziom piąty"),
    headingBlock(6, "Poziom szósty"),
  );
}

// --- ustawienia -------------------------------------------------------------

export function tocDefaults(overrides: Partial<TocDefaults> = {}): TocDefaults {
  return { ...TOC_DEFAULTS, ...overrides };
}

/**
 * Nadpisanie per wpis. Wszystkie pola są `null` (= „użyj globalnych"), więc test
 * podaje TYLKO to, co faktycznie nadpisuje - inaczej nie dowodziłby scalania.
 */
export function tocOverride(overrides: Partial<NonNullable<TocOverride>> = {}): TocOverride {
  return {
    enabled: null,
    layout: null,
    columns: null,
    position: null,
    showInBody: null,
    sticky: null,
    ...overrides,
  };
}

export function keyTakeawaysSettings(
  overrides: Partial<KeyTakeawaysSettings> = {},
): KeyTakeawaysSettings {
  return { ...KEY_TAKEAWAYS_DEFAULTS, ...overrides };
}

// --- atrapa i18n ------------------------------------------------------------

/**
 * Echo klucza zamiast tłumaczenia. Test asertuje na KLUCZU, więc zmiana copy
 * w słowniku nie łamie testu, a brak klucza w drzewie widać natychmiast.
 * Interpolacja jest dopisywana jawnie, żeby test odmiany liczebników mógł
 * sprawdzić, jakie DANE poszły do słownika.
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (!options) return key;
  const params = Object.entries(options)
    .filter(([name]) => name !== "defaultValue")
    .map(([name, value]) => `${name}=${String(value)}`)
    .sort();
  return params.length > 0 ? `${key}(${params.join(",")})` : key;
}

export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => {
    t: typeof translateKey;
    i18n: { language: string; t: typeof translateKey };
  };
  initReactI18next: { type: string; init: () => void };
  Trans: (props: { children?: unknown }) => unknown;
} {
  // Jeden STABILNY obiekt `i18n` (getter na `language`), jak realna instancja
  // i18next - panele wpinają go do tablic zależności efektów.
  const i18n = {
    get language() {
      return getLanguage();
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
}

// --- atrapy hooków ----------------------------------------------------------

/** Kształt, jakiego panele modułu oczekują od `useMutation`. */
export interface MutationStub {
  mutate: Mock;
  mutateAsync: Mock;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: Mock;
}

/** Kształt, jakiego panele modułu oczekują od `useQuery`. */
export interface QueryStub<T> {
  data: T | undefined;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  refetch: Mock;
}
