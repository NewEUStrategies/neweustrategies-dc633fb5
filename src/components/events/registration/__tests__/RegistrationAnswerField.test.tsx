// JEDNO pole zdefiniowane przez organizatora - dziesiec typow, jeden kontrakt.
//
// DLACZEGO PRZECHODZIMY PO WSZYSTKICH TYPACH. `event_registration_fields`
// dopuszcza dziesiec wartosci `field_type`, a komponent rysuje je szescioma
// roznymi galeziami. Kazda galaz ma wlasna etykiete, wlasny sposob oddania
// wartosci i wlasne oznaczenie „to pole blokuje wyslanie". Pokryty byl tylko
// `text`, wiec zamiana kontrolki w pozostalych dziewieciu przypadkach nie
// zapalala niczego - a to sa pola, w ktorych uczestnik zostawia DANE.
//
// CZTERY RZECZY, KTORE PO ZEPSUCIU KOSZTUJA ZGLOSZENIE:
//
// 1. GWIAZDKA PRZY POLU OBOWIAZKOWYM. Walidacja odrzuca szkic bez odpowiedzi
//    (`missing_required_fields`), wiec brak oznaczenia to formularz, ktorego
//    nie da sie wyslac i nie wiadomo dlaczego.
// 2. WARTOSC WRACA JAKO NAPIS ALBO LISTA NAPISOW. Konwersja na liczbe i na
//    prawde/falsz zyje w `registrationSubmitDraft`; gdyby komponent zaczal
//    konwertowac sam, mielibysmy dwa miejsca, w ktorych „false" moze zostac
//    napisem „false".
// 3. WYBOR ODDAJE WARTOSC, NIE ETYKIETE. `event_register` dopasowuje odpowiedz
//    do `options[].value`; wyslanie etykiety konczy sie odpowiedzia, ktorej
//    zadna regula kwalifikujaca nie rozpozna.
// 4. TYP `file` TO ADRES, NIE WRZUT. Zapis jest otwarty dla gosci bez konta,
//    wiec publiczny upload byloby otwartym wiadrem - podpowiedz `(https://)`
//    przy etykiecie jest jedynym, co odroznia te kontrolke od zwyklego tekstu.
//
// ATRAPUJEMY WYLACZNIE GRANICE: i18n (parytetu PL/EN pilnuje osobna bramka
// slownikow). Kontrolki (`FieldBox`, `Checkbox`, `Select`, `Textarea`) jada
// prawdziwe - to one decyduja o roli, etykiecie i o tym, czy pole w ogole da
// sie obsluzyc klawiatura.
//
// RODO: wszystkie pytania i odpowiedzi sa syntetyczne.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { RegistrationFormField } from "@/lib/events/registrationFormSurface";
import type { RegistrationFieldType } from "@/lib/events/registrationsApi";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { RegistrationAnswerField } =
  await import("@/components/events/registration/RegistrationAnswerField");

function field(over: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return {
    id: "f-1",
    key: "diet",
    fieldType: "text",
    labelPl: "Dieta",
    labelEn: "Diet",
    helpPl: "",
    helpEn: "",
    isRequired: false,
    options: [],
    ...over,
  };
}

function renderField(
  over: Partial<RegistrationFormField> = {},
  extra: { value?: string | string[]; lang?: "pl" | "en"; error?: string | null } = {},
) {
  const onChange = vi.fn<(value: string | string[]) => void>();
  const view = render(
    <RegistrationAnswerField
      field={field(over)}
      value={extra.value}
      onChange={onChange}
      lang={extra.lang ?? "pl"}
      error={extra.error ?? null}
    />,
  );
  return { ...view, onChange };
}

