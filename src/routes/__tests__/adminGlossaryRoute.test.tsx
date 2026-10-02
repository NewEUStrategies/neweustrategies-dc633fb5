// Trasa `/admin/glossary` ZAMONTOWANA - panel słowniczka pojęć (CRUD terminów
// PL/EN). Do dziś: 0 z 29 linii i 0 z 19 funkcji - żaden test nie montował tej
// trasy, choć to z niej pochodzą WSZYSTKIE hasła publicznego `/glossary`
// i tooltipy w treści wpisów.
//
// SZEŚĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. TRASA NIE MONTUJE WŁASNEJ POWŁOKI PANELU. Layout `/admin`
//      (`src/routes/admin.tsx`) SAM owija `<Outlet/>` w `<AdminShell>`. Ta
//      trasa owijała się w nią DRUGI raz: drugi pasek boczny w kolumnie treści,
//      drugi `<main id="main-content">` (zduplikowane id = link „przejdź do
//      treści" celujący w zewnętrzny kontener) i zdublowane zapytania powłoki
//      (ustawienia, liczniki klubów). NAPRAWIONE w tej zmianie; atrapa
//      `AdminShell` niżej jest SONDĄ, która liczy montaże.
//   2. BEZ TERMINU PL I DEFINICJI PL NIE MA ZAPISU. Obie kolumny są `NOT NULL`
//      i to one zasilają stronę publiczną; ciąg z samych spacji to też brak.
//   3. ZAPIS PRZYCINA POLA, A SLUG LICZY Z PRZYCIĘTEGO TERMINU PL. Slug jest
//      kluczem unikalnym `(tenant_id, slug)` i kotwicą hasła na `/glossary`;
//      spacja na brzegu dawałaby inną kotwicę niż ta sama nazwa bez spacji.
//   4. PUSTA DEFINICJA EN TO `null`, NIE PUSTY CIĄG. Strona publiczna i tooltip
//      odróżniają „brak tłumaczenia" (pokaż PL) od tłumaczenia - `""` byłby
//      tłumaczeniem, czyli pustym dymkiem na angielskiej wersji wpisu.
//   5. USUNIĘCIE WYMAGA POTWIERDZENIA, A ODMOWA NIE WOŁA BAZY. Termin znika
//      jednocześnie ze strony publicznej i z tooltipów we WSZYSTKICH wpisach.
//   6. BŁĄD ZAPISU NIE UDAJE SUKCESU I NIE KASUJE WERSJI ROBOCZEJ.
//
// `tenant_id` W INSERCIE - SPRAWDZONE, ŚWIADOMIE GO NIE MA. Inne panele (np.
// `admin.research-programs.tsx`) wysyłają `tenant_id: useRequiredTenant()`,
// ale tu baza uzupełnia tenanta sama: `glossary_terms.tenant_id uuid NOT NULL
// DEFAULT current_tenant_id()`, a polityka „glossary staff manage" ma
// `WITH CHECK (tenant_id = current_tenant_id() AND is_staff())`
// (`supabase/migrations/20260720134000_glossary_terms.sql`). Wiersz bez
// tenanta nie powstanie, a tenant z klienta i tak musiałby być równy
// `current_tenant_id()`. Test niżej przypina, że ładunek go NIE niesie - zmiana
// tej decyzji ma być świadoma, razem z migracją.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ODCZYTU: `glossaryTermsQueryOptions` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST); jego klucz i kolumny ma w asercjach
//   `src/routes/__tests__/glossaryRoute.test.tsx`.
// - SLUGIFIKACJI: `slugifyTaxonomy` ma własne testy; tu dowodzimy tylko, że
//   panel liczy slug z PRZYCIĘTEGO terminu PL.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a zapis egzekwuje RLS;
//   warstw pilnuje `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST; wstrzykiwana z fabryki `vi.mock`. */
  db: null as SupabaseFromStub | null,
  /** Wiersze zwracane przez odczyt listy terminów. */
  terms: [] as Record<string, unknown>[],
  /** Błąd zapisu (insert) - `null` = sukces. */
  insertError: null as string | null,
  /** Czy insert ma WISIEĆ (dowód blokady drugiego kliknięcia). */
  hangInsert: false,
  /** Błąd usunięcia - `null` = sukces. */
  deleteError: null as string | null,
  /** Odpowiedź okna potwierdzenia + zapis jego argumentów. */
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  /** Ile razy zamontowano `AdminShell` - SONDA reguły 1. */
  shellRenders: 0,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (request: Record<string, unknown>) => {
    h.confirmCalls.push(request);
    return Promise.resolve(h.confirmAnswer);
  },
}));
// SONDA, nie ozdoba: trasa po naprawie NIE importuje powłoki, więc ta atrapa
// nie powinna być wywołana ani razu. Powrót `<AdminShell>` do trasy podbija
// licznik i czerwieni test reguły 1 - bez montowania prawdziwej powłoki (ta
// ciągnie sesję, nawigację i ustawienia, i ma własne testy).
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: ReactNode }) => {
    h.shellRenders += 1;
    return <div data-testid="admin-shell">{children}</div>;
  },
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  db.setResponse("glossary_terms", (chain) => {
    if (chain.has("insert")) return h.insertError ? fail(h.insertError) : ok(null);
    if (chain.has("delete")) return h.deleteError ? fail(h.deleteError) : ok(null);
    return ok(h.terms);
  });
  h.db = db;
  /**
   * Wiszący insert: ogniwo NADAL trafia do zapisu łańcucha (asercja liczy
   * inserty), ale odpowiedź nie wraca nigdy - tak wygląda zapis w locie.
   */
  const from = (table: string) => {
    const builder = db.from(table) as Record<string, (...args: unknown[]) => unknown>;
    if (!h.hangInsert) return builder;
    return {
      ...builder,
      insert: (...args: unknown[]) => {
        builder.insert(...args);
        return { then: () => new Promise(() => {}) };
      },
    };
  };
  return { supabase: { from } };
});

