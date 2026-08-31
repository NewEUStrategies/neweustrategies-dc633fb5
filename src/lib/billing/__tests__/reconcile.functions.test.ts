// Obudowa server fn UZGADNIANIA ROZLICZEŃ (`reconcile.functions.ts`) -
// 45 linii, 0% pokrycia do 31.08.2026 (0 z 4 funkcji).
//
// PO CO TEN PLIK ISTNIEJE. `repairReconcileEntry` to przycisk „napraw tę
// rozbieżność" na /admin/billing-reconcile. Odtwarza zdarzenie płatnicze tą
// samą ścieżką co webhook, czyli NADAJE UPRAWNIENIA na podstawie danych
// pobranych ze Stripe. Implementacja (`reconcile.server.ts`) ma własne testy;
// nieprzetestowane było opakowanie, a w nim jedyna bramka kształtu przed tym
// przyciskiem.
//
// TRZY POLA, TRZY RYZYKA:
//   * `environment` wybiera KLUCZ API. Naprawa „w piaskownicy" identyfikatora
//     z produkcji nie znajdzie zdarzenia (fałszywe „nie ma czego naprawiać"),
//     a odwrotnie - odtworzy zdarzenie z konta testowego na prawdziwych
//     uprawnieniach.
//   * `kind` decyduje, KTÓRĄ gałąź naprawy uruchomić: pobranie zdarzenia,
//     pobranie zamówienia albo pobranie subskrypcji. Wartość spoza listy
//     wpadłaby do gałęzi domyślnej (subskrypcja) - naprawa robiłaby coś
//     zupełnie innego niż to, o co kliknął administrator.
//   * `reference` to identyfikator przekazywany operatorowi ORAZ używany jako
//     filtr w bazie. Pusty tekst albo same białe znaki to zapytanie o nic.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc `requireSupabaseAuth` przybijamy STRUKTURALNIE, a odmowę roli tam,
// gdzie da się ją wywołać naprawdę - przez `assertAdmin`.
//
// Atrapy stoją na GRANICACH: kontrola roli i implementacja uzgadniania
// (SDK operatora plus baza). Schematy zod biegną PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  buildReconcileReport: vi.fn(),
  repairReconcileIssue: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin: h.assertAdmin }));
vi.mock("@/lib/billing/reconcile.server", () => ({
  buildReconcileReport: h.buildReconcileReport,
  repairReconcileIssue: h.repairReconcileIssue,
}));

import { getReconcileReport, repairReconcileEntry } from "@/lib/billing/reconcile.functions";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ZAMOWIENIE_ID = "33333333-3333-4333-8333-333333333333";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const RAPORT = { marker: "raport-uzgodnienia" };
const WYNIK_NAPRAWY = { marker: "wynik-naprawy" };
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

/** Kształty oddawane przez schematy wejścia. */
interface WejscieRaportu {
  environment: "sandbox" | "live";
  sinceHours: number;
}
interface WejscieNaprawy {
  environment: "sandbox" | "live";
  kind: "event" | "order" | "subscription";
  reference: string;
}

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: ADMIN_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAdmin.mockResolvedValue(undefined);
  h.buildReconcileReport.mockResolvedValue(RAPORT);
  h.repairReconcileIssue.mockResolvedValue(WYNIK_NAPRAWY);
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje deklarują bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Gdyby ta deklaracja
    // zniknęła, przycisk odtwarzający zdarzenia płatnicze byłby wywoływalny
    // bez sesji - czyli byłby generatorem uprawnień.
    expect(serverFnMiddlewareNames(getReconcileReport)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(repairReconcileEntry)).toEqual(["requireSupabaseAuth"]);
  });

  it("obie idą metodą POST - także sam raport", () => {
    // Raport jest odczytem, ale jego zakres (środowisko, okno) nie ma prawa
    // wylądować w adresie. Naprawa tym bardziej: to jest akcja zmieniająca
    // stan, więc nie może dać się wywołać samym wejściem pod adres.
    expect(asServerFn(getReconcileReport).method).toBe("POST");
    expect(asServerFn(repairReconcileEntry).method).toBe("POST");
  });
});

