// FUNDAMENTY TECHNICZNE SEO - czyste reguły oceny plików generowanych.
//
// PO CO. Zewnętrzne skanery (Search Console, audyty SEO) potrafią raportować
// „brak mapy strony" albo „brak atrybutu lang" długo po tym, jak jedno i drugie
// jest już na produkcji - raport bywa nieświeży. Redakcja nie ma jak tego
// sprawdzić inaczej niż otwierając plik i czytając XML. Ta warstwa daje
// odpowiedź WPROST: co odpowiada, czym odpowiada i czy nagłówek dokumentu ma
// zadeklarowany język.
//
// MODUŁ JEST CZYSTY - żadnego `fetch`, żadnego DOM. Sieć robi komponent
// (`TechnicalFoundationCard`), a reguły stoją tutaj, żeby dały się przetestować
// bez przeglądarki i bez sieci.

/** Wynik jednego sprawdzenia fundamentu. */
export type FoundationState = "ok" | "warn" | "fail" | "unknown";

export interface FoundationProbe {
  /** Status HTTP odpowiedzi (0 = brak odpowiedzi / błąd sieci). */
  status: number;
  /** Treść odpowiedzi, przycięta do pierwszych kilku kilobajtów. */
  body: string;
}

export interface FoundationCheck {
  id: string;
  state: FoundationState;
  /** Klucz opisu szczegółu, uzupełniany o `detailValue`. */
  detailKey: string;
  detailValue?: string | number;
}

/** Ile bajtów odpowiedzi wystarcza na rozstrzygnięcie każdej reguły niżej. */
export const FOUNDATION_BODY_LIMIT = 8192;

/**
 * Mapa strony. `<sitemapindex>` i `<urlset>` są OBA poprawne - serwis wystawia
 * indeks wskazujący shardy sekcji, więc reguła nie może wymagać `<urlset>`.
 */
export function checkSitemap(probe: FoundationProbe): FoundationCheck {
  if (probe.status !== 200) {
    return { id: "sitemap", state: "fail", detailKey: "foundationHttp", detailValue: probe.status };
  }
  const isIndex = probe.body.includes("<sitemapindex");
  const isUrlset = probe.body.includes("<urlset");
  if (!isIndex && !isUrlset) {
    return { id: "sitemap", state: "fail", detailKey: "foundationSitemapMalformed" };
  }
  const count = isIndex
    ? (probe.body.match(/<sitemap>/g) ?? []).length
    : (probe.body.match(/<url>/g) ?? []).length;
  if (count === 0) {
    return { id: "sitemap", state: "warn", detailKey: "foundationSitemapEmpty" };
  }
  return {
    id: "sitemap",
    state: "ok",
    detailKey: isIndex ? "foundationSitemapIndex" : "foundationSitemapUrlset",
    detailValue: count,
  };
}

/**
 * robots.txt. Sama odpowiedź 200 nie wystarcza: plik bez deklaracji `Sitemap:`
 * nie prowadzi crawlera do mapy, a to była treść zgłoszenia.
 */
export function checkRobots(probe: FoundationProbe): FoundationCheck {
  if (probe.status !== 200) {
    return { id: "robots", state: "fail", detailKey: "foundationHttp", detailValue: probe.status };
  }
  const sitemaps = (probe.body.match(/^\s*Sitemap:\s*\S+/gim) ?? []).length;
  if (sitemaps === 0) {
    return { id: "robots", state: "warn", detailKey: "foundationRobotsNoSitemap" };
  }
  return {
    id: "robots",
    state: "ok",
    detailKey: "foundationRobotsSitemaps",
    detailValue: sitemaps,
  };
}

/** llms.txt jest opcjonalny - jego brak to informacja, nie awaria. */
export function checkLlms(probe: FoundationProbe): FoundationCheck {
  if (probe.status === 404) {
    return { id: "llms", state: "warn", detailKey: "foundationLlmsDisabled" };
  }
  if (probe.status !== 200) {
    return { id: "llms", state: "fail", detailKey: "foundationHttp", detailValue: probe.status };
  }
  return { id: "llms", state: "ok", detailKey: "foundationLlmsPresent" };
}

/**
 * Atrybut `lang` na `<html>`. Pusty (`lang=""`) liczy się jako BRAK - to ten sam
 * defekt dla czytnika ekranu i dla wyszukiwarki, co całkowicie pominięty
 * atrybut.
 */
export function checkHtmlLang(probe: FoundationProbe): FoundationCheck {
  if (probe.status !== 200) {
    return {
      id: "htmlLang",
      state: "fail",
      detailKey: "foundationHttp",
      detailValue: probe.status,
    };
  }
  const match = /<html[^>]*\slang=["']([^"']*)["']/i.exec(probe.body);
  const value = match?.[1]?.trim() ?? "";
  if (!value) {
    return { id: "htmlLang", state: "fail", detailKey: "foundationLangMissing" };
  }
  return { id: "htmlLang", state: "ok", detailKey: "foundationLangPresent", detailValue: value };
}

/** Najgorszy stan z listy - nagłówek sekcji świeci się kolorem problemu. */
export function worstFoundationState(checks: readonly FoundationCheck[]): FoundationState {
  const order: FoundationState[] = ["fail", "warn", "unknown", "ok"];
  for (const state of order) {
    if (checks.some((check) => check.state === state)) return state;
  }
  return "ok";
}
