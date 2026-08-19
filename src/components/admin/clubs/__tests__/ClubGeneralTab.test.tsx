// Zakładka „Ogólne" edytora klubu - SKLEJENIE tabeli pól z kontrolkami.
//
// CO TEN PLIK DOWODZI.
//   1. KAŻDE POLE EMITUJE ŁATKĘ Z WŁAŚCIWYM KLUCZEM. Dziewięć pól tekstowych
//      plus obszar, status, okładka i układ - trzynaście kluczy, wszystkie
//      napisowe albo słownikowe. Przeklejony blok („nazwa EN" zapisująca do
//      `namePl") przechodzi przez `tsc`, przez recenzję i przez interfejs;
//      wykrywa go wyłącznie wywołanie KAŻDEGO pola osobno i asercja na
//      argumencie `onChange`. Ten sam test pilnuje kierunku odczytu: pole
//      pokazuje SWOJĄ wartość z wersji roboczej.
//   2. OSTRZEŻENIE O SLUGU pojawia się WYŁĄCZNIE przy realnej zmianie
//      istniejącego klubu: nie przy zgodnym slugu i nie przy klubie jeszcze
//      niezapisanym (ostrzeżenie o zepsutych linkach przy zakładaniu klubu
//      byłoby bez sensu).
//   3. LIMITY ZNAKÓW dojeżdżają do DOM-u - `maxLength` jest odwzorowaniem
//      kolumny w bazie, a nie ozdobą.
//   4. `disabled` ODCINA WSZYSTKO: pola tekstowe, droplisty, wybór układu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabeli pól i reguły łatki
// (`lib/clubs/__tests__/adminClubFormFields.test.ts`), normalizacji sluga
// i wykrycia jego zmiany (`adminClubEditor.test.ts`), zachowania wyboru układu
// (`ClubLayoutPicker.test.tsx`) ani katalogu obszarów (`topics.test.ts`).
// Radix `Select` jest podmieniony na natywny `<select>`, a wybór okładki na
// atrapę - pod happy-dom nie ma pełnego API wskaźnika ani magazynu plików.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [
      { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 30 },
      { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: ({
    label,
    value,
    onChange,
    folder,
  }: {
    label?: string;
    value: string;
    onChange: (next: string) => void;
    folder?: string;
  }) => (
    <div data-testid="cover-picker" data-folder={folder} data-value={value}>
      <span>{label}</span>
      <button type="button" onClick={() => onChange("https://cdn.test/klub.png")}>
        atrapa okładki
      </button>
    </div>
  ),
}));

import { ClubGeneralTab } from "@/components/admin/clubs/organisms/ClubGeneralTab";
import type { ClubGeneralDraftValues } from "@/lib/clubs/adminClubEditor";
import { CLUB_GENERAL_TEXT_FIELDS, type ClubGeneralTextKey } from "@/lib/clubs/adminClubFormFields";

const DRAFT: ClubGeneralDraftValues = {
  slug: "klub-energetyczny",
  namePl: "Klub Energetyczny",
  nameEn: "Energy Club",
  taglinePl: "Hasło polskie",
  taglineEn: "English tagline",
  descriptionPl: "Opis polski",
  descriptionEn: "English description",
  rulesPl: "Zasady polskie",
  rulesEn: "English rules",
  policyArea: "energy",
  status: "active",
  cover: "https://cdn.test/stara.png",
  layout: "list",
};

const onChange = vi.fn();

function panel(
  overrides: Partial<ClubGeneralDraftValues> = {},
  options: { persistedSlug?: string; disabled?: boolean } = {},
) {
  return render(
    <ClubGeneralTab
      draft={{ ...DRAFT, ...overrides }}
      persistedSlug={options.persistedSlug ?? DRAFT.slug}
      onChange={onChange}
      disabled={options.disabled}
    />,
  );
}

/** Pole tekstowe po kluczu etykiety - dokładnie tak, jak znajduje je czytnik. */
function field(labelKey: string): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getByLabelText(labelKey);
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) {
    throw new Error(`test: ${labelKey} nie jest polem tekstowym`);
  }
  return found;
}

/** Droplista identyfikowana po wartości jednej ze swoich opcji. */
function selectWith(optionValue: string): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === optionValue),
  );
  if (found === undefined) throw new Error(`test: brak droplisty z opcją ${optionValue}`);
  return found;
}

