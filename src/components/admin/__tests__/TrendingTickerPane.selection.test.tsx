// Panel CMS „Warte przeczytania” (`TrendingTickerPane`) - WYBÓR WPISÓW I KOLORY.
//
// CO TEN PLIK PRZYPINA I DLACZEGO.
//   1. LISTA WPISÓW DO WYBORU JEST JEDYNYM MIEJSCEM, GDZIE PANEL CZYTA TREŚCI.
//      Tytuł opcji powstaje z łańcucha zapasowego (tytuł w języku panelu ->
//      polski -> angielski -> IDENTYFIKATOR), bo w bazie oba tytuły są nullable.
//      Bez tego łańcucha redaktor dostaje pustą pozycję na liście i przypina
//      wpis „na ślepo”. Test przechodzi ten łańcuch W OBU JĘZYKACH panelu.
//   2. KOLEJNOŚĆ ZAŁĄCZONYCH MATERIAŁÓW JEST TREŚCIĄ, NIE OZDOBĄ - pasek pokazuje
//      je dokładnie w tej kolejności, więc strzałki, limit trzech pozycji i
//      usuwanie mają świadków, łącznie z blokadą strzałek na końcach listy.
//   3. KOLORY MAJĄ DWA NIEZALEŻNE ZESTAWY (jasny/ciemny), a układ „badge” dokłada
//      trzeci komplet pól. Zmiana jednego zestawu NIE MOŻE ruszyć drugiego, a
//      wyczyszczenie pola musi dać pusty napis (spadek do wartości domyślnej),
//      nie `null` w konfiguracji zapisanej w bazie.
//
// GRANICA ATRAP: klient Supabase, toasty, Radix Select i Switch (happy-dom nie
// otworzy warstwy rozwijanej), próbnik kolorów oraz wybór daty i godziny
// (Popover + kalendarz) - te dwa ostatnie z `src/test/ticker/tickerPaneStubs.ts`.
// Sama logika panelu jest PRAWDZIWA, a wartości domyślne kolorów pochodzą ze
// SŁOWNIKA `tickerVariants`, nie z przepisanych do testu literałów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, supabaseFromStub } from "@/test/supabase";
import type { RecordedChain, SupabaseResult } from "@/test/supabase";
import type { DatePickerSink, TickerPreviewSink } from "@/test/ticker/tickerPaneStubs";
import { DEFAULT_TICKER_COLORS } from "@/lib/views/tickerVariants";

const h = vi.hoisted(() => ({
  language: "pl",
  headerValue: {} as Record<string, unknown>,
  postsFail: false,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastInfo: vi.fn<(message: string) => void>(),
  toastErrorToast: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown, kind: string) => void>(),
  preview: { renders: [], mounts: 0 } as TickerPreviewSink,
  datePicker: { lang: undefined, value: undefined } as DatePickerSink,
  from: null as ((table: string) => unknown) | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string): unknown => {
      if (!h.from) throw new Error(`test: atrapa supabase nie ma łańcucha dla "${table}"`);
      return h.from(table);
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, info: h.toastInfo, error: h.toastErrorToast },
  Toaster: () => null,
}));

vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

// Radix Select zastąpiony natywnym `<select>` (atom repo). JEDNA różnica wobec
// gołego atomu: panel opakowuje tytuł wpisu w `<span className="truncate">`, a
// `<option>` nie przyjmuje węzłów - React zgłaszałby przy każdym renderze błąd
// zagnieżdżenia. Nadpisany `SelectItem` spłaszcza dziecko do samego tekstu, więc
// asercje widzą dokładnie ten napis, który zobaczy redaktor.
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stub = (await import("@/test/reactStubs")).radixSelectStub(react);
  const flatten = (node: unknown): unknown =>
    react.isValidElement<{ children?: unknown }>(node) ? flatten(node.props.children) : node;
  return {
    ...stub,
    SelectItem: ({ value, children }: { value: string; children?: unknown }) =>
      react.createElement("option", { value }, flatten(children) as never),
  };
});

vi.mock("@/components/header/TrendingTicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).trendingTickerStub(
    await import("react"),
    h.preview,
  ),
);

vi.mock("@/components/admin/blocks/AdminColorPicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).adminColorPickerStub(await import("react")),
);

