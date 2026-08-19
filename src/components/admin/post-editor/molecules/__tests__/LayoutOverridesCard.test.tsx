// Karta „Layout wpisu": format wpisu, nadpisanie presetu layoutu, podgląd na
// żywo i trójstan sekcji stopki.
//
// CO TU DOWODZIMY:
//   * nadpisania są ROZŁĄCZNE i punktowe - jedna zmiana wysyła łatkę z JEDNYM
//     kluczem, a wybór „Globalne" CZYŚCI nadpisanie (klucz z wartością
//     undefined), zamiast zapisywać `false`,
//   * podgląd pokazuje preset RZECZYWIŚCIE użyty (nadpisanie > globalny dla
//     formatu) i mówi, z którego źródła pochodzi,
//   * rekomendowany kadr okładki pojawia się tylko dla presetów, które go mają,
//   * bez ustawień globalnych karta nie próbuje rysować podglądu.
//
// DLACZEGO TO WAŻNE: „Globalne" zapisane jako `false` na zawsze odcina wpis od
// późniejszych zmian ustawień najemcy - redakcja włącza np. kartę autora globalnie,
// a stare wpisy jej nie pokazują i nikt nie wie dlaczego. Łatka z nadmiarowymi
// kluczami nadpisuje sekcje, których nikt nie tknął. Zły preset w podglądzie
// prowadzi do wgrania okładki w złym kadrze (widocznej publicznie).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  defaultPostLayoutSettings,
  getLayoutSet,
  type LayoutOverrides,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

// Radixowy <Select> nie otwiera listy w happy-dom. Atrapa oddaje natywny
// <select> - dotyczy TRZECH powierzchni tej karty naraz (format, nadpisanie
// layoutu i wszystkie trójstany stopki z atomu TriStateSelect).
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: Node;
    }) =>
      React.createElement(
        "select",
        {
          value,
          onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
        },
        children as never,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: Node }) =>
      React.createElement(React.Fragment, null, children as never),
    SelectItem: ({ value, children }: { value: string; children?: Node }) =>
      React.createElement("option", { value }, children as never),
  };
});

import { LayoutOverridesCard } from "../LayoutOverridesCard";

const LAYOUT_SET = getLayoutSet("standard");

interface Overrides {
  postFormat?: PostFormat;
  ov?: LayoutOverrides;
  currentFormat?: PostFormat;
  globalLayout?: PostLayoutSettings | undefined;
  layoutSet?: ReturnType<typeof getLayoutSet>;
}

function renderCard(overrides: Overrides = {}) {
  const onPostFormatChange = vi.fn<(v: PostFormat) => void>();
  const onOverridesChange = vi.fn<(patch: Partial<LayoutOverrides>) => void>();
  const view = render(
    <TooltipProvider>
      <LayoutOverridesCard
        postFormat={overrides.postFormat ?? "standard"}
        onPostFormatChange={onPostFormatChange}
        ov={overrides.ov ?? {}}
        onOverridesChange={onOverridesChange}
        currentFormat={overrides.currentFormat ?? "standard"}
        layoutSet={overrides.layoutSet ?? LAYOUT_SET}
        globalLayout={"globalLayout" in overrides ? overrides.globalLayout : undefined}
      />
    </TooltipProvider>,
  );
  return { ...view, onPostFormatChange, onOverridesChange };
}

/** Lista, która ma opcję o danej wartości - identyfikuje kontrolkę po treści. */
function selectWithOption(value: string): HTMLSelectElement {
  const found = (screen.getAllByRole("combobox") as HTMLSelectElement[]).find((s) =>
    s.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`brak listy z opcją "${value}"`);
  return found;
}

const formatSelect = () => selectWithOption("gallery");
const layoutSelect = () => selectWithOption("__inherit__");

/** Trójstan wiersza stopki wskazany po kluczu etykiety obok. */
function footerSelect(labelKey: string): HTMLSelectElement {
  const row = screen.getByText(`adminPostPanes.layout.${labelKey}`).parentElement as HTMLElement;
  return row.querySelector("select") as HTMLSelectElement;
}

/** Jedno wywołanie łatki nadpisań - jako para (klucze, wartość). */
function lastPatch(fn: ReturnType<typeof vi.fn>): Partial<LayoutOverrides> {
  return fn.mock.calls.at(-1)?.[0] as Partial<LayoutOverrides>;
}

