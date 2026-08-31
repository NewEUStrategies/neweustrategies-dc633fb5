// Obudowa server fn PORTALU KLIENTA I FAKTUR (`portalLink.functions.ts`) -
// 85 linii, 0% pokrycia do 31.08.2026 (0 z 8 funkcji).
//
// PO CO TEN PLIK ISTNIEJE. Implementacje (`portalLink.server.ts`,
// `invoice.server.ts`) mają własne testy. Nieprzetestowane było opakowanie,
// a siedzą w nim trzy rzeczy, których nie widać z żadnej innej warstwy:
//
//   1. SKĄD BIERZE SIĘ TOŻSAMOŚĆ. `sendMyPortalLink` i
//      `fetchMyInvoiceByTransaction` biorą `userId` z KONTEKSTU (token sesji),
//      a `resendPortalLinkForUser` z ŁADUNKU (bo administrator działa za kogoś).
//      Pomyłka w tym miejscu nie wywala się głośno: po prostu wysyła link do
//      cudzego portalu płatności albo oddaje cudzą fakturę.
//   2. WZORZEC NUMERU TRANSAKCJI. Walidator przycina białe znaki (użytkownik
//      wkleja z maila), NIE zmienia wielkości liter (identyfikatory operatora
//      są na nią wrażliwe) i sprawdza wzorzec. To jedyna bramka między polem
//      tekstowym w profilu a odpytywaniem operatora o cudzy dokument.
//   3. ZIARNO IDEMPOTENCJI. Użytkownik dostaje ziarno „co 10 minut" (podwójne
//      kliknięcie nie wysyła dwóch maili), administrator - unikalne przy każdym
//      kliknięciu (świadome ponowienie ma dać świeży link). Te dwie reguły są
//      przeciwstawne i mieszkają WYŁĄCZNIE tutaj.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc podział bramek (`requireSupabaseAuth` dla użytkownika,
// `requireAdminEditor` dla panelu) przybijamy STRUKTURALNIE.
//
// Atrapy stoją na GRANICACH: poczta z linkiem do portalu i odczyt faktury
// u operatora. `@/lib/billing/transactionId` (normalizacja i wzorzec) biegnie
// PRAWDZIWY - to jego zachowanie jest przedmiotem dowodu.
//
// RODO: żadnych prawdziwych danych osobowych; identyfikatory są zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  sendPortalLinkEmail: vi.fn(),
  invoiceUrlForTransaction: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));
vi.mock("@/lib/billing/portalLink.server", () => ({
  sendPortalLinkEmail: h.sendPortalLinkEmail,
}));
vi.mock("@/lib/billing/invoice.server", () => ({
  invoiceUrlForTransaction: h.invoiceUrlForTransaction,
}));

import {
  fetchInvoiceByTransactionAsAdmin,
  fetchMyInvoiceByTransaction,
  resendPortalLinkForUser,
  sendMyPortalLink,
} from "@/lib/billing/portalLink.functions";

/** Właściciel sesji - tożsamość z tokenu, nigdy z ładunku. */
const WLASCICIEL_SESJI = "11111111-1111-4111-8111-111111111111";
/** Cudzy użytkownik - administrator podaje go świadomie w ładunku. */
const INNY_UZYTKOWNIK = "22222222-2222-4222-8222-222222222222";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const WYNIK_MAILA = { marker: "wynik-wysylki" };
const WYNIK_FAKTURY = { marker: "wynik-faktury" };

/** Numer transakcji o kształcie, który wzorzec przyjmuje. */
const NUMER_PLATNOSCI = "pi_3AbCdEfGhIjKlMnO";

/** Kształty oddawane przez schematy wejścia. */
interface WejscieSrodowiska {
  environment: "sandbox" | "live";
}
interface WejscieUzytkownika extends WejscieSrodowiska {
  userId: string;
}
interface WejscieTransakcji extends WejscieSrodowiska {
  transactionId: string;
}

