// PANEL UCZESTNIKA: KANAŁY POWIADOMIEŃ, MOJE ZGŁOSZENIA, PANELE PRELEGENTÓW.
//
// DLACZEGO TEN PLIK ISTNIEJE. `participantTicketsApi.ts` był drugą największą
// dziurą modułu 22 (4,41% linii, 11,11% funkcji, 1,12% gałęzi), i to nie dlatego,
// że nikt go nie testował - tylko dlatego, że KAŻDY testował go przez atrapę.
// Wszystkie trzy powierzchnie, które go wołają (`ParticipantTicketsPanel`,
// `MyEventsPanel`, `AccountMenuEventsSection`), podmieniają cały moduł na
// `vi.fn()`, a `myEventsGrouping.test.ts` importuje z niego wyłącznie TYP. Czyli
// parsowanie odpowiedzi bazy - jedyne miejsce, w którym pieniądze, statusy
// i zgody uczestnika zamieniają się w karty - nie wykonało się nigdy.
//
// 1) PREFERENCJE SĄ PER ZGŁOSZENIE, NIE PER KONTO. To druga strona kontraktu
//    z `registrationOutcomeNotify.server.ts:231-248`: na jedno wydarzenie
//    zapisuje się też gość bez konta, a osoba z kontem może chcieć SMS-a
//    o kongresie i ciszy o webinarze. Strona czytająca ma semantykę OPT-OUT
//    (`notify_email !== false`, więc NULL i brak wiersza znaczą „wysyłaj"),
//    więc strona zapisująca MUSI wysłać literalne `false`. Brak klucza, `null`
//    albo pominięta wartość dają przełącznik, który wygląda na wyłączony
//    i nadal przepuszcza pocztę - a to jest sterowanie zgodami na komunikację,
//    nie kosmetyka interfejsu.
//
// 2) BRAK KLUCZA ZNACZY „ZOSTAW JAK BYŁO". Baza aktualizuje przez
//    `COALESCE(v_email, r.notify_email)` i czyta obecność klucza przez
//    `p_payload ? 'notify_email'` (`20260830100000:56-84`), więc wyciszenie
//    SMS-a nie może przy okazji przesyłać stanu poczty - nadpisałoby decyzję
//    podjętą w innym urządzeniu albo innym kanale.
//
// 3) GOŚĆ BEZ KONTA MA JEDNĄ DROGĘ: `manage_token` z maila. Zalogowany jedzie
//    identyfikatorem zgłoszenia, gość kluczem - i klient nie może wysłać
//    identyfikatora, którego gość nie ma prawa znać.
//
// 4) ZAKRES NAJEMCY (zasada 12). Wszystkie trzy funkcje idą przez RPC, więc
//    zawężenie siedzi w SQL: `public_tenant_id()` plus `r.tenant_id = v_tenant`
//    i `pe.user_id = auth.uid()` (`20260830100000:45-75`,
//    `20260830090000:783-870`, `20260828065204:1-64`). Pilnuje go bramka
//    `check:sql-tenant-scope`. Klient nie ma czego dokładać - `tenant_id`
//    w ładunku byłby zignorowany, a w przeglądzie udawałby zabezpieczenie.
//
// 5) KWOTY LICZĄ SIĘ Z GROSZY. Karta dzieli `amountCents` przez 100 i porównuje
//    `refundedCents` z `amountCents`, żeby rozstrzygnąć „zwrócone" kontra
//    „częściowo zwrócone" (`ParticipantTicketsPanel.tsx:40-68`). Dlatego brak
//    zwrotu MUSI parsować się na 0, a brak zamówienia na `null` - dwie różne
//    odpowiedzi na dwa różne pytania.
//
// RODO: uczestnicy, tytuły i identyfikatory są syntetyczne; żaden fixture nie
// niesie danych osobowych ani prawdziwego tokenu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/participantTicketsApi");

const REG = "3c4d0000-0000-4000-8000-000000000111";
const REG_DRUGIE = "3c4d0000-0000-4000-8000-000000000112";
const EVENT_ID = "3c4d0000-0000-4000-8000-000000000221";
const TICKET_ID = "3c4d0000-0000-4000-8000-000000000331";
const USER_ID = "3c4d0000-0000-4000-8000-000000000441";
const PERSON_ID = "3c4d0000-0000-4000-8000-000000000551";
const SESSION_ID = "3c4d0000-0000-4000-8000-000000000661";

