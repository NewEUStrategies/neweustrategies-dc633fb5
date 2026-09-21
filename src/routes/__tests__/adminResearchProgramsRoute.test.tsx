// Trasa `/admin/research-programs` ZAMONTOWANA - panel stron programów
// badawczych (think-tank): dossier programu + cztery zasoby podrzędne
// (zespół, projekty, partnerzy, wybrane materiały).
//
// CO TEN PLIK POKRYWA, CZEGO NIE POKRYWA NIC INNEGO.
//
// Ta trasa nie ma warstwy bibliotecznej: 1132 linie, dwa `useQuery` na
// poziomie strony i pięć kolejnych w zakładkach, wszystkie z klientem
// Supabase WPROST w `queryFn`, plus dziewięć zapisów pisanych ręcznie
// w `onClick`. Nie da się tego pokryć testem czystej funkcji, bo czystych
// funkcji tu nie ma - reguły mieszkają w domknięciach komponentu.
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
//      przeładowywałoby wszystko, węższego - nic.
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
// - RENDEROWANIA KAŻDEGO POLA FORMULARZA. Jedna interakcja na typ pola
//   (tekst, lista wyboru, przełącznik, edytor pytań badawczych) dowodzi, że
//   wersja robocza dojeżdża do ładunku. Klikanie wszystkich dwudziestu pól po
//   kolei dla procentu byłoby farmą pokrycia z nagłówka bramki autorytetu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";

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
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
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
// czego happy-dom nie odtwarza. Atrapa zachowuje jedyną rzecz, na której stoją
// asercje: treść jest w drzewie WYŁĄCZNIE gdy `open`.
vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  const Box = ({ children }: { children?: ReactNode }) =>
    react.createElement("div", null, children as never);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? react.createElement("div", { role: "dialog" }, children as never) : null,
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

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(screen.queryByText("adminPrograms.title")).toBeNull();
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

    expect(await screen.findByText("adminPrograms.empty")).toBeInTheDocument();
    // Przycisk dodania musi zostać - to jedyne wyjście ze stanu pustego.
    expect(button("adminPrograms.newProgram")).toBeInTheDocument();
  });

  it("status dossier jest widoczny na liście - szkic nie może wyglądać jak opublikowany", async () => {
    // Panel bez etykiety statusu zmusza redakcję do wchodzenia w każdy wiersz,
    // żeby sprawdzić, czy program jest już publiczny.
    db().setResponse("research_programs", () => ok([program({ status: "published" })]));
    await mount();

    expect(await screen.findByText("published")).toBeInTheDocument();
  });
});

