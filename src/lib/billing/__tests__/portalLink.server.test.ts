// Portal operatora płatności - wejście mailem i sesja na żądanie.
//
// Portal to JEDYNE miejsce, w którym kupujący zmienia metodę płatności, pobiera
// faktury i anuluje subskrypcję u operatora. Sesje portalu są jednorazowe
// i krótkotrwałe, więc mail niesie STAŁY adres aplikacji, a sesja powstaje
// dopiero, gdy właściciel ten adres otworzy. Administrator nigdy nie widzi
// samego linku.
//
// Pięć rzeczy pilnowanych najmocniej:
//
//   1. GRANICA NAJEMCY (SUB-08). Moduł pracuje kluczem serwisowym, więc jedyną
//      granicą jest `tenantId` z sesji wołającego: konto i subskrypcja spoza
//      najemcy dostają TEN SAM kod co konto bez subskrypcji - bez maila, bez
//      sesji portalu i bez adresu e-mail w odpowiedzi.
//   2. LINK Z MAILA DZIAŁA PO GODZINIE (SUB-19). W mailu jest adres aplikacji
//      na hoście najemcy (`/profile/portal`), a NIE adres sesji operatora -
//      przy wysyłce sesja portalu w ogóle nie powstaje.
//   3. POWRÓT Z PORTALU NA ISTNIEJĄCĄ TRASĘ (SUB-19). `return_url` idzie przez
//      bramkę `absoluteReturnUrl` na `/profile/plan` - nigdy `/profil`
//      (404) ani `example.com`.
//   4. ŚRODOWISKO. Link powstaje dla subskrypcji z TEGO środowiska, o które
//      pytamy - i to środowisko jedzie w adresie wejścia.
//   5. NIGDY NIE RZUCA. Obie funkcje zwracają wynik z kodem odmowy.
//
// ŻADNE żądanie nie wychodzi do Stripe ani do dostawcy poczty - oba klienty
// wyłącznie przez atrapy.
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROFILE_PLAN_PATH, PROFILE_PORTAL_PATH } from "@/lib/profile/routes";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

const h = vi.hoisted(() => {
  const state = {
    /** Wiersz `subscriptions` zwracany przez atrapę (gdy najemca się zgadza). */
    subscription: { current: null as Record<string, unknown> | null },
    /** Najemca, do którego NALEŻY subskrypcja w atrapie bazy. */
    subscriptionTenant: { current: "tenant-a" },
    /** Wiersz `profiles` - adresat maila. */
    profile: { current: null as Record<string, unknown> | null },
    /** Najemca profilu docelowego w atrapie bazy (`null` = brak konta). */
    profileTenant: { current: "tenant-a" as string | null },
    /** Błąd PostgREST odczytu `subscriptions` (chwilowa awaria bazy). */
    subscriptionError: { current: null as { message: string } | null },
    /** Błąd PostgREST kontroli przynależności (`profiles` z najemcą). */
    memberError: { current: null as { message: string } | null },
    /** Filtry zapytań, per tabela. */
    filters: [] as Array<[string, string, unknown]>,
    portalThrows: { current: false },
    portalPayloads: [] as Array<Record<string, unknown>>,
    sendResult: { current: { ok: true } as { ok: boolean } },
    /** Dostawca poczty RZUCA (timeout, 5xx) zamiast oddać `{ ok: false }`. */
    sendThrows: { current: false },
    sentEmails: [] as Array<Record<string, unknown>>,
    /** Nagłówki bieżącego żądania (host, origin) - dla bramki adresu powrotu. */
    requestHeaders: { current: null as Headers | null },
  };

  const supabaseAdmin = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const eqs = new Map<string, unknown>();
      for (const method of ["select", "order", "limit", "ilike"]) chain[method] = () => chain;
      chain.eq = (column: string, value: unknown) => {
        eqs.set(column, value);
        state.filters.push([table, column, value]);
        return chain;
      };
      chain.maybeSingle = () => {
        if (table === "subscriptions") {
          if (state.subscriptionError.current) {
            return Promise.resolve({ data: null, error: state.subscriptionError.current });
          }
          const owned = eqs.get("tenant_id") === state.subscriptionTenant.current;
          return Promise.resolve({ data: owned ? state.subscription.current : null, error: null });
        }
        if (table === "profiles" && eqs.has("tenant_id")) {
          if (state.memberError.current) {
            return Promise.resolve({ data: null, error: state.memberError.current });
          }
          // Kontrola przynależności: wiersz istnieje WYŁĄCZNIE w swoim najemcy.
          const member =
            state.profileTenant.current !== null &&
            eqs.get("tenant_id") === state.profileTenant.current;
          return Promise.resolve({ data: member ? { id: eqs.get("id") } : null, error: null });
        }
        if (table === "profiles") {
          return Promise.resolve({ data: state.profile.current, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      chain.then = (onFulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled);
      return chain;
    },
  };

  const stripe = {
    billingPortal: {
      sessions: {
        create: (payload: Record<string, unknown>) => {
          if (state.portalThrows.current) return Promise.reject(new Error("stripe padł"));
          state.portalPayloads.push(payload);
          return Promise.resolve({ url: "https://billing.stripe.test/p/session/jednorazowa" });
        },
      },
    },
  };

  return { ...state, supabaseAdmin, stripe };
});

// Atrapy na GRANICY SDK, nie na naszych wrapperach: `portalLink.server` wciąga
// oba klienty dynamicznie (`await import`), a podmiana wrappera nie dochodzi do
// takiego importu. Przy okazji test przechodzi przez PRAWDZIWY
// `getStripeClient`, więc pilnuje też wymagania kluczy środowiskowych.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => h.supabaseAdmin }));
vi.mock("stripe", () => {
  class StripeStub {
    constructor() {
      return h.stripe as unknown as StripeStub;
    }
    static createFetchHttpClient() {
      return {};
    }
  }
  return { default: StripeStub };
});
vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (payload: Record<string, unknown>) => {
    h.sentEmails.push(payload);
    if (h.sendThrows.current) return Promise.reject(new Error("dostawca poczty nie odpowiada"));
    return Promise.resolve(h.sendResult.current);
  },
}));
// Kontekst żądania frameworka - jedyne źródło hosta dla bramki adresu powrotu.
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!h.requestHeaders.current) throw new Error("poza żądaniem");
    return { headers: h.requestHeaders.current };
  },
}));
// Katalog najemców (`tenants.domain`) - granica, z której PRAWDZIWY
// `tenantPublicUrl` składa host linku w mailu.
vi.mock("@/lib/server/tenant.server", () => {
  const entries = [
    { id: "tenant-a", slug: "a", domain: "klub-a.example.test", isDefault: false },
    { id: "tenant-b", slug: "b", domain: "serwis-b.example.test", isDefault: true },
  ];
  return {
    getTenantDirectory: () =>
      Promise.resolve({
        byDomain: new Map(entries.map((entry) => [entry.domain, entry])),
        defaultTenant: entries[1],
      }),
  };
});

