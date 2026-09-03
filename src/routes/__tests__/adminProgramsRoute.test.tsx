// Trasa `/admin/programs` ZAMONTOWANA - programy, projekty i departamenty
// huba eksperta oraz przypisania ekspertów (członków) z funkcją PL/EN.
//
// UWAGA NA NAZWĘ: to NIE jest `/admin/research-programs`. Tamta trasa
// redaguje pełne landingi think-tanku (`research_programs`), ta zarządza
// uproszczoną tabelą `programs`, której jedynym zadaniem jest TAGOWANIE
// treści i przypisania ekspertów. Oba panele mówią kluczami z prefiksu
// `adminPrograms.` i mają osobne klucze cache - stąd ten akapit, żeby nikt
// nie „ujednolicił" ich przez pomyłkę.
//
// GŁÓWNY PRZEDMIOT DOWODU: UNIEWAŻNIANIE CACHE PO STRONIE PUBLICZNEJ.
// Ten panel jest źródłem danych dla DWÓCH powierzchni publicznych:
// katalogu ekspertów (`["public", "experts-directory"]`) i strony
// pojedynczego eksperta (`["public", "expert"]`). Zapis, który unieważnia
// tylko klucz panelu, daje redakcji wrażenie wykonanej pracy i zostawia
// czytelnikowi stary katalog. Ten plik przybija, które zapisy robią to
// poprawnie, i PRZYPINA dwa, które tego nie robią.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a prawo zapisu do
//   `programs` / `program_members` egzekwuje RLS (rola admin/editor
//   najemcy); warstw pilnuje `adminRouteAuthority.gate.test.ts`.
// - KATALOGU EKSPERTÓW: `experts.tsx` i `ExpertPicker` mają własne testy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  users: [] as { id: string; display_name: string | null; email: string | null }[],
  rpcNames: [] as string[],
  tenantId: null as string | null,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-experts", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-programs", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (request: Record<string, unknown>) => {
    h.confirmCalls.push(request);
    return Promise.resolve(h.confirmAnswer);
  },
}));
// Wierna w jednym punkcie: prawdziwy `useRequiredTenant` RZUCA bez tenanta.
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
import { Route as ProgramsRoute } from "@/routes/admin.programs";

const PATH = "/admin/programs";
const DIRECTORY_KEY = ["public", "experts-directory"];

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Wiersz programu. Nazwy WYMYŚLONE (RODO w fixtures). */
function program(patch: Record<string, unknown> = {}) {
  return {
    id: PROGRAM_ID,
    slug: "polityka-klimatu",
    name_pl: "Polityka klimatu",
    name_en: "Climate policy",
    kind: "program",
    description_pl: null,
    description_en: null,
    is_active: true,
    sort_order: 1,
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: ProgramsRoute, path: PATH, initialEntry: PATH });
}

function chainWith(table: string, method: string): RecordedChain {
  const found = db()
    .chainsFor(table)
    .find((c) => c.has(method));
  if (!found) throw new Error(`test: brak łańcucha "${table}" z ogniwem "${method}"`);
  return found;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** Pole slugu w oknie programu - etykieta „Slug" jest wspólna dla PL i EN. */
const slugField = () => screen.getByLabelText("Slug");

/** Klika kosz w wierszu programu (jedyny kosz na liście). */
function clickRowTrash(): void {
  const trash = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"));
  if (!trash) throw new Error("test: brak przycisku usunięcia w wierszu programu");
  fireEvent.click(trash);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tenantId = TENANT;
  h.users = [];
  h.rpcNames = [];
  h.confirmAnswer = true;
  h.confirmCalls = [];
  db().reset();
  db().setResponse("programs", (chain) => (chain.has("select") ? ok([program()]) : ok([])));
  db().setResponse("program_members", () => ok([]));
  db().setResponse("profiles", () => ok([]));
});

afterEach(() => cleanup());

