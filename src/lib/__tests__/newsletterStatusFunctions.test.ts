// Status WŁASNEJ subskrypcji newslettera - odczyt i dopisanie tematów.
//
// PO CO. Formularz zapisu pokazywał to samo wszystkim, także osobom już
// zapisanym: użytkownik podawał adres drugi raz, dostawał „już zapisany" i nie
// wiedział, na jaką listę ani z jakimi tematami figuruje. Te dwie funkcje są
// odpowiedzią - i obie dotykają CUDZYCH danych kontaktowych, więc mają jedną
// regułę nadrzędną: tożsamość bierze się z TOKENU SESJI, nigdy z ładunku
// żądania. Test pilnuje właśnie tego, bo pomyłka w tym miejscu nie wywala się
// głośno: po prostu oddaje (albo nadpisuje) subskrypcję innej osoby.
//
// Druga konsekwencja, którą tu przybijamy, jest po stronie zapisu: dopisanie
// tematów SCALA się z tym, co już jest. Nadpisanie skasowałoby wybory zrobione
// wcześniej na innym urządzeniu - użytkownik przestałby dostawać treści, na
// które się zgodził, i nie dowiedziałby się o tym.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Atrapa `createServerFn` nie
// uruchamia middleware, więc zieleń mówi o logice handlera, a nie o tym, kto
// ma prawo go wywołać. Deklarację bramki `requireSupabaseAuth` przybijamy
// strukturalnie, a odmowę „przed zapytaniem" - tam, gdzie da się ją wywołać
// naprawdę: sesją bez adresu e-mail w tokenie.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  resolveTenantIdForHost: vi.fn(),
  currentTenantHost: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: h.resolveTenantIdForHost,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: h.currentTenantHost }));

import {
  getMyNewsletterStatus,
  updateMyNewsletterTopics,
  type MyNewsletterStatus,
} from "@/lib/newsletter-status.functions";

const db = supabaseFromStub();
const SUBSCRIBERS = "newsletter_subscribers";
const TENANT = "tenant-1";

/** Kontekst, jaki middleware uwierzytelniające wstrzykuje handlerowi. */
function sesja(email: unknown = "Anna.Nowak@Example.Test") {
  return { supabase: { from: db.from }, claims: { email } };
}

/** Wiersz subskrybenta w kształcie czytanym przez handler. */
function wiersz(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1",
    status: "subscribed",
    email: "anna.nowak@example.test",
    source_form_name: "Formularz w stopce",
    meta: { interests: "energia, klimat", mailing_lists: "Analizy,Zaproszenia" },
    created_at: "2026-01-05T08:00:00.000Z",
    confirmed_at: "2026-01-06T09:30:00.000Z",
    ...overrides,
  };
}

/** Wszystkie ogniwa `eq` ostatniego łańcucha - filtry, po których poszedł odczyt. */
function filtry(chain: RecordedChain | undefined): unknown[][] {
  return (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => [...c.args]);
}

const PUSTY: MyNewsletterStatus = {
  subscribed: false,
  status: null,
  email: "anna.nowak@example.test",
  listName: null,
  mailingLists: [],
  topics: [],
  since: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
    chain.has("update") ? ok(null) : ok(wiersz()),
  );
  h.currentTenantHost.mockResolvedValue("nes.example.test");
  h.resolveTenantIdForHost.mockResolvedValue(TENANT);
});

describe("obudowa - kto może pytać o cudzą subskrypcję", () => {
  it("obie funkcje wymagają uwierzytelnionej sesji", () => {
    // Dowód STRUKTURALNY: harness nie uruchamia middleware, więc zieleń
    // pozostałych testów mówi o logice handlera, a nie o dostępie. Gdyby ta
    // deklaracja zniknęła, adres e-mail dowolnego subskrybenta dałoby się
    // odczytać bez sesji.
    expect(serverFnMiddlewareNames(getMyNewsletterStatus)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(updateMyNewsletterTopics)).toEqual(["requireSupabaseAuth"]);
  });
});