import { renderRoute } from "@/test/routeHarness";
import { Route as GlossaryAdminRoute } from "@/routes/admin.glossary";

const PATH = "/admin/glossary";

/** Wiersz terminu. Hasła i definicje WYMYŚLONE (RODO w fixtures). */
function term(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    slug: "akt-delegowany",
    term_pl: "Akt delegowany",
    term_en: "Delegated act",
    definition_pl: "Akt Komisji uzupełniający akt ustawodawczy.",
    definition_en: "A Commission act supplementing a legislative act.",
    ...patch,
  };
}

/** Atrapa bazy z twardym błędem - `null` znaczyłoby test o niczym. */
function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Łańcuchy z danym ogniwem (insert / delete / odczyt). */
const chainsWith = (method: string): RecordedChain[] =>
  db()
    .chainsFor("glossary_terms")
    .filter((c) => c.has(method));

/** Odczyty listy - łańcuchy bez ogniwa zapisu. */
const reads = (): RecordedChain[] =>
  db()
    .chainsFor("glossary_terms")
    .filter((c) => !c.has("insert") && !c.has("delete"));

/** Ładunek pierwszego insertu - twardy błąd, gdy panel go nie wysłał. */
function insertPayload(): Record<string, unknown> {
  const args = chainsWith("insert")[0]?.argsOf("insert");
  const payload = args?.[0];
  if (!payload || typeof payload !== "object") throw new Error("test: panel nie wysłał insertu");
  return payload as Record<string, unknown>;
}

async function mount() {
  const view = await renderRoute({ route: GlossaryAdminRoute, path: PATH, initialEntry: PATH });
  await waitFor(() => expect(reads().length).toBeGreaterThan(0));
  return view;
}

/** Pole formularza po placeholderze - etykiety są KLUCZAMI (stub i18n). */
const field = (key: string) => screen.getByPlaceholderText(`admin.glossary.${key}`);
const type = (key: string, value: string) => fireEvent.change(field(key), { target: { value } });
const addButton = () => screen.getByRole("button", { name: "admin.glossary.add" });

beforeEach(() => {
  vi.clearAllMocks();
  // Tylko zapis łańcuchów - odpowiedzi tabeli ustawia fabryka atrapy raz.
  db().chains.length = 0;
  h.terms = [term()];
  h.insertError = null;
  h.hangInsert = false;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.confirmCalls = [];
  h.shellRenders = 0;
});

afterEach(() => cleanup());

