import { test, expect, type Page, type Route } from "@playwright/test";

// E2E ŚCIEŻKI PIENIĘDZY ZAPISU NA WYDARZENIE (`/events/<slug>/register`).
//
// PŁASZCZYZNA DANYCH JEST ZAŚLEPIONA NA POZIOMIE SIECI, NIE MOCKA MODUŁU -
// dokładnie jak w `scanner.spec.ts`. Formularz rozmawia z bazą przez dwa RPC
// (`event_registration_form`, `event_register`), a kasę woła przez serwerową
// funkcję pod `/_serverFn/*`. W CI nie ma ani bazy, ani operatora płatności,
// więc przechwytujemy dokładnie te adresy: test przechodzi przez PRAWDZIWĄ
// trasę, prawdziwy SSR, prawdziwy formularz i prawdziwą molekułę kasy, a udaje
// wyłącznie to, czego w CI nie ma. ŻADEN request nie wychodzi do sieci -
// zaślepka Stripe'a jest częścią tej reguły, nie wyjątkiem od niej.
//
// TRZY RZECZY, KTÓRYCH NIE UDOWODNI ŻADEN TEST JEDNOSTKOWY:
// 1. Gość, który wybrał wejściówkę PŁATNĄ, dostaje POWÓD i odnośnik do
//    logowania, a przycisk zapisu jest martwy - w prawdziwej trasie, z
//    prawdziwym SSR. Przed migracją `20260830090000` przechodził dalej i
//    dostawał zgłoszenie, którego NIKT nie mógł opłacić.
// 2. Zalogowany przechodzi zapis do końca i widzi na ekranie potwierdzenia
//    KWOTĘ oraz przycisk do kasy. Do tej pory ekran mówił „nie masz jeszcze
//    wejściówki" i na tym kończył.
// 3. Kliknięcie kasy niesie `registration_id` - klucz, po którym webhook
//    dowiązuje wpłatę do WŁAŚCIWEGO zgłoszenia.

const SLUG = "e2e-kongres-platny";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const REGISTRATION_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

function ticket(priceCents: number) {
  return {
    id: TICKET_ID,
    key: "standard",
    name_pl: "Standard",
    name_en: "Standard",
    description_pl: "",
    description_en: "",
    price_cents: priceCents,
    effective_price_cents: priceCents,
    phase: null,
    benefits_pl: [],
    benefits_en: [],
    currency: "PLN",
    requires_approval: false,
    min_tier_rank: 0,
    sales_from: null,
    sales_to: null,
    seats_left: 10,
    availability: "on_sale",
    tier_locked: false,
    requires_access_code: false,
    access_code_hint: "",
  };
}

function form(priceCents: number) {
  return {
    event: {
      id: EVENT_ID,
      slug: SLUG,
      title_pl: "Kongres testowy",
      title_en: "Test congress",
      starts_at: null,
      ends_at: null,
      timezone: "Europe/Warsaw",
      registration_mode: "form",
      registration_flow: "instant",
      external_registration_url: null,
      capacity: null,
      seats_left: null,
      rsvp_opens_at: null,
    },
    is_open: true,
    closed_reason: null,
    fields: [],
    consents: [],
    tickets: [ticket(priceCents)],
    terms: [],
  };
}

const REGISTERED_UNPAID = {
  registration_id: REGISTRATION_ID,
  event_id: EVENT_ID,
  person_id: "77777777-7777-4777-8777-777777777777",
  status: "pending",
  decision_source: null,
  waitlist_position: null,
  ticket_type_id: TICKET_ID,
  group_id: null,
  qr_token: null,
  manage_token: "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj",
  payment_status: "unpaid",
  payment_required: true,
  amount_cents: 15000,
  currency: "PLN",
};

interface Calls {
  register: Array<Record<string, unknown>>;
  /** Każde wywołanie serwerowej funkcji - adres i ładunek, bez zgadywania. */
  serverFn: Array<{ url: string; body: string }>;
}

