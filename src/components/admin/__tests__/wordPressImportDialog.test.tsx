// @vitest-environment jsdom
// DIALOG IMPORTU Z WORDPRESSA (`src/components/admin/WordPressImportDialog.tsx`, 0%).
//
// To wejście do implementacji B importu: przycisk na /admin/pages otwiera ten
// dialog, a w nim są DWIE zakładki - konektor WordPress.com i wgranie pliku WXR
// (`WxrUploadPanel`, testowany osobno).
//
// CZEGO NIE ATRAPUJEMY: `@/lib/wp-import.functions` ani `@/lib/wp-import/*`.
// Podmieniony jest framework (żeby dało się wywołać server fn), klient
// Supabase, gateway HTTP, i18n, toasty, mirror mediów i komponenty Radiksa.
// Test przechodzi więc całą drogę: wpisana domena -> zapytanie do gatewaya ->
// tabela -> ładunek -> walidator zod -> handler -> zapis do `pages`.
//
// CO MA TU DOWÓD:
//   1. normalizacja domeny (wklejony URL, `www.`, ścieżka, wielkie litery) i
//      zapamiętanie jej w localStorage - to pole jest jedynym parametrem
//      zapytania do gatewaya,
//   2. odrzucenie domeny niepoprawnej BEZ wyjścia w sieć,
//   3. HEURYSTYKA JĘZYKA tego panelu (`/-en$|^en-|\\/en\\/|\\ben\\b/`),
//   4. ROZJAZD z heurystyką panelu WXR - zarejestrowany jako `it.fails`,
//   5. strona /main jest w tabeli, ale niewybieralna i nie liczy się do puli,
//   6. ładunek importu: pary PL/EN jako jeden wiersz, nadpisanie istniejącej
//      strony, ręczny slug, status docelowy i flagi mediów,
//   7. raport: sukces / nadpisania / treść EN / pominięcia / błędy oraz
//      zamknięcie dialogu i unieważnienie cache'u TYLKO po realnym zapisie,
//   8. podgląd konwersji otwiera się dla wskazanego wiersza.
//
// RODO: brak realnych danych osobowych; domeny wyłącznie example.com /
// example.org, klucze API jawnie fałszywe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, useContext, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

type Validator = (input: unknown) => unknown;
type Handler = (ctx: { data: unknown; context: unknown }) => Promise<unknown>;
interface ServerFnSpec {
  validator?: Validator;
  handler?: Handler;
}

const h = vi.hoisted(() => ({
  language: "pl",
  toastSuccess: [] as string[],
  toastError: [] as string[],
  toastInfo: [] as string[],
  toastWarning: [] as string[],
  context: null as unknown,
  mirrorCalls: [] as Array<{ includeExternal?: boolean }>,
  /** Rzut CZYMŚ INNYM niż Error - odpowiedź nie-JSON z warstwy serwerowej. */
  serverThrowRaw: null as string | null,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.language);
});

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess.push(m),
    error: (m: string) => h.toastError.push(m),
    info: (m: string) => h.toastInfo.push(m),
    warning: (m: string) => h.toastWarning.push(m),
  },
}));

// Atrapa CZĄSTKOWA - `createIsomorphicFn` z tego modułu jest potrzebny warstwie
// i18n, którą wciąga renderer buildera w dialogu podglądu.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  interface Chain {
    middleware: (m: unknown) => Chain;
    validator: (v: Validator) => Chain;
    inputValidator: (v: Validator) => Chain;
    handler: (fn: Handler) => ServerFnSpec;
  }
  const createServerFn = (): Chain => {
    const spec: ServerFnSpec = {};
    const chain: Chain = {
      middleware: () => chain,
      validator: (v) => {
        spec.validator = v;
        return chain;
      },
      inputValidator: (v) => {
        spec.validator = v;
        return chain;
      },
      handler: (fn) => {
        spec.handler = fn;
        return spec;
      },
    };
    return chain;
  };
  const useServerFn =
    (spec: ServerFnSpec) =>
    async (args: { data: unknown }): Promise<unknown> => {
      if (h.serverThrowRaw) throw h.serverThrowRaw;
      const data = spec.validator ? spec.validator(args.data) : args.data;
      if (!spec.handler) throw new Error("test: brak handlera server fn");
      return spec.handler({ data, context: h.context });
    };
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, createServerFn, useServerFn };
});

vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));

vi.mock("@/lib/server/wp-media.server", () => ({
  mirrorWpMedia: async (opts: { includeExternal?: boolean }) => {
    h.mirrorCalls.push({ includeExternal: opts.includeExternal });
    return { map: new Map(), warnings: [], mirroredCount: 1, reusedCount: 0, failed: [] };
  },
  rewriteHtml: (html: string) => html,
  rewriteBuilderDoc: <T,>(doc: T) => doc,
}));

/* ----------------------------- Radix -> natywne ---------------------------- */

// Atrapa dialogu z WŁASNYM kontekstem na instancję - w tym drzewie są DWA
// dialogi (import i podgląd), więc wspólny stan modułowy mieszałby ich
// `onOpenChange` i „zamknięty" podglądu zamykałby import.
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; onOpenChange: (next: boolean) => void }>({
    open: false,
    onOpenChange: () => {},
  });
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open, onOpenChange }}>
        <div data-dialog={open ? "open" : "closed"}>{children}</div>
      </Ctx.Provider>
    ),
    DialogTrigger: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return (
        <span data-testid="dialog-trigger" onClick={() => ctx.onOpenChange(true)}>
          {children}
        </span>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx.open ? <div>{children}</div> : null;
    },
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/components/ui/tabs", () => {
  const TabCtx = createContext<{ value: string; setValue: (next: string) => void }>({
    value: "",
    setValue: () => {},
  });
  return {
    Tabs: ({ defaultValue, children }: { defaultValue: string; children?: ReactNode }) => {
      const [value, setValue] = useState(defaultValue);
      return <TabCtx.Provider value={{ value, setValue }}>{children}</TabCtx.Provider>;
    },
    TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => {
      const ctx = useContext(TabCtx);
      return (
        <button type="button" data-tab-trigger={value} onClick={() => ctx.setValue(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => {
      const ctx = useContext(TabCtx);
      return ctx.value === value ? <div data-tab-content={value}>{children}</div> : null;
    },
  };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      data-value={value}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    id?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { WordPressImportDialog } from "@/components/admin/WordPressImportDialog";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const EXISTING_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "44444444-4444-4444-8444-444444444444";

/* ------------------------------- gateway HTTP ------------------------------ */

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

interface WpListed {
  ID: number;
  title: string;
  slug: string;
  status?: string;
  URL?: string;
  modified?: string;
}

const net = {
  calls: [] as string[],
  posts: [] as WpListed[],
  listStatus: 200,
  pageStatus: 200,
  /** Treść pojedynczej strony, gdy test potrzebuje czegoś innego niż domyślna. */
  contentById: new Map<number, string>(),
};

function installFetch(): void {
  vi.stubGlobal("fetch", async (input: unknown): Promise<FakeResponse> => {
    const url = String(input);
    net.calls.push(url);
    const bad = (status: number, body: string): FakeResponse => ({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => body,
    });
    if (url.includes("/posts?")) {
      if (net.listStatus !== 200) return bad(net.listStatus, "witryna niedostępna");
      return {
        ok: true,
        status: 200,
        json: async () => ({ posts: net.posts }),
        text: async () => "",
      };
    }
    const m = url.match(/\/posts\/(\d+)/);
    if (!m) return bad(500, "nieznany adres");
    if (net.pageStatus !== 200) return bad(net.pageStatus, "strona niedostępna");
    const listed = net.posts.find((p) => p.ID === Number(m[1]));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ID: Number(m[1]),
        title: listed?.title ?? `Strona ${m[1]}`,
        slug: listed?.slug ?? `strona-${m[1]}`,
        status: "publish",
        content: net.contentById.get(Number(m[1])) ?? `<p>Treść strony ${m[1]}.</p>`,
        excerpt: `Zapowiedź ${m[1]}`,
        featured_image: null,
        URL: `https://example.com/strona-${m[1]}`,
      }),
      text: async () => "",
    };
  });
}

/* ------------------------------ atrapa Supabase ---------------------------- */

interface Plan {
  insertError: string | null;
  current: { id: string; slug: string; title_pl: string; title_en: string } | null;
  existing: Array<{ id: string; title_pl: string; title_en: string; slug: string; status: string }>;
}

function installSupabase(plan: Partial<Plan> = {}) {
  const p: Plan = {
    insertError: null,
    current: null,
    existing: [
      {
        id: EXISTING_ID,
        title_pl: "O nas (w bazie)",
        title_en: "About",
        slug: "o-nas",
        status: "published",
      },
    ],
    ...plan,
  };
  const stub = supabaseFromStub();
  stub.setResponse("profiles", () => ok({ tenant_id: TENANT }));
  stub.setResponse("content_revisions", () => ok(null));
  stub.setResponse("pages", (chain: RecordedChain) => {
    if (chain.has("insert")) return p.insertError ? fail(p.insertError) : ok({ id: NEW_ID });
    if (chain.has("update")) return ok(null);
    if (chain.has("maybeSingle")) return ok(p.current);
    if (chain.has("order")) return ok(p.existing);
    return ok([]);
  });
  h.context = { supabase: { from: stub.from }, userId: USER };
  return stub;
}

/* --------------------------------- pomocnicy ------------------------------- */

function renderDialog() {
  return renderWithQueryClient(
    <WordPressImportDialog trigger={<button type="button">Import z WordPressa</button>} />,
  );
}

/** Dialog importu jest otwarty, gdy widać jego pole domeny. */
function importDialogOpen(): boolean {
  return screen.queryByPlaceholderText("mysite.wordpress.com") !== null;
}

async function open(): Promise<void> {
  fireEvent.click(screen.getByTestId("dialog-trigger"));
  await waitFor(() => expect(importDialogOpen()).toBe(true));
  // Zapytanie o istniejące strony startuje razem z otwarciem.
  await act(async () => {
    await Promise.resolve();
  });
}

async function load(domain: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("mysite.wordpress.com"), {
    target: { value: domain },
  });
  fireEvent.click(screen.getByRole("button", { name: /Wczytaj|Load/ }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function rowFor(slug: string): HTMLElement {
  const cell = screen.getAllByText(`/${slug}`);
  const row = cell[0].closest("tr");
  if (!row) throw new Error(`test: brak wiersza dla /${slug}`);
  return row;
}

function langOf(slug: string): string {
  return within(rowFor(slug)).getAllByTestId("select")[0].getAttribute("data-value") ?? "";
}

beforeEach(() => {
  cleanup();
  h.language = "pl";
  h.toastSuccess = [];
  h.toastError = [];
  h.toastInfo = [];
  h.toastWarning = [];
  h.mirrorCalls = [];
  net.calls = [];
  net.posts = [];
  net.listStatus = 200;
  net.pageStatus = 200;
  net.contentById = new Map();
  h.serverThrowRaw = null;
  window.localStorage.clear();
  process.env.LOVABLE_API_KEY = "test-platform-key-not-real";
  process.env.WORDPRESS_COM_API_KEY = "test-wp-key-not-real";
  installFetch();
  installSupabase();
});

/* ---------------------------------- testy ---------------------------------- */

describe("WordPressImportDialog - otwarcie i lista istniejących stron", () => {
  it("dopóki dialog jest zamknięty, nie ma zapytań", () => {
    renderDialog();
    expect(screen.queryByPlaceholderText("mysite.wordpress.com")).not.toBeInTheDocument();
  });

  it("po otwarciu wciąga listę stron z bazy PRAWDZIWĄ funkcją serwerową", async () => {
    const stub = installSupabase();
    renderDialog();
    await open();
    await waitFor(() => expect(stub.chainsFor("pages").length).toBeGreaterThan(0));
    const chain = stub.lastChain("pages");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("neq")).toEqual(["slug", "main"]);
    expect(screen.getByText(/Pobiera strony z WordPress.com/)).toBeInTheDocument();
  });
});

describe("WordPressImportDialog - domena i pobranie listy", () => {
  it("normalizuje wklejony URL i zapamiętuje domenę", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 1, title: "Kontakt", slug: "kontakt" }];
    await load("https://WWW.Example.COM/blog?utm=1");
    expect(net.calls.some((u) => u.includes("/sites/example.com/posts"))).toBe(true);
    expect(window.localStorage.getItem("wp_import_domain")).toBe("example.com");
    expect(screen.getByPlaceholderText("mysite.wordpress.com")).toHaveValue("example.com");
  });

  it("zapamiętaną domenę podpowiada przy kolejnym otwarciu", async () => {
    window.localStorage.setItem("wp_import_domain", "zapamietana.example.com");
    renderDialog();
    await open();
    expect(screen.getByPlaceholderText("mysite.wordpress.com")).toHaveValue(
      "zapamietana.example.com",
    );
  });

  it("domena niepoprawna kończy się komunikatem i BRAKIEM zapytania", async () => {
    renderDialog();
    await open();
    await load("nie jest domeną!!");
    expect(h.toastError[0]).toContain("Podaj domenę WordPress.com");
    expect(net.calls.filter((u) => u.includes("/posts"))).toHaveLength(0);
  });

  it("Enter w polu domeny też wczytuje listę", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 1, title: "Kontakt", slug: "kontakt" }];
    const input = screen.getByPlaceholderText("mysite.wordpress.com");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Kontakt")).toBeInTheDocument());
  });

  it("witryna bez stron: komunikat informacyjny, brak tabeli", async () => {
    renderDialog();
    await open();
    await load("example.com");
    expect(h.toastInfo).toEqual(["Brak stron w tej witrynie."]);
    expect(screen.queryByText(/Wybrane:/)).not.toBeInTheDocument();
  });

  it("błąd gatewaya trafia do komunikatu", async () => {
    net.listStatus = 502;
    renderDialog();
    await open();
    await load("example.com");
    expect(h.toastError[0]).toContain("WordPress zwrócił błąd 502");
  });
});

