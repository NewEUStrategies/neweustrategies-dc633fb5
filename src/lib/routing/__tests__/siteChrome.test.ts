// Które ścieżki pokazują chrome serwisu.
//
// CO TO DOWODZI. Loader korzenia na podstawie tej decyzji rozgrzewa albo NIE
// rozgrzewa zapytań menu, tickera i stopki - czyli decyduje o kilku
// round-tripach na KAŻDE żądanie. Predykat był czterema warunkami wplecionymi
// w loader (`__root.tsx`, 0% pokrycia); pomyłka w którąkolwiek stronę jest
// kosztowna, a żadna nie daje błędu: fałszywe „tak" dokłada zapytania do panelu
// i logowania, fałszywe „nie" daje pierwsze malowanie strony publicznej bez
// nawigacji.
//
// SEDNO TABELI to trzy pary, w których naiwne `startsWith` się myli:
// `/administracja` NIE jest panelem, `/logowanie` NIE jest logowaniem,
// a `/admin` bez ukośnika JEST panelem.
import { describe, expect, it } from "vitest";

import { showsSiteChrome } from "../siteChrome";

describe("showsSiteChrome", () => {
  it.each([
    // ── bez chrome'u: panel i logowanie ──────────────────────────────────
    { path: "/admin", chrome: false },
    { path: "/admin/", chrome: false },
    { path: "/admin/posts", chrome: false },
    { path: "/admin/clubs/123/members", chrome: false },
    { path: "/login", chrome: false },
    { path: "/login/", chrome: false },
    { path: "/login/reset", chrome: false },
    // ── z chrome'em: wszystko publiczne ──────────────────────────────────
    { path: "/", chrome: true },
    { path: "/analizy", chrome: true },
    { path: "/analizy/energetyka/atom", chrome: true },
    { path: "/blog", chrome: true },
    { path: "/profile/plan", chrome: true },
    // ── pułapki prefiksu ─────────────────────────────────────────────────
    { path: "/administracja", chrome: true },
    { path: "/admin-panel", chrome: true },
    { path: "/adminy", chrome: true },
    { path: "/logowanie", chrome: true },
    { path: "/login-help", chrome: true },
    // ── prefiks nie na początku ──────────────────────────────────────────
    { path: "/blog/admin", chrome: true },
    { path: "/o-nas/login", chrome: true },
    // ── brzegi ───────────────────────────────────────────────────────────
    { path: "", chrome: true },
    { path: "/a", chrome: true },
  ])("$path -> chrome: $chrome", ({ path, chrome }) => {
    expect(showsSiteChrome(path)).toBe(chrome);
  });
});