/** Zaślepia płaszczyznę danych zapisu i kasę; zwraca ślad wywołań. */
async function stubRegistrationPlane(page: Page, priceCents: number): Promise<Calls> {
  const calls: Calls = { register: [], serverFn: [] };

  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  // KOLEJNOŚĆ MA ZNACZENIE. Playwright sprawdza przechwytywacze w ODWROTNEJ
  // kolejności rejestracji - ostatni wygrywa. Ogólne wzorce muszą więc stać
  // PIERWSZE, a szczegółowe na końcu; odwrotnie catch-all zjada oba RPC zapisu
  // i ekran zostaje pusty (sprawdzone, nie założone).
  await page.route("**/auth/v1/**", (route) => json(route, {}));
  await page.route("**/rest/v1/**", (route) => json(route, []));
  // Każde inne RPC (kontekst ról, ustawienia) odpowiada pustką - bez tego
  // pojedyncze zapytanie do nieistniejącej bazy zawiesza ekran na szkielecie.
  await page.route("**/rest/v1/rpc/**", (route) => json(route, null));

  await page.route("**/rest/v1/rpc/event_registration_form*", (route) =>
    json(route, form(priceCents)),
  );

  await page.route("**/rest/v1/rpc/event_register*", async (route) => {
    const raw = route.request().postDataJSON() as { p_payload?: Record<string, unknown> } | null;
    calls.register.push(raw?.p_payload ?? {});
    await json(route, REGISTERED_UNPAID);
  });

  // Serwerowa funkcja kasy. NIE dotykamy operatora płatności: oddajemy tryb
  // mock, czyli tę samą odpowiedź, którą daje środowisko bez dostawcy.
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    calls.serverFn.push({ url: request.url(), body: request.postData() ?? "" });
    await json(route, {
      result: { ok: true, mode: "mock", url: "/checkout/success", orderId: "o-1" },
    });
  });

  return calls;
}

/**
 * Sesja bez prawdziwej bazy - JEDYNY sposób na „zalogowanego" w tym środowisku.
 *
 * KLUCZ SESJI ZALEŻY OD PROJEKTU, KTÓREGO TEN TEST NIE ZNA. supabase-js trzyma
 * ją pod `sb-<ref>-auth-token`, gdzie `<ref>` pochodzi z adresu projektu -
 * a ten jest inny lokalnie, inny w CI z zaślepką i inny w CI z sekretem.
 * Wpisanie klucza na sztywno działało lokalnie i CICHO NIE DZIAŁAŁO w CI:
 * odczyt trafiał w pustkę, ekran pokazywał gościowi wymóg konta, a test padał
 * na braku przycisku kasy (sprawdzone na przebiegu CI, nie założone).
 *
 * Dlatego przechwytujemy ODCZYT, a nie zapis: każdy klucz o kształcie
 * `sb-<cokolwiek>-auth-token` oddaje tę samą sesję, niezależnie od projektu.
 * Zapis zostaje natywny - nic w teście go nie potrzebuje.
 */
async function signIn(page: Page): Promise<void> {
  await page.addInitScript(
    ({ userId }: { userId: string }) => {
      const session = JSON.stringify({
        access_token: "e2e-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "e2e-refresh-token",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "uczestnik@example.org",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        },
      });
      const nativeGetItem = window.Storage.prototype.getItem;
      window.Storage.prototype.getItem = function patched(key: string): string | null {
        if (/^sb-.+-auth-token$/.test(key)) return session;
        return nativeGetItem.call(this, key);
      };
    },
    { userId: USER_ID },
  );
}

async function fillPerson(page: Page): Promise<void> {
  await page.getByLabel(/Imię/).fill("Anna");
  await page.getByLabel(/Nazwisko/).fill("Kowalska");
  await page.getByLabel(/e-mail/i).fill("anna@example.org");
}

// Serwer deweloperski kompiluje trasę przy PIERWSZYM wejściu (a `predev`
// czyści cache Vite przed każdym przebiegiem), więc pierwsze wejście w tym
// pliku bywa wielokrotnie wolniejsze od kolejnych. Limit jest podniesiony dla
// całego pliku, zamiast zgadywać, który przypadek trafi na zimny start.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test("gość na PŁATNEJ wejściówce dostaje powód, a nie martwy przycisk", async ({ page }) => {
  test.setTimeout(120_000);
  const calls = await stubRegistrationPlane(page, 15000);
  await page.goto(`/events/${SLUG}/register`);

  // Zdanie mówi POWÓD (paragon i droga zwrotu należą do konta), a nie samo
  // „zaloguj się" - i stoi PRZY WYBORZE BILETU, zanim człowiek wypełni resztę.
  await expect(page.getByText(/wymaga konta/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('a[href*="/login"]').first()).toBeVisible();

  const submit = page.getByRole("button", { name: /Zapisz/i });
  await expect(submit).toBeDisabled();
  expect(calls.register, "żaden zapis nie poszedł do bazy").toHaveLength(0);
});