describe("admin.glossary - sklejenie z layoutem /admin", () => {
  it("NIE montuje własnej powłoki panelu - robi to już layout /admin", async () => {
    // REGUŁA 1 (regresja). Przed naprawą trasa owijała się w `<AdminShell>`
    // i na /admin/glossary stały dwa paski boczne oraz dwa
    // `<main id="main-content">`.
    await mount();
    await screen.findByText("Akt delegowany");

    expect(h.shellRenders).toBe(0);
    expect(screen.queryByTestId("admin-shell")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "admin.glossary.title" })).toBeVisible();
  });
});

describe("admin.glossary - lista terminów", () => {
  it("pokazuje termin, definicję i tłumaczenia EN tylko tam, gdzie się różnią", async () => {
    // Termin EN identyczny z PL (nazwy własne, skrótowce) to szum w wierszu;
    // brak definicji EN nie może dać pustego „EN:".
    h.terms = [
      term(),
      term({
        id: "t2",
        slug: "tsi",
        term_pl: "TSI",
        term_en: "TSI",
        definition_pl: "Techniczna specyfikacja interoperacyjności.",
        definition_en: null,
      }),
    ];
    await mount();
    await screen.findByText("Akt delegowany");

    expect(screen.getByText("EN: Delegated act")).toBeInTheDocument();
    expect(screen.getByText("EN: A Commission act supplementing a legislative act.")).toBeVisible();
    expect(screen.queryByText("EN: TSI")).toBeNull();
    expect(screen.getAllByText(/^EN:/)).toHaveLength(2);
  });

  it("pusty słowniczek mówi o pustce, a formularz dodania zostaje", async () => {
    h.terms = [];
    await mount();

    expect(await screen.findByText("admin.glossary.empty")).toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
  });
});

describe("admin.glossary - dodanie terminu", () => {
  it("„Dodaj” jest zablokowany bez terminu PL i definicji PL (spacje to też brak)", async () => {
    // REGUŁA 2. Obie kolumny są NOT NULL i to one zasilają stronę publiczną.
    await mount();
    expect(addButton()).toBeDisabled();

    type("termPl", "Akt wykonawczy");
    expect(addButton()).toBeDisabled();

    type("defPl", "   ");
    expect(addButton()).toBeDisabled();

    type("defPl", "Akt Komisji wykonujący akt podstawowy.");
    expect(addButton()).toBeEnabled();

    type("termPl", "  ");
    expect(addButton()).toBeDisabled();
  });

  it("insert przycina pola, liczy slug z PRZYCIĘTEGO terminu PL i NIE niesie tenanta", async () => {
    // REGUŁY 3 i 4 w jednym ładunku. `tenant_id` uzupełnia baza (DEFAULT
    // current_tenant_id() + WITH CHECK polityki) - patrz nagłówek pliku.
    await mount();
    type("termPl", "  Akt wykonawczy  ");
    type("termEn", " Implementing act ");
    type("defPl", "  Akt Komisji wykonujący akt podstawowy. ");
    type("defEn", " Commission act implementing a basic act. ");
    fireEvent.click(addButton());

    await waitFor(() => expect(chainsWith("insert")).toHaveLength(1));
    expect(insertPayload()).toEqual({
      term_pl: "Akt wykonawczy",
      term_en: "Implementing act",
      definition_pl: "Akt Komisji wykonujący akt podstawowy.",
      definition_en: "Commission act implementing a basic act.",
      slug: "akt-wykonawczy",
    });
    expect(insertPayload()).not.toHaveProperty("tenant_id");
  });

  it("pusta definicja EN (albo same spacje) jedzie do bazy jako `null`", async () => {
    // REGUŁA 4. `""` byłby „tłumaczeniem" - pustym dymkiem w wersji EN wpisu.
    await mount();
    type("termPl", "Dual-use");
    type("defPl", "Produkty podwójnego zastosowania.");
    type("defEn", "   ");
    fireEvent.click(addButton());

    await waitFor(() => expect(chainsWith("insert")).toHaveLength(1));
    expect(insertPayload().definition_en).toBeNull();
    // Termin EN nie ma `null` w schemacie (NOT NULL DEFAULT '') - zostaje ciągiem.
    expect(insertPayload().term_en).toBe("");
  });

  it("udany zapis chwali, czyści formularz i PRZEŁADOWUJE listę", async () => {
    // Lista czyta klucz z `glossaryTermsQueryOptions` - unieważnienie innego
    // klucza zostawiłoby nowy termin niewidoczny do czasu wygaśnięcia cache
    // (10 minut `staleTime`).
    await mount();
    const readsBefore = reads().length;
    type("termPl", "Akt wykonawczy");
    type("defPl", "Akt Komisji wykonujący akt podstawowy.");
    h.terms = [term(), term({ id: "t3", slug: "akt-wykonawczy", term_pl: "Akt wykonawczy" })];
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.glossary.added"));
    await waitFor(() => expect(reads().length).toBeGreaterThan(readsBefore));
    expect(await screen.findByText("Akt wykonawczy")).toBeInTheDocument();
    expect(field("termPl")).toHaveValue("");
    expect(field("defPl")).toHaveValue("");
    expect(addButton()).toBeDisabled();
  });

  it("błąd zapisu → toast z komunikatem, bez sukcesu i BEZ czyszczenia wersji roboczej", async () => {
    // REGUŁA 6. Odmowa (np. duplikat sluga) kasująca formularz każe redakcji
    // wpisywać definicję od nowa - i nie mówi, co poszło nie tak.
    h.insertError = "duplicate key value violates unique constraint";
    await mount();
    type("termPl", "Akt delegowany");
    type("defPl", "Druga definicja tego samego hasła.");
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(field("termPl")).toHaveValue("Akt delegowany");
    expect(field("defPl")).toHaveValue("Druga definicja tego samego hasła.");
  });

  it("w trakcie zapisu „Dodaj” jest zablokowany - drugi klik nie robi drugiego insertu", async () => {
    // Drugi insert tego samego terminu to odmowa unikalności sluga po
    // pierwszym sukcesie - czyli komunikat błędu po udanym zapisie.
    h.hangInsert = true;
    await mount();
    type("termPl", "Akt wykonawczy");
    type("defPl", "Akt Komisji wykonujący akt podstawowy.");
    fireEvent.click(addButton());

    await waitFor(() => expect(addButton()).toBeDisabled());
    fireEvent.click(addButton());
    expect(chainsWith("insert")).toHaveLength(1);
  });
});