vi.mock("@/components/admin/blocks/AdminDatePicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).adminDateTimePickerStub(
    await import("react"),
    h.datePicker,
  ),
);

import { TrendingTickerPane } from "@/components/admin/TrendingTickerPane";

const db = supabaseFromStub();
h.from = db.from;

const HEADER_KEY = ["site_settings", "header"];
const POSTS_KEY = ["ticker_post_options"];

/**
 * Wpisy z PEŁNYM łańcuchem braków tytułów - każdy wiersz sprawdza inne ogniwo
 * zapasowe. Identyfikatory są atrapami, nie prawdziwymi UUID-ami z bazy.
 */
const POSTS = [
  { id: "post-alfa", title_pl: "Alfa PL", title_en: "Alpha EN" },
  { id: "post-beta", title_pl: "Beta PL", title_en: null },
  { id: "post-gamma", title_pl: null, title_en: "Gamma EN" },
  { id: "post-delta", title_pl: null, title_en: null },
];

function headerResponder(chain: RecordedChain): SupabaseResult {
  if (chain.argsOf("upsert")) return ok(null);
  return ok({ value: h.headerValue });
}

/** Ustawienia z jednym wariantem o podanej konfiguracji paska. */
function headerWith(config: Record<string, unknown>): Record<string, unknown> {
  return {
    trending: {
      activeVariantId: "var-1",
      variants: [{ id: "var-1", name: "Domyślny", config }],
    },
  };
}

async function renderPane() {
  const view = renderWithQueryClient(<TrendingTickerPane />);
  await waitFor(() => {
    expect(view.queryClient.getQueryState(HEADER_KEY)?.status).not.toBe("pending");
    expect(view.queryClient.getQueryState(POSTS_KEY)?.status).not.toBe("pending");
  });
  return view;
}

function preview() {
  const last = h.preview.renders.at(-1);
  if (!last) throw new Error("test: podgląd paska nie został wyrenderowany");
  return last;
}

/** Sekcja formularza wskazana etykietą (napisy przycisków się powtarzają). */
function group(labelText: string): HTMLElement {
  const container = screen.getByText(labelText).parentElement;
  if (!container) throw new Error(`test: etykieta "${labelText}" nie ma kontenera sekcji`);
  return container;
}

function pickSource(name: string): void {
  fireEvent.click(within(group("Źródło wpisów")).getByRole("button", { name }));
}

/** Grupa kolorów wskazana jej nagłówkiem („Tryb jasny”, „Tryb ciemny - badge”). */
function colorGroup(title: string): HTMLElement {
  const container = screen.getByText(title).parentElement;
  if (!container) throw new Error(`test: grupa kolorów "${title}" nie ma kontenera`);
  return container;
}

function setColor(groupTitle: string, field: string, value: string): void {
  fireEvent.change(within(colorGroup(groupTitle)).getByLabelText(field), { target: { value } });
}

beforeEach(() => {
  db.reset();
  db.setResponse("site_settings", headerResponder);
  db.setResponse("posts", () =>
    h.postsFail ? fail("permission denied for table posts", "42501") : ok(POSTS),
  );
  h.language = "pl";
  h.headerValue = {};
  h.postsFail = false;
  h.preview.renders.length = 0;
  h.preview.mounts = 0;
  h.datePicker.lang = undefined;
  h.datePicker.value = undefined;
  vi.clearAllMocks();
});

