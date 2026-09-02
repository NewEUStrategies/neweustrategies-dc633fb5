// PREFILL FORMULARZA ZGŁOSZENIA KLUBOWEGO - udogodnienie, które NIE MOŻE
// przewrócić strony ani wynieść z profilu więcej, niż formularz potrzebuje.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/clubs/applyPrefill.functions.ts` miał
// 0 z 7 linii i 0 z 1 funkcji - cała warstwa serwerowa prefillu była opisem
// bez dowodu. To jedyne miejsce, w którym formularz klubowy czyta PII
// z profilu (`phone`, `location`), i jedyne, którego awaria mogłaby zablokować
// stronę zgłoszenia.
//
// CO JEST PRZEDMIOTEM DOWODU - trzy rzeczy, których nie widać w typach:
//
//   1. MAPOWANIE OŚMIU PÓL. Nazwy kolumn profilu (`current_company`,
//      `job_title`, `location`) różnią się od nazw pól formularza (`company`,
//      `jobPosition`, `country`). Literówka w którejkolwiek daje puste pole,
//      które użytkownik przepisze ręcznie i nikt się o niej nie dowie.
//   2. PIERWSZEŃSTWO ADRESU: `contact_email || email`. To `||`, NIE `??` -
//      i ta różnica jest tu treścią, a nie stylem. Pusty napis w
//      `contact_email` (kolumna wyczyszczona w panelu profilu, nie skasowana)
//      przy `??` ZJADŁBY adres konta i zostawił puste pole obowiązkowe.
//      Dowodzimy OBU gałęzi osobno.
//   3. AWARIA JEST CICHA. Błąd RPC oddaje komplet pustych stringów i NIGDY nie
//      rzuca. Wyjątek w tym miejscu wywróciłby całą stronę `club.apply` -
//      użytkownik straciłby możliwość złożenia zgłoszenia z powodu
//      udogodnienia, którego nie prosił.
//
// Dodatkowo, i to jest asercja o PRYWATNOŚCI, a nie o kształcie: wynik ma
// DOKŁADNIE osiem kluczy. `get_own_profile` oddaje kilkadziesiąt kolumn (w tym
// `gender`, `prefs`, `discovery_search`, `completeness_score`), a ta funkcja
// jest bramą z profilu do formularza - rozlanie wiersza „bo wygodniej" wysłałoby
// je wszystkie do przeglądarki.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` (`serverFnStubModule`) - `createServerFn` buduje
//     obiekt wywoływalny wyłącznie przez runtime frameworka; bez podmiany
//     fabryki ciało handlera jest z vitest nieosiągalne.
//   * `context.supabase.rpc` - ŻADEN test nie wychodzi do bazy ani do sieci.
//
// GRANICA DOWODU - UCZCIWIE. Atrapa NIE URUCHAMIA middleware, więc ten plik
// nie mówi „anonim nie przeczyta cudzego profilu". Mówi „funkcja DEKLARUJE
// `requireSupabaseAuth`" (test strukturalny). Prawdziwym zakresem jest
// `get_own_profile` - SECURITY DEFINER zawężony do `auth.uid()`, czyli
// użytkownik fizycznie nie ma jak podać cudzego identyfikatora: ta funkcja
// nie przyjmuje ŻADNEGO wejścia (osobna asercja niżej).
//
// RODO: żadnych prawdziwych danych. Adresy wyłącznie `@example.com`, imiona,
// firmy i numery telefonów zmyślone.
import { describe, expect, it, vi } from "vitest";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asServerFn } from "@/test/serverFnHarness";
import { callServerFn } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

const { getClubApplyPrefill } = await import("@/lib/clubs/applyPrefill.functions");
import type { ClubApplyPrefill } from "@/lib/clubs/applyPrefill.functions";

const PROFILE_RPC = "get_own_profile";

const EMPTY: ClubApplyPrefill = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  jobPosition: "",
  country: "",
  linkedinUrl: "",
};

/** Kolumny profilu, których dotyka prefill. Wartości wyłącznie zmyślone. */
interface ProfileRow {
  first_name: string | null;
  last_name: string | null;
  contact_email: string | null;
  email: string | null;
  phone: string | null;
  current_company: string | null;
  job_title: string | null;
  location: string | null;
  linkedin_url: string | null;
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    first_name: "Zofia",
    last_name: "Przykladowska",
    contact_email: "zofia.kontakt@example.com",
    email: "zofia.konto@example.com",
    phone: "+48 000 000 000",
    current_company: "Instytut Przykladowy",
    job_title: "Analityczka polityk publicznych",
    location: "Polska",
    linkedin_url: "https://linkedin.example/in/zofia",
    ...overrides,
  };
}

/** Profil, w którym KAŻDA opcjonalna kolumna jest pusta (`null`). */
function blankProfile(): ProfileRow {
  return {
    first_name: null,
    last_name: null,
    contact_email: null,
    email: null,
    phone: null,
    current_company: null,
    job_title: null,
    location: null,
    linkedin_url: null,
  };
}

interface Scenario {
  /** Surowa odpowiedź RPC - świadomie `unknown`, bo badamy też kształty spoza kontraktu. */
  rows?: unknown;
  error?: { message: string } | null;
}

async function prefill(scenario: Scenario = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const rpc = vi.fn(async (name: string, ...args: unknown[]) => {
    calls.push({ name, args });
    return { data: scenario.rows ?? null, error: scenario.error ?? null };
  });
  const result = await callServerFn<ClubApplyPrefill>(getClubApplyPrefill, undefined, {
    supabase: { rpc },
  });
  return { result, calls };
}