describe("odczyt własnego statusu", () => {
  it("adres bierze się z TOKENU, znormalizowany - i tylko po nim idzie zapytanie", async () => {
    // Gdyby zapytanie szło po adresie z ładunku żądania, każdy zalogowany
    // odczytałby subskrypcję dowolnej osoby, znając jej adres.
    await callServerFn(getMyNewsletterStatus, { context: sesja("  Anna.Nowak@Example.Test  ") });

    expect(filtry(db.lastChain(SUBSCRIBERS))).toEqual([
      ["tenant_id", TENANT],
      ["email", "anna.nowak@example.test"],
    ]);
  });

  it("zapisany subskrybent dostaje listę, tematy i datę zapisu", async () => {
    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res).toEqual({
      subscribed: true,
      status: "subscribed",
      email: "anna.nowak@example.test",
      listName: "Formularz w stopce",
      mailingLists: ["Analizy", "Zaproszenia"],
      topics: ["energia", "klimat"],
      since: "2026-01-06T09:30:00.000Z",
    });
  });

  it("zapis niepotwierdzony liczy się jako „jesteś na liście”", async () => {
    // Formularz ma pokazać „potwierdź adres", a nie zaprosić do zapisu po raz
    // drugi - drugi zapis wysyła kolejnego maila potwierdzającego.
    db.setResponse(SUBSCRIBERS, ok(wiersz({ status: "pending", confirmed_at: null })));

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res.subscribed).toBe(true);
    expect(res.status).toBe("pending");
    // Bez daty potwierdzenia liczy się data zapisu - inaczej „od kiedy" byłoby puste.
    expect(res.since).toBe("2026-01-05T08:00:00.000Z");
  });

  it("osoba wypisana NIE jest liczona jako zapisana, ale jej stan jest widoczny", async () => {
    // To jest różnica między „zapisz się" a „wróć na listę" - i między nimi
    // stoi zgoda, której nie wolno odtworzyć po cichu.
    db.setResponse(SUBSCRIBERS, ok(wiersz({ status: "unsubscribed" })));

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res.subscribed).toBe(false);
    expect(res.status).toBe("unsubscribed");
  });

  it("wiersz bez żadnej daty nie wymyśla „od kiedy”", async () => {
    // Import z pliku bywa bez znacznika czasu. Podstawienie „dziś" na ekranie
    // byłoby zmyśleniem daty zgody.
    db.setResponse(SUBSCRIBERS, ok(wiersz({ confirmed_at: null, created_at: null })));

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res.since).toBeNull();
  });

  it("brak wiersza to zwykły stan „jeszcze nie zapisany”, nie awaria", async () => {
    db.setResponse(SUBSCRIBERS, ok(null));

    expect(await callServerFn(getMyNewsletterStatus, { context: sesja() })).toEqual(PUSTY);
  });

  it("nierozstrzygnięty najemca kończy odczyt PRZED pytaniem o subskrybenta", async () => {
    // Odczyt bez najemcy musiałby albo pytać cross-tenant, albo zgadywać -
    // obie odpowiedzi byłyby cudzymi danymi.
    h.resolveTenantIdForHost.mockResolvedValue(null);

    expect(await callServerFn(getMyNewsletterStatus, { context: sesja() })).toEqual(PUSTY);
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it.each([
    ["token bez adresu", undefined],
    ["adres pusty", "   "],
    ["brak sekcji claims", null],
  ])("sesja bez adresu (%s) NIE pyta bazy o nic", async (_nazwa, email) => {
    // Odmowa PRZED zapytaniem: bez adresu nie ma czego szukać, a zapytanie
    // „po pustym adresie" trafiłoby w losowy wiersz z pustą kolumną.
    const context =
      email === null
        ? { supabase: { from: db.from } }
        : { supabase: { from: db.from }, claims: { email } };

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, { context });

    expect(res.email).toBeNull();
    expect(res.subscribed).toBe(false);
    expect(db.chains).toHaveLength(0);
  });

  it("status pusty w bazie czyta się jako brak statusu, nie jako napis „null”", async () => {
    db.setResponse(SUBSCRIBERS, ok(wiersz({ status: null, source_form_name: null })));

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res.status).toBeNull();
    expect(res.listName).toBeNull();
    expect(res.subscribed).toBe(false);
  });

  it.each([
    ["puste pola i podwójne przecinki", " energia , , klimat ,", ["energia", "klimat"]],
    ["jeden temat", "energia", ["energia"]],
    ["sam przecinek", ",,,", []],
    ["pusty napis", "", []],
  ])(
    "lista tematów zapisana jako tekst (%s) rozkłada się na pozycje",
    async (_nazwa, zapisane, oczekiwane) => {
      db.setResponse(SUBSCRIBERS, ok(wiersz({ meta: { interests: zapisane } })));

      const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
        context: sesja(),
      });

      expect(res.topics).toEqual(oczekiwane);
    },
  );

  it.each([
    ["meta jako liczba w kolumnie", { interests: 42, mailing_lists: ["nie", "tekst"] }],
    ["meta puste", null],
    ["meta bez znanych kluczy", { cokolwiek: "x" }],
  ])("uszkodzone `meta` (%s) daje puste listy, a nie wyjątek na ekranie", async (_nazwa, meta) => {
    db.setResponse(SUBSCRIBERS, ok(wiersz({ meta })));

    const res = await callServerFn<MyNewsletterStatus>(getMyNewsletterStatus, {
      context: sesja(),
    });

    expect(res.topics).toEqual([]);
    expect(res.mailingLists).toEqual([]);
  });
});