describe("TrendingTickerPane - lista wpisów do wyboru", () => {
  it("po polsku tytuł opcji spada kolejno: PL -> EN -> identyfikator", async () => {
    h.headerValue = headerWith({ source: "pinned" });
    await renderPane();

    const options = within(screen.getByLabelText("Wybierz wpis")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Alfa PL",
      "Beta PL",
      "Gamma EN",
      "post-delta",
    ]);
    expect(db.lastChain("posts")?.argsOf("eq")).toEqual(["status", "published"]);
    expect(db.lastChain("posts")?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(db.lastChain("posts")?.argsOf("limit")).toEqual([100]);
  });

  it("po angielsku tytuł opcji spada kolejno: EN -> PL -> identyfikator", async () => {
    h.language = "en";
    h.headerValue = headerWith({ source: "pinned" });
    await renderPane();

    const options = within(screen.getByLabelText("Pick a post")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Alpha EN",
      "Beta PL",
      "Gamma EN",
      "post-delta",
    ]);
  });

  it("błąd odczytu wpisów zostawia pustą listę, a panel dalej działa", async () => {
    h.postsFail = true;
    h.headerValue = headerWith({ source: "selected", selectedPostIds: ["post-alfa"] });
    const view = await renderPane();

    expect(view.queryClient.getQueryState(POSTS_KEY)?.status).toBe("error");
    expect(within(screen.getByLabelText("Dodaj wpis")).queryAllByRole("option")).toHaveLength(0);
    // Bez katalogu tytułów lista załączonych pokazuje surowy identyfikator -
    // redaktor widzi, CO jest przypięte, zamiast pustego wiersza.
    expect(screen.getByRole("listitem")).toHaveTextContent("post-alfa");
  });

  it("pusta odpowiedź katalogu (null bez błędu) daje listę bez opcji, a nie wyjątek", async () => {
    db.setResponse("posts", () => ok(null));
    h.headerValue = headerWith({ source: "pinned" });
    const view = await renderPane();

    expect(view.queryClient.getQueryState(POSTS_KEY)?.status).toBe("success");
    expect(within(screen.getByLabelText("Wybierz wpis")).queryAllByRole("option")).toHaveLength(0);
  });

  it("identyfikator spoza katalogu zostaje na liście jako surowy tekst", async () => {
    h.headerValue = headerWith({ source: "selected", selectedPostIds: ["post-usuniety"] });
    await renderPane();

    expect(screen.getByRole("listitem")).toHaveTextContent("post-usuniety");
  });
});

describe("TrendingTickerPane - przypięty wpis", () => {
  it("wybór z listy i wpisanie identyfikatora ręcznie prowadzą do tej samej wartości", async () => {
    await renderPane();
    pickSource("Przypięty wpis");

    fireEvent.change(screen.getByLabelText("Wybierz wpis"), { target: { value: "post-beta" } });

    expect(preview().pinnedPostId).toBe("post-beta");
    expect(screen.getByLabelText("ID przypiętego wpisu (UUID)")).toHaveValue("post-beta");

    fireEvent.change(screen.getByLabelText("ID przypiętego wpisu (UUID)"), {
      target: { value: "  post-gamma  " },
    });

    expect(preview().pinnedPostId).toBe("post-gamma");
  });

  it("wyczyszczenie pola identyfikatora kasuje przypięcie zamiast zapisywać pusty napis", async () => {
    h.headerValue = headerWith({ source: "pinned", pinnedPostId: "post-alfa" });
    await renderPane();
    await waitFor(() => expect(preview().pinnedPostId).toBe("post-alfa"));

    fireEvent.change(screen.getByLabelText("ID przypiętego wpisu (UUID)"), {
      target: { value: "   " },
    });

    expect(preview().pinnedPostId).toBeUndefined();
  });

  it("data ważności przypięcia dostaje język panelu, zapisuje się i da się ją skasować", async () => {
    h.language = "en";
    h.headerValue = headerWith({ source: "pinned", pinnedPostId: "post-alfa" });
    await renderPane();
    await waitFor(() => expect(h.datePicker.lang).toBe("en"));

    fireEvent.change(screen.getByTestId("tt-pinned-until"), {
      target: { value: "2026-01-31T18:00" },
    });
    expect(preview().pinnedUntil).toBe("2026-01-31T18:00");

    fireEvent.click(screen.getByTestId("tt-pinned-until-clear"));
    expect(preview().pinnedUntil).toBeNull();
  });
});