/** Argumenty ostatniego wywołania wysyłki maila z linkiem do portalu. */
function ostatniMail(): { userId: string; environment: string; idempotencySeed: string } {
  const args = h.sendPortalLinkEmail.mock.calls.at(-1)?.[0];
  if (
    typeof args !== "object" ||
    args === null ||
    typeof Reflect.get(args, "userId") !== "string" ||
    typeof Reflect.get(args, "environment") !== "string" ||
    typeof Reflect.get(args, "idempotencySeed") !== "string"
  ) {
    throw new Error("test: wysyłka linku nie dostała kompletnego ładunku");
  }
  return {
    userId: String(Reflect.get(args, "userId")),
    environment: String(Reflect.get(args, "environment")),
    idempotencySeed: String(Reflect.get(args, "idempotencySeed")),
  };
}

function kontekst() {
  return { supabase: { marker: "klient-z-kontekstu" }, userId: WLASCICIEL_SESJI };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sendPortalLinkEmail.mockResolvedValue(WYNIK_MAILA);
  h.invoiceUrlForTransaction.mockResolvedValue(WYNIK_FAKTURY);
});

describe("obudowa - podział bramek", () => {
  it("funkcje „moje” pilnuje uwierzytelnienie, funkcje panelu - rola admin/editor", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Ten podział jest
    // istotą modułu - `resendPortalLinkForUser` i
    // `fetchInvoiceByTransactionAsAdmin` działają NA CUDZYCH danych
    // (wysyłają maila komuś innemu, pomijają kontrolę własności transakcji),
    // więc zejście ich bramki do samego `requireSupabaseAuth` oddałoby te
    // operacje każdemu zalogowanemu.
    expect(serverFnMiddlewareNames(sendMyPortalLink)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(fetchMyInvoiceByTransaction)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(resendPortalLinkForUser)).toEqual(["requireAdminEditor"]);
    expect(serverFnMiddlewareNames(fetchInvoiceByTransactionAsAdmin)).toEqual([
      "requireAdminEditor",
    ]);
  });

  it("wszystkie cztery idą metodą POST", () => {
    // Numer transakcji nie ma prawa wylądować w adresie (logi serwera,
    // historia przeglądarki, nagłówek `Referer`) - to identyfikator, po którym
    // odpytuje się operatora o dokument rozliczeniowy.
    expect(asServerFn(sendMyPortalLink).method).toBe("POST");
    expect(asServerFn(resendPortalLinkForUser).method).toBe("POST");
    expect(asServerFn(fetchMyInvoiceByTransaction).method).toBe("POST");
    expect(asServerFn(fetchInvoiceByTransactionAsAdmin).method).toBe("POST");
  });
});

