// Trasa `/admin/research-programs` ZAMONTOWANA - panel stron programów
// badawczych (think-tank): dossier programu + cztery zasoby podrzędne
// (zespół, projekty, partnerzy, wybrane materiały).
//
// CO TEN PLIK POKRYWA, CZEGO NIE POKRYWA NIC INNEGO.
//
// Ta trasa ma dwa `useQuery` na poziomie strony i pięć kolejnych
// w zakładkach, wszystkie z klientem Supabase WPROST w `queryFn`. Wiązanie
// pól z kolumnami, reakcja na odmowę bazy i lista unieważnianych kluczy żyją
// od 2026-10 w `lib/programs/adminForm.ts` (wcześniej: trzydzieści kilka
// niemal identycznych domknięć `onChange`/`onClick`), więc ten plik dowodzi
// SKLEJENIA - że KAŻDE pole trafia w SWOJĄ kolumnę ładunku - a nie mechaniki
// wiązania (ta ma test jednostkowy obok modułu).
//
// SZEŚĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. BEZ KONTEKSTU OBSZARU ROBOCZEGO PANEL NIE PYTA BAZY. `useRequiredTenant`
//      RZUCA, gdy `tenantId` jest `null` (świeży token, brak wiersza profilu).
//      Zapytanie wysłane bez tenanta czytałoby to, co przepuści RLS - a klucz
//      cache (`["admin-research-programs", tenantId]`) zlałby wtedy wyniki
//      dwóch obszarów w jeden wpis.
//   2. ZAPIS NIESIE `tenant_id`. Wiersz `research_programs` bez tenanta to
//      program, którego nie widzi żadna strona publiczna - albo, gdyby RLS
//      kiedyś zwolnił kolumnę, program widoczny u wszystkich najemców.
//   3. SLUG JEST WALIDOWANY PRZED ZAPYTANIEM. Slug decyduje o adresie strony
//      publicznej programu; wpuszczenie spacji albo wielkich litery daje adres
//      404 dla kampanii, która już poszła.
//   4. USUNIĘCIE PROGRAMU WYMAGA POTWIERDZENIA I KASKADUJE. Program niesie
//      zespół, projekty, partnerów i wybrane materiały - jedno kliknięcie bez
//      pytania usuwa cały landing.
//   5. KAŻDY ZAPIS UNIEWAŻNIA WŁAŚCIWY KLUCZ. Klucze zasobów podrzędnych są
//      zawężone identyfikatorem programu; unieważnienie szerszego prefiksu
//      przeładowywałoby wszystko, węższego - nic. Zapis PROGRAMU rusza
//      dodatkowo wszystkich czytelników wiersza `programs` (strony publiczne,
//      drugi panel, katalog ekspertów), a zapis zasobu podrzędnego - landingi
//      publiczne, które ten zasób renderują.
//   6. USUNIĘCIE CZŁONKA ZESPOŁU FILTRUJE PO OBU KOLUMNACH KLUCZA. Tabela
//      `research_program_members` ma klucz złożony (`program_id`,
//      `profile_id`); `delete().eq("profile_id", ...)` bez programu wypisałby
//      tę osobę ze WSZYSTKICH programów naraz.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU DO PANELU: `/admin` przepuszcza tylko `isStaff` (redirect na
//   `/login`), a prawo zapisu do tych pięciu tabel egzekwuje RLS. Warstwy
//   pilnuje `src/routes/__tests__/adminRouteAuthority.gate.test.ts` czytając
//   pliki tras; ta trasa nie ma własnej bramki roli i mieć jej nie musi.
// - IKON PROGRAMÓW: `PROGRAM_ICONS` i `ProgramIcon` mają własne asercje.
// - MECHANIKI WIĄZANIA PÓL („puste opcjonalne to NULL", „śmieci w liczbie to
//   0"): to reguły `bindDraft`, dowiedzione w `lib/programs/__tests__`. Tutaj
//   jedna tabela pól na formularz dowodzi tego, czego test jednostkowy nie
//   widzi: że `tagline_en` nie siedzi w polu PL. Klikanie pól pojedynczo, test
//   po teście, byłoby farmą pokrycia z nagłówka bramki autorytetu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const CATEGORY_ID = "55555555-5555-4555-8555-555555555555";
const ROW_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST; wstrzykiwana z fabryki `vi.mock`. */
  db: null as SupabaseFromStub | null,
  /** Wartości oddawane przez RPC `admin_list_users`. */
  users: [] as { id: string; display_name: string | null; email: string | null }[],
  /** Nazwy wywołanych RPC - dowód, że lista użytkowników idzie funkcją, nie tabelą. */
  rpcNames: [] as string[],
  /** `null` = brak kontekstu obszaru roboczego (hook `useRequiredTenant` rzuca). */
  tenantId: null as string | null,
  /** Odpowiedzi kolejnych wywołań `confirmDialog` + zapis ich argumentów. */
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Język interfejsu widziany przez `useTranslation().i18n.language`. */
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-programs", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (request: Record<string, unknown>) => {
    h.confirmCalls.push(request);
    return Promise.resolve(h.confirmAnswer);
  },
}));
/**
 * Atrapa kontekstu obszaru roboczego WIERNA W JEDNYM PUNKCIE: prawdziwy
 * `useRequiredTenant` RZUCA przy braku tenanta i to jest cała treść reguły 1.
 * Atrapa oddająca pusty ciąg pozwoliłaby zapytaniu wystartować z kluczem
 * cache `["admin-research-programs", ""]` i test „bez tenanta nie pytamy bazy"
 * przechodziłby z powodu, który nie ma nic wspólnego z produkcją.
 */
vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => {
    if (!h.tenantId) throw new Error("Brak kontekstu tenanta - operacja wymaga zalogowania.");
    return h.tenantId;
  },
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: db.from,
      rpc: async (name: string) => {
        h.rpcNames.push(name);
        return { data: h.users, error: null };
      },
    },
  };
});
// Radix pod happy-dom nie otwiera list ani nie przełącza zakładek bez API
// wskaźnika - podmiana na natywne odpowiedniki. Przedmiotem dowodu jest to,
// KTÓRE pole dostaje wartość i KTÓRA zakładka jest zamontowana, a nie mechanika
// biblioteki (ma własne testy przy komponentach `ui/`).
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});
vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});
vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const { radixTabsStub } = await import("@/test/reactStubs");
  return radixTabsStub(react);
});
// Radixowy Dialog montuje treść w portalu i zamyka ją strażnikiem fokusu,
// czego happy-dom nie odtwarza. Atrapa zachowuje dwie rzeczy, na których stoją
// asercje: treść jest w drzewie WYŁĄCZNIE gdy `open`, a przycisk „Close"
// (w produkcji: X z `DialogContent`, `sr-only` „Close") woła `onOpenChange(false)`.
vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  const Box = ({ children }: { children?: ReactNode }) =>
    react.createElement("div", null, children as never);
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) =>
      open
        ? react.createElement(
            "div",
            { role: "dialog" },
            react.createElement(
              "button",
              { type: "button", onClick: () => onOpenChange?.(false) },
              "Close",
            ),
            children as never,
          )
        : null,
    DialogContent: Box,
    DialogHeader: Box,
    DialogFooter: Box,
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      react.createElement("h2", null, children as never),
    DialogDescription: Box,
  };
});

import { ok, fail } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { PROGRAM_ROW_READERS } from "@/lib/programs/adminForm";
import { Route as ResearchProgramsRoute } from "@/routes/admin.research-programs";

const PATH = "/admin/research-programs";

/** Atrapa bazy z twardym błędem - `null` znaczyłoby test o niczym. */
function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Wiersz programu badawczego. Nazwy WYMYŚLONE (RODO w fixtures). */
function program(patch: Record<string, unknown> = {}) {
  return {
    id: PROGRAM_ID,
    tenant_id: TENANT,
    slug: "bezpieczenstwo-wschodu",
    name_pl: "Bezpieczeństwo Wschodu",
    name_en: "Eastern Security",
    tagline_pl: "Odstraszanie i odporność",
    tagline_en: "Deterrence and resilience",
    scope_pl: null,
    scope_en: null,
    research_questions: [{ pl: "Kto finansuje odbudowę?", en: "Who funds reconstruction?" }],
    icon: "Compass",
    accent_color: "#0F172A",
    hero_image_url: null,
    category_id: null,
    contact_email: null,
    sort_order: 1,
    status: "draft",
    ...patch,
  };
}

function member(patch: Record<string, unknown> = {}) {
  return {
    program_id: PROGRAM_ID,
    profile_id: PROFILE_ID,
    member_role_pl: "Kierowniczka badań",
    member_role_en: "Head of research",
    is_lead: false,
    sort_order: 1,
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: ResearchProgramsRoute, path: PATH, initialEntry: PATH });
}

/** Ostatni łańcuch dla tabeli - twardy błąd, gdy produkcja jej nie dotknęła. */
function lastChain(table: string): RecordedChain {
  const chain = db().lastChain(table);
  if (!chain) throw new Error(`test: nie było ani jednego zapytania do "${table}"`);
  return chain;
}

/** Przycisk po dokładnej etykiecie (stub i18n echuje klucz). */
// `Matcher`, nie `string`: Testing Library przyjmuje tu też wyrażenie
// regularne, a część wołań w tym pliku podaje właśnie regexp (nazwa przycisku
// niesie klucz i18n z kropką). Węższa sygnatura kompilowała się tylko dopóki
// nikt nie użył regexpa - `tsc --noEmit` wyłapał to, vitest nie.
const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** Pole tekstowe po `placeholder` - formularze tej trasy nie mają etykiet ARIA. */
const byPlaceholder = (placeholder: string) => screen.getByPlaceholderText(placeholder);

/** Pole okna dossier po etykiecie - `<Label htmlFor>` wskazuje `id` pola. */
const byLabel = (label: string) => screen.getByLabelText(label);

/** Pierwszy łańcuch tabeli z danym ogniwem - twardy błąd, gdy go nie było. */
function chainWith(table: string, method: string): RecordedChain {
  const found = db()
    .chainsFor(table)
    .find((c) => c.has(method));
  if (!found) throw new Error(`test: brak łańcucha "${table}" z ogniwem "${method}"`);
  return found;
}

/** Ładunek pierwszego zapisu danego rodzaju do tabeli. */
async function payloadOf(table: string, method: "insert" | "update") {
  await waitFor(() =>
    expect(
      db()
        .chainsFor(table)
        .some((c) => c.has(method)),
    ).toBe(true),
  );
  return chainWith(table, method).argsOf(method)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.tenantId = TENANT;
  h.users = [];
  h.rpcNames = [];
  h.confirmAnswer = true;
  h.confirmCalls = [];
  db().reset();
  db().setResponse("research_programs", () => ok([program()]));
  db().setResponse("categories", () => ok([]));
  db().setResponse("research_program_members", () => ok([]));
  db().setResponse("research_program_projects", () => ok([]));
  db().setResponse("research_program_partners", () => ok([]));
  db().setResponse("research_program_items", () => ok([]));
  db().setResponse("profiles", () => ok([]));
});

afterEach(() => cleanup());

