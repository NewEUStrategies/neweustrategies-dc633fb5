// Które dokumenty powstają w całości PO hydratacji.
//
// CO TO DOWODZI. Predykat decyduje o TERMINIE pierwszej fali rozgrzewki
// w loaderze korzenia, czyli o tym, jak długo dokument może czekać przed
// pierwszym bajtem. Fałszywe „tak" na trasie publicznej ścięłoby rozgrzewkę
// motywu do 300 ms i mogło oddać stronę bez palety najemcy; fałszywe „nie"
// na `/admin` przywraca czekanie do 2 500 ms na dane, z których w tym
// dokumencie nie powstaje ANI JEDEN piksel (trasa ma `ssr: false`).
//
// SEDNO TABELI to te same trzy klasy pułapek, co w `siteChrome.test.ts`:
// prefiks bez ukośnika (`/admin` JEST panelem), prefiks jako przedrostek
// innego słowa (`/administracja` NIE jest) i prefiks w środku ścieżki
// (`/blog/admin` NIE jest) - plus czwarta, której tamten predykat nie ma:
// prefiks języka (`/en/admin` JEST panelem).
import { describe, expect, it } from "vitest";

import {
  CHROME_ONLY_WARM_BUDGET_MS,
  CLIENT_ONLY_WARM_BUDGET_MS,
  isChromeOnlyDocument,
  isClientOnlyDocument,
} from "../clientOnlyDocument";

describe("isClientOnlyDocument", () => {
  it.each([
    // ── panel: dokument bez serwerowego renderu ──────────────────────────
    { path: "/admin", clientOnly: true },
    { path: "/admin/", clientOnly: true },
    { path: "/admin/posts", clientOnly: true },
    { path: "/admin/analytics/bi", clientOnly: true },
    // ── prefiks języka jest zdejmowany ───────────────────────────────────
    { path: "/en/admin", clientOnly: true },
    { path: "/en/admin/posts", clientOnly: true },
    // ── publiczne: render serwerowy treści albo chrome'u ─────────────────
    { path: "/", clientOnly: false },
    { path: "/en", clientOnly: false },
    { path: "/blog", clientOnly: false },
    { path: "/login", clientOnly: false },
    // `/messages` ma `ssr: false`, ALE pokazuje chrome serwisu - jego
    // nagłówek i stopka renderują się z fali 1, więc NIE wolno jej tam ścinać.
    { path: "/messages", clientOnly: false },
    { path: "/welcome", clientOnly: false },
    { path: "/events/forum/register", clientOnly: false },
    // ── pułapki prefiksu ─────────────────────────────────────────────────
    { path: "/administracja", clientOnly: false },
    { path: "/admin-panel", clientOnly: false },
    { path: "/adminy", clientOnly: false },
    { path: "/blog/admin", clientOnly: false },
    // ── brzegi ───────────────────────────────────────────────────────────
    { path: "", clientOnly: false },
    { path: "/a", clientOnly: false },
  ])("$path -> client-only: $clientOnly", ({ path, clientOnly }) => {
    expect(isClientOnlyDocument(path)).toBe(clientOnly);
  });

  it("termin jest KRÓTKI - inaczej cała zmiana nic nie daje", () => {
    // Nie „jakaś liczba": sens tej stałej polega na tym, że jest o rząd
    // wielkości mniejsza od `ROOT_WARM_BUDGET_MS` (2 500 ms) i jednocześnie
    // mieści zdrowy round-trip do PostgREST. Podniesienie jej do wartości
    // porównywalnej z falą 1 cofnęłoby naprawę TTFB panelu po cichu.
    expect(CLIENT_ONLY_WARM_BUDGET_MS).toBeGreaterThanOrEqual(100);
    expect(CLIENT_ONLY_WARM_BUDGET_MS).toBeLessThanOrEqual(500);
  });
});

describe("isChromeOnlyDocument", () => {
  it.each([
    // ── chrome serwisu, treść w całości po hydratacji ────────────────────
    { path: "/profile", chromeOnly: true },
    { path: "/profile/", chromeOnly: true },
    { path: "/profile/billing", chromeOnly: true },
    { path: "/network", chromeOnly: true },
    { path: "/network/mutual/u1", chromeOnly: true },
    { path: "/people", chromeOnly: true },
    { path: "/reading-list", chromeOnly: true },
    { path: "/messages", chromeOnly: true },
    { path: "/checkout/plan-1", chromeOnly: true },
    { path: "/en/profile", chromeOnly: true },
    // ── treść serwerowa: pełna fala 1 zostaje ────────────────────────────
    { path: "/", chromeOnly: false },
    { path: "/blog", chromeOnly: false },
    { path: "/events/forum", chromeOnly: false },
    { path: "/admin", chromeOnly: false },
    // ── pułapki prefiksu ─────────────────────────────────────────────────
    { path: "/profiles", chromeOnly: false },
    { path: "/networking", chromeOnly: false },
    { path: "/blog/profile", chromeOnly: false },
    { path: "", chromeOnly: false },
  ])("$path -> chrome-only: $chromeOnly", ({ path, chromeOnly }) => {
    expect(isChromeOnlyDocument(path)).toBe(chromeOnly);
  });

  it("termin chrome-only leży między terminem client-only a pełną falą 1", () => {
    expect(CHROME_ONLY_WARM_BUDGET_MS).toBeGreaterThan(CLIENT_ONLY_WARM_BUDGET_MS);
    expect(CHROME_ONLY_WARM_BUDGET_MS).toBeLessThanOrEqual(1_000);
  });
});
