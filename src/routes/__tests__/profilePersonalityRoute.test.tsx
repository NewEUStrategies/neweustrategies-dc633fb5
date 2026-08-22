// Trasa `/profile/personality` ZAMONTOWANA: pulpit Big Five + quiz z autozapisem.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// Reguły punktacji Big Five mieszkają w `lib/profile/personality.ts` i są na
// progu 100% (`lib/profile/__tests__/personality.test.ts`). Tutaj nie ma ani
// jednej asercji na wartość osi liczoną „z ręki" - przedmiotem dowodu jest
// SKLEJENIE: czy trasa woła punktację, co robi z odpowiedziami, których nie ma,
// i czy potrafi powiedzieć „nie udało się odczytać" innym zdaniem niż „nic tu
// jeszcze nie ma".
//
//   1. WYNIK, KTÓREGO NIE MA, TO NIE WYNIK, KTÓREGO NIE UDAŁO SIĘ ODCZYTAĆ.
//      Awaria odczytu `personality_results` przenosi użytkownika na CZYSTY
//      quiz - dokładnie tak, jakby nigdy go nie wypełnił. Konsekwencja: osoba
//      z zapisanym profilem osobowości widzi „wypełnij test", wypełnia go
//      ponownie i NADPISUJE swój wynik (historia jest append-only, więc zostaje
//      w niej podejście wykonane wyłącznie dlatego, że baza chwilowo nie
//      odpowiedziała). Zgłoszone jako `it.fails`.
//   2. PUSTA LISTA PYTAŃ NIE MOŻE DAWAĆ AKTYWNEGO ZAPISU. `isComplete` na
//      pustej liście pytań jest prawdziwe (`[].every` = true), więc awaria
//      odczytu `personality_questions` daje quiz bez pytań, AKTYWNY przycisk
//      „Zapisz" i wynik 0/0/0/0/0 w bazie oraz w append-only historii.
//      Konsekwencja: sfabrykowany profil osobowości, którego użytkownik nigdy
//      nie wypełnił. Zgłoszone jako `it.fails`.
//   3. ZAPIS, KTÓRY NIC NIE ROBI, MUSI TO POWIEDZIEĆ. Gdy odczyt `tenant_id`
//      z `profiles` padnie, `onSubmit` wychodzi cichym `return` - trzydzieści
//      odpowiedzi, klik i ZERO reakcji. Konsekwencja: użytkownik klika
//      w kółko, nie wiedząc, że zapis nie ma dokąd trafić. Zgłoszone jako
//      `it.fails`.
//   4. SZKIC PRZEŻYWA PRZEŁADOWANIE, ALE NIE PRZEŻYWA UŚMIECHU AWARII.
//      Odpowiedzi lecą do `localStorage` po każdej zmianie; uszkodzony wpis
//      (nie-JSON, nie-obiekt, wartości poza 1..5) MUSI dać pusty quiz, a nie
//      wywrócić trasę. Tryb prywatny przeglądarki (rzucający magazyn) też nie
//      ma prawa zabrać dostępu do testu.
//   5. INFORMACJA O PRZYWRÓCONYM SZKICU TYLKO WTEDY, GDY WIDAĆ ODPOWIEDZI.
//      Komunikat na pulpicie mówiłby o odpowiedziach, których nie ma na
//      ekranie - i tylko RAZ na wejście, nie przy każdym renderze.
//   6. PAYLOAD ZAPISU JEST KONTRAKTEM BAZY, NIE DETALEM. `onConflict:
//      "user_id"` to naprawiony błąd (PK to `user_id`; wcześniejsze
//      „user_id,tenant_id" Postgres odrzucał kodem 42P10 i zapis NIGDY nie
//      przechodził). Test pilnuje tego jednego pola, bo jego regresja jest
//      niewidoczna do pierwszego zapisu w produkcji.
//   7. BŁĄD ZAPISU NIE KASUJE ODPOWIEDZI. Po nieudanym upsercie odpowiedzi
//      i szkic zostają - inaczej użytkownik traci trzydzieści decyzji za jeden
//      timeout sieci.
//   8. HISTORIA Z JEDNYM PODEJŚCIEM TO NIE HISTORIA. Jeden wiersz daje zdanie
//      wyjaśniające, dwa i więcej - delty per oś (w górę / w dół / bez zmiany).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - PUNKTACJI I KOMPLETNOŚCI: `scoreAnswers`, `isComplete`, `answeredCount`
//   mają tabelę przypadków w `src/lib/profile/__tests__/personality.test.ts`
//   (próg 100%). Payload zapisu porównujemy z WYNIKIEM tej biblioteki, a nie
//   z liczbami przepisanymi do testu - to dowód sklejenia, nie kopia reguł.
// - BRAMKI SESJI: `AuthGate` i cała powłoka `/profile` mają
//   `src/routes/__tests__/profileShellRoutes.test.tsx`; tutaj sprawdzamy tylko,
//   że trasa jest w nią OWINIĘTA (bo bez tego quiz renderowałby się gościowi).
// - RLS/RPC: dostęp do `personality_results`, `personality_result_history`
//   i triggera wypełniającego historię pilnuje pgTAP.
// - SŁOWNIKÓW: `lib/i18n-personality` ma własną bramkę kluczy; tu asercje
//   idą na KLUCZE, nie na napisy.
//
// GAŁĘZIE NIEOSIĄGALNE Z TESTU.
// - `if (!complete) return toast.error(...)` w `onSubmit` (linia 279): jedyne
//   wejście w `onSubmit` to przycisk z `disabled={!complete || submitting}`,
//   więc do tej obrony nie ma drogi. Zostaje w kodzie na wypadek dodania
//   drugiego wywołania (np. skrótu klawiszowego).
// - `typeof window === "undefined"` w `readDraft`/`writeDraft` (linie 62, 80):
//   gałąź SSR, nieosiągalna w środowisku DOM testu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  /** Sesja i tożsamość - `null` znaczy „gość". */
  session: {} as unknown,
  authLoading: false,
  user: { id: "user-1" } as { id: string } | null,
  language: "pl" as string,
  /** Atrapa klienta Supabase; przypisywana w fabryce `vi.mock`. */
  db: null as SupabaseFromStub | null,
  /** Bramka na obietnicy: dopóki żyje, KAŻDY odczyt wisi (stan „w locie"). */
  gate: null as Promise<void> | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-profile-extras2", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-personality", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    loading: h.authLoading,
    user: h.user,
    roles: [],
    isAdmin: false,
  }),
}));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: (props: { error: { status: number } }) => (
    <div data-testid="friendly-error" data-status={String(props.error.status)} />
  ),
}));
// `Link` bez pełnego drzewa tras - harness montuje JEDNĄ trasę, więc odnośnik
// do `/profile` nie ma dopasowania. Zwykła kotwica oddaje kontrakt (adres).
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  // Bramka „w locie": builder, którego ogniwa terminalne czekają na zwolnienie
  // obietnicy. Bez tego pierwszego stanu nie da się odróżnić od pustki.
  //
  // PO ZWOLNIENIU BRAMKI ZAPYTANIE MUSI DOSTAĆ ZAPLANOWANĄ ODPOWIEDŹ, nie
  // pustkę. Builder zapisuje więc wywołane ogniwa i po zwolnieniu ODTWARZA ten
  // sam łańcuch na prawdziwej atrapie. Wersja rozwiązująca się do
  // `{ data: null }` sprawiała, że test „w locie → wynik" nigdy nie dochodził
  // do wyniku: mierzyłby wyłącznie własne rusztowanie.
  const CHAIN = ["select", "eq", "order", "limit", "upsert", "insert", "update"] as const;
  type Terminal = "single" | "maybeSingle";
  type Link = (...args: unknown[]) => unknown;
  const hanging = (gate: Promise<void>, table: string): Record<string, unknown> => {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    const replay = async (terminal?: Terminal): Promise<unknown> => {
      await gate;
      let real: Record<string, unknown> = db.from(table) as Record<string, unknown>;
      for (const call of calls) {
        const link = real[call.method];
        if (typeof link !== "function") {
          throw new Error(`test: atrapa nie zna ogniwa "${call.method}"`);
        }
        real = (link as Link)(...call.args) as Record<string, unknown>;
      }
      if (!terminal) return real;
      const finish = real[terminal];
      if (typeof finish !== "function") {
        throw new Error(`test: atrapa nie zna ogniwa "${terminal}"`);
      }
      return (finish as Link)();
    };
    builder.maybeSingle = () => replay("maybeSingle");
    builder.single = () => replay("single");
    builder.then = (onFulfilled?: (value: unknown) => unknown) => replay().then(onFulfilled);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.gate ? hanging(h.gate, table) : db.from(table)),
    },
  };
});

