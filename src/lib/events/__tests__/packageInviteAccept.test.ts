// PRZYJECIE ZAPROSZENIA NA MIEJSCE Z PAKIETU - jedyna operacja tego modulu,
// ktora cos ZAPISUJE, i jedyna, ktorej test dotad nie wykonal.
//
// WZORZEC PRZYCZYNY. Suita modulu 22 testuje CZYTANIE i TWORZENIE, a nie
// testuje usuwania, odwolywania i zmiany statusu. Dwadziescia dziewiec zapytan
// `fetch*` ma pokrycie, dziewietnascie operacji destrukcyjnych - nie.
// `packageInviteApi.test.ts` sprawdza wylacznie KSZTALT TOKENU i slownik
// odmow, wiec `acceptPackageInvite` - funkcja, ktora tworzy zatwierdzone
// zgloszenie i oddaje dwa jednorazowe klucze - nie byla wykonana ani razu.
//
// CO TU PILNUJEMY.
//
// 1) ZGODA NIE MA WARTOSCI DOMYSLNEJ. `consent_data_processing` jedzie zawsze
//    i doslownie: pominiety klucz albo podniesiony do `true` zalozylby zgode
//    RODO za czlowieka, ktory jej nie zaznaczyl.
// 2) BRAK DANEJ TO BRAK KLUCZA. `job_title` i `company_text` sa opcjonalne -
//    jawny `null` znaczylby „wyczysc" juz zapisane dane osoby
//    (`packageInviteApi.ts:74-83`), a zapraszany nie edytuje tu cudzej karty.
// 3) PUSTY SUKCES NIE ISTNIEJE. Odpowiedz bez `registration_id` konczy sie
//    bledem, bo bez identyfikatora zgloszenia nie da sie ani pokazac, ani
//    odwolac - a ekran „jestes zapisany" bez zapisu jest gorszy niz awaria.
// 4) KOD WEJSCIA WRACA RAZ. Udane wywolanie przypisuje miejsce (ponowne uzycie
//    linku to `seat_taken`, 20261012120200), wiec `qr_token` i `manage_token`
//    maja dojechac do komponentu w calosci; pusty napis ma sie czytac jako
//    BRAK, a nie jako kod, ktory da sie pokazac na bramce.
// 6) ODMOWA WARTOSCIA TO TEZ ODMOWA (REG-15). Baza odpowiada na nieznany token
//    `{ok:false, error}` - wyjatek wycofalby licznik prob - a modul zamienia to
//    na wyjatek w ksztalcie dawnego wyjatku bazy (`kod: ogon`). Pusty sukces
//    z `ok:false` bylby ekranem „jestes zapisany" bez zapisu.
// 7) FORMULARZ WYDARZENIA JEDZIE DO BAZY. Odpowiedzi (`answers`) i
//    zaakceptowane regulaminy (`accepted_term_ids`) - bez nich baza odmawia
//    `missing_required_fields` / `terms_required`; jezyk i wersja tekstow zgod
//    trafiaja do ksiegi zgod (A2).
// 5) TOKEN JEST POSWIADCZENIEM, NIE IDENTYFIKATOREM (naglowek
//    `packageInviteApi.ts:3-6`). Nie wolno go logowac ani odkladac gdzie
//    indziej niz w polu `token` ladunku. Token w tescie jest SYNTETYCZNY -
//    to losowo wygladajacy napis w alfabecie `[A-Za-z0-9_-]`, nie sekret
//    z zadnego srodowiska.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE.
//
// RODO: zapraszani sa syntetyczni, adresy wylacznie `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/packageInviteApi");
const { EVENT_CONSENT_TEXT_VERSION } = await import("@/lib/events/consentTexts");