describe("TrendingTickerPane - załączone materiały", () => {
  it("dokłada wpisy w kolejności wyboru, numeruje je i blokuje listę po trzecim", async () => {
    await renderPane();
    pickSource("Wybrane materiały");
    const add = (): HTMLElement => screen.getByLabelText("Dodaj wpis");

    fireEvent.change(add(), { target: { value: "post-gamma" } });
    fireEvent.change(add(), { target: { value: "post-alfa" } });

    // Raz wybrany wpis znika z listy do dołożenia.
    expect(
      within(add())
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["post-beta", "post-delta"]);

    fireEvent.change(add(), { target: { value: "post-beta" } });

    expect(preview().selectedPostIds).toEqual(["post-gamma", "post-alfa", "post-beta"]);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("01Gamma EN"),
      expect.stringContaining("02Alfa PL"),
      expect.stringContaining("03Beta PL"),
    ]);
    expect(add()).toBeDisabled();
  });

  it("strzałki przestawiają kolejność i są wyłączone na końcach listy", async () => {
    h.headerValue = headerWith({
      source: "selected",
      selectedPostIds: ["post-alfa", "post-beta", "post-gamma"],
    });
    await renderPane();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));

    const row = (index: number): HTMLElement => screen.getAllByRole("listitem")[index];
    expect(within(row(0)).getByRole("button", { name: "Up" })).toBeDisabled();
    expect(within(row(2)).getByRole("button", { name: "Down" })).toBeDisabled();

    fireEvent.click(within(row(2)).getByRole("button", { name: "Up" }));
    expect(preview().selectedPostIds).toEqual(["post-alfa", "post-gamma", "post-beta"]);

    fireEvent.click(within(row(0)).getByRole("button", { name: "Down" }));
    expect(preview().selectedPostIds).toEqual(["post-gamma", "post-alfa", "post-beta"]);
  });

  it("usunięcie pozycji odblokowuje listę i wraca ją do wyboru", async () => {
    h.headerValue = headerWith({
      source: "selected",
      selectedPostIds: ["post-alfa", "post-beta", "post-gamma"],
    });
    await renderPane();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByLabelText("Dodaj wpis")).toBeDisabled();

    fireEvent.click(
      within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Usuń" }),
    );

    expect(preview().selectedPostIds).toEqual(["post-alfa", "post-gamma"]);
    const add = screen.getByLabelText("Dodaj wpis");
    expect(add).toBeEnabled();
    expect(
      within(add)
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["post-beta", "post-delta"]);
  });

  it("miks pokazuje listę załączonych obok przypięcia", async () => {
    await renderPane();
    pickSource("Miks (przypięte + wypełnienie)");

    fireEvent.change(screen.getByLabelText("Dodaj wpis"), { target: { value: "post-delta" } });

    expect(preview().source).toBe("mixed");
    expect(preview().selectedPostIds).toEqual(["post-delta"]);
    expect(screen.getByLabelText("ID przypiętego wpisu (UUID)")).toBeInTheDocument();
  });
});