const { createPortalLinkForUser, portalEntryPath, sendPortalLinkEmail } =
  await import("@/lib/billing/portalLink.server");

const USER = "11111111-2222-3333-4444-555555555555";

function emailInput(over: Partial<Parameters<typeof sendPortalLinkEmail>[0]> = {}) {
  return {
    userId: USER,
    environment: "sandbox" as const,
    tenantId: TENANT_A,
    idempotencySeed: "1",
    ...over,
  };
}

beforeEach(() => {
  // Wartości SYNTETYCZNE - prawdziwe klienty i tak są atrapami.
  vi.stubEnv("SUPABASE_URL", "https://projekt-testowy.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-syntetyczny");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "sk_test_syntetyczny");
  vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_syntetyczny");
  vi.stubEnv("PUBLIC_SITE_URL", "https://serwis.example.test");
  vi.stubEnv("BILLING_RETURN_HOSTS", "klub-a.example.test");
  // Transport klienta operatora idzie przez bramkę konektorów platformy -
  // `getStripeClient` wymaga tego klucza, więc test przechodzi przez
  // PRAWDZIWY wrapper razem z tą kontrolą.
  vi.stubEnv("LOVABLE_API_KEY", "platforma-syntetyczna");
  h.subscription.current = { provider_customer_id: "cus_test", provider_subscription_id: "sub_1" };
  h.subscriptionTenant.current = TENANT_A;
  h.profile.current = {
    email: "klient@example.test",
    first_name: "Jan",
    prefs: { language: "pl" },
  };
  h.profileTenant.current = TENANT_A;
  h.subscriptionError.current = null;
  h.memberError.current = null;
  h.filters.length = 0;
  h.portalThrows.current = false;
  h.portalPayloads.length = 0;
  h.sendResult.current = { ok: true };
  h.sendThrows.current = false;
  h.sentEmails.length = 0;
  h.requestHeaders.current = new Headers({ origin: "https://klub-a.example.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Filtry zapytania o subskrypcję (kolumna -> wartość). */
function subscriptionFilters(): Array<[string, unknown]> {
  return h.filters.filter(([table]) => table === "subscriptions").map(([, c, v]) => [c, v]);
}

describe("createPortalLinkForUser - sesja portalu na żądanie", () => {
  it("pyta o subskrypcję TEGO użytkownika, TEGO środowiska i TEGO najemcy", async () => {
    // Link do piaskownicy wysłany klientowi produkcyjnemu otwiera portal bez
    // jego danych, a subskrypcja obcego najemcy to cudzy klient operatora.
    await createPortalLinkForUser(USER, "live", { tenantId: TENANT_A });

    expect(subscriptionFilters()).toEqual([
      ["user_id", USER],
      ["environment", "live"],
      ["tenant_id", TENANT_A],
    ]);
  });

  it("tworzy sesję dla identyfikatora klienta z subskrypcji", async () => {
    const result = await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(result).toEqual({
      ok: true,
      urls: {
        overviewUrl: "https://billing.stripe.test/p/session/jednorazowa",
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    });
    expect(h.portalPayloads[0]).toMatchObject({ customer: "cus_test" });
  });

  it("powrót z portalu: ISTNIEJĄCA trasa `/profile/plan` na hoście najemcy z żądania", async () => {
    // DEFEKT SUB-19: było `${PUBLIC_SITE_URL}/profil` - trasy `/profil` nie ma
    // (jest `/profile`), więc wyjście z portalu kończyło się 404.
    await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(h.portalPayloads[0].return_url).toBe(`https://klub-a.example.test${PROFILE_PLAN_PATH}`);
    // Trasa docelowa istnieje w drzewie tras i nie jest przekierowaniem.
    expect(existsSync("src/routes/profile.plan.tsx")).toBe(true);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain(`'${PROFILE_PLAN_PATH}': {`);
  });

  it("host spoza serwisu w nagłówku NIE trafia do adresu powrotu", async () => {
    // Bramka `absoluteReturnUrl`: podrobiony `origin` schodzi na origin
    // kanoniczny wdrożenia, a nie na obcą domenę.
    h.requestHeaders.current = new Headers({ origin: "https://atakujacy.example.org" });

    await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(h.portalPayloads[0].return_url).toBe(`https://serwis.example.test${PROFILE_PLAN_PATH}`);
  });

  it("BRAK zmiennej z adresem serwisu nie prowadzi na `example.com`", async () => {
    // Do 12.10.2026 wartość zapasowa brzmiała `https://example.com/profil` -
    // cudza domena. Teraz zapasem jest origin kanoniczny serwisu.
    vi.stubEnv("PUBLIC_SITE_URL", "");
    h.requestHeaders.current = null;

    const result = await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(result.ok).toBe(true);
    const returnUrl = String(h.portalPayloads[0].return_url);
    expect(returnUrl).not.toContain("example.com");
    expect(new URL(returnUrl).pathname).toBe(PROFILE_PLAN_PATH);
  });

  it("konto z INNEGO najemcy dostaje `no_customer` - bez sesji portalu", async () => {
    h.profileTenant.current = TENANT_B;

    expect(await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A })).toEqual({
      ok: false,
      error: "no_customer",
    });
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("subskrypcja należąca do INNEGO najemcy też jest `no_customer`", async () => {
    // Profil w najemcy A, ale klient operatora zapisany w najemcy B - jedno
    // konto operatora obsługuje wielu najemców, więc sam profil nie wystarcza.
    h.subscriptionTenant.current = TENANT_B;

    expect(await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A })).toEqual({
      ok: false,
      error: "no_customer",
    });
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("pusty najemca to odmowa, nie zapytanie bez zakresu", async () => {
    expect(await createPortalLinkForUser(USER, "sandbox", { tenantId: "" })).toEqual({
      ok: false,
      error: "no_customer",
    });
    expect(h.filters).toHaveLength(0);
  });

  it("użytkownik BEZ subskrypcji dostaje kod `no_customer`, a nie wyjątek", async () => {
    h.subscription.current = null;

    expect(await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A })).toEqual({
      ok: false,
      error: "no_customer",
    });
  });

  it("subskrypcja BEZ identyfikatora klienta u operatora to też `no_customer`", async () => {
    h.subscription.current = { provider_customer_id: null, provider_subscription_id: "sub_1" };

    expect(await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A })).toEqual({
      ok: false,
      error: "no_customer",
    });
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("ODMOWA operatora daje `portal_failed` - funkcja NIGDY nie rzuca", async () => {
    h.portalThrows.current = true;

    const result = await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(result).toEqual({ ok: false, error: "portal_failed" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("sendPortalLinkEmail - mail ze STAŁYM wejściem do portalu (SUB-19)", () => {
  it("link w mailu to adres APLIKACJI na hoście najemcy, nie sesja operatora", async () => {
    // Kryterium SUB-19: link działa po godzinie. Adres sesji operatora wygasa
    // po kilku minutach; adres aplikacji nie wygasa nigdy - sesja powstaje
    // dopiero po jego otwarciu.
    const result = await sendPortalLinkEmail(emailInput({ environment: "live" }));

    expect(result).toEqual({ ok: true, email: "klient@example.test" });
    const cta = new URL(String(h.sentEmails[0].ctaUrl));
    expect(cta.origin).toBe("https://klub-a.example.test");
    expect(cta.pathname).toBe(PROFILE_PORTAL_PATH);
    expect(cta.searchParams.get("environment")).toBe("live");
    expect(String(h.sentEmails[0].ctaUrl)).not.toContain("stripe");
  });

  it("przy wysyłce sesja portalu w ogóle NIE powstaje", async () => {
    // Jednorazowej sesji nie ma czego „zużyć" przed kliknięciem - mail może
    // leżeć w skrzynce dowolnie długo.
    await sendPortalLinkEmail(emailInput());

    expect(h.portalPayloads).toHaveLength(0);
  });

  it("adres wejścia prowadzi do ISTNIEJĄCEJ trasy aplikacji", () => {
    expect(portalEntryPath("sandbox")).toBe(`${PROFILE_PORTAL_PATH}?environment=sandbox`);
    expect(existsSync("src/routes/profile_.portal.tsx")).toBe(true);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain(
      `fullPath: '${PROFILE_PORTAL_PATH}'`,
    );
  });

  it("host linku wynika z najemcy WOŁAJĄCEGO, nie z najemcy domyślnego", async () => {
    h.profileTenant.current = TENANT_B;
    h.subscriptionTenant.current = TENANT_B;

    await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }));

    expect(new URL(String(h.sentEmails[0].ctaUrl)).origin).toBe("https://serwis-b.example.test");
    // Najemca jedzie też do wysyłki (lista wykluczeń, redakcja treści).
    expect(h.sentEmails[0].tenantId).toBe(TENANT_B);
  });

  it("wysyła na adres WŁAŚCICIELA subskrypcji, w jego języku", async () => {
    await sendPortalLinkEmail(emailInput());

    expect(h.sentEmails[0]).toMatchObject({
      type: "customer_portal_link",
      to: "klient@example.test",
      lang: "pl",
    });
  });

  it("klucz idempotencji niesie użytkownika I ziarno", async () => {
    await sendPortalLinkEmail(emailInput({ idempotencySeed: "admin:7" }));

    expect(h.sentEmails[0].idempotencyKey).toBe(`customer_portal_link:${USER}:admin:7`);
  });

  it("RÓŻNE ziarna dają różne klucze - świadome powtórzenie przechodzi", async () => {
    await sendPortalLinkEmail(emailInput({ idempotencySeed: "a" }));
    await sendPortalLinkEmail(emailInput({ idempotencySeed: "b" }));

    expect(h.sentEmails[0].idempotencyKey).not.toBe(h.sentEmails[1].idempotencyKey);
  });

  it("konto BEZ adresu e-mail daje `no_recipient` i NIE wysyła maila", async () => {
    h.profile.current = { email: "", prefs: {} };

    const result = await sendPortalLinkEmail(emailInput());

    expect(result).toEqual({ ok: false, error: "no_recipient" });
    expect(h.sentEmails).toHaveLength(0);
  });

  it("brak subskrypcji daje `no_customer`", async () => {
    h.subscription.current = null;

    expect(await sendPortalLinkEmail(emailInput())).toEqual({ ok: false, error: "no_customer" });
    expect(h.sentEmails).toHaveLength(0);
  });

  it("NIEUDANA wysyłka maila daje `send_failed`, a nie ciche „ok”", async () => {
    // Operator obsługi zgłoszeń musi wiedzieć, że klient linku NIE DOSTAŁ.
    h.sendResult.current = { ok: false };

    expect(await sendPortalLinkEmail(emailInput())).toEqual({ ok: false, error: "send_failed" });
  });

  it("język adresata schodzi z jego preferencji, nie z domyślnego", async () => {
    h.profile.current = { email: "client@example.test", prefs: { language: "en" } };

    await sendPortalLinkEmail(emailInput());

    expect(h.sentEmails[0].lang).toBe("en");
    // Ścieżki `/profile` nie mają prefiksu języka - link EN to ten sam adres.
    expect(new URL(String(h.sentEmails[0].ctaUrl)).pathname).toBe(PROFILE_PORTAL_PATH);
  });

  it("WYJĄTEK dostawcy poczty nie wychodzi na zewnątrz - odmowa `send_failed`", async () => {
    h.sendThrows.current = true;

    const result = await sendPortalLinkEmail(emailInput({ idempotencySeed: "ziarno-1" }));

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("sendPortalLinkEmail - odmowa ponad granicą najemcy (SUB-08)", () => {
  it("konto INNEGO najemcy: brak maila, brak adresu w odpowiedzi, kod `no_customer`", async () => {
    // Scenariusz z audytu: edytor najemcy B wysyłał linki kontom najemcy A
    // i w odpowiedzi dostawał ich adresy e-mail.
    h.profileTenant.current = TENANT_A;

    const result = await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }));

    expect(result).toEqual({ ok: false, error: "no_customer" });
    expect(JSON.stringify(result)).not.toContain("klient@example.test");
    expect(h.sentEmails).toHaveLength(0);
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("odmowa jest NIEODRÓŻNIALNA od konta, którego nie ma, i od konta bez subskrypcji", async () => {
    // Trzy różne przyczyny, jedna odpowiedź - inaczej funkcja byłaby
    // wyrocznią istnienia kont w obcym najemcy.
    h.profileTenant.current = TENANT_A;
    const obce = await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }));

    h.profileTenant.current = null;
    const nieistniejace = await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }));

    h.profileTenant.current = TENANT_B;
    h.subscriptionTenant.current = TENANT_A;
    const bezSubskrypcji = await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }));

    expect(obce).toEqual(nieistniejace);
    expect(nieistniejace).toEqual(bezSubskrypcji);
  });

  it("obce konto BEZ adresu też dostaje `no_customer`, nie `no_recipient`", async () => {
    // Kolejność kontroli jest wiążąca: najpierw granica najemcy, dopiero
    // potem adresat - inaczej „brak adresu" zdradzałby istnienie konta.
    h.profileTenant.current = TENANT_A;
    h.profile.current = { email: "", prefs: {} };

    expect(await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }))).toEqual({
      ok: false,
      error: "no_customer",
    });
  });

  it("zapytanie o subskrypcję niesie najemcę wołającego, nie najemcę z bazy", async () => {
    await sendPortalLinkEmail(emailInput({ tenantId: TENANT_A }));

    expect(subscriptionFilters()).toContainEqual(["tenant_id", TENANT_A]);
    expect(h.filters).toContainEqual(["profiles", "tenant_id", TENANT_A]);
  });
});