describe("walidator - środowisko operatora", () => {
  it("obie wartości enuma przechodzą", () => {
    expect(
      validateServerFnInput<WejscieSrodowiska>(sendMyPortalLink, { environment: "sandbox" }),
    ).toEqual({ environment: "sandbox" });
    expect(
      validateServerFnInput<WejscieSrodowiska>(sendMyPortalLink, { environment: "live" }),
    ).toEqual({ environment: "live" });
  });

  it("wartość spoza enuma jest ODRZUCANA we WSZYSTKICH czterech funkcjach", () => {
    // Środowisko wybiera klucz API operatora. Pomyłka tutaj oznacza szukanie
    // prawdziwej faktury na koncie testowym (wynik: „nie znaleziono"
    // przy dokumencie, który istnieje) albo odwrotnie.
    for (const zle of ["prod", "production", "LIVE", " live", "", "test"]) {
      expect(() => validateServerFnInput(sendMyPortalLink, { environment: zle })).toThrow(ZodError);
      expect(() =>
        validateServerFnInput(resendPortalLinkForUser, {
          userId: INNY_UZYTKOWNIK,
          environment: zle,
        }),
      ).toThrow(ZodError);
      expect(() =>
        validateServerFnInput(fetchMyInvoiceByTransaction, {
          transactionId: NUMER_PLATNOSCI,
          environment: zle,
        }),
      ).toThrow(ZodError);
      expect(() =>
        validateServerFnInput(fetchInvoiceByTransactionAsAdmin, {
          transactionId: NUMER_PLATNOSCI,
          environment: zle,
        }),
      ).toThrow(ZodError);
    }
  });

  it("brak środowiska i brak ładunku to odmowa", () => {
    expect(() => validateServerFnInput(sendMyPortalLink, {})).toThrow(ZodError);
    expect(() => validateServerFnInput(sendMyPortalLink, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(sendMyPortalLink, null)).toThrow(ZodError);
  });

  it("nadmiarowe pola są odcinane - także podstawiony `userId`", () => {
    // KLUCZOWE dla prywatności: gdyby ładunek przechodził w całości, dopisanie
    // `userId` do żądania „wyślij MÓJ link" byłoby próbą podstawienia cudzej
    // tożsamości. Zod zdejmuje ten klucz, a handler i tak czyta kontekst -
    // dwie niezależne warstwy tej samej reguły.
    expect(
      validateServerFnInput<WejscieSrodowiska>(sendMyPortalLink, {
        environment: "live",
        userId: INNY_UZYTKOWNIK,
      }),
    ).toEqual({ environment: "live" });
  });
});

describe("walidator - identyfikator użytkownika w funkcji panelu", () => {
  it("poprawny UUID przechodzi", () => {
    expect(
      validateServerFnInput<WejscieUzytkownika>(resendPortalLinkForUser, {
        userId: INNY_UZYTKOWNIK,
        environment: "live",
      }),
    ).toEqual({ userId: INNY_UZYTKOWNIK, environment: "live" });
  });

  it("cokolwiek innego niż UUID jest odrzucane - także pusty tekst", () => {
    // Ta wartość idzie do wyszukania odbiorcy maila. Pusty tekst albo adres
    // e-mail zamiast identyfikatora skończyłby się szukaniem odbiorcy, który
    // nie istnieje - albo, przy luźniejszym filtrze, trafieniem w cudzy wiersz.
    for (const zle of ["", " ", "anna@example.com", "11111111", 42, null, undefined]) {
      expect(() =>
        validateServerFnInput(resendPortalLinkForUser, { userId: zle, environment: "live" }),
      ).toThrow(ZodError);
    }
  });
});

describe("walidator - numer transakcji", () => {
  const AKCEPTOWANE = [
    "pi_3AbCdEfGhIjKlMnO",
    "in_1AbCdEfGhIjKlMnO",
    "ch_3AbCdEfGhIjKlMnO",
    "txn_01hZzYyXxWwVv123",
  ];

  it("przyjmuje identyfikatory z każdego obsługiwanego prefiksu", () => {
    // `resolveInvoiceUrl` rozgałęzia się po prefiksie (`in_`, `cs_`, `pi_`),
    // a `txn_` został po migracji z poprzedniego operatora. Zawężenie tej
    // listy odcięłoby część klientów od własnych dokumentów.
    for (const numer of AKCEPTOWANE) {
      expect(
        validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
          transactionId: numer,
          environment: "live",
        }).transactionId,
      ).toBe(numer);
    }
  });

  it("PRZYCINA białe znaki - użytkownik wkleja numer z maila", () => {
    // Wklejenie z klienta pocztowego niesie spacje i znak nowej linii.
    // Odrzucenie takiego wejścia byłoby odmową z powodu, którego użytkownik
    // nie widzi na ekranie.
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: `  ${NUMER_PLATNOSCI}\n`,
        environment: "live",
      }).transactionId,
    ).toBe(NUMER_PLATNOSCI);
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: `\t${NUMER_PLATNOSCI}  `,
        environment: "live",
      }).transactionId,
    ).toBe(NUMER_PLATNOSCI);
  });

  it("NIE zmienia wielkości liter - identyfikatory operatora są na nią wrażliwe", () => {
    // Normalizacja do małych liter wyglądałaby na uprzejmość, a byłaby
    // cichym psuciem numeru: operator oddałby „nie znaleziono" na dokument,
    // który istnieje.
    const zMieszanaWielkoscia = "pi_3aBcDeFgHiJkLmNo";
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: zMieszanaWielkoscia,
        environment: "live",
      }).transactionId,
    ).toBe(zMieszanaWielkoscia);
  });

  it("odrzuca prefiks zapisany WIELKIMI literami", () => {
    // Wzorzec wymaga prefiksu małymi literami. Pinujemy to świadomie: prefiks
    // decyduje o tym, o CO pytamy operatora (faktura kontra sesja kontra
    // płatność), więc nie jest miejscem na domysły.
    expect(() =>
      validateServerFnInput(fetchMyInvoiceByTransaction, {
        transactionId: "PI_3AbCdEfGhIjKlMnO",
        environment: "live",
      }),
    ).toThrow(ZodError);
  });

  it("odrzuca prefiks spoza listy, brak prefiksu i pusty tekst", () => {
    for (const zle of [
      "sub_3AbCdEfGhIjKlMnO",
      "cus_3AbCdEfGhIjKlMnO",
      "evt_3AbCdEfGhIjKlMnO",
      "3AbCdEfGhIjKlMnO",
      "",
      "   ",
      "pi_",
    ]) {
      expect(() =>
        validateServerFnInput(fetchMyInvoiceByTransaction, {
          transactionId: zle,
          environment: "live",
        }),
      ).toThrow(ZodError);
    }
  });

  it("odrzuca człon za krótki (7 znaków) i przyjmuje graniczny (8 znaków)", () => {
    // Granica wzorca: `[A-Za-z0-9]{8,80}`. Bez dolnego progu przeszedłby
    // fragment numeru urwany przy kopiowaniu, a odpowiedź operatora
    // („nie znaleziono") wyglądałaby jak brak dokumentu.
    expect(() =>
      validateServerFnInput(fetchMyInvoiceByTransaction, {
        transactionId: "pi_1234567",
        environment: "live",
      }),
    ).toThrow(ZodError);
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: "pi_12345678",
        environment: "live",
      }).transactionId,
    ).toBe("pi_12345678");
  });

  it("odrzuca człon dłuższy niż 80 znaków - to już nie jest numer transakcji", () => {
    expect(() =>
      validateServerFnInput(fetchMyInvoiceByTransaction, {
        transactionId: `pi_${"a".repeat(81)}`,
        environment: "live",
      }),
    ).toThrow(ZodError);
  });

  it("odrzuca znaki spoza alfanumerycznych - także wstrzyknięcie w środku", () => {
    // Numer idzie do zapytania do operatora i do filtra po kolumnie
    // `provider_intent_id`. Wzorzec jest tu bramką przed wszystkim, co nie
    // jest identyfikatorem: myślnikami, spacjami w środku, znakami zapytania.
    for (const zle of [
      "pi_3AbCdEf-GhIjKlMn",
      "pi_3AbCdEf GhIjKlMn",
      "pi_3AbCdEf?GhIjKlMn",
      "pi_3AbCdEf'GhIjKlMn",
      "pi_3AbCdEf%20GhIjKl",
    ]) {
      expect(() =>
        validateServerFnInput(fetchMyInvoiceByTransaction, {
          transactionId: zle,
          environment: "live",
        }),
      ).toThrow(ZodError);
    }
  });

  it("typ inny niż tekst jest odrzucany", () => {
    for (const zle of [42, true, null, undefined, ["pi_12345678"], { id: "pi_12345678" }]) {
      expect(() =>
        validateServerFnInput(fetchMyInvoiceByTransaction, {
          transactionId: zle,
          environment: "live",
        }),
      ).toThrow(ZodError);
    }
  });

  it("panel administratora ma DOKŁADNIE ten sam wzorzec co profil użytkownika", () => {
    // Rozjazd między tymi dwiema bramkami byłby najgorszym z możliwych:
    // obsługa zgłoszeń przyjmowałaby numery, których użytkownik nie może
    // podać (albo odwrotnie), a diagnoza „u mnie działa" trwałaby godzinami.
    for (const numer of AKCEPTOWANE) {
      expect(
        validateServerFnInput<WejscieTransakcji>(fetchInvoiceByTransactionAsAdmin, {
          transactionId: `  ${numer}  `,
          environment: "live",
        }).transactionId,
      ).toBe(numer);
    }
    expect(() =>
      validateServerFnInput(fetchInvoiceByTransactionAsAdmin, {
        transactionId: "sub_3AbCdEfGhIjKlMnO",
        environment: "live",
      }),
    ).toThrow(ZodError);
  });

  // DEFEKT (nie naprawiam - zakres zadania to testy, nie kod produkcyjny).
  //
  // CO JEST ZŁE. Wzorzec `TRANSACTION_ID_PATTERN`
  // (`src/lib/billing/transactionId.ts:7`) brzmi
  // `/^(pi_|cs_|in_|ch_|txn_)[A-Za-z0-9]{8,80}$/` - po prefiksie dopuszcza
  // WYŁĄCZNIE znaki alfanumeryczne. Tymczasem identyfikator sesji Checkout
  // u operatora ma postać `cs_test_<...>` w piaskownicy i `cs_live_<...>` na
  // koncie produkcyjnym, czyli zawiera PODKREŚLNIK po członie trybu. Wzorzec
  // odrzuca więc KAŻDY prawdziwy identyfikator sesji, mimo że prefiks `cs_`
  // jest w nim wymieniony wprost jako obsługiwany.
  //
  // DLACZEGO TO RYZYKO. Implementacja jest gotowa na te identyfikatory:
  // `resolveInvoiceUrl` (`invoice.server.ts`) ma osobną gałąź
  // `transactionId.startsWith("cs_")`, która pobiera sesję i wyciąga z niej
  // fakturę albo paragon. Ta gałąź jest dziś NIEOSIĄGALNA z obu funkcji
  // faktur - bramka kształtu odcina wejście, zanim implementacja zdąży
  // cokolwiek zrobić. Skutki są dwa i oba są operacyjne:
  //   * użytkownik, który wkleja numer sesji z potwierdzenia zakupu, dostaje
  //     „nieprawidłowy numer transakcji" przy numerze całkowicie poprawnym,
  //   * obsługa zgłoszeń kopiuje `provider_session_id` z panelu zamówień
  //     (audyt wypisuje tę kolumnę wprost) i dostaje tę samą odmowę - czyli
  //     najprostsza droga „mam identyfikator zamówienia, daj mi dokument"
  //     nie działa.
  // Formularz w profilu (`InvoiceLookupCard`) używa tej samej funkcji
  // `isTransactionId`, więc odmowa pojawia się już przy wpisywaniu - defekt
  // jest jednakowy po obu stronach.
  //
  // DLACZEGO NIE NAPRAWIAM. Poprawka to zmiana KODU PRODUKCYJNEGO
  // (dopuszczenie podkreślnika w członie po prefiksie, np.
  // `[A-Za-z0-9_]{8,80}` albo osobna gałąź dla `cs_`), a moim zakresem są
  // testy. Zmiana wzorca dotyka JEDNOCZEŚNIE walidacji w przeglądarce,
  // walidatora tych server fn i twardej bramki w `invoice.server.ts`, więc
  // musi być świadoma. Test zaświeci na zielono dopiero po naprawie - wtedy
  // trzeba zdjąć `.fails`.
  it.fails("przyjmuje identyfikator sesji Checkout (`cs_live_...`)", () => {
    // ASERCJA DOCELOWA: prawdziwy kształt identyfikatora sesji przechodzi
    // przez bramkę, bo implementacja faktur potrafi go obsłużyć.
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: "cs_live_a1B2c3D4e5F6g7H8i9",
        environment: "live",
      }).transactionId,
    ).toBe("cs_live_a1B2c3D4e5F6g7H8i9");
  });

  it("stan faktyczny: przechodzi tylko identyfikator sesji BEZ członu trybu", () => {
    // Kontrapunkt do `it.fails` wyżej: prefiks `cs_` sam w sobie jest
    // obsłużony, więc problemem nie jest lista prefiksów, tylko podkreślnik
    // w członie `test`/`live`. Ten test ma zniknąć razem z naprawą wzorca.
    expect(
      validateServerFnInput<WejscieTransakcji>(fetchMyInvoiceByTransaction, {
        transactionId: "cs_a1B2c3D4e5F6g7H8i9",
        environment: "live",
      }).transactionId,
    ).toBe("cs_a1B2c3D4e5F6g7H8i9");
  });
});

