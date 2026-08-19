// Panel konfiguracji silnika rekomendacji - CAŁY, od odczytu przez zakładki do
// upsertu z POTWIERDZENIEM zapisanego wiersza.
//
// STAN WYJŚCIOWY: `src/routes/admin.related-posts.tsx` miał 444 linie i 0 z 36
// funkcji pokrytych. Panel jest tu wyjątkowo wart testu, bo naprawiono w nim
// defekt klasy „cichy sukces": poprzednia implementacja robiła
// `update(next).neq("tenant_id", zero-uuid)`, a UPDATE bez dopasowania jest dla
// PostgREST sukcesem - obszar roboczy bez zasianego wiersza widział „Zapisano"
// przy zerowej zmianie. Test pilnuje, że ta ścieżka NIE wraca.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({
  from: null as unknown,
  rpc: null as unknown,
}));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: vitest } = await import("vitest");
  const from = supabaseFromStub();
  const rpc = vitest.fn(async () => ({ data: "tenant-1", error: null }));
  stubs.from = from;
  stubs.rpc = rpc;
  return { supabase: { from: from.from, rpc } };
});

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/postExperience/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});

// Zakładka analityki to samodzielny organizm z własnym testem; tutaj liczy się
// wyłącznie to, że kompozytor ją wstawia pod właściwą zakładką.
vi.mock("@/components/admin/analytics/RelatedPostsAnalytics", () => ({
  RelatedPostsAnalytics: () => <div data-testid="related-analytics" />,
}));

// Podglądy układów mają własne testy; potrzebna jest tu wyłącznie ich intencja.
vi.mock("@/components/admin/RelatedLayoutPreview", () => ({
  RelatedLayoutPreview: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button type="button" data-testid="layout-preview" onClick={() => onChange("timeline")}>
      {value}
    </button>
  ),
}));

import {
  RelatedPostsSettingsPanel,
  RelatedPostsNotFound,
} from "@/components/admin/postExperience/organisms/RelatedPostsSettingsPanel";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import { RELATED_POSTS_ADMIN_QUERY_KEY } from "@/lib/relatedPosts/adminConfig";
import { ok, fail, type SupabaseFromStub } from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;
const rpc = () => stubs.rpc as ReturnType<typeof vi.fn>;

const config = (over: Partial<RelatedPostsConfig> = {}): RelatedPostsConfig => ({
  ...RELATED_POSTS_DEFAULTS,
  ...over,
});

/**
 * Osadzenie BEZ zasianego cache'u - pierwszy render idzie z `data === undefined`,
 * czyli formularz musi stanąć na wartościach domyślnych, a nie na `undefined`
 * w każdym polu (React zgłosiłby wtedy przejście kontrolki w niekontrolowaną).
 */
function renderPanelCold() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<RelatedPostsSettingsPanel />, { wrapper }) };
}

function renderPanel(persisted: Partial<RelatedPostsConfig> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(RELATED_POSTS_ADMIN_QUERY_KEY, config(persisted));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<RelatedPostsSettingsPanel />, { wrapper }) };
}

const writeChains = () =>
  from()
    .chainsFor("related_posts_config")
    .filter((chain) => chain.calls.some((call) => call.method === "upsert"));

const savedRow = () => writeChains()[0]?.calls[0]?.args[0] as Record<string, unknown>;

const field = (name: string) =>
  screen.getByRole("spinbutton", { name: `adminRelatedPosts.fields.${name}` });
const select = (name: string) =>
  screen.getByRole("combobox", { name: `adminRelatedPosts.fields.${name}` });
const tab = (name: string) => screen.getByRole("tab", { name: `adminRelatedPosts.tabs.${name}` });
const configSave = () => screen.getByRole("button", { name: /adminRelatedPosts\.actions\.save$/ });

