// KONTRAKT PARAMETRÓW URL EDYTORA ŚCIEŻKI (/admin/revenue/journeys/$journeyId).
//
// Liść w tym samym sensie co `lib/revenue/search.ts`: walidator jedzie
// w powłoce trasy, czyli w chunku wejściowym, więc jedynym dozwolonym
// importem jest tamten liść (okresy statystyk są TE SAME co okresy huba -
// jedna lista, zero dryfu). Test `editorSearch.test.ts` pilnuje importów.
import { REVENUE_PERIODS, type RevenuePeriod } from "@/lib/revenue/search";

/** Widok edytora: kanwa grafu, lista kroków albo wyniki. */
export const JOURNEY_EDITOR_VIEWS = ["canvas", "list", "results"] as const;
export type JourneyEditorView = (typeof JOURNEY_EDITOR_VIEWS)[number];

/** Zakładki panelu bocznego edytora. */
export const JOURNEY_EDITOR_TABS = ["settings", "results", "contacts"] as const;
export type JourneyEditorTab = (typeof JOURNEY_EDITOR_TABS)[number];

export interface JourneyEditorSearch {
  view?: JourneyEditorView;
  /** Identyfikator węzła grafu (stabilny między wersjami). */
  node?: string;
  tab?: JourneyEditorTab;
  /** Okno statystyk nakładanych na kanwę; `off` chowa liczby. */
  stats?: RevenuePeriod | "off";
  /** Numer opublikowanej wersji (`journey_versions.version`, od 1). */
  version?: number;
}

/**
 * Identyfikator węzła nadaje edytor (`n1`, `send_email_2`…). Pilnujemy
 * kształtu, nie wartości - nieistniejący węzeł to stan grafu, nie adresu.
 */
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function oneOf<T extends string>(list: readonly T[], raw: unknown): T | undefined {
  return typeof raw === "string" && (list as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

/**
 * Router parsuje adres przez `JSON.parse`, więc `?version=3` jest liczbą,
 * a `?version=%223%22` napisem - obie formy znaczą to samo.
 */
function versionNumber(raw: unknown): number | undefined {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

function nodeId(raw: unknown): string | undefined {
  const text = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
  return typeof text === "string" && NODE_ID.test(text) ? text : undefined;
}

/**
 * Walidator `validateSearch` edytora. Zasada kluczy jak w
 * `parseRevenueHubSearch`: nieobecne nie pojawiają się w wyniku, a znany klucz
 * obecny w adresie z wartością odrzuconą wraca jako jawne `undefined`, żeby
 * router nie przepuścił surowej wartości do komponentu.
 */
export function parseJourneyEditorSearch(raw: Record<string, unknown>): JourneyEditorSearch {
  const out: JourneyEditorSearch = {};
  const put = <K extends keyof JourneyEditorSearch>(key: K, value: JourneyEditorSearch[K]) => {
    if (value !== undefined || key in raw) out[key] = value;
  };

  put("view", oneOf(JOURNEY_EDITOR_VIEWS, raw.view));
  put("node", nodeId(raw.node));
  put("tab", oneOf(JOURNEY_EDITOR_TABS, raw.tab));
  put("stats", raw.stats === "off" ? "off" : oneOf(REVENUE_PERIODS, raw.stats));
  put("version", versionNumber(raw.version));
  return out;
}