describe("handler linku do portalu - tożsamość i ziarno", () => {
  beforeEach(() => {
    // Zegar zamrożony: ziarno idempotencji liczy się z `Date.now()`, więc bez
    // tego test mierzyłby czas przebiegu, a nie regułę.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("użytkownik dostaje link na SWOJE konto - tożsamość z kontekstu, nie z ładunku", async () => {
    // Najważniejsza asercja tego pliku. Gdyby handler czytał `userId`
    // z ładunku, każdy zalogowany zamawiałby maila z jednorazowym linkiem do
    // portalu płatności DOWOLNEGO użytkownika - czyli do jego metod
    // płatności, faktur i możliwości anulowania subskrypcji.
    await callServerFn(sendMyPortalLink, {
      data: { environment: "live", userId: INNY_UZYTKOWNIK },
      context: kontekst(),
    });

    expect(ostatniMail().userId).toBe(WLASCICIEL_SESJI);
  });

  it("środowisko jedzie dalej 1:1, a wynik wraca bez przetwarzania", async () => {
    const wynik = await callServerFn(sendMyPortalLink, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    expect(ostatniMail().environment).toBe("sandbox");
    expect(wynik).toBe(WYNIK_MAILA);
  });

  it("dwa kliknięcia w tym samym oknie 10 minut dają TO SAMO ziarno", async () => {
    // Reguła antydublowa: podwójne kliknięcie (albo ponowne wysłanie
    // formularza) nie może wysłać dwóch maili. Ziarno wchodzi do klucza
    // idempotencji poczty, więc jego stałość w oknie jest całą mechaniką.
    await callServerFn(sendMyPortalLink, { data: { environment: "live" }, context: kontekst() });
    const pierwsze = ostatniMail().idempotencySeed;

    vi.setSystemTime(new Date("2026-08-31T12:09:59.999Z"));
    await callServerFn(sendMyPortalLink, { data: { environment: "live" }, context: kontekst() });

    expect(ostatniMail().idempotencySeed).toBe(pierwsze);
  });

  it("po przekroczeniu 10 minut ziarno się zmienia - świadome ponowienie działa", async () => {
    // Druga połowa tej samej reguły: poprzedni link bywa już zużyty, więc
    // użytkownik MUSI móc poprosić o kolejny. Ziarno wieczne zamieniłoby
    // idempotencję w trwałą blokadę.
    await callServerFn(sendMyPortalLink, { data: { environment: "live" }, context: kontekst() });
    const pierwsze = ostatniMail().idempotencySeed;

    vi.setSystemTime(new Date("2026-08-31T12:10:00.000Z"));
    await callServerFn(sendMyPortalLink, { data: { environment: "live" }, context: kontekst() });

    expect(ostatniMail().idempotencySeed).not.toBe(pierwsze);
  });

  it("ziarno użytkownika jest liczbą okna, bez znacznika roli", async () => {
    // Kształt ziarna ma znaczenie: gdyby zawierało znacznik czasu co do
    // milisekundy (jak wariant administratora), okno idempotencji przestałoby
    // istnieć i każde kliknięcie wysyłałoby maila.
    await callServerFn(sendMyPortalLink, { data: { environment: "live" }, context: kontekst() });

    expect(ostatniMail().idempotencySeed).toMatch(/^\d+$/);
  });
});

describe("handler ponowienia z panelu - tożsamość i ziarno", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("administrator wysyła WSKAZANEMU użytkownikowi, a nie sobie", async () => {
    // Odwrotność reguły z funkcji „moje": tutaj tożsamość MUSI pochodzić
    // z ładunku, bo obsługa działa za zgłaszającego. Sięgnięcie po kontekst
    // wysyłałoby link administratorowi i zgłoszenie nigdy nie zostałoby
    // rozwiązane.
    await callServerFn(resendPortalLinkForUser, {
      data: { userId: INNY_UZYTKOWNIK, environment: "live" },
      context: kontekst(),
    });

    expect(ostatniMail().userId).toBe(INNY_UZYTKOWNIK);
    expect(ostatniMail().environment).toBe("live");
  });

  it("ziarno administratora jest UNIKALNE - każde kliknięcie ma dać świeży link", async () => {
    // Administrator klika po zgłoszeniu użytkownika, zwykle dlatego, że
    // poprzedni link był już zużyty. Okno idempotencji jak u użytkownika
    // sprawiłoby, że drugie kliknięcie nie robi NIC, a panel pokazuje sukces.
    await callServerFn(resendPortalLinkForUser, {
      data: { userId: INNY_UZYTKOWNIK, environment: "live" },
      context: kontekst(),
    });
    const pierwsze = ostatniMail().idempotencySeed;

    vi.setSystemTime(new Date("2026-08-31T12:00:00.500Z"));
    await callServerFn(resendPortalLinkForUser, {
      data: { userId: INNY_UZYTKOWNIK, environment: "live" },
      context: kontekst(),
    });

    expect(pierwsze).toMatch(/^admin:\d+$/);
    expect(ostatniMail().idempotencySeed).not.toBe(pierwsze);
  });

  it("oddaje wynik wysyłki bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(resendPortalLinkForUser, {
      data: { userId: INNY_UZYTKOWNIK, environment: "live" },
      context: kontekst(),
    });

    expect(wynik).toBe(WYNIK_MAILA);
  });
});