/** Lista Radiksa otwiera sie klawiatura - pointer events nie dzialaja w happy-dom. */
function openOptions(): HTMLElement {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

const CHOICES = [
  { value: "vege", labelPl: "Wegetarianska", labelEn: "Vegetarian" },
  { value: "vegan", labelPl: "Weganska", labelEn: "Vegan" },
];

// ---------------------------------------------------------------------------
// OZNACZENIE POLA OBOWIAZKOWEGO - po jednym przejsciu na KAZDY typ.
// ---------------------------------------------------------------------------
describe("RegistrationAnswerField - obowiazkowosc widac przy kazdym typie pola", () => {
  // Etykieta pola `file` niesie dodatkowo podpowiedz o adresie, wiec oznaczenie
  // obowiazkowosci lapiemy po koncowce, a nie po calym napisie.
  const cases: ReadonlyArray<readonly [RegistrationFieldType, string]> = [
    ["text", "Dieta"],
    ["textarea", "Dieta"],
    ["select", "Dieta"],
    ["multiselect", "Dieta"],
    ["checkbox", "Dieta"],
    ["switch", "Dieta"],
    ["number", "Dieta"],
    ["date", "Dieta"],
    ["file", "Dieta (https://)"],
    ["consent", "Dieta"],
  ];

  for (const [fieldType, label] of cases) {
    it(`„${fieldType}" obowiazkowe jest oznaczone, a dobrowolne nie`, () => {
      const { unmount } = renderField({ fieldType, isRequired: true, options: CHOICES });
      expect(screen.getByText(`${label} *`)).toBeInTheDocument();
      unmount();

      renderField({ fieldType, isRequired: false, options: CHOICES });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(`${label} *`)).not.toBeInTheDocument();
    });
  }
});

