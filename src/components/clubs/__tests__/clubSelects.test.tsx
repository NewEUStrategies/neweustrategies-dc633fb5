// Dwie droplisty klubu: słownik domknięty CHECK-iem (`ClubEnumSelect`)
// i katalog obszarów tematycznych (`ClubTopicSelect`).
//
// CO TEN PLIK DOWODZI.
//  1. WYBÓR EMITUJE DOKŁADNIE TO ID, KTÓRE STOI PRZY KLIKNIĘTEJ ETYKIECIE.
//     Obie droplisty składają opcje w `map()` po tablicy z zewnątrz, więc
//     przestawiona para „etykieta -> wartość” przechodzi przez `tsc`
//     (typ jest ten sam) i przez ekran (etykieta wygląda poprawnie). Dlatego
//     każda opcja jest tu klikana OSOBNO, a asercja porównuje emisję z tą
//     konkretną opcją.
//  2. SENTINEL „BRAK” NIE JEST ZAPISYWANY DO BAZY. Radix nie przyjmuje pustego
//     stringa, więc „bez obszaru” jedzie w UI jako `none` - i MUSI wrócić
//     do wołającego jako `null`. Zapisany sentinel byłby obszarem o nazwie
//     „none”, którego nie ma w katalogu.
//  3. WARTOŚĆ WYŁĄCZONA W MIĘDZYCZASIE NIE ZNIKA Z FORMULARZA. Droplista
//     katalogowa dokłada opcję dla wartości spoza listy - bez tego pierwszy
//     zapis edytowanego klubu po cichu skasowałby przypisanie.
//  4. `ClubEnumSelect` ODRZUCA WARTOŚĆ SPOZA SŁOWNIKA. To jedyna reguła tego
//     komponentu, której nie widać w interfejsie: Radix oddaje `string`, więc
//     zawężenie po tablicy jest ostatnią bramką przed CHECK-iem w bazie. Atrapa
//     droplisty ma dlatego JAWNE wyjście awaryjne, którym wypycha wartość spoza
//     `options` - natywnym `<select>` nie da się tego zrobić, bo taka opcja
//     w DOM-ie nie istnieje.
//  5. TRZY STANY DANYCH KATALOGU dla droplisty czytającej RPC: PEŁNY
//     katalog, katalog PUSTY (`data: []` - sam sentinel) i zapytanie W LOCIE
//     / PO AWARII (`data: undefined` -> `?? []`, lista awaryjna). Do tego
//     stan CZĘŚCIOWY: wartość bieżąca poza katalogiem.
//  6. `disabled` REALNIE ODCINA ZMIANĘ, a nie tylko przygasza kontrolkę.
//  7. `id` DOJEŻDŻA NA WYZWALACZ, więc `<Label htmlFor>` wiąże etykietę
//     z kontrolką (asercja przez `getByLabelText`, czyli przez drzewo dostępności).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Reguł czystych funkcji katalogu: `normalizeTopicValue`, `optionsWithCurrent`,
//    `topicLabel` (`src/lib/clubs/__tests__/topics.test.ts`,
//    `clubPureModules.test.ts`). Tutaj dowodzimy WYŁĄCZNIE tego, że droplista
//    je woła i respektuje wynik.
//  - Warstwy danych (`fetchActiveClubTopics`) - kontrakt nazw argumentów RPC
//    ma dowód w `src/lib/clubs/__tests__/api.test.ts` i `catalogApi.test.ts`.
//    Tu RPC jest tylko źródłem trzech stanów danych.
//  - Radixowej warstwy rozwijanej - nie działa pod happy-dom i żadna asercja
//    tego pliku jej nie dotyczy.
//  - Istnienia kluczy i18n - pilnują bramki słownikowe.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Język interfejsu widziany przez atrapę i18n - przestawialny w teście. */
  lang: "pl",
  /**
   * Wartość, którą atrapa droplisty potrafi wypchnąć POZA tablicą `options`.
   * Odwzorowuje realne zachowanie Radixa (oddaje `string`, nie wariant enuma).
   */
  foreign: "wartosc-spoza-slownika",
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.lang);
});

vi.mock("@/integrations/supabase/client", async () => {
  const { clubSupabaseMock } = await import("@/test/clubs/fixtures");
  return clubSupabaseMock;
});

