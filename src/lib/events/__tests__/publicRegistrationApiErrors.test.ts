// Publiczny zapis na wydarzenie: odmowy bazy, ksztalty puste i MINIMUM danych,
// ktore ta warstwa ma prawo wpuscic z bazy na ekran i z ekranu do bazy.
//
// PO CO TEN PLIK ISTNIEJE OBOK `publicRegistration.test.ts`. Tamten opisuje
// sciezke szczesliwa: parser formularza, komplet kluczy zapisu, mapowanie
// odmow na i18n. Tutaj chodzi o cztery rzeczy, ktorych tamten kontrakt nie
// dotyka, a kazda konczy sie zdaniem NIEPRAWDZIWYM wobec uczestnika:
//
// 1) ODMOWA ODCZYTU ZAMIENIONA W "ZAPISY ZAMKNIETE". `parseRegistrationForm`
//    oddaje na smieciach `EMPTY_REGISTRATION_FORM`, a ten ma `isOpen: false`.
//    Zgubiony `if (error) throw error` nie rysuje zadnego bledu - rysuje
//    poprawny ekran "zapisy zamkniete" na wydarzeniu, ktore wlasnie je otworzylo.
// 2) POLE, KTOREGO FORMULARZ NIE OFERUJE. `event_register` czyta ladunek po
//    nazwie i nie protestuje przeciw kluczowi, ktorego nie zna, wiec komplet
//    wysylanych kluczy jest jedynym miejscem, w ktorym widac, ze zapis
//    publiczny NIE przyjmuje statusu, platnosci ani tozsamosci wolajacego.
//    O tych trzech decyduje SQL, nie przegladarka gosca.
// 3) ODPOWIEDZ NIECZYTELNA UDAJACA SUKCES. `manage_token` i `qr_token` wracaja
//    RAZ (baza trzyma tylko SHA-256), wiec "zapisano, ale nie umiemy tego
//    pokazac" jest utrata jedynej drogi rezygnacji gosc bez konta.
// 4) KARTOTEKA ZAMIAST MINIMUM. Widok samoobslugi ma powiedziec "czekamy na
//    wplate, oto kwota" - i nic wiecej. Kazde pole osobowe, ktore przecieknie
//    z bazy do tego modelu, laduje na stronie otwieranej KLUCZEM Z LINKU,
//    czyli bez logowania.
//
// RODO: wszystkie dane w tym pliku sa syntetyczne, adresy w domenie example.com.
// ZAWEZENIE NAJEMCA robi `public_tenant_id()` w SQL (naglowek hosta), nie
// klient - pilnuje go bramka `check:sql-tenant-scope`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";
import { EMPTY_REGISTRATION_FORM } from "@/lib/events/registrationFormSurface";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/publicRegistrationApi");

const SLUG = "kongres-2026";
const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TICKET = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REG = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const MANAGE = "manage-0123456789abcdef";

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ladunek ostatniego wywolania RPC.
 *
 * Straznik typu zamiast rzutowania: brak wywolania albo ladunek, ktory nie jest
 * obiektem, ma sie zglosic ZDANIEM z nazwa funkcji, a nie wywrocic pozniej na
 * `Object.keys(undefined)`. Przy przemianowanym argumencie chcemy przeczytac,
 * ktora funkcja zawiodla, a nie szukac tego w slowie "undefined".
 */
function payloadOf(fn: string): Record<string, unknown> {
  const value = h.rpc?.lastCall(fn)?.arg("p_payload");
  if (!isBag(value)) {
    throw new Error(`test: RPC "${fn}" nie dostalo obiektu w argumencie "p_payload"`);
  }
  return value;
}

