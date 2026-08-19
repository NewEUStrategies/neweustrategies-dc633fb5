// Trzy kontrolki zawężające i wybierające: siatka ikon tematu
// (`ClubIconPicker`), wyszukiwanie kotwicy wątku (`ClubAnchorPicker`)
// i zawężenia strumienia (`ClubStreamFilters`).
//
// CO TEN PLIK DOWODZI.
//  1. WYBÓR EMITUJE DOKŁADNIE TO ID, KTÓRE STOI PRZY KLIKNIĘTYM KAFLU. Wszystkie
//     trzy kontrolki budują przyciski w `map()` z domknięciem w JSX-ie, więc
//     przestawiona para „kafel -> wartość” nie wychodzi ani na typach (każdy
//     wariant ma ten sam typ), ani wzrokowo (ikona i etykieta pochodzą z tej
//     samej mapy). Dlatego siatka ikon jest przeklikana KOMPLETNIE, po jednej
//     asercji na każdą nazwę z katalogu, a chipy rodzajów - po jednej na rodzaj.
//  2. PONOWNE KLIKNIĘCIE AKTYWNEGO ZAWĘŻENIA JE ZDEJMUJE (chipy strumienia),
//     a ponowne kliknięcie aktywnej ikony ustawia tę samą ikonę - to dwie różne
//     reguły produktu i obie są tu zapisane wprost.
//  3. SORTOWANIE/FILTR WYMAGAJĄCY SESJI NIE JEST OFEROWANY GOŚCIOWI. Bez sesji
//     „tylko nieprzeczytane” nie ma jak się policzyć (`last_read_at` wołającego),
//     więc przycisku nie ma, a wartość `unreadOnly = true` przyniesiona z adresu
//     NIE liczy się ani do licznika ukrytych zawężeń, ani do stanu „są zawężenia”.
//  4. KOTWICA: próg dwóch znaków, komplet stanów zapytania (W LOCIE, PEŁNE,
//     PUSTE, AWARIA), zawężenie do jednego typu encji oraz DOKŁADNY kształt
//     emisji (`anchorType`/`anchorId`/`label`) - kampania segmentowa buduje
//     z tego regułę, która przy przestawionych polach rozwiązuje się w bazie na
//     zbiór pusty.
//  5. `disabled` REALNIE ODCINA ZMIANĘ, a nie tylko przygasza kontrolkę:
//     wyłączony wyzwalacz nie otwiera siatki ikon, wyłączone pole kotwicy nie
//     uruchamia zapytania, a wyłączony przycisk czyszczenia nie zeruje wyboru.
//  6. WARTOŚĆ USZKODZONA degraduje: ikona spoza katalogu (`normalizeClubThreadIcon`)
//     pokazuje kafel „bez ikony”, a nie gołe `undefined` ani wyjątek.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Katalogu ikon i reguł `normalizeClubThreadIcon` - mają dowód na czystej
//    funkcji (`src/lib/clubs/__tests__/clubPureModules.test.ts`,
//    `clubThreadKindIcon.test.ts`). Tutaj sprawdzamy WYŁĄCZNIE, że picker woła
//    normalizację i respektuje wynik.
//  - Warstwy danych podpowiedzi kotwicy: nazwy argumentów RPC
//    `club_anchor_suggest` i próg dwóch znaków po stronie API mają dowód
//    w `src/lib/clubs/__tests__/api.test.ts` oraz `clubHooks.test.tsx`. Tu RPC
//    jest źródłem czterech stanów zapytania, a asercja na argumentach pilnuje
//    jednego: że ZAWĘŻENIE TYPU podane komponentowi faktycznie dojeżdża do bazy.
//  - Samego debounce'a (`useDebouncedValue`) - ma własny test; tutaj jest
//    zamieniony na przejście wprost, bo test nie wolno oprzeć na zegarze.
//  - Słownika `CLUB_THREAD_KINDS` i `CLUB_THREAD_SORTS` - `clubTypes.test.ts`.
//    Sortowania listy wątków NIE ma w tej kontrolce (zawęża rodzaj i stan, nie
//    porządek), więc reguła `CLUB_THREAD_SORTS_REQUIRING_SESSION` jest tu
//    obecna wyłącznie jako jej odpowiednik dla filtra nieprzeczytanych.
//  - Istnienia kluczy i18n - pilnują bramki słownikowe.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Język interfejsu widziany przez atrapę i18n - przestawialny w teście. */
  lang: "pl",
  /** Zatrzask odpowiedzi RPC - pozwala zobaczyć stan „zapytanie w locie”. */
  gate: null as Promise<void> | null,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.lang);
});

vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));

// Debounce zamieniony na przejście wprost: zegar w teście oznaczałby
// `setTimeout` w asercji, a reguła repozytorium tego zabrania. Samo opóźnienie
// ma własny dowód w teście hooka.
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T): T => value,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { clubSupabaseMock } = await import("@/test/clubs/fixtures");
  return {
    supabase: {
      ...clubSupabaseMock.supabase,
      // Wywołanie zapisuje się NATYCHMIAST, a jego rozwiązanie czeka na
      // zatrzask - tylko tak da się zobaczyć render ze `isFetching === true`.
      rpc: (name: string, args?: Record<string, unknown>) => {
        const result = clubSupabaseMock.supabase.rpc(name, args);
        const gate = h.gate;
        return gate === null ? result : gate.then(() => result);
      },
    },
  };
});

/**
 * Atrapa Radixowego Popovera. Radix pod happy-dom nie otwiera warstwy (wymaga
 * pełnego API wskaźnika i pomiarów układu), a otwarcie jest tu treścią
 * zachowania: dopóki warstwa jest zamknięta, żadnej ikony ani rzadkiego rodzaju
 * NIE da się wybrać. Atrapa obsługuje OBA tryby, bo produkcja używa obu:
 * sterowany (`open` + `onOpenChange` - picker ikony zamyka warstwę po wyborze)
 * i niesterowany (filtry strumienia).
 */