test("gość na wejściówce BEZPŁATNEJ przechodzi bez żadnej przeszkody", async ({ page }) => {
  test.setTimeout(120_000);
  await stubRegistrationPlane(page, 0);
  await page.goto(`/events/${SLUG}/register`);

  await expect(page.getByRole("button", { name: /Zapisz/i })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText(/wymaga konta/i)).toHaveCount(0);
});

test("zalogowany kończy zapis i dostaje KWOTĘ oraz drogę do kasy", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const calls = await stubRegistrationPlane(page, 15000);
  await page.goto(`/events/${SLUG}/register`);

  await expect(page.getByLabel(/Imię/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/wymaga konta/i)).toHaveCount(0);
  await fillPerson(page);
  await page.getByRole("checkbox").first().click();
  await page.getByRole("button", { name: /Zapisz/i }).click();

  // Zapis DOSZEDŁ do bazy z wybraną wejściówką.
  await expect.poll(() => calls.register.length).toBeGreaterThan(0);
  expect(calls.register[0]?.["ticket_type_id"]).toBe(TICKET_ID);

  // Ekran potwierdzenia MÓWI KWOTĘ, nie obiecuje wejściówki i DAJE przycisk.
  // Do migracji `20260830090000` kończył się na zdaniu „nie masz jeszcze
  // wejściówki" - bez przycisku, bez odnośnika, bez niczego.
  await expect(page.getByText(/150,00/).first()).toBeVisible();
  await expect(page.getByText(/nie został jeszcze wygenerowany/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Zapłać$/ })).toBeVisible();
});

test("kasa bez skonfigurowanej bramki mówi to wprost, zamiast milczeć", async ({ page }) => {
  // CO TEN PRZYPADEK NAPRAWDĘ MIERZY. W tym środowisku (i w CI) NIE MA tokenu
  // bramki płatności - `getStripeEnvironment()` rzuca `payments_not_configured`
  // jeszcze przed wywołaniem serwerowej funkcji. To jest realny stan produkcji
  // przy błędnej konfiguracji i musi kończyć się ZDANIEM dla człowieka, a nie
  // martwym kliknięciem ani białym ekranem.
  //
  // ŁADUNEK ŻĄDANIA (`registration_id`, `event_id`, `ticket_type_id`) jest
  // dowodzony w vitest - `RegistrationConfirmation.test.tsx`,
  // `ParticipantTicketsPanel.test.tsx` i `checkoutRegistrationBinding.test.ts` -
  // bo tam bramkę da się skonfigurować deterministycznie. Tutaj sprawdzamy to,
  // czego tamte testy nie widzą: że prawdziwa trasa nie wywraca się na braku
  // konfiguracji.
  test.setTimeout(120_000);
  await signIn(page);
  const calls = await stubRegistrationPlane(page, 15000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`/events/${SLUG}/register`);

  await expect(page.getByLabel(/Imię/)).toBeVisible({ timeout: 60_000 });
  await fillPerson(page);
  await page.getByRole("checkbox").first().click();
  await page.getByRole("button", { name: /Zapisz/i }).click();

  const pay = page.getByRole("button", { name: /^Zapłać$/ });
  await expect(pay).toBeVisible();
  await pay.click();

  await expect(page.getByText(/Płatności są chwilowo niedostępne/i)).toBeVisible();
  // Żadne żądanie do operatora ani do serwerowej funkcji kasy nie poszło.
  expect(
    calls.serverFn.filter((call) => call.body.includes("ticket_type_id")),
    "brak konfiguracji zatrzymuje żądanie PRZED serwerem",
  ).toHaveLength(0);
  expect(errors, `błędy strony: ${errors.join("; ")}`).toHaveLength(0);
});