/**
 * Klucz z maila w kształcie produkcyjnym: 32 znaki base64url, dokładnie tak jak
 * `MANAGE_TOKEN_PATTERN`. JAWNIE syntetyczny - napis o losowym wyglądzie
 * czytałby się w przeglądzie (i w skanerze) jak wyciek poświadczenia, a to jest
 * hasło do cudzego zgłoszenia.
 */
const MANAGE_TOKEN = "manage-token-testowy-00000000000";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

/** Ładunek RPC jako luźny obiekt - `null`, gdy przyszło coś innego niż obiekt. */
function asBag(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function payloadOf(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: ${name} nie zostało wołane`);
  const sent = asBag(call.arg("p_payload"));
  if (sent === null) {
    throw new Error(`test: ${name} dostało p_payload, które nie jest obiektem`);
  }
  return sent;
}

/** Wiersz „moich zgłoszeń" w kształcie, w jakim składa go `event_my_registrations`. */
function wiersz(nadpisania: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: REG,
    event_id: EVENT_ID,
    ticket_type_id: TICKET_ID,
    status: "approved",
    payment_status: "paid",
    created_at: "2026-08-01T09:00:00.000Z",
    cancelled_at: null,
    paid_at: "2026-08-01T09:12:00.000Z",
    waitlist_position: null,
    promoted_at: null,
    notify_email: true,
    notify_sms: true,
    cancel_reason: null,
    decision_source: "auto",
    event_slug: "kongres-testowy-2026",
    event_title_pl: "Kongres testowy",
    event_title_en: "Test congress",
    event_starts_at: "2026-10-05T07:00:00.000Z",
    event_ends_at: "2026-10-06T15:00:00.000Z",
    event_timezone: "Europe/Warsaw",
    order_status: "paid",
    amount_cents: 129900,
    refunded_amount_cents: 0,
    currency: "PLN",
    webhooks: [],
    ...nadpisania,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------ kanały powiadomień --- */

describe("setRegistrationChannels", () => {
  // SEDNO CAŁEGO PRZEŁĄCZNIKA. Strona czytająca pyta `notify_email !== false`,
  // więc jedyną wartością, która realnie wycisza kanał, jest literalne `false`.
  // Gdyby klient wysłał `null` albo pominął klucz, baza zostawiłaby poprzednią
  // wartość, uczestnik zobaczyłby zapisany przełącznik „nie pisz do mnie",
  // a poczta szłaby dalej - czyli zgoda odwołana w interfejsie i nieodwołana
  // w rzeczywistości.
  it("wyciszenie poczty wysyła literalne `false`, a nie null i nie brak klucza", async () => {
    rpc().setData("event_registration_set_channels", {
      registration_id: REG,
      notify_email: false,
      notify_sms: true,
    });

    const prefs = await api.setRegistrationChannels({ registrationId: REG, notifyEmail: false });

    const sent = payloadOf("event_registration_set_channels");
    expect(sent).toEqual({ registration_id: REG, notify_email: false });
    expect(sent.notify_email).not.toBeNull();
    expect(prefs).toEqual({ registrationId: REG, notifyEmail: false, notifySms: true });
  });

  // Wyciszenie jednego kanału nie ma prawa dotknąć drugiego: baza czyta
  // OBECNOŚĆ klucza (`p_payload ? 'notify_sms'`), a brak klucza zostawia
  // wartość z bazy. Dosłanie stanu poczty „dla kompletu" nadpisałoby decyzję
  // podjętą wcześniej z innego urządzenia albo z linku w mailu.
  it("wyciszenie SMS-a nie przesyła przy okazji stanu poczty", async () => {
    rpc().setData("event_registration_set_channels", {
      registration_id: REG,
      notify_email: true,
      notify_sms: false,
    });

    await api.setRegistrationChannels({ registrationId: REG, notifySms: false });

    const sent = payloadOf("event_registration_set_channels");
    expect("notify_email" in sent).toBe(false);
    expect(sent.notify_sms).toBe(false);
  });

  // Ponowna zgoda musi być tak samo namacalna jak wyciszenie - inaczej kanał
  // raz wyłączony zostawałby wyłączony na zawsze.
  it("ponowna zgoda wysyła literalne `true`", async () => {
    rpc().setData("event_registration_set_channels", {
      registration_id: REG,
      notify_email: true,
      notify_sms: true,
    });

    const prefs = await api.setRegistrationChannels({
      registrationId: REG,
      notifyEmail: true,
      notifySms: true,
    });

    expect(payloadOf("event_registration_set_channels")).toEqual({
      registration_id: REG,
      notify_email: true,
      notify_sms: true,
    });
    expect(prefs.notifyEmail).toBe(true);
    expect(prefs.notifySms).toBe(true);
  });

  // Gość bez konta nie ma sesji ani identyfikatora zgłoszenia - ma wyłącznie
  // klucz z maila. Dołożenie `registration_id` do tej drogi byłoby wysłaniem
  // identyfikatora, którego gość nie ma skąd znać, a SQL i tak wybiera gałąź
  // tokenu, więc pomyłka byłaby niewidoczna aż do audytu zgód.
  it("gość bez konta jedzie kluczem z maila, bez identyfikatora zgłoszenia", async () => {
    rpc().setData("event_registration_set_channels", {
      registration_id: REG,
      notify_email: true,
      notify_sms: false,
    });

    const prefs = await api.setRegistrationChannels({
      manageToken: MANAGE_TOKEN,
      notifySms: false,
    });

    const sent = payloadOf("event_registration_set_channels");
    expect(sent).toEqual({ manage_token: MANAGE_TOKEN, notify_sms: false });
    expect("registration_id" in sent).toBe(false);
    expect(prefs.notifySms).toBe(false);
  });

  // ZAKRES NAJEMCY I TOŻSAMOŚĆ SIEDZĄ W SQL (zasada 12): `public_tenant_id()`
  // z hosta, `auth.uid()` z sesji i warunek `pe.user_id = v_uid`
  // (`20260830100000:45-75`). Klient, który dokładałby `tenant_id` albo
  // `user_id`, nie zawęziłby niczego - te pola nie są czytane - a w przeglądzie
  // wyglądałby na zabezpieczony.
  it("nie podaje najemcy ani tożsamości - jedno i drugie rozstrzyga baza", async () => {
    rpc().setData("event_registration_set_channels", {
      registration_id: REG,
      notify_email: false,
      notify_sms: false,
    });

    await api.setRegistrationChannels({
      registrationId: REG,
      notifyEmail: false,
      notifySms: false,
    });

    const call = rpc().lastCall("event_registration_set_channels");
    expect(call?.keys()).toEqual(["p_payload"]);
    const sent = Object.keys(payloadOf("event_registration_set_channels"));
    expect(sent).not.toContain("tenant_id");
    expect(sent).not.toContain("user_id");
  });

  // Klient NIE WYMYŚLA wartości domyślnych. Gdyby przy pustym wejściu dosyłał
  // `notify_email: true` „dla porządku", odświeżenie ekranu bez zmiany
  // przełącznika WŁĄCZAŁOBY z powrotem pocztę komuś, kto ją wyciszył. Zamiast
  // tego leci pusty ładunek i baza odmawia (`invalid_payload: nothing to
  // change`).
  it("brak obu preferencji wysyła pusty ładunek, a odmowa bazy leci wyjątkiem", async () => {
    rpc().setResponse("event_registration_set_channels", (call) => {
      const sent = asBag(call.arg("p_payload"));
      const pusty = sent !== null && Object.keys(sent).length === 0;
      return pusty
        ? fail("invalid_payload: nothing to change")
        : ok({ registration_id: REG, notify_email: true, notify_sms: true });
    });

    await expect(api.setRegistrationChannels({})).rejects.toThrow(/invalid_payload/);
    expect(payloadOf("event_registration_set_channels")).toEqual({});
  });

  // Odpowiedź niepełna czyta się PO STRONIE OPT-OUT, tak samo jak wiersz bazy
  // w `registrationOutcomeNotify.server.ts:242`. Obie strony muszą zgadzać się
  // co do znaczenia braku: „wysyłaj". Rozjazd dałby interfejs mówiący „kanał
  // wyciszony" o kanale, który nadal wysyła.
  it("brak kanału w odpowiedzi znaczy wysyłaj - tak jak po stronie wysyłki", async () => {
    rpc().setData("event_registration_set_channels", { registration_id: REG });

    const prefs = await api.setRegistrationChannels({ registrationId: REG, notifyEmail: false });

    expect(prefs).toEqual({ registrationId: REG, notifyEmail: true, notifySms: true });
  });

  // Odpowiedź bez identyfikatora to odpowiedź, o której nie wiadomo, CZYJE
  // zgłoszenie opisuje. Panel podmienia po niej stan karty, więc przyjęcie jej
  // znaczyłoby pokazanie cudzych (albo żadnych) preferencji jako zapisanych.
  it("odpowiedź bez `registration_id` to `invalid_response`, a nie cichy sukces", async () => {
    rpc().setData("event_registration_set_channels", { notify_email: false });
    await expect(
      api.setRegistrationChannels({ registrationId: REG, notifyEmail: false }),
    ).rejects.toThrow(/invalid_response/);

    rpc().setData("event_registration_set_channels", null);
    await expect(
      api.setRegistrationChannels({ registrationId: REG, notifyEmail: false }),
    ).rejects.toThrow(/invalid_response/);

    // Tablica też nie jest wierszem - `bag()` odrzuca ją celowo, bo
    // `["registration_id"]` przeszłoby przez samo `typeof === "object"`.
    rpc().setData("event_registration_set_channels", [{ registration_id: REG }]);
    await expect(
      api.setRegistrationChannels({ registrationId: REG, notifyEmail: false }),
    ).rejects.toThrow(/invalid_response/);

    // Pusty napis w identyfikatorze też nie jest identyfikatorem.
    rpc().setData("event_registration_set_channels", { registration_id: "   " });
    await expect(
      api.setRegistrationChannels({ registrationId: REG, notifyEmail: false }),
    ).rejects.toThrow(/invalid_response/);
  });

  it("odmowy bazy dojeżdżają nietknięte: `not_found` i `auth_required`", async () => {
    rpc().setError("event_registration_set_channels", "not_found: registration does not exist");
    await expect(
      api.setRegistrationChannels({ registrationId: REG, notifySms: false }),
    ).rejects.toThrow(/not_found/);

    rpc().setError(
      "event_registration_set_channels",
      "auth_required: registration_id with session or manage_token is required",
    );
    await expect(api.setRegistrationChannels({ notifySms: false })).rejects.toThrow(
      /auth_required/,
    );
  });
});