/** Token syntetyczny: 64 znaki szesnastkowe - ksztalt zaproszenia KUPUJACEGO. */
const TOKEN = "b7c1a9d3e5f70246813579bdf0a2c4e68a1b3c5d7e9f02468ace13579bdf0246";
const REGISTRATION_ID = "4e5f0000-0000-4000-8000-000000000901";
const EVENT_ID = "4e5f0000-0000-4000-8000-000000000902";
const QR_TOKEN = "Zv3xAb5cDe7fGh9jKl1mNp3rSt5uWy7A";
const MANAGE_TOKEN = "Rt2uVw4xYz6aBc8dEf0gHi2jKl4mNp6Q";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function payloadOf(): Record<string, unknown> {
  const call = rpc().lastCall("event_package_invite_accept");
  if (call === undefined) throw new Error("test: event_package_invite_accept nie zostalo wolane");
  const payload = call.arg("p_payload");
  if (payload === null || typeof payload !== "object") {
    throw new Error("test: p_payload nie jest obiektem");
  }
  return payload as Record<string, unknown>;
}

const accepting: import("@/lib/events/packageInviteApi").PackageInviteAcceptInput = {
  token: TOKEN,
  firstName: "Halina",
  lastName: "Zaremba",
  consentDataProcessing: true,
};