describe("WordPressImportDialog - heurystyka języka tego panelu", () => {
  it("rozpoznaje EN po sufiksie -en, prefiksie en-, ścieżce /en/ i SAMODZIELNYM słowie en", async () => {
    renderDialog();
    await open();
    net.posts = [
      { ID: 1, title: "About us", slug: "about-en" },
      { ID: 2, title: "About us", slug: "en-about" },
      { ID: 3, title: "Board", slug: "team/en/board" },
      { ID: 4, title: "Raport en 2026", slug: "raport" },
      { ID: 5, title: "O nas", slug: "o-nas" },
      { ID: 6, title: "Enterprise", slug: "enterprise" },
      { ID: 7, title: "Kontakt", slug: "kontakt_en_strona" },
    ];
    await load("example.com");
    expect(langOf("about-en")).toBe("en");
    expect(langOf("en-about")).toBe("en");
    expect(langOf("team/en/board")).toBe("en");
    // `\ben\b` łapie też „en" jako osobne słowo w TYTULE.
    expect(langOf("raport")).toBe("en");
    expect(langOf("o-nas")).toBe("pl");
    expect(langOf("enterprise")).toBe("pl");
    // Podkreślenie to znak słowa - `\ben\b` tu NIE trafia.
    expect(langOf("kontakt_en_strona")).toBe("pl");
  });

  it("ręczna zmiana języka nadpisuje heurystykę", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 1, title: "O nas", slug: "o-nas" }];
    await load("example.com");
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    expect(langOf("o-nas")).toBe("en");
  });
});