describe("admin.research-programs - kontekst obszaru roboczego", () => {
  it("BEZ tenanta panel nie renderuje się i NIE pyta bazy ani o jeden wiersz", async () => {
    // Asercja na ZBIORZE odpytanych tabel jest tu ważniejsza niż na widoku:
    // zapytanie wysłane przed ustaleniem obszaru roboczego pokazałoby cudze
    // programy w zakładce sieć, nawet gdyby ekran zaraz zniknął. Klucz cache
    // niesie tenanta, więc odczyt bez niego zlewa dwa obszary w jeden wpis.
    h.tenantId = null;
    await mount();

    expect(screen.queryByText("adminResearchPrograms.title")).toBeNull();
    expect(db().chains).toEqual([]);
  });

  it("klucz cache listy niesie identyfikator obszaru roboczego", async () => {
    // Bez tenanta w kluczu przejście między obszarami (subdomeny tego samego
    // panelu) pokazywałoby listę poprzedniego obszaru z cache.
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);

    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey);
    expect(keys).toContainEqual(["admin-research-programs", TENANT]);
    expect(keys).not.toContainEqual(["admin-research-programs", OTHER_TENANT]);
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(ResearchProgramsRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.research-programs - lista programów", () => {
  it("czyta `research_programs` w kolejności kolumny porządkowej, potem po nazwie", async () => {
    // Kolejność w panelu MUSI być tą samą, którą widzi strona publiczna -
    // inaczej redakcja przestawia `sort_order` i nie widzi skutku.
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);

    const chain = lastChain("research_programs");
    expect(chain.has("select")).toBe(true);
    const orders = chain.calls.filter((c) => c.method === "order").map((c) => c.args[0]);
    expect(orders).toEqual(["sort_order", "name_pl"]);
  });

  it("pusta lista daje stan pusty, a nie gołą stronę bez treści", async () => {
    db().setResponse("research_programs", () => ok([]));
    await mount();

    expect(await screen.findByText("adminResearchPrograms.empty")).toBeInTheDocument();
    // Przycisk dodania musi zostać - to jedyne wyjście ze stanu pustego.
    expect(button("adminResearchPrograms.newProgram")).toBeInTheDocument();
  });

  it("status dossier jest widoczny ETYKIETĄ ze słownika, nie surowym enumem", async () => {
    // Panel bez etykiety statusu zmusza redakcję do wchodzenia w każdy wiersz,
    // żeby sprawdzić, czy program jest już publiczny.
    //
    // NAPRAWIONE 2026-10: wiersz i lista wyboru drukowały surowe `published`
    // / `draft` także w polskim panelu, choć słownik rdzenia ma
    // `admin.status.*` (PL „Opublikowany", EN „Published") od początku.
    db().setResponse("research_programs", () => ok([program({ status: "published" })]));
    await mount();

    expect(await screen.findByText("admin.status.published")).toBeInTheDocument();
    expect(screen.queryByText("published")).toBeNull();
  });

  it("odczyt listy i kategorii filtruje JAWNIE po tenancie - zapytanie mówi to samo co klucz", async () => {
    // NAPRAWIONE 2026-10. Klucz cache niósł `tenantId`, a zapytanie nie:
    // zakres wyznaczał wyłącznie RLS, którego polityka „public read" przepuszcza
    // też OPUBLIKOWANE programy obszaru z adresu hosta. Lista mogła więc
    // mieszać dwa obszary pod kluczem jednego.
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);

    expect(lastChain("research_programs").argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(lastChain("categories").argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });
});

describe("admin.research-programs - awaria odczytu listy", () => {
  it("KONTROLA DODATNIA: udany, PUSTY odczyt nie pokazuje alertu", async () => {
    // Bez tej pary test niżej byłby zielony także wtedy, gdyby panel
    // pokazywał alert ZAWSZE - czyli gdyby stan pusty przestał istnieć.
    db().setResponse("research_programs", () => ok([]));
    await mount();

    expect(await screen.findByText("adminResearchPrograms.empty")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("awaria odczytu NIE udaje pustej listy programów", async () => {
    // NAPRAWIONE 2026-10 (było przypięte `it.fails`). Panel pokazywał
    // `empty` zarówno wtedy, gdy programów nie ma, jak i wtedy, gdy odczytu
    // nie udało się wykonać (odmowa RLS, padnięty transport). Redakcja widziała
    // „brak programów" i tworzyła program od zera - a slug już istniał, więc
    // zapis odbijał się naruszeniem unikalności, albo powstawał DRUGI landing
    // tego samego obszaru badawczego pod innym slugiem.
    //
    // KONTRAKT (wzór: `adminLoginSettingsRoute.test.tsx`): przy `isError`
    // panel mówi, że odczyt się nie udał, a droga dodania zostaje.
    db().setResponse("research_programs", () => fail("test: research_programs niedostępne"));
    await mount();

    expect(await screen.findByRole("alert")).toHaveTextContent("programs.loadError");
    expect(screen.queryByText("adminResearchPrograms.empty")).toBeNull();
    expect(button("adminResearchPrograms.newProgram")).toBeInTheDocument();
  });
});

describe("admin.research-programs - zapis dossier", () => {
  async function openCreate() {
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button("adminResearchPrograms.newProgram"));
    return screen.findByRole("dialog");
  }

  it("slug spoza wzorca odrzuca zapis PRZED zapytaniem do bazy", async () => {
    // Slug jest adresem strony publicznej programu. Zapis wysłany z „Nowy
    // Program" dałby albo błąd bazy, albo adres, którego nie da się wpisać -
    // a asercja na BRAKU zapytania jest mocniejsza niż na toaście: liczy się,
    // że do bazy nic nie poszło.
    await openCreate();
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), {
      target: { value: "Nowy Program" },
    });
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminResearchPrograms.errSlug"));
    expect(
      db()
        .chainsFor("research_programs")
        .filter((c) => c.has("insert")),
    ).toEqual([]);
  });

  it("brak nazwy w JEDNYM z dwóch języków też odrzuca zapis", async () => {
    // Program bez nazwy angielskiej wychodzi na angielskiej wersji serwisu
    // jako pusty kafel - a bramka parytetu słowników tego nie widzi, bo to
    // treść redakcyjna, nie słownik.
    await openCreate();
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminResearchPrograms.errNames"),
    );
    expect(
      db()
        .chainsFor("research_programs")
        .filter((c) => c.has("insert")),
    ).toEqual([]);
  });

  it("nowy program jedzie INSERTEM z `tenant_id` i bez pustych pytań badawczych", async () => {
    // Dwie rzeczy naraz, bo obie żyją w tym samym ładunku: tenant (izolacja
    // obszaru roboczego) i filtr pustych par pytań (puste wiersze jsonb
    // renderują się na stronie publicznej jako kropki bez treści).
    await openCreate();
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.change(inputs[2], { target: { value: "Defence" } });
    // Dodane, ale niewypełnione pytanie badawcze - dokładnie ten przypadek.
    fireEvent.click(button("adminResearchPrograms.add"));
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_programs")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const insert = db()
      .chainsFor("research_programs")
      .find((c) => c.has("insert"));
    const payload = insert?.argsOf("insert")?.[0];
    expect(payload).toMatchObject({ slug: "obrona", tenant_id: TENANT, status: "draft" });
    expect((payload as { research_questions: unknown[] }).research_questions).toEqual([]);
  });

  it("edycja istniejącego programu jedzie UPDATE po jego identyfikatorze, nie INSERTEM", async () => {
    // Zapis edycji wykonany insertem tworzy DRUGI program o tym samym slugu -
    // czyli albo błąd unikalności, albo dwa landingi w serwisie.
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const rowButtons = screen.getAllByRole("button");
    const editButton = rowButtons.find((b) => b.querySelector("svg.lucide-pencil"));
    if (!editButton) throw new Error("test: brak przycisku edycji w wierszu programu");
    fireEvent.click(editButton);
    await screen.findByRole("dialog");
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_programs")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("research_programs")
      .find((c) => c.has("update"));
    expect(update?.argsOf("eq")).toEqual(["id", PROGRAM_ID]);
    expect(
      db()
        .chainsFor("research_programs")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("udany zapis zamyka okno, chwali i unieważnia WSZYSTKICH czytelników wiersza", async () => {
    // Bez unieważnienia panel pokazuje listę sprzed zapisu, a redakcja
    // klika „zapisz" po raz drugi, bo nie widzi skutku pierwszego.
    //
    // NAPRAWIONE 2026-10: zapis ruszał wyłącznie klucz TEGO panelu. Wiersz
    // `research_programs` jest widokiem na `programs`, więc w tej samej sesji
    // zostawały stare: landing i katalog `/programs` (`["programs", ...]`),
    // lista programów do tagowania w edytorze wpisu (`["programs", tenantId]`,
    // staleTime 5 min - nowego programu nie dało się przypiąć do wpisu),
    // panel `/admin/programs` i filtr katalogu ekspertów.
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("adminResearchPrograms.newProgram"));
    await screen.findByRole("dialog");
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.change(inputs[2], { target: { value: "Defence" } });
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminResearchPrograms.saved"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-research-programs"] });
    for (const queryKey of [["programs"], ["admin-programs"], ["public", "experts-directory"]]) {
      expect(spy).toHaveBeenCalledWith({ queryKey });
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KAŻDE pole dossier ląduje w SWOJEJ kolumnie ładunku", async () => {
    // Tabela pól zamiast testu na pole: kontraktem jest para etykieta ->
    // kolumna. Pomylenie bliźniaczych kolumn (`tagline_pl`/`tagline_en`,
    // `scope_pl`/`scope_en`) wychodzi na stronie publicznej jako polska teza
    // w wersji angielskiej - a `tsc` tego nie widzi, bo obie są `string | null`.
    db().setResponse("categories", () =>
      ok([{ id: CATEGORY_ID, slug: "obronnosc", name_pl: "Obronność", name_en: "Defence" }]),
    );
    await openCreate();
    const typed: ReadonlyArray<readonly [label: string, value: string]> = [
      ["Slug", "obrona"],
      ["Nazwa (PL)", "Obronność"],
      ["Name (EN)", "Defence"],
      ["adminResearchPrograms.field.taglinePl", "Teza po polsku"],
      ["Tagline (EN)", "Thesis in English"],
      ["adminResearchPrograms.field.scopePl", "Zakres po polsku"],
      ["Scope (EN)", "Scope in English"],
      ["adminResearchPrograms.field.accent", "#123456"],
      ["adminResearchPrograms.field.sort", "7"],
      ["adminResearchPrograms.field.hero", "https://cdn.example.org/hero.jpg"],
      ["adminResearchPrograms.field.contactEmail", "zespol@example.org"],
      ["Status", "published"],
      ["adminResearchPrograms.field.icon", "Shield"],
    ];
    for (const [label, value] of typed) fireEvent.change(byLabel(label), { target: { value } });
    await waitFor(() =>
      expect(document.querySelector(`option[value="${CATEGORY_ID}"]`)).not.toBeNull(),
    );
    fireEvent.change(byLabel("adminResearchPrograms.field.contentCategory"), {
      target: { value: CATEGORY_ID },
    });
    fireEvent.click(button("adminResearchPrograms.save"));

    expect(await payloadOf("research_programs", "insert")).toEqual({
      slug: "obrona",
      name_pl: "Obronność",
      name_en: "Defence",
      tagline_pl: "Teza po polsku",
      tagline_en: "Thesis in English",
      scope_pl: "Zakres po polsku",
      scope_en: "Scope in English",
      research_questions: [],
      icon: "Shield",
      accent_color: "#123456",
      hero_image_url: "https://cdn.example.org/hero.jpg",
      category_id: CATEGORY_ID,
      contact_email: "zespol@example.org",
      sort_order: 7,
      status: "published",
      tenant_id: TENANT,
    });
  });

  it("wyczyszczone pole opcjonalne i kategoria „brak” zapisują NULL, nie pusty ciąg", async () => {
    // Pusty ciąg w `tagline_en` to dla strony publicznej „jest teza", więc
    // fallback na wersję polską nie zadziała, a w kolumnie uuid `"none"` to
    // błąd składni. Edycja programu, który MA tezę EN i kategorię.
    db().setResponse("research_programs", () =>
      ok([program({ tagline_en: "Deterrence and resilience", category_id: CATEGORY_ID })]),
    );
    db().setResponse("categories", () =>
      ok([{ id: CATEGORY_ID, slug: "obronnosc", name_pl: "Obronność", name_en: "Defence" }]),
    );
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const edit = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-pencil"));
    if (!edit) throw new Error("test: brak przycisku edycji w wierszu programu");
    fireEvent.click(edit);
    await screen.findByRole("dialog");
    fireEvent.change(byLabel("Tagline (EN)"), { target: { value: "" } });
    fireEvent.change(byLabel("adminResearchPrograms.field.contentCategory"), {
      target: { value: "none" },
    });
    fireEvent.click(button("adminResearchPrograms.save"));

    expect(await payloadOf("research_programs", "update")).toMatchObject({
      tagline_en: null,
      category_id: null,
    });
  });

  it("edytor pytań pisze do WŁAŚCIWEGO języka i usuwa DOKŁADNIE wskazane pytanie", async () => {
    // Pytania to jsonb z parami PL/EN. Zapis po indeksie, który chybia o jeden,
    // albo usunięcie ostatniego zamiast klikniętego, przestawia tezy programu
    // bez żadnego sygnału - lista po stronie publicznej po prostu się zmienia.
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const edit = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-pencil"));
    if (!edit) throw new Error("test: brak przycisku edycji w wierszu programu");
    fireEvent.click(edit);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /adminResearchPrograms\.add/ }));
    fireEvent.change(dialog.getAllByPlaceholderText("adminResearchPrograms.field.questionPl")[1], {
      target: { value: "Ile kosztuje odstraszanie?" },
    });
    fireEvent.change(dialog.getAllByPlaceholderText("adminResearchPrograms.field.questionEn")[1], {
      target: { value: "What does deterrence cost?" },
    });
    // Usuwamy PIERWSZE pytanie (z wiersza programu), drugie ma zostać.
    const questionTrash = dialog
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash2"));
    fireEvent.click(questionTrash[0]);
    fireEvent.click(button("adminResearchPrograms.save"));

    const payload = await payloadOf("research_programs", "update");
    expect((payload as { research_questions: unknown }).research_questions).toEqual([
      { pl: "Ile kosztuje odstraszanie?", en: "What does deterrence cost?" },
    ]);
  });

  it("„Anuluj” zamyka okno BEZ zapisu", async () => {
    // Przycisk, który wygląda na rezygnację, nie może wysłać wersji roboczej.
    await openCreate();
    fireEvent.change(byLabel("Slug"), { target: { value: "obrona" } });
    fireEvent.click(button("adminResearchPrograms.cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      db()
        .chainsFor("research_programs")
        .some((c) => c.has("insert") || c.has("update")),
    ).toBe(false);
  });

  it("błąd bazy przy zapisie NIE zamyka okna i nie chwali", async () => {
    // Zamknięte okno po odmowie RLS wygląda jak zapis wykonany - a wersja
    // robocza przepada razem z oknem.
    db().setResponse("research_programs", (chain) =>
      chain.has("insert") ? fail("test: odmowa polityki RLS", "42501") : ok([program()]),
    );
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button("adminResearchPrograms.newProgram"));
    await screen.findByRole("dialog");
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.change(inputs[2], { target: { value: "Defence" } });
    fireEvent.click(button("adminResearchPrograms.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("admin.research-programs - usunięcie programu", () => {
  async function clickDelete() {
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const trash = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"));
    if (!trash) throw new Error("test: brak przycisku usunięcia w wierszu programu");
    fireEvent.click(trash);
  }

  it("pyta o potwierdzenie i mówi w nim, KTÓRY program zniknie", async () => {
    // Program niesie zespół, projekty, partnerów i wybrane materiały.
    // Potwierdzenie bez nazwy programu to potwierdzenie, którego nie da się
    // sprawdzić przed kliknięciem - a kasuje cały landing.
    await clickDelete();

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({
      title: "adminResearchPrograms.deleteConfirm",
      destructive: true,
    });
    expect(String(h.confirmCalls[0].description)).toContain("Bezpieczeństwo Wschodu");
    expect(String(h.confirmCalls[0].description)).toContain("Eastern Security");
  });

  it("ODMOWA w potwierdzeniu nie wysyła DELETE do bazy", async () => {
    // Kliknięcie „anuluj", po którym wiersz i tak znika, jest najgorszym
    // z możliwych zachowań tego przycisku.
    h.confirmAnswer = false;
    await clickDelete();

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(
      db()
        .chainsFor("research_programs")
        .some((c) => c.has("delete")),
    ).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZGODA usuwa DOKŁADNIE ten wiersz i unieważnia klucz listy", async () => {
    // `delete()` bez `eq("id", ...)` czyści całą tabelę w zasięgu RLS -
    // czyli wszystkie programy obszaru roboczego.
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const trash = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"));
    if (!trash) throw new Error("test: brak przycisku usunięcia w wierszu programu");
    fireEvent.click(trash);

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_programs")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    const del = db()
      .chainsFor("research_programs")
      .find((c) => c.has("delete"));
    expect(del?.argsOf("eq")).toEqual(["id", PROGRAM_ID]);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminResearchPrograms.deleted"),
    );
  });

  it("usunięcie unieważnia tych samych czytelników wiersza co zapis", async () => {
    // Usunięty program, który dalej wisi w katalogu `/programs` albo w filtrze
    // katalogu ekspertów, prowadzi czytelnika w 404. Lista jest WSPÓLNA
    // z zapisem (`PROGRAM_ROW_READERS`), więc nie ma jak się rozjechać.
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const trash = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"));
    if (!trash) throw new Error("test: brak przycisku usunięcia w wierszu programu");
    fireEvent.click(trash);

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminResearchPrograms.deleted"),
    );
    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([...PROGRAM_ROW_READERS]);
  });

  it("odmowa bazy przy usuwaniu: komunikat bazy, bez pochwały i bez unieważnienia", async () => {
    // „Usunięto" po odmowie RLS to kłamstwo, które redakcja odkrywa dopiero
    // na stronie publicznej.
    db().setResponse("research_programs", (chain) =>
      chain.has("delete") ? fail("test: odmowa polityki RLS", "42501") : ok([program()]),
    );
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const trash = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"));
    if (!trash) throw new Error("test: brak przycisku usunięcia w wierszu programu");
    fireEvent.click(trash);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: odmowa polityki RLS"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("admin.research-programs - okno treści programu i cztery zakładki", () => {
  async function openManage() {
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button(/adminResearchPrograms\.content/));
    return screen.findByRole("dialog");
  }

  it("otwarcie okna montuje zakładkę zespołu i pyta o członków TEGO programu", async () => {
    // Zapytanie bez `eq("program_id", ...)` pokazałoby zespół innego programu
    // - a lista jest jednocześnie formularzem usuwania.
    await openManage();

    await waitFor(() => expect(db().chainsFor("research_program_members").length).toBe(1));
    expect(lastChain("research_program_members").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
    expect(screen.getByText("adminResearchPrograms.members.empty")).toBeInTheDocument();
  });

  it("lista kandydatów na członków idzie RPC `admin_list_users`, nie odczytem tabeli", async () => {
    // Adresy e-mail użytkowników nie są czytelne selectem dla roli
    // `authenticated`; funkcja SECURITY DEFINER jest jedyną drogą i zarazem
    // jedynym miejscem, w którym ten dostęp jest audytowalny.
    h.users = [{ id: PROFILE_ID, display_name: "Zofia Testowa", email: "zofia@example.org" }];
    await openManage();

    await waitFor(() => expect(h.rpcNames).toContain("admin_list_users"));
    expect(db().chainsFor("auth.users")).toEqual([]);
  });

  it("dodanie członka bez wybranej osoby jest zablokowane", async () => {
    // Insert z pustym `profile_id` to naruszenie klucza obcego - błąd bazy
    // w miejscu, w którym wystarczy nie dać kliknąć.
    await openManage();

    expect(button("adminResearchPrograms.members.addMember")).toBeDisabled();
  });

  it("usunięcie członka filtruje po OBU kolumnach klucza złożonego", async () => {
    // REGUŁA 6. `delete().eq("profile_id", ...)` bez programu wypisałby tę
    // osobę ze wszystkich programów obszaru roboczego naraz - a panel
    // pokazałby to jako jedno usunięcie z jednej listy.
    db().setResponse("research_program_members", (chain) =>
      chain.has("select") ? ok([member()]) : ok([]),
    );
    db().setResponse("profiles", () => ok([{ id: PROFILE_ID, display_name: "Zofia Testowa" }]));
    await openManage();
    await screen.findByText("Zofia Testowa");

    const trash = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash2"))
      .at(-1);
    if (!trash) throw new Error("test: brak przycisku usunięcia członka");
    fireEvent.click(trash);

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_members")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    const del = db()
      .chainsFor("research_program_members")
      .find((c) => c.has("delete"));
    const eqPairs = del?.calls.filter((c) => c.method === "eq").map((c) => c.args) ?? [];
    expect(eqPairs).toEqual([
      ["program_id", PROGRAM_ID],
      ["profile_id", PROFILE_ID],
    ]);
  });

  it("KONTRAST ŚWIADOMY: usunięcie członka zespołu NIE pyta o potwierdzenie", async () => {
    // Asymetria wobec usunięcia programu jest tu przybita, a nie przemilczana:
    // program kaskaduje na cztery tabele (stąd potwierdzenie), a członek
    // zespołu jest jednym wierszem, który da się dodać z powrotem w dwóch
    // kliknięciach. Gdyby ktoś kiedyś dołożył tu potwierdzenie, ten test
    // pokaże, że zmiana jest ŚWIADOMA, a nie przypadkiem skopiowana.
    db().setResponse("research_program_members", (chain) =>
      chain.has("select") ? ok([member()]) : ok([]),
    );
    db().setResponse("profiles", () => ok([{ id: PROFILE_ID, display_name: "Zofia Testowa" }]));
    await openManage();
    await screen.findByText("Zofia Testowa");
    const trash = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash2"))
      .at(-1);
    fireEvent.click(trash!);

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_members")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(h.confirmCalls).toEqual([]);
  });

  it("przełącznik lidera zespołu jedzie UPDATE po obu kolumnach klucza", async () => {
    // Lider jest wyróżniony na stronie publicznej programu. Update bez
    // `program_id` przestawiłby liderem tę samą osobę we wszystkich
    // programach, w których jest członkiem.
    db().setResponse("research_program_members", (chain) =>
      chain.has("select") ? ok([member()]) : ok([]),
    );
    db().setResponse("profiles", () => ok([{ id: PROFILE_ID, display_name: "Zofia Testowa" }]));
    await openManage();
    await screen.findByText("Zofia Testowa");

    const switches = screen.getAllByRole("switch");
    // Ostatni przełącznik należy do WIERSZA członka (pierwszy - do formularza).
    fireEvent.click(switches[switches.length - 1]);

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_members")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("research_program_members")
      .find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toEqual({ is_lead: true });
    expect(update?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["program_id", PROGRAM_ID],
      ["profile_id", PROFILE_ID],
    ]);
  });

  it("przejście na zakładkę projektów montuje JEJ zapytanie, a nie zapytanie zespołu", async () => {
    // Zakładki decydują, która powierzchnia jest w ogóle zamontowana.
    // Zakładka, która nic nie pyta, pokazuje listę pustą zawsze.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.projects/ }));

    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    expect(lastChain("research_program_projects").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
  });

  it("projekt bez nazwy w jednym z języków nie jedzie do bazy", async () => {
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.projects/ }));
    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    fireEvent.change(byPlaceholder("adminResearchPrograms.projects.namePl"), {
      target: { value: "Mapa dostaw" },
    });
    fireEvent.click(button(/adminResearchPrograms\.projects\.addProject/));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminResearchPrograms.projects.nameRequired"),
    );
    expect(
      db()
        .chainsFor("research_program_projects")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("pola projektu lądują w SWOICH kolumnach, a kolejność jest na końcu listy", async () => {
    // `sort_order` liczony z długości listy jest jedyną rzeczą, która trzyma
    // kolejność projektów na stronie publicznej. Puste streszczenie EN to
    // NULL - strona publiczna spada wtedy na wersję polską zamiast pustki.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.projects/ }));
    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    const typed: ReadonlyArray<readonly [placeholder: string, value: string]> = [
      ["adminResearchPrograms.projects.namePl", "Mapa dostaw"],
      ["adminResearchPrograms.projects.nameEn", "Supply map"],
      ["adminResearchPrograms.projects.summaryPl", "Kto dostarcza amunicję."],
      ["URL", "https://example.org/mapa"],
    ];
    for (const [placeholder, value] of typed) {
      fireEvent.change(byPlaceholder(placeholder), { target: { value } });
    }
    const statusSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector('option[value="planned"]'));
    if (!statusSelect) throw new Error("test: brak listy statusu projektu");
    fireEvent.change(statusSelect, { target: { value: "planned" } });
    fireEvent.click(button(/adminResearchPrograms\.projects\.addProject/));

    expect(await payloadOf("research_program_projects", "insert")).toEqual({
      program_id: PROGRAM_ID,
      name_pl: "Mapa dostaw",
      name_en: "Supply map",
      summary_pl: "Kto dostarcza amunicję.",
      summary_en: null,
      project_status: "planned",
      url: "https://example.org/mapa",
      sort_order: 1,
    });
    // Po udanym zapisie formularz wraca do stanu pustego - inaczej drugie
    // kliknięcie dodaje ten sam projekt drugi raz.
    await waitFor(() =>
      expect(byPlaceholder("adminResearchPrograms.projects.namePl")).toHaveValue(""),
    );
  });

  it("zakładka partnerów pyta o partnerów TEGO programu, a partner bez nazwy nie jedzie", async () => {
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.partners/ }));

    await waitFor(() => expect(db().chainsFor("research_program_partners").length).toBe(1));
    expect(lastChain("research_program_partners").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
    fireEvent.click(button(/adminResearchPrograms\.partners\.addPartner/));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_partners")
          .some((c) => c.has("insert")),
      ).toBe(false),
    );
  });

  it("wybrany materiał trafia w POLE odpowiadające swojemu typowi", async () => {
    // Trzy kolumny (`post_id`, `podcast_id`, `event_id`) i jeden enum typu.
    // Wpisanie identyfikatora podcastu w kolumnę wpisu daje kafel, którego
    // strona publiczna nie umie rozwiązać - i cichy brak elementu w sekcji.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.curated/ }));
    await waitFor(() => expect(db().chainsFor("research_program_items").length).toBe(1));
    const typeSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector('option[value="flagship_post"]'));
    if (!typeSelect) throw new Error("test: brak listy typu materiału");
    fireEvent.change(typeSelect, { target: { value: "podcast" } });
    fireEvent.change(byPlaceholder("adminResearchPrograms.items.recordUuid"), {
      target: { value: PROFILE_ID },
    });
    fireEvent.click(button(/adminResearchPrograms\.add/));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_items")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const insert = db()
      .chainsFor("research_program_items")
      .find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      item_type: "podcast",
      podcast_id: PROFILE_ID,
      post_id: null,
      event_id: null,
    });
  });

  it("nagłówek okna treści niesie nazwę programu w JĘZYKU panelu", async () => {
    // NAPRAWIONE 2026-10: lista mówiła `name_en` w panelu angielskim, a okno
    // treści tego samego programu - zawsze `name_pl`.
    h.lang = "en";
    await mount();
    await screen.findByText(/Eastern Security/);
    fireEvent.click(button(/adminResearchPrograms\.content/));

    const title = await screen.findByRole("heading", { level: 2 });
    expect(title).toHaveTextContent("adminResearchPrograms.programContent: Eastern Security");
  });

  it("X zamyka okno treści i odmontowuje zakładki", async () => {
    // Okno treści nie ma przycisku w stopce - jedynym wyjściem jest X (albo
    // Escape), czyli `onOpenChange(false)`. Bez niego zakładki zostają
    // zamontowane i dalej odpytują bazę za programem, którego nikt nie ogląda.
    await openManage();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("adminResearchPrograms.members.empty")).toBeNull();
  });

  async function pickCandidate() {
    await waitFor(() =>
      expect(document.querySelector(`option[value="${PROFILE_ID}"]`)).not.toBeNull(),
    );
    const candidates = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector(`option[value="${PROFILE_ID}"]`));
    if (!candidates) throw new Error("test: brak kandydata na liście");
    fireEvent.change(candidates, { target: { value: PROFILE_ID } });
  }

  it("dodanie członka niesie osobę, role PL/EN, lidera i kolejność; potem formularz jest pusty", async () => {
    // Pusta rola EN to NULL (strona publiczna spada wtedy na PL albo na
    // stanowisko z profilu), a przełącznik lidera MUSI dojechać do ładunku -
    // lider jest wyróżniony na landingu.
    h.users = [{ id: PROFILE_ID, display_name: "Zofia Testowa", email: "zofia@example.org" }];
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button(/adminResearchPrograms\.content/));
    await screen.findByRole("dialog");
    await pickCandidate();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(byPlaceholder("adminResearchPrograms.members.rolePl"), {
      target: { value: "Analityczka" },
    });
    fireEvent.click(button(/adminResearchPrograms\.members\.addMember/));

    expect(await payloadOf("research_program_members", "insert")).toEqual({
      program_id: PROGRAM_ID,
      profile_id: PROFILE_ID,
      member_role_pl: "Analityczka",
      member_role_en: null,
      is_lead: true,
      sort_order: 1,
    });
    await waitFor(() =>
      expect(byPlaceholder("adminResearchPrograms.members.rolePl")).toHaveValue(""),
    );
    expect(button(/adminResearchPrograms\.members\.addMember/)).toBeDisabled();
    // Klucz zakładki ZAWĘŻONY programem i landingi publiczne, które niosą skład.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-rp-members", PROGRAM_ID] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["programs", "landing"] });
  });

  it("odmowa bazy (drugi lider - unikalny indeks) zostawia wersję roboczą i nic nie unieważnia", async () => {
    // `ux_rpm_one_lead_per_program` dopuszcza JEDNEGO lidera na program.
    // Wyczyszczony formularz po odmowie kazałby wpisywać wszystko od nowa,
    // a unieważnienie po odmowie udawałoby, że coś się zmieniło.
    h.users = [{ id: PROFILE_ID, display_name: "Zofia Testowa", email: "zofia@example.org" }];
    db().setResponse("research_program_members", (chain) =>
      chain.has("insert")
        ? fail(
            'duplicate key value violates unique constraint "ux_rpm_one_lead_per_program"',
            "23505",
          )
        : ok([]),
    );
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button(/adminResearchPrograms\.content/));
    await screen.findByRole("dialog");
    await pickCandidate();
    fireEvent.change(byPlaceholder("adminResearchPrograms.members.rolePl"), {
      target: { value: "Analityczka" },
    });
    fireEvent.click(button(/adminResearchPrograms\.members\.addMember/));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'duplicate key value violates unique constraint "ux_rpm_one_lead_per_program"',
      ),
    );
    expect(byPlaceholder("adminResearchPrograms.members.rolePl")).toHaveValue("Analityczka");
    expect(spy).not.toHaveBeenCalled();
  });

  it("partner jedzie z nazwą, logo i adresem w SWOICH kolumnach (puste -> NULL)", async () => {
    // `logo_url` i `url` to dwa pola URL obok siebie - pomylone dają
    // na landingu obrazek z adresem strony partnera, czyli pusty kafel.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.partners/ }));
    await waitFor(() => expect(db().chainsFor("research_program_partners").length).toBe(1));
    fireEvent.change(byPlaceholder("adminResearchPrograms.partners.name"), {
      target: { value: "Instytut Wymyślony" },
    });
    fireEvent.change(byPlaceholder("adminResearchPrograms.partners.logoUrl"), {
      target: { value: "https://cdn.example.org/logo.svg" },
    });
    fireEvent.click(button(/adminResearchPrograms\.partners\.addPartner/));

    expect(await payloadOf("research_program_partners", "insert")).toEqual({
      program_id: PROGRAM_ID,
      name: "Instytut Wymyślony",
      logo_url: "https://cdn.example.org/logo.svg",
      url: null,
      sort_order: 1,
    });
    await waitFor(() =>
      expect(byPlaceholder("adminResearchPrograms.partners.name")).toHaveValue(""),
    );
  });

  it("UUID materiału: same spacje nie jadą wcale, a wklejony ze spacjami jedzie PRZYCIĘTY", async () => {
    // NAPRAWIONE 2026-10. Warunek sprawdzał `targetId.trim()`, ale do kolumny
    // jechała wartość SUROWA - a typ `uuid` w Postgresie nie przyjmuje spacji
    // na brzegu (22P02). UUID zaznaczony podwójnym kliknięciem albo skopiowany
    // z tabeli niesie je często, więc redakcja dostawała błąd składni za
    // poprawny identyfikator.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.curated/ }));
    await waitFor(() => expect(db().chainsFor("research_program_items").length).toBe(1));
    // Wartość sprawdzana i wartość wysyłana to TA SAMA wartość: same spacje
    // są pustką (wiersz bez żadnego celu łamie CHECK „dokładnie jedna kolumna").
    fireEvent.change(byPlaceholder("adminResearchPrograms.items.recordUuid"), {
      target: { value: "   " },
    });
    fireEvent.click(button(/adminResearchPrograms\.add/));
    expect(
      db()
        .chainsFor("research_program_items")
        .some((c) => c.has("insert")),
    ).toBe(false);
    fireEvent.change(byPlaceholder("adminResearchPrograms.items.recordUuid"), {
      target: { value: `  ${PROFILE_ID} ` },
    });
    fireEvent.click(button(/adminResearchPrograms\.add/));

    expect(await payloadOf("research_program_items", "insert")).toMatchObject({
      item_type: "flagship_post",
      post_id: PROFILE_ID,
      podcast_id: null,
      event_id: null,
    });
    await waitFor(() =>
      expect(byPlaceholder("adminResearchPrograms.items.recordUuid")).toHaveValue(""),
    );
  });

  it("listy zakładek mówią etykietami słownika: status projektu i typ materiału", async () => {
    // NAPRAWIONE 2026-10: wiersze drukowały surowe `[completed]` i `podcast`,
    // choć słownik ma `programs.projectStatus.*` i `items.*` w obu językach.
    db().setResponse("research_program_projects", () =>
      ok([
        {
          id: ROW_ID,
          program_id: PROGRAM_ID,
          name_pl: "Mapa dostaw",
          name_en: "Supply map",
          summary_pl: null,
          summary_en: null,
          project_status: "completed",
          url: null,
          sort_order: 1,
        },
      ]),
    );
    db().setResponse("research_program_items", () =>
      ok([
        {
          id: ROW_ID,
          program_id: PROGRAM_ID,
          item_type: "podcast",
          post_id: null,
          podcast_id: PROFILE_ID,
          event_id: null,
          sort_order: 1,
        },
      ]),
    );
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.projects/ }));
    expect(await screen.findByText("[programs.projectStatus.completed]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /adminResearchPrograms\.tabs\.curated/ }));
    // Wiersz W PANELU zakładki - lista programów strony też ma `listitem`.
    const row = await within(screen.getByRole("tabpanel")).findByRole("listitem");
    expect(within(row).getByText("adminResearchPrograms.items.podcast")).toBeInTheDocument();
    expect(within(row).queryByText("podcast")).toBeNull();
  });

  const CHILD_TABS = [
    {
      tab: /adminResearchPrograms\.tabs\.projects/,
      table: "research_program_projects",
      cacheKey: "admin-rp-projects",
      shown: "Mapa dostaw",
      row: {
        name_pl: "Mapa dostaw",
        name_en: "Supply map",
        summary_pl: null,
        summary_en: null,
        project_status: "active",
        url: null,
      },
    },
    {
      tab: /adminResearchPrograms\.tabs\.partners/,
      table: "research_program_partners",
      cacheKey: "admin-rp-partners",
      shown: "Instytut Wymyślony",
      row: { name: "Instytut Wymyślony", logo_url: "https://cdn.example.org/logo.svg", url: null },
    },
    {
      tab: /adminResearchPrograms\.tabs\.curated/,
      table: "research_program_items",
      cacheKey: "admin-rp-items",
      shown: PROFILE_ID,
      row: { item_type: "event", post_id: null, podcast_id: null, event_id: PROFILE_ID },
    },
  ] as const;

  it.each(CHILD_TABS)(
    "usunięcie w zakładce $cacheKey trafia DOKŁADNIE w ten wiersz i odświeża zakładkę oraz landingi",
    async ({ tab, table, cacheKey, shown, row }) => {
      // REGUŁA 5. Kosz bez `eq("id", ...)` czyści całą tabelę w zasięgu RLS;
      // unieważnienie bez programu w kluczu przeładowuje zakładki wszystkich
      // programów, a bez landingów - zostawia usunięty element na stronie
      // publicznej do wygaśnięcia cache.
      db().setResponse(table, (chain) =>
        chain.has("select")
          ? ok([{ id: ROW_ID, program_id: PROGRAM_ID, sort_order: 1, ...row }])
          : ok([]),
      );
      const view = await mount();
      await screen.findByText(/Bezpieczeństwo Wschodu/);
      fireEvent.click(button(/adminResearchPrograms\.content/));
      await screen.findByRole("dialog");
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      await screen.findByText(shown);
      const spy = vi.spyOn(view.queryClient, "invalidateQueries");
      const trash = within(screen.getByRole("tabpanel"))
        .getAllByRole("button")
        .find((b) => b.querySelector("svg.lucide-trash2"));
      if (!trash) throw new Error(`test: brak kosza w zakładce ${cacheKey}`);
      fireEvent.click(trash);

      await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: [cacheKey, PROGRAM_ID] }));
      expect(chainWith(table, "delete").argsOf("eq")).toEqual(["id", ROW_ID]);
      expect(spy).toHaveBeenCalledWith({ queryKey: ["programs", "landing"] });
    },
  );
});
