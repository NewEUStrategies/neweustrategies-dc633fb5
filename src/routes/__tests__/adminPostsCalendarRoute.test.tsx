// Kalendarz redakcyjny `/admin/posts/calendar` (0% przed zmianą) - miesięczna
// siatka opublikowanych i zaplanowanych wpisów z przeciąganiem terminów.
//
// CZEGO TU NIE MA. Gestu myszy nie testujemy: `@dnd-kit/core` jest atrapowany,
// bo rozpoznawanie przeciągnięcia to biblioteka, nie nasza reguła. Atrapa
// oddaje jednak DWIE rzeczy, których nie widać z DOM-u: identyfikatory
// wszystkich komórek dnia (`useDroppable`) i to, KTÓRE wpisy są chwytliwe
// (`useDraggable({ disabled })`) - a to właśnie reguły tej trasy.
//
// SZEŚĆ RZECZY, KTÓRE MAJĄ TU DOWÓD:
//   1. WPIS OPUBLIKOWANY JEST NIERUCHOMY. Przeciągnięcie re-datowałoby
//      archiwum, sitemapy i feedy. Bramka jest w `draggable`, nie w serwerze,
//      więc tylko test UI ją widzi.
//   2. TERMIN NIE GUBI GODZINY. Przeniesienie zaplanowanego wpisu na inny
//      dzień zachowuje jego godzinę; szkic z backlogu dostaje 09:00. Bez tego
//      redakcja traciłaby ustaloną godzinę publikacji przy każdym poprawieniu
//      dnia w kalendarzu.
//   3. UPUSZCZENIE NA TEN SAM DZIEŃ NIE ZAPISUJE NICZEGO. Inaczej każde
//      drgnięcie ręki generowałoby zapis (i wpis w audycie).
//   4. ZAKRES ZAPYTANIA JEST TENANTOWY I MIESIĘCZNY. Zapytanie bez
//      `tenant_id` pokazałoby plan wydawniczy innej firmy.
//   5. BACKLOG TYLKO DLA RÓL Z PRAWEM PUBLIKACJI. UI ukrywa, serwer i tak
//      egzekwuje - ale ukrycie musi działać, żeby redaktor nie dostawał
//      panelu, którego akcje mu odmówią.
//   6. NAWIGACJA MIESIĄCAMI PRZESTAWIA ZAKRES, a nie tylko podpis - inaczej
//      „poprzedni miesiąc" pokazywałby dane bieżącego.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

interface DragLike {
  active: { id: unknown };
  over: { id: unknown } | null;
}

const h = vi.hoisted(() => ({
  auth: { tenantId: "tenant-1" as string | null, isAdmin: true },
  month: [] as unknown[],
  backlog: [] as unknown[],
  update: null as unknown,
  toast: null as unknown,
  db: null as unknown,
  navigate: null as unknown,
  onDragEnd: null as ((event: DragLike) => void) | null,
  draggables: [] as Array<{ id: unknown; disabled: boolean }>,
  droppables: [] as unknown[],
  dragging: false,
  over: false,
  language: "pl" as string | undefined,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language as string),
);

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: db.from } };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/content.functions", () => ({ updatePost: vi.fn() }));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.update };
});

// `Link` i `useNavigate` bez pełnego drzewa tras - harness montuje tylko tę
// jedną trasę, więc `<Link to="/admin/posts/$slug">` nie miałaby celu.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  const { vi: v } = await import("vitest");
  h.navigate = v.fn();
  return { ...actual, Link: RouterLinkStub, useNavigate: () => h.navigate };
});