vi.mock("@/components/ui/popover", async () => {
  const react = await import("react");
  const PopoverCtx = react.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({
    open: false,
    setOpen: () => undefined,
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      const [internal, setInternal] = react.useState(false);
      const isOpen = open ?? internal;
      const setOpen = (next: boolean) => {
        if (open === undefined) setInternal(next);
        onOpenChange?.(next);
      };
      return (
        <PopoverCtx.Provider value={{ open: isOpen, setOpen }}>{children}</PopoverCtx.Provider>
      );
    },
    PopoverTrigger: ({
      asChild,
      children,
      ...rest
    }: {
      asChild?: boolean;
      children?: ReactNode;
      className?: string;
      "aria-label"?: string;
    }) => {
      const ctx = react.useContext(PopoverCtx);
      const toggle = () => ctx.setOpen(!ctx.open);
      // `asChild` w produkcji dostaje przycisk BEZ własnego `onClick`, więc
      // dopisanie wyzwalacza niczego nie nadpisuje - w tym miejscu Radix robi
      // dokładnie to samo.
      if (asChild === true && react.isValidElement<{ onClick?: () => void }>(children)) {
        return react.cloneElement(children, { onClick: toggle });
      }
      return (
        <button type="button" {...rest} onClick={toggle}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(PopoverCtx);
      return ctx.open ? <div data-testid="popover-content">{children}</div> : null;
    },
  };
});

import { ClubIconPicker } from "@/components/clubs/molecules/ClubIconPicker";
import {
  ClubAnchorPicker,
  type ClubAnchorValue,
} from "@/components/clubs/molecules/ClubAnchorPicker";
import { ClubStreamFilters } from "@/components/clubs/molecules/ClubStreamFilters";
import { CLUB_THREAD_ICON_GROUPS, CLUB_THREAD_ICONS } from "@/lib/clubs/threadIcons";
import {
  CLUB_THREAD_KINDS,
  type ClubAnchorSuggestion,
  type ClubThreadKind,
} from "@/lib/clubs/types";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { clubRpc, resetClubRpc } from "@/test/clubs/fixtures";

beforeEach(() => {
  resetClubRpc();
  h.lang = "pl";
  h.gate = null;
});

afterEach(() => {
  cleanup();
});

// --- ClubIconPicker ---------------------------------------------------------

describe("ClubIconPicker", () => {
  function renderPicker(over: { value?: string | null; disabled?: boolean; id?: string } = {}) {
    const onChange = vi.fn<(icon: string | null) => void>();
    renderWithQueryClient(
      <ClubIconPicker
        value={over.value ?? null}
        onChange={onChange}
        disabled={over.disabled}
        id={over.id}
      />,
    );
    return { onChange, trigger: screen.getByTestId("club-icon-trigger") };
  }

  it("startuje ZAMKNIĘTY i pokazuje na wyzwalaczu, że ikony nie ma", () => {
    const { trigger } = renderPicker({ id: "club-icon" });

    expect(trigger).toHaveAttribute("aria-label", "club.iconPicker.label");
    expect(trigger).toHaveAttribute("id", "club-icon");
    expect(trigger).toHaveTextContent("club.iconPicker.none");
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("pokazuje nazwę WYBRANEJ ikony na wyzwalaczu", () => {
    const { trigger } = renderPicker({ value: "gavel" });

    expect(trigger).toHaveTextContent("gavel");
  });

  it("ikona SPOZA katalogu degraduje do „bez ikony”, a nie do wyjątku", () => {
    const { trigger } = renderPicker({ value: "helikopter-bojowy" });

    expect(trigger).toHaveTextContent("club.iconPicker.none");
    expect(trigger).not.toHaveTextContent("helikopter-bojowy");
  });

  it("otwarcie pokazuje WSZYSTKIE grupy katalogu z ich nagłówkami i kompletem kafli", () => {
    const { trigger } = renderPicker();

    fireEvent.click(trigger);

    CLUB_THREAD_ICON_GROUPS.forEach((group) => {
      expect(screen.getByText(group.labelKey)).toBeVisible();
    });
    // Kolejność kafli to kolejność katalogu, a „bez ikony” stoi PRZED siatką -
    // pusty wybór jest pierwszą opcją, nie ukrytym przyciskiem czyszczenia.
    expect(
      screen.getAllByTestId(/^club-icon-/).map((tile) => tile.getAttribute("data-testid")),
    ).toEqual([
      "club-icon-trigger",
      "club-icon-none",
      ...CLUB_THREAD_ICONS.map((icon) => `club-icon-${icon}`),
    ]);
  });

  it.each(CLUB_THREAD_ICONS)("kafel „%s” emituje DOKŁADNIE tę nazwę i zamyka warstwę", (icon) => {
    const { onChange, trigger } = renderPicker();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId(`club-icon-${icon}`));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(icon);
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("kafel „bez ikony” emituje `null` i zamyka warstwę", () => {
    const { onChange, trigger } = renderPicker({ value: "gavel" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId("club-icon-none"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("zaznacza DOKŁADNIE wybraną ikonę - pozostałe kafle nie są wciśnięte", () => {
    const { trigger } = renderPicker({ value: "scale" });
    fireEvent.click(trigger);

    expect(screen.getByTestId("club-icon-scale")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("club-icon-gavel")).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getAllByRole("button", { pressed: true }).map((el) => el.getAttribute("aria-label")),
    ).toEqual(["scale"]);
  });

  it("ponowne kliknięcie AKTYWNEJ ikony emituje tę samą nazwę - kafel nie jest przełącznikiem", () => {
    const { onChange, trigger } = renderPicker({ value: "gavel" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId("club-icon-gavel"));

    expect(onChange).toHaveBeenCalledWith("gavel");
  });

  it("`disabled` nie pozwala nawet OTWORZYĆ siatki", () => {
    const { onChange, trigger } = renderPicker({ disabled: true });

    fireEvent.click(trigger);

    expect(trigger).toBeDisabled();
    expect(screen.queryByTestId("popover-content")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --- ClubAnchorPicker -------------------------------------------------------

describe("ClubAnchorPicker - kotwica wybrana", () => {
  const VALUE: ClubAnchorValue = {
    anchorType: "eu_policy_item",
    anchorId: "policy-42",
    label: "Rozporządzenie o rynku energii",
  };

  function renderSelected(over: { disabled?: boolean; fieldLabel?: string } = {}) {
    const onChange = vi.fn<(value: ClubAnchorValue | null) => void>();
    renderWithQueryClient(
      <ClubAnchorPicker
        value={VALUE}
        onChange={onChange}
        disabled={over.disabled}
        fieldLabel={over.fieldLabel}
      />,
    );
    return { onChange };
  }

  it("pokazuje TYP i etykietę kotwicy, a pola wyszukiwania już nie", () => {
    renderSelected();

    expect(screen.getByText("club.anchorType.eu_policy_item")).toBeVisible();
    expect(screen.getByText(VALUE.label)).toBeVisible();
    expect(screen.getByText("club.anchorPicker.label")).toBeVisible();
    expect(screen.queryByPlaceholderText("club.anchorPicker.placeholder")).toBeNull();
  });

  it("etykietę pola można NADPISAĆ - kampania mówi o regule, nie o kotwicy", () => {
    renderSelected({ fieldLabel: "Reguła segmentu" });

    expect(screen.getByText("Reguła segmentu")).toBeVisible();
    expect(screen.queryByText("club.anchorPicker.label")).toBeNull();
  });

  it("czyszczenie emituje `null`", () => {
    const { onChange } = renderSelected();

    fireEvent.click(screen.getByRole("button", { name: "club.anchorPicker.clear" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("`disabled` odcina czyszczenie", () => {
    const { onChange } = renderSelected({ disabled: true });

    const clear = screen.getByRole("button", { name: "club.anchorPicker.clear" });
    fireEvent.click(clear);

    expect(clear).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("z wybraną kotwicą NIE pyta bazy o podpowiedzi", () => {
    renderSelected();

    expect(clubRpc.callsFor("club_anchor_suggest")).toHaveLength(0);
  });
});

describe("ClubAnchorPicker - wyszukiwanie", () => {
  function suggestion(overrides: Partial<ClubAnchorSuggestion> = {}): ClubAnchorSuggestion {
    return {
      anchor_id: "policy-42",
      anchor_type: "eu_policy_item",
      hint: "2024/0134(COD)",
      label_pl: "Rozporządzenie o rynku energii",
      label_en: "Energy market regulation",
      ...overrides,
    };
  }

  function renderSearch(
    over: { disabled?: boolean; anchorType?: "eu_policy_item" | "event" | null } = {},
  ) {
    const onChange = vi.fn<(value: ClubAnchorValue | null) => void>();
    const view = renderWithQueryClient(
      <ClubAnchorPicker
        value={null}
        onChange={onChange}
        disabled={over.disabled}
        anchorType={over.anchorType}
      />,
    );
    return { onChange, view, input: screen.getByLabelText("club.anchorPicker.label") };
  }

  it("PONIŻEJ progu dwóch znaków nie pyta bazy i nie pokazuje ani listy, ani pustki", () => {
    clubRpc.setData("club_anchor_suggest", [suggestion()]);
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: "e" } });

    expect(clubRpc.callsFor("club_anchor_suggest")).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("club.anchorPicker.empty")).toBeNull();
    expect(screen.getByText("club.anchorPicker.hint")).toBeVisible();
  });

  it("od dwóch znaków pyta bazę PRZYCIĘTYM zapytaniem i pokazuje podpowiedzi", async () => {
    clubRpc.setData("club_anchor_suggest", [
      suggestion(),
      suggestion({ anchor_id: "event-7", anchor_type: "event", label_pl: "Debata o sieciach" }),
    ]);
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: "  energ  " } });

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    expect(clubRpc.lastCall("club_anchor_suggest")?.arg("p_query")).toBe("energ");
    expect(screen.getByText("Rozporządzenie o rynku energii")).toBeVisible();
    expect(screen.getByText("club.anchorType.event")).toBeVisible();
  });

  it("wybór podpowiedzi emituje DOKŁADNIE typ, identyfikator i etykietę wiersza", async () => {
    clubRpc.setData("club_anchor_suggest", [suggestion()]);
    const { input, onChange } = renderSearch();

    fireEvent.change(input, { target: { value: "energ" } });
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: /Rozporządzenie o rynku energii/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      anchorType: "eu_policy_item",
      anchorId: "policy-42",
      label: "Rozporządzenie o rynku energii",
    });
  });

  it("etykieta podpowiedzi idzie za językiem TREŚCI, a pusta sięga po drugi język", async () => {
    clubRpc.setData("club_anchor_suggest", [
      suggestion(),
      suggestion({ anchor_id: "policy-77", label_en: "   ", label_pl: "Tylko po polsku" }),
    ]);
    h.lang = "en";
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: "energ" } });

    await waitFor(() => {
      expect(screen.getByText("Energy market regulation")).toBeVisible();
    });
    // Etykieta z samych spacji liczy się jako pusta - stąd polski tytuł
    // zamiast białej plamy na liście wyboru.
    expect(screen.getByText("Tylko po polsku")).toBeVisible();
  });

  it("ZAWĘŻENIE do jednego typu encji dojeżdża do bazy", async () => {
    clubRpc.setData("club_anchor_suggest", [suggestion()]);
    const { input } = renderSearch({ anchorType: "event" });

    fireEvent.change(input, { target: { value: "debata" } });

    await waitFor(() => {
      expect(clubRpc.callsFor("club_anchor_suggest")).toHaveLength(1);
    });
    expect(clubRpc.lastCall("club_anchor_suggest")?.arg("p_anchor_type")).toBe("event");
  });

  it("zapytanie W LOCIE pokazuje kręciołek i NIE ogłasza pustki", async () => {
    let release: () => void = () => undefined;
    h.gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    clubRpc.setData("club_anchor_suggest", [suggestion()]);
    const { input, view } = renderSearch();

    fireEvent.change(input, { target: { value: "energ" } });

    await waitFor(() => {
      expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    });
    expect(screen.queryByText("club.anchorPicker.empty")).toBeNull();

    release();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });

  it("PUSTA odpowiedź ogłasza brak podpowiedzi zamiast pustej listy", async () => {
    clubRpc.setData("club_anchor_suggest", []);
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: "xyz" } });

    await waitFor(() => {
      expect(screen.getByText("club.anchorPicker.empty")).toBeVisible();
    });
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("AWARIA zapytania degraduje do komunikatu o braku, a nie do wyjątku", async () => {
    clubRpc.setError("club_anchor_suggest", "test: podpowiedzi niedostępne");
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: "energ" } });

    await waitFor(() => {
      expect(screen.getByText("club.anchorPicker.empty")).toBeVisible();
    });
  });

  it("`disabled` blokuje pole i nie uruchamia zapytania", () => {
    clubRpc.setData("club_anchor_suggest", [suggestion()]);
    const { input } = renderSearch({ disabled: true });

    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "energ" } });

    expect(clubRpc.callsFor("club_anchor_suggest")).toHaveLength(0);
  });
});

// --- ClubStreamFilters ------------------------------------------------------

describe("ClubStreamFilters", () => {
  const PRIMARY: ReadonlyArray<ClubThreadKind> = ["discussion", "question", "position"];
  const SECONDARY = CLUB_THREAD_KINDS.filter((kind) => !PRIMARY.includes(kind));

  function renderFilters(
    over: {
      kind?: ClubThreadKind | null;
      anchoredOnly?: boolean;
      unreadOnly?: boolean;
      canFilterUnread?: boolean;
      className?: string;
    } = {},
  ) {
    const onKindChange = vi.fn<(next: ClubThreadKind | null) => void>();
    const onAnchoredOnlyChange = vi.fn<(next: boolean) => void>();
    const onUnreadOnlyChange = vi.fn<(next: boolean) => void>();
    renderWithQueryClient(
      <ClubStreamFilters
        kind={over.kind ?? null}
        onKindChange={onKindChange}
        anchoredOnly={over.anchoredOnly ?? false}
        onAnchoredOnlyChange={onAnchoredOnlyChange}
        unreadOnly={over.unreadOnly ?? false}
        onUnreadOnlyChange={onUnreadOnlyChange}
        canFilterUnread={over.canFilterUnread ?? true}
        className={over.className}
      />,
    );
    return { onKindChange, onAnchoredOnlyChange, onUnreadOnlyChange };
  }

  /** Otwiera warstwę „Więcej” - rzadkie rodzaje i przełączniki stanu żyją tam. */
  function openMore(): void {
    fireEvent.click(screen.getByRole("button", { name: "club.filters.moreLabel" }));
  }

  it("jest grupą z etykietą i podaje własną klasę dalej", () => {
    renderFilters({ className: "mt-4" });

    const group = screen.getByRole("group", { name: "club.kind.label" });
    expect(group).toHaveClass("mt-4");
  });

  it("bez zawężenia wciśnięty jest chip „wszystkie”, a przycisku czyszczenia nie ma", () => {
    renderFilters();

    expect(screen.getByRole("button", { name: "club.allKinds" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "club.filters.clear" })).toBeNull();
  });

  it("chip „wszystkie” emituje `null` także wtedy, gdy zawężenie było ustawione", () => {
    const { onKindChange } = renderFilters({ kind: "question" });

    fireEvent.click(screen.getByRole("button", { name: "club.allKinds" }));

    expect(onKindChange).toHaveBeenCalledTimes(1);
    expect(onKindChange).toHaveBeenCalledWith(null);
  });

  it.each(PRIMARY)("chip rodzaju „%s” emituje DOKŁADNIE ten rodzaj", (kind) => {
    const { onKindChange } = renderFilters();

    fireEvent.click(screen.getByRole("button", { name: `club.kind.${kind}` }));

    expect(onKindChange).toHaveBeenCalledTimes(1);
    expect(onKindChange).toHaveBeenCalledWith(kind);
  });

  it.each(PRIMARY)("ponowne kliknięcie AKTYWNEGO rodzaju „%s” zdejmuje zawężenie", (kind) => {
    const { onKindChange } = renderFilters({ kind });

    const chip = screen.getByRole("button", { name: `club.kind.${kind}` });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);

    expect(onKindChange).toHaveBeenCalledWith(null);
  });

  it("rzadkie rodzaje NIE stoją na wierzchu - dopiero warstwa „Więcej” je pokazuje", () => {
    renderFilters();

    SECONDARY.forEach((kind) => {
      expect(screen.queryByRole("button", { name: `club.kind.${kind}` })).toBeNull();
    });

    openMore();

    expect(screen.getByText("club.filters.kindHeading")).toBeVisible();
    expect(screen.getByText("club.filters.stateHeading")).toBeVisible();
    SECONDARY.forEach((kind) => {
      expect(screen.getByRole("button", { name: `club.kind.${kind}` })).toBeVisible();
    });
  });

  it.each(SECONDARY)(
    "rzadki rodzaj „%s” emituje DOKŁADNIE ten rodzaj, a aktywny zdejmuje",
    (kind) => {
      const first = renderFilters();
      openMore();

      fireEvent.click(screen.getByRole("button", { name: `club.kind.${kind}` }));
      expect(first.onKindChange).toHaveBeenCalledTimes(1);
      expect(first.onKindChange).toHaveBeenCalledWith(kind);

      cleanup();
      const second = renderFilters({ kind });
      openMore();

      const active = screen.getByRole("button", { name: `club.kind.${kind}` });
      expect(active).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(active);
      expect(second.onKindChange).toHaveBeenCalledWith(null);
    },
  );

  it("przełącznik kotwicy przestawia się w OBIE strony", () => {
    const off = renderFilters();
    openMore();
    fireEvent.click(screen.getByRole("button", { name: "club.filters.anchorOnly" }));
    expect(off.onAnchoredOnlyChange).toHaveBeenCalledWith(true);

    cleanup();
    const on = renderFilters({ anchoredOnly: true });
    openMore();
    const active = screen.getByRole("button", { name: "club.filters.anchorOnly" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(on.onAnchoredOnlyChange).toHaveBeenCalledWith(false);
  });

  it("przełącznik nieprzeczytanych przestawia się w OBIE strony, gdy jest sesja", () => {
    const off = renderFilters({ canFilterUnread: true });
    openMore();
    fireEvent.click(screen.getByRole("button", { name: "club.filters.unreadOnly" }));
    expect(off.onUnreadOnlyChange).toHaveBeenCalledWith(true);

    cleanup();
    const on = renderFilters({ canFilterUnread: true, unreadOnly: true });
    openMore();
    const active = screen.getByRole("button", { name: "club.filters.unreadOnly" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(on.onUnreadOnlyChange).toHaveBeenCalledWith(false);
  });

  it("GOŚĆ nie dostaje filtra nieprzeczytanych ani śladu po nim w liczniku i w czyszczeniu", () => {
    renderFilters({ canFilterUnread: false, unreadOnly: true });

    expect(screen.queryByRole("button", { name: "club.filters.clear" })).toBeNull();
    openMore();

    expect(screen.queryByRole("button", { name: "club.filters.unreadOnly" })).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
  });

  it("licznik ukrytych zawężeń liczy rzadki rodzaj i OBA przełączniki stanu", () => {
    renderFilters({ kind: "poll", anchoredOnly: true, unreadOnly: true, canFilterUnread: true });

    const more = screen.getByRole("button", { name: "club.filters.moreLabel" });
    expect(more).toHaveTextContent("3");
    // Ukryte zawężenie nie może działać po cichu - wyzwalacz jest zapalony.
    expect(more.className).toContain("border-primary/40");
  });

  it("zawężenie WIDOCZNE na wierzchu nie podbija licznika warstwy „Więcej”", () => {
    renderFilters({ kind: "discussion" });

    const more = screen.getByRole("button", { name: "club.filters.moreLabel" });
    expect(more).not.toHaveTextContent("1");
    expect(more.className).toContain("border-border/60");
  });

  it("czyszczenie z warstwy „Więcej” zeruje WSZYSTKIE trzy zawężenia", () => {
    const handlers = renderFilters({ kind: "poll", anchoredOnly: true, unreadOnly: true });
    openMore();

    // W warstwie i na wierzchu stoją dwa równoważne przyciski czyszczenia.
    const [inLayer] = screen.getAllByRole("button", { name: "club.filters.clear" });
    fireEvent.click(inLayer);

    expect(handlers.onKindChange).toHaveBeenCalledWith(null);
    expect(handlers.onAnchoredOnlyChange).toHaveBeenCalledWith(false);
    expect(handlers.onUnreadOnlyChange).toHaveBeenCalledWith(false);
  });

  it("chip czyszczenia obok filtrów zeruje WSZYSTKIE trzy zawężenia", () => {
    const handlers = renderFilters({ anchoredOnly: true });

    fireEvent.click(screen.getByRole("button", { name: "club.filters.clear" }));

    expect(handlers.onKindChange).toHaveBeenCalledWith(null);
    expect(handlers.onAnchoredOnlyChange).toHaveBeenCalledWith(false);
    expect(handlers.onUnreadOnlyChange).toHaveBeenCalledWith(false);
  });
});
