// Real user journeys over SEEDED data (supabase/seed.sql). These are the
// data-driven complement to the structural smokes in public/seo/checkout:
// article reading (incl. the raw-SSR crawler check), language switch,
// taxonomy archive, full-text search, sign-in and the crawler feeds.
//
// They require a running local Supabase with the seed applied:
//   supabase db reset            # migrations + seed.sql
//   E2E_SEEDED=1 bun run test:e2e
// Without E2E_SEEDED the whole file is skipped (CI without a DB stays green
// and honest - a skip is visible, a fake pass is not).
import { test, expect } from "@playwright/test";

const SEEDED = process.env.E2E_SEEDED === "1";

const POST = {
  path: "/blog/seed-wpis-1",
  title_pl: "Nowa architektura bezpieczeństwa Europy",
  title_en: "A new security architecture for Europe",
};

// Logowanie odporne na wyścig z hydratacją. Formularz /login jest renderowany
// serwerowo, a wysyłkę obsługuje reactowy onSubmit - klik ODDANY ZANIM React
// podepnie handler wykonuje natywny submit GET i przeglądarka ląduje z powrotem
// na "/login?" (dokładnie ten objaw miały oba testy logowania w CI: "navigated
// to http://127.0.0.1:4173/login?"). Powtarzamy więc wypełnienie i klik, aż
// nawigacja wyprowadzi poza /login. To NIE maskuje realnej awarii logowania:
// przy złych danych albo zepsutej hydratacji blok nigdy nie przechodzi i test
// pada tak samo jak wcześniej - znika wyłącznie zależność od momentu kliknięcia.
async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await expect(page.locator('button[type="submit"]').first()).toBeVisible();

  await expect(async () => {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill("nes-dev-1234");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 5_000 });
  }).toPass({ timeout: 40_000 });
}