// Atrapa dnd-kit: kontekst oddaje `onDragEnd` testowi, a `useDraggable` /
// `useDroppable` REJESTRUJĄ swoje identyfikatory i bramkę `disabled`.
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children?: React.ReactNode;
    onDragEnd?: (event: DragLike) => void;
  }) => {
    h.onDragEnd = onDragEnd ?? null;
    return <div data-testid="dnd">{children}</div>;
  },
  PointerSensor: { name: "pointer" },
  useSensor: (sensor: unknown) => sensor,
  useSensors: (...sensors: unknown[]) => sensors,
  useDraggable: ({ id, disabled }: { id: unknown; disabled?: boolean }) => {
    h.draggables.push({ id, disabled: !!disabled });
    return {
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: h.dragging ? { x: 4, y: 8 } : null,
      isDragging: h.dragging,
    };
  },
  useDroppable: ({ id }: { id: unknown }) => {
    h.droppables.push(id);
    return { setNodeRef: () => {}, isOver: h.over };
  },
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as CalendarRoute } from "@/routes/admin.posts.calendar";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";

type Mock = ReturnType<typeof vi.fn>;
const PATH = "/admin/posts/calendar";
const db = () => h.db as SupabaseFromStub;
const toast = () => h.toast as Record<string, Mock>;
const update = () => h.update as Mock;

/** 19 sierpnia 2026, środa - „dziś" dla całego pliku. */
const TODAY = new Date(2026, 7, 19, 12, 0, 0);

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    slug: "moj-wpis",
    title_pl: "Mój wpis",
    title_en: "My post",
    status: "scheduled",
    published_at: null,
    publish_at: new Date(2026, 7, 20, 14, 30, 0).toISOString(),
    updated_at: new Date(2026, 7, 18, 8, 0, 0).toISOString(),
    ...overrides,
  };
}

