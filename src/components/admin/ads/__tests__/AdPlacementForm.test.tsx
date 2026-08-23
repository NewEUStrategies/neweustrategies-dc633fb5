// Organizm formularza pozycji: O CO panel pyta i CO oddaje jako draft pozycji.
//
// CO TEN PLIK DOWODZI.
//   1. LISTY POZYCJI I TYPÓW STRONY POKRYWAJĄ CAŁE UNIE (`AdPosition`,
//      `AdPageType`) i ŻADNA opcja nie jest pusta. Nowy wariant dodany w typach
//      bez etykiety w słowniku daje PUSTY WPIS W SELEKCIE - administrator wybiera
//      wtedy pozycję, której nie umie nazwać, a tsc jest zadowolony.
//   2. LISTA SLOTÓW PRZYCHODZI PROPSEM i pusta lista NIE blokuje formularza -
//      za brak wyboru odpowiada bramka zapisu w panelu, nie widok.
//   3. DATA KOŃCA DZIEDZICZY GRANICĘ Z DATY STARTU (`minDate`), więc panel nie
//      pozwala zbudować pozycji, która kończy się przed początkiem. Brak startu
//      = brak granicy.
//   4. OBA PUSTE PIKI MÓWIĄ, CO ZNACZY PUSTKA („od razu" / „bezterminowo").
//      Pusty pik bez tekstu zastępczego czytałby się jak „nie ustawiono", a to
//      DWIE różne rzeczy dla emisji.
//   5. ZMIANA POZYCJI PRZEŁĄCZA ZESTAW PÓL KONFIGURACJI, a wpisana wartość
//      DOKLEJA SIĘ do `config` (nie podmienia całego obiektu).
//   6. SORTOWANIE JEDZIE JAKO LICZBA - string w `sort_order` wywróciłby
//      kolejność emisji w rendererze.
//
// ATRAPY I DLACZEGO. Radix Select/Switch nie działają pod happy-dom; Popover
// `DateTimePicker` też się nie otwiera, więc pik jest podmieniony na przycisk
// ECHUJĄCY propsy do atrybutów `data-*` - inaczej `minDate` nie da się
// zaobserwować bez sterowania kalendarzem, który nie jest przedmiotem dowodu.
//
// ADRESOWANIE POZYCYJNE - SKUTEK DEFEKTU DOSTĘPNOŚCI (żaden Select nie ma `id`
// ani `aria-label`, `<Label>` Radiksa nie ma `htmlFor`): `getAllByRole("combobox")`
// -> [0] slot, [1] pozycja na stronie, [2] typ strony.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł pól konfiguracji per pozycja -
// `AdPlacementConfigFields.test.tsx`. (2) Ładunku zapisu - `AdPlacementsPanel.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () => {
  const react = await import("react");
  return {
    DateTimePicker: (p: {
      value: string | null;
      placeholder?: string;
      minDate?: Date;
      onChange: (iso: string | null) => void;
    }) =>
      react.createElement(
        "button",
        {
          type: "button",
          "data-value": p.value ?? "",
          "data-min": p.minDate ? p.minDate.toISOString() : "",
          onClick: () => p.onChange("2026-09-01T10:00:00.000Z"),
        },
        p.placeholder,
      ),
  };
});

import { AdPlacementForm } from "@/components/admin/ads/organisms/AdPlacementForm";
import { emptyPlacement } from "@/components/admin/ads/organisms/AdPlacementsPanel";
import {
  AD_PAGE_TYPE_LABEL_KEYS,
  AD_POSITION_LABEL_KEYS,
  type AdPlacement,
  type AdSlot,
} from "@/lib/ads/types";

const SLOTS = [
  { id: "slot-1", name: "Baner nagłówka" },
  { id: "slot-2", name: "Sidebar 300x250" },
] as AdSlot[];

function renderForm(draft: Partial<AdPlacement>, slots: AdSlot[] = SLOTS) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <AdPlacementForm
      draft={draft}
      slots={slots}
      onChange={onChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      busy={false}
    />,
  );
  return { onChange, onSubmit, onCancel, ...utils };
}

const combos = () => screen.getAllByRole("combobox") as HTMLSelectElement[];
const optionValues = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.value);

describe("formularz pozycji: wybór slotu", () => {
  it("lista slotów pokazuje NAZWY, a wybór oddaje IDENTYFIKATOR", () => {
    const { onChange } = renderForm(emptyPlacement());
    const select = combos()[0];
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Baner nagłówka",
      "Sidebar 300x250",
    ]);
    fireEvent.change(select, { target: { value: "slot-2" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ slot_id: "slot-2" }));
  });

  it("pusta lista slotów nie blokuje formularza - bramka zapisu jest w panelu", () => {
    renderForm(emptyPlacement(), []);
    expect(optionValues(combos()[0])).toEqual([]);
    expect(screen.getByRole("button", { name: "adsAdmin.placements.addAction" })).toBeTruthy();
  });
});

