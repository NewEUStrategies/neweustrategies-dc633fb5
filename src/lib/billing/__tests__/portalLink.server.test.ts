// Jednorazowy link do portalu operatora płatności - 0 z 4 funkcji pokrytych
// do 18.08.2026.
//
// Portal to JEDYNE miejsce, w którym kupujący zmienia metodę płatności, pobiera
// faktury i anuluje subskrypcję u operatora. Adresy są jednorazowe, więc nie da
// się ich zapisać - powstają na żądanie i idą MAILEM na adres właściciela
// subskrypcji. Administrator nigdy nie widzi samego linku.
//
// Cztery rzeczy pilnowane najmocniej:
//
//   1. ŚRODOWISKO. Link powstaje dla subskrypcji z TEGO środowiska, o które
//      pytamy. Wysłanie klientowi produkcyjnemu linku do piaskownicy oznacza
//      portal bez jego danych.
//   2. NIGDY NIE RZUCA. Obie funkcje zwracają wynik z kodem odmowy - panel
//      i profil pokazują komunikat, a nie białą stronę.
//   3. IDEMPOTENCJA WYSYŁKI. Klucz niesie ziarno: przypadkowy dubel kliknięcia
//      nie wysyła dwóch maili, a świadome powtórzenie po zgłoszeniu - tak,
//      bo link z poprzedniego maila jest już zwykle zużyty.
//   4. KOLEJNOŚĆ. Adresata sprawdzamy PRZED utworzeniem sesji portalu: link
//      wygenerowany dla konta bez maila zostałby zużyty na nic.
//
// ŻADNE żądanie nie wychodzi do Stripe ani do dostawcy poczty - oba klienty
// wyłącznie przez atrapy.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    /** Wiersz `subscriptions` zwracany przez atrapę, per środowisko. */
    subscription: { current: null as Record<string, unknown> | null },
    /** Wiersz `profiles` - adresat maila. */
    profile: { current: null as Record<string, unknown> | null },
    /** Filtry, z jakimi pytano o subskrypcję. */
    subFilters: [] as Array<[string, unknown]>,
    portalThrows: { current: false },
    portalPayloads: [] as Array<Record<string, unknown>>,
    sendResult: { current: { ok: true } as { ok: boolean } },
    /** Dostawca poczty RZUCA (timeout, 5xx) zamiast oddać `{ ok: false }`. */
    sendThrows: { current: false },
    sentEmails: [] as Array<Record<string, unknown>>,
  };

  const supabaseAdmin = {
    from: (table: string) => {
      const link: Record<string, unknown> = {};
      for (const method of ["select", "order", "limit", "ilike"]) link[method] = () => link;
      link.eq = (column: string, value: unknown) => {
        if (table === "subscriptions") state.subFilters.push([column, value]);
        return link;
      };
      link.maybeSingle = () =>
        Promise.resolve({
          data: table === "subscriptions" ? state.subscription.current : state.profile.current,
          error: null,
        });
      link.then = (onFulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled);
      return link;
    },
  };

  const stripe = {
    billingPortal: {
      sessions: {
        create: (payload: Record<string, unknown>) => {
          if (state.portalThrows.current) return Promise.reject(new Error("stripe padł"));
          state.portalPayloads.push(payload);
          return Promise.resolve({ url: "https://portal.example.test/sesja-jednorazowa" });
        },
      },
    },
  };

  return { ...state, supabaseAdmin, stripe };
});

// Atrapy na GRANICY SDK, nie na naszych wrapperach: `portalLink.server` wciąga
// oba klienty dynamicznie (`await import`), a podmiana wrappera nie dochodzi do
// takiego importu. Przy okazji test przechodzi przez PRAWDZIWY
// `createStripeClient`, więc pilnuje też wymagania kluczy środowiskowych.
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

const { createPortalLinkForUser, sendPortalLinkEmail } =
  await import("@/lib/billing/portalLink.server");