function render() {
  return renderRoute({
    route: CalendarRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

/** Czeka na siatkę: 42 komórki dnia to znak, że render przeszedł do końca. */
async function renderGrid() {
  const view = await render();
  await waitFor(() => expect(h.droppables.length).toBeGreaterThanOrEqual(42));
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  h.auth = { tenantId: "tenant-1", isAdmin: true };
  h.month = [];
  h.backlog = [];
  h.dragging = false;
  h.over = false;
  h.language = "pl";
  h.draggables = [];
  h.droppables = [];
  h.onDragEnd = null;
  h.update = vi.fn(async () => ({}));
  db().reset();
  // Jedna tabela, dwa zapytania: miesięczne rozpoznajemy po `or(...)`,
  // backlog po filtrze statusów.
  db().setResponse("posts", (chain) => ok(chain.has("or") ? h.month : h.backlog));
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---------------------------------------------------------------------------
// Siatka miesiąca
// ---------------------------------------------------------------------------

describe("siatka kalendarza", () => {
  it("ma 42 komórki, zaczyna się w PONIEDZIAŁEK i obejmuje cały miesiąc", async () => {
    // Sześć tygodni od poniedziałku to jedyny układ, w którym każdy miesiąc
    // mieści się bez przeskoków - także taki, który zaczyna się w niedzielę.
    await renderGrid();

    const keys = h.droppables.slice(0, 42) as string[];
    expect(keys).toHaveLength(42);
    expect(new Date(`${keys[0]}T00:00:00`).getDay()).toBe(1);
    // Cały sierpień 2026 jest w siatce, razem z 1. i 31.
    expect(keys).toContain("2026-08-01");
    expect(keys).toContain("2026-08-31");
    // Dni sąsiednich miesięcy dopełniają tydzień.
    expect(keys[0]).toBe("2026-07-27");
  });

  it("nagłówki dni tygodnia są po polsku, a w EN po angielsku", async () => {
    await renderGrid();
    expect(screen.getByText("Pn")).toBeInTheDocument();
    expect(screen.getByText("Nd")).toBeInTheDocument();

    cleanup();
    h.droppables = [];
    h.language = "en";
    await renderGrid();
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });

  it("panel EN pokazuje ANGIELSKI tytuł i 24-godzinny czas w locale EN", async () => {
    // Kalendarz jest jednym z dwóch miejsc, gdzie redaktor EN widzi plan;
    // polski tytuł w wersji angielskiej to błąd, a nie kosmetyka.
    h.language = "en";
    h.month = [
      post({ publish_at: new Date(2026, 7, 20, 16, 45).toISOString() }),
      // Wpis bez tłumaczenia tytułu: w wersji EN ma pokazać POLSKI tytuł,
      // a nie puste miejsce - redaktor musi wiedzieć, co jest zaplanowane.
      post({ id: "bez-en", slug: "bez-en", title_en: "" }),
    ];
    await renderGrid();

    await waitFor(() => expect(screen.getByTitle("My post")).toBeInTheDocument());
    expect(screen.getByText("16:45")).toBeInTheDocument();
    expect(screen.getByTitle("Mój wpis")).toBeInTheDocument();
  });

  it("BRAK języka w i18n (przed detekcją) nie wywraca siatki - zostaje polska", async () => {
    h.language = undefined;
    h.month = [post()];
    await renderGrid();

    await waitFor(() => expect(screen.getByTitle("Mój wpis")).toBeInTheDocument());
    expect(screen.getByText("Pn")).toBeInTheDocument();
  });

  it("komórka pod kursorem jest PODŚWIETLONA - inaczej nie widać, gdzie się upuszcza", async () => {
    h.over = true;
    const view = await renderGrid();
    expect(view.container.querySelector(".ring-brand")).not.toBeNull();
  });

  it("wpisy trafiają do komórki swojej daty i są w niej UPORZĄDKOWANE godzinami", async () => {
    // Dwa wpisy tego samego dnia bez sortowania ustawiałyby się w kolejności
    // z bazy - redakcja czyta kalendarz jako plan godzinowy.
    h.month = [
      post({
        id: "wieczor",
        slug: "wieczor",
        publish_at: new Date(2026, 7, 20, 18, 0).toISOString(),
      }),
      post({ id: "rano", slug: "rano", publish_at: new Date(2026, 7, 20, 7, 0).toISOString() }),
    ];
    await renderGrid();

    await waitFor(() => expect(h.draggables.length).toBeGreaterThan(0));
    const order = h.draggables
      .filter((d) => d.id === "rano" || d.id === "wieczor")
      .map((d) => d.id);
    expect(order[0]).toBe("rano");
    expect(order[1]).toBe("wieczor");
  });

  it("wpis BEZ daty terminu nie ląduje w żadnej komórce", async () => {
    // `entryDate` oddaje null dla szkicu - wstawienie go do siatki
    // wymagałoby wymyślenia dnia, którego redakcja nie ustaliła.
    h.month = [
      post({ id: "szkic", status: "draft", publish_at: null, published_at: null }),
      post({ id: "zaplanowany" }),
    ];
    await renderGrid();

    // Czekamy na SĄSIADA z datą - inaczej asercja przechodziłaby po prostu
    // dlatego, że zapytanie jeszcze się nie rozwiązało.
    await waitFor(() => expect(h.draggables.some((d) => d.id === "zaplanowany")).toBe(true));
    expect(h.draggables.some((d) => d.id === "szkic")).toBe(false);
  });

  it("wpis OPUBLIKOWANY jest w kalendarzu po `published_at` i jest NIERUCHOMY", async () => {
    // Przeciągnięcie opublikowanego re-datowałoby archiwum, sitemapy i feedy.
    h.month = [
      post({
        id: "opublikowany",
        status: "published",
        publish_at: null,
        published_at: new Date(2026, 7, 10, 9, 0).toISOString(),
      }),
    ];
    await renderGrid();

    await waitFor(() => expect(h.draggables.length).toBeGreaterThan(0));
    expect(h.draggables.find((d) => d.id === "opublikowany")?.disabled).toBe(true);
  });

  it("zaplanowany wpis jest chwytliwy TYLKO dla roli z prawem publikacji", async () => {
    h.month = [post({ id: "zaplanowany" })];
    await renderGrid();
    await waitFor(() => expect(h.draggables.length).toBeGreaterThan(0));
    expect(h.draggables.find((d) => d.id === "zaplanowany")?.disabled).toBe(false);

    cleanup();
    h.draggables = [];
    h.droppables = [];
    h.auth = { tenantId: "tenant-1", isAdmin: false };
    await renderGrid();
    await waitFor(() => expect(h.draggables.length).toBeGreaterThan(0));
    expect(h.draggables.find((d) => d.id === "zaplanowany")?.disabled).toBe(true);
  });

  it("przeciągany wpis dostaje przesunięcie i przygaszenie", async () => {
    // Bez wizualnej informacji zwrotnej redaktor nie wie, że trzyma wpis.
    h.dragging = true;
    h.month = [post({ id: "zaplanowany" })];
    await renderGrid();

    await waitFor(() => expect(screen.getByTitle("Mój wpis")).toBeInTheDocument());
    const entry = screen.getByTitle("Mój wpis").parentElement as HTMLElement;
    expect(entry.getAttribute("style")).toContain("translate(4px, 8px)");
    expect(entry.className).toContain("opacity-60");
  });

  it("tytuł wpisu bierze język panelu, a przy pustym tytule ratuje się slugiem", async () => {
    // Puste oba tytuły to stan realny dla świeżo utworzonego szkicu - komórka
    // bez żadnej etykiety byłaby nieklikalna.
    h.month = [post({ id: "bez-tytulu", slug: "bez-tytulu", title_pl: "", title_en: "" })];
    await renderGrid();

    await waitFor(() => expect(screen.getByTitle("bez-tytulu")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Zapytania
// ---------------------------------------------------------------------------

describe("zakres zapytań", () => {
  it("miesięczne zapytanie jest TENANTOWE, pomija kosz i ma limit partii", async () => {
    await renderGrid();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThan(0));
    const month = db()
      .chainsFor("posts")
      .find((c) => c.has("or"));
    expect(month?.argsOf("eq")).toEqual(["tenant_id", "tenant-1"]);
    expect(month?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(month?.argsOf("limit")).toEqual([500]);
    // Okno obejmuje CAŁĄ siatkę, nie tylko dni miesiąca.
    const or = String(month?.argsOf("or")?.[0] ?? "");
    expect(or).toContain("status.eq.published");
    expect(or).toContain("status.eq.scheduled");
    expect(or).toContain("2026-07-27");
  });

  it("backlog bierze tylko szkice i recenzje, najświeższe pierwsze", async () => {
    await renderGrid();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThan(1));
    const backlog = db()
      .chainsFor("posts")
      .find((c) => c.has("in"));
    expect(backlog?.argsOf("in")).toEqual(["status", ["draft", "pending_review"]]);
    expect(backlog?.argsOf("order")).toEqual(["updated_at", { ascending: false }]);
    expect(backlog?.argsOf("limit")).toEqual([30]);
  });

  it("BEZ tenanta nie leci ani jedno zapytanie", async () => {
    // Zapytanie bez `tenant_id` pokazałoby plan wydawniczy innej firmy;
    // `enabled` jest tu bramką, a nie optymalizacją.
    h.auth = { tenantId: null, isAdmin: true };
    await renderGrid();

    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("rola BEZ prawa publikacji nie pyta o backlog i nie widzi panelu", async () => {
    h.auth = { tenantId: "tenant-1", isAdmin: false };
    await renderGrid();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThan(0));
    expect(
      db()
        .chainsFor("posts")
        .some((c) => c.has("in")),
    ).toBe(false);
    expect(screen.queryByText("admin.calendar.backlog")).toBeNull();
    expect(screen.queryByText("admin.calendar.dragHint")).toBeNull();
  });

  it("PUSTA odpowiedź bazy (null) daje pustą siatkę, nie wyjątek", async () => {
    // PostgREST oddaje `data: null` przy zerowym wyniku - `data ?? []` jest tu
    // różnicą między pustym kalendarzem a białym ekranem.
    db().setResponse("posts", () => ok(null));
    await renderGrid();

    expect(h.droppables.length).toBeGreaterThanOrEqual(42);
    expect(screen.getByText("admin.calendar.backlogEmpty")).toBeInTheDocument();
  });

  it("BŁĄD zapytania nie zabiera redaktorowi całego ekranu", async () => {
    // Kalendarz bez danych jest bezużyteczny, ale nawigacja i podpis miesiąca
    // muszą zostać - inaczej redaktor nie ma nawet jak przejść na listę.
    db().setResponse("posts", () => fail("statement timeout"));
    await renderGrid();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThan(1));
    expect(screen.getByText("admin.calendar.title")).toBeInTheDocument();
    expect(h.draggables).toHaveLength(0);
  });

  it("pusty backlog mówi to wprost, a nie pustą kolumną", async () => {
    await renderGrid();
    await waitFor(() =>
      expect(screen.getByText("admin.calendar.backlogEmpty")).toBeInTheDocument(),
    );
  });

  it("wpisy backlogu są chwytliwe (to jedyny sposób zaplanowania z kalendarza)", async () => {
    h.backlog = [post({ id: "szkic", status: "draft", publish_at: null })];
    await renderGrid();

    await waitFor(() => expect(h.draggables.some((d) => d.id === "szkic")).toBe(true));
    expect(h.draggables.find((d) => d.id === "szkic")?.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Przeniesienie terminu
// ---------------------------------------------------------------------------

describe("przeniesienie terminu", () => {
  /**
   * Czeka, aż wpis NAPRAWDĘ jest w danych, i tylko wtedy „upuszcza" go na dzień.
   * Bez tego czekania test „nie zapisuje" przechodziłby także wtedy, gdy
   * zapytanie jeszcze się nie rozwiązało - czyli z zupełnie innego powodu.
   */
  async function drop(over: string | null, active = "post-1", present = true) {
    const view = await renderGrid();
    if (present) {
      await waitFor(() => expect(h.draggables.some((d) => d.id === active)).toBe(true));
    }
    await waitFor(() => expect(h.onDragEnd).toBeTypeOf("function"));
    await h.onDragEnd?.({ active: { id: active }, over: over === null ? null : { id: over } });
    return view;
  }

  it("zachowuje GODZINĘ zaplanowanego wpisu przy zmianie dnia", async () => {
    // 14:30 z 20 sierpnia ma zostać 14:30 z 25 sierpnia. Zgubiona godzina to
    // publikacja o północy zamiast o porze największego ruchu.
    h.month = [post()];
    await drop("2026-08-25");

    await waitFor(() => expect(update()).toHaveBeenCalledTimes(1));
    const arg = update().mock.calls[0][0] as {
      data: { id: string; fields: { status: string; publish_at: string } };
    };
    expect(arg.data.id).toBe("post-1");
    expect(arg.data.fields.status).toBe("scheduled");
    const sent = new Date(arg.data.fields.publish_at);
    expect(sent.getDate()).toBe(25);
    expect(sent.getHours()).toBe(14);
    expect(sent.getMinutes()).toBe(30);
  });

  it("szkic z backlogu dostaje 09:00 - domyślną porę publikacji", async () => {
    h.backlog = [post({ id: "szkic", status: "draft", publish_at: null })];
    await drop("2026-09-02", "szkic");

    await waitFor(() => expect(update()).toHaveBeenCalledTimes(1));
    const arg = update().mock.calls[0][0] as { data: { fields: { publish_at: string } } };
    const sent = new Date(arg.data.fields.publish_at);
    expect(sent.getMonth()).toBe(8);
    expect(sent.getDate()).toBe(2);
    expect(sent.getHours()).toBe(9);
    expect(sent.getMinutes()).toBe(0);
  });

  it("upuszczenie na TEN SAM dzień nie zapisuje niczego", async () => {
    // Inaczej każde drgnięcie ręki generowałoby zapis i wpis w audycie.
    h.month = [post()];
    await drop("2026-08-20");

    expect(update()).not.toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("upuszczenie POZA kalendarzem nie zapisuje niczego", async () => {
    h.month = [post()];
    await drop(null);
    expect(update()).not.toHaveBeenCalled();
  });

  it("nieznany wpis (nieaktualne dane) nie wysyła zapisu", async () => {
    h.month = [post()];
    await drop("2026-08-25", "wpis-ktorego-nie-ma", false);
    expect(update()).not.toHaveBeenCalled();
  });

  it("przeciągnięcie BEZ wczytanych danych nie wysyła zapisu", async () => {
    // Oba zapytania są wyłączone bez tenanta, więc `monthPosts`/`backlog` są
    // `undefined` - bez `?? []` samo złożenie listy rzuciłoby wyjątkiem.
    h.auth = { tenantId: null, isAdmin: true };
    await drop("2026-08-25", "post-1", false);

    expect(update()).not.toHaveBeenCalled();
    expect(toast().error).not.toHaveBeenCalled();
  });

  it("udane przeniesienie odświeża OBA zapytania kalendarza i listę wpisów", async () => {
    // Bez unieważnienia backlogu przeniesiony szkic zostawałby w kolumnie
    // obok siatki - w dwóch miejscach naraz.
    h.month = [post()];
    const view = await renderGrid();
    await waitFor(() => expect(h.draggables.some((d) => d.id === "post-1")).toBe(true));
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    await h.onDragEnd?.({ active: { id: "post-1" }, over: { id: "2026-08-25" } });

    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("admin.calendar.rescheduled"));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin", "posts-calendar"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin", "posts-calendar-backlog"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts"] }));
  });

  it("odmowa serwera pokazuje JEGO komunikat, nie ogólny błąd", async () => {
    // Bramka workflow serwera odmawia np. przy braku pola wymaganego do
    // publikacji - redaktor musi wiedzieć czego brakuje.
    h.month = [post()];
    h.update = vi.fn(async () => {
      throw new Error("brak lead PL");
    });
    await drop("2026-08-25");

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak lead PL"));
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("rzut NIE będący instancją Error też ma czytelny komunikat", async () => {
    h.month = [post()];
    h.update = vi.fn(async () => {
      throw "network down";
    });
    await drop("2026-08-25");

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("network down"));
  });

  it("drugie przeciągnięcie w trakcie zapisu jest ignorowane", async () => {
    // Bramka `saving`: dwa równoległe zapisy tego samego wpisu mogą wylądować
    // w bazie w odwrotnej kolejności.
    h.month = [post()];
    let release: () => void = () => {};
    h.update = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    await renderGrid();
    await waitFor(() => expect(h.draggables.some((d) => d.id === "post-1")).toBe(true));

    const first = h.onDragEnd?.({ active: { id: "post-1" }, over: { id: "2026-08-25" } });
    await waitFor(() => expect(update()).toHaveBeenCalledTimes(1));
    await h.onDragEnd?.({ active: { id: "post-1" }, over: { id: "2026-08-26" } });
    expect(update()).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});

// ---------------------------------------------------------------------------
// Nawigacja
// ---------------------------------------------------------------------------

describe("nawigacja kalendarza", () => {
  it("poprzedni i następny miesiąc PRZESTAWIAJĄ ZAKRES, nie tylko podpis", async () => {
    await renderGrid();
    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThan(0));
    h.droppables = [];

    fireEvent.click(screen.getByLabelText("admin.calendar.prevMonth"));
    await waitFor(() => expect(h.droppables).toContain("2026-07-01"));

    h.droppables = [];
    fireEvent.click(screen.getByLabelText("admin.calendar.nextMonth"));
    await waitFor(() => expect(h.droppables).toContain("2026-08-01"));

    h.droppables = [];
    fireEvent.click(screen.getByLabelText("admin.calendar.nextMonth"));
    await waitFor(() => expect(h.droppables).toContain("2026-09-01"));
  });

  it("„dziś” wraca do bieżącego miesiąca", async () => {
    await renderGrid();
    fireEvent.click(screen.getByLabelText("admin.calendar.nextMonth"));
    await waitFor(() => expect(h.droppables).toContain("2026-09-01"));

    h.droppables = [];
    fireEvent.click(screen.getByText("admin.calendar.today"));
    await waitFor(() => expect(h.droppables).toContain("2026-08-01"));
  });

  it("powrót do listy idzie nawigacją routera, nie przeładowaniem strony", async () => {
    await renderGrid();
    fireEvent.click(screen.getByText("admin.calendar.backToList"));
    expect(h.navigate as Mock).toHaveBeenCalledWith({ to: "/admin/posts" });
  });

  it("podpis miesiąca zawiera rok - to jedyny kotwica w czasie na ekranie", async () => {
    await renderGrid();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
