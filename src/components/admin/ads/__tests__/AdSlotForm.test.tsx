// Organizm formularza slotu: O CO panel pyta i CO oddaje jako draft.
//
// CO TEN PLIK DOWODZI.
//   1. PRZEŁĄCZNIK ZGODY RODO JEST STEROWANY WARTOŚCIĄ DRAFTU i oddaje ją
//      wprost - a domyślny draft (`emptySlot`) ma go WŁĄCZONEGO. Slot bez zgody
//      ładuje skrypt strony trzeciej czytelnikowi, który zgody nie wyraził,
//      więc „domyślnie wyłączone" byłoby defektem RODO, a nie ustawieniem.
//   2. ROUND-TRIP TARGETINGU PRZEZ FORMULARZ JEST STRATNY. Formularz czyta
//      kolumnę przez `parseAdTargeting` i zapisuje przez `adTargetingToJson`,
//      więc KAŻDE dotknięcie chipa przepuszcza całą kolumnę przez ten filtr:
//      nieznane klucze jsonb i języki poza pl/en giną bezpowrotnie, cicho.
//      Dowodem jest tu WPIĘCIE (kolumna wchodzi i wychodzi przez formularz),
//      nie logika samych funkcji - ta ma własny test.
//   3. ROUND-TRIP JEST STABILNY dla danych, które edytor zna - drugie dotknięcie
//      tego samego chipa wraca do stanu wejściowego.
//   4. PRZEŁĄCZENIE RODZAJU NIE GUBI POZOSTAŁYCH PÓL DRAFTU: draft dostaje
//      łatkę, nie nowy obiekt, więc wpisany HTML wraca po powrocie do `html`.
//   5. KATALOG ZAINTERESOWAŃ JEDZIE Z JĘZYKA INTERFEJSU, gałęzią
//      `language === "en" ? "en" : "pl"` - czyli „en-US" i „de" dostają katalog
//      POLSKI. To konsekwencja warta nazwania: reszta repo normalizuje przez
//      `uiLang()`, ten panel nie.
//   6. PRZYCISK „ANULUJ" ISTNIEJE TYLKO W TRYBIE EDYCJI, a nagłówek i etykieta
//      przycisku zapisu rozróżniają dodawanie od edycji.
//
// ATRAPY I DLACZEGO. Radix Select/Switch nie otwierają się i nie przełączają
// pod happy-dom (brak zdarzeń wskaźnika) - podmienione na natywne kontrolki
// z `@/test/reactStubs`. `useInterestCatalog` jest atrapą, bo tu przedmiotem
// dowodu jest JĘZYK, o który formularz pyta, a nie zapytanie do bazy.
//
// ADRESOWANIE POZYCYJNE - SKUTEK DEFEKTU DOSTĘPNOŚCI. Żaden Select i żaden
// Switch w tym formularzu nie ma `id` ani `aria-label`, a `<Label>` Radiksa nie
// ma `htmlFor`, więc czytnik ekranu odczytuje te pola BEZ NAZWY i `getByLabelText`
// nie ma czego znaleźć. Dlatego: `getAllByRole("switch")[0]` = status aktywny,
// `[1]` = zgoda marketingowa. Pola `FloatingInput`/`FloatingTextarea` mają
// poprawne powiązanie i te adresujemy etykietą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Pól per rodzaj - `AdSlotKindFields.test.tsx`.
// (2) Chipów targetingu - `AdTargetingEditor.test.tsx`. (3) Ładunku zapisu do
// bazy - `AdSlotsPanel.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl",
  catalogLangs: [] as string[],
  catalog: {
    data: {
      categories: [{ id: "c1", slug: "polityka", label: "Polityka" }],
      tags: [{ id: "t1", slug: "ue", label: "UE" }],
    },
  } as { data?: { categories: unknown[]; tags: unknown[] } },
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: (lang: string) => {
    h.catalogLangs.push(lang);
    return h.catalog;
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import { AdSlotForm } from "@/components/admin/ads/organisms/AdSlotForm";
import { emptySlot } from "@/components/admin/ads/organisms/AdSlotsPanel";
import { AD_SLOT_KIND_LABEL_KEYS, type AdSlot } from "@/lib/ads/types";

function renderForm(draft: Partial<AdSlot>) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <AdSlotForm
      draft={draft}
      onChange={onChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      busy={false}
    />,
  );
  return { onChange, onSubmit, onCancel, ...utils };
}