describe("formularz pozycji: kompletność list wyboru", () => {
  it("pozycje na stronie pokrywają CAŁĄ unię AdPosition, bez pustych etykiet", () => {
    renderForm(emptyPlacement());
    const select = combos()[1];
    expect(optionValues(select)).toEqual(Object.keys(AD_POSITION_LABEL_KEYS));
    for (const option of Array.from(select.options)) {
      expect(option.textContent?.trim()).not.toBe("");
    }
  });

  it("typy strony pokrywają CAŁĄ unię AdPageType, bez pustych etykiet", () => {
    renderForm(emptyPlacement());
    const select = combos()[2];
    expect(optionValues(select)).toEqual(Object.keys(AD_PAGE_TYPE_LABEL_KEYS));
    for (const option of Array.from(select.options)) {
      expect(option.textContent?.trim()).not.toBe("");
    }
  });

  it("zmiana pozycji na stronie oddaje wartość z unii, nie etykietę", () => {
    const { onChange } = renderForm(emptyPlacement());
    fireEvent.change(combos()[1], { target: { value: "footer_slideup" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ position: "footer_slideup" }));
  });

  it("zmiana typu strony zawęża emisję i NIE rusza pozostałych pól draftu", () => {
    const { onChange } = renderForm({ ...emptyPlacement(), slot_id: "slot-1" });
    fireEvent.change(combos()[2], { target: { value: "category" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ page_type: "category", slot_id: "slot-1" }),
    );
  });

  it("świeży draft startuje na 'nad treścią wpisu' i na wpisach", () => {
    renderForm(emptyPlacement());
    expect(combos()[1].value).toBe("top_of_post");
    expect(combos()[2].value).toBe("post");
  });

  it("draft bez typu strony domyśla się 'wszystkie strony' - najszersza emisja", () => {
    // Rozjazd wart nazwania: `emptyPlacement()` daje `post`, a fallback selecta
    // `all`. Draft bez pola (np. wiersz z innej migracji) emituje WSZĘDZIE.
    renderForm({ slot_id: "slot-1" });
    expect(combos()[2].value).toBe("all");
  });
});

describe("formularz pozycji: zakres czasowy", () => {
  it("puste piki mówią, co znaczy pustka - 'od razu' i 'bezterminowo'", () => {
    renderForm(emptyPlacement());
    expect(screen.getByRole("button", { name: "Od razu (bez ograniczenia)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bezterminowo" })).toBeTruthy();
  });

  it("data końca dziedziczy GRANICĘ z daty startu", () => {
    renderForm({ ...emptyPlacement(), starts_at: "2026-09-01T08:00:00.000Z" });
    const end = screen.getByRole("button", { name: "Bezterminowo" });
    expect(end.getAttribute("data-min")).toBe("2026-09-01T08:00:00.000Z");
  });

  it("bez daty startu NIE MA granicy - panel nie wymyśla ograniczenia", () => {
    renderForm(emptyPlacement());
    expect(screen.getByRole("button", { name: "Bezterminowo" }).getAttribute("data-min")).toBe("");
  });

  it("wybrana data końca wraca do draftu jako ISO - osobna kolumna od startu", () => {
    const { onChange } = renderForm(emptyPlacement());
    fireEvent.click(screen.getByRole("button", { name: "Bezterminowo" }));
    const [next] = onChange.mock.calls[0] as [Partial<AdPlacement>];
    expect(next.ends_at).toBe("2026-09-01T10:00:00.000Z");
    expect(next.starts_at).toBeUndefined();
  });

  it("wybrana data startu wraca do draftu jako ISO", () => {
    const { onChange } = renderForm(emptyPlacement());
    fireEvent.click(screen.getByRole("button", { name: "Od razu (bez ograniczenia)" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ starts_at: "2026-09-01T10:00:00.000Z" }),
    );
  });
});

describe("formularz pozycji: konfiguracja i sortowanie", () => {
  it("pozycja mid_post pokazuje pole paragrafu, a top_of_post nie pokazuje żadnego", () => {
    renderForm({ ...emptyPlacement(), position: "mid_post" });
    expect(screen.getByLabelText("adsAdmin.placements.fieldAfterParagraph")).toBeTruthy();
    renderForm(emptyPlacement());
    expect(screen.queryByLabelText("Co N kart")).toBeNull();
  });

  it("wpisana wartość konfiguracji DOKLEJA się do config, nie podmienia go", () => {
    const { onChange } = renderForm({
      ...emptyPlacement(),
      position: "footer_slideup",
      config: { dismissible: false },
    });
    fireEvent.change(screen.getByLabelText("adsAdmin.placements.fieldDelayMs"), {
      target: { value: "1500" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ config: { dismissible: false, delay_ms: 1500 } }),
    );
  });

  it("sortowanie jedzie jako LICZBA - string wywróciłby kolejność emisji", () => {
    const { onChange } = renderForm(emptyPlacement());
    fireEvent.change(screen.getByLabelText("Sortowanie"), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort_order: 3 }));
  });
});

describe("formularz pozycji: aktywność i tryb", () => {
  it("świeża pozycja startuje jako AKTYWNA", () => {
    renderForm(emptyPlacement());
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(true);
  });

  it("wyłączenie aktywności oddaje active: false", () => {
    const { onChange } = renderForm(emptyPlacement());
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it("bez identyfikatora nie ma 'Anuluj'; z identyfikatorem jest i oddaje decyzję", () => {
    renderForm(emptyPlacement());
    expect(screen.queryByRole("button", { name: "Anuluj" })).toBeNull();
    const { onCancel } = renderForm({ ...emptyPlacement(), id: "pl-1" });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("zapis w toku blokuje przycisk", () => {
    render(
      <AdPlacementForm
        draft={emptyPlacement()}
        slots={SLOTS}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy
      />,
    );
    const button = screen.getByRole("button", { name: "adsAdmin.placements.addAction" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