/** Oczekiwana łatka - budowana OSOBNO od kodu produkcyjnego. */
function patchOf(key: ClubGeneralTextKey, value: string): Record<string, string> {
  return { [key]: value };
}

beforeEach(() => {
  cleanup();
  onChange.mockReset();
});

describe("ClubGeneralTab - pola tekstowe", () => {
  it("wystawia wszystkie dziewięć pól z etykietą wiązaną po `id`", () => {
    panel();
    for (const spec of CLUB_GENERAL_TEXT_FIELDS) {
      expect(field(spec.labelKey).id).toBe(spec.id);
    }
  });

  it.each(CLUB_GENERAL_TEXT_FIELDS)("pole $key pokazuje SWOJĄ wartość wersji roboczej", (spec) => {
    panel();
    expect(field(spec.labelKey).value).toBe(DRAFT[spec.key]);
  });

  it.each(CLUB_GENERAL_TEXT_FIELDS.filter((spec) => spec.key !== "slug"))(
    "pole $key emituje łatkę pod swoim kluczem",
    (spec) => {
      panel();
      fireEvent.change(field(spec.labelKey), { target: { value: "Nowa treść" } });
      expect(onChange.mock.calls).toEqual([[patchOf(spec.key, "Nowa treść")]]);
    },
  );

  it("opisy i zasady są polami WIELOLINIJKOWYMI o zadanej wysokości", () => {
    panel();
    for (const spec of CLUB_GENERAL_TEXT_FIELDS.filter((entry) => entry.rows !== undefined)) {
      const element = field(spec.labelKey);
      expect(element.tagName).toBe("TEXTAREA");
      expect(element.getAttribute("rows")).toBe(String(spec.rows));
    }
  });

  it("nazwa, slug i hasło są polami JEDNOLINIJKOWYMI", () => {
    panel();
    for (const spec of CLUB_GENERAL_TEXT_FIELDS.filter((entry) => entry.rows === undefined)) {
      expect(field(spec.labelKey).tagName).toBe("INPUT");
    }
  });

  it("limit znaków dojeżdża do DOM-u: nazwy 120, hasła 200, treści bez limitu", () => {
    panel();
    expect(field("adminClubs.fields.namePl").getAttribute("maxlength")).toBe("120");
    expect(field("adminClubs.fields.nameEn").getAttribute("maxlength")).toBe("120");
    expect(field("adminClubs.fields.taglinePl").getAttribute("maxlength")).toBe("200");
    expect(field("adminClubs.fields.taglineEn").getAttribute("maxlength")).toBe("200");
    expect(field("adminClubs.fields.descriptionPl").hasAttribute("maxlength")).toBe(false);
    expect(field("adminClubs.fields.slug").hasAttribute("maxlength")).toBe(false);
  });

  it("podpowiedź stoi pod slugiem i pod zasadami angielskimi", () => {
    panel();
    expect(screen.getAllByText("adminClubs.fields.slugHint").length).toBeGreaterThan(0);
    expect(screen.getByText("adminClubs.fields.rulesHint")).not.toBeNull();
  });
});

describe("ClubGeneralTab - slug", () => {
  it("normalizuje wpisywaną treść w locie, zamiast czekać na odrzucony zapis", () => {
    panel();
    fireEvent.change(field("adminClubs.fields.slug"), { target: { value: "Klub  ENERGII!!" } });
    expect(onChange.mock.calls).toEqual([[{ slug: "klub-energii-" }]]);
  });

  it("ostrzega o zepsutych linkach przy realnej zmianie istniejącego klubu", () => {
    panel({ slug: "nowy-adres" }, { persistedSlug: "klub-energetyczny" });
    expect(document.querySelector(".text-amber-700")).not.toBeNull();
  });

  it("zgodny slug NIE ostrzega - inaczej ostrzeżenie wisi zawsze", () => {
    panel({ slug: "klub-energetyczny" }, { persistedSlug: "klub-energetyczny" });
    expect(document.querySelector(".text-amber-700")).toBeNull();
  });

  it("klub jeszcze niezapisany NIE ostrzega, choć slug jest inny niż pusty", () => {
    panel({ slug: "nowy-klub" }, { persistedSlug: "" });
    expect(document.querySelector(".text-amber-700")).toBeNull();
  });

  it.fails("ostrzeżenie POWINNO mówić coś więcej niż podpowiedź pod polem", () => {
    // PRAWDZIWY DEFEKT TREŚCIOWY, nie brak testu: ostrzeżenie renderuje ten
    // sam klucz `adminClubs.fields.slugHint`, który stoi szarą czcionką dwa
    // wiersze wyżej. Użytkownik dostaje więc to samo zdanie dwa razy i ani
    // razu nie dowiaduje się, że zmiana dotyczy JUŻ ISTNIEJĄCYCH linków.
    // Naprawa wymaga NOWEGO klucza i18n w PL i EN, czyli zmiany treści -
    // dlatego test jest zgłoszeniem, a nie poprawką.
    panel({ slug: "nowy-adres" }, { persistedSlug: "klub-energetyczny" });
    const warning = document.querySelector(".text-amber-700");
    expect(warning?.textContent).not.toBe("adminClubs.fields.slugHint");
  });
});