describe("awaria odczytu bazy to AWARIA, nie „nie masz konta u operatora”", () => {
  // Kod `no_customer` niesie klientowi konkretną treść („nie masz jeszcze
  // konta u operatora”), a administratorowi - „to konto nie ma subskrypcji”.
  // Chwilowy błąd odczytu `subscriptions` kończył się dawniej tym samym kodem:
  // płacący klient czytał, że konta nie ma, i nie próbował ponownie, a
  // obsługa zamykała zgłoszenie jako „klient bez subskrypcji”. Awaria idzie
  // teraz ścieżką awarii (`portal_failed` / `send_failed`), jak błąd
  // kontroli przynależności obok.
  it("sesja portalu: błąd odczytu subskrypcji daje `portal_failed`, bez sesji", async () => {
    h.subscriptionError.current = { message: "canceling statement due to statement timeout" };

    const result = await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(result).toEqual({ ok: false, error: "portal_failed" });
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("mail z portalem: błąd odczytu subskrypcji daje `send_failed`, bez maila", async () => {
    h.subscriptionError.current = { message: "canceling statement due to statement timeout" };

    const result = await sendPortalLinkEmail(emailInput());

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(h.sentEmails).toHaveLength(0);
  });

  it("błąd kontroli przynależności też jest awarią, a odczyt subskrypcji nie startuje", async () => {
    h.memberError.current = { message: "connection reset" };

    const result = await createPortalLinkForUser(USER, "sandbox", { tenantId: TENANT_A });

    expect(result).toEqual({ ok: false, error: "portal_failed" });
    expect(subscriptionFilters()).toEqual([]);
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("obce konto przy awarii odczytu subskrypcji dalej dostaje `no_customer` - granica najemcy pierwsza", async () => {
    // Odczyt subskrypcji nie startuje dla konta spoza najemcy, więc jego
    // awaria nie może zdradzić, że konto istnieje gdzie indziej.
    h.profileTenant.current = TENANT_A;
    h.subscriptionError.current = { message: "canceling statement due to statement timeout" };

    expect(await sendPortalLinkEmail(emailInput({ tenantId: TENANT_B }))).toEqual({
      ok: false,
      error: "no_customer",
    });
  });
});