const switches = () => screen.getAllByRole("switch") as HTMLInputElement[];
const consentSwitch = () => switches()[1];

beforeEach(() => {
  h.lang = "pl";
  h.catalogLangs = [];
});

describe("formularz slotu: zgoda marketingowa (RODO)", () => {
  it("świeży draft ma przełącznik zgody WŁĄCZONY", () => {
    renderForm(emptySlot());
    expect(consentSwitch().checked).toBe(true);
  });

  it("wyłączenie zgody oddaje draft z requires_consent: false - to świadoma decyzja", () => {
    const { onChange } = renderForm(emptySlot());
    fireEvent.click(consentSwitch());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ requires_consent: false }));
  });

  it("draft z bazy bez zgody pokazuje przełącznik wyłączony, a nie domyślnie włączony", () => {
    renderForm({ ...emptySlot(), requires_consent: false });
    expect(consentSwitch().checked).toBe(false);
  });

  it("etykieta mówi WPROST o RODO - administrator nie zgaduje, czego dotyczy zgoda", () => {
    renderForm(emptySlot());
    expect(screen.getByText("Wymaga zgody marketingowej (RODO)")).toBeTruthy();
  });
});

describe("formularz slotu: status emisji", () => {
  it("przełącznik statusu jest włączony dla slotu aktywnego", () => {
    renderForm(emptySlot());
    expect(switches()[0].checked).toBe(true);
  });

  it("wyłączenie statusu daje 'paused', a nie null ani false", () => {
    const { onChange } = renderForm(emptySlot());
    fireEvent.click(switches()[0]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "paused" }));
  });

  it("slot wstrzymany ma przełącznik statusu wyłączony", () => {
    renderForm({ ...emptySlot(), status: "paused" });
    expect(switches()[0].checked).toBe(false);
  });
});

describe("formularz slotu: rodzaj kreacji", () => {
  it("lista rodzajów pokrywa CAŁĄ unię AdSlotKind - żadna opcja nie jest pusta", () => {
    renderForm(emptySlot());
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(Object.keys(AD_SLOT_KIND_LABEL_KEYS));
    for (const option of Array.from(select.options)) {
      expect(option.textContent?.trim()).not.toBe("");
    }
  });

  it("przełączenie rodzaju zmienia TYLKO `kind` - wpisany HTML zostaje w draftcie", () => {
    const { onChange } = renderForm({ ...emptySlot(), html: "<b>kreacja</b>" });
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "image" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", html: "<b>kreacja</b>" }),
    );
  });

  it("draft bez `kind` domyśla się HTML, a nie pustego selecta", () => {
    renderForm({ name: "x" });
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("html");
    expect(screen.getByLabelText("adsAdmin.slots.fieldHtml")).toBeTruthy();
  });
});

describe("formularz slotu: pola kreacji i notatki", () => {
  it("łatka z pól kreacji dokleja się do draftu, nie podmienia go", async () => {
    const { onChange } = renderForm({ ...emptySlot(), name: "Baner" });
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldHtml"), {
      target: { value: "<b>x</b>" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Baner", html: "<b>x</b>", requires_consent: true }),
    );
  });

  it("notatki wewnętrzne jadą do kolumny `notes`", () => {
    const { onChange } = renderForm(emptySlot());
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldNotes"), {
      target: { value: "Kampania partnera, do 30.09" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Kampania partnera, do 30.09" }),
    );
  });
});

describe("formularz slotu: wymiary", () => {
  it("wpisana szerokość jedzie jako LICZBA, nie jako string z pola", () => {
    const { onChange } = renderForm(emptySlot());
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldWidth"), {
      target: { value: "300" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ width: 300 }));
  });

  it("wyczyszczona wysokość daje null (brak ograniczenia), a nie 0 ani NaN", () => {
    const { onChange } = renderForm({ ...emptySlot(), height: 250 });
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldHeight"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ height: null }));
  });
});