const USER = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  // Wartości SYNTETYCZNE - prawdziwe klienty i tak są atrapami.
  vi.stubEnv("SUPABASE_URL", "https://projekt-testowy.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-syntetyczny");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "sk_test_syntetyczny");
  vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_syntetyczny");
  vi.stubEnv("PUBLIC_SITE_URL", "https://serwis.example.test");
  // Transport klienta operatora idzie przez bramkę konektorów platformy -
  // `createStripeClient` wymaga tego klucza, więc test przechodzi przez
  // PRAWDZIWY wrapper razem z tą kontrolą.
  vi.stubEnv("LOVABLE_API_KEY", "platforma-syntetyczna");
  h.subscription.current = { provider_customer_id: "cus_test", provider_subscription_id: "sub_1" };
  h.profile.current = {
    email: "klient@example.test",
    first_name: "Jan",
    prefs: { language: "pl" },
  };
  h.subFilters.length = 0;
  h.portalThrows.current = false;
  h.portalPayloads.length = 0;
  h.sendResult.current = { ok: true };
  h.sendThrows.current = false;
  h.sentEmails.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createPortalLinkForUser - sesja portalu klienta", () => {
  it("pyta o subskrypcję TEGO użytkownika i TEGO środowiska", async () => {
    // Link do piaskownicy wysłany klientowi produkcyjnemu otwiera portal bez
    // jego danych - filtr środowiska jest tu regułą, nie ozdobą.
    await createPortalLinkForUser(USER, "live");

    expect(h.subFilters).toEqual([
      ["user_id", USER],
      ["environment", "live"],
    ]);
  });

  it("tworzy sesję dla identyfikatora klienta z subskrypcji", async () => {
    const result = await createPortalLinkForUser(USER, "sandbox");

    expect(result).toEqual({
      ok: true,
      urls: {
        overviewUrl: "https://portal.example.test/sesja-jednorazowa",
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    });
    expect(h.portalPayloads[0]).toMatchObject({ customer: "cus_test" });
  });

  it("adres powrotu prowadzi na PROFIL tego serwisu, nie na przykładową domenę", async () => {
    await createPortalLinkForUser(USER, "sandbox");

    expect(h.portalPayloads[0].return_url).toBe("https://serwis.example.test/profil");
  });

  it("BRAK zmiennej z adresem serwisu nie blokuje linku - jest wartość zapasowa", async () => {
    vi.stubEnv("PUBLIC_SITE_URL", "");

    const result = await createPortalLinkForUser(USER, "sandbox");

    expect(result.ok).toBe(true);
    expect(String(h.portalPayloads[0].return_url)).toContain("/profil");
  });

  it("użytkownik BEZ subskrypcji dostaje kod `no_customer`, a nie wyjątek", async () => {
    h.subscription.current = null;

    expect(await createPortalLinkForUser(USER, "sandbox")).toEqual({
      ok: false,
      error: "no_customer",
    });
  });

  it("subskrypcja BEZ identyfikatora klienta u operatora to też `no_customer`", async () => {
    h.subscription.current = { provider_customer_id: null, provider_subscription_id: "sub_1" };

    expect(await createPortalLinkForUser(USER, "sandbox")).toEqual({
      ok: false,
      error: "no_customer",
    });
    expect(h.portalPayloads).toHaveLength(0);
  });

  it("ODMOWA operatora daje `portal_failed` - funkcja NIGDY nie rzuca", async () => {
    h.portalThrows.current = true;

    const result = await createPortalLinkForUser(USER, "sandbox");

    expect(result).toEqual({ ok: false, error: "portal_failed" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("sendPortalLinkEmail - mail z linkiem", () => {
  it("wysyła na adres WŁAŚCICIELA subskrypcji, w jego języku", async () => {
    const result = await sendPortalLinkEmail({
      userId: USER,
      environment: "sandbox",
      idempotencySeed: "1",
    });

    expect(result).toEqual({ ok: true, email: "klient@example.test" });
    expect(h.sentEmails[0]).toMatchObject({
      type: "customer_portal_link",
      to: "klient@example.test",
      lang: "pl",
      ctaUrl: "https://portal.example.test/sesja-jednorazowa",
    });
  });

  it("klucz idempotencji niesie użytkownika I ziarno", async () => {
    await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "admin:7" });

    expect(h.sentEmails[0].idempotencyKey).toBe(`customer_portal_link:${USER}:admin:7`);
  });

  it("RÓŻNE ziarna dają różne klucze - świadome powtórzenie przechodzi", async () => {
    // Link z poprzedniego maila jest zwykle zużyty; obsługa zgłoszeń musi móc
    // wysłać nowy.
    await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "a" });
    await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "b" });

    expect(h.sentEmails[0].idempotencyKey).not.toBe(h.sentEmails[1].idempotencyKey);
  });

  it("konto BEZ adresu e-mail daje `no_recipient` i NIE zużywa linku", async () => {
    // Adresata sprawdzamy PRZED utworzeniem sesji - jednorazowy link
    // wygenerowany dla konta bez maila przepadłby bez śladu.
    h.profile.current = { email: "", prefs: {} };

    const result = await sendPortalLinkEmail({
      userId: USER,
      environment: "sandbox",
      idempotencySeed: "1",
    });

    expect(result).toEqual({ ok: false, error: "no_recipient" });
    expect(h.portalPayloads).toHaveLength(0);
    expect(h.sentEmails).toHaveLength(0);
  });

  it("brak subskrypcji przechodzi kodem `no_customer` z warstwy niżej", async () => {
    h.subscription.current = null;

    expect(
      await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "1" }),
    ).toEqual({ ok: false, error: "no_customer" });
    expect(h.sentEmails).toHaveLength(0);
  });

  it("odmowa operatora przechodzi kodem `portal_failed`", async () => {
    h.portalThrows.current = true;

    expect(
      await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "1" }),
    ).toEqual({ ok: false, error: "portal_failed" });
    expect(h.sentEmails).toHaveLength(0);
  });

  it("NIEUDANA wysyłka maila daje `send_failed`, a nie ciche „ok”", async () => {
    // Operator obsługi zgłoszeń musi wiedzieć, że klient linku NIE DOSTAŁ.
    h.sendResult.current = { ok: false };

    expect(
      await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "1" }),
    ).toEqual({ ok: false, error: "send_failed" });
  });

  it("wyjątek w środku schodzi na `send_failed` - funkcja NIGDY nie rzuca", async () => {
    h.profile.current = null;
    h.subscription.current = null;

    const result = await sendPortalLinkEmail({
      userId: USER,
      environment: "sandbox",
      idempotencySeed: "1",
    });

    expect(result.ok).toBe(false);
    expect(["no_recipient", "send_failed"]).toContain((result as { error: string }).error);
  });

  it("język adresata schodzi z jego preferencji, nie z domyślnego", async () => {
    h.profile.current = { email: "client@example.test", prefs: { language: "en" } };

    await sendPortalLinkEmail({ userId: USER, environment: "sandbox", idempotencySeed: "1" });

    expect(h.sentEmails[0].lang).toBe("en");
  });
});