describe("WordPressImportDialog - wybór i pominięcie /main", () => {
  it("strona /main jest w tabeli, ale niewybieralna i poza pulą", async () => {
    renderDialog();
    await open();
    net.posts = [
      { ID: 1, title: "Strona główna", slug: "main" },
      { ID: 2, title: "O nas", slug: "o-nas" },
    ];
    await load("example.com");
    expect(screen.getByText("Wybrane: 0 / 1")).toBeInTheDocument();
    expect(within(rowFor("main")).getByRole("checkbox")).toBeDisabled();
    expect(within(rowFor("main")).getAllByTestId("select")[0]).toBeDisabled();
  });

  it("liczniki nowych, nadpisań i par nadążają za wyborem", async () => {
    renderDialog();
    await open();
    net.posts = [
      { ID: 1, title: "O nas", slug: "o-nas" },
      { ID: 2, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("about-en")).getByRole("checkbox"));
    expect(screen.getByText("Nowe: 2")).toBeInTheDocument();
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "2" },
    });
    expect(screen.getByText("Pary PL/EN: 1")).toBeInTheDocument();
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[2], {
      target: { value: EXISTING_ID },
    });
    expect(screen.getByText("Nadpisania: 1")).toBeInTheDocument();
    expect(screen.getByText("Nowe: 1")).toBeInTheDocument();
    // Odznaczenie wraca do zera.
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("about-en")).getByRole("checkbox"));
    expect(screen.getByText("Wybrane: 0 / 2")).toBeInTheDocument();
  });
});