/** Minimalne zgloszenie - dokladnie to, co oferuje formularz publiczny. */
function minimalInput(): Parameters<typeof api.submitRegistration>[0] {
  return {
    eventSlug: SLUG,
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna.kowalska@example.com",
    consentDataProcessing: true,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("odczyt formularza", () => {
  it("wola RPC ze slugiem pod nazwa z sygnatury i oddaje model", async () => {
    h.rpc?.setData("event_registration_form", {
      event: {
        id: EVENT,
        slug: SLUG,
        title_pl: "Kongres",
        title_en: "Congress",
        starts_at: "2026-09-01T08:00:00+00:00",
        ends_at: "2026-09-01T16:00:00+00:00",
        timezone: "Europe/Warsaw",
        registration_mode: "form",
        registration_flow: "auto",
      },
      is_open: true,
      fields: [],
      tickets: [],
      terms: [],
    });
    const form = await api.fetchRegistrationForm(SLUG);
    expect(h.rpc?.lastCall("event_registration_form")?.arg("p_event_slug")).toBe(SLUG);
    expect(form.event?.id).toBe(EVENT);
    expect(form.isOpen).toBe(true);
  });

  it("odmowa bazy NIE zamienia sie w ekran `zapisy zamkniete`", async () => {
    // To jest cala stawka tego przypadku: pusty model ma `isOpen: false`, wiec
    // sciszony blad rysuje sie jako poprawna, zamknieta strona zapisu. Uczestnik
    // nie ma wtedy czego ponowic ani czego zglosic organizatorowi.
    expect(EMPTY_REGISTRATION_FORM.isOpen).toBe(false);
    h.rpc?.setError("event_registration_form", "rate_limited: za duzo prob");
    await expect(api.fetchRegistrationForm(SLUG)).rejects.toThrow(/rate_limited/);
  });
});

describe("zapis - ladunek", () => {
  beforeEach(() => {
    h.rpc?.setData("event_register", { registration_id: REG, status: "approved" });
  });

  it("wysyla DOKLADNIE pola formularza - ani statusu, ani platnosci, ani tozsamosci", async () => {
    await api.submitRegistration(minimalInput());
    const payload = payloadOf("event_register");

    // Komplet, nie podzbior: o statusie, kwocie, osobie i najemcy decyduje SQL.
    // Kazdy dodatkowy klucz w tym miejscu byloby polem, ktorego formularz nie
    // oferuje, a ktore `event_register` moze kiedys zaczac czytac.
    expect(Object.keys(payload).sort()).toEqual([
      "accepted_term_ids",
      "answers",
      "consent_data_processing",
      "consent_marketing",
      "consent_partner_sharing",
      "email",
      "event_slug",
      "first_name",
      "last_name",
    ]);
    // Zgody nieoznaczone jada jako jawne `false`, a nie jako brak klucza:
    // "nie zaznaczyl" i "nie pytano" to dwa rozne wpisy w rejestrze zgod.
    expect(payload.consent_marketing).toBe(false);
    expect(payload.consent_partner_sharing).toBe(false);
    expect(payload.answers).toEqual({});
    expect(payload.accepted_term_ids).toEqual([]);
  });

  it("odpowiedz z pustym kluczem nie zaklada pola w `answers`", async () => {
    // Pusty klucz zrobilby w jsonb wpis `""`, ktorego zaden panel nie umie
    // pokazac ani wyeksportowac - a wyglada jak odpowiedz uczestnika.
    await api.submitRegistration({
      ...minimalInput(),
      answers: [
        { key: "  dieta  ", value: ["wege"] },
        { key: "   ", value: "smieci" },
        { key: "dieta", value: ["bez glutenu"] },
      ],
    });
    const payload = payloadOf("event_register");
    // Klucz przycinany, ostatnia odpowiedz na ten sam klucz wygrywa - formularz
    // wysyla jedno pole, nie dwa sprzeczne.
    expect(payload.answers).toEqual({ dieta: ["bez glutenu"] });
  });

  it("jawny `null` czysci pole, a pominiete pole zostaje nietkniete", async () => {
    // W plpgsql `p_payload->>'x'` na jawnym `null` znaczy "wyczysc", a brak
    // klucza znaczy "nie dotykaj". Zamiana tych dwoch rzeczy kasuje uczestnikowi
    // telefon przy kazdej edycji zgloszenia.
    await api.submitRegistration({
      ...minimalInput(),
      phone: null,
      jobTitle: "Analityczka",
      socialProfileUrl: "https://social.example.org/anna-kowalska",
    });
    const payload = payloadOf("event_register");
    expect("phone" in payload).toBe(true);
    expect(payload.phone).toBeNull();
    expect(payload.job_title).toBe("Analityczka");
    expect(payload.social_profile_url).toBe("https://social.example.org/anna-kowalska");
    expect("company_text" in payload).toBe(false);
    expect("ticket_type_id" in payload).toBe(false);
  });
});

describe("zapis - odczyt odpowiedzi", () => {
  it("wejsciowka platna wraca jako `czeka na wplate`, bez kodu wejscia", async () => {
    // Przed migracja 20260828206000 front rysowal tu ekran "do zobaczenia na
    // wydarzeniu" i wysylal potwierdzenie komus, kto nic nie zaplacil.
    h.rpc?.setData("event_register", {
      registration_id: REG,
      event_id: EVENT,
      ticket_type_id: TICKET,
      status: "approved",
      qr_token: null,
      manage_token: MANAGE,
      payment_required: true,
      payment_status: "unpaid",
      amount_cents: 25000,
      currency: "EUR",
    });
    const result = await api.submitRegistration({ ...minimalInput(), ticketTypeId: TICKET });
    expect(result.paymentRequired).toBe(true);
    expect(result.paymentStatus).toBe("unpaid");
    expect(result.amountCents).toBe(25000);
    expect(result.currency).toBe("EUR");
    expect(result.qrToken).toBeNull();
    // Kasa przyjmuje trojke naraz, wiec odpowiedz zapisu musi niesc komplet -
    // inaczej ekran potwierdzenia doszukiwalby wydarzenia drugim zapytaniem.
    expect(result.eventId).toBe(EVENT);
    expect(result.ticketTypeId).toBe(TICKET);
  });

  it("starszy backend bez kluczy platnosci NIE robi z zapisu platnego", async () => {
    h.rpc?.setData("event_register", { registration_id: REG, status: "approved" });
    const result = await api.submitRegistration(minimalInput());
    expect(result.paymentRequired).toBe(false);
    expect(result.paymentStatus).toBeNull();
    expect(result.amountCents).toBeNull();
    expect(result.eventId).toBeNull();
  });

  it("`payment_required` jako napis nie zamyka wejscia uczestnikowi", async () => {
    // Tylko literalne `true` znaczy "trzeba zaplacic". Napis "false" jest
    // w JavaScripcie prawdziwy, a napis "true" nie jest wartoscia logiczna -
    // czytanie tego pola luzno blokowaloby wejscie po stronie darmowej.
    h.rpc?.setData("event_register", {
      registration_id: REG,
      status: "approved",
      payment_required: "true",
      qr_token: "qr-0123456789",
    });
    const result = await api.submitRegistration(minimalInput());
    expect(result.paymentRequired).toBe(false);
    expect(result.qrToken).toBe("qr-0123456789");
  });

  it("odpowiedz, ktora nie jest obiektem, nie udaje udanego zapisu", async () => {
    // Bez identyfikatora nie umiemy zgloszenia ani pokazac, ani odwolac -
    // a `manage_token` wraca RAZ, wiec cichy sukces jest utrata jedynego klucza
    // rezygnacji gosca bez konta.
    for (const data of [null, "ok", [{ registration_id: REG }]]) {
      h.rpc = supabaseRpcStub();
      h.rpc.setData("event_register", data);
      await expect(api.submitRegistration(minimalInput())).rejects.toThrow(/unknown/);
    }
  });

  it("odmowa bazy dociera z zachowanym kluczem dla warstwy i18n", async () => {
    h.rpc?.setError("event_register", "ticket_required: wybierz wejsciowke");
    await expect(api.submitRegistration(minimalInput())).rejects.toThrow(/ticket_required/);
  });
});

describe("widok samoobslugi zgloszenia", () => {
  it("pod kluczem z linku jedzie SAM klucz, bez identyfikatora zgloszenia", async () => {
    h.rpc?.setData("event_registration_manage_view", { ok: true, registration_id: REG });
    const view = await api.fetchRegistrationManageView({ manageToken: MANAGE });
    const payload = payloadOf("event_registration_manage_view");
    expect(payload).toEqual({ manage_token: MANAGE });
    // I druga polowa tej samej reguly: sciezka pod samym kluczem MA oddac
    // zgloszenie. Gosc bez konta nie ma zadnej innej drogi na swoja strone
    // samoobslugi - `null` tutaj to dla niego link, ktory "nie dziala".
    expect(view?.registrationId).toBe(REG);
  });

  it("oddaje MINIMUM - zadne pole osobowe z bazy nie trafia na strone z linku", async () => {
    // Ta strona otwiera sie KLUCZEM Z WIADOMOSCI, bez logowania. Wszystko, co
    // ten model przepusci, jest dostepne dla kazdego, kto ma link - dlatego
    // komplet pol jest tu asertowany co do jednego, a nie "zawiera kwote".
    h.rpc?.setData("event_registration_manage_view", {
      ok: true,
      registration_id: REG,
      event_id: EVENT,
      event_slug: SLUG,
      ticket_type_id: TICKET,
      status: "approved",
      payment_status: "unpaid",
      amount_cents: 25000,
      currency: "EUR",
      owned_by_caller: true,
      // Pola, ktorych baza oddawac nie powinna, a gdyby zaczela - nie moga
      // wyciec na strone otwierana linkiem.
      email: "anna.kowalska@example.com",
      first_name: "Anna",
      last_name: "Kowalska",
      phone: "+48 700 000 000",
      answers: { dieta: ["wege"] },
    });

    const view = await api.fetchRegistrationManageView({ registrationId: REG });
    expect(view).not.toBeNull();
    expect(Object.keys(view ?? {}).sort()).toEqual([
      "amountCents",
      "currency",
      "eventId",
      "eventSlug",
      "ownedByCaller",
      "paymentStatus",
      "registrationId",
      "status",
      "ticketTypeId",
      "waitlistPosition",
    ]);
    expect(view?.amountCents).toBe(25000);
    expect(view?.ownedByCaller).toBe(true);
  });

  it("zly klucz to `null`, a nie wyjatek - to normalny stan strony", async () => {
    h.rpc?.setData("event_registration_manage_view", { ok: false, reason: "not_found" });
    expect(await api.fetchRegistrationManageView({ manageToken: "zly-klucz" })).toBeNull();

    // `ok: true` bez identyfikatora tez nie jest zgloszeniem do pokazania.
    h.rpc?.setData("event_registration_manage_view", { ok: true });
    expect(await api.fetchRegistrationManageView({ manageToken: MANAGE })).toBeNull();

    h.rpc?.setData("event_registration_manage_view", null);
    expect(await api.fetchRegistrationManageView({ manageToken: MANAGE })).toBeNull();
  });

  it("wlascicielstwo tylko z literalnego `true` - to ono odslania przycisk kasy", async () => {
    h.rpc?.setData("event_registration_manage_view", {
      ok: true,
      registration_id: REG,
      owned_by_caller: "true",
      waitlist_position: 4,
    });
    const view = await api.fetchRegistrationManageView({ registrationId: REG });
    expect(view?.ownedByCaller).toBe(false);
    expect(view?.waitlistPosition).toBe(4);
    // Brak statusu czytamy jako "czeka" - to jedyna odpowiedz, ktora nie
    // obiecuje wejscia ani go nie odbiera.
    expect(view?.status).toBe("pending");
  });

  it("odmowa bazy dociera jako blad, a nie jako `nie ma czego pokazac`", async () => {
    // "Zly klucz" i "baza odmowila" to dwa rozne ekrany: pierwszy kaze poszukac
    // wiadomosci z linkiem, drugi kaze sprobowac pozniej.
    h.rpc?.setError("event_registration_manage_view", "rate_limited: za duzo prob");
    await expect(api.fetchRegistrationManageView({ manageToken: MANAGE })).rejects.toThrow(
      /rate_limited/,
    );
  });
});

describe("rezygnacja", () => {
  it("jedzie z tym, co podano - bez pustych kluczy dokladanych z niczego", async () => {
    h.rpc?.setData("event_registration_cancel", {
      registration_id: REG,
      promoted_from_waitlist: 2,
    });
    const result = await api.cancelRegistration({ registrationId: REG, reason: null });
    const payload = payloadOf("event_registration_cancel");
    expect("manage_token" in payload).toBe(false);
    expect(payload.registration_id).toBe(REG);
    // Jawny `null` w powodzie znaczy "bez powodu" i jedzie do bazy wprost -
    // inaczej kolumna zostalaby z powodem z poprzedniej proby.
    expect("reason" in payload).toBe(true);
    expect(payload.reason).toBeNull();
    // Liczba promowanych z rezerwy to osobne zdanie dla organizatora, nie
    // ozdoba potwierdzenia.
    expect(result.promotedFromWaitlist).toBe(2);
  });

  it("brak licznika promocji czyta sie jako zero, a nie jako brak odpowiedzi", async () => {
    // Liczba promowanych z rezerwy jest zdaniem o REZERWIE, nie o powodzeniu
    // rezygnacji: `0` znaczy "nikt nie wszedl na twoje miejsce" i tak tez
    // brzmi potwierdzenie. Echo identyfikatora jest w tym ksztalcie puste -
    // slabosc opisana w przypadku ponizej.
    h.rpc?.setData("event_registration_cancel", { ok: true });
    const result = await api.cancelRegistration({ manageToken: MANAGE });
    expect(result.promotedFromWaitlist).toBe(0);
    // Echo identyfikatora jest w tym ksztalcie PUSTE i tak wlasnie dojedzie na
    // ekran potwierdzenia. Wolajacy ma wiec obowiazek nazwac odwolane
    // zgloszenie z wlasnego stanu - wypisanie tego pola wprost daloby
    // uczestnikowi zdanie "odwolano zgloszenie  " bez numeru do reklamacji.
    expect(result.registrationId).toBe("");
  });

  it("odmowa bazy nie wyglada jak odwolane zgloszenie", async () => {
    h.rpc?.setError("event_registration_cancel", "invalid_manage_token: klucz nie pasuje");
    await expect(api.cancelRegistration({ manageToken: "zly-klucz" })).rejects.toThrow(
      /invalid_manage_token/,
    );
  });

  it.fails("defekt: rezygnacja bez czytelnej odpowiedzi bazy wyglada na udana", async () => {
    // CO JEST ZLE. `cancelRegistration` na odpowiedzi, ktora nie jest obiektem
    // (`bag(data) === null`), oddaje `{ registrationId: "", promotedFromWaitlist:
    // 0 }` - czyli WYNIK, a nie blad. Blizniacza funkcja `submitRegistration`
    // w tej samej sytuacji rzuca `unknown: registration response is not
    // readable`, i to ona ma racje.
    //
    // DLACZEGO TO BOLI. Uczestnik dostaje ekran "zgloszenie odwolane" po
    // odpowiedzi, ktorej nie umielismy przeczytac - a jego miejsce nadal jest
    // zajete. Dowiaduje sie o tym dopiero przy wejsciu na wydarzenie albo
    // z listy obecnosci organizatora. Gosc bez konta nie ma jak ponowic: klucz
    // zarzadzania zostal juz zuzyty w jego oczach.
    //
    // NIE NAPRAWIAM TEGO TUTAJ - rzucenie wyjatku jest zmiana zachowania
    // produkcyjnego.
    h.rpc?.setData("event_registration_cancel", null);
    await expect(api.cancelRegistration({ manageToken: MANAGE })).rejects.toThrow();
  });
});