import { renderRoute } from "@/test/routeHarness";
import { fail, ok, type RecordedChain } from "@/test/supabaseChain";
import { AXES, scoreAnswers, type PersonalityQuestion } from "@/lib/profile/personality";
import { Route as PersonalityRoute } from "@/routes/profile.personality";

/** Ustalona data bazowa - `taken_at` w payloadzie zapisu musi być powtarzalny. */
const NOW = new Date("2026-08-21T09:30:00.000Z");
const DRAFT_KEY = "nes.personality.draft.v1";

/**
 * Atrapa klienta jako WARTOŚĆ, nie rzutowanie: strażnik sprawdza w runtime, że
 * fabryka `vi.mock` naprawdę ją podstawiła. Test „przechodzący" na braku atrapy
 * nie dowodziłby niczego o zapytaniach trasy.
 */
function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return stub;
}

/** Pięć pytań, po jednym na oś; jedno odwrócone - tyle wystarczy na sklejenie. */
const QUESTIONS: PersonalityQuestion[] = [
  {
    id: 1,
    axis: "openness",
    reverse: false,
    text_pl: "Ciekawość",
    text_en: "Curiosity",
    sort_order: 1,
  },
  {
    id: 2,
    axis: "conscientiousness",
    reverse: false,
    text_pl: "Plan",
    text_en: "Plan",
    sort_order: 2,
  },
  { id: 3, axis: "extraversion", reverse: true, text_pl: "Cisza", text_en: "Quiet", sort_order: 3 },
  {
    id: 4,
    axis: "agreeableness",
    reverse: false,
    text_pl: "Ugoda",
    text_en: "Accord",
    sort_order: 4,
  },
  {
    id: 5,
    axis: "neuroticism",
    reverse: false,
    text_pl: "Napięcie",
    text_en: "Tension",
    sort_order: 5,
  },
];