describe("WordPressImportDialog - import przez PRAWDZIWĄ funkcję serwerową", () => {
  it("zapisuje wybraną stronę i zamyka dialog po sukcesie", async () => {
    const stub = installSupabase();
    const { queryClient } = renderDialog();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await open();
    net.posts = [{ ID: 7, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    const insert = stub.chainsFor("pages").find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      slug: "raport",
      title_pl: "Raport",
      editor: "builder",
      status: "draft",
      excerpt_pl: "Zapowiedź 7",
    });
    expect(h.toastSuccess.at(-1)).toBe("1 zaimportowanych");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-pages"] });
    expect(importDialogOpen()).toBe(false);
  });

  it("media są ściągane domyślnie, a przełączniki zmieniają zakres", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 8, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    // Drugi przełącznik („Także zewnętrzne CDN") pokazuje się tylko przy włączonym mirrorze.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    fireEvent.click(switches[1]);
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.mirrorCalls.length).toBe(1));
    expect(h.mirrorCalls[0].includeExternal).toBe(true);
  });

  it("wyłączenie mirroru mediów zabiera ściąganie z przebiegu", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 9, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    expect(h.mirrorCalls).toHaveLength(0);
  });

  it("para PL/EN idzie jako JEDEN wiersz z tytułem i treścią EN", async () => {
    const stub = installSupabase();
    renderDialog();
    await open();
    net.posts = [
      { ID: 10, title: "O nas", slug: "o-nas" },
      { ID: 11, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("about-en")).getByRole("checkbox"));
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    const inserts = stub.chainsFor("pages").filter((c) => c.has("insert"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].argsOf("insert")?.[0]).toMatchObject({
      slug: "o-nas",
      title_pl: "O nas",
      title_en: "About us",
    });
    expect(JSON.stringify(inserts[0].argsOf("insert")?.[0])).toContain("Treść strony 11");
    expect(h.toastSuccess.at(-1)).toContain("z treścią EN");
  });

  it("nadpisanie istniejącej strony robi migawkę i raportuje nadpisania", async () => {
    const stub = installSupabase({
      current: { id: EXISTING_ID, slug: "o-nas", title_pl: "O nas (w bazie)", title_en: "About" },
    });
    renderDialog();
    await open();
    net.posts = [{ ID: 12, title: "O nas z WP", slug: "o-nas-wp" }];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas-wp")).getByRole("checkbox"));
    fireEvent.change(within(rowFor("o-nas-wp")).getAllByTestId("select")[2], {
      target: { value: EXISTING_ID },
    });
    fireEvent.change(within(rowFor("o-nas-wp")).getByPlaceholderText("o-nas-wp"), {
      target: { value: "o-nas-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    expect(stub.lastChain("content_revisions")?.argsOf("insert")?.[0]).toMatchObject({
      note: "wp_import_pre_overwrite",
      entity_id: EXISTING_ID,
    });
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("update"))
        ?.argsOf("update")?.[0],
    ).toMatchObject({ slug: "o-nas-2026" });
    expect(h.toastSuccess.at(-1)).toContain("nadpisań");
  });

  it("status docelowy published dojeżdża do zapisu", async () => {
    const stub = installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 13, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    const statusSelect = screen
      .getAllByTestId("select")
      .find((el) => el.getAttribute("data-value") === "draft");
    if (!statusSelect) throw new Error("test: brak selektora statusu");
    fireEvent.change(statusSelect, { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ status: "published" });
  });

  it("błąd zapisu: komunikat z numerem strony WP i dialog zostaje otwarty", async () => {
    installSupabase({ insertError: "duplicate key value" });
    renderDialog();
    await open();
    net.posts = [{ ID: 14, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("1 błędów");
    expect(h.toastError.at(-1)).toBe("WP #14: duplicate key value");
    expect(importDialogOpen()).toBe(true);
  });

  it("błąd pobrania strony z WP też kończy się wierszem błędu", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 15, title: "Raport", slug: "raport" }];
    await load("example.com");
    net.pageStatus = 404;
    fireEvent.click(within(rowFor("raport")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastError.at(-1)).toContain("WordPress 404");
  });

  it("Anuluj zamyka dialog bez zapisu", async () => {
    const stub = installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 16, title: "Raport", slug: "raport" }];
    await load("example.com");
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(importDialogOpen()).toBe(false);
    expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(false);
  });

  it("przycisk importu jest zablokowany bez wyboru", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 17, title: "Raport", slug: "raport" }];
    await load("example.com");
    expect(screen.getByRole("button", { name: /Importuj \(0\)/ })).toBeDisabled();
  });
});