/** Potwierdzenie zapisu: PostgREST oddaje wiersz z `tenant_id`. */
function acceptWrite(tenantId = "tenant-1") {
  from().setResponse("related_posts_config", ok([{ tenant_id: tenantId }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  rpc().mockResolvedValue({ data: "tenant-1", error: null });
  acceptWrite();
});

describe("RelatedPostsSettingsPanel - co widać", () => {
  it("tytuł strony i TRZY zakładki panelu", () => {
    renderPanel();
    expect(
      screen.getByRole("heading", { level: 1, name: "adminRelatedPosts.pageTitle" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("lista zakładek ma NAZWĘ GRUPY (kopia w pliku trasy jej nie miała)", () => {
    renderPanel();
    expect(
      screen.getByRole("tablist", { name: "adminRelatedPosts.pageTitle" }),
    ).toBeInTheDocument();
    expect(tab("config")).toHaveAttribute("aria-selected", "true");
  });

  it("panel czyta wartości Z BAZY, nie z wartości domyślnych", () => {
    renderPanel({ items_limit: 9, after_paragraph: 5, position: "after_paragraph" });
    expect(field("itemsLimit")).toHaveValue(9);
    expect(field("afterParagraph")).toHaveValue(5);
    expect(select("position")).toHaveValue("after_paragraph");
  });

  it("SZEŚĆ układów jest do wyboru - tyle, ile renderuje komponent publiczny", () => {
    renderPanel();
    const options = within(select("layout"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["grid", "list", "slider", "cards", "magazine", "timeline"]);
    expect(options).toHaveLength(6);
  });

  it("wszystkie listy rozwijane mają POWIĄZANĄ etykietę (Radix daje `combobox` bez nazwy)", () => {
    renderPanel();
    for (const name of ["position", "layout", "columns", "sourceStrategy"]) {
      expect(select(name).id).toBeTruthy();
    }
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });

  it("pola liczbowe niosą granice z warstwy ZAPISU, nie z osobnej listy w panelu", () => {
    renderPanel();
    expect(field("itemsLimit")).toHaveAttribute("min", "1");
    expect(field("itemsLimit")).toHaveAttribute("max", "24");
    expect(field("recencyBoostDays")).toHaveAttribute("max", "3650");
  });

  it("zakładka analityki wstawia dashboard, konfiguracja go NIE pokazuje", () => {
    renderPanel();
    expect(screen.queryByTestId("related-analytics")).toBeNull();
    fireEvent.mouseDown(tab("analytics"));
    expect(screen.getByTestId("related-analytics")).toBeInTheDocument();
  });

  it("zakładka silnika pokazuje SIEDEM wag, każdą z widocznym podpisem i podpowiedzią", () => {
    renderPanel();
    fireEvent.mouseDown(tab("engine"));
    expect(screen.getAllByRole("slider")).toHaveLength(7);
    for (const slug of [
      "categories",
      "tags",
      "author",
      "recency",
      "popularity",
      "dwell",
      "personalization",
    ]) {
      expect(screen.getByText(`adminRelatedPosts.engine.${slug}`)).toBeInTheDocument();
      expect(screen.getByText(`adminRelatedPosts.engine.${slug}Hint`)).toBeInTheDocument();
    }
  });

  it("PRZYPIĘTA USTERKA: suwak wagi nie ma nazwy dostępnej", () => {
    // `WeightSlider` wiąże podpis przez `aria-labelledby` na KORZENIU Radiksa,
    // a `role="slider"` siedzi na uchwycie - atrybut nie schodzi tam sam.
    // Czytnik ekranu ogłasza więc „suwak, 4", bez informacji, którego sygnału
    // dotyczy. Atom jest wspólny dla panelu i innych ekranów, więc naprawa
    // (`aria-label` na uchwycie) idzie osobnym commitem.
    renderPanel();
    fireEvent.mouseDown(tab("engine"));
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs.every((t) => !t.getAttribute("aria-label"))).toBe(true);
    expect(thumbs.every((t) => !t.getAttribute("aria-labelledby"))).toBe(true);
  });

  it("widok nieznalezionej trasy czyta ze słownika panelu, nie z tekstu w kodzie", () => {
    render(<RelatedPostsNotFound />);
    expect(screen.getByText("adminRelatedPosts.notFound")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("RelatedPostsSettingsPanel - pierwszy render bez danych", () => {
  it("formularz stoi na wartościach DOMYŚLNYCH, dopóki odczyt nie wróci", () => {
    from().setResponse("related_posts_config", ok(null));
    renderPanelCold();
    expect(field("itemsLimit")).toHaveValue(RELATED_POSTS_DEFAULTS.items_limit);
    expect(select("layout")).toHaveValue(RELATED_POSTS_DEFAULTS.layout);
  });

  it("brak wiersza w bazie NIE gasi panelu - zostają wartości domyślne", async () => {
    from().setResponse("related_posts_config", ok(null));
    renderPanelCold();
    await waitFor(() => expect(from().chainsFor("related_posts_config").length).toBeGreaterThan(0));
    expect(field("itemsLimit")).toHaveValue(RELATED_POSTS_DEFAULTS.items_limit);
    expect(writeChains()).toHaveLength(0);
  });
});

describe("RelatedPostsSettingsPanel - co jest wyłączone", () => {
  it("pole akapitu jest WYŁĄCZONE, dopóki pozycja nie jest `after_paragraph`", () => {
    renderPanel({ position: "end" });
    expect(field("afterParagraph")).toBeDisabled();
    expect(field("itemsLimit")).not.toBeDisabled();
  });

  it("zmiana pozycji na `after_paragraph` ODBLOKOWUJE pole akapitu", () => {
    renderPanel({ position: "end" });
    fireEvent.change(select("position"), { target: { value: "after_paragraph" } });
    expect(field("afterParagraph")).not.toBeDisabled();
    expect(select("position")).toHaveValue("after_paragraph");
  });

  it("interwał przewijania jest WYŁĄCZONY bez autoplaya", () => {
    renderPanel({ slider_autoplay: false });
    expect(field("sliderIntervalMs")).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: /adminRelatedPosts\.fields\.sliderAutoplay/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("włączenie autoplaya odblokowuje interwał", () => {
    renderPanel({ slider_autoplay: false });
    fireEvent.click(
      screen.getByRole("switch", { name: /adminRelatedPosts\.fields\.sliderAutoplay/ }),
    );
    expect(field("sliderIntervalMs")).not.toBeDisabled();
  });

  it("przycisk zapisu jest wyłączony W TRAKCIE zapisu, nie po nim", async () => {
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(configSave()).not.toBeDisabled();
  });
});

describe("RelatedPostsSettingsPanel - co idzie do bazy", () => {
  it("zapis to UPSERT z konfliktem na `tenant_id` i POTWIERDZENIEM przez `select`", async () => {
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const methods = writeChains()[0]?.calls.map((c) => c.method);
    expect(methods).toEqual(["upsert", "select"]);
    expect(writeChains()[0]?.calls[0]?.args[1]).toEqual({ onConflict: "tenant_id" });
  });

  it("wiersz jedzie z JAWNYM `tenant_id` tenanta DOMOWEGO", async () => {
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().tenant_id).toBe("tenant-1");
    expect(rpc()).toHaveBeenCalledWith("current_tenant_id");
  });

  it("wartość PONAD granicą jest przycięta zanim wyjdzie z panelu", async () => {
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "999" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().items_limit).toBe(24);
    expect(field("itemsLimit")).toHaveValue(24);
  });

  it("wybór układu z PODGLĄDU trafia do tego samego pola co lista rozwijana", async () => {
    renderPanel({ layout: "grid" });
    fireEvent.click(screen.getByTestId("layout-preview"));
    expect(select("layout")).toHaveValue("timeline");
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().layout).toBe("timeline");
  });

  it("wagi z zakładki silnika jadą do bazy razem z konfiguracją podstawową", async () => {
    renderPanel({ weight_tags: 3 });
    fireEvent.mouseDown(tab("engine"));
    fireEvent.click(
      screen.getByRole("button", { name: /adminRelatedPosts\.actions\.saveWeights/ }),
    );
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().weight_tags).toBe(3);
    expect(savedRow().items_limit).toBe(RELATED_POSTS_DEFAULTS.items_limit);
  });

  it("KAŻDA lista rozwijana odkłada wybór w swoim polu", async () => {
    renderPanel({ layout: "grid", columns: 3, source_strategy: "both" });
    fireEvent.change(select("layout"), { target: { value: "magazine" } });
    fireEvent.change(select("columns"), { target: { value: "4" } });
    fireEvent.change(select("sourceStrategy"), { target: { value: "tags" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow()).toMatchObject({ layout: "magazine", columns: 4, source_strategy: "tags" });
    expect(select("columns")).toHaveValue("4");
  });

  it("liczba kolumn jedzie do bazy jako LICZBA, nie jako napis z listy", async () => {
    renderPanel({ columns: 2 });
    fireEvent.change(select("columns"), { target: { value: "3" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().columns).toBe(3);
    expect(typeof savedRow().columns).toBe("number");
  });

  it("pola akapitu i interwału odkładają wartości, gdy są odblokowane", async () => {
    renderPanel({ position: "after_paragraph", slider_autoplay: true });
    fireEvent.change(field("afterParagraph"), { target: { value: "6" } });
    fireEvent.change(field("sliderIntervalMs"), { target: { value: "4000" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().after_paragraph).toBe(6);
    expect(savedRow().slider_interval_ms).toBe(4000);
  });

  it("tytuł POLSKI jest edytowalny osobno od angielskiego", async () => {
    renderPanel({ title_pl: "Powiązane", title_en: "Related" });
    fireEvent.change(screen.getByLabelText("adminRelatedPosts.fields.titlePl"), {
      target: { value: "Zobacz także" },
    });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().title_pl).toBe("Zobacz także");
    expect(savedRow().title_en).toBe("Related");
  });

  it("przełącznik zapowiedzi treści działa niezależnie od pozostałych", async () => {
    renderPanel({ show_excerpt: true, show_cover: true });
    fireEvent.click(screen.getByRole("switch", { name: /fields\.showExcerpt/ }));
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().show_excerpt).toBe(false);
    expect(savedRow().show_cover).toBe(true);
  });

  it("suwak wagi zmienia wartość z klawiatury i trafia do bazy", async () => {
    renderPanel({ weight_tags: 3 });
    fireEvent.mouseDown(tab("engine"));
    const thumbs = screen.getAllByRole("slider");
    // Kolejność suwaków = kolejność deskryptorów, więc drugi to waga tagów.
    fireEvent.keyDown(thumbs[1], { key: "ArrowRight" });
    fireEvent.click(
      screen.getByRole("button", { name: /adminRelatedPosts\.actions\.saveWeights/ }),
    );
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().weight_tags).toBe(4);
    expect(savedRow().weight_categories).toBe(RELATED_POSTS_DEFAULTS.weight_categories);
  });

  it("wyjątek POZA klasą błędu zapisu też daje komunikat, a nie cichą porażkę", async () => {
    // `rpc` odrzucone (padła sieć, wygasł token) nie przechodzi przez
    // `RelatedPostsSaveError`, więc panel musi mieć gałąź awaryjną.
    rpc().mockRejectedValue(new Error("network down"));
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminRelatedPosts.toast.writeFailed"),
    );
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("UDANY zapis melduje sukces i podstawia wartości PO normalizacji", async () => {
    renderPanel();
    fireEvent.change(field("recencyBoostDays"), { target: { value: "99999" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    expect(field("recencyBoostDays")).toHaveValue(3650);
  });

  it("ZAPIS BEZ DOPASOWANIA nie jest sukcesem - to jest naprawiony defekt", async () => {
    // PostgREST na `upsert` bez dopasowania oddaje pustą listę. Poprzednia
    // implementacja czytała to jako sukces i pokazywała „Zapisano".
    from().setResponse("related_posts_config", ok([]));
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapis do CUDZEGO wiersza nie jest sukcesem (potwierdzenie musi zgadzać się z tenantem)", async () => {
    from().setResponse("related_posts_config", ok([{ tenant_id: "tenant-obcy" }]));
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminRelatedPosts.toast.notPersisted"),
    );
  });

  it("BRAK obszaru roboczego daje INNY komunikat niż nieudany zapis", async () => {
    rpc().mockResolvedValue({ data: null, error: null });
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminRelatedPosts.toast.noTenant"),
    );
    expect(writeChains()).toHaveLength(0);
  });

  it("BŁĄD odczytu tenanta daje komunikat o odczycie, nie o zapisie", async () => {
    rpc().mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminRelatedPosts.toast.tenantLookupFailed"),
    );
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("jwt expired"));
  });

  it("BŁĄD zapisu w bazie daje komunikat o zapisie, z treścią błędu", async () => {
    from().setResponse("related_posts_config", fail("permission denied", "42501"));
    renderPanel();
    fireEvent.change(field("itemsLimit"), { target: { value: "8" } });
    fireEvent.click(configSave());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminRelatedPosts.toast.writeFailed"),
    );
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });

  it("przełączniki treści kart trafiają do szkicu pod swoimi kluczami", async () => {
    renderPanel({ show_cover: true, show_excerpt: true, show_meta: true });
    fireEvent.click(screen.getByRole("switch", { name: /fields\.showCover/ }));
    fireEvent.click(screen.getByRole("switch", { name: /fields\.showMeta/ }));
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow()).toMatchObject({ show_cover: false, show_meta: false, show_excerpt: true });
  });

  it("tytuł sekcji jest edytowalny OSOBNO w każdym języku", async () => {
    renderPanel({ title_pl: "Powiązane", title_en: "Related" });
    fireEvent.change(screen.getByLabelText("adminRelatedPosts.fields.titleEn"), {
      target: { value: "You may also like" },
    });
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().title_en).toBe("You may also like");
    expect(savedRow().title_pl).toBe("Powiązane");
  });

  it("wyłączenie sekcji trafia do bazy jako `false`, nie jako brak pola", async () => {
    renderPanel({ enabled: true });
    fireEvent.click(screen.getByRole("switch", { name: /fields\.enabled/ }));
    fireEvent.click(configSave());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().enabled).toBe(false);
    expect(Object.keys(savedRow())).toContain("enabled");
  });

  it("wyłączenie ważenia IDF idzie do bazy z zakładki silnika", async () => {
    renderPanel({ use_idf: true });
    fireEvent.mouseDown(tab("engine"));
    fireEvent.click(screen.getByRole("switch", { name: /fields\.useIdf/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /adminRelatedPosts\.actions\.saveWeights/ }),
    );
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().use_idf).toBe(false);
    expect(savedRow().min_score).toBe(RELATED_POSTS_DEFAULTS.min_score);
  });

  it("próg dopasowania jest przycinany do zakresu warstwy zapisu", async () => {
    renderPanel();
    fireEvent.mouseDown(tab("engine"));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "adminRelatedPosts.fields.minScore" }),
      {
        target: { value: "5000" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /adminRelatedPosts\.actions\.saveWeights/ }),
    );
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().min_score).toBe(1000);
    expect(savedRow().use_idf).toBe(RELATED_POSTS_DEFAULTS.use_idf);
  });
});