describe("formularz slotu: round-trip targetingu przez kolumnę jsonb", () => {
  it("kliknięcie chipa serializuje targeting do postaci bez pustych pól", () => {
    const { onChange } = renderForm(emptySlot());
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ targeting: { categorySlugs: ["polityka"] } }),
    );
  });

  it("odznaczenie ostatniego chipa zostawia PUSTY obiekt, nie pustą tablicę w kolumnie", () => {
    const { onChange } = renderForm({ ...emptySlot(), targeting: { categorySlugs: ["polityka"] } });
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ targeting: {} }));
  });

  it("dotknięcie targetingu CZYŚCI nieznane klucze jsonb - cicho i bez ostrzeżenia", () => {
    // Slot ustawiony ręcznie w bazie (albo przez przyszłą wersję panelu) traci
    // pola, których ten build nie rozumie, przy PIERWSZEJ edycji targetingu.
    const { onChange } = renderForm({
      ...emptySlot(),
      targeting: { categorySlugs: ["polityka"], custom: { weight: 3 }, languages: ["de", "pl"] },
    });
    fireEvent.click(screen.getByRole("button", { name: "#UE" }));
    const [next] = onChange.mock.calls[0] as [Partial<AdSlot>];
    expect(next.targeting).toEqual({
      categorySlugs: ["polityka"],
      tagSlugs: ["ue"],
      languages: ["pl"],
    });
    expect(Object.keys(next.targeting ?? {})).not.toContain("custom");
  });

  it("round-trip jest STABILNY dla danych, które edytor zna", () => {
    const known = { categorySlugs: ["polityka"], tagSlugs: ["ue"], languages: ["pl", "en"] };
    const { onChange, rerender } = renderForm({ ...emptySlot(), targeting: known });
    // Zaznacz i odznacz ten sam chip: kolumna ma wrócić do stanu wejściowego.
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    const [afterOff] = onChange.mock.calls[0] as [Partial<AdSlot>];
    expect(afterOff.targeting).toEqual({ tagSlugs: ["ue"], languages: ["pl", "en"] });
    rerender(
      <AdSlotForm
        draft={{ ...emptySlot(), targeting: afterOff.targeting }}
        onChange={onChange}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    const [afterOn] = onChange.mock.calls[1] as [Partial<AdSlot>];
    expect(afterOn.targeting).toEqual(known);
  });

  it("uszkodzona kolumna jsonb nie wywala formularza - chipy są po prostu puste", () => {
    renderForm({ ...emptySlot(), targeting: "nie-obiekt" as unknown as AdSlot["targeting"] });
    expect(screen.getByRole("button", { name: "Polityka" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("formularz slotu: język katalogu zainteresowań", () => {
  it.each([
    ["pl", "pl"],
    ["en", "en"],
    ["de", "pl"],
    ["en-US", "pl"],
  ])("interfejs '%s' pyta katalog o '%s'", (uiLang, expected) => {
    h.lang = uiLang;
    renderForm(emptySlot());
    expect(h.catalogLangs).toContain(expected);
  });

  it("pusty katalog (brak danych) nie zabiera formularza - zostaje sekcja i podpowiedź", () => {
    h.catalog = {} as { data?: { categories: unknown[]; tags: unknown[] } };
    renderForm(emptySlot());
    expect(screen.getByText("adsAdmin.targetingHint")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Polityka" })).toBeNull();
    h.catalog = {
      data: {
        categories: [{ id: "c1", slug: "polityka", label: "Polityka" }],
        tags: [{ id: "t1", slug: "ue", label: "UE" }],
      },
    };
  });
});

describe("formularz slotu: tryb dodawania kontra edycja", () => {
  it("bez identyfikatora: nagłówek 'nowy slot', przycisk 'dodaj', ZERO 'Anuluj'", () => {
    renderForm(emptySlot());
    expect(screen.getByText("adsAdmin.slots.addTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "adsAdmin.slots.addAction" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Anuluj" })).toBeNull();
  });

  it("z identyfikatorem: nagłówek edycji, przycisk 'zapisz' i widoczne 'Anuluj'", () => {
    renderForm({ ...emptySlot(), id: "slot-1" });
    expect(screen.getByText("adsAdmin.slots.editTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "adsAdmin.save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeTruthy();
  });

  it("'Anuluj' oddaje decyzję wołającemu (to on wie, czym jest pusty draft)", () => {
    const { onCancel } = renderForm({ ...emptySlot(), id: "slot-1" });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("zapis w toku BLOKUJE przycisk - drugi klik nie wyśle drugiego insertu", () => {
    const onSubmit = vi.fn();
    render(
      <AdSlotForm
        draft={emptySlot()}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy
      />,
    );
    const button = screen.getByRole("button", { name: "adsAdmin.slots.addAction" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