describe("admin.programs - kontekst obszaru roboczego i sklejenie", () => {
  it("BEZ tenanta panel nie renderuje się i NIE pyta bazy", async () => {
    // Zapis programu niesie `tenant_id` z klienta, więc panel bez tenanta
    // mógłby wysłać wiersz bez obszaru roboczego - program niewidoczny dla
    // żadnej strony publicznej, a zajmujący slug.
    h.tenantId = null;
    await mount();

    expect(screen.queryByText("admin.nav.programs")).toBeNull();
    expect(db().chains).toEqual([]);
  });

  it("lista jest porządkowana kolumną `sort_order`, a klucz cache niesie tenanta", async () => {
    const view = await mount();
    await screen.findByText("Polityka klimatu");

    expect(chainWith("programs", "select").argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
    expect(
      view.queryClient
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey),
    ).toContainEqual(["admin-programs", TENANT]);
  });

  it("pusta lista daje stan pusty i zostawia drogę dodania programu", async () => {
    db().setResponse("programs", () => ok([]));
    await mount();

    expect(await screen.findByText("adminPrograms.empty")).toBeInTheDocument();
    expect(button("adminPrograms.newProgram")).toBeInTheDocument();
  });

  it("awaria odczytu nie wywala panelu - nagłówek i akcja dodania zostają", async () => {
    db().setResponse("programs", () => fail("test: odmowa odczytu programs", "42501"));
    await mount();

    expect(await screen.findByText("admin.nav.programs")).toBeInTheDocument();
    expect(button("adminPrograms.newProgram")).toBeInTheDocument();
  });

  it("rodzaj wpisu jest widoczny etykietą, nie surowym enumem", async () => {
    // `programs.kind` rozstrzyga, czy wpis jest programem, projektem czy
    // departamentem - a od tego zależy, gdzie wychodzi na stronie eksperta.
    db().setResponse("programs", (chain) =>
      chain.has("select") ? ok([program({ kind: "department" })]) : ok([]),
    );
    await mount();
    await screen.findByText("Polityka klimatu");

    expect(screen.getByText("adminPrograms.kind.department")).toBeInTheDocument();
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(ProgramsRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.programs - zapis programu", () => {
  async function openCreate() {
    await mount();
    await screen.findByText("Polityka klimatu");
    fireEvent.click(button("adminPrograms.newProgram"));
    await screen.findByRole("dialog");
  }

  it("slug spoza wzorca odrzuca zapis PRZED zapytaniem", async () => {
    // Slug programu wchodzi w adresy filtrów katalogu ekspertów; wielkie
    // litery i spacje dają link, którego nie da się odtworzyć.
    await openCreate();
    fireEvent.change(slugField(), { target: { value: "Polityka Klimatu" } });
    fireEvent.click(button("adminPrograms.dialog.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPrograms.validation.slug"));
    expect(
      db()
        .chainsFor("programs")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("brak nazwy w jednym z języków odrzuca zapis", async () => {
    await openCreate();
    fireEvent.change(slugField(), { target: { value: "klimat" } });
    fireEvent.change(screen.getByLabelText("adminPrograms.dialog.namePl"), {
      target: { value: "Klimat" },
    });
    fireEvent.click(button("adminPrograms.dialog.save"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminPrograms.validation.names"),
    );
    expect(
      db()
        .chainsFor("programs")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("nowy program jedzie INSERTEM z `tenant_id` i unieważnia OBA klucze", async () => {
    // Zapis programu zmienia listę filtrów w katalogu ekspertów, więc musi
    // ruszyć klucz publiczny - inaczej nowy program nie pojawia się nikomu
    // poza redakcją, dopóki cache nie wygaśnie.
    const view = await mount();
    await screen.findByText("Polityka klimatu");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("adminPrograms.newProgram"));
    await screen.findByRole("dialog");
    fireEvent.change(slugField(), { target: { value: "klimat" } });
    fireEvent.change(screen.getByLabelText("adminPrograms.dialog.namePl"), {
      target: { value: "Klimat" },
    });
    fireEvent.change(screen.getByLabelText("adminPrograms.dialog.nameEn"), {
      target: { value: "Climate" },
    });
    fireEvent.click(button("adminPrograms.dialog.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("programs")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(chainWith("programs", "insert").argsOf("insert")?.[0]).toMatchObject({
      slug: "klimat",
      tenant_id: TENANT,
      kind: "program",
      is_active: true,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-programs"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });

  it("edycja jedzie UPDATE po identyfikatorze, nie INSERTEM", async () => {
    await mount();
    await screen.findByText("Polityka klimatu");
    fireEvent.click(button("edit"));
    await screen.findByRole("dialog");
    fireEvent.click(button("adminPrograms.dialog.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("programs")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(chainWith("programs", "update").argsOf("eq")).toEqual(["id", PROGRAM_ID]);
    expect(
      db()
        .chainsFor("programs")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("błąd bazy przy zapisie NIE zamyka okna i nie chwali", async () => {
    db().setResponse("programs", (chain) =>
      chain.has("select") ? ok([program()]) : fail("test: odmowa polityki RLS", "42501"),
    );
    await mount();
    await screen.findByText("Polityka klimatu");
    fireEvent.click(button("edit"));
    await screen.findByRole("dialog");
    fireEvent.click(button("adminPrograms.dialog.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("admin.programs - usunięcie programu", () => {
  it("pyta o potwierdzenie z nazwą programu w treści", async () => {
    // Usunięcie programu zdejmuje przypisania wszystkich ekspertów do niego.
    await mount();
    await screen.findByText("Polityka klimatu");
    clickRowTrash();

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({ title: "adminPrograms.remove.title" });
    expect(String(h.confirmCalls[0].description)).toContain("Polityka klimatu");
  });

  it("ODMOWA w potwierdzeniu nie wysyła DELETE", async () => {
    h.confirmAnswer = false;
    await mount();
    await screen.findByText("Polityka klimatu");
    clickRowTrash();

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(
      db()
        .chainsFor("programs")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });

  it("ZGODA usuwa DOKŁADNIE ten wiersz", async () => {
    await mount();
    await screen.findByText("Polityka klimatu");
    clickRowTrash();

    await waitFor(() =>
      expect(
        db()
          .chainsFor("programs")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(chainWith("programs", "delete").argsOf("eq")).toEqual(["id", PROGRAM_ID]);
  });

  it("KONTROLA DODATNIA: usunięcie unieważnia dziś TYLKO klucz panelu", async () => {
    // Dzisiejsze zachowanie, przybite, żeby przypięty niżej defekt nie był
    // „testem przechodzącym na brakującym wywołaniu".
    const view = await mount();
    await screen.findByText("Polityka klimatu");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    clickRowTrash();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-programs"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });

  it.fails("usunięcie programu MUSI unieważnić katalog ekspertów", async () => {
    // DEFEKT PRODUKCYJNY (nienaprawiony w tej pracy: poprawka to jedna linia,
    // ale zmienia zachowanie cache na powierzchni publicznej, więc należy do
    // pracy nad katalogiem ekspertów, nie do pracy nad pokryciem).
    //
    // ASYMETRIA JEST CAŁYM DOWODEM: `saveProgram` unieważnia DWA klucze
    // (`["admin-programs"]` i `["public", "experts-directory"]`),
    // a `removeProgram` tylko pierwszy. Konsekwencja: redakcja usuwa program,
    // panel pokazuje to natychmiast, a katalog ekspertów w tej samej sesji
    // przeglądarki dalej oferuje filtr po programie, którego już nie ma -
    // klik w ten filtr daje pustą listę bez wyjaśnienia. Cache publiczny
    // odświeży się dopiero po wygaśnięciu wpisu.
    const view = await mount();
    await screen.findByText("Polityka klimatu");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    clickRowTrash();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });
});

describe("admin.programs - członkowie programu", () => {
  async function openMembers() {
    const view = await mount();
    await screen.findByText("Polityka klimatu");
    const people = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-users"));
    if (!people) throw new Error("test: brak przycisku członków w wierszu programu");
    fireEvent.click(people);
    await screen.findByRole("dialog");
    return view;
  }

  it("czyta członków TEGO programu w kolejności porządkowej", async () => {
    // Odczyt bez `eq("program_id", ...)` pokazałby członków innego programu
    // - a lista jest jednocześnie formularzem usuwania przypisań.
    await openMembers();

    await waitFor(() => expect(db().chainsFor("program_members").length).toBe(1));
    const chain = chainWith("program_members", "select");
    expect(chain.argsOf("eq")).toEqual(["program_id", PROGRAM_ID]);
    expect(chain.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("kandydaci idą RPC `admin_list_users` i NIE zawierają już przypisanych", async () => {
    // Podwójne przypisanie tej samej osoby to naruszenie klucza złożonego -
    // błąd bazy w miejscu, w którym wystarczy nie pokazać opcji.
    h.users = [
      { id: USER_ID, display_name: "Jan Testowy", email: "jan@example.org" },
      { id: "55555555-5555-4555-8555-555555555555", display_name: "Ewa Próbna", email: null },
    ];
    db().setResponse("program_members", (chain) =>
      chain.has("select")
        ? ok([{ user_id: USER_ID, role_pl: null, role_en: null, sort_order: 1 }])
        : ok([]),
    );
    db().setResponse("profiles", () =>
      ok([{ id: USER_ID, display_name: "Jan Testowy", avatar_url: null }]),
    );
    await openMembers();
    await screen.findByText("Jan Testowy");

    expect(h.rpcNames).toContain("admin_list_users");
    const candidateSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector("option"));
    if (!candidateSelect) throw new Error("test: brak listy kandydatów");
    const values = [...candidateSelect.querySelectorAll("option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(values).not.toContain(USER_ID);
    expect(values).toContain("55555555-5555-4555-8555-555555555555");
  });

  it("dodanie członka niesie `program_id` i unieważnia OBIE powierzchnie publiczne", async () => {
    // Przypisanie eksperta do programu zmienia jego stronę I katalog -
    // stąd dwa klucze publiczne obok klucza panelu.
    h.users = [{ id: USER_ID, display_name: "Jan Testowy", email: "jan@example.org" }];
    const view = await openMembers();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    // Kandydaci przychodzą RPC, więc opcja pojawia się dopiero po jego powrocie.
    await waitFor(() =>
      expect(document.querySelector(`option[value="${USER_ID}"]`)).not.toBeNull(),
    );
    const candidateSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector(`option[value="${USER_ID}"]`));
    if (!candidateSelect) throw new Error("test: brak kandydata na liście");
    fireEvent.change(candidateSelect, { target: { value: USER_ID } });
    fireEvent.click(button("adminPrograms.membersDialog.assign"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("program_members")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(chainWith("program_members", "insert").argsOf("insert")?.[0]).toMatchObject({
      program_id: PROGRAM_ID,
      user_id: USER_ID,
      role_pl: null,
      role_en: null,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-program-members", PROGRAM_ID] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["public", "expert"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });

  it("usunięcie członka filtruje po OBU kolumnach klucza złożonego", async () => {
    // `delete().eq("user_id", ...)` bez programu wypisałby eksperta ze
    // WSZYSTKICH programów obszaru roboczego naraz.
    db().setResponse("program_members", (chain) =>
      chain.has("select")
        ? ok([{ user_id: USER_ID, role_pl: null, role_en: null, sort_order: 1 }])
        : ok([]),
    );
    db().setResponse("profiles", () =>
      ok([{ id: USER_ID, display_name: "Jan Testowy", avatar_url: null }]),
    );
    await openMembers();
    await screen.findByText("Jan Testowy");
    const trash = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash2"))
      .at(-1);
    fireEvent.click(trash!);

    await waitFor(() =>
      expect(
        db()
          .chainsFor("program_members")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(
      chainWith("program_members", "delete")
        .calls.filter((c) => c.method === "eq")
        .map((c) => c.args),
    ).toEqual([
      ["program_id", PROGRAM_ID],
      ["user_id", USER_ID],
    ]);
  });

  async function removeMemberFlow() {
    db().setResponse("program_members", (chain) =>
      chain.has("select")
        ? ok([{ user_id: USER_ID, role_pl: null, role_en: null, sort_order: 1 }])
        : ok([]),
    );
    db().setResponse("profiles", () =>
      ok([{ id: USER_ID, display_name: "Jan Testowy", avatar_url: null }]),
    );
    const view = await openMembers();
    await screen.findByText("Jan Testowy");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const trash = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash2"))
      .at(-1);
    fireEvent.click(trash!);
    await waitFor(() =>
      expect(
        db()
          .chainsFor("program_members")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    return spy;
  }

  it("KONTROLA DODATNIA: wypisanie członka unieważnia dziś stronę eksperta, ale NIE katalog", async () => {
    const spy = await removeMemberFlow();

    expect(spy).toHaveBeenCalledWith({ queryKey: ["public", "expert"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });

  it.fails("wypisanie członka MUSI unieważnić katalog ekspertów", async () => {
    // DEFEKT PRODUKCYJNY, ta sama klasa co przy usuwaniu programu i ta sama
    // asymetria: `addMember` unieważnia TRZY klucze (panel, strona eksperta,
    // katalog), `removeMember` tylko dwa - gubi katalog.
    //
    // KONSEKWENCJA. Katalog ekspertów filtruje po programach, więc ekspert
    // wypisany z programu zostaje w wynikach filtra tego programu. Czytelnik
    // klika „Polityka klimatu", widzi tam osobę, która już się nią nie
    // zajmuje, wchodzi na jej stronę - i tam programu nie ma. Sprzeczność
    // między dwiema stronami publicznymi tego samego serwisu.
    const spy = await removeMemberFlow();

    expect(spy).toHaveBeenCalledWith({ queryKey: DIRECTORY_KEY });
  });
});
