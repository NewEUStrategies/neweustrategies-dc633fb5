import { test, expect } from "@playwright/test";

// SEO surface smoke: pilnuje, ze publiczne powierzchnie GEO/SEO nadal odpowiadaja
// i ze /admin/seo jest zamontowany za guardem auth. Backend-agnostyczne - CI
// uzywa danych zastepczych, wiec sprawdzamy status kodu i podstawowa strukture,
// nie konkretnych rekordow.

test.describe("SEO surfaces", () => {
  test("sitemap.xml is a sitemapindex pointing at shard files", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status(), "sitemap status").toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("xml");
    const body = await res.text();
    expect(body).toContain("<?xml");
    // /sitemap.xml jest INDEKSEM (limit 50 000 adresow na plik), a nie jednym
    // wielkim <urlset> - adresy mieszkaja w shardach /sitemaps/<sekcja>.xml.
    expect(body).toContain("<sitemapindex");
    expect(body).toContain("</sitemapindex>");
    expect(body).toMatch(/<loc>[^<]*\/sitemaps\/core\.xml<\/loc>/);
    // Rewalidacja: cache musi pozwolic edge/CDN odswiezyc bez rucznej akcji.
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc, "sitemap cache-control").toMatch(/max-age=0|no-cache|must-revalidate/);
  });

  test("every sitemap listed in the index resolves to a urlset", async ({ request }) => {
    const index = await (await request.get("/sitemap.xml")).text();
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length, "index nie moze byc pusty").toBeGreaterThan(0);
    for (const loc of locs) {
      const path = new URL(loc, "http://localhost").pathname;
      const res = await request.get(path);
      expect(res.status(), `${path} status`).toBe(200);
      const body = await res.text();
      // news-sitemap ma wlasny format (news:), pozostale shardy to <urlset>.
      expect(body, `${path} zawartosc`).toMatch(/<urlset/);
    }
  });

  test("an unknown sitemap shard is a 404, not an empty urlset", async ({ request }) => {
    // Pusty plik w Search Console wyglada jak blad publikacji; 404 czysci wpis.
    expect((await request.get("/sitemaps/nie-ma-takiej-sekcji.xml")).status()).toBe(404);
    // Shard pierwszy mieszka pod "core.xml" - "-1" byloby duplikatem adresu.
    expect((await request.get("/sitemaps/core-1.xml")).status()).toBe(404);
  });

  test("sitemap-index.xml redirects to the canonical index", async ({ request }) => {
    const res = await request.get("/sitemap-index.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"] ?? "").toContain("/sitemap.xml");
  });

  test("llms.txt is text/plain and lists sections", async ({ request }) => {
    const res = await request.get("/llms.txt");
    // 404 jest akceptowalny, gdy admin wyłączyl llms w ustawieniach SEO.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      expect(res.headers()["content-type"] ?? "").toContain("text/plain");
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("rss.xml returns a well-formed feed", async ({ request }) => {
    const res = await request.get("/rss.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<?xml");
    expect(body).toMatch(/<rss|<feed/);
  });

  test("robots.txt comes from the ROUTE, not a static file in public/", async ({ request }) => {
    // FINDING 2026-08-06: `public/robots.txt` byl kopiowany do `.output/public/`,
    // a asset warstwy hostingu wygrywa z workerem - cala trasa (klasyfikacja
    // hosta, zakaz dla aliasow, polityka crawlerow AI, news sitemap) byla na
    // produkcji NIEOSIAGALNA, a plik statyczny zapraszal do indeksowania kazdy
    // host. Statyczny asset nigdy nie wystawia `X-Robots-Tag`, wiec ten naglowek
    // jest dowodem pochodzenia odpowiedzi - niezaleznym od hosta, na ktorym
    // jedzie suita (w CI to host podgladowy, wiec tresc jest celowo zamknieta).
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const tag = res.headers()["x-robots-tag"] ?? "";
    expect(tag, "brak X-Robots-Tag = odpowiada plik statyczny, nie trasa").toMatch(
      /^(all|noindex, nofollow)$/,
    );
    // Naglowek i tresc musza mowic to samo - inaczej crawler dostaje sprzeczna
    // polityke (indeksuj / nie indeksuj) i wybiera restrykcyjniejsza.
    const body = await res.text();
    if (tag === "all") {
      expect(body).toContain("Allow: /");
      expect(body).toContain("Disallow: /admin/");
      expect(body).toContain("Sitemap: http");
    } else {
      expect(body).toContain("Disallow: /");
      expect(body).not.toContain("Sitemap:");
    }
  });

  test("robots.txt exposes crawl policy", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("user-agent");
    // Na hoscie kanonicznym KAZDA zadeklarowana sitemapa musi byc osiagalna -
    // robots kierujacy crawlera na 404 to gotowy blad w Search Console.
    // (Na hostach podgladowych robots celowo nie deklaruje zadnej sitemapy.)
    for (const line of body.split("\n").filter((l) => l.startsWith("Sitemap:"))) {
      const url = line.slice("Sitemap:".length).trim();
      expect(url, "Sitemap musi byc adresem absolutnym").toMatch(/^https?:\/\//);
    }
  });

  // REGRESJA WDROZENIOWA (audyt 2026-08-06): `public/robots.txt` trafial do
  // `.output/public/`, ktore wrangler wiaze jako `assets`, a warstwa assetow
  // odpowiada PRZED workerem - dynamiczna trasa byla na produkcji nieosiagalna
  // i KAZDY host dostawal statyczne `Allow: /` z jedna sitemapa. Ten test
  // sprawdza dwie rzeczy, ktorych plik statyczny miec nie moze: naglowek
  // `X-Robots-Tag` (warstwa assetow go nie dokłada) i polityke ZALEZNA od hosta.
  // Suite jedzie po hoscie podgladowym (127.0.0.1), wiec kontraktem jest tu
  // pelny zakaz - dokladne przeciwienstwo tresci starego statycznego pliku.
  test("robots.txt is served by the route, not by a static asset", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    // Naglowek = dowod, ze odpowiedziala trasa.
    expect(res.headers()["x-robots-tag"] ?? "", "X-Robots-Tag").toContain("noindex");

    const body = await res.text();
    // Host podgladowy: pelny zakaz i ZERO deklaracji sitemap. Gdyby wrocil
    // statyczny plik (`Allow: /` + `Sitemap:`), obie asercje padna.
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Allow: /");
    expect(body).not.toContain("Sitemap:");

    // Sfalszowany `X-Forwarded-Host` wskazujacy niezarejestrowana domene NIE
    // MOZE otworzyc indeksowania - host jest walidowany wzgledem tenants.domain
    // (pickTrustedHost), a powierzchnie crawlera sa fail-closed.
    const spoofed = await request.get("/robots.txt", {
      headers: { "x-forwarded-host": "squatter.invalid" },
    });
    expect(spoofed.headers()["x-robots-tag"] ?? "").toContain("noindex");
    expect(await spoofed.text()).toContain("Disallow: /");
  });

  test("content feeds respond for the tracker and live coverage", async ({ request }) => {
    // Dwa kanaly dopisane w audycie - 404 jest akceptowalny tylko gdy redakcja
    // wylaczyla RSS w ustawieniach SEO (wtedy /rss.xml tez zwraca 404).
    const site = await request.get("/rss.xml");
    for (const path of ["/tracker/rss.xml", "/live/rss.xml"]) {
      const res = await request.get(path);
      if (site.status() === 404) {
        expect(res.status(), `${path} przy wylaczonym RSS`).toBe(404);
        continue;
      }
      expect(res.status(), `${path} status`).toBe(200);
      const body = await res.text();
      expect(body).toContain("<?xml");
      expect(body).toContain("<rss");
    }
  });

  test("podcast feed is auto-discoverable from the podcast pages", async ({ page }) => {
    await page.goto("/podcasts");
    // Autodiscovery to jedyny sposob, w jaki czytnik RSS / Apple Podcasts znajduje
    // kanal bez znajomosci naszej konwencji URL.
    const feed = page.locator('link[rel="alternate"][type="application/rss+xml"]');
    expect(await feed.count()).toBeGreaterThan(0);
    const hrefs = await feed.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(hrefs.some((h) => h.includes("/podcast/rss.xml"))).toBe(true);
  });

  test("HTML sitemap /sitemap renders navigable page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/sitemap");
    // Nagłówek H1 mapy strony jest widoczny (PL "Mapa strony" lub EN "Site map").
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Kluczowe sekcje mapy strony.
    const sectionHeadings = page.locator("h2");
    await expect(sectionHeadings.first()).toBeVisible();
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  // Regresyjny kontrakt <head>: og:image / og:title / viewport / lang muszą byc
  // obecne na kazdej publicznej powierzchni - to te same findingi, ktore wracaly.
  for (const path of ["/", "/en", "/blog", "/qa"]) {
    test(`head contract on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), "status").toBeLessThan(400);
      const lang = await page.locator("html").getAttribute("lang");
      expect(lang, "html[lang]").toMatch(/^(pl|en)$/);
      const viewport = await page.locator('meta[name="viewport"]').first().getAttribute("content");
      expect(viewport ?? "", "viewport").toContain("width=device-width");
      const ogTitle = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute("content");
      expect((ogTitle ?? "").length, "og:title").toBeGreaterThan(3);
      const ogImage = await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute("content");
      expect(ogImage ?? "", "og:image absolute").toMatch(/^https?:\/\//);
      const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");
      expect(canonical ?? "", "canonical absolute").toMatch(/^https?:\/\//);
      const title = await page.title();
      expect(title.toLowerCase()).not.toContain("lovable");
    });
  }

  test("Q&A session emits QAPage or breadcrumb JSON-LD", async ({ page }) => {
    await page.goto("/qa");
    const first = page.locator('a[href^="/qa/"]').first();
    if ((await first.count()) === 0) test.skip(true, "brak publicznych sesji Q&A w tym srodowisku");
    await first.click();
    await page.waitForLoadState("domcontentloaded");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((b) => {
      try {
        const parsed: unknown = JSON.parse(b);
        return [(parsed as { "@type"?: string })["@type"] ?? ""];
      } catch {
        return [];
      }
    });
    expect(types).toContain("BreadcrumbList");
  });

  test("/admin/seo is auth-gated (redirects to /auth or /login)", async ({ page }) => {
    await page.goto("/admin/seo");
    await page.waitForLoadState("domcontentloaded");
    // Auth gate w _authenticated/route.tsx robi redirect na /auth; niektore
    // starsze setupy uzywają /login. Akceptujemy oba - kluczowe jest, ze
    // niezalogowany uzytkownik NIE widzi surowego dashboardu.
    // Timeout 30 s, nie 5 s: suita jedzie na dev-serverze (patrz e2e.yml),
    // a pierwsze wejście w /admin/* kompiluje cały graf panelu na zimno -
    // guard klienta odpala się dopiero po dociągnięciu chunka trasy.
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/(auth|login)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SITEMAPA JAKO KONTRAKT: adresy, które publikujemy, muszą działać i należeć
// do TEGO serwisu.
//
// PO CO TO W E2E, A NIE W VITEST. Poprawności sitemapy dowodzi się BAJTAMI,
// które wyszły z SSR - nie wywołaniem funkcji, która buduje listę. Test
// jednostkowy sprawdza, co zwróciła funkcja; tu sprawdzamy, co dostał crawler
// po przejściu przez routing, nagłówki, cache brzegowy i serializację XML.
//
// SPINA SIĘ Z BRAMKĄ ZAKRESU NAJEMCY
// (`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts`): tamta
// bramka czyta KOD i wymaga filtru najemcy w każdym zapytaniu; ta asercja
// sprawdza SKUTEK - czy w wyemitowanej mapie nie ma adresu z cudzej domeny.
// Dwa niezależne dowody tej samej własności, na dwóch różnych poziomach.
//
// BACKEND-AGNOSTYCZNIE: w CI baza jedzie na poświadczeniach zastępczych, więc
// shardy treści są puste, a indeks - statyczny. Próbka poniżej sprawdza to, co
// jest; pusty shard jest poprawnym wynikiem, a nie powodem do czerwieni.
// ═══════════════════════════════════════════════════════════════════════════

/** Wszystkie `<loc>` z dokumentu XML. */
function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

test.describe("sitemapa - adresy, które publikujemy", () => {
  test("każdy adres z sitemapy jest na TYM origin - żaden nie należy do innego najemcy", async ({
    request,
    baseURL,
  }) => {
    // Service role omija RLS, więc jedyną zaporą przed wyciekiem treści między
    // najemcami do publicznej mapy jest jawny filtr w kodzie. Gdyby zapytanie
    // zgubiło `.eq("tenant_id", ...)`, adresy drugiego serwisu pojawiłyby się
    // TUTAJ - na powierzchni, którą czyta Google i cache'uje na długo po
    // naprawie.
    // HOSTNAME, nie `host`: mapa publikuje origin kanoniczny
    // (`crawlerPublishOrigin`) bez portu, a `baseURL` suity ma port lokalny.
    // Port jest artefaktem środowiska; przedmiotem kontraktu jest DOMENA.
    const own = new URL(baseURL ?? "http://127.0.0.1:4173").hostname;
    const index = await request.get("/sitemap.xml");
    expect(index.status()).toBe(200);

    const shardPaths = locsOf(await index.text()).map((loc) => new URL(loc).pathname);
    expect(shardPaths.length, "indeks sitemapy nie może być pusty").toBeGreaterThan(0);

    const obce: string[] = [];
    for (const path of shardPaths) {
      const shard = await request.get(path);
      expect(shard.status(), `${path} status`).toBe(200);
      for (const loc of locsOf(await shard.text())) {
        // Adresy MUSZĄ być absolutne (wymóg protokołu sitemap) i na naszym
        // origin - inaczej publikujemy cudzą domenę pod własną mapą.
        expect(loc, `${path}: adres musi być absolutny`).toMatch(/^https?:\/\//);
        if (new URL(loc).hostname !== own) obce.push(`${path} -> ${loc}`);
      }
    }
    expect(obce, "adresy z obcego hosta w sitemapie").toEqual([]);
  });

  test("próbka adresów z sitemapy odpowiada 200 i NIE jest przekierowaniem", async ({
    request,
  }) => {
    // Adres, który w mapie jest, a odpowiada 301, marnuje budżet crawlowania
    // i rozmywa ranking na dwa adresy tej samej treści. Adres 404 w mapie to
    // gotowy błąd w Search Console.
    // BUDŻET, NIE DOMYSŁ. W CI nie ma backendu, więc każdy render publicznej
    // strony płaci podatek 5 s na anulowanych zapytaniach SSR
    // (`[ssr-query-timeout]` w logu). Ten test padał w CI na domyślnym
    // budżecie 30 s, i to nie na konkretnym adresie: raz na `/en/live`, raz na
    // `/en/sitemap` - czyli wyczerpywał czas w środku pętli, a nie potykał się
    // o zły adres. Stąd trzy zmiany: jawny budżet, próbka mniejsza i pobrania
    // RÓWNOLEGŁE, bo one nie zależą od siebie.
    test.setTimeout(120_000);

    const index = await request.get("/sitemap.xml");
    const shardPaths = locsOf(await index.text()).map((loc) => new URL(loc).pathname);

    const szardy = await Promise.all(
      shardPaths.map(async (path) => locsOf(await (await request.get(path)).text())),
    );
    const adresy = szardy.flat();

    // Próbka, nie całość: mapa może mieć dziesiątki tysięcy wpisów, a bramka
    // ma pilnować kontraktu, nie mierzyć całego serwisu.
    const ROZMIAR_PROBKI = 8;
    const probka = adresy.slice(0, ROZMIAR_PROBKI);

    const wyniki = await Promise.all(
      probka.map(async (loc) => {
        const { pathname, search } = new URL(loc);
        const res = await request.get(`${pathname}${search}`, { maxRedirects: 0 });
        // 200 = adres kanoniczny. 3xx = mapa publikuje adres, który zaraz
        // przekieruje - powinna publikować cel.
        return { pathname, status: res.status() };
      }),
    );
    const zle = wyniki.filter((w) => w.status !== 200).map((w) => `${w.pathname} -> ${w.status}`);

    // PRÓBKA JEST NAZWANA W KOMUNIKACIE, nie ukryta: „zielono" z tego testu
    // znaczy „sprawdzono 8 z N", a nie „cała mapa jest zdrowa".
    expect(
      zle,
      `adresy z sitemapy, które nie odpowiadają 200 ` +
        `(próbka ${probka.length} z ${adresy.length} adresów w ${shardPaths.length} szardach)`,
    ).toEqual([]);
  });

  test("sitemapa nie publikuje adresów panelu ani API", async ({ request }) => {
    // Zaindeksowany `/admin/*` to publiczna mapa powierzchni administracyjnej.
    const index = await request.get("/sitemap.xml");
    const shardPaths = locsOf(await index.text()).map((loc) => new URL(loc).pathname);
    const zakazane: string[] = [];
    for (const path of shardPaths) {
      for (const loc of locsOf(await (await request.get(path)).text())) {
        const p = new URL(loc).pathname;
        if (/^\/(admin|api|login|checkout)(\/|$)/.test(p)) zakazane.push(`${path} -> ${p}`);
      }
    }
    expect(zakazane, "prywatne powierzchnie w sitemapie").toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KANONICZNY I HREFLANG: adres w HTML-u musi się zgadzać z adresem żądania.
//
// Rozjazd tutaj jest najdroższym cichym defektem SEO: kanoniczny wskazujący
// inny adres każe wyszukiwarce zignorować stronę, na której stoi, i policzyć
// ranking gdzie indziej. Nie widać go w przeglądarce i nie łapie go żaden test
// jednostkowy funkcji budującej `<head>` - bo tam adres jest ARGUMENTEM.
// ═══════════════════════════════════════════════════════════════════════════

test.describe("kanoniczny i hreflang", () => {
  // Trasy plikowe, które renderują się bez bazy (patrz `ssr-completeness`).
  //
  // PORÓWNUJEMY Z ADRESEM KOŃCOWYM, nie z żądanym. Na `/` działa negocjacja
  // języka: przeglądarka z `Accept-Language: en-US` ląduje na `/en` (zmierzone:
  // `page.goto("/")` -> `http://127.0.0.1:4173/en`, `html lang="en"`), podczas
  // gdy samo `request.get("/")` bez nagłówka języka oddaje 200 bez
  // przekierowania. Kanoniczny MA wskazywać wersję, która się wyrenderowała -
  // asercja na ścieżce ŻĄDANEJ zgłaszałaby poprawne zachowanie jako defekt.
  for (const path of ["/", "/en", "/blog", "/cookies"]) {
    test(`kanoniczny na ${path} zgadza się z adresem po negocjacji języka`, async ({
      page,
      baseURL,
    }) => {
      const res = await page.goto(path);
      expect(res?.status(), "status").toBeLessThan(400);
      const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");
      expect(canonical, `${path}: brak kanonicznego`).toBeTruthy();

      const kan = new URL(canonical ?? "", baseURL);
      const finalny = new URL(page.url());
      // Normalizacja: bez ukośnika na końcu (poza korzeniem).
      const bezUkosnika = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
      expect(bezUkosnika(kan.pathname), `${path}: ścieżka kanoniczna`).toBe(
        bezUkosnika(finalny.pathname),
      );
      // Kanoniczny NIE MOŻE nieść parametrów - inaczej każdy wariant `?utm_*`
      // staje się osobnym adresem treści i rozmywa ranking.
      expect(kan.search, `${path}: kanoniczny z parametrami`).toBe("");
      expect(kan.hash, `${path}: kanoniczny z fragmentem`).toBe("");
      expect(kan.protocol, `${path}: kanoniczny musi być absolutny`).toMatch(/^https?:$/);
      expect(kan.hostname, `${path}: kanoniczny na innym hoście`).toBe(finalny.hostname);
    });
  }

  test("kanoniczny ignoruje parametry śledzące", async ({ page, baseURL }) => {
    // `?utm_source=...` nie tworzy nowego adresu treści; kanoniczny musi
    // konsolidować ranking na wersji bez parametrów.
    await page.goto("/blog?utm_source=newsletter&utm_medium=email");
    const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");
    const kan = new URL(canonical ?? "", baseURL);
    expect(kan.search).toBe("");
    expect(kan.pathname).toBe("/blog");
  });

  test("hreflang wskazuje ISTNIEJĄCE wersje językowe", async ({ page, request }) => {
    // Hreflang celujący w 404 jest ignorowany przez wyszukiwarki, więc obie
    // wersje tracą powiązanie - a defekt nie daje żadnego objawu.
    await page.goto("/");
    const alternates = page.locator('link[rel="alternate"][hreflang]');
    const count = await alternates.count();
    expect(count, "brak hreflang na stronie głównej").toBeGreaterThan(0);

    const wpisy = await alternates.evaluateAll((els) =>
      els.map((el) => ({
        lang: el.getAttribute("hreflang") ?? "",
        href: el.getAttribute("href") ?? "",
      })),
    );
    const martwe: string[] = [];
    for (const { lang, href } of wpisy) {
      expect(lang, "hreflang musi mieć kod języka").toMatch(/^(pl|en|x-default)$/);
      expect(href, `hreflang ${lang} musi być adresem absolutnym`).toMatch(/^https?:\/\//);
      const { pathname } = new URL(href);
      const res = await request.get(pathname, { maxRedirects: 0 });
      if (res.status() !== 200) martwe.push(`${lang} -> ${pathname} (${res.status()})`);
    }
    expect(martwe, "hreflang wskazujący adres, który nie odpowiada 200").toEqual([]);

    // Wzajemność: skoro PL wskazuje EN, to EN musi wskazywać PL. Jednostronny
    // hreflang jest przez wyszukiwarki odrzucany w całości.
    const jezyki = wpisy.map((w) => w.lang);
    expect(jezyki).toContain("pl");
    expect(jezyki).toContain("en");
  });

  test("wersja EN wskazuje z powrotem na PL", async ({ page }) => {
    await page.goto("/en");
    const wpisy = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("hreflang") ?? ""));
    expect(wpisy).toContain("pl");
    expect(wpisy).toContain("en");
  });
});
