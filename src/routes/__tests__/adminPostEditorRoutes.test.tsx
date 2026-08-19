// Trzy trasy edytora wpisu, wszystkie na 0% przed zmianą:
//   * `/admin/posts/new`   — utworzenie szkicu i przekierowanie na jego adres,
//   * `/admin/posts/$slug` — korzeń kompozycji edytora,
//   * `/admin/versions`    — cienka otoczka sekcji „Wersje".
//
// Trzy rzeczy są tu warte testu:
//
//   1. POJEDYNCZY POST przy tworzeniu szkicu. `/admin/posts/new` tworzy wiersz
//      EFEKTEM UBOCZNYM wejścia na adres, a React StrictMode uruchamia efekt
//      dwukrotnie. Bez synchronicznej blokady jedno wejście tworzyłoby DWA
//      puste wpisy — i redaktor zostawałby z osieroconym szkicem w bazie.
//   2. JĘZYK EDYTORA Z ADRESU. Lista admina przekazuje `?lang=pl|en`, żeby
//      edytor otwierał się w tej wersji, którą redaktor filtrował. Wartość
//      przychodzi z zewnątrz, więc obca musi wypaść.
//   3. BRAK CIĘŻKIEJ PRACY PRZED WCZYTANIEM WPISU. Trasa edytora renderuje
//      wskaźnik, dopóki formularz jest `null` — panele nie mogą się montować
//      i odpytywać własnych źródeł na pustym stanie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  auth: { user: { id: "user-1" }, loading: false, tenantId: "tenant-1" } as {
    user: { id: string } | null;
    loading: boolean;
    tenantId: string | null;
  },
  create: null as unknown,
  navigate: null as unknown,
  toast: null as unknown,
  data: null as unknown,
  form: null as unknown,
  captured: {} as Record<string, unknown>,
  language: "pl" as string,
  step: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({ ensureI18n: () => {} }));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.create };
});
vi.mock("@/lib/content.functions", () => ({ createPost: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => h.auth,
  useRequiredTenant: () => h.auth.tenantId ?? "tenant-1",
}));

// `useNavigate` podmieniamy, ale reszta routera musi zostac - harness montuje
// prawdziwa trase.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { vi: v } = await import("vitest");
  h.navigate = v.fn();
  return { ...actual, useNavigate: () => h.navigate };
});

function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    return <div data-testid={name} />;
  };
}