/** Zapisany wynik: wartości celowo dobrane na trzy pasma i oba progi (35, 65). */
const RESULT = {
  openness: 82,
  conscientiousness: 50,
  extraversion: 20,
  agreeableness: 35,
  neuroticism: 66,
  taken_at: "2026-08-01T08:00:00.000Z",
  tenant_id: "tenant-1",
};

interface HistoryFixture {
  id: string;
  user_id: string;
  tenant_id: string;
  created_at: string;
  taken_at: string;
  answers: null;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

function historyRow(id: string, takenAt: string, values: number[]): HistoryFixture {
  const [openness, conscientiousness, extraversion, agreeableness, neuroticism] = values;
  return {
    id,
    user_id: "user-1",
    tenant_id: "tenant-1",
    created_at: takenAt,
    taken_at: takenAt,
    answers: null,
    openness: openness ?? 0,
    conscientiousness: conscientiousness ?? 0,
    extraversion: extraversion ?? 0,
    agreeableness: agreeableness ?? 0,
    neuroticism: neuroticism ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  h.session = {};
  h.authLoading = false;
  h.user = { id: "user-1" };
  h.language = "pl";
  h.gate = null;
  db().reset();
  window.localStorage.clear();
  db().setResponse("personality_questions", ok(QUESTIONS));
  db().setResponse("personality_results", ok(null));
  db().setResponse("personality_result_history", ok([]));
  db().setResponse("profiles", ok({ tenant_id: "tenant-1" }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function mount() {
  return renderRoute({
    route: PersonalityRoute,
    path: "/profile/personality",
    initialEntry: "/profile/personality",
  });
}

/** Czeka, aż quiz się wyrenderuje (postęp jest jego stałym elementem). */
async function waitForQuiz(total = QUESTIONS.length) {
  await waitFor(() =>
    expect(screen.getByText(`profile.personality.progress(done=0,total=${total})`)).toBeTruthy(),
  );
}

/** Klika odpowiedź `value` w pytaniu o numerze `index` (licząc od 1). */
function answer(index: number, value: number) {
  const group = screen.getByRole("radiogroup", { name: `Q${index}` });
  const options = within(group).getAllByRole("radio");
  const option = options[value - 1];
  if (!option) throw new Error(`test: brak odpowiedzi ${value} w pytaniu ${index}`);
  fireEvent.click(option);
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: "profile.personality.submit" });
}

describe("/profile/personality - bramka sesji", () => {
  it("BRAK SESJI zamyka quiz odmową 401, a nie pustym testem", async () => {
    // Quiz osobowości zapisuje dane wrażliwe do profilu - gość nie ma prawa
    // zobaczyć ani formularza, ani wyniku właściciela.
    h.session = null;
    await mount();
    expect(screen.getByTestId("friendly-error").getAttribute("data-status")).toBe("401");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    // Bez sesji trasa nie ma prawa nawet pytać bazy o pytania.
    expect(db().chains).toHaveLength(0);
  });

  it("OCZEKIWANIE na sesję pokazuje wskaźnik, nie odmowę", async () => {
    // Migotanie ekranu 401 przy zimnym starcie wygląda jak wylogowanie.
    h.authLoading = true;
    h.session = null;
    await mount();
    expect(screen.getByLabelText("loading")).toBeTruthy();
    expect(screen.queryByTestId("friendly-error")).toBeNull();
  });
});

describe("/profile/personality - trzy rozłączne stany odczytu", () => {
  it("ODCZYT W LOCIE to wskaźnik, a nie „brak wyniku”", async () => {
    // Bramka na obietnicy: zanim Data API odpowie, użytkownik nie może dostać
    // czystego quizu - to sugerowałoby, że jego poprzedni wynik zniknął.
    // Domyślna, pusta funkcja zamiast `null`: przypisanie wewnątrz konstruktora
    // obietnicy jest niewidoczne dla analizy przepływu TypeScriptu, więc
    // strażnik `release === null` zawężał typ do `never` i wywołanie przestawało
    // się kompilować. Domyślna wartość usuwa problem bez rzutowania.
    let release: () => void = () => undefined;
    h.gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    db().setResponse("personality_results", ok(RESULT));
    await mount();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("personality.dashboardTitle")).toBeNull();
    h.gate = null;
    release();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
  });

  it("BRAK WYNIKU (pusty wiersz) otwiera quiz od zera", async () => {
    db().setResponse("personality_results", ok(null));
    await mount();
    await waitForQuiz();
    expect(screen.queryByText("personality.dashboardTitle")).toBeNull();
    // Pustka to nie awaria: użytkownik dostaje zaproszenie, nie komunikat.
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("PGRST116 (brak wiersza w `maybeSingle`) jest traktowane jak brak wyniku", async () => {
    // To nie awaria, a normalna odpowiedź PostgREST na „nie ma wiersza".
    db().setResponse("personality_results", fail("no rows", "PGRST116"));
    await mount();
    await waitForQuiz();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.fails(
    "DEFEKT: awaria odczytu wyniku wygląda IDENTYCZNIE jak „nie wypełniłeś testu”",
    async () => {
      // CO JEST ZŁAMANE. `qPrev` rzuca na błędzie innym niż PGRST116, ale trasa
      // czyta wyłącznie `qPrev.data`. Brak danych = tryb „quiz", więc awaria
      // odczytu (RLS, timeout, 500) daje ten sam ekran co pierwsza wizyta.
      //
      // JAKA KONSEKWENCJA DLA UŻYTKOWNIKA. Osoba z zapisanym profilem widzi
      // „wypełnij test", wypełnia go i NADPISUJE swój wynik. Historia jest
      // append-only i wypełniana triggerem, więc zostaje w niej podejście
      // wykonane tylko dlatego, że baza chwilowo nie odpowiedziała - a wykres
      // zmian osobowości w czasie pokazuje skok, którego nie było.
      //
      // DLACZEGO NIE NAPRAWIAM. Wybór zachowania przy nieczytelnym wyniku jest
      // decyzją produktową (zablokować quiz? pokazać wynik z cache? pozwolić
      // wypełnić, ale nie nadpisywać?), a nie brakiem w teście.
      db().setResponse("personality_results", fail("permission denied", "42501"));
      await mount();
      await waitFor(() => expect(screen.getByText("profile.personality.title")).toBeTruthy());
      // Czegokolwiek, co mówi „nie udało się odczytać" - dziś nie ma nic.
      expect(screen.queryByText(/error|failed|blad|błąd/i)).not.toBeNull();
    },
  );

  it.fails("DEFEKT: awaria odczytu PYTAŃ daje aktywny zapis wyniku 0/0/0/0/0", async () => {
    // CO JEST ZŁAMANE. `isComplete(answers, [])` to `[].every(...)`, czyli
    // PRAWDA. Gdy odczyt `personality_questions` padnie (albo tabela wróci
    // pusta), quiz renderuje się bez ani jednego pytania, przycisk „Zapisz"
    // jest AKTYWNY, a `scoreAnswers({}, [])` zwraca zera na wszystkich osiach.
    //
    // JAKA KONSEKWENCJA DLA UŻYTKOWNIKA. Jedno kliknięcie zapisuje profil
    // osobowości 0/0/0/0/0 - wynik, którego nikt nie wypełnił - do
    // `personality_results` ORAZ do append-only historii. Pulpit pokaże go
    // jako „niski" na wszystkich pięciu osiach i tego wpisu nie da się już
    // z historii usunąć z interfejsu.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka dotyka kontraktu `isComplete` dla
    // pustej listy (biblioteka na progu 100% z własnym plikiem testowym) albo
    // wymaga w trasie osobnego stanu „brak pytań" - to decyzja projektowa.
    db().setResponse("personality_questions", fail("relation missing", "42P01"));
    await mount();
    await waitForQuiz(0);
    expect(submitButton()).toBeDisabled();
  });

  it("AWARIA ODCZYTU HISTORII nie zabiera pulpitu - paski cech zostają", async () => {
    // Historia jest dodatkiem; jej awaria nie ma prawa schować wyniku, który
    // odczytał się poprawnie. (Że sama historia milczy wtedy tak samo jak przy
    // jednym podejściu - patrz punkt 1 nagłówka: ta sama klasa defektu.)
    db().setResponse("personality_results", ok(RESULT));
    db().setResponse("personality_result_history", fail("timeout", "57014"));
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    expect(screen.getByText("personality.historyEmpty")).toBeTruthy();
    expect(screen.getByText("82")).toBeTruthy();
  });
});

describe("/profile/personality - pulpit wyniku", () => {
  beforeEach(() => {
    db().setResponse("personality_results", ok(RESULT));
  });

  it("pokazuje PIĘĆ osi z wartością i pasmem interpretacji", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    for (const axis of AXES) {
      expect(screen.getByText(`profile.personality.axes.${axis}`)).toBeTruthy();
    }
    // Trzy pasma i OBA progi: 82 = wysokie, 66 = wysokie (>65), 50 i 35 =
    // umiarkowane (35 nie jest już niskie), 20 = niskie.
    expect(screen.getByText("personality.interpretations.openness.high")).toBeTruthy();
    expect(screen.getByText("personality.interpretations.neuroticism.high")).toBeTruthy();
    expect(screen.getByText("personality.interpretations.conscientiousness.medium")).toBeTruthy();
    expect(screen.getByText("personality.interpretations.agreeableness.medium")).toBeTruthy();
    expect(screen.getByText("personality.interpretations.extraversion.low")).toBeTruthy();
    expect(screen.getAllByText("personality.bands.high")).toHaveLength(2);
  });

  it("data ostatniego podejścia jest FORMATOWANA JĘZYKIEM interfejsu", async () => {
    // Bez tego użytkownik EN dostaje polski format daty w angielskim panelu.
    await mount();
    const pl = await screen.findByText(/^personality\.lastTaken\(date=/);
    const plDate = pl.textContent ?? "";
    cleanup();
    h.language = "en";
    await mount();
    const en = await screen.findByText(/^personality\.lastTaken\(date=/);
    expect(en.textContent).not.toBe(plDate);
    expect(en.textContent).toContain("2026");
  });

  it("JEDNO podejście to nie historia - zdanie wyjaśniające, nie tabela", async () => {
    db().setResponse(
      "personality_result_history",
      ok([historyRow("h1", "2026-08-01T08:00:00.000Z", [82, 50, 20, 35, 66])]),
    );
    await mount();
    await waitFor(() => expect(screen.getByText("personality.historyEmpty")).toBeTruthy());
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("DWA podejścia dają delty per oś: wzrost, spadek i brak zmiany", async () => {
    // Bez znaku i kierunku historia jest kolumną liczb, a nie informacją
    // „co się u mnie zmieniło".
    db().setResponse(
      "personality_result_history",
      ok([
        historyRow("h2", "2026-08-01T08:00:00.000Z", [82, 40, 20, 35, 66]),
        historyRow("h1", "2026-01-01T08:00:00.000Z", [70, 50, 20, 35, 66]),
      ]),
    );
    await mount();
    const rows = await waitFor(() => {
      const found = screen.getAllByRole("listitem");
      expect(found).toHaveLength(2);
      return found;
    });
    const newest = rows[0];
    if (!newest) throw new Error("test: brak wiersza historii");
    // openness 70 -> 82 (+12), conscientiousness 50 -> 40 (-10), reszta bez zmian.
    expect(newest.textContent).toContain("12");
    expect(newest.textContent).toContain("10");
    expect(newest.textContent).toContain("-");
    // Najstarszy wiersz nie ma z czym się porównać - żadnych delt.
    expect(rows[1]?.textContent).not.toContain("-");
  });

  it("zapytanie o historię jest ZAWĘŻONE do właściciela i przycięte", async () => {
    // Payload zapytania, nie DOM: bez `.eq(user_id)` i limitu pulpit ciągnąłby
    // cudze podejścia (RLS by je ucięło, ale koszt i intencja są tu jawne).
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    const chain = db().lastChain("personality_result_history");
    expect(chain?.argsOf("eq")).toEqual(["user_id", "user-1"]);
    expect(chain?.argsOf("order")).toEqual(["taken_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([12]);
  });

  it("„wypełnij ponownie” przechodzi do quizu i zostawia DROGĘ POWROTU", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /personality\.retakeCta/ }));
    await waitForQuiz();
    // Powrót jest PRZYCISKIEM (nie odnośnikiem do /profile), bo wynik nadal
    // istnieje - inaczej użytkownik traci go z oczu bez wyjścia.
    const back = screen.getByRole("button", { name: /personality\.backToDashboard/ });
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
  });

  it("na pulpicie NIE MA komunikatu o przywróconym szkicu", async () => {
    // Komunikat mówiłby o odpowiedziach, których na ekranie nie widać.
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ 1: 4, 2: 3 }));
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    expect(h.toastInfo).not.toHaveBeenCalled();
  });
});

describe("/profile/personality - quiz i szkic", () => {
  it("odpowiedź trafia do SZKICU w magazynie lokalnym (payload, nie DOM)", async () => {
    await mount();
    await waitForQuiz();
    answer(1, 4);
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).toBe(JSON.stringify({ 1: 4 })),
    );
    answer(3, 2);
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).toBe(JSON.stringify({ 1: 4, 3: 2 })),
    );
    expect(screen.getByText("profile.personality.progress(done=2,total=5)")).toBeTruthy();
  });

  it("PRZYWRÓCONY szkic wraca na ekran i mówi o tym DOKŁADNIE RAZ", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ 1: 5, 2: 2 }));
    await mount();
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=2,total=5)")).toBeTruthy(),
    );
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalledWith("personality.draftRestored"));
    // Kolejne odpowiedzi przerenderowują trasę - komunikat nie ma prawa wrócić.
    answer(3, 3);
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=3,total=5)")).toBeTruthy(),
    );
    expect(h.toastInfo).toHaveBeenCalledTimes(1);
  });

  it("USZKODZONY szkic daje pusty quiz, a nie wywróconą trasę", async () => {
    // Trzy klasy śmiecia w jednym wpisie: nie-JSON obsługuje `catch`,
    // a wartości poza 1..5 i klucze nieliczbowe - filtr wpisu.
    window.localStorage.setItem(DRAFT_KEY, "{to nie jest json");
    await mount();
    await waitForQuiz();
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("szkic z wartościami POZA SKALĄ jest odrzucany wpis po wpisie", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ 1: 9, 2: 0, 3: "trzy", abc: 4, 5: 3 }));
    await mount();
    // Z pięciu wpisów przechodzi JEDEN (`5: 3`) - reszta jest poza skalą,
    // nieliczbowa albo ma klucz, który nie jest identyfikatorem pytania.
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=1,total=5)")).toBeTruthy(),
    );
  });

  it("szkic zapisany jako NIE-OBIEKT jest ignorowany", async () => {
    window.localStorage.setItem(DRAFT_KEY, "42");
    await mount();
    await waitForQuiz();
  });

  it("AWARIA MAGAZYNU nie zabiera dostępu do testu", async () => {
    // Tryb prywatny przeglądarki rzuca na `getItem`/`setItem`; szkic po prostu
    // nie przetrwa przeładowania - ale quiz musi działać.
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await mount();
    await waitForQuiz();
    answer(1, 3);
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=1,total=5)")).toBeTruthy(),
    );
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("„wyczyść” zeruje odpowiedzi ORAZ szkic, nie tylko ekran", async () => {
    await mount();
    await waitForQuiz();
    answer(1, 4);
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /profile\.personality\.retake/ }));
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.getByText("profile.personality.progress(done=0,total=5)")).toBeTruthy();
  });

  it("przycisk „wyczyść” pojawia się DOPIERO po pierwszej odpowiedzi", async () => {
    await mount();
    await waitForQuiz();
    expect(screen.queryByRole("button", { name: /profile\.personality\.retake/ })).toBeNull();
    answer(2, 1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /profile\.personality\.retake/ })).toBeTruthy(),
    );
  });

  it("odpowiedź jest ZAZNACZONA i nadpisywalna (jedna na pytanie)", async () => {
    await mount();
    await waitForQuiz();
    answer(1, 2);
    const group = screen.getByRole("radiogroup", { name: "Q1" });
    await waitFor(() =>
      expect(
        within(group)
          .getAllByRole("radio")
          .filter((el) => el.getAttribute("aria-checked") === "true"),
      ).toHaveLength(1),
    );
    answer(1, 5);
    await waitFor(() => {
      const checked = within(group)
        .getAllByRole("radio")
        .filter((el) => el.getAttribute("aria-checked") === "true");
      expect(checked).toHaveLength(1);
      expect(checked[0]?.textContent).toContain("5");
    });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(JSON.stringify({ 1: 5 }));
  });

  it("treść pytania idzie za JĘZYKIEM interfejsu", async () => {
    h.language = "en";
    await mount();
    await waitForQuiz();
    expect(screen.getByText(/Curiosity/)).toBeTruthy();
    expect(screen.queryByText(/Ciekawość/)).toBeNull();
  });

  it("PODGLĄD wyniku pojawia się dopiero po skompletowaniu odpowiedzi", async () => {
    await mount();
    await waitForQuiz();
    answer(1, 5);
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=1,total=5)")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.personality.yourScore")).toBeNull();
    for (const index of [2, 3, 4, 5]) answer(index, 5);
    await waitFor(() => expect(screen.getByText("profile.personality.yourScore")).toBeTruthy());
  });
});

