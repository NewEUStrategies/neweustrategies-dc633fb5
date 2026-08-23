// FUNKCJA SERWEROWA PODGLĄDU MAILI TRANSAKCYJNYCH
// (`src/lib/tx-email-preview.functions.ts`): 25 linii, jedna funkcja, ZERO
// wykonanych linii przed tym plikiem.
//
// CO TA FUNKCJA NAPRAWDĘ ROBI. Jest cienkim wrapperem, ale ten wrapper trzyma
// trzy rzeczy, których nie trzyma nikt inny: (1) BRAMKĘ UPRAWNIEŃ - podgląd
// pokazuje pełną treść maili razem z nadpisaniami redakcyjnymi, więc jest
// funkcją wyłącznie dla administratora; (2) WALIDATOR - jedyne miejsce, w
// którym parametry z adresu URL panelu zamieniają się w wartości bezpieczne
// dla renderu; (3) SKLEJENIE nadpisań z renderem - jeśli podgląd nie wczyta
// nadpisań, redakcja edytuje treść „w ciemno".
//
// CZEGO TEN HARNESS NIE UDAJE. `@/test/serverFnHarness` NIE uruchamia
// middleware (patrz nagłówek harnessu), więc nie da się tu odegrać odmowy dla
// nie-administratora. Dlatego bramka jest sprawdzana STRUKTURALNIE
// (`serverFnMiddlewareNames`), a drugą połowę dowodu - że renderowanie
// podglądu w ogóle nie sięga po dane subskrybentów, więc obejście bramki nie
// jest wyciekiem - niesie `src/lib/email/__tests__/tx-preview.server.test.ts`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJEMY. Renderowanie 22 szablonów w dwóch językach
// ma własny, pełny test (100% linii i gałęzi `tx-preview.server.ts`). Tutaj
// warstwa renderu jest atrapą, bo dowodzimy CZEGO INNEGO: jakie DOKŁADNIE
// argumenty wrapper jej podaje. Parsowanie nadpisań (`parseTxOverrides`) ma
// test w `src/lib/email/__tests__/txOverrides.test.ts`, a odczyt z bazy -
// w `txOverrides.server.test.ts`; tutaj jest użyty PRAWDZIWY `loadTxOverrides`,
// żeby dowieść, że wrapper korzysta z jego fail-softu, a nie własnej ścieżki.
//
// ROZSTRZYGNIĘCIE i18n. Ta funkcja nie generuje żadnego tekstu dla człowieka -
// przyjmuje kod języka (`"pl" | "en"`) i przekazuje go do szablonów, które
// mają własne słowniki PL/EN (uzasadnienie w
// `src/lib/email-templates/__tests__/txCopy.test.ts`). Asercje dotyczą więc
// PRZEŁĄCZNIKA JĘZYKA, nie kluczy i18n.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import type { TxEmailPreview } from "@/lib/email/tx-preview.server";
import { TX_OVERRIDES_DEFAULTS, TxOverridesSchema } from "@/lib/email/txOverrides";