/** Odpowiedz w ksztalcie z `20261012120200` (przyjecie zaproszenia, REG-15). */
const accepted = {
  ok: true,
  registration_id: REGISTRATION_ID,
  event_id: EVENT_ID,
  event_slug: "kongres-2026",
  status: "approved",
  qr_token: QR_TOKEN,
  manage_token: MANAGE_TOKEN,
  account_linked: true,
  marketing_recorded: false,
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------------- ladunek --- */

describe("acceptPackageInvite - ladunek", () => {
  it("wola `event_package_invite_accept` z jednym ladunkiem", async () => {
    rpc().setData("event_package_invite_accept", accepted);
    await api.acceptPackageInvite(accepting);

    expect(rpc().names()).toEqual(["event_package_invite_accept"]);
    expect(rpc().lastCall("event_package_invite_accept")?.keys()).toEqual(["p_payload"]);
    expect(payloadOf()).toEqual({
      token: TOKEN,
      first_name: "Halina",
      last_name: "Zaremba",
      consent_data_processing: true,
      answers: {},
      accepted_term_ids: [],
      consent_marketing: false,
      lang: "pl",
      consent_text_version: EVENT_CONSENT_TEXT_VERSION,
    });
  });

  // Pola obowiazkowe i regulaminy wydarzenia sprawdza baza (REG-15) - bez nich
  // odmawia `missing_required_fields` / `terms_required`. Odpowiedzi jada jako
  // obiekt `klucz -> wartosc` (ten sam ksztalt co zapis), regulaminy jako lista
  // identyfikatorow.
  it("odpowiedzi na pola i zaakceptowane regulaminy jada w ladunku", async () => {
    rpc().setData("event_package_invite_accept", accepted);
    await api.acceptPackageInvite({
      ...accepting,
      answers: [
        { key: "sektor", value: "energia" },
        { key: "  ", value: "pominiete" },
        { key: "tematy", value: ["a", "b"] },
      ],
      acceptedTermIds: ["4e5f0000-0000-4000-8000-000000000903"],
      lang: "en",
    });

    const sent = payloadOf();
    expect(sent.answers).toEqual({ sektor: "energia", tematy: ["a", "b"] });
    expect(sent.accepted_term_ids).toEqual(["4e5f0000-0000-4000-8000-000000000903"]);
    expect(sent.lang).toBe("en");
  });

  // Marketing nie ma wartosci domyslnej tak samo jak zgoda RODO: nieoznaczony
  // jedzie jako jawne `false`, oznaczony - jako `true` (baza zapisze go
  // wylacznie zweryfikowanemu wlascicielowi adresu zaproszenia).
  it("zgoda marketingowa jedzie doslownie, nieoznaczona jako `false`", async () => {
    rpc().setData("event_package_invite_accept", accepted);
    await api.acceptPackageInvite({ ...accepting, consentMarketing: true });
    expect(payloadOf().consent_marketing).toBe(true);

    await api.acceptPackageInvite({ ...accepting, consentMarketing: undefined });
    expect(payloadOf().consent_marketing).toBe(false);
  });

  // Brak danej to brak klucza: `null` znaczylby „wyczysc" i skasowalby
  // stanowisko albo firme osobie, ktora ma juz karte w bazie.
  it("brak stanowiska i firmy NIE jedzie do bazy w zadnej postaci", async () => {
    rpc().setData("event_package_invite_accept", accepted);

    for (const empty of [undefined, null, ""]) {
      await api.acceptPackageInvite({ ...accepting, jobTitle: empty, companyText: empty });
      expect("job_title" in payloadOf()).toBe(false);
      expect("company_text" in payloadOf()).toBe(false);
    }
  });

  it("podane stanowisko i firma jada pod swoimi nazwami", async () => {
    rpc().setData("event_package_invite_accept", accepted);
    await api.acceptPackageInvite({
      ...accepting,
      jobTitle: "Dyrektorka ds. wspolpracy",
      companyText: "Instytut Studiow Europejskich",
    });

    const sent = payloadOf();
    expect(sent.job_title).toBe("Dyrektorka ds. wspolpracy");
    expect(sent.company_text).toBe("Instytut Studiow Europejskich");
  });

  // Zgoda RODO nie ma wartosci domyslnej. Klucz ma dojechac z wartoscia
  // `false`, a nie zniknac - baza odmawia (`consent_required`,
  // `20260827221214:596`) i o to wlasnie chodzi: brak zgody ma zatrzymac
  // zapis, a nie zostac dopisany w drodze.
  it("brak zgody jedzie jako `false`, nigdy jako brak klucza", async () => {
    rpc().setError(
      "event_package_invite_accept",
      "consent_required: consent to data processing is required",
    );

    await expect(
      api.acceptPackageInvite({ ...accepting, consentDataProcessing: false }),
    ).rejects.toThrow(/consent_required/);
    expect("consent_data_processing" in payloadOf()).toBe(true);
    expect(payloadOf().consent_data_processing).toBe(false);
  });
});

/* ---------------------------------------------------------- odpowiedz --- */

describe("acceptPackageInvite - odczyt odpowiedzi", () => {
  it("oddaje zgloszenie i OBA jednorazowe klucze", async () => {
    rpc().setData("event_package_invite_accept", accepted);

    const result = await api.acceptPackageInvite(accepting);
    expect(result).toEqual({
      registrationId: REGISTRATION_ID,
      eventId: EVENT_ID,
      eventSlug: "kongres-2026",
      status: "approved",
      awaitingPayment: false,
      qrToken: QR_TOKEN,
      manageToken: MANAGE_TOKEN,
      accountLinked: true,
    });
  });

  // TIX-07: pakiet jeszcze nieopłacony - zgłoszenie czeka, kodu wejścia nie ma.
  it.each([
    ["jawny znacznik bazy", { status: "pending", awaiting_payment: true }],
    ["sam status oczekujący", { status: "pending" }],
  ])(
    "miejsce z nieopłaconego pakietu czyta się jako „czeka na płatność” (%s)",
    async (_n, over) => {
      rpc().setData("event_package_invite_accept", {
        registration_id: REGISTRATION_ID,
        event_id: EVENT_ID,
        manage_token: MANAGE_TOKEN,
        ...over,
      });

      const result = await api.acceptPackageInvite(accepting);
      expect(result).toMatchObject({ status: "pending", awaitingPayment: true, qrToken: null });
    },
  );

  // Pusty kod to BRAK kodu. Napis pusty przepuszczony dalej narysowalby pusta
  // ramke kodu QR i przycisk samoobslugi prowadzacy donikad - a zapraszany nie
  // dowiedzialby sie, ze ma napisac do organizatora.
  it("pusty kod wejscia i pusty klucz samoobslugi czytaja sie jako brak", async () => {
    rpc().setData("event_package_invite_accept", {
      registration_id: REGISTRATION_ID,
      event_id: "",
      qr_token: "",
      manage_token: "   ",
    });

    const result = await api.acceptPackageInvite(accepting);
    expect(result.qrToken).toBeNull();
    expect(result.manageToken).toBeNull();
    expect(result.eventId).toBeNull();
    // Baza sprzed 20261012130000 przyjmowala od razu - brak statusu w
    // odpowiedzi czyta sie jako zatwierdzone, bez oczekiwania na platnosc.
    expect(result.status).toBe("approved");
    expect(result.awaitingPayment).toBe(false);
  });

  // Miejsce moglo zostac przypisane, ale bez identyfikatora nie umiemy go ani
  // pokazac, ani odwolac - modul mowi o tym wprost, zamiast rysowac pusty
  // sukces (`packageInviteApi.ts:92-97`).
  it.each([
    ["odpowiedz pusta", null],
    ["odpowiedz bez zgloszenia", { status: "approved", qr_token: QR_TOKEN }],
    ["odpowiedz z pustym zgloszeniem", { registration_id: "   " }],
    ["odpowiedz w zlym ksztalcie", [{ registration_id: REGISTRATION_ID }]],
  ])("%s konczy sie bledem, a nie ekranem „jestes zapisany”", async (_nazwa, data) => {
    rpc().setData("event_package_invite_accept", data);

    await expect(api.acceptPackageInvite(accepting)).rejects.toThrow(/not readable/);
  });

  it("odmowa bazy dojezdza w calosci - glowa komunikatu jest nosnikiem powodu", async () => {
    rpc().setError(
      "event_package_invite_accept",
      "seat_taken: this invitation has already been used",
    );

    await expect(api.acceptPackageInvite(accepting)).rejects.toThrow(/^seat_taken/);
  });
});

/* ------------------------------------------------------------ podglad --- */

describe("fetchPackageInvitePreview - podglad przed formularzem (REG-15)", () => {
  const preview = {
    ok: true,
    state: "open",
    event_id: EVENT_ID,
    event_slug: "kongres-2026",
    event_title_pl: "Kongres 2026",
    event_title_en: "Congress 2026",
    event_starts_at: "2026-11-20T09:00:00+00:00",
    invite_name: "Halina",
    invite_email_hint: "h***@example.com",
    account_matches: true,
    expires_at: null,
  };

  it("wola `event_package_invite_preview` z samym tokenem i czyta podglad", async () => {
    rpc().setData("event_package_invite_preview", preview);

    const result = await api.fetchPackageInvitePreview(TOKEN);
    expect(rpc().names()).toEqual(["event_package_invite_preview"]);
    expect(rpc().lastCall("event_package_invite_preview")?.args).toEqual({
      p_payload: { token: TOKEN },
    });
    expect(result).toEqual({
      state: "open",
      eventId: EVENT_ID,
      eventSlug: "kongres-2026",
      eventTitlePl: "Kongres 2026",
      eventTitleEn: "Congress 2026",
      eventStartsAt: "2026-11-20T09:00:00+00:00",
      inviteName: "Halina",
      inviteEmailHint: "h***@example.com",
      accountMatches: true,
      expiresAt: null,
    });
  });

  // Pelny adres zaproszenia nie jest czescia kontraktu - nawet gdyby baza go
  // kiedys oddala, modul go nie przenosi (posiadacz linku to nie zawsze
  // zaproszony).
  it("nie przenosi pelnego adresu, tylko zamaskowana podpowiedz", async () => {
    rpc().setData("event_package_invite_preview", {
      ...preview,
      invite_email: "halina@example.com",
    });

    const result = await api.fetchPackageInvitePreview(TOKEN);
    expect(JSON.stringify(result)).not.toContain("halina@example.com");
  });

  it("`account_matches` tylko doslowne `true` - inna wartosc to brak dopasowania", async () => {
    rpc().setData("event_package_invite_preview", { ...preview, account_matches: "true" });
    expect((await api.fetchPackageInvitePreview(TOKEN))?.accountMatches).toBe(false);
  });

  it("nieznany stan czyta sie jako `unavailable`, a nie jako `open`", async () => {
    rpc().setData("event_package_invite_preview", { ...preview, state: "half_open" });
    expect((await api.fetchPackageInvitePreview(TOKEN))?.state).toBe("unavailable");
  });

  it("pudlo tokenu wartoscia konczy sie wyjatkiem `invalid_token: ...`", async () => {
    rpc().setData("event_package_invite_preview", { ok: false, error: "invalid_token" });

    await expect(api.fetchPackageInvitePreview(TOKEN)).rejects.toThrow(/^invalid_token: /);
  });

  // Wdrozenie „najpierw kod": baza bez funkcji podgladu (PGRST202/42883) to
  // `null` - strona pokazuje sam formularz jak dotad. Kazdy inny blad leci dalej.
  it.each(["PGRST202", "42883"])("brak funkcji w bazie (%s) to `null`", async (code) => {
    rpc().setError("event_package_invite_preview", "function does not exist", code);
    await expect(api.fetchPackageInvitePreview(TOKEN)).resolves.toBeNull();
  });

  it("inny blad bazy nie jest polykany", async () => {
    rpc().setError("event_package_invite_preview", "rate_limited: too many invitation attempts");
    await expect(api.fetchPackageInvitePreview(TOKEN)).rejects.toThrow(/^rate_limited/);
  });
});

/* ------------------------------------------------------ token to sekret --- */

describe("token zaproszenia jest poswiadczeniem", () => {
  it("jedzie WYLACZNIE w polu `token`, w zadnym innym miejscu wywolania", async () => {
    rpc().setData("event_package_invite_accept", accepted);
    await api.acceptPackageInvite(accepting);

    const sent = payloadOf();
    expect(sent.token).toBe(TOKEN);
    const bezTokenu = { ...sent };
    delete bezTokenu.token;
    expect(JSON.stringify(bezTokenu)).not.toContain(TOKEN);
    // Nie doklejamy go do argumentow obok ladunku (np. do klucza cache).
    expect(rpc().lastCall("event_package_invite_accept")?.keys()).toEqual(["p_payload"]);
  });

  // Token trafia do logu raz i zostaje tam na zawsze - w konsoli przegladarki,
  // w zbieraczu bledow, w zrzucie od uzytkownika. Dlatego ani przebieg udany,
  // ani odmowa nie moga nic o nim powiedziec.
  it("nie jest logowany ani po sukcesie, ani po odmowie", async () => {
    const wyjscie: unknown[] = [];
    const kanaly = ["log", "info", "warn", "error", "debug"] as const;
    const szpiedzy = kanaly.map((kanal) =>
      vi.spyOn(console, kanal).mockImplementation((...args: unknown[]) => {
        wyjscie.push(...args);
      }),
    );

    try {
      rpc().setData("event_package_invite_accept", accepted);
      await api.acceptPackageInvite(accepting);

      rpc().setError("event_package_invite_accept", "invalid_token: the invitation is not valid");
      await expect(api.acceptPackageInvite(accepting)).rejects.toThrow(/invalid_token/);
    } finally {
      for (const szpieg of szpiedzy) szpieg.mockRestore();
    }

    expect(wyjscie).toEqual([]);
    expect(JSON.stringify(wyjscie)).not.toContain(TOKEN);
  });

  // Fixture ma byc WIERNY, inaczej caly plik dowodzi czegos o napisie, ktory
  // nigdy nie przeszedlby przez trase zaproszenia. Token jest syntetyczny:
  // 64 znaki szesnastkowe w ksztalcie `event_package_seat_invite()`, ulozone
  // recznie na potrzeby tego pliku - nie pochodzi z zadnego srodowiska.
  it("token fixture'u przechodzi walidacje ksztaltu tego samego modulu", () => {
    expect(api.readPackageInviteToken(TOKEN)).toBe(TOKEN);
    expect(TOKEN).toHaveLength(64);
    expect(TOKEN).toMatch(/^[0-9a-f]{64}$/);
  });
});