describe("admin.glossary - usunięcie terminu", () => {
  const deleteButton = () => screen.getByRole("button", { name: "admin.glossary.deleteConfirm" });

  it("pyta o potwierdzenie destrukcyjne i NAZYWA w nim termin", async () => {
    // REGUŁA 5. Potwierdzenie bez nazwy terminu nie daje się sprawdzić przed
    // klikiem - a usunięcie zdejmuje tooltipy we wszystkich wpisach.
    await mount();
    await screen.findByText("Akt delegowany");
    fireEvent.click(deleteButton());

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({
      title: "admin.glossary.deleteTitle",
      description: "Akt delegowany",
      confirmLabel: "admin.glossary.deleteConfirm",
      destructive: true,
    });
  });

  it("ODMOWA w potwierdzeniu nie woła bazy", async () => {
    h.confirmAnswer = false;
    await mount();
    await screen.findByText("Akt delegowany");
    fireEvent.click(deleteButton());

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    // Oddajemy pętli zdarzeń szansę na ewentualny (błędny) zapis po odmowie.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chainsWith("delete")).toEqual([]);
  });

  it("ZGODA usuwa wiersz po `id` i przeładowuje listę", async () => {
    // `delete()` bez filtra `id` to próba skasowania całego słowniczka -
    // zatrzymałby ją RLS tylko dla cudzych tenantów, nie dla własnego.
    await mount();
    await screen.findByText("Akt delegowany");
    const readsBefore = reads().length;
    h.terms = [];
    fireEvent.click(deleteButton());

    await waitFor(() => expect(chainsWith("delete")).toHaveLength(1));
    expect(chainsWith("delete")[0].argsOf("eq")).toEqual(["id", "t1"]);
    await waitFor(() => expect(reads().length).toBeGreaterThan(readsBefore));
    expect(await screen.findByText("admin.glossary.empty")).toBeInTheDocument();
  });

  it("błąd usunięcia → toast z komunikatem, a termin zostaje na liście", async () => {
    h.deleteError = "permission denied for table glossary_terms";
    await mount();
    await screen.findByText("Akt delegowany");
    fireEvent.click(deleteButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table glossary_terms"),
    );
    expect(screen.getByText("Akt delegowany")).toBeInTheDocument();
  });
});