const h = vi.hoisted(() => ({
  /** Argumenty, z jakimi wrapper wywołał warstwę renderu. */
  wywolania: [] as { lang: string; firstName: string | null; gender: string; overrides: unknown }[],
  /** Podglądy, jakie warstwa renderu ma oddać. */
  wynik: [] as unknown[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));

vi.mock("@/lib/email/tx-preview.server", () => ({
  renderAllTxEmailPreviews: (
    lang: string,
    firstName: string | null,
    gender: string,
    overrides: unknown,
  ) => {
    h.wywolania.push({ lang, firstName, gender, overrides });
    return Promise.resolve(h.wynik);
  },
}));

import { getTxEmailPreviews } from "@/lib/tx-email-preview.functions";

const db = supabaseFromStub();
const kontekst = () => ({ supabase: { from: db.from } });

/** Jeden podgląd w kształcie, jaki panel dostaje z serwera. */
const podglad = (type: string, lang: "pl" | "en"): TxEmailPreview => ({
  type: "newsletter_confirmed",
  lang,
  subject: `temat ${type}`,
  preview: "preheader",
  html: "<p>treść</p>",
  text: "treść",
});

beforeEach(() => {
  db.reset();
  h.wywolania = [];
  h.wynik = [];
});

describe("getTxEmailPreviews - obudowa funkcji serwerowej", () => {
  it("podgląd jest zamknięty za rolą administratora", () => {
    // Harness nie uruchamia middleware, więc to JEDYNE miejsce, w którym da
    // się dowieść, że bramka w ogóle istnieje. Jej usunięcie otwiera pełną
    // treść maili razem z nadpisaniami redakcyjnymi każdemu zalogowanemu.
    const nazwy = serverFnMiddlewareNames(getTxEmailPreviews);

    expect(nazwy).toContain("requireAdmin");
    expect(nazwy).toHaveLength(1);
  });

  it("podgląd jest odczytem, więc deklaruje metodę GET", () => {
    const metoda = Reflect.get(getTxEmailPreviews as object, "method");

    expect(metoda).toBe("GET");
    expect(typeof metoda).toBe("string");
  });
});

describe("getTxEmailPreviews - walidator wejścia", () => {
  it("brak parametrów daje komplet wartości domyślnych", () => {
    // Panel wchodzi na stronę podglądu bez parametrów w URL-u. Gdyby walidator
    // nie miał domyślnych, pierwsze wejście kończyłoby się błędem 500.
    const dane = validateServerFnInput<{ lang: string; firstName: string | null; gender: string }>(
      getTxEmailPreviews,
      undefined,
    );

    expect(dane).toEqual({ lang: "pl", firstName: "Marek", gender: "unknown" });
    expect(dane.lang).toBe("pl");
  });

  it("pusty obiekt jest równoważny brakowi parametrów", () => {
    const zPustego = validateServerFnInput(getTxEmailPreviews, {});
    const zBraku = validateServerFnInput(getTxEmailPreviews, undefined);

    expect(zPustego).toEqual(zBraku);
    expect(zPustego).toBeDefined();
  });

  it("komplet poprawnych parametrów przechodzi bez zmiany", () => {
    const dane = validateServerFnInput(getTxEmailPreviews, {
      lang: "en",
      firstName: "Anna",
      gender: "female",
    });

    expect(dane).toEqual({ lang: "en", firstName: "Anna", gender: "female" });
    expect(dane).not.toBe(null);
  });

  it("nieobsługiwany język jest ODRZUCANY, nie cicho zamieniany na polski", () => {
    // Cicha zamiana wyglądałaby w panelu jak działający podgląd niemieckiego
    // maila - a takiego szablonu nie ma i nigdy nie było.
    expect(() => validateServerFnInput(getTxEmailPreviews, { lang: "de" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getTxEmailPreviews, { lang: "PL" })).toThrow(ZodError);
  });

  it("nieznany rodzaj gramatyczny jest odrzucany", () => {
    expect(() => validateServerFnInput(getTxEmailPreviews, { gender: "other" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getTxEmailPreviews, { gender: 1 })).toThrow(ZodError);
  });

  it("imię dłuższe niż 60 znaków jest odrzucane, bo rozbija powitanie", () => {
    const zaDlugie = "a".repeat(61);

    expect(() => validateServerFnInput(getTxEmailPreviews, { firstName: zaDlugie })).toThrow(
      ZodError,
    );
    expect(validateServerFnInput(getTxEmailPreviews, { firstName: "a".repeat(60) })).toEqual({
      lang: "pl",
      firstName: "a".repeat(60),
      gender: "unknown",
    });
  });

  it("jawny brak imienia jest dozwolony - podgląd bez personalizacji jest legalny", () => {
    const dane = validateServerFnInput<{ firstName: string | null }>(getTxEmailPreviews, {
      firstName: null,
    });

    expect(dane.firstName).toBeNull();
    expect(() => validateServerFnInput(getTxEmailPreviews, { firstName: 42 })).toThrow(ZodError);
  });
});

describe("getTxEmailPreviews - ścieżka szczęśliwa", () => {
  it("wczytuje nadpisania redakcyjne i podaje je do renderu razem z parametrami", async () => {
    const zapisane = { team_seat_grace: { pl: { heading: "Własny nagłówek" } } };
    db.setResponse("site_settings", ok({ value: zapisane }));
    h.wynik = [podglad("newsletter_confirmed", "en")];

    const wynik = await callServerFn<TxEmailPreview[]>(getTxEmailPreviews, {
      data: { lang: "en", firstName: "Anna", gender: "female" },
      context: kontekst(),
    });

    expect(h.wywolania).toHaveLength(1);
    expect(h.wywolania[0]).toMatchObject({ lang: "en", firstName: "Anna", gender: "female" });
    expect(h.wywolania[0]?.overrides).toEqual(TxOverridesSchema.parse(zapisane));
    expect(wynik).toHaveLength(1);
  });

  it("pyta o nadpisania dokładnie raz i tylko o tabelę ustawień", async () => {
    // Podgląd nie ma prawa czytać niczego innego: gdyby sięgnął po dane
    // subskrybenta, panel stałby się kanałem wycieku danych osobowych.
    db.setResponse("site_settings", ok({ value: {} }));

    await callServerFn(getTxEmailPreviews, { data: {}, context: kontekst() });

    expect(db.chains.map((c) => c.table)).toEqual(["site_settings"]);
    expect(db.lastChain("site_settings")?.argsOf("eq")).toEqual(["key", "tx_email_overrides"]);
  });

  it("oddaje panelowi dokładnie to, co zwróciła warstwa renderu", async () => {
    db.setResponse("site_settings", ok({ value: {} }));
    h.wynik = [podglad("a", "pl"), podglad("b", "pl")];

    const wynik = await callServerFn<TxEmailPreview[]>(getTxEmailPreviews, {
      data: {},
      context: kontekst(),
    });

    expect(wynik).toHaveLength(2);
    expect(wynik[0]?.subject).toBe("temat a");
  });

  it("domyślne parametry docierają do renderu, a nie gubią się w walidatorze", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    await callServerFn(getTxEmailPreviews, { data: undefined, context: kontekst() });

    expect(h.wywolania[0]).toMatchObject({ lang: "pl", firstName: "Marek", gender: "unknown" });
    expect(h.wywolania).toHaveLength(1);
  });
});

describe("getTxEmailPreviews - awaria odczytu i pusta odpowiedź", () => {
  it("błąd odczytu nadpisań NIE gasi podglądu - wraca treść domyślna", async () => {
    // Panel redakcyjny musi się otworzyć nawet wtedy, gdy tabela ustawień jest
    // niedostępna. Pusty ekran zamiast podglądu blokuje pracę nad treścią maili.
    db.setResponse("site_settings", fail("permission denied", "42501"));
    h.wynik = [podglad("a", "pl")];

    const wynik = await callServerFn<TxEmailPreview[]>(getTxEmailPreviews, {
      data: {},
      context: kontekst(),
    });

    expect(h.wywolania[0]?.overrides).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(wynik).toHaveLength(1);
  });

  it("brak wiersza ustawień to stan normalny, nie awaria", async () => {
    db.setResponse("site_settings", ok(null));

    await callServerFn(getTxEmailPreviews, { data: {}, context: kontekst() });

    expect(h.wywolania[0]?.overrides).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(db.chainsFor("site_settings")).toHaveLength(1);
  });

  it("zepsuty kształt zapisanych nadpisań nie wycieka do maila", async () => {
    db.setResponse("site_settings", ok({ value: "to nie jest obiekt nadpisań" }));

    await callServerFn(getTxEmailPreviews, { data: {}, context: kontekst() });

    expect(h.wywolania[0]?.overrides).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(h.wywolania).toHaveLength(1);
  });

  it("wyjątek z klienta bazy też sprowadza się do treści domyślnych", async () => {
    const wybuchowy = {
      supabase: {
        from: () => {
          throw new Error("klient nieosiągalny");
        },
      },
    };
    h.wynik = [podglad("a", "pl")];

    const wynik = await callServerFn<TxEmailPreview[]>(getTxEmailPreviews, {
      data: {},
      context: wybuchowy,
    });

    expect(h.wywolania[0]?.overrides).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(wynik).toHaveLength(1);
  });

  it("pusta odpowiedź renderu przechodzi do panelu jako pusta lista, nie null", async () => {
    // Panel iteruje po wyniku; `null` zamiast listy wywróciłby cały widok.
    db.setResponse("site_settings", ok({ value: {} }));
    h.wynik = [];

    const wynik = await callServerFn<TxEmailPreview[]>(getTxEmailPreviews, {
      data: {},
      context: kontekst(),
    });

    expect(wynik).toEqual([]);
    expect(Array.isArray(wynik)).toBe(true);
  });
});