describe("WordPressImportDialog - podgląd konwersji", () => {
  it("przycisk podglądu otwiera dialog porównania dla wskazanego wiersza", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 18, title: "Raport", slug: "raport" }];
    await load("example.com");
    const buttons = within(rowFor("raport")).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.getByText(/Podgląd konwersji/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("html")).toBeInTheDocument());
    expect(screen.getByText(/Podgląd nie zapisuje niczego/)).toBeInTheDocument();
  });
});

describe("WordPressImportDialog - interfejs angielski", () => {
  it("nagłówki, zakładki i raport są po angielsku", async () => {
    h.language = "en";
    installSupabase();
    renderDialog();
    await open();
    expect(screen.getByText("Import from WordPress")).toBeInTheDocument();
    expect(screen.getByText("WordPress.com connector")).toBeInTheDocument();
    expect(screen.getByText("Upload WXR (XML)")).toBeInTheDocument();
    net.posts = [{ ID: 19, title: "Report", slug: "report" }];
    await load("example.com");
    expect(screen.getByText("Selected: 0 / 1")).toBeInTheDocument();
    fireEvent.click(within(rowFor("report")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Import \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    expect(h.toastSuccess.at(-1)).toBe("1 imported");
  });

  it("niepoprawna domena po angielsku", async () => {
    h.language = "en";
    renderDialog();
    await open();
    await load("!!!");
    expect(h.toastError[0]).toContain("Enter a WordPress.com domain");
  });
});

describe("WordPressImportDialog - dopięcia stanu i komunikatów", () => {
  it("puste pole domeny nie idzie do gatewaya", async () => {
    renderDialog();
    await open();
    await load("   ");
    expect(h.toastError[0]).toContain("Podaj domenę WordPress.com");
    expect(net.calls.filter((u) => u.includes("/posts"))).toHaveLength(0);
  });

  it("strona bez tytułu jest opisana identyfikatorem WP - także na liście par", async () => {
    installSupabase({
      existing: [
        { id: EXISTING_ID, title_pl: "", title_en: "About EN", slug: "o-nas", status: "draft" },
        { id: NEW_ID, title_pl: "", title_en: "", slug: "bez-tytulu", status: "draft" },
      ],
    });
    renderDialog();
    await open();
    net.posts = [
      { ID: 30, title: "", slug: "bez-tytulu" },
      { ID: 31, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    expect(screen.getAllByText("#30").length).toBeGreaterThan(0);
    // Lista stron do nadpisania: title_pl -> title_en -> slug.
    const overwriteSelect = within(rowFor("bez-tytulu")).getAllByTestId("select")[2];
    expect(overwriteSelect.textContent).toContain("About EN");
    expect(overwriteSelect.textContent).toContain("bez-tytulu");
  });

  it("wyczyszczenie pary, celu nadpisania i sluga wraca do stanu wyjściowego", async () => {
    const stub = installSupabase();
    renderDialog();
    await open();
    net.posts = [
      { ID: 32, title: "O nas", slug: "o-nas" },
      { ID: 33, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    const selects = () => within(rowFor("o-nas")).getAllByTestId("select");
    fireEvent.change(selects()[1], { target: { value: "33" } });
    fireEvent.change(selects()[2], { target: { value: EXISTING_ID } });
    fireEvent.change(within(rowFor("o-nas")).getByPlaceholderText("o-nas"), {
      target: { value: "nowy" },
    });
    expect(screen.getByText("Nadpisania: 1")).toBeInTheDocument();
    fireEvent.change(selects()[1], { target: { value: "__none__" } });
    fireEvent.change(selects()[2], { target: { value: "__new__" } });
    fireEvent.change(within(rowFor("o-nas")).getByPlaceholderText("o-nas"), {
      target: { value: "  " },
    });
    expect(screen.getByText("Nadpisania: 0")).toBeInTheDocument();
    expect(screen.getByText("Pary PL/EN: 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "o-nas" });
  });

  it("para wskazana w wierszu EN daje DWA wiersze importu - stan faktyczny", async () => {
    // Ten sam defekt, co w `WxrUploadPanel` (identyczna pętla `runImport`) -
    // zarejestrowany jako `it.fails` w `wxrUploadPanel.test.tsx`. Tutaj
    // spisujemy zachowanie zastane, żeby zmiana była widoczna w obu panelach.
    const stub = installSupabase();
    renderDialog();
    await open();
    net.posts = [
      { ID: 34, title: "O nas", slug: "o-nas" },
      { ID: 35, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("about-en")).getByRole("checkbox"));
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[1], {
      target: { value: "34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    const inserts = stub.chainsFor("pages").filter((c) => c.has("insert"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].argsOf("insert")?.[0]).toMatchObject({ slug: "o-nas", title_en: "" });
    expect(inserts[1].argsOf("insert")?.[0]).toMatchObject({ slug: "o-nas", title_en: "About us" });
  });

  it("para bez treści EN po konwersji dostaje OSOBNE ostrzeżenie", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [
      { ID: 36, title: "O nas", slug: "o-nas" },
      { ID: 37, title: "About us", slug: "about-en" },
    ];
    // Treść EN to same shortcode'y motywu - po ich usunięciu nie zostaje nic.
    net.contentById.set(37, "[foxiz_container]tresc[/foxiz_container]");
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("about-en")).getByRole("checkbox"));
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "37" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(h.toastWarning.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("par PL/EN bez treści EN po konwersji");
  });

  it("pominięcie /main po stronie serwera pokazuje się w raporcie", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 38, title: "O nas", slug: "o-nas" }];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    fireEvent.change(within(rowFor("o-nas")).getByPlaceholderText("o-nas"), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastWarning.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("1 pominiętych");
    expect(importDialogOpen()).toBe(true);
  });

  it("wyjątek NIE-Error z warstwy serwerowej trafia do komunikatu", async () => {
    installSupabase();
    renderDialog();
    await open();
    net.posts = [{ ID: 39, title: "O nas", slug: "o-nas" }];
    await load("example.com");
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    h.serverThrowRaw = "<html>502 Bad Gateway</html>";
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastError.at(-1)).toBe("<html>502 Bad Gateway</html>");
  });

  it("podgląd sparowanej strony pobiera OBIE wersje językowe i daje się zamknąć", async () => {
    renderDialog();
    await open();
    net.posts = [
      { ID: 40, title: "O nas", slug: "o-nas" },
      { ID: 41, title: "About us", slug: "about-en" },
    ];
    await load("example.com");
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "41" },
    });
    const buttons = within(rowFor("o-nas")).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.getByText("html")).toBeInTheDocument());
    expect(net.calls.some((u) => u.includes("/posts/41"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(screen.queryByText(/Podgląd konwersji/)).not.toBeInTheDocument());
    // Dialog importu zostaje otwarty.
    expect(importDialogOpen()).toBe(true);
  });

  it("import z zakładki WXR zamyka dialog i unieważnia listę stron", async () => {
    const stub = installSupabase();
    const { queryClient } = renderDialog();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Wgraj plik WXR/ }));
    const fileInput = document.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
    const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Witryna</title><link>https://example.com</link>
<item><title>Z pliku</title><link>https://example.com/z-pliku</link><wp:post_id>50</wp:post_id><wp:post_type>page</wp:post_type><wp:post_name>z-pliku</wp:post_name><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Treść z pliku.</p>]]></content:encoded><excerpt:encoded><![CDATA[Zapowiedź]]></excerpt:encoded><wp:post_date_gmt>2026-01-01 09:00:00</wp:post_date_gmt><wp:post_parent>0</wp:post_parent><wp:menu_order>0</wp:menu_order></item>
</channel></rss>`;
    fireEvent.change(fileInput, {
      target: { files: [new File([xmlText], "export.xml", { type: "text/xml" })] },
    });
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "z-pliku", title_pl: "Z pliku" });
    await waitFor(() => expect(importDialogOpen()).toBe(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-pages"] });
  });
});

describe("WordPressImportDialog - pozostałe komunikaty po angielsku", () => {
  it("brak stron i błąd gatewaya po angielsku", async () => {
    h.language = "en";
    renderDialog();
    await open();
    await load("example.com");
    expect(h.toastInfo).toEqual(["No pages found."]);
    net.listStatus = 500;
    await load("example.com");
    expect(h.toastError.at(-1)).toContain("WordPress zwrócił błąd 500");
  });
});

describe("ROZJAZD HEURYSTYK PL/EN między dwiema drogami importu", () => {
  // ZAREJESTROWANY, NIE NAPRAWIONY. Ta sama witryna, ta sama strona, dwie
  // różne odpowiedzi na pytanie „w jakim to języku":
  //   * `WordPressImportDialog.inferLang` (konektor): /-en$|^en-|\/en\/|\ben\b/
  //     na `slug + " " + tytuł`,
  //   * `WxrUploadPanel.inferLang` (plik WXR): najpierw meta języka z eksportu,
  //     potem /(^|[-/_])en([-/_]|$)/ na tym samym łańcuchu.
  // Skutki są MASOWE i CICHE - nikt nie dostaje ostrzeżenia, a różnica decyduje,
  // czy strona wejdzie jako osobny wpis, czy jako wersja EN innego wpisu:
  //   * slug „about-en" + tytuł „About us": konektor -> EN, WXR -> PL
  //     (najpopularniejsza konwencja sufiksu językowego w WordPressie),
  //   * slug „kontakt_en_strona": konektor -> PL, WXR -> EN.
  // Naprawa to wyniesienie JEDNEJ funkcji `inferLang` do wspólnego modułu
  // (`src/lib/wp-import/`) i użycie jej w obu panelach - zmiana produkcyjna w
  // dwóch plikach, poza zakresem pisania testów.
  it.fails("oba panele wykrywają ten sam język dla sufiksu -en", async () => {
    renderDialog();
    await open();
    net.posts = [{ ID: 20, title: "About us", slug: "about-en" }];
    await load("example.com");
    const connectorLang = langOf("about-en");
    expect(connectorLang).toBe("en");

    // Ten sam wiersz w zakładce WXR - z pliku o identycznym slugu i tytule.
    fireEvent.click(screen.getByRole("button", { name: /Wgraj plik WXR/ }));
    const fileInput = document.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Witryna</title><link>https://example.com</link>
<item><title>About us</title><link>https://example.com/about-en</link><wp:post_id>20</wp:post_id><wp:post_type>page</wp:post_type><wp:post_name>about-en</wp:post_name><wp:status>publish</wp:status><content:encoded><![CDATA[<p>English body.</p>]]></content:encoded><excerpt:encoded><![CDATA[EN]]></excerpt:encoded><wp:post_date_gmt>2026-01-01 09:00:00</wp:post_date_gmt><wp:post_parent>0</wp:post_parent><wp:menu_order>0</wp:menu_order></item>
</channel></rss>`;
    fireEvent.change(fileInput, {
      target: { files: [new File([xml], "export.xml", { type: "text/xml" })] },
    });
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(0));
    await act(async () => {
      await Promise.resolve();
    });
    // Wiersz w panelu WXR ma inny podpis (`/slug · status`), więc szukamy go
    // wzorcem - dopasowanie musi się udać, inaczej test padłby na SETUPIE,
    // zamiast na porównaniu heurystyk.
    const wxrRow = screen.getAllByText(/^\/about-en( ·|$)/)[0].closest("tr");
    if (!wxrRow) throw new Error("test: brak wiersza WXR dla /about-en");
    const wxrLang = within(wxrRow).getAllByTestId("select")[0].getAttribute("data-value");
    expect(wxrLang).toBe(connectorLang);
  });
});