describe("admin.research-programs - awaria odczytu listy", () => {
  it("KONTROLA DODATNIA: dziś awaria odczytu pokazuje stan PUSTY", async () => {
    // To jest DZISIEJSZE zachowanie i ten test ma je przybić, żeby przypięty
    // niżej defekt nie był „przechodzącym testem na brakującym warunku".
    db().setResponse("research_programs", () => fail("test: research_programs niedostępne"));
    await mount();

    expect(await screen.findByText("adminPrograms.empty")).toBeInTheDocument();
  });

  it.fails("awaria odczytu NIE MOŻE udawać pustej listy programów", async () => {
    // DEFEKT PRODUKCYJNY (nienaprawiony w tej pracy - naprawa wymaga decyzji
    // o kształcie komunikatu i jest wspólna dla czterech zakładek).
    //
    // KONSEKWENCJA. Panel pokazuje `adminPrograms.empty` zarówno wtedy, gdy
    // programów nie ma, jak i wtedy, gdy odczytu nie udało się wykonać
    // (odmowa RLS, padnięty transport). Redakcja widzi „brak programów"
    // i tworzy program od zera - a slug już istnieje, więc zapis odbija się
    // naruszeniem unikalności. W wariancie gorszym: tworzy DRUGI program
    // o innym slugu i serwis ma dwa landingi tego samego obszaru badawczego.
    //
    // KONTRAKT DOCELOWY (wzór: `adminLoginSettingsRoute.test.tsx`, reguła
    // „awaria odczytu nie udaje pustki"): przy `isError` panel pokazuje
    // komunikat o nieudanym odczycie, a NIE stan pusty.
    db().setResponse("research_programs", () => fail("test: research_programs niedostępne"));
    await mount();

    await waitFor(() => expect(screen.queryByText("adminPrograms.empty")).toBeNull());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("admin.research-programs - zapis dossier", () => {
  async function openCreate() {
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button("adminPrograms.newProgram"));
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
    fireEvent.click(button("adminPrograms.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPrograms.errSlug"));
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
    fireEvent.click(button("adminPrograms.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPrograms.errNames"));
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
    fireEvent.click(button("adminPrograms.add"));
    fireEvent.click(button("adminPrograms.save"));

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
    fireEvent.click(button("adminPrograms.save"));

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

  it("udany zapis zamyka okno, chwali i unieważnia klucz listy", async () => {
    // Bez unieważnienia panel pokazuje listę sprzed zapisu, a redakcja
    // klika „zapisz" po raz drugi, bo nie widzi skutku pierwszego.
    const view = await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("adminPrograms.newProgram"));
    await screen.findByRole("dialog");
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.change(inputs[2], { target: { value: "Defence" } });
    fireEvent.click(button("adminPrograms.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminPrograms.saved"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-research-programs"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("błąd bazy przy zapisie NIE zamyka okna i nie chwali", async () => {
    // Zamknięte okno po odmowie RLS wygląda jak zapis wykonany - a wersja
    // robocza przepada razem z oknem.
    db().setResponse("research_programs", (chain) =>
      chain.has("insert") ? fail("test: odmowa polityki RLS", "42501") : ok([program()]),
    );
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button("adminPrograms.newProgram"));
    await screen.findByRole("dialog");
    fireEvent.change(byPlaceholder("np. bezpieczenstwo-europy"), { target: { value: "obrona" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Obronność" } });
    fireEvent.change(inputs[2], { target: { value: "Defence" } });
    fireEvent.click(button("adminPrograms.save"));

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
      title: "adminPrograms.deleteConfirm",
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
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminPrograms.deleted"));
  });
});

describe("admin.research-programs - okno treści programu i cztery zakładki", () => {
  async function openManage() {
    await mount();
    await screen.findByText(/Bezpieczeństwo Wschodu/);
    fireEvent.click(button(/adminPrograms\.content/));
    return screen.findByRole("dialog");
  }

  it("otwarcie okna montuje zakładkę zespołu i pyta o członków TEGO programu", async () => {
    // Zapytanie bez `eq("program_id", ...)` pokazałoby zespół innego programu
    // - a lista jest jednocześnie formularzem usuwania.
    await openManage();

    await waitFor(() => expect(db().chainsFor("research_program_members").length).toBe(1));
    expect(lastChain("research_program_members").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
    expect(screen.getByText("adminPrograms.members.empty")).toBeInTheDocument();
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

    expect(button("adminPrograms.members.addMember")).toBeDisabled();
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
    fireEvent.click(screen.getByRole("tab", { name: /adminPrograms\.tabs\.projects/ }));

    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    expect(lastChain("research_program_projects").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
  });

  it("projekt bez nazwy w jednym z języków nie jedzie do bazy", async () => {
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminPrograms\.tabs\.projects/ }));
    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    fireEvent.change(byPlaceholder("adminPrograms.projects.namePl"), {
      target: { value: "Mapa dostaw" },
    });
    fireEvent.click(button(/adminPrograms\.projects\.addProject/));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminPrograms.projects.nameRequired"),
    );
    expect(
      db()
        .chainsFor("research_program_projects")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("dodany projekt dostaje `program_id` i kolejność na końcu listy", async () => {
    // `sort_order` liczony z długości listy jest jedyną rzeczą, która trzyma
    // kolejność projektów na stronie publicznej.
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminPrograms\.tabs\.projects/ }));
    await waitFor(() => expect(db().chainsFor("research_program_projects").length).toBe(1));
    fireEvent.change(byPlaceholder("adminPrograms.projects.namePl"), {
      target: { value: "Mapa dostaw" },
    });
    fireEvent.change(byPlaceholder("adminPrograms.projects.nameEn"), {
      target: { value: "Supply map" },
    });
    fireEvent.click(button(/adminPrograms\.projects\.addProject/));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("research_program_projects")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const insert = db()
      .chainsFor("research_program_projects")
      .find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      program_id: PROGRAM_ID,
      name_pl: "Mapa dostaw",
      name_en: "Supply map",
      project_status: "active",
      sort_order: 1,
    });
  });

  it("zakładka partnerów pyta o partnerów TEGO programu, a partner bez nazwy nie jedzie", async () => {
    await openManage();
    fireEvent.click(screen.getByRole("tab", { name: /adminPrograms\.tabs\.partners/ }));

    await waitFor(() => expect(db().chainsFor("research_program_partners").length).toBe(1));
    expect(lastChain("research_program_partners").argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
    fireEvent.click(button(/adminPrograms\.partners\.addPartner/));
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
    fireEvent.click(screen.getByRole("tab", { name: /adminPrograms\.tabs\.curated/ }));
    await waitFor(() => expect(db().chainsFor("research_program_items").length).toBe(1));
    const typeSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector('option[value="flagship_post"]'));
    if (!typeSelect) throw new Error("test: brak listy typu materiału");
    fireEvent.change(typeSelect, { target: { value: "podcast" } });
    fireEvent.change(byPlaceholder("adminPrograms.items.recordUuid"), {
      target: { value: PROFILE_ID },
    });
    fireEvent.click(button(/adminPrograms\.add/));

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
});