describe("walidator raportu - środowisko i okno", () => {
  it("poprawne minimalne wejście uzupełnia okno domyślne (72 h)", () => {
    expect(
      validateServerFnInput<WejscieRaportu>(getReconcileReport, { environment: "live" }),
    ).toEqual({ environment: "live", sinceHours: 72 });
  });

  it("wartość środowiska spoza enuma jest ODRZUCANA", () => {
    for (const zle of ["prod", "production", "LIVE", " live", "", "test", null, 1]) {
      expect(() => validateServerFnInput(getReconcileReport, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("brak środowiska i brak ładunku to odmowa", () => {
    expect(() => validateServerFnInput(getReconcileReport, {})).toThrow(ZodError);
    expect(() => validateServerFnInput(getReconcileReport, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(getReconcileReport, null)).toThrow(ZodError);
  });

  it("skrajne wartości okna przechodzą: 1 godzina i 720 godzin (30 dni)", () => {
    expect(
      validateServerFnInput<WejscieRaportu>(getReconcileReport, {
        environment: "live",
        sinceHours: 1,
      }).sinceHours,
    ).toBe(1);
    expect(
      validateServerFnInput<WejscieRaportu>(getReconcileReport, {
        environment: "live",
        sinceHours: 720,
      }).sinceHours,
    ).toBe(720);
  });

  it("zero, wartość ujemna i przekroczony sufit 30 dni są odrzucane", () => {
    // Sufit jest tu NAJNIŻSZY w całym module (audyt ma 8760 h, rejestr wpłat
    // 2160 h), bo uzgadnianie porównuje stan po obu stronach i odpytuje
    // operatora. Zdjęcie tego sufitu zamieniłoby ekran diagnostyczny
    // w przebieg, który nie kończy się w limicie czasu funkcji serwerowej.
    for (const zle of [0, -1, -72, 721, 8760]) {
      expect(() =>
        validateServerFnInput(getReconcileReport, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });

  it("tekst, ułamek i NaN zamiast liczby są odrzucane", () => {
    for (const zle of ["72", "", 1.5, Number.NaN, Number.POSITIVE_INFINITY, true, null]) {
      expect(() =>
        validateServerFnInput(getReconcileReport, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });

  it("nadmiarowe pola są odcinane", () => {
    expect(
      validateServerFnInput<WejscieRaportu>(getReconcileReport, {
        environment: "live",
        sinceHours: 24,
        limit: 100000,
        payload: { id: "evt_podstawiony" },
      }),
    ).toEqual({ environment: "live", sinceHours: 24 });
  });
});

describe("walidator naprawy - rodzaj rozbieżności", () => {
  it("wszystkie trzy rodzaje z listy przechodzą", () => {
    // Każdy rodzaj uruchamia INNĄ gałąź naprawy: pobranie zdarzenia, pobranie
    // zamówienia i sesji, pobranie subskrypcji. Ta lista jest kontraktem
    // między panelem a implementacją.
    for (const kind of ["event", "order", "subscription"]) {
      expect(
        validateServerFnInput<WejscieNaprawy>(repairReconcileEntry, {
          environment: "live",
          kind,
          reference: "evt_1AbCdEfGh",
        }).kind,
      ).toBe(kind);
    }
  });

  it("rodzaj spoza listy jest ODRZUCANY - inaczej wpadłby w gałąź domyślną", () => {
    // `repairReconcileIssue` sprawdza `kind === "event"`, potem
    // `kind === "order"`, a resztę traktuje jako SUBSKRYPCJĘ. Wartość spoza
    // listy nie wywaliłaby się więc głośno - poszłaby do
    // `stripe.subscriptions.retrieve()` z identyfikatorem zamówienia i dopiero
    // tam skończyła błędem operatora, bez śladu o prawdziwej przyczynie.
    for (const zle of ["invoice", "charge", "Event", "EVENT", "", " ", null, 1, true]) {
      expect(() =>
        validateServerFnInput(repairReconcileEntry, {
          environment: "live",
          kind: zle,
          reference: "evt_1AbCdEfGh",
        }),
      ).toThrow(ZodError);
    }
  });

  it("brak rodzaju to odmowa - nie ma wartości domyślnej", () => {
    expect(() =>
      validateServerFnInput(repairReconcileEntry, {
        environment: "live",
        reference: "evt_1AbCdEfGh",
      }),
    ).toThrow(ZodError);
  });
});

describe("walidator naprawy - referencja", () => {
  it("PRZYCINA białe znaki wokół identyfikatora", () => {
    // Administrator kopiuje referencję z tabeli raportu albo z logu, więc
    // spacja albo znak nowej linii na końcu jest normą. Bez przycięcia filtr
    // `.eq("id", ...)` nie trafiłby w żaden wiersz, a panel pokazałby
    // „pominięto" zamiast naprawić.
    expect(
      validateServerFnInput<WejscieNaprawy>(repairReconcileEntry, {
        environment: "live",
        kind: "order",
        reference: `  ${ZAMOWIENIE_ID}\n`,
      }).reference,
    ).toBe(ZAMOWIENIE_ID);
  });

  it("pusty tekst i same białe znaki są ODRZUCANE", () => {
    // `.trim()` idzie PRZED `.min(1)`, więc „   " staje się pustym tekstem
    // i wpada na dolny próg. Bez tego przebiegu naprawa ruszyłaby z pustą
    // referencją: zapytanie do operatora o nic, a w dzienniku wpis
    // o „naprawie", która niczego nie dotyczyła.
    for (const zle of ["", " ", "   ", "\t", "\n"]) {
      expect(() =>
        validateServerFnInput(repairReconcileEntry, {
          environment: "live",
          kind: "event",
          reference: zle,
        }),
      ).toThrow(ZodError);
    }
  });

  it("referencja dłuższa niż 255 znaków jest odrzucana, a graniczna przechodzi", () => {
    // Górny próg chroni filtr bazy i zapytanie do operatora przed ładunkiem,
    // który nie jest identyfikatorem.
    const graniczna = "e".repeat(255);
    expect(
      validateServerFnInput<WejscieNaprawy>(repairReconcileEntry, {
        environment: "live",
        kind: "event",
        reference: graniczna,
      }).reference,
    ).toBe(graniczna);
    expect(() =>
      validateServerFnInput(repairReconcileEntry, {
        environment: "live",
        kind: "event",
        reference: "e".repeat(256),
      }),
    ).toThrow(ZodError);
  });

  it("brak referencji i typ inny niż tekst są odrzucane", () => {
    expect(() =>
      validateServerFnInput(repairReconcileEntry, { environment: "live", kind: "event" }),
    ).toThrow(ZodError);
    for (const zle of [42, true, null, ["evt_1"], { id: "evt_1" }]) {
      expect(() =>
        validateServerFnInput(repairReconcileEntry, {
          environment: "live",
          kind: "event",
          reference: zle,
        }),
      ).toThrow(ZodError);
    }
  });

  it("klient NIE MOŻE podstawić ładunku zdarzenia - schemat zdejmuje nadmiarowe klucze", () => {
    // To jest reguła, którą plik produkcyjny deklaruje w nagłówku: „klient
    // nigdy nie przekazuje ładunku zdarzenia - wyłącznie identyfikatory, po
    // których serwer sam pobiera dane ze Stripe". Gdyby ładunek przechodził,
    // naprawa odtwarzałaby zdarzenie NIEZWERYFIKOWANE podpisem, czyli
    // nadawałaby uprawnienia na życzenie.
    expect(
      validateServerFnInput<WejscieNaprawy>(repairReconcileEntry, {
        environment: "live",
        kind: "event",
        reference: "evt_1AbCdEfGh",
        payload: { id: "evt_podstawiony", type: "checkout.session.completed" },
        data: { object: { id: "cs_podstawiony" } },
      }),
    ).toEqual({ environment: "live", kind: "event", reference: "evt_1AbCdEfGh" });
  });
});

describe("handler raportu - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED zbudowaniem raportu", async () => {
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(getReconcileReport, { data: { environment: "live" }, context: kontekst() }),
    ).rejects.toThrow("forbidden");
    expect(h.buildReconcileReport).not.toHaveBeenCalled();
  });

  it("kontrola roli dostaje klienta i użytkownika Z KONTEKSTU, nie z ładunku", async () => {
    await callServerFn(getReconcileReport, {
      data: { environment: "live", userId: "podstawiony" },
      context: kontekst(),
    });

    expect(h.assertAdmin).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, ADMIN_ID);
  });

  it("środowisko i okno jadą dalej POZYCYJNIE i w tej kolejności", async () => {
    // Argumenty są pozycyjne (tekst, liczba), więc ich zamiana nie wywaliłaby
    // się na typach - dałaby raport z niewłaściwego konta i bezsensownego okna.
    await callServerFn(getReconcileReport, {
      data: { environment: "sandbox", sinceHours: 24 },
      context: kontekst(),
    });

    expect(h.buildReconcileReport).toHaveBeenCalledWith("sandbox", 24);
  });

  it("domyślne okno 72 h dojeżdża do implementacji", async () => {
    await callServerFn(getReconcileReport, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(h.buildReconcileReport).toHaveBeenCalledWith("live", 72);
  });

  it("oddaje raport implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(getReconcileReport, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(wynik).toBe(RAPORT);
  });
});

describe("handler naprawy - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED dotknięciem czegokolwiek", async () => {
    // Ta funkcja nadaje uprawnienia. Sprawdzenie roli po wykonaniu pracy
    // byłoby bezwartościowe - uprawnienie już by istniało.
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(repairReconcileEntry, {
        data: { environment: "live", kind: "event", reference: "evt_1AbCdEfGh" },
        context: kontekst(),
      }),
    ).rejects.toThrow("forbidden");
    expect(h.repairReconcileIssue).not.toHaveBeenCalled();
  });

  it("wszystkie trzy pola jadą dalej POZYCYJNIE i w tej kolejności", async () => {
    // Kolejność `(environment, kind, reference)` to trzy argumenty, z których
    // dwa są tekstem. Zamiana środowiska z rodzajem przeszłaby przez typy
    // i wysłała naprawę na niewłaściwe konto.
    await callServerFn(repairReconcileEntry, {
      data: { environment: "live", kind: "order", reference: ZAMOWIENIE_ID },
      context: kontekst(),
    });

    expect(h.repairReconcileIssue).toHaveBeenCalledWith("live", "order", ZAMOWIENIE_ID);
  });

  it("referencja dociera do implementacji już PRZYCIĘTA", async () => {
    // Dowód, że transformacja walidatora nie ginie: implementacja dostaje
    // identyfikator bez białych znaków, więc `.eq("id", ...)` ma szansę trafić.
    await callServerFn(repairReconcileEntry, {
      data: { environment: "live", kind: "order", reference: `  ${ZAMOWIENIE_ID}  ` },
      context: kontekst(),
    });

    expect(h.repairReconcileIssue).toHaveBeenCalledWith("live", "order", ZAMOWIENIE_ID);
  });

  it("piaskownica nie jest podmieniana na produkcję", async () => {
    // Jedyna asercja, która stoi między odtworzeniem zdarzenia testowego
    // a nadaniem prawdziwego uprawnienia.
    await callServerFn(repairReconcileEntry, {
      data: { environment: "sandbox", kind: "subscription", reference: "sub_1AbCdEfGh" },
      context: kontekst(),
    });

    expect(h.repairReconcileIssue).toHaveBeenCalledWith("sandbox", "subscription", "sub_1AbCdEfGh");
  });

  it("oddaje wynik naprawy bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(repairReconcileEntry, {
      data: { environment: "live", kind: "event", reference: "evt_1AbCdEfGh" },
      context: kontekst(),
    });

    // `toBe`: wynik niesie status (`repaired` / `skipped` / `failed`) i powód.
    // Przepisanie go w opakowaniu mogłoby zamienić porażkę w fałszywy sukces.
    expect(wynik).toBe(WYNIK_NAPRAWY);
  });

  it("porażka implementacji NIE jest połykana", async () => {
    // Naprawa, która cicho nic nie zrobiła, jest gorsza od jawnego błędu:
    // zamyka zgłoszenie klienta, który nadal nie ma opłaconego uprawnienia.
    h.repairReconcileIssue.mockRejectedValue(new Error("No such event: evt_1AbCdEfGh"));

    await expect(
      callServerFn(repairReconcileEntry, {
        data: { environment: "live", kind: "event", reference: "evt_1AbCdEfGh" },
        context: kontekst(),
      }),
    ).rejects.toThrow("No such event");
  });
});