test.describe("user paths (seeded)", () => {
  test.skip(!SEEDED, "requires seeded local Supabase (E2E_SEEDED=1 after supabase db reset)");

  test("reader finds an article from the blog list and reads it", async ({ page }) => {
    await page.goto("/blog");
    const link = page.getByText(POST.title_pl).first();
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(`**${POST.path}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(POST.title_pl);
    // Body content rendered (not a skeleton).
    await expect(page.getByText("Kontekst").first()).toBeVisible();
  });

  test("SSR delivers the full article to crawlers (no JS executed)", async ({ request }) => {
    // Raw fetch = what Googlebot's first wave and every RSS/AI crawler sees.
    const res = await request.get(POST.path);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(POST.title_pl);
    // The article body must be part of the HTML payload, not hydrated later.
    expect(html).toContain("Kontekst");
    // JSON-LD article graph is emitted server-side.
    expect(html).toContain("application/ld+json");
  });

  test("language switch serves the English variant under /en", async ({ page }) => {
    await page.goto(`/en${POST.path}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(POST.title_en);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("category archive lists the seeded posts", async ({ page }) => {
    await page.goto("/category/polityka-europejska");
    await expect(page.getByText(POST.title_pl).first()).toBeVisible();
  });

  test("full-text search finds a seeded article", async ({ page }) => {
    await page.goto("/search?q=bezpiecze%C5%84stwa");
    // Wyniki dociągane są po hydratacji (RPC wyszukiwarki), więc pod
    // obciążeniem CI domyślne 10 s bywa za krótkie - test bywał "flaky",
    // przechodząc dopiero w retry. Dłuższy budżet, ta sama asercja.
    await expect(page.getByText(POST.title_pl).first()).toBeVisible({ timeout: 30_000 });
  });

  // Ten test sprawdzal wczesniej, ze zalogowanie staffu PRZEKIEROWUJE do /admin,
  // czego produkt swiadomie nie robi: AuthPortal kieruje po logowaniu kazdego
  // uzytkownika na strone glowna i mowi to wprost w komentarzu decyzyjnym
  // (src/components/auth/AuthPortal.tsx:68). Asercja byla wiec sprzeczna z
  // zamierzonym zachowaniem i wisiala czerwona, nie chroniac niczego.
  //
  // Sens, ktory test mial chronic - "staff DOSTAJE sie do panelu" - jest tu
  // zachowany, tylko sprawdzany wprost: /admin nie odbija staffu do /login
  // (bramka `isStaff` w src/routes/admin.tsx:25 dziala w efekcie PO zaladowaniu
  // sesji, wiec odbicie przyszloby z opoznieniem - stad asercja na widoczna
  // nawigacje panelu, a nie na sam URL zaraz po wejsciu).
  test("staff sign-in lands on the home page and reaches the admin panel", async ({ page }) => {
    await signIn(page, "admin@nes.local");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

    await page.goto("/admin");
    await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toContain("/admin");
  });

  test("signed-in reader can open My Network with tabs and the people directory link", async ({
    page,
  }) => {
    await signIn(page, "reader@nes.local");

    await page.goto("/network");
    // Zakładki sieci widoczne = AuthGate przepuścił, moduł włączony.
    await expect(page.getByRole("tab", { name: /Połączenia|Connections/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("tab", { name: /Otrzymane|Received/ }).first()).toBeVisible();

    // Katalog osób linkuje z powrotem do sieci (lejek people -> network).
    await page.goto("/people");
    await expect(page.getByRole("link", { name: /Moja sieć|My network/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("crawler surfaces advertise the seeded article", async ({ request }) => {
    // /sitemap.xml jest indeksem - adres wpisu mieszka w shardzie sekcji "posts".
    const index = await (await request.get("/sitemap.xml")).text();
    expect(index).toMatch(/<loc>[^<]*\/sitemaps\/posts\.xml<\/loc>/);
    const posts = await (await request.get("/sitemaps/posts.xml")).text();
    expect(posts).toContain(POST.path);
    const rss = await (await request.get("/rss.xml")).text();
    expect(rss).toContain(POST.title_pl);
  });

  // INWARIANT SZABLONU BUILDERA: dokładnie jeden `h1` na stronę - w obie strony.
  // Trasa `$.tsx` z szablonem buildera nie była pokryta żadną bramką (audyt
  // 2026-08-06, korekta 2), więc najpierw pojechał na produkcję podwójny `h1`,
  // a potem "naprawa", która zostawiła strony buildera BEZ `h1` (i przeniosła
  // tytuł do `aria-label` na `<div>` bez roli, gdzie czytniki go nie widzą).
  // Asercje idą po SUROWYM HTML-u: liczy się to, co dostaje crawler.
  const h1sIn = (html: string): string[] =>
    [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").trim(),
    );

  test("builder page WITHOUT its own heading gets exactly one sr-only h1 from the title", async ({
    request,
  }) => {
    const res = await request.get("/seed-strona-buildera");
    expect(res.status()).toBe(200);
    const html = await res.text();
    const headings = h1sIn(html);
    expect(headings, `znaleziono ${headings.length} nagłówków h1`).toHaveLength(1);
    expect(headings[0]).toBe("Strona buildera bez nagłówka");
    // Zastępczy nagłówek jest dla czytników, nie dla layoutu.
    expect(html).toMatch(/<h1[^>]*class="[^"]*sr-only/i);
    // Nazwa strony NIE wraca do `aria-label` na kontenerze bez roli.
    expect(html).not.toContain('aria-label="Strona buildera bez nagłówka"');
  });

  test("builder page WITH its own h1 widget does not get a second one", async ({ request }) => {
    const res = await request.get("/seed-strona-buildera-naglowek");
    expect(res.status()).toBe(200);
    const html = await res.text();
    const headings = h1sIn(html);
    expect(headings, `znaleziono ${headings.length} nagłówków h1`).toHaveLength(1);
    expect(headings[0]).toContain("Własny nagłówek kanwy");
    expect(html).not.toContain("Strona buildera z nagłówkiem</h1>");
  });

  test("builder page keeps the invariant in English too", async ({ request }) => {
    const bare = await (await request.get("/en/seed-strona-buildera")).text();
    expect(h1sIn(bare)).toEqual(["Builder page without a heading"]);
    const withHeading = await (await request.get("/en/seed-strona-buildera-naglowek")).text();
    expect(h1sIn(withHeading)).toHaveLength(1);
    expect(h1sIn(withHeading)[0]).toContain("Canvas own heading");
  });

  test("legacy /post/<slug> URL redirects permanently (301) to the canonical path", async ({
    request,
  }) => {
    // 301 (not 307) so crawlers transfer link equity to the canonical URL.
    const res = await request.get("/post/seed-wpis-1", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"] ?? "").toContain(POST.path);
  });
});