describe("prefill z pełnego profilu - osiem pól, których nikt nie musi przepisywać", () => {
  it("mapuje każdą kolumnę na właściwe pole formularza", async () => {
    const { result } = await prefill({ rows: [profile()] });
    expect(result).toEqual({
      firstName: "Zofia",
      lastName: "Przykladowska",
      email: "zofia.kontakt@example.com",
      phone: "+48 000 000 000",
      company: "Instytut Przykladowy",
      jobPosition: "Analityczka polityk publicznych",
      country: "Polska",
      linkedinUrl: "https://linkedin.example/in/zofia",
    });
  });

  it("czyta WYŁĄCZNIE `get_own_profile` i nie podaje mu żadnego argumentu", async () => {
    // Brak argumentu to nie oszczędność, tylko zakres: RPC bierze tożsamość
    // z `auth.uid()`, więc nie da się poprosić o cudzy profil.
    const { calls } = await prefill({ rows: [profile()] });
    expect(calls).toEqual([{ name: PROFILE_RPC, args: [] }]);
  });

  it("bierze PIERWSZY wiersz, gdy RPC odda ich więcej", async () => {
    const { result } = await prefill({
      rows: [profile({ first_name: "Zofia" }), profile({ first_name: "Ktos inny" })],
    });
    expect(result.firstName).toBe("Zofia");
  });

  it("oddaje dokładnie osiem kluczy - profil nie wycieka do przeglądarki w całości", async () => {
    // `get_own_profile` niesie kilkadziesiąt kolumn, w tym `prefs` i `gender`.
    const { result } = await prefill({ rows: [profile()] });
    expect(Object.keys(result).sort()).toEqual(Object.keys(EMPTY).sort());
  });
});

describe("adres kontaktowy kontra loginowy - dowód, że to `||`, nie `??`", () => {
  it("wypełniony `contact_email` wygrywa nad adresem konta", async () => {
    const { result } = await prefill({
      rows: [
        profile({
          contact_email: "kontakt@example.com",
          email: "konto@example.com",
        }),
      ],
    });
    expect(result.email).toBe("kontakt@example.com");
  });

  it("PUSTY `contact_email` NIE zjada adresu konta", async () => {
    // Gałąź, której `??` by nie złapało: pusty napis jest wartością, więc
    // `??` zwróciłoby "" i zostawiło puste pole OBOWIĄZKOWE.
    const { result } = await prefill({
      rows: [profile({ contact_email: "", email: "konto@example.com" })],
    });
    expect(result.email).toBe("konto@example.com");
  });

  it("`contact_email` równy `null` też oddaje pole adresowi konta", async () => {
    const { result } = await prefill({
      rows: [profile({ contact_email: null, email: "konto@example.com" })],
    });
    expect(result.email).toBe("konto@example.com");
  });

  it("brak obu adresów daje pusty napis, nie `null`", async () => {
    const { result } = await prefill({
      rows: [profile({ contact_email: "", email: "" })],
    });
    expect(result.email).toBe("");
  });
});

describe("profil bez danych - puste stringi, nigdy `null` ani `undefined`", () => {
  it("same `null` w kolumnach dają komplet pustych napisów", async () => {
    // Formularz jest kontrolowany: `value={null}` przełączyłby pole
    // w tryb niekontrolowany i wywalił ostrzeżenie Reacta.
    const { result } = await prefill({ rows: [blankProfile()] });
    expect(result).toEqual(EMPTY);
  });

  it("każde pole jest napisem, także gdy kolumny w ogóle nie ma", async () => {
    // Wiersz z RPC bywa węższy niż typ (starszy profil, nowa kolumna).
    const { result } = await prefill({ rows: [{ id: "profil-1" }] });
    for (const [field, value] of Object.entries(result)) {
      expect(typeof value, `pole ${field}`).toBe("string");
    }
  });

  it("pojedyncze puste kolumny nie psują sąsiadów", async () => {
    const { result } = await prefill({
      rows: [profile({ phone: null, linkedin_url: null, location: null })],
    });
    expect(result).toMatchObject({
      phone: "",
      linkedinUrl: "",
      country: "",
      company: "Instytut Przykladowy",
      lastName: "Przykladowska",
    });
  });
});

describe("awaria odczytu jest cicha - prefill nie może zablokować zgłoszenia", () => {
  it("błąd RPC oddaje pusty komplet i NIE rzuca", async () => {
    const call = prefill({ error: { message: "permission denied for function" } });
    await expect(call).resolves.toBeDefined();
    expect((await call).result).toEqual(EMPTY);
  });

  it("błąd RPC wygrywa nad wierszem, gdyby baza oddała oba", async () => {
    const { result } = await prefill({
      rows: [profile()],
      error: { message: "statement timeout" },
    });
    expect(result).toEqual(EMPTY);
  });

  it.each([
    ["brak danych", null],
    ["pusta tablica - profil jeszcze nie istnieje", []],
  ])("%s oddaje pusty komplet", async (_label, rows) => {
    const { result } = await prefill({ rows });
    expect(result).toEqual(EMPTY);
  });
});

describe("obudowa server fn - deklaracje, których handler nie egzekwuje", () => {
  it("deklaruje `requireSupabaseAuth` - prefill istnieje tylko dla zalogowanych", () => {
    expect(asServerFn(getClubApplyPrefill).middleware).toContain(requireSupabaseAuth);
  });

  it("jest GET-em BEZ walidatora, bo nie przyjmuje żadnego wejścia", () => {
    // Brak wejścia to najmocniejsza możliwa bramka zakresu: nie ma parametru,
    // przez który dałoby się poprosić o cudzy profil.
    const spec = asServerFn(getClubApplyPrefill);
    expect(spec.method).toBe("GET");
    expect(spec.validator).toBeUndefined();
  });
});