describe("/profile/personality - zapis wyniku", () => {
  /** Wypełnia cały quiz wartością `value` i czeka na aktywny przycisk zapisu. */
  async function fillAll(value = 5) {
    await waitForQuiz();
    for (const index of [1, 2, 3, 4, 5]) answer(index, value);
    await waitFor(() => expect(submitButton()).toBeEnabled());
  }

  it("NIEKOMPLETNE odpowiedzi blokują zapis i NIC nie wysyłają", async () => {
    await mount();
    await waitForQuiz();
    answer(1, 3);
    answer(2, 3);
    await waitFor(() =>
      expect(screen.getByText("profile.personality.progress(done=2,total=5)")).toBeTruthy(),
    );
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(
      db()
        .chainsFor("personality_results")
        .some((c) => c.has("upsert")),
    ).toBe(false);
  });

  it("PAYLOAD zapisu: wynik z biblioteki, `onConflict` na kluczu głównym, data z zegara", async () => {
    // Asercja na PAYLOADZIE, nie na DOM. `onConflict: "user_id"` to naprawiony
    // błąd 42P10 - PK tabeli to `user_id`, a nie `(user_id, tenant_id)`.
    // Wartości osi porównujemy z WYNIKIEM `scoreAnswers`, żeby nie przepisywać
    // reguł punktacji, które mają własny plik testowy.
    const upserts: unknown[][] = [];
    db().setResponse("personality_results", (chain: RecordedChain) => {
      const args = chain.argsOf("upsert");
      if (args) {
        upserts.push([...args]);
        return ok(null);
      }
      return ok(null);
    });
    await mount();
    await fillAll(5);
    fireEvent.click(submitButton());
    await waitFor(() => expect(upserts).toHaveLength(1));
    const answers = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 };
    const payload = upserts[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: "user-1",
      tenant_id: "tenant-1",
      ...scoreAnswers(answers, QUESTIONS),
      answers,
    });
    // `taken_at` STEMPLUJE ZEGAR, nie wiersz z bazy - i to jest przedmiotem
    // dowodu. Asercja idzie na OKNO, nie na milisekundę: zegar testu biegnie
    // z `shouldAdvanceTime: true` (bez tego `waitFor` nie ma jak postąpić),
    // więc między ustawieniem daty bazowej a kliknięciem „Zapisz" upływa realny
    // czas wykonania testu. Okno pięciu sekund jest deterministyczne (przebieg
    // trwa dziesiątki milisekund), a wciąż odrzuca stempel wzięty z fixture'a.
    const stamped = new Date(String(payload.taken_at)).getTime();
    expect(stamped).toBeGreaterThanOrEqual(NOW.getTime());
    expect(stamped).toBeLessThan(NOW.getTime() + 5_000);
    expect(upserts[0]?.[1]).toEqual({ onConflict: "user_id" });
  });

  it("po UDANYM zapisie: szkic wyczyszczony, komunikat, pulpit z NOWYM wynikiem", async () => {
    let saved = false;
    db().setResponse("personality_results", (chain: RecordedChain) => {
      if (chain.has("upsert")) {
        saved = true;
        return ok(null);
      }
      return ok(saved ? RESULT : null);
    });
    await mount();
    await fillAll(5);
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("profile.personality.saved"));
    // Szkic musi zniknąć - inaczej „wypełnij ponownie" startuje z odpowiedziami
    // z poprzedniego podejścia.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    // Inwalidacja zapytań przenosi na pulpit z odczytanym wynikiem.
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
  });

  it("BŁĄD zapisu mówi to wprost i NIE KASUJE odpowiedzi", async () => {
    db().setResponse("personality_results", (chain: RecordedChain) =>
      chain.has("upsert") ? fail("duplicate key value") : ok(null),
    );
    await mount();
    await fillAll(4);
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("duplicate key value"));
    // Trzydzieści decyzji nie może wyparować przy jednym timeoucie sieci.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(
      JSON.stringify({ 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 }),
    );
    expect(screen.getByText("profile.personality.progress(done=5,total=5)")).toBeTruthy();
    expect(screen.queryByText("personality.dashboardTitle")).toBeNull();
  });

  it.fails(
    "DEFEKT: bez odczytanego `tenant_id` klik „Zapisz” nic nie robi i NIC nie mówi",
    async () => {
      // CO JEST ZŁAMANE. `onSubmit` zaczyna się od `if (!user ||
      // !profileQ.data?.tenant_id) return;` - CICHEGO wyjścia. Gdy odczyt
      // `profiles` padnie (RLS, timeout, brak wiersza profilu), przycisk jest
      // aktywny, bo `complete` liczy się z odpowiedzi, nie z gotowości zapisu.
      //
      // JAKA KONSEKWENCJA DLA UŻYTKOWNIKA. Wypełnia cały test, klika „Zapisz"
      // i NIC się nie dzieje: żadnego komunikatu, żadnej zmiany ekranu, żadnego
      // zapytania do bazy. Klika drugi i trzeci raz, po czym zamyka kartę
      // z przekonaniem, że aplikacja jest zepsuta - i ma rację, tylko nie ma
      // z czego tego wyczytać.
      //
      // DLACZEGO NIE NAPRAWIAM. Wybór między „zablokuj przycisk", „powiedz
      // o awarii" i „spróbuj odczytać tenanta ponownie" jest decyzją
      // projektową; test ma ten stan opisać, a nie przesądzić.
      db().setResponse("profiles", fail("permission denied", "42501"));
      await mount();
      await fillAll(5);
      fireEvent.click(submitButton());
      await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    },
  );

  it("zapytanie o wynik i o tenanta jest ZAWĘŻONE do zalogowanego użytkownika", async () => {
    // Payload odczytu: bez `.eq(user_id)` pulpit czytałby cudzy profil (RLS by
    // to ucięło, ale intencja musi być w kodzie trasy).
    db().setResponse("personality_results", ok(RESULT));
    await mount();
    await waitFor(() => expect(screen.getByText("personality.dashboardTitle")).toBeTruthy());
    expect(db().lastChain("personality_results")?.argsOf("eq")).toEqual(["user_id", "user-1"]);
    expect(db().lastChain("profiles")?.argsOf("eq")).toEqual(["id", "user-1"]);
    // Pytania są wspólne dla wszystkich - sortowane, ale nie filtrowane.
    expect(db().lastChain("personality_questions")?.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
    expect(db().lastChain("personality_questions")?.has("eq")).toBe(false);
  });
});