// ---------------------------------------------------------------------------
// KONTROLKA ODPOWIADA TYPOWI PYTANIA.
// ---------------------------------------------------------------------------
describe("RegistrationAnswerField - pola tekstowe, liczbowe i datowe", () => {
  it("pytanie tekstowe oddaje wpisany napis bez zadnej konwersji", () => {
    const { onChange } = renderField({ fieldType: "text" });

    fireEvent.change(screen.getByLabelText("Dieta"), { target: { value: " bezglutenowa " } });

    // Przyciecie robi `registrationSubmitDraft` przy wysylce - tutaj wartosc
    // musi dojechac tak, jak ja czlowiek wpisal, inaczej nie da sie dopisac
    // spacji w srodku zdania.
    expect(onChange).toHaveBeenCalledWith(" bezglutenowa ");
  });

  it("pytanie liczbowe dostaje kontrolke liczbowa, ale oddaje NAPIS", () => {
    const { onChange } = renderField({ fieldType: "number", key: "seats" });

    const input = screen.getByLabelText("Dieta");
    expect(input).toHaveAttribute("type", "number");
    fireEvent.change(input, { target: { value: "3" } });

    // Liczba powstaje dopiero w `draftAnswers`. Konwersja tutaj oznaczalaby
    // dwa miejsca, w ktorych „3" moze zostac napisem albo liczba.
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("pytanie o date dostaje kontrolke daty i oddaje ja w formacie ISO", () => {
    const { onChange } = renderField({ fieldType: "date", key: "arrival" });

    const input = screen.getByLabelText("Dieta");
    expect(input).toHaveAttribute("type", "date");
    fireEvent.change(input, { target: { value: "2026-09-15" } });

    // Data jedzie do `answers` takim napisem, jaki oddaje kontrolka - to samo
    // `YYYY-MM-DD`, ktore rozumie `jsonb` i reguly kwalifikujace. Przerobienie
    // jej tutaj na `Date` albo na format lokalny konczy sie odpowiedzia,
    // ktorej organizator nie posortuje.
    expect(onChange).toHaveBeenCalledWith("2026-09-15");
  });

  it("pytanie o plik pyta o ADRES i mowi to w etykiecie", () => {
    // Publiczny wrzut do storage'u byloby otwartym wiadrem - zapis jest
    // dostepny takze dla gosci bez konta.
    const { onChange } = renderField({ fieldType: "file", key: "cv" });

    const input = screen.getByLabelText("Dieta (https://)");
    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAttribute("inputmode", "url");
    fireEvent.change(input, { target: { value: "https://example.com/cv.pdf" } });

    expect(onChange).toHaveBeenCalledWith("https://example.com/cv.pdf");
  });

  it("dluga odpowiedz dostaje pole wielowierszowe zwiazane z etykieta", () => {
    const { onChange } = renderField({ fieldType: "textarea", key: "notes" });

    const area = screen.getByLabelText("Dieta");
    expect(area.tagName).toBe("TEXTAREA");
    fireEvent.change(area, { target: { value: "Bez orzechow." } });

    expect(onChange).toHaveBeenCalledWith("Bez orzechow.");
  });

  it("lista wartosci w polu tekstowym nie wycieka do kontrolki jako „a,b”", () => {
    // Gdyby organizator zmienil typ pola z `multiselect` na `text`, w szkicu
    // zostaje tablica. Pokazanie jej jako napisu wyslaloby do bazy odpowiedz,
    // ktorej uczestnik nigdy nie wpisal.
    renderField({ fieldType: "text" }, { value: ["vege", "vegan"] });

    expect(screen.getByLabelText("Dieta")).toHaveValue("");
  });
});

describe("RegistrationAnswerField - wybor jednokrotny", () => {
  it("wybor oddaje WARTOSC opcji, a nie jej etykiete", () => {
    const { onChange } = renderField({ fieldType: "select", options: CHOICES });

    fireEvent.click(within(openOptions()).getByRole("option", { name: "Wegetarianska" }));

    expect(onChange).toHaveBeenCalledWith("vege");
  });

  it("bez odpowiedzi pokazuje podpowiedz wyboru, a nie pierwsza opcje z listy", () => {
    // Pierwsza opcja pokazana jako wybrana byloby odpowiedzia, ktorej nikt nie
    // udzielil - a przy polu obowiazkowym takze omijala walidacje.
    renderField({ fieldType: "select", options: CHOICES }, { value: "" });

    expect(screen.getByText("eventRegistration.labels.selectPlaceholder")).toBeInTheDocument();
  });

  it("opcja bez etykiety spada do wlasnej wartosci - lista nie ma pustych pozycji", () => {
    renderField({
      fieldType: "select",
      options: [{ value: "vege", labelPl: "", labelEn: "" }],
    });

    expect(within(openOptions()).getByRole("option", { name: "vege" })).toBeInTheDocument();
  });
});

describe("RegistrationAnswerField - wybor wielokrotny", () => {
  it("zaznaczenie DOKLADA wartosc do juz wybranych, a nie podmienia listy", () => {
    const { onChange } = renderField(
      { fieldType: "multiselect", options: CHOICES },
      { value: ["vege"] },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Weganska" }));

    expect(onChange).toHaveBeenCalledWith(["vege", "vegan"]);
  });

  it("odznaczenie usuwa TYLKO te jedna wartosc", () => {
    const { onChange } = renderField(
      { fieldType: "multiselect", options: CHOICES },
      { value: ["vege", "vegan"] },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Wegetarianska" }));

    expect(onChange).toHaveBeenCalledWith(["vegan"]);
  });

  it("napis w miejscu listy nie zaznacza niczego na sile", () => {
    renderField({ fieldType: "multiselect", options: CHOICES }, { value: "vege" });

    expect(screen.getByRole("checkbox", { name: "Wegetarianska" })).not.toBeChecked();
  });
});

describe("RegistrationAnswerField - decyzja tak/nie", () => {
  const cases: ReadonlyArray<RegistrationFieldType> = ["checkbox", "switch", "consent"];

  for (const fieldType of cases) {
    it(`„${fieldType}" zaznaczone melduje „true", odznaczone melduje pustke`, () => {
      const { onChange, unmount } = renderField({ fieldType }, { value: "" });
      fireEvent.click(screen.getByRole("checkbox", { name: "Dieta" }));
      // Napis „true" jest kontraktem z `registrationSubmitDraft`, ktory dopiero
      // tam zamienia go na `true`/`false` w ladunku RPC.
      expect(onChange).toHaveBeenCalledWith("true");
      unmount();

      const second = renderField({ fieldType }, { value: "true" });
      expect(screen.getByRole("checkbox", { name: "Dieta" })).toBeChecked();
      fireEvent.click(screen.getByRole("checkbox", { name: "Dieta" }));
      // Pustka, a nie „false": `isAnswered` liczy wylacznie wartosc „true",
      // wiec cofnieta zgoda obowiazkowa ma znowu blokowac wyslanie.
      expect(second.onChange).toHaveBeenCalledWith("");
    });
  }
});

// ---------------------------------------------------------------------------
// PODPOWIEDZ I BLAD - to sa zdania, po ktorych czlowiek wie, co poprawic.
// ---------------------------------------------------------------------------
describe("RegistrationAnswerField - podpowiedz organizatora i zdanie o bledzie", () => {
  it("podpowiedz stoi przy polu i jest z nim zwiazana dla czytnika ekranu", () => {
    renderField({ helpPl: "Podaj alergie pokarmowe." });

    const help = screen.getByText("Podaj alergie pokarmowe.");
    expect(screen.getByLabelText("Dieta").getAttribute("aria-describedby")).toContain(help.id);
  });

  it("zdanie o bledzie jest zwiazane z polem, a nie tylko wyswietlone obok", () => {
    renderField({ isRequired: true }, { error: "To pole jest obowiazkowe." });

    const error = screen.getByText("To pole jest obowiazkowe.");
    expect(screen.getByLabelText("Dieta *").getAttribute("aria-describedby")).toContain(error.id);
  });

  it("podpowiedz i blad naraz - pole wskazuje OBA zdania", () => {
    renderField({ helpPl: "Podaj alergie pokarmowe." }, { error: "To pole jest obowiazkowe." });

    const described = screen.getByLabelText("Dieta").getAttribute("aria-describedby") ?? "";
    expect(described).toContain(screen.getByText("Podaj alergie pokarmowe.").id);
    expect(described).toContain(screen.getByText("To pole jest obowiazkowe.").id);
  });

  it("bez podpowiedzi i bez bledu pole nie wskazuje pustego opisu", () => {
    // `aria-describedby=""` kaze czytnikowi szukac elementu, ktorego nie ma.
    renderField();

    expect(screen.getByLabelText("Dieta")).not.toHaveAttribute("aria-describedby");
  });

  it("pole wielowierszowe z bledem jest oznaczone jako niepoprawne", () => {
    renderField({ fieldType: "textarea" }, { error: "To pole jest obowiazkowe." });

    expect(screen.getByLabelText("Dieta")).toHaveAttribute("aria-invalid", "true");
  });

  it("przy wyborze wielokrotnym zdanie o bledzie jest zwiazane z GRUPA pol", () => {
    // Wiazanie idzie na `<fieldset>`, bo w tej galezi „polem" jest cala grupa,
    // a nie pojedynczy kwadracik. Bez tego uczestnik korzystajacy z czytnika
    // ekranu slyszy „grupa: Sciezki tematyczne", a powodu odrzucenia
    // formularza nie slyszy w ogole - komunikat wisi obok jako zwykly akapit.
    // Kazda inna galaz tego komponentu (tekst, textarea, wybor jednokrotny,
    // zgoda) to wiazanie ustawia.
    const { container } = renderField(
      { fieldType: "multiselect", options: CHOICES, isRequired: true },
      { error: "Wybierz co najmniej jedna sciezke." },
    );

    const errorId = screen.getByText("Wybierz co najmniej jedna sciezke.").id;
    const described = container.querySelector("fieldset")?.getAttribute("aria-describedby") ?? "";
    expect(described).toContain(errorId);
  });
});

// ---------------------------------------------------------------------------
// WERSJA JEZYKOWA PYTANIA.
// ---------------------------------------------------------------------------
describe("RegistrationAnswerField - jezyk widza", () => {
  it("po angielsku czyta etykiete, podpowiedz i etykiety opcji z kolumn EN", () => {
    renderField(
      { fieldType: "multiselect", options: CHOICES, helpPl: "Po polsku", helpEn: "In English" },
      { lang: "en" },
    );

    expect(screen.getByText("Diet")).toBeInTheDocument();
    expect(screen.getByText("In English")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Vegetarian" })).toBeInTheDocument();
    expect(screen.queryByText("Po polsku")).not.toBeInTheDocument();
  });

  it("brak etykiety w jezyku widza spada do klucza pola - pytanie zostaje NAZWANE", () => {
    // Bezimienne pole to prosba o dane bez pytania; uczestnik nie ma jak
    // odgadnac, czego organizator chce.
    renderField({ labelEn: "", key: "diet" }, { lang: "en" });

    expect(screen.getByLabelText("diet")).toBeInTheDocument();
  });
});

describe("RegistrationAnswerField - dostepnosc", () => {
  const cases: ReadonlyArray<RegistrationFieldType> = [
    "text",
    "textarea",
    "select",
    "multiselect",
    "consent",
    "file",
  ];

  for (const fieldType of cases) {
    it(`„${fieldType}" nie ma naruszen dostepnosci`, async () => {
      const { container } = renderField(
        { fieldType, options: CHOICES, isRequired: true, helpPl: "Podaj alergie." },
        { error: "To pole jest obowiazkowe." },
      );

      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    });
  }
});