describe("brzegi, na których portal MUSI zadziałać albo odmówić spokojnie", () => {
  it("brak zapisanego identyfikatora subskrypcji NIE blokuje linku", async () => {
    // Wiersz `subscriptions` powstaje przy checkoucie, a `provider_subscription_id`
    // dopisuje dopiero webhook. Klient, który trafi na profil w tym oknie, ma
    // dostać portal - to jedyne miejsce, gdzie poprawi kartę po odrzuconej
    // płatności. Odmowa byłaby tu najgorsza z możliwych.
    h.subscription.current = { provider_customer_id: "cus_bez_subskrypcji" };

    const result = await createPortalLinkForUser(USER, "sandbox");

    expect(result.ok).toBe(true);
    expect(h.portalPayloads[0]).toMatchObject({ customer: "cus_bez_subskrypcji" });
  });

  it("WYJĄTEK dostawcy poczty nie wychodzi na zewnątrz - odmowa `send_failed`", async () => {
    // Kontrakt modułu brzmi „nigdy nie rzuca". Wyjątek z dostawcy poczty
    // przebiłby się przez panel administratora jako biała strona, a link do
    // portalu i tak byłby już zużyty.
    h.sendThrows.current = true;

    const result = await sendPortalLinkEmail({
      userId: USER,
      environment: "sandbox",
      idempotencySeed: "ziarno-1",
    });

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(console.error).toHaveBeenCalled();
  });
});