/* --------------------------------------------------- moje zgłoszenia --- */

describe("fetchMyRegistrations", () => {
  it("woła `event_my_registrations` z ładunkiem, bez identyfikatora użytkownika", async () => {
    rpc().setData("event_my_registrations", { registrations: [] });

    await api.fetchMyRegistrations();

    // Funkcja NIE PRZYJMUJE żadnego identyfikatora - wynik ogranicza
    // `auth.uid()` w SQL. Wysłanie `user_id` byłoby zaproszeniem do czytania
    // cudzych zgłoszeń przez podmianę parametru, a `registration_id` zamieniłoby
    // „moje zgłoszenia" w odczyt pojedynczego, dowolnego wiersza.
    expect(rpc().names()).toEqual(["event_my_registrations"]);
    const call = rpc().lastCall("event_my_registrations");
    expect(call?.keys()).toEqual(["p_payload"]);
    const sent = payloadOf("event_my_registrations");
    expect("user_id" in sent).toBe(false);
    expect("tenant_id" in sent).toBe(false);
    expect("registration_id" in sent).toBe(false);
  });

  it("pusty kształt odpowiedzi daje pustą listę, a nie wyjątek", async () => {
    for (const puste of [null, {}, { registrations: [] }, { registrations: "brak" }, []]) {
      rpc().setData("event_my_registrations", puste);
      await expect(api.fetchMyRegistrations()).resolves.toEqual([]);
    }
  });

  it("pełny kształt: wydarzenie, kasa i ślad operatora składają się w jedną kartę", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [
        wiersz({
          webhooks: [
            {
              id: "wh-1",
              event_type: "checkout.session.completed",
              status: "processed",
              occurred_at: "2026-08-01T09:11:00.000Z",
              processed_at: "2026-08-01T09:11:03.000Z",
              retry_count: 0,
            },
          ],
        }),
      ],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.registrationId).toBe(REG);
    expect(item.eventId).toBe(EVENT_ID);
    expect(item.ticketTypeId).toBe(TICKET_ID);
    expect(item.status).toBe("approved");
    expect(item.paymentStatus).toBe("paid");
    expect(item.eventSlug).toBe("kongres-testowy-2026");
    expect(item.eventTimezone).toBe("Europe/Warsaw");
    expect(item.orderStatus).toBe("paid");
    expect(item.currency).toBe("PLN");
    expect(item.webhooks).toEqual([
      {
        id: "wh-1",
        eventType: "checkout.session.completed",
        status: "processed",
        occurredAt: "2026-08-01T09:11:00.000Z",
        processedAt: "2026-08-01T09:11:03.000Z",
        retryCount: 0,
      },
    ]);
  });

  // KWOTY LICZĄ SIĘ Z GROSZY. Karta dzieli przez 100, więc każdy grosz zgubiony
  // w parsowaniu jest złotówką na ekranie uczestnika. `Math.trunc` znaczy też,
  // że kwota nigdy nie rośnie: uczestnik nie zobaczy ceny wyższej niż
  // zamówienie.
  it("kwoty idą w groszach i nie zaokrąglają się w górę", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ amount_cents: 129900, refunded_amount_cents: 4999 })],
    });
    const [zaplacone] = await api.fetchMyRegistrations();
    expect(zaplacone.amountCents).toBe(129900);
    expect(zaplacone.refundedCents).toBe(4999);
    expect((zaplacone.amountCents ?? 0) / 100).toBe(1299);

    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ amount_cents: 12999.7 })],
    });
    const [ulamek] = await api.fetchMyRegistrations();
    expect(ulamek.amountCents).toBe(12999);
  });

  // Karta rozstrzyga „zwrócone" kontra „częściowo zwrócone" porównaniem
  // `refundedCents >= amountCents` i `refundedCents > 0`
  // (`ParticipantTicketsPanel.tsx:69-71`). Zwrot sparsowany na `null` zamiast
  // na 0 wywróciłby oba warunki i zamówienie bez zwrotu wyglądałoby jak
  // zwrócone w całości.
  it("brak zwrotu to 0, a nie null - inaczej karta pomyli zwrot z jego brakiem", async () => {
    const bezKlucza = wiersz();
    delete bezKlucza.refunded_amount_cents;
    rpc().setData("event_my_registrations", { registrations: [bezKlucza] });

    const [item] = await api.fetchMyRegistrations();

    expect(item.refundedCents).toBe(0);
    expect(item.refundedCents >= (item.amountCents ?? 0)).toBe(false);
  });

  // Brak zamówienia to inna odpowiedź niż zamówienie na zero złotych: bez
  // kwoty karta pokazuje kreskę i nie proponuje zapłaty, a `awaitsPayment`
  // (`myEventsGrouping.ts:32-36`) właśnie po `null` rozpoznaje zapis bez kasy.
  it("zgłoszenie bez zamówienia zostawia kwotę jako null, nie jako zero", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [
        wiersz({
          order_status: null,
          amount_cents: null,
          refunded_amount_cents: null,
          currency: null,
          payment_status: null,
        }),
      ],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.amountCents).toBeNull();
    expect(item.currency).toBeNull();
    expect(item.orderStatus).toBeNull();
    expect(item.paymentStatus).toBeNull();
    // Brak zwrotu nadal jest liczbą - porównania kwot mają być bezpieczne.
    expect(item.refundedCents).toBe(0);
  });

  // OPT-OUT NA ODCZYCIE. Zgłoszenie sprzed wprowadzenia przełączników nie ma
  // tych pól, a domyślną odpowiedzią musi być „wysyłamy" - dokładnie tak, jak
  // czyta to wysyłka. Domyślne `false` wyciszyłoby ludziom powiadomienia
  // o pieniądzach bez ich decyzji.
  it("brak decyzji o kanałach czyta się jako zgoda na oba", async () => {
    const bezKanalow = wiersz();
    delete bezKanalow.notify_email;
    delete bezKanalow.notify_sms;
    rpc().setData("event_my_registrations", { registrations: [bezKanalow] });
    const [domyslne] = await api.fetchMyRegistrations();
    expect(domyslne.notifyEmail).toBe(true);
    expect(domyslne.notifySms).toBe(true);

    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ notify_email: false, notify_sms: true })],
    });
    const [wyciszone] = await api.fetchMyRegistrations();
    expect(wyciszone.notifyEmail).toBe(false);
    expect(wyciszone.notifySms).toBe(true);
  });

  // Starszy backend nie oddaje `event_id` ani `ticket_type_id`, a `createCheckoutOrder`
  // potrzebuje obu naraz. `null` znaczy „nie pokazuj przycisku zapłaty" - lepiej
  // brak drogi do kasy niż przycisk prowadzący do kasy bez identyfikatorów.
  it("starszy backend bez identyfikatorów daje null, a nie puste napisy", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ event_id: null, ticket_type_id: "" })],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.eventId).toBeNull();
    expect(item.ticketTypeId).toBeNull();
  });

  // Zgłoszenie bez stanu nie istnieje w bazie (`status` ma NOT NULL i CHECK),
  // ale odpowiedź, w której tego pola zabrakło, nie może wygasić plakietki:
  // `statusKey()` w panelu (`ParticipantTicketsPanel.tsx:32-39`) oddaje wtedy
  // „unknown", a warunki „można jeszcze zapłacić" porównują się z konkretnymi
  // stanami. `pending` jest jedynym bezpiecznym domysłem - zapis czeka.
  it("brak stanu zgłoszenia czyta się jako `pending`, a nie jako pusty napis", async () => {
    const bezStanu = wiersz();
    delete bezStanu.status;
    rpc().setData("event_my_registrations", { registrations: [bezStanu] });
    const [domyslny] = await api.fetchMyRegistrations();
    expect(domyslny.status).toBe("pending");

    rpc().setData("event_my_registrations", { registrations: [wiersz({ status: "  " })] });
    const [pusty] = await api.fetchMyRegistrations();
    expect(pusty.status).toBe("pending");
  });

  // Tytuł złożony z samych spacji to tytuł, którego nie ma: karta ma wtedy
  // pokazać slug (`ParticipantTicketsPanel.tsx:53`), a nie pusty nagłówek.
  it("tytuł z samych spacji czyta się jako brak tytułu", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ event_title_pl: "   ", event_title_en: "" })],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.eventTitlePl).toBeNull();
    expect(item.eventTitleEn).toBeNull();
    expect(item.eventSlug).toBe("kongres-testowy-2026");
  });

  // Wiersz bez identyfikatora albo bez sluga nie ma jak trafić w wydarzenie:
  // karta nie zbudowałaby ani odnośnika, ani zmiany kanałów. Wypada POJEDYNCZO,
  // a nie razem z całą listą - jeden uszkodzony wiersz nie może wygasić panelu.
  it("wiersz bez identyfikatora albo bez sluga wypada, reszta listy zostaje", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [
        wiersz({ registration_id: null }),
        wiersz({ event_slug: "" }),
        "nie-wiersz",
        null,
        wiersz({ registration_id: REG_DRUGIE }),
      ],
    });

    const items = await api.fetchMyRegistrations();

    expect(items).toHaveLength(1);
    expect(items[0]?.registrationId).toBe(REG_DRUGIE);
  });

  // Ślad operatora płatności jest dowodem w sporze o pieniądze, więc wpis bez
  // identyfikatora nie ma po co istnieć, a brakujące pola dostają wartości
  // mówiące wprost „nie wiadomo" - zamiast pustych miejsc udających porządek.
  it("ślad operatora: wpis bez `id` wypada, a braki mają jawne wartości domyślne", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [
        wiersz({
          webhooks: [
            { event_type: "charge.refunded", status: "failed" },
            { id: "wh-2" },
            "nie-wpis",
            { id: "wh-3", retry_count: 4.9 },
          ],
        }),
      ],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.webhooks).toEqual([
      {
        id: "wh-2",
        eventType: "unknown",
        status: "unknown",
        occurredAt: null,
        processedAt: null,
        retryCount: 0,
      },
      {
        id: "wh-3",
        eventType: "unknown",
        status: "unknown",
        occurredAt: null,
        processedAt: null,
        retryCount: 4,
      },
    ]);
  });

  it("nie-tablica w `webhooks` daje pustą listę, a nie wyjątek na karcie", async () => {
    rpc().setData("event_my_registrations", {
      registrations: [wiersz({ webhooks: { id: "wh-1" } })],
    });

    const [item] = await api.fetchMyRegistrations();

    expect(item.webhooks).toEqual([]);
  });

  // Odmowa nie może zamienić się w pustą listę: „nie masz żadnych zgłoszeń"
  // pokazane komuś, kto ma wygasłą sesję, jest kłamstwem, po którym uczestnik
  // zapisuje się drugi raz.
  it("odmowa `auth_required` leci wyjątkiem, a nie pustą listą", async () => {
    rpc().setError("event_my_registrations", "auth_required: sign in to see your registrations");

    await expect(api.fetchMyRegistrations()).rejects.toThrow(/auth_required/);
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (zasada 2).
  //
  // CO JEST ZLE. `event_my_registrations` tnie wynik do `limit` z ładunku,
  // domyślnie 20 i najwyżej 50 (`20260830090000:792`), a porządek to
  // `created_at DESC`. `fetchMyRegistrations()` nie przyjmuje ŻADNEGO argumentu
  // i wysyła `{}`, więc uczestnik z dwudziestym pierwszym zapisem po prostu nie
  // widzi najstarszych - i nie widzi też informacji, że lista jest ucięta.
  // Wszystkie trzy powierzchnie (`ParticipantTicketsPanel`, `MyEventsPanel`,
  // `AccountMenuEventsSection`) wołają tę funkcję bez argumentów, więc nie ma
  // drugiej drogi do starszych zgłoszeń; sekcja „minione" w `MyEventsPanel`
  // gubi je jako pierwsza, bo są najstarsze.
  //
  // DLACZEGO NIE NAPRAWIAM: wymaga parametru w funkcji, przekazania go z trzech
  // powierzchni i stronicowania w interfejsie - czyli zmiany produkcyjnej.
  // Do rozstrzygnięcia jest przy tym twardy sufit 50 wierszy po stronie SQL.
  it.fails(
    "defekt: uczestnik z 25 zapisami dostaje 20 - klient nie umie poprosić o więcej",
    async () => {
      // Baza zamodelowana wiernie: `limit` czytany z ładunku, domyślnie 20,
      // sufit 50, porządek `created_at DESC` (`20260830090000:792`). Sufit jest
      // wyżej niż 25, więc jedyną przyczyną obcięcia jest klient.
      const wszystkie = Array.from({ length: 25 }, (_, i) =>
        wiersz({ registration_id: `3c4d0000-0000-4000-8000-${String(700 + i).padStart(12, "0")}` }),
      );
      rpc().setResponse("event_my_registrations", (call) => {
        const sent = asBag(call.arg("p_payload"));
        const zadany = sent === null ? undefined : sent["limit"];
        const limit = typeof zadany === "number" ? Math.min(Math.max(zadany, 1), 50) : 20;
        return ok({ registrations: wszystkie.slice(0, limit) });
      });

      const moje = await api.fetchMyRegistrations();

      // Zgłoszenia od 21. w dół nie mają drugiej drogi na ekran - i nic nie
      // mówi uczestnikowi, że lista została ucięta.
      expect(moje).toHaveLength(25);
    },
  );
});

