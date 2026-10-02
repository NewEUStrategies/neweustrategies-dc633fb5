import { describe, expect, it } from "vitest";
import {
  buildRedirectIndex,
  isProtectedPath,
  matchRedirect,
  matchRedirectForPath,
  normalizeSourcePath,
  normalizeTargetPath,
  parseRedirectsCsv,
  serializeRedirectsCsv,
  type RedirectRule,
} from "@/lib/seo/redirects";

const rule = (
  partial: Partial<RedirectRule> & Pick<RedirectRule, "source_path" | "target_path">,
): RedirectRule => ({
  id: partial.source_path,
  status_code: 301,
  ...partial,
});

describe("normalizeSourcePath", () => {
  it("normalizes case, trailing slash and keeps the query", () => {
    expect(normalizeSourcePath("/Stary-Wpis/")).toBe("/stary-wpis");
    expect(normalizeSourcePath("stary-wpis")).toBe("/stary-wpis");
    expect(normalizeSourcePath("/?p=123")).toBe("/?p=123");
    expect(normalizeSourcePath("https://old.example.com/a/b/?x=1#frag")).toBe("/a/b?x=1");
  });
  it("keeps the root and collapses duplicate slashes", () => {
    expect(normalizeSourcePath("/")).toBe("/");
    expect(normalizeSourcePath("//a///b/")).toBe("/a/b");
  });
  it("accepts wildcard suffix and rejects inner stars", () => {
    expect(normalizeSourcePath("/old-section/*")).toBe("/old-section/*");
    expect(normalizeSourcePath("/bad*path")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(normalizeSourcePath("   ")).toBeNull();
  });
});

describe("normalizeTargetPath", () => {
  it("rejects absolute URLs without an allowlist (open-redirect guard)", () => {
    expect(normalizeTargetPath("https://x.example/a")).toBeNull();
    expect(normalizeTargetPath("https://evil.example/phish", [])).toBeNull();
    expect(normalizeTargetPath("javascript:alert(1)")).toBeNull();
    expect(normalizeTargetPath("javascript:alert(1)", ["x.example"])).toBeNull();
  });
  it("accepts absolute https URLs only for allowlisted hosts (www-aliased)", () => {
    const allowed = ["neweuropeanstrategies.com"];
    expect(normalizeTargetPath("https://neweuropeanstrategies.com/a", allowed)).toBe(
      "https://neweuropeanstrategies.com/a",
    );
    expect(normalizeTargetPath("https://www.neweuropeanstrategies.com/a", allowed)).toBe(
      "https://www.neweuropeanstrategies.com/a",
    );
    expect(normalizeTargetPath("https://evil.example/a", allowed)).toBeNull();
    // http downgrade is never a valid redirect target.
    expect(normalizeTargetPath("http://neweuropeanstrategies.com/a", allowed)).toBeNull();
  });
  it("normalizes relative targets to absolute paths", () => {
    expect(normalizeTargetPath("nowa-sekcja/wpis/")).toBe("/nowa-sekcja/wpis");
    expect(normalizeTargetPath("/a?keep=1")).toBe("/a?keep=1");
  });
});

describe("matchRedirect", () => {
  const index = buildRedirectIndex([
    rule({ source_path: "/stary", target_path: "/nowy" }),
    rule({ source_path: "/?p=123", target_path: "/blog/wpis" }),
    rule({ source_path: "/a", target_path: "/b" }),
    rule({ source_path: "/b", target_path: "/c" }),
    rule({ source_path: "/loop1", target_path: "/loop2" }),
    rule({ source_path: "/loop2", target_path: "/loop1" }),
    rule({ source_path: "/gone", target_path: "/", status_code: 410 }),
    rule({ source_path: "/old-section/*", target_path: "/new-section/*" }),
    rule({ source_path: "/old-flat/*", target_path: "/flat" }),
    rule({ source_path: "/self", target_path: "/self?x=1" }),
  ]);

  it("matches exact paths case- and slash-insensitively", () => {
    expect(matchRedirect(index, "/Stary/")?.target).toBe("/nowy");
  });
  it("matches WP shortlinks by path+query and consumes the query", () => {
    expect(matchRedirect(index, "/", "?p=123")?.target).toBe("/blog/wpis");
  });
  it("preserves an unconsumed query string", () => {
    expect(matchRedirect(index, "/stary", "?utm=x")?.target).toBe("/nowy?utm=x");
  });
  it("follows chains to the final hop", () => {
    expect(matchRedirect(index, "/a")?.target).toBe("/c");
  });
  it("refuses to serve redirect loops", () => {
    // /loop1 -> /loop2 -> /loop1: chain resolution re-enters the start, so the
    // safe behavior is NO redirect at all (a single hop would ping-pong the
    // browser forever).
    expect(matchRedirect(index, "/loop1")).toBeNull();
  });
  it("returns gone for 410 rules", () => {
    const m = matchRedirect(index, "/gone");
    expect(m?.gone).toBe(true);
    expect(m?.statusCode).toBe(410);
  });
  it("maps wildcard remainders", () => {
    expect(matchRedirect(index, "/old-section/a/b")?.target).toBe("/new-section/a/b");
    expect(matchRedirect(index, "/old-section")?.target).toBe("/new-section");
    expect(matchRedirect(index, "/old-flat/anything")?.target).toBe("/flat");
  });
  it("never matches protected system paths", () => {
    const guarded = buildRedirectIndex([rule({ source_path: "/admin/x", target_path: "/y" })]);
    expect(matchRedirect(guarded, "/admin/x")).toBeNull();
  });
  it("drops a self-redirect after query append", () => {
    expect(matchRedirect(index, "/self")).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(matchRedirect(index, "/nieistnieje")).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("protects admin/api/internal prefixes", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/api/x")).toBe(true);
    expect(isProtectedPath("/_internal")).toBe(false);
    expect(isProtectedPath("/_/x")).toBe(true);
    expect(isProtectedPath("/blog")).toBe(false);
  });
});

describe("CSV round-trip", () => {
  it("parses source,target,status,note with a header", () => {
    const csv = [
      "source,target,status,note",
      "/old-a,/new-a,301,po migracji",
      '/old-b,"/new,b",302,',
      "/gone-x,,410,",
      "bad path with *star*,/x,301,",
      "/old-a,/new-a2,301,duplicate wins",
    ].join("\n");
    const { rows, issues } = parseRedirectsCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.source_path === "/old-a")?.target_path).toBe("/new-a2");
    expect(rows.find((r) => r.source_path === "/old-b")?.target_path).toBe("/new,b");
    expect(rows.find((r) => r.source_path === "/gone-x")?.status_code).toBe(410);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe("invalid_source");
  });
  it("serializes back with quoting", () => {
    const out = serializeRedirectsCsv([
      { source_path: "/a", target_path: "/b,c", status_code: 301, note: 'ma "cudzysłów"' },
    ]);
    expect(out).toContain('/a,"/b,c",301,"ma ""cudzysłów"""');
    const back = parseRedirectsCsv(out);
    expect(back.rows).toHaveLength(1);
    expect(back.rows[0]?.note).toBe('ma "cudzysłów"');
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałęzie matchera i importu CSV, których nie dotyka ani ten plik, ani
// `redirectLangAware.test.ts`, `redirectsServerSwr.test.ts`,
// `redirectsServerRequest.test.ts`: zwijanie "\" w źródle i celu, wyjątki
// parsera URL, limit 2048, cel-katalog główny wildcardu, zatrzymanie łańcucha
// (cel absolutny, hop wieloznaczny), degradacja kodu statusu, pętla po
// ponownym prefiksowaniu języka i wiersze wadliwe importu CSV. (Numery linii
// `redirects.ts`, które tu wcześniej stały, rozjechały się z kodem przy
// pierwszej zmianie pliku - nazwy gałęzi się nie rozjeżdżają.)
// ---------------------------------------------------------------------------
describe("normalizeSourcePath / normalizeTargetPath - wejścia wrogie i za długie", () => {
  it("zwija odwrotny ukośnik w CELU na ścieżkę tego samego serwisu", () => {
    // Przeglądarki (WHATWG, schematy "special") czytają "\" jako "/", więc
    // `Location: /\evil.example` wyprowadza czytelnika na https://evil.example -
    // otwarte przekierowanie OBOK allowlisty, bo allowlista bada tylko wejścia
    // WYGLĄDAJĄCE na absolutne. cleanPathname zwija ukośnik, zanim to się stanie.
    expect(normalizeTargetPath("/\\evil.example")).toBe("/evil.example");
    expect(normalizeTargetPath("\\\\evil.example\\a")).toBe("/evil.example/a");
    expect(normalizeTargetPath("/\\\\evil.example")).toBe("/evil.example");
  });

  it("źródło z odwrotnym ukośnikiem NIE staje się regułą dla strony głównej", () => {
    // KONSEKWENCJA, przed którą chroni ten test: wiersz importu CSV
    // `/\stary-wpis,/nowy` (ukośniki odwrotne trafiają do eksportów z Windows
    // i z WP) normalizował się do źródła "/", bo `new URL()` czytał "/\x" jak
    // "//x" (host "x", ścieżka "/") ZANIM zadziałał `cleanPathname`. Import
    // cicho zakładał przekierowanie STRONY GŁÓWNEJ na "/nowy" - cały ruch
    // z wejścia na domenę uciekał na jedną podstronę, a operator widział
    // w panelu regułę, której nie napisał. Źródło przechodzi teraz przez to
    // samo zwijanie co cel, PRZED parserem URL.
    expect(normalizeSourcePath("/\\stary-wpis")).toBe("/stary-wpis");
    expect(normalizeSourcePath("\\stary-wpis\\")).toBe("/stary-wpis");
    expect(normalizeSourcePath("/kat\\stary-wpis")).toBe("/kat/stary-wpis");
  });

  it("udawany host za odwrotnym ukośnikiem zostaje ŚCIEŻKĄ tego serwisu", () => {
    // Ta sama semantyka co dla celu: `\\evil.example\a` to ścieżka
    // "/evil.example/a", a nie host - nic nie znika i nic nie przechodzi
    // w regułę dla "/".
    expect(normalizeSourcePath("\\\\evil.example\\a")).toBe("/evil.example/a");
    expect(normalizeSourcePath("/\\evil.example")).toBe("/evil.example");
    expect(normalizeSourcePath("/\\evil.example/stary-wpis")).toBe("/evil.example/stary-wpis");
    expect(normalizeSourcePath("/\\\\evil")).toBe("/evil");
  });

  it.each(["\\", "/\\", "\\\\", " \\ ", "\\/\\"])(
    "odrzuca źródło %j zbudowane z samych ukośników z odwrotnym (nic użytecznego nie zostaje)",
    (raw) => {
      // Uszkodzona komórka eksportu, nie świadoma reguła dla katalogu
      // głównego - ta jest najdroższą możliwą pomyłką, więc wymaga zapisu
      // wprost.
      expect(normalizeSourcePath(raw)).toBeNull();
    },
  );

  it("katalog główny zapisany WPROST nadal jest przyjmowany (kontrola negatywna)", () => {
    expect(normalizeSourcePath("/")).toBe("/");
    expect(normalizeSourcePath("https://old.example.com/")).toBe("/");
    expect(normalizeSourcePath("/?p=123")).toBe("/?p=123");
    // Zapytanie przy ścieżce z "\" ratuje regułę: "?p=1" jest użyteczne.
    expect(normalizeSourcePath("\\?p=1")).toBe("/?p=1");
  });

  it("odwrotny ukośnik w ZAPYTANIU zostaje dosłowny (dopasowanie query jest bajtowe)", () => {
    expect(normalizeSourcePath("/a?x=\\b")).toBe("/a?x=\\b");
    expect(normalizeSourcePath("\\a?x=\\b")).toBe("/a?x=\\b");
    // Fragment po "#" i tak odpada, więc jego "\" nie zmienia ścieżki.
    expect(normalizeSourcePath("/a#x\\y")).toBe("/a");
  });

  it("pełny URL z odwrotnymi ukośnikami w ścieżce daje ścieżkę tego URL-a", () => {
    expect(normalizeSourcePath("https://old.example.com\\a\\b")).toBe("/a/b");
  });

  it("odrzuca źródło dłuższe niż limit kolumny (2048 znaków)", () => {
    expect(normalizeSourcePath(`/${"a".repeat(2100)}`)).toBeNull();
    expect(normalizeSourcePath(`/${"a".repeat(2047)}`)).toHaveLength(2048);
  });

  it("obcina cel do limitu kolumny, zamiast go odrzucać", () => {
    // Cel jest tylko ścieżką - obcięcie daje adres, który co najwyżej nie
    // istnieje (404), a nie wiersz, którego nie da się zapisać.
    expect(normalizeTargetPath(`/${"b".repeat(3000)}`)).toHaveLength(2048);
  });

  it.each([
    { label: "URL bez hosta", raw: "https://" },
    { label: "URL z niedomkniętym nawiasem IPv6", raw: "https://[" },
    { label: "URL z hostem-nawiasem", raw: "https://[::1" },
  ])("zwraca null, gdy parser URL rzuca wyjątkiem ($label)", ({ raw }) => {
    expect(normalizeSourcePath(raw)).toBeNull();
    expect(normalizeTargetPath(raw, ["nes.example"])).toBeNull();
  });
});

describe("matchRedirect - gałęzie brzegowe reguł", () => {
  it('przenosi resztę ścieżki na cel-katalog główny ("/*")', () => {
    const index = buildRedirectIndex([rule({ source_path: "/old/*", target_path: "/*" })]);
    expect(matchRedirect(index, "/old/a/b")?.target).toBe("/a/b");
    // Bez reszty ścieżki celem jest sam katalog główny, a nie "//".
    expect(matchRedirect(index, "/old")?.target).toBe("/");
    expect(matchRedirect(index, "/old/")?.target).toBe("/");
  });

  it("zatrzymuje łańcuch na celu absolutnym i nie wchodzi w niego jak w ścieżkę", () => {
    const index = buildRedirectIndex([
      rule({ source_path: "/chain", target_path: "/ext" }),
      rule({ source_path: "/ext", target_path: "https://nes.example/new" }),
      // Ta reguła NIE MOŻE się wykonać: "/new" jest ścieżką w absolutnym URL-u,
      // a nie kolejnym hopem na tym serwisie.
      rule({ source_path: "/new", target_path: "/nigdy" }),
    ]);
    const hit = matchRedirect(index, "/chain");
    expect(hit?.target).toBe("https://nes.example/new");
    expect(hit?.rule.source_path).toBe("/ext");
    // Reguła WEJŚCIOWA zostaje zapamiętana obok końcowej - to na nią idzie
    // licznik trafień w panelu.
    expect(hit?.entryRule.source_path).toBe("/chain");
    // Zapytanie dolepia się także do celu absolutnego (nie ma w nim "?").
    expect(matchRedirect(index, "/chain", "?utm=nl")?.target).toBe(
      "https://nes.example/new?utm=nl",
    );
  });

  it.each([200, 303, 404, 0])(
    "kod statusu %i (spoza dozwolonego zbioru) degraduje do 301",
    (status_code) => {
      const index = buildRedirectIndex([
        rule({ source_path: "/dziwny", target_path: "/cel", status_code }),
      ]);
      const hit = matchRedirect(index, "/dziwny");
      // Bez tego `Response` dostałby status, którego przeglądarka nie traktuje
      // jak przekierowania - czytelnik zobaczyłby pustą stronę zamiast treści.
      expect(hit?.statusCode).toBe(301);
      expect(hit?.gone).toBe(false);
      expect(hit?.target).toBe("/cel");
      // Surowa wartość z bazy zostaje widoczna w regule (panel pokazuje prawdę).
      expect(hit?.rule.status_code).toBe(status_code);
    },
  );

  it("nie wchodzi w łańcuch, gdy kolejny hop jest regułą wieloznaczną", () => {
    const index = buildRedirectIndex([
      rule({ source_path: "/a1", target_path: "/b1" }),
      rule({ source_path: "/b1", target_path: "/c1/*" }),
    ]);
    // Cel z "/*" jest wzorcem, nie adresem - doklejenie go dałoby Location z
    // gwiazdką w ścieżce.
    expect(matchRedirect(index, "/a1")?.target).toBe("/b1");
  });
});

describe("matchRedirect - reguła wejściowa (entryRule) dla licznika trafień", () => {
  const index = buildRedirectIndex([
    rule({ source_path: "/a", target_path: "/b" }),
    rule({ source_path: "/b", target_path: "/c", status_code: 302 }),
    rule({ source_path: "/sam", target_path: "/cel" }),
    rule({ source_path: "/stara-sekcja/*", target_path: "/nowa/*" }),
    rule({ source_path: "/usuniete", target_path: "/", status_code: 410 }),
    rule({ source_path: "/do-usunietego", target_path: "/usuniete" }),
  ]);

  it("bez łańcucha reguła wejściowa i końcowa to ta sama reguła", () => {
    const hit = matchRedirect(index, "/sam");
    expect(hit?.entryRule).toBe(hit?.rule);
    expect(hit?.entryRule.id).toBe("/sam");
  });

  it("w łańcuchu wejściowa to dopasowana, końcowa wyznacza cel i kod", () => {
    const hit = matchRedirect(index, "/a");
    expect(hit?.entryRule.id).toBe("/a");
    expect(hit?.rule.id).toBe("/b");
    expect(hit?.target).toBe("/c");
    expect(hit?.statusCode).toBe(302);
  });

  it("łańcuch kończący się na 410 zapamiętuje regułę wejściową", () => {
    const hit = matchRedirect(index, "/do-usunietego");
    expect(hit?.gone).toBe(true);
    expect(hit?.entryRule.id).toBe("/do-usunietego");
    expect(hit?.rule.id).toBe("/usuniete");
  });

  it("wildcard i prefiks języka niosą regułę wejściową dalej", () => {
    expect(matchRedirect(index, "/stara-sekcja/x")?.entryRule.id).toBe("/stara-sekcja/*");
    const lang = matchRedirectForPath(index, "/en/a");
    expect(lang?.target).toBe("/en/c");
    expect(lang?.entryRule.id).toBe("/a");
  });
});

describe("matchRedirectForPath - brak języka i pętla po ponownym prefiksowaniu", () => {
  const index = buildRedirectIndex([
    rule({ source_path: "/foo", target_path: "/en/foo" }),
    rule({ source_path: "/stary", target_path: "/nowy" }),
  ]);

  it("nie próbuje fallbacku kanonicznego, gdy ścieżka nie ma prefiksu języka", () => {
    // Ścieżka bez prefiksu JEST już kanoniczna - druga próba dopasowania byłaby
    // tą samą próbą, więc funkcja kończy się od razu.
    expect(matchRedirectForPath(index, "/nie-ma-takiej")).toBeNull();
    expect(matchRedirectForPath(index, "/nie-ma-takiej", "?utm=x")).toBeNull();
  });

  it("odrzuca regułę, która po ponownym prefiksowaniu wraca na siebie", () => {
    // Reguła napisana z JAWNYM celem "/en/foo": dla żądania "/en/foo" ścieżka
    // kanoniczna "/foo" dopasowuje się, a `addLangPrefix` nie dokleja drugiego
    // "/en" (nigdy nie prefiksuje dwa razy), więc cel == źródło. Jeden hop
    // wystarczyłby przeglądarce do nieskończonej pętli.
    expect(matchRedirectForPath(index, "/en/foo")).toBeNull();
    // Kontrola: reguła z celem BEZ prefiksu działa normalnie.
    expect(matchRedirectForPath(index, "/en/stary")?.target).toBe("/en/nowy");
  });
});

describe("parseRedirectsCsv - wiersze niepełne i wadliwe", () => {
  const result = parseRedirectsCsv(
    [
      "/tylko-zrodlo", // brak kolumny celu
      "/a,/b,999", // kod poza dozwolonym zbiorem
      "/c,/d,abc", // kod nieliczbowy
      "/e,/f", // brak kolumny statusu -> domyślne 301
      "/same,/same,301", // cel identyczny ze źródłem
      "", // pusty wiersz
      "   ", // wiersz z samych spacji
      "/g,/h,410", // 410 bez kolumny noty
      "/i,https://evil.example/x,301", // cel absolutny bez allowlisty
    ].join("\n"),
  );

  it.each([
    { line: 1, reason: "invalid_target", why: "brak kolumny celu" },
    { line: 2, reason: "invalid_status", why: "kod 999" },
    { line: 3, reason: "invalid_status", why: 'kod "abc"' },
    { line: 5, reason: "self_redirect", why: "cel == źródło" },
    { line: 9, reason: "invalid_target", why: "cel absolutny bez allowlisty" },
  ])("raportuje wiersz $line jako $reason ($why)", ({ line, reason }) => {
    expect(result.issues).toContainEqual({ line, reason });
  });

  it("numeruje problemy numerem WIERSZA W PLIKU, a nie indeksem wiersza danych", () => {
    // Operator poprawia plik w arkuszu - numer musi wskazywać ten sam wiersz,
    // który widzi na ekranie, także po pustych liniach.
    expect(result.issues.map((i) => i.line)).toEqual([1, 2, 3, 5, 9]);
  });

  it("puste wiersze i wiersze z samych spacji są pomijane bez zgłoszenia", () => {
    expect(result.issues.some((i) => i.line === 6 || i.line === 7)).toBe(false);
  });

  it("przyjmuje 301, gdy kolumny statusu w ogóle nie ma", () => {
    expect(result.rows).toContainEqual({
      source_path: "/e",
      target_path: "/f",
      status_code: 301,
      note: null,
    });
  });

  it("410 bez celu i bez noty dostaje cel zastępczy, a nie null", () => {
    // 410 Gone nie potrzebuje celu, ale kolumna `target_path` w bazie jest
    // NOT NULL - stąd "/" jako wartość zastępcza.
    expect(result.rows).toContainEqual({
      source_path: "/g",
      target_path: "/h",
      status_code: 410,
      note: null,
    });
    const gone = parseRedirectsCsv("/tylko-gone,,410");
    expect(gone.issues).toEqual([]);
    expect(gone.rows).toEqual([
      { source_path: "/tylko-gone", target_path: "/", status_code: 410, note: null },
    ]);
  });

  it("z pliku pełnego wadliwych wierszy nie powstaje ANI JEDEN wiersz-śmieć", () => {
    expect(result.rows.map((r) => r.source_path)).toEqual(["/e", "/g"]);
  });

  it("wiersz ze źródłem z odwrotnym ukośnikiem dostaje SWOJĄ ścieżkę, nie stronę główną", () => {
    const out = parseRedirectsCsv(["/\\stary-wpis,/nowy,301", "\\kat\\wpis,/inny"].join("\n"));
    expect(out.issues).toEqual([]);
    expect(out.rows.map((r) => r.source_path)).toEqual(["/stary-wpis", "/kat/wpis"]);
    // Żaden wiersz nie zakłada przekierowania katalogu głównego.
    expect(out.rows.some((r) => r.source_path === "/")).toBe(false);
  });

  it("wiersz ze źródłem z samych ukośników odwrotnych jest odrzucany jako invalid_source", () => {
    const out = parseRedirectsCsv(["\\,/nowy,301", "/\\,/nowy,301", "/ok,/nowy,301"].join("\n"));
    expect(out.issues).toEqual([
      { line: 1, reason: "invalid_source" },
      { line: 2, reason: "invalid_source" },
    ]);
    expect(out.rows.map((r) => r.source_path)).toEqual(["/ok"]);
  });

  it("przyjmuje cel absolutny, gdy host jest na allowliście", () => {
    const ok = parseRedirectsCsv("/i,https://nes.example/x,301", ["nes.example"]);
    expect(ok.issues).toEqual([]);
    expect(ok.rows[0]?.target_path).toBe("https://nes.example/x");
  });

  it.each([
    { label: "source", header: "source,target,status,note" },
    { label: "source_path", header: "source_path,target_path,status_code,note" },
    { label: "from", header: "From,To,Status,Note" },
    { label: "old", header: "old url,new url,,," },
  ])("pomija wiersz nagłówka rozpoznany po kolumnie $label", ({ header }) => {
    const out = parseRedirectsCsv([header, "/x,/y,301"].join("\n"));
    expect(out.issues).toEqual([]);
    expect(out.rows).toHaveLength(1);
  });

  it("nagłówek rozpoznaje TYLKO w pierwszym wierszu", () => {
    // Drugie wystąpienie to już dane - i jako dane musi zostać odrzucone,
    // inaczej scalony eksport cicho gubiłby wiersze.
    const out = parseRedirectsCsv(["/x,/y,301", "source,target,status,note"].join("\n"));
    expect(out.rows).toHaveLength(1);
    // Źródło "source" normalizuje się do "/source" (poprawna ścieżka), więc
    // wiersz wykłada się dopiero na kolumnie statusu ("status" to nie liczba).
    expect(out.issues).toEqual([{ line: 2, reason: "invalid_status" }]);
  });
});

describe("serializeRedirectsCsv - wiersze bez noty", () => {
  it.each([
    { label: "pominiętym polem noty", note: undefined },
    { label: "notą null", note: null },
  ])("zapisuje puste pole noty dla wiersza z $label", ({ note }) => {
    // Pusta nota MUSI zostać pustą kolumną - inaczej plik ma mniej kolumn niż
    // nagłówek i ponowny import przesuwa wszystkie pola o jedną w lewo.
    expect(
      serializeRedirectsCsv([{ source_path: "/a", target_path: "/b", status_code: 301, note }]),
    ).toBe("source,target,status,note\n/a,/b,301,\n");
  });

  it("pusta lista wierszy daje plik z samym nagłówkiem", () => {
    expect(serializeRedirectsCsv([])).toBe("source,target,status,note\n");
  });
});