/**
 * Atrapa Radixowej droplisty. Opcja jest PRZYCISKIEM z rolą `option`, więc
 * wybór odbywa się przez kliknięcie DOKŁADNIE tej opcji (a nie przez ustawienie
 * `value` natywnego `<select>`, gdzie test musiałby znać wartość z góry).
 * `id` z wyzwalacza zostaje na przycisku, żeby `<Label htmlFor>` dalej wiązał
 * etykietę. Wyjście awaryjne `select-emit-foreign` istnieje dla jednej reguły,
 * której inaczej nie da się dosięgnąć - patrz punkt 4 w nagłówku.
 */
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  interface SelectState {
    value?: string;
    disabled?: boolean;
    onValueChange?: (next: string) => void;
  }
  const SelectCtx = react.createContext<SelectState>({});
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: SelectState & { children?: ReactNode }) => (
      <SelectCtx.Provider value={{ value, onValueChange, disabled }}>
        {children}
        <button
          type="button"
          data-testid="select-emit-foreign"
          disabled={disabled === true}
          onClick={() => onValueChange?.(h.foreign)}
        >
          {h.foreign}
        </button>
      </SelectCtx.Provider>
    ),
    SelectTrigger: ({ id, children }: { id?: string; children?: ReactNode }) => (
      <button type="button" id={id} data-testid="select-trigger">
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const ctx = react.useContext(SelectCtx);
      return <span data-testid="select-value">{ctx.value ?? placeholder ?? ""}</span>;
    },
    SelectContent: ({ children }: { children?: ReactNode }) => <div role="listbox">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => {
      const ctx = react.useContext(SelectCtx);
      return (
        <button
          type="button"
          role="option"
          data-value={value}
          aria-selected={ctx.value === value}
          disabled={ctx.disabled === true}
          onClick={() => ctx.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { CLUB_THREAD_KINDS, type ClubThreadKind } from "@/lib/clubs/types";
import { CLUB_TOPIC_NONE, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

/** Opcja po wartości technicznej - to ONA jedzie do bazy, nie etykieta. */
function option(value: string): HTMLElement {
  const found = screen
    .getAllByRole("option")
    .find((element) => element.getAttribute("data-value") === value);
  if (found === undefined) throw new Error(`test: brak opcji o wartości "${value}"`);
  return found;
}

function optionValues(): string[] {
  return screen.getAllByRole("option").map((element) => element.getAttribute("data-value") ?? "");
}

function topicRow(overrides: Partial<ClubTopicOption> = {}): ClubTopicOption {
  return {
    key: "energy",
    label_pl: "Energetyka",
    label_en: "Energy",
    sort_order: 10,
    ...overrides,
  };
}

beforeEach(() => {
  resetClubRpc();
  h.lang = "pl";
  clubRpc.setData("club_topics_active", []);
});

afterEach(() => {
  cleanup();
});

// --- ClubEnumSelect ---------------------------------------------------------

describe("ClubEnumSelect", () => {
  function renderEnum(
    over: {
      value?: ClubThreadKind;
      options?: readonly ClubThreadKind[];
      label?: string;
      hintPrefix?: string;
      disabled?: boolean;
      id?: string;
    } = {},
  ) {
    const onChange = vi.fn<(value: ClubThreadKind) => void>();
    renderWithQueryClient(
      <ClubEnumSelect<ClubThreadKind>
        label={over.label}
        value={over.value ?? "discussion"}
        options={over.options ?? CLUB_THREAD_KINDS}
        i18nPrefix="club.kind"
        hintPrefix={over.hintPrefix}
        onChange={onChange}
        disabled={over.disabled}
        id={over.id}
      />,
    );
    return { onChange };
  }

  it("renderuje etykietę KAŻDEGO wariantu słownika jako klucz i18n", () => {
    renderEnum();

    expect(optionValues()).toEqual([...CLUB_THREAD_KINDS]);
    CLUB_THREAD_KINDS.forEach((kind) => {
      expect(option(kind)).toHaveTextContent(`club.kind.${kind}`);
    });
  });

  it.each(CLUB_THREAD_KINDS)("wybór opcji „%s” emituje DOKŁADNIE ten wariant", (kind) => {
    const { onChange } = renderEnum();

    fireEvent.click(option(kind));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(kind);
  });

  it("zaznacza bieżącą wartość i tylko ją", () => {
    renderEnum({ value: "position" });

    expect(option("position")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getAllByRole("option").filter((el) => el.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });

  it("wartość SPOZA słownika nie dochodzi do wołającego - zawężenie po tablicy jest bramką", () => {
    const { onChange } = renderEnum({ options: ["discussion", "question"] });

    fireEvent.click(screen.getByTestId("select-emit-foreign"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("`disabled` odcina zmianę, a nie tylko przygasza kontrolkę", () => {
    const { onChange } = renderEnum({ disabled: true });

    fireEvent.click(option("question"));
    fireEvent.click(screen.getByTestId("select-emit-foreign"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("podpowiedź powstaje z prefiksu I BIEŻĄCEJ wartości, a bez prefiksu jej nie ma", () => {
    renderEnum({ value: "poll", hintPrefix: "club.kindHint" });

    expect(screen.getByText("club.kindHint.poll")).toBeVisible();

    cleanup();
    renderEnum({ value: "poll" });

    expect(screen.queryByText("club.kindHint.poll")).toBeNull();
  });

  it("etykieta jest opcjonalna: podana wiąże się z wyzwalaczem przez `id`, pusta nie renderuje `<label>`", () => {
    renderEnum({ label: "Rodzaj wątku", id: "club-kind" });

    expect(screen.getByLabelText("Rodzaj wątku")).toHaveAttribute("id", "club-kind");

    cleanup();
    // Pusty napis jest fałszywy - `label ?` ma go potraktować jak brak etykiety.
    renderEnum({ label: "", id: "club-kind" });

    expect(screen.queryByText("Rodzaj wątku")).toBeNull();
    expect(document.querySelector("label")).toBeNull();
  });

  it("słownik JEDNOELEMENTOWY i PUSTY renderują się bez wyjątku", () => {
    renderEnum({ options: ["discussion"] });
    expect(optionValues()).toEqual(["discussion"]);

    cleanup();
    renderEnum({ options: [] });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

// --- ClubTopicSelect --------------------------------------------------------

describe("ClubTopicSelect", () => {
  function renderTopic(
    over: {
      value?: string | null;
      label?: string;
      hint?: string;
      disabled?: boolean;
      id?: string;
    } = {},
  ) {
    const onChange = vi.fn<(value: string | null) => void>();
    renderWithQueryClient(
      <ClubTopicSelect
        id={over.id}
        label={over.label}
        hint={over.hint}
        value={over.value ?? null}
        onChange={onChange}
        disabled={over.disabled}
      />,
    );
    return { onChange };
  }

  it("dokłada sentinel „bez obszaru” PRZED katalogiem i zaznacza go dla wartości pustej", async () => {
    clubRpc.setData("club_topics_active", [
      topicRow({ key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 }),
      topicRow(),
    ]);
    renderTopic({ value: "   " });

    await waitFor(() => {
      // Kolejność z `sortTopics`: `sort_order`, a nie kolejność z RPC.
      expect(optionValues()).toEqual([CLUB_TOPIC_NONE, "energy", "transport"]);
    });
    expect(option(CLUB_TOPIC_NONE)).toHaveAttribute("aria-selected", "true");
  });

  it("wybór obszaru emituje jego KLUCZ, a wybór sentinela - `null`", async () => {
    clubRpc.setData("club_topics_active", [topicRow()]);
    const { onChange } = renderTopic({ value: null });

    await waitFor(() => {
      expect(optionValues()).toEqual([CLUB_TOPIC_NONE, "energy"]);
    });

    fireEvent.click(option("energy"));
    expect(onChange).toHaveBeenNthCalledWith(1, "energy");

    fireEvent.click(option(CLUB_TOPIC_NONE));
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });

  it("etykieta opcji idzie za JĘZYKIEM interfejsu", async () => {
    clubRpc.setData("club_topics_active", [topicRow()]);
    h.lang = "en-GB";
    renderTopic({ value: "energy" });

    await waitFor(() => {
      expect(option("energy")).toHaveTextContent("Energy");
    });
    expect(option("energy")).toHaveAttribute("aria-selected", "true");
  });

  it("obszar WYŁĄCZONY w międzyczasie wraca do listy - zapis nie kasuje przypisania", async () => {
    clubRpc.setData("club_topics_active", [topicRow()]);
    renderTopic({ value: "cybersecurity" });

    await waitFor(() => {
      expect(optionValues()).toEqual([CLUB_TOPIC_NONE, "energy", "cybersecurity"]);
    });
    expect(option("cybersecurity")).toHaveAttribute("aria-selected", "true");
  });

  it("katalog PUSTY zostawia sam sentinel", async () => {
    clubRpc.setData("club_topics_active", []);
    renderTopic({ value: null });

    await waitFor(() => {
      expect(optionValues()).toEqual([CLUB_TOPIC_NONE]);
    });
  });

  it("AWARIA katalogu degraduje do listy awaryjnej, a nie do pustej droplisty", async () => {
    clubRpc.setError("club_topics_active", "test: katalog niedostępny");
    renderTopic({ value: null });

    await waitFor(() => {
      // Lista awaryjna z `CLUB_TOPIC_FALLBACK` - select nigdy nie jest pusty.
      expect(optionValues()).toContain("energy");
    });
    expect(optionValues()).toContain("geopolitics");
  });

  it("`disabled` odcina zmianę", async () => {
    clubRpc.setData("club_topics_active", [topicRow()]);
    const { onChange } = renderTopic({ value: null, disabled: true });

    await waitFor(() => {
      expect(optionValues()).toEqual([CLUB_TOPIC_NONE, "energy"]);
    });
    fireEvent.click(option("energy"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("etykieta i podpowiedź są opcjonalne - bez nich nie ma ani `<label>`, ani akapitu", () => {
    renderTopic({ value: null, label: "Obszar", hint: "Jeden obszar na wątek", id: "club-topic" });

    expect(screen.getByLabelText("Obszar")).toHaveAttribute("id", "club-topic");
    expect(screen.getByText("Jeden obszar na wątek")).toBeVisible();

    cleanup();
    renderTopic({ value: null });

    expect(document.querySelector("label")).toBeNull();
    expect(document.querySelector("p")).toBeNull();
  });
});