describe("handlery faktur - kto jest właścicielem transakcji", () => {
  it("użytkownik pyta o SWOJĄ fakturę - kontrola własności jest włączona", async () => {
    // `userId` różne od `null` włącza w implementacji sprawdzenie własności
    // transakcji. To jedyna rzecz, która stoi między numerem transakcji
    // wpisanym w formularzu a cudzym dokumentem rozliczeniowym.
    await callServerFn(fetchMyInvoiceByTransaction, {
      data: { transactionId: NUMER_PLATNOSCI, environment: "live" },
      context: kontekst(),
    });

    expect(h.invoiceUrlForTransaction).toHaveBeenCalledWith({
      transactionId: NUMER_PLATNOSCI,
      environment: "live",
      userId: WLASCICIEL_SESJI,
    });
  });

  it("numer transakcji dociera do implementacji już PRZYCIĘTY", async () => {
    // Dowód, że transformacja walidatora nie ginie po drodze: implementacja
    // dostaje numer bez białych znaków, więc porównanie z kolumną
    // `provider_intent_id` w bazie ma szansę trafić.
    await callServerFn(fetchMyInvoiceByTransaction, {
      data: { transactionId: `   ${NUMER_PLATNOSCI}   `, environment: "live" },
      context: kontekst(),
    });

    expect(h.invoiceUrlForTransaction).toHaveBeenCalledWith({
      transactionId: NUMER_PLATNOSCI,
      environment: "live",
      userId: WLASCICIEL_SESJI,
    });
  });

  it("panel administratora POMIJA kontrolę własności - jawne `null`", async () => {
    // Świadome rozluźnienie: obsługa zgłoszeń dostaje numer od klienta, który
    // nie zawsze jest zalogowany. Dlatego ta funkcja siedzi za
    // `requireAdminEditor`, a `null` musi być JAWNE - `undefined` w tym polu
    // wyglądałoby jak przeoczenie, a nie jak decyzja.
    await callServerFn(fetchInvoiceByTransactionAsAdmin, {
      data: { transactionId: NUMER_PLATNOSCI, environment: "live" },
      context: kontekst(),
    });

    expect(h.invoiceUrlForTransaction).toHaveBeenCalledWith({
      transactionId: NUMER_PLATNOSCI,
      environment: "live",
      userId: null,
    });
  });

  it("funkcja panelu NIE bierze tożsamości z kontekstu, nawet gdy ta jest dostępna", async () => {
    // Gdyby handler przepisał tutaj `context.userId`, obsługa widziałaby
    // wyłącznie własne transakcje - funkcja przestałaby robić to, po co
    // powstała, i to bez żadnego komunikatu błędu.
    await callServerFn(fetchInvoiceByTransactionAsAdmin, {
      data: { transactionId: NUMER_PLATNOSCI, environment: "sandbox" },
      context: kontekst(),
    });

    const args = h.invoiceUrlForTransaction.mock.calls.at(-1)?.[0];
    expect(Reflect.get(Object(args), "userId")).not.toBe(WLASCICIEL_SESJI);
  });

  it("obie funkcje faktur oddają wynik implementacji bez przetwarzania", async () => {
    const moja = await callServerFn(fetchMyInvoiceByTransaction, {
      data: { transactionId: NUMER_PLATNOSCI, environment: "live" },
      context: kontekst(),
    });
    const panelu = await callServerFn(fetchInvoiceByTransactionAsAdmin, {
      data: { transactionId: NUMER_PLATNOSCI, environment: "live" },
      context: kontekst(),
    });

    // `toBe`: adres dokumentu jest krótkotrwały i pochodzi od operatora -
    // opakowanie nie ma prawa go przepisywać ani cache'ować.
    expect(moja).toBe(WYNIK_FAKTURY);
    expect(panelu).toBe(WYNIK_FAKTURY);
  });
});