/* --------------------------------------- panele prelegentów wydarzenia --- */

describe("fetchEventSpeakerSessions", () => {
  it("woła `event_attendee_sessions` ze slugiem wydarzenia", async () => {
    rpc().setData("event_attendee_sessions", { speakers: [] });

    await api.fetchEventSpeakerSessions("kongres-testowy-2026");

    expect(payloadOf("event_attendee_sessions")).toEqual({
      event_slug: "kongres-testowy-2026",
    });
  });

  it("pusty kształt odpowiedzi daje pustą mapę, a nie wyjątek", async () => {
    for (const puste of [null, {}, { speakers: [] }, { speakers: "brak" }, []]) {
      rpc().setData("event_attendee_sessions", puste);
      const mapa = await api.fetchEventSpeakerSessions("kongres-testowy-2026");
      expect(mapa.size).toBe(0);
    }
  });

  // Katalog uczestników trafia w prelegenta trzema różnymi kluczami: kartą
  // konta (`user_id`), kartą osoby z kartoteki (`person_id`) i wierszem
  // zgłoszenia (`registration_ids`). Zgubienie któregokolwiek znaczy kartę
  // uczestnika bez plakietki „występuje w panelu".
  it("jeden prelegent trafia do mapy pod kontem, osobą i każdym zgłoszeniem", async () => {
    rpc().setData("event_attendee_sessions", {
      speakers: [
        {
          user_id: USER_ID,
          person_id: PERSON_ID,
          registration_ids: [REG, REG_DRUGIE],
          sessions: [
            {
              session_id: SESSION_ID,
              title_pl: "Panel otwarcia",
              title_en: "Opening panel",
              starts_at: "2026-10-05T08:00:00.000Z",
              ends_at: "2026-10-05T09:00:00.000Z",
              role: "moderator",
            },
          ],
        },
      ],
    });

    const mapa = await api.fetchEventSpeakerSessions("kongres-testowy-2026");

    expect(mapa.size).toBe(4);
    const oczekiwane = [
      {
        sessionId: SESSION_ID,
        titlePl: "Panel otwarcia",
        titleEn: "Opening panel",
        startsAt: "2026-10-05T08:00:00.000Z",
        endsAt: "2026-10-05T09:00:00.000Z",
        role: "moderator",
      },
    ];
    expect(mapa.get(USER_ID)).toEqual(oczekiwane);
    expect(mapa.get(PERSON_ID)).toEqual(oczekiwane);
    expect(mapa.get(REG)).toEqual(oczekiwane);
    expect(mapa.get(REG_DRUGIE)).toEqual(oczekiwane);
  });

  // Prelegent bez konta istnieje naprawdę: zaproszony gość ma wiersz
  // w kartotece i zgłoszenie, ale nie ma `user_id`. Musi dać się odnaleźć
  // pozostałymi kluczami, inaczej znika z katalogu.
  it("prelegent bez konta trafia do mapy po osobie i po zgłoszeniu", async () => {
    rpc().setData("event_attendee_sessions", {
      speakers: [
        {
          user_id: null,
          person_id: PERSON_ID,
          registration_ids: [REG, "", "   "],
          sessions: [{ session_id: SESSION_ID, role: "speaker" }],
        },
      ],
    });

    const mapa = await api.fetchEventSpeakerSessions("kongres-testowy-2026");

    // Puste napisy w liście zgłoszeń nie mogą stać się kluczem - trafiałby
    // w nie KAŻDY uczestnik bez identyfikatora.
    expect([...mapa.keys()].sort()).toEqual([PERSON_ID, REG].sort());
    expect(mapa.get(REG)).toEqual([
      {
        sessionId: SESSION_ID,
        titlePl: null,
        titleEn: null,
        startsAt: null,
        endsAt: null,
        role: "speaker",
      },
    ]);
  });

  // Wpis bez identyfikatora sesji nie ma czym otworzyć agendy, a prelegent
  // z samymi takimi wpisami nie ma po co dostawać plakietki „występuje" -
  // uczestnik kliknąłby w nią i nie zobaczył nic.
  it("sesja bez identyfikatora wypada, a prelegent bez sesji nie wchodzi do mapy", async () => {
    rpc().setData("event_attendee_sessions", {
      speakers: [
        {
          user_id: USER_ID,
          sessions: [{ title_pl: "Sesja bez identyfikatora" }, "nie-sesja", null],
        },
        {
          user_id: PERSON_ID,
          sessions: "brak",
        },
        {
          person_id: REG,
          sessions: [{ session_id: SESSION_ID, title_pl: "Panel zamknięcia" }],
        },
        "nie-prelegent",
      ],
    });

    const mapa = await api.fetchEventSpeakerSessions("kongres-testowy-2026");

    expect(mapa.has(USER_ID)).toBe(false);
    expect(mapa.has(PERSON_ID)).toBe(false);
    expect(mapa.get(REG)?.[0]?.titlePl).toBe("Panel zamknięcia");
  });

  it("odmowa `not_found` leci wyjątkiem, a nie pustą mapą", async () => {
    rpc().setError("event_attendee_sessions", "not_found: event does not exist");

    await expect(api.fetchEventSpeakerSessions("nie-ma-takiego")).rejects.toThrow(/not_found/);
  });
});