describe("dopisanie tematów do własnej subskrypcji", () => {
  it("nowe tematy SCALAJĄ się z zapisanymi, bez duplikatów", async () => {
    // Nadpisanie skasowałoby wybory zrobione wcześniej na innym urządzeniu -
    // użytkownik przestałby dostawać treści, na które się zgodził.
    const res = await callServerFn<{ ok: boolean }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat", "handel"], mailingLists: ["Analizy", "Wydarzenia"] },
      context: sesja(),
    });

    expect(res).toEqual({ ok: true });
    const meta = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
      updated_at: string;
    };
    expect(meta.meta.interests).toBe("energia, klimat, handel");
    expect(meta.meta.mailing_lists).toBe("Analizy,Zaproszenia,Wydarzenia");
    expect(typeof meta.updated_at).toBe("string");
  });

  it("zapis idzie po IDENTYFIKATORZE odczytanego wiersza, nie po adresie z żądania", async () => {
    await callServerFn(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    expect(filtry(db.lastChain(SUBSCRIBERS))).toEqual([["id", "sub-1"]]);
  });

  it("brak nowych list NIE kasuje list już zapisanych", async () => {
    await callServerFn(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(payload.meta.mailing_lists).toBe("Analizy,Zaproszenia");
  });

  it("subskrybent bez żadnych list nie dostaje pustego klucza w `meta`", async () => {
    // Pusty napis w `mailing_lists` czytałby się później jako lista o nazwie "".
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
      chain.has("update") ? ok(null) : ok(wiersz({ meta: { interests: "energia" } })),
    );

    await callServerFn(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(payload.meta.mailing_lists).toBeUndefined();
  });

  it("nietekstowe pola `meta` nie są przepisywane do zapisu", async () => {
    // Kolumna `jsonb` przyjmie wszystko; przepisanie liczby albo obiektu do
    // scalonego `meta` utrwaliłoby śmieć, którego odczyt potem nie rozumie.
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
      chain.has("update")
        ? ok(null)
        : ok(wiersz({ meta: { interests: "energia", licznik: 7, obiekt: { a: 1 } } })),
    );

    await callServerFn(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(Object.keys(payload.meta)).toEqual(["interests"]);
  });

  it("subskrybent bez `meta` w bazie dostaje pierwsze tematy, a nie wyjątek", async () => {
    // Wiersze sprzed wprowadzenia tematów mają w tej kolumnie NULL.
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
      chain.has("update") ? ok(null) : ok(wiersz({ meta: null })),
    );

    const res = await callServerFn<{ ok: boolean }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat"], mailingLists: ["Analizy"] },
      context: sesja(),
    });

    expect(res).toEqual({ ok: true });
    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(payload.meta).toEqual({ interests: "klimat", mailing_lists: "Analizy" });
  });

  it("bardzo długa lista tematów jest przycinana, a nie odrzucana przy zapisie", async () => {
    // Kolumna ma granicę; przekroczenie jej zwróciłoby błąd bazy po stronie
    // użytkownika, który po prostu zaznaczył wszystkie tematy.
    const topics = Array.from({ length: 60 }, (_, i) => `t${i}`.padEnd(120, "x"));

    await callServerFn(updateMyNewsletterTopics, { data: { topics }, context: sesja() });

    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(payload.meta.interests).toHaveLength(1000);
  });

  it("sesja bez adresu odmawia PRZED jakimkolwiek zapytaniem", async () => {
    const res = await callServerFn<{ ok: boolean; error?: string }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: { supabase: { from: db.from }, claims: {} },
    });

    expect(res).toEqual({ ok: false, error: "no_email" });
    expect(db.chains).toHaveLength(0);
  });

  it("nierozstrzygnięty najemca odmawia zapisu i nie dotyka listy", async () => {
    h.resolveTenantIdForHost.mockResolvedValue(null);

    const res = await callServerFn<{ ok: boolean; error?: string }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    expect(res).toEqual({ ok: false, error: "not_configured" });
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("osoba spoza listy nie zakłada sobie subskrypcji tą drogą", async () => {
    // Ta funkcja DOPISUJE tematy; założenie zapisu wymaga zgody, którą zbiera
    // publiczny formularz z potwierdzeniem adresu.
    db.setResponse(SUBSCRIBERS, ok(null));

    const res = await callServerFn<{ ok: boolean; error?: string }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    expect(res).toEqual({ ok: false, error: "not_subscribed" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
  });

  it("nieudany zapis wraca jako czytelny błąd, a nie jako ciche „zapisano”", async () => {
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
      chain.has("update") ? fail("update denied") : ok(wiersz()),
    );

    const res = await callServerFn<{ ok: boolean; error?: string }>(updateMyNewsletterTopics, {
      data: { topics: ["klimat"] },
      context: sesja(),
    });

    expect(res).toEqual({ ok: false, error: "update denied" });
  });

  it("puste wejście jest poprawne - scala się z tym, co już jest", async () => {
    await callServerFn(updateMyNewsletterTopics, { data: {}, context: sesja() });

    const payload = db.lastChain(SUBSCRIBERS)?.argsOf("update")?.[0] as {
      meta: Record<string, string>;
    };
    expect(payload.meta.interests).toBe("energia, klimat");
  });

  it.each([
    ["temat dłuższy niż limit kolumny", { topics: ["x".repeat(121)] }],
    ["pusty temat", { topics: [""] }],
    ["więcej tematów, niż wolno", { topics: Array.from({ length: 61 }, (_, i) => `t${i}`) }],
    ["więcej list, niż wolno", { mailingLists: Array.from({ length: 31 }, (_, i) => `l${i}`) }],
    ["tematy podane jako napis", { topics: "energia" }],
  ])("walidator odrzuca %s - i nic nie leci do bazy", async (_nazwa, payload) => {
    await expect(
      callServerFn(updateMyNewsletterTopics, { data: payload, context: sesja() }),
    ).rejects.toThrow();
    expect(db.chains).toHaveLength(0);
  });
});