describe("LayoutOverridesCard - format wpisu", () => {
  it("nazywa kartę i sekcję formatu kluczami i18n", () => {
    renderCard();

    expect(screen.getByText("adminPostPanes.layout.cardTitle")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.layout.format")).toBeInTheDocument();
  });

  it("pokazuje aktualny format wpisu", () => {
    renderCard({ postFormat: "video" });

    expect(formatSelect().value).toBe("video");
  });

  it("dla wpisu bez formatu w bazie pokazuje standard (a nie pustą listę)", () => {
    // Kolumna `post_format` jest nullowalna dla starszych wpisów.
    renderCard({ postFormat: null as unknown as PostFormat });

    expect(formatSelect().value).toBe("standard");
  });

  it("zmiana formatu zgłasza nowy format rodzicowi", () => {
    const { onPostFormatChange } = renderCard();

    fireEvent.change(formatSelect(), { target: { value: "audio" } });

    expect(onPostFormatChange).toHaveBeenCalledWith("audio");
  });
});

describe("LayoutOverridesCard - nadpisanie presetu layoutu", () => {
  it("bez nadpisania lista stoi na wartości dziedziczonej", () => {
    renderCard({ ov: {} });

    expect(layoutSelect().value).toBe("__inherit__");
    expect(screen.getByText("adminPostPanes.layout.useGlobal")).toBeInTheDocument();
  });

  it("wystawia wszystkie presety przekazanego zestawu", () => {
    renderCard();

    for (const preset of LAYOUT_SET) {
      expect(screen.getByRole("option", { name: preset.label })).toBeInTheDocument();
    }
  });

  it("nadpisanie pokazuje wybrany preset", () => {
    renderCard({ ov: { layout: "layout-3" } });

    expect(layoutSelect().value).toBe("layout-3");
  });

  it("wybór presetu zapisuje nadpisanie layoutu", () => {
    const { onOverridesChange } = renderCard();

    fireEvent.change(layoutSelect(), { target: { value: "layout-2" } });

    expect(onOverridesChange).toHaveBeenCalledWith({ layout: "layout-2" });
  });

  it("powrót do ustawień globalnych CZYŚCI nadpisanie (undefined, nie napis)", () => {
    const { onOverridesChange } = renderCard({ ov: { layout: "layout-2" } });

    fireEvent.change(layoutSelect(), { target: { value: "__inherit__" } });

    const patch = lastPatch(onOverridesChange);
    expect(Object.keys(patch)).toEqual(["layout"]);
    expect(patch.layout).toBeUndefined();
  });
});

describe("LayoutOverridesCard - podgląd na żywo", () => {
  it("bez ustawień globalnych karta nie rysuje podglądu (nie ma z czego)", () => {
    renderCard({ globalLayout: undefined });

    expect(screen.queryByText("adminPostPanes.layout.livePreview")).not.toBeInTheDocument();
    expect(screen.queryByText(/format: standard/)).not.toBeInTheDocument();
  });

  it("bez nadpisania podgląd bierze preset GLOBALNY dla formatu i tak się podpisuje", () => {
    renderCard({ globalLayout: defaultPostLayoutSettings(), currentFormat: "standard" });

    expect(screen.getByText("adminPostPanes.layout.livePreview")).toBeInTheDocument();
    const line = screen.getByText(/format: standard/);
    // `standard_layout` domyślnych ustawień to layout-1.
    expect(line).toHaveTextContent("Layout 1 - klasyczny");
    expect(line).toHaveTextContent("adminPostPanes.layout.sourceGlobal");
  });

  it("z nadpisaniem podgląd bierze preset WPISU i mówi, że to nadpisanie", () => {
    renderCard({
      globalLayout: defaultPostLayoutSettings(),
      ov: { layout: "layout-3" },
      currentFormat: "standard",
    });

    const line = screen.getByText(/format: standard/);
    expect(line).toHaveTextContent("Layout 3 - z sidebar");
    expect(line).toHaveTextContent("adminPostPanes.layout.sourceOverride");
    expect(line).not.toHaveTextContent("adminPostPanes.layout.sourceGlobal");
  });

  it("dla wpisu wideo podgląd używa globalnego layoutu WIDEO", () => {
    const global = { ...defaultPostLayoutSettings(), video_layout: "video-3" };
    renderCard({ globalLayout: global, currentFormat: "video" });

    const line = screen.getByText(/format: video/);
    expect(line).toHaveTextContent("Layout 3 - z sidebar");
  });

  it("podaje rekomendowany kadr okładki wybranego presetu", () => {
    renderCard({ globalLayout: defaultPostLayoutSettings(), ov: { layout: "layout-6" } });

    const hint = screen.getByText(/adminPostPanes\.layout\.recommendedImage/);
    // Layout 6 (duży cover) chce kadru pionowego - to jest informacja, po którą
    // redakcja tu przychodzi PRZED wgraniem grafiki.
    expect(hint).toHaveTextContent("1600×2400 px");
    expect(hint).toHaveTextContent("(2:3)");
  });

  it("preset bez rekomendowanego kadru nie wyświetla pustej rekomendacji", () => {
    // Layout 9 nie ma grafiki wyróżniającej, więc nie ma czego rekomendować.
    renderCard({ globalLayout: defaultPostLayoutSettings(), ov: { layout: "layout-9" } });

    expect(screen.queryByText(/adminPostPanes\.layout\.recommendedImage/)).not.toBeInTheDocument();
  });
});

describe("LayoutOverridesCard - trójstan sekcji stopki", () => {
  const FOOTER_KEYS = [
    "fieldCenterHeader",
    "fieldTagsBar",
    "fieldAuthorCard",
    "fieldPrevNext",
    "fieldBottomNewsletter",
    "fieldCitation",
    "fieldQuoteShare",
  ] as const;

  it("wystawia wiersz na każdą sekcję stopki i podpowiedź o działaniu trójstanu", () => {
    renderCard();

    for (const key of FOOTER_KEYS) {
      expect(screen.getByText(`adminPostPanes.layout.${key}`)).toBeInTheDocument();
    }
    expect(screen.getByText("adminPostPanes.layout.footerHint")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "adminPostPanes.layout.triHint" }),
    ).toBeInTheDocument();
  });

  it("sekcja bez nadpisania stoi na dziedziczeniu", () => {
    renderCard({ ov: {} });

    expect(footerSelect("fieldCitation").value).toBe("inherit");
  });

  it("nadpisanie na TAK i na NIE są rozróżnialne (nie zwijają się do jednego stanu)", () => {
    const { unmount } = renderCard({ ov: { show_citation: true } });
    expect(footerSelect("fieldCitation").value).toBe("on");
    unmount();

    renderCard({ ov: { show_citation: false } });
    expect(footerSelect("fieldCitation").value).toBe("off");
  });

  it("nadpisania sekcji są niezależne - jedna włączona nie zmienia pozostałych", () => {
    renderCard({ ov: { show_author_card: false } });

    expect(footerSelect("fieldAuthorCard").value).toBe("off");
    expect(footerSelect("fieldPrevNext").value).toBe("inherit");
    expect(footerSelect("fieldTagsBar").value).toBe("inherit");
  });

  it("włączenie sekcji wysyła łatkę z DOKŁADNIE jednym kluczem", () => {
    const { onOverridesChange } = renderCard();

    fireEvent.change(footerSelect("fieldQuoteShare"), { target: { value: "on" } });

    expect(onOverridesChange).toHaveBeenCalledWith({ show_quote_share: true });
  });

  it("wyłączenie sekcji zapisuje false (świadome wyłączenie, nie dziedziczenie)", () => {
    const { onOverridesChange } = renderCard();

    fireEvent.change(footerSelect("fieldPrevNext"), { target: { value: "off" } });

    expect(onOverridesChange).toHaveBeenCalledWith({ show_prev_next: false });
  });

  it("powrot do ustawien globalnych CZYSCI nadpisanie sekcji", () => {
    const { onOverridesChange } = renderCard({ ov: { center_header: true } });

    fireEvent.change(footerSelect("fieldCenterHeader"), { target: { value: "inherit" } });

    const patch = lastPatch(onOverridesChange);
    expect(Object.keys(patch)).toEqual(["center_header"]);
    expect(patch.center_header).toBeUndefined();
  });

  it("każdy trójstan oferuje wszystkie trzy stany po kluczach i18n", () => {
    renderCard();
    const row = footerSelect("fieldTagsBar");

    expect(Array.from(row.querySelectorAll("option")).map((o) => [o.value, o.textContent])).toEqual(
      [
        ["inherit", "adminPostPanes.layout.triInherit"],
        ["on", "adminPostPanes.layout.triOn"],
        ["off", "adminPostPanes.layout.triOff"],
      ],
    );
  });
});