// Warstwa edytora jest atrapowana - jej wnetrze ma wlasne, obszerne testy.
vi.mock("@/components/admin/post-editor", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePostEditorData: () => h.data,
    usePostEditorForm: () => h.form,
    useInlineTaxonomy: (args: Record<string, unknown>) => {
      h.captured.taxonomyArgs = args;
      return {};
    },
    usePostEditorStep: () => h.step,
    useBilingualReadingStats: () => ({ pl: { minutes: 5 }, en: { minutes: 4 } }),
    PostEditorHeader: probe("header"),
    PostDetailsPanel: probe("details"),
    PostContentEditor: probe("content"),
    PostLayoutCard: probe("layoutCard"),
  };
});
vi.mock("@/components/admin/molecules/EditPresenceBanner", () => ({
  EditPresenceBanner: probe("presence"),
}));
vi.mock("@/hooks/usePostLayoutSettings", () => ({
  usePostLayoutSettings: () => ({ data: undefined }),
}));
vi.mock("@/components/admin/versions/VersionsPane", () => ({
  VersionsPane: probe("versionsPane"),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as NewPostRoute } from "@/routes/admin.posts.new";
import { Route as EditPostRoute } from "@/routes/admin.posts.$slug";
import { Route as VersionsRoute } from "@/routes/admin.versions";
import { postEditorData, postEditorFormApi, postForm } from "@/test/post-editor/fixtures";

type Mock = ReturnType<typeof vi.fn>;
const props = (name: string) => h.captured[name] as Record<string, unknown>;
const toast = () => h.toast as Record<string, Mock>;
const navigate = () => h.navigate as Mock;
const create = () => h.create as Mock;

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(() => {
  h.auth = { user: { id: "user-1" }, loading: false, tenantId: "tenant-1" };
  h.create = vi.fn(async () => ({ slug: "nowy-wpis" }));
  h.captured = {};
  h.language = "pl";
  h.data = postEditorData();
  h.form = postEditorFormApi();
  h.step = { step: "details", setStep: vi.fn() };
  navigate().mockReset();
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// /admin/posts/new
// ---------------------------------------------------------------------------

describe("/admin/posts/new - utworzenie szkicu efektem wejścia", () => {
  const render = () =>
    renderRoute({
      route: NewPostRoute,
      path: "/admin/posts/new",
      initialEntry: "/admin/posts/new",
      queryClient: client(),
    });

  it("tworzy szkic i przekierowuje na JEGO adres, zamieniając wpis w historii", async () => {
    // `replace: true` - cofnięcie w przeglądarce nie może wrócić na `/new`
    // i utworzyć drugiego szkicu.
    await render();

    await waitFor(() => expect(create()).toHaveBeenCalledWith({ data: {} }));
    await waitFor(() =>
      expect(navigate()).toHaveBeenCalledWith({
        to: "/admin/posts/$slug",
        params: { slug: "nowy-wpis" },
        replace: true,
      }),
    );
  });

  it("tworzy DOKŁADNIE JEDEN szkic, mimo dwóch przebiegów efektu", async () => {
    // React StrictMode uruchamia setup efektu dwukrotnie w dev. Stan `busy`
    // aktualizuje się dopiero w kolejnym renderze, więc sam nie chroni przed
    // dwoma POST-ami - blokadą jest synchroniczny ref. Bez niej jedno wejście
    // zostawiałoby w bazie osierocony pusty wpis.
    await render();
    await waitFor(() => expect(create()).toHaveBeenCalled());
    expect(create()).toHaveBeenCalledTimes(1);
  });

  it("NIE tworzy niczego, dopóki sesja się wczytuje", async () => {
    // Utworzenie wpisu bez znanego tenanta przypisałoby go do złego obszaru.
    h.auth = { user: null, loading: true, tenantId: null };
    await render();
    await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
    expect(create()).not.toHaveBeenCalled();
  });

  it("NIE tworzy niczego bez zalogowanego użytkownika", async () => {
    h.auth = { user: null, loading: false, tenantId: "tenant-1" };
    await render();
    await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
    expect(create()).not.toHaveBeenCalled();
  });

  it("NIE tworzy niczego bez tenanta", async () => {
    h.auth = { user: { id: "user-1" }, loading: false, tenantId: null };
    await render();
    await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
    expect(create()).not.toHaveBeenCalled();
  });

  it("nieudane utworzenie pokazuje BŁĄD i wraca na LISTĘ, nie zostawia pustki", async () => {
    // Zostawienie redaktora na `/new` po błędzie dawałoby ekran z wielokropkiem
    // bez wyjścia.
    (h.create as Mock).mockRejectedValue(new Error("brak uprawnień"));
    await render();

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak uprawnień"));
    await waitFor(() => expect(navigate()).toHaveBeenCalledWith({ to: "/admin/posts" }));
  });

  it("błąd nie będący instancją Error też ma czytelny komunikat", async () => {
    (h.create as Mock).mockRejectedValue("goły tekst z serwera");
    await render();
    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("goły tekst z serwera"));
  });
});

// ---------------------------------------------------------------------------
// /admin/posts/$slug
// ---------------------------------------------------------------------------

describe("/admin/posts/$slug - korzeń kompozycji edytora", () => {
  const render = (entry = "/admin/posts/moj-wpis") =>
    renderRoute({
      route: EditPostRoute,
      path: "/admin/posts/$slug",
      initialEntry: entry,
      queryClient: client(),
    });

  it("montuje nagłówek, banner obecności i panel szczegółów", async () => {
    await render();
    await waitFor(() => expect(screen.getByTestId("header")).toBeInTheDocument());
    expect(screen.getByTestId("presence")).toBeInTheDocument();
    expect(screen.getByTestId("details")).toBeInTheDocument();
  });

  it("NIE montuje paneli, dopóki wpis się wczytuje", async () => {
    // Panele odpytują własne źródła przy montażu; zamontowanie ich na pustym
    // formularzu wysłałoby komplet zapytań o wpis, którego jeszcze nie ma.
    h.data = postEditorData({ isLoading: true, post: undefined });
    h.form = postEditorFormApi({ form: null });
    await render();
    await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
    expect(screen.queryByTestId("details")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
  });

  it("BRAK formularza (mimo zakończonego ładowania) też wstrzymuje panele", async () => {
    h.data = postEditorData({ isLoading: false, post: undefined });
    h.form = postEditorFormApi({ form: null });
    await render();
    await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
    expect(screen.queryByTestId("details")).toBeNull();
  });

  it("banner obecności dostaje id EDYTOWANEGO wpisu", async () => {
    // Zły id pokazałby nazwiska osób pracujących nad innym dokumentem.
    await render();
    await waitFor(() => expect(screen.getByTestId("presence")).toBeInTheDocument());
    expect(props("presence").entityType).toBe("post");
    expect(props("presence").entityId).toBe(postEditorData().id);
  });

  it("język edytora bierze się z ADRESU, gdy jest podany", async () => {
    // Lista admina przekazuje `?lang=`, żeby edytor otwierał się w tej wersji,
    // którą redaktor filtrował.
    await render("/admin/posts/moj-wpis?lang=en");
    await waitFor(() => expect(screen.getByTestId("details")).toBeInTheDocument());
    expect(props("details").uiLang).toBe("en");
  });

  it("OBCA wartość `lang` wypada i wraca język panelu", async () => {
    // Test regresji. `validateSearch` trasy zwraca `{}` dla nieznanej wartości,
    // ale to NIE usuwa jej z tego, co widzi komponent: router składa
    // `match.search` jako `{ ...parentSearch, ...zwalidowane }`
    // (router-core/router.js ~870), a `Route.useSearch()` czyta właśnie
    // `match.search`, nie `_strictSearch`. Obca wartość dociera więc do
    // komponentu i to on musi ją odrzucić - dlatego asercja pilnuje OBU rzeczy:
    // że w search params dalej siedzi śmieć, i że edytor go nie uznał.
    h.language = "en";
    const view = await render("/admin/posts/moj-wpis?lang=klingon");
    await waitFor(() => expect(screen.getByTestId("details")).toBeInTheDocument());
    expect(view.search()).toEqual({ lang: "klingon" });
    expect(props("details").uiLang).toBe("en");
  });

  it("bez `lang` w adresie edytor idzie za językiem panelu", async () => {
    h.language = "en-GB";
    await render();
    await waitFor(() => expect(screen.getByTestId("details")).toBeInTheDocument());
    expect(props("details").uiLang).toBe("en");
  });

  it("brak języka w i18n (przed detekcją) daje polski, nie `undefined`", async () => {
    // `i18n.language` jest puste do zakończenia detekcji języka. Bez domyślnej
    // wartości `uiLang` byłby `undefined` i panele czytałyby pola po pustym
    // sufiksie - czyli pusty edytor przy pierwszym renderze.
    h.language = undefined as unknown as string;
    await render();
    await waitFor(() => expect(screen.getByTestId("details")).toBeInTheDocument());
    expect(props("details").uiLang).toBe("pl");
  });

  it("slug z adresu dociera do panelu (podgląd i nawigacja po zapisie)", async () => {
    await render("/admin/posts/inny-wpis");
    await waitFor(() => expect(props("details").routeSlug).toBe("inny-wpis"));
  });

  it("nowa kategoria z inline'u DOKŁADA się do wyboru, nie podmienia go", async () => {
    // Podmiana zamiast dołożenia skasowałaby kategorie już przypisane do wpisu.
    await render();
    await waitFor(() => expect(h.captured.taxonomyArgs).toBeDefined());
    const args = h.captured.taxonomyArgs as {
      onCategoryCreated: (id: string) => void;
      onTagCreated: (id: string) => void;
      tenantId: string;
    };
    expect(args.tenantId).toBe(postEditorData().tenantId);

    args.onCategoryCreated("cat-new");
    args.onTagCreated("tag-new");

    const api = h.form as Record<string, Mock>;
    const catUpdater = api.setSelectedCats.mock.calls[0][0] as (prev: string[]) => string[];
    const tagUpdater = api.setSelectedTags.mock.calls[0][0] as (prev: string[]) => string[];
    expect(catUpdater(["cat-stara"])).toEqual(["cat-stara", "cat-new"]);
    expect(tagUpdater(["tag-stary"])).toEqual(["tag-stary", "tag-new"]);
  });

  it("karta layoutu jest zbudowana raz i przekazana panelowi", async () => {
    // Ta sama karta jedzie do panelu szczegółów i do panelu dokumentu, żeby oba
    // widoki dzieliły `ov` i `currentFormat` - dwie kopie rozjechałyby się.
    await render();
    await waitFor(() => expect(props("details").layoutCard).toBeDefined());
  });

  it("zmiana nadpisania layoutu zapisuje SCALONY obiekt, nie sam patch", async () => {
    // Karta layoutu podaje jedno pole na raz. Gdyby trasa zapisywała sam patch,
    // każde kliknięcie w kartę wymazywałoby pozostałe nadpisania wpisu.
    h.form = postEditorFormApi({ form: postForm({ layout_overrides: { layout: "wide" } }) });
    await render();
    await waitFor(() => expect(props("details").layoutCard).toBeDefined());

    const card = props("details").layoutCard as {
      props: { onOverridesChange: (patch: Record<string, unknown>) => void; ov: unknown };
    };
    expect(card.props.ov).toEqual({ layout: "wide" });
    card.props.onOverridesChange({ center_header: true });

    const api = h.form as Record<string, Mock>;
    expect(api.set).toHaveBeenCalledWith("layout_overrides", {
      layout: "wide",
      center_header: true,
    });
  });

  it("wyczyszczenie ostatniego nadpisania zwija kolumnę do `null`", async () => {
    // Kolumna `layout_overrides` nie może zbierać śmieci w postaci obiektu z
    // samymi pustymi wartościami - inaczej „wpis bez nadpisań" nie istnieje.
    h.form = postEditorFormApi({ form: postForm({ layout_overrides: { layout: "wide" } }) });
    await render();
    await waitFor(() => expect(props("details").layoutCard).toBeDefined());

    const card = props("details").layoutCard as {
      props: { onOverridesChange: (patch: Record<string, unknown>) => void };
    };
    card.props.onOverridesChange({ layout: "" });

    const api = h.form as Record<string, Mock>;
    expect(api.set).toHaveBeenCalledWith("layout_overrides", null);
  });

  it("„przejdź do treści” z panelu szczegółów przestawia krok", async () => {
    // Edytor jest content-first: po uzupełnieniu metadanych redaktor wchodzi w
    // treść bez opuszczania trasy.
    await render();
    await waitFor(() => expect(screen.getByTestId("details")).toBeInTheDocument());

    (props("details").onGoToContent as () => void)();

    const step = h.step as { setStep: Mock };
    expect(step.setStep).toHaveBeenCalledWith("content");
  });

  it("krok `content` montuje EDYTOR TREŚCI zamiast panelu szczegółów", async () => {
    // Dwa panele naraz odpytywałyby te same źródła i biły się o autosave.
    h.step = { step: "content", setStep: vi.fn() };
    await render("/admin/posts/moj-wpis?lang=en");
    await waitFor(() => expect(screen.getByTestId("content")).toBeInTheDocument());

    expect(screen.queryByTestId("details")).toBeNull();
    // Edytor treści dostaje ten sam kontekst co panel szczegółów.
    expect(props("content").uiLang).toBe("en");
    expect(props("content").routeSlug).toBe("moj-wpis");
    expect(props("content").layoutCard).toBeDefined();
    expect(props("content").currentFormat).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// /admin/versions
// ---------------------------------------------------------------------------

describe("/admin/versions - otoczka sekcji Wersje", () => {
  const render = () =>
    renderRoute({
      route: VersionsRoute,
      path: "/admin/versions",
      initialEntry: "/admin/versions",
      queryClient: client(),
    });

  it("montuje sekcję wersji", async () => {
    await render();
    await waitFor(() => expect(screen.getByTestId("versionsPane")).toBeInTheDocument());
  });

  it("nagłówek jest dwujęzyczny", async () => {
    h.language = "pl";
    await render();
    await waitFor(() => expect(screen.getByText("Wersje")).toBeInTheDocument());
    cleanup();

    h.language = "en";
    await render();
    await waitFor(() => expect(screen.getByText("Versions")).toBeInTheDocument());
  });

  it("strona jest WYŁĄCZONA z indeksowania i ma opis", async () => {
    // Panel wersji dokumentów prawnych tenanta nie może trafić do wyszukiwarki.
    const meta = await routeMeta(VersionsRoute);
    expect(meta.find((m) => m.name === "robots")?.content).toContain("noindex");
    expect(meta.find((m) => m.name === "description")).toBeDefined();
    expect(meta.some((m) => typeof m.title === "string")).toBe(true);
  });
});