describe("ClubGeneralTab - kontrolki nietekstowe", () => {
  it("obszar polityki emituje klucz obszaru", () => {
    panel();
    fireEvent.change(selectWith("energy"), { target: { value: "transport" } });
    expect(onChange.mock.calls).toEqual([[{ policyArea: "transport" }]]);
  });

  it("„bez obszaru” zapisuje PUSTY NAPIS, a nie `null` ani `none`", () => {
    // Wersja robocza trzyma napisy - drogę powrotną `"" -> null` robi payload
    // zapisu (`clubEditorPayload`), nie formularz.
    panel();
    fireEvent.change(selectWith("energy"), { target: { value: "none" } });
    expect(onChange.mock.calls).toEqual([[{ policyArea: "" }]]);
  });

  it("obszar z wersji roboczej jest wybrany w droplistcie", () => {
    panel({ policyArea: "transport" });
    expect(selectWith("energy").value).toBe("transport");
  });

  it("status emituje wartość ze słownika statusów", () => {
    panel();
    fireEvent.change(selectWith("archived"), { target: { value: "archived" } });
    expect(onChange.mock.calls).toEqual([[{ status: "archived" }]]);
  });

  it("okładka jedzie do wersji roboczej pod kluczem `cover`, z katalogu klubów", () => {
    panel();
    const picker = screen.getByTestId("cover-picker");
    expect(picker.getAttribute("data-folder")).toBe("clubs");
    expect(picker.getAttribute("data-value")).toBe(DRAFT.cover);
    fireEvent.click(screen.getByText("atrapa okładki"));
    expect(onChange.mock.calls).toEqual([[{ cover: "https://cdn.test/klub.png" }]]);
  });

  it("wybór układu emituje identyfikator układu, a nie indeks kafla", () => {
    panel();
    const tiles = screen.getAllByRole("radio");
    expect(tiles.length).toBeGreaterThan(1);
    const cards = tiles.find((tile) =>
      (tile.textContent ?? "").includes("adminClubs.layout.cards"),
    );
    expect(cards).not.toBeUndefined();
    fireEvent.click(cards ?? tiles[0]);
    expect(onChange.mock.calls).toEqual([[{ layout: "cards" }]]);
  });

  it("karta prezentacji opisuje okładkę i układ - oba pola były martwe w bazie", () => {
    panel();
    expect(screen.getByText("adminClubs.presentation")).not.toBeNull();
    expect(screen.getByText("adminClubs.layout.label")).not.toBeNull();
    expect(screen.getByText("adminClubs.layout.hint")).not.toBeNull();
    expect(screen.getByText("adminClubs.fields.cover")).not.toBeNull();
  });
});

describe("ClubGeneralTab - stan zablokowany", () => {
  it("`disabled` odcina WSZYSTKIE pola tekstowe", () => {
    panel({}, { disabled: true });
    for (const spec of CLUB_GENERAL_TEXT_FIELDS) {
      expect(field(spec.labelKey).disabled).toBe(true);
    }
  });

  it("`disabled` odcina obie droplisty i wybór układu", () => {
    panel({}, { disabled: true });
    for (const select of Array.from(document.querySelectorAll("select"))) {
      expect(select.disabled).toBe(true);
    }
    const tiles = screen.getAllByRole("radio");
    for (const tile of tiles) expect(tile.hasAttribute("disabled")).toBe(true);
    fireEvent.click(tiles[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bez `disabled` nic nie udaje zablokowanego", () => {
    panel();
    for (const spec of CLUB_GENERAL_TEXT_FIELDS) {
      expect(field(spec.labelKey).disabled).toBe(false);
    }
    for (const select of Array.from(document.querySelectorAll("select"))) {
      expect(select.disabled).toBe(false);
    }
  });
});
