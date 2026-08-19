// Trzy droplisty klubu: słownik domknięty CHECK-iem (`ClubEnumSelect`), katalog
// obszarów tematycznych (`ClubTopicSelect`) i katalog specjalizacji
// (`ClubSpecializationSelect`).
//
// CO TEN PLIK DOWODZI.
//  1. WYBÓR EMITUJE DOKŁADNIE TO ID, KTÓRE STOI PRZY KLIKNIĘTEJ ETYKIECIE.
//     Wszystkie trzy droplisty składają opcje w `map()` po tablicy z zewnątrz,
//     więc przestawiona para „etykieta -> wartość” przechodzi przez `tsc`
//     (typ jest ten sam) i przez ekran (etykieta wygląda poprawnie). Dlatego
//     każda opcja jest tu klikana OSOBNO, a asercja porównuje emisję z tą
//     konkretną opcją.
//  2. SENTINEL „BRAK” NIE JEST ZAPISYWANY DO BAZY. Radix nie przyjmuje pustego
//     stringa, więc „bez obszaru”/„bez specjalizacji” jedzie w UI jako `none`
//     / `__none__` - i MUSI wrócić do wołającego jako `null`. Zapisany sentinel
//     byłby obszarem o nazwie „none”, którego nie ma w katalogu.
//  3. WARTOŚĆ WYŁĄCZONA W MIĘDZYCZASIE NIE ZNIKA Z FORMULARZA. Obie droplisty
//     katalogowe dokładają opcję dla wartości spoza listy - bez tego pierwszy
//     zapis edytowanego klubu po cichu skasowałby przypisanie.
//  4. `ClubEnumSelect` ODRZUCA WARTOŚĆ SPOZA SŁOWNIKA. To jedyna reguła tego
//     komponentu, której nie widać w interfejsie: Radix oddaje `string`, więc
//     zawężenie po tablicy jest ostatnią bramką przed CHECK-iem w bazie. Atrapa
//     droplisty ma dlatego JAWNE wyjście awaryjne, którym wypycha wartość spoza
//     `options` - natywnym `<select>` nie da się tego zrobić, bo taka opcja
//     w DOM-ie nie istnieje.
//  5. TRZY STANY DANYCH KATALOGU dla obu droplist czytających RPC: PEŁNY
//     katalog, katalog PUSTY (`data: []` - lista awaryjna albo sam sentinel)
//     i zapytanie W LOCIE / PO AWARII (`data: undefined` -> `?? []`). Do tego
//     stan CZĘŚCIOWY: wartość bieżąca poza katalogiem i wiersz opisany tylko
//     w jednym języku.
//  6. `disabled` REALNIE ODCINA ZMIANĘ, a nie tylko przygasza kontrolkę.
//  7. `id` DOJEŻDŻA NA WYZWALACZ, więc `<Label htmlFor>` wiąże etykietę
//     z kontrolką (asercja przez `getByLabelText`, czyli przez drzewo dostępności).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Reguł czystych funkcji katalogu: `normalizeTopicValue`, `optionsWithCurrent`,
//    `topicLabel` (`src/lib/clubs/__tests__/topics.test.ts`,
//    `clubPureModules.test.ts`) i `buildSpecializationViews`
//    (`specializationPage.test.ts`, `clubPureModules.test.ts`). Tutaj dowodzimy
//    WYŁĄCZNIE tego, że droplista je woła i respektuje wynik.
//  - Warstwy danych (`fetchActiveClubTopics`, `fetchPublicClubSpecializations`)
//    - kontrakt nazw argumentów RPC ma dowód w `src/lib/clubs/__tests__/api.test.ts`
//    i `catalogApi.test.ts`. Tu RPC jest tylko źródłem trzech stanów danych.
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
import { ClubSpecializationSelect } from "@/components/clubs/molecules/ClubSpecializationSelect";
import { CLUB_THREAD_KINDS, type ClubThreadKind } from "@/lib/clubs/types";
import { CLUB_TOPIC_NONE, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { CLUB_SPECIALIZATIONS } from "@/lib/clubs/specializations";
import type { ClubSpecializationRow } from "@/lib/clubs/specializationsApi";
import { clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const NONE_SPEC = "__none__";

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

function specRow(overrides: Partial<ClubSpecializationRow> = {}): ClubSpecializationRow {
  return {
    slug: "energetyka",
    key: "energy",
    label_pl: "Energetyka i klimat",
    label_en: "Energy and climate",
    lead_pl: null,
    lead_en: null,
    desc_pl: null,
    desc_en: null,
    icon: "zap",
    sort_order: 10,
    club_count: 2,
    ...overrides,
  };
}

beforeEach(() => {
  resetClubRpc();
  h.lang = "pl";
  clubRpc.setData("club_topics_active", []);
  clubRpc.setData("club_specializations_public", []);
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

// --- ClubSpecializationSelect ----------------------------------------------

describe("ClubSpecializationSelect", () => {
  function renderSpec(
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
      <ClubSpecializationSelect
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

  it("buduje listę z katalogu organizacji i zaznacza bieżącą specjalizację", async () => {
    clubRpc.setData("club_specializations_public", [
      specRow(),
      specRow({ slug: "transport", key: "transport", label_pl: "Transport", sort_order: 20 }),
    ]);
    renderSpec({ value: "transport" });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, "energetyka", "transport"]);
    });
    expect(option("energetyka")).toHaveTextContent("Energetyka i klimat");
    expect(option("transport")).toHaveAttribute("aria-selected", "true");
  });

  it("wybór specjalizacji emituje jej SLUG, a wybór sentinela - `null`", async () => {
    clubRpc.setData("club_specializations_public", [specRow()]);
    const { onChange } = renderSpec({ value: null });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, "energetyka"]);
    });

    fireEvent.click(option("energetyka"));
    expect(onChange).toHaveBeenNthCalledWith(1, "energetyka");

    fireEvent.click(option(NONE_SPEC));
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });

  it("wartość z samych spacji liczy się jako BRAK specjalizacji", async () => {
    clubRpc.setData("club_specializations_public", [specRow()]);
    renderSpec({ value: "   " });

    await waitFor(() => {
      // Brak dodatkowej opcji dla wartości „pustej”.
      expect(optionValues()).toEqual([NONE_SPEC, "energetyka"]);
    });
    expect(option(NONE_SPEC)).toHaveAttribute("aria-selected", "true");
  });

  it("specjalizacja WYŁĄCZONA w międzyczasie dostaje własną opcję ze swoim slugiem", async () => {
    clubRpc.setData("club_specializations_public", [specRow()]);
    renderSpec({ value: "specjalizacja-wylaczona" });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, "specjalizacja-wylaczona", "energetyka"]);
    });
    const orphan = option("specjalizacja-wylaczona");
    expect(orphan).toHaveTextContent("specjalizacja-wylaczona");
    expect(orphan).toHaveAttribute("aria-selected", "true");
  });

  it("wiersz opisany tylko po polsku ma tytuł także przy interfejsie angielskim", async () => {
    clubRpc.setData("club_specializations_public", [
      specRow({
        slug: "wlasna-specjalizacja",
        key: "wlasna",
        label_pl: "Specjalizacja własna",
        label_en: "",
      }),
    ]);
    h.lang = "en";
    renderSpec({ value: null });

    await waitFor(() => {
      expect(option("wlasna-specjalizacja")).toHaveTextContent("Specjalizacja własna");
    });
  });

  it("katalog PUSTY i AWARIA katalogu degradują do ośmiu specjalizacji systemowych", async () => {
    clubRpc.setData("club_specializations_public", []);
    renderSpec({ value: null });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, ...CLUB_SPECIALIZATIONS.map((spec) => spec.slug)]);
    });

    cleanup();
    clubRpc.setError("club_specializations_public", "test: katalog niedostępny");
    renderSpec({ value: null });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, ...CLUB_SPECIALIZATIONS.map((spec) => spec.slug)]);
    });
  });

  it("`disabled` odcina zmianę", async () => {
    clubRpc.setData("club_specializations_public", [specRow()]);
    const { onChange } = renderSpec({ value: null, disabled: true });

    await waitFor(() => {
      expect(optionValues()).toEqual([NONE_SPEC, "energetyka"]);
    });
    fireEvent.click(option("energetyka"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("etykieta i podpowiedź są opcjonalne - bez nich nie ma ani `<label>`, ani akapitu", () => {
    renderSpec({
      value: null,
      label: "Specjalizacja",
      hint: "Klub bez specjalizacji nie trafi na jej stronę",
      id: "club-spec",
    });

    expect(screen.getByLabelText("Specjalizacja")).toHaveAttribute("id", "club-spec");
    expect(screen.getByText("Klub bez specjalizacji nie trafi na jej stronę")).toBeVisible();

    cleanup();
    renderSpec({ value: null });

    expect(document.querySelector("label")).toBeNull();
    expect(document.querySelector("p")).toBeNull();
  });
});