describe("TrendingTickerPane - kolory", () => {
  it("zestawy jasny i ciemny są niezależne", async () => {
    await renderPane();

    setColor("Tryb jasny", "Tło", "#101010");
    setColor("Tryb ciemny", "Kolor tytułu", "#f0f0f0");

    expect(preview().colors?.light.bg).toBe("#101010");
    expect(preview().colors?.dark.item).toBe("#f0f0f0");
    // Nietknięte pola zostają na wartościach ze słownika domyślnych.
    expect(preview().colors?.dark.bg).toBe(DEFAULT_TICKER_COLORS.dark.bg);
    expect(preview().colors?.light.item).toBe(DEFAULT_TICKER_COLORS.light.item);
  });

  it("wyczyszczenie pola daje PUSTY NAPIS, a nie brak wartości", async () => {
    await renderPane();

    fireEvent.click(
      within(colorGroup("Tryb jasny")).getByRole("button", {
        name: "Obramowanie / separator - wyczyść",
      }),
    );

    expect(preview().colors?.light.border).toBe("");
  });

  it("przywrócenie domyślnych kasuje OBA zestawy naraz", async () => {
    await renderPane();
    setColor("Tryb jasny", "Tło", "#101010");
    setColor("Tryb ciemny", "Numery", "#202020");

    fireEvent.click(screen.getByRole("button", { name: "Przywróć domyślne" }));

    expect(preview().colors).toEqual(DEFAULT_TICKER_COLORS);
  });

  it("układ badge dokłada trzy pola kolorów odznaki do obu zestawów", async () => {
    await renderPane();
    expect(screen.queryByText("Tryb jasny - badge")).not.toBeInTheDocument();

    fireEvent.click(
      within(group("Styl paska")).getByRole("button", { name: "Badge marquee (kolorowy blok)" }),
    );

    const badgeLight = colorGroup("Tryb jasny - badge");
    expect(within(badgeLight).getAllByRole("textbox")).toHaveLength(3);
    expect(within(colorGroup("Tryb jasny")).getAllByRole("textbox")).toHaveLength(6);

    setColor("Tryb jasny - badge", "Tło etykiety (badge)", "#0055ff");
    setColor("Tryb ciemny - badge", "Kropka separatora (badge)", "#ff0055");

    expect(preview().colors?.light.labelBg).toBe("#0055ff");
    expect(preview().colors?.dark.dot).toBe("#ff0055");
    expect(preview().colors?.light.labelFg).toBe(DEFAULT_TICKER_COLORS.light.labelFg);
  });

  // DEFEKT (rejestr). `ColorField` rysuje `<Label htmlFor="tt-color-...">`, ale
  // `AdminColorPicker` nie przyjmuje `id` i żadna kontrolka takiego identyfikatora
  // nie dostaje. Etykieta jest więc martwa: kliknięcie w nią nie ustawia fokusu,
  // a czytnik ekranu nie łączy pary. Atrapa próbnika PRZEKAZUJE `id` dalej, gdyby
  // panel zaczął go podawać - ten test zazieleni się dopiero po naprawie
  // produkcji, a nie po zmianie atrapy.
  //
  // UWAGA DLA NAPRAWIAJĄCEGO (ustalone w recenzji przez doświadczenie: dopisanie
  // `id={id}` w `ColorField` i przebieg tego jednego testu). Atrapa jest
  // ŁAGODNIEJSZA NIŻ PRODUKCJA - kładzie `id` na swoje pole, więc test zzielenieje
  // już po samej połówce naprawy. Defekt ma DWIE połówki i obie trzeba zrobić:
  // `ColorField` musi podać `id`, a `AdminColorPicker` musi ten prop przyjąć i
  // przekazać renderowanemu elementowi (dziś jego `AdminColorPickerProps` w ogóle
  // go nie ma, więc prawdziwy panel po samej pierwszej połówce dalej gubiłby
  // powiązanie etykiety).
  it.fails("DEFEKT: etykieta pola koloru nie jest powiązana z żadną kontrolką", async () => {
    await renderPane();

    const label = within(colorGroup("Tryb jasny")).getByText("Tło");
    expect(label.getAttribute("for")).toBe("tt-color-Tryb jasny-bg");
    expect(document.getElementById(label.getAttribute("for") ?? "")).not.toBeNull();
  });

  // DRUGA POŁÓWKA tego samego defektu - test na PRAWDZIWYM próbniku, z pominięciem
  // atrapy pliku. Atrapa wyżej kładzie `id` na swoje pole, więc gdyby naprawa
  // dopisała `id={id}` w `ColorField` i zadeklarowała prop w `AdminColorPicker`,
  // ale nie przekazała go przyciskowi-swatchowi, tamten test zzieleniałby przy
  // etykiecie nadal martwej w produkcji. Ten test pyta prawdziwy `AdminColorPicker`,
  // czy podany `id` ląduje na jego przycisku - dziś `AdminColorPickerProps` w ogóle
  // nie ma pola `id`, więc prop przepada. Oba testy zielenieją dopiero razem.
  it.fails(
    "DEFEKT: prawdziwy AdminColorPicker nie kładzie podanego `id` na przycisku-swatchu",
    async () => {
      const real = await vi.importActual<
        typeof import("@/components/admin/blocks/AdminColorPicker")
      >("@/components/admin/blocks/AdminColorPicker");
      const props: ComponentProps<typeof real.AdminColorPicker> & { id: string } = {
        id: "tt-color-test-bg",
        value: "#112233",
        onChange: () => undefined,
        ariaLabel: "Tło (prawdziwy próbnik)",
      };
      renderWithQueryClient(<real.AdminColorPicker {...props} />);

      const swatch = screen.getByRole("button", { name: "Tło (prawdziwy próbnik)" });
      expect(swatch).toBeInTheDocument();
      expect(document.getElementById("tt-color-test-bg")).toBe(swatch);
    },
  );
});
