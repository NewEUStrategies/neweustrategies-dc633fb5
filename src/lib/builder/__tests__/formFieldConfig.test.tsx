// SILNIK POL WLASNYCH WIDGETOW FORMULARZOWYCH (formFieldConfig.tsx).
//
// Redaktor dopisuje w panelu widgetu dodatkowe pola formularza jako JSON
// (schemat `stringArray`: jedna linia = jeden obiekt). Ten modul jest calym
// mostem miedzy tym tekstem a gotowym formularzem: parsuje konfiguracje
// (`parseCustomFields`), rozstrzyga etykiete i podpowiedz w wybranym jezyku
// (`resolveCustomFieldLabel` / `resolveCustomFieldPlaceholder`), pilnuje pol
// wymaganych przed wyslaniem (`validateCustomFields`) i rysuje same kontrolki
// (`CustomFieldsRenderer`). Konsumenci produkcyjni: `WidgetView` (widget
// "join-us") oraz `JoinUsForm` (blokada wysylki + render pol).
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. PARSER JEST BRAMA NA NIEZAUFANY TEKST. Wejsciem jest to, co redaktor
//    wklepal do textarei, wiec kazdy wiersz moze byc smieciem. Kontrakt jest
//    taki: zly wiersz WYPADA PO CICHU, a pozostale przechodza. Odwrotnosc
//    (wyjatek na jednym wierszu) wygasilaby caly formularz na zywej stronie,
//    a "przepuszczamy wszystko" wpuscilo by do DOM pole bez `id`, ktorego
//    wartosci nie da sie potem przypisac w CRM.
//
// 2. LANCUCH JEZYKOWY MA SIE COFAC, A NIE GASNAC. Redakcja czesto wypelnia
//    tylko jedna wersje jezykowa. Pole z sama etykieta PL musi byc widoczne
//    i nazwane rowniez na `/en` - puste `aria-label` to pole nie do obslugi
//    czytnikiem ekranu. Ten sam lancuch obowiazuje etykiety opcji droplisty.
//
// 3. WYMAGALNOSC JEST DWUSTOPNIOWA I OBA STOPNIE MUSZA MOWIC TO SAMO.
//    `validateCustomFields` zwraca identyfikatory pol pustych po `trim`,
//    a renderer stawia `aria-required` i gwiazdke. Rozjazd miedzy tymi
//    stopniami daje formularz, ktorego nie da sie wyslac i ktory nie mowi
//    dlaczego.
//
// 4. KAZDY TYP POLA MA INNY NOSNIK WARTOSCI, ALE JEDNA MAPE. Textarea idzie
//    przez `MessageComposerField`, droplista przez atom `FormSelect`, zgoda
//    przez natywny checkbox zapisujacy "1"/"", reszta przez `<input>`.
//    Wszystkie cztery drogi musza trafiac w `onChange(id, value)` z tym samym
//    identyfikatorem, bo to on jest kluczem w ladunku wysylanym do CRM.
//
// GRANICA DOWODU
//  * Radix Select nie rozwija listy pod happy-dom (brak pointer API), wiec
//    `@/components/atoms/FormSelect` jest tu zastapiony wiernym natywnym
//    `<select>` (konwencja repo, patrz `VerificationDomainsCard.test.tsx`).
//    Dowodzimy zatem, CO modul podaje atomowi (opcje, placeholder, styl,
//    cel edycji), a nie tego, jak Radix to rysuje.
//  * `MessageComposerField` biegnie PRAWDZIWY - to jedyny sposob, zeby
//    sprawdzic, ze `maxLength ?? 2000` i `textareaStyle` naprawde doklejaja
//    sie do textarei.
//  * Klient Supabase jest zaslepiony, bo graf `MessageComposerField` ->
//    podpowiedzi @wzmianek go wciaga; zaden przypadek nie wychodzi do sieci.
//  * Powtorna walidacja po stronie bazy (`enforce_form_field_policy`) jest
//    poza tym poziomem - tutaj dowodzimy wylacznie bramki klienckiej.
//
// USTALENIE DO OSOBNEGO ZGLOSZENIA (nie naprawiam, bo to zmiana produkcyjna):
// `pickI18n` (formFieldConfig.tsx:98-110) jest MARTWYM EKSPORTEM - nie ma ani
// jednego importera i nie jest uzywany wewnatrz wlasnego pliku. Blizniacza
// funkcja o tej samej nazwie zyje w `@/lib/content-model/contentValue` i to
// jej uzywa cala reszta repo (`WidgetView`, `DynamicTagWidgets`). Ponizej
// przypinam DZISIEJSZE zachowanie tej kopii, zeby ewentualne usuniecie bylo
// swiadoma decyzja, a nie skutkiem ubocznym refaktoru.
//
// RODO: wszystkie pola, etykiety i wartosci sa zmyslone; jedyny adres
// w pliku jest w domenie example.com.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type CSSProperties, type ReactNode } from "react";

// Granica sieci. `MessageComposerField` wciaga hook podpowiedzi @wzmianek,
// a ten importuje klienta Supabase - zaslepiamy go, zeby ani jeden przypadek
// nie mial szansy dotknac gniazda.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub, ok } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  rpcStub.setResponse("search_people_orgs", () => ok([]));
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

// Wierna atrapa atomu droplisty: te same wejscia, natywny nosnik. Placeholder
// ladujemy w pustej opcji, zeby dalo sie go przeczytac z DOM - w Radiksie
// siedzi on w `SelectValue`, ktorego happy-dom nie wyrenderuje bez otwarcia.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    options,
    onValueChange,
    placeholder,
    required,
    className,
    style,
    "aria-label": ariaLabel,
    "data-edit-target": editTarget,
  }: {
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    placeholder?: string;
    required?: boolean;
    className?: string;
    style?: CSSProperties;
    "aria-label"?: string;
    "data-edit-target"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      aria-required={required || undefined}
      className={className}
      style={style}
      data-edit-target={editTarget}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import {
  CustomFieldsRenderer,
  parseCustomFields,
  pickI18n,
  resolveCustomFieldLabel,
  resolveCustomFieldPlaceholder,
  validateCustomFields,
  type CustomFieldDef,
} from "@/lib/builder/formFieldConfig";

afterEach(() => {
  cleanup();
});

/** Skrot budujacy definicje pola - domyslnie najprostsze pole tekstowe. */
function pole(over: Partial<CustomFieldDef> & { id: string }): CustomFieldDef {
  return { type: "text", ...over };
}

interface HarnessProps {
  fields: CustomFieldDef[];
  lang?: "pl" | "en";
  initial?: Record<string, string>;
  className?: string;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  inputEditTarget?: string;
  onEach?: (id: string, value: string) => void;
}

/** Renderer jest KONTROLOWANY - mape wartosci trzyma rodzic. Ta oprawa
 *  odtwarza dokladnie to, co robi `JoinUsForm`, zeby dalo sie sprawdzic
 *  pelna petle: zdarzenie -> `onChange(id, value)` -> nowa wartosc w polu. */
function Oprawa({
  fields,
  lang = "pl",
  initial = {},
  className,
  inputClassName,
  inputStyle,
  inputEditTarget,
  onEach,
}: HarnessProps) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  return (
    <CustomFieldsRenderer
      fields={fields}
      values={values}
      onChange={(id, value) => {
        onEach?.(id, value);
        setValues((prev) => ({ ...prev, [id]: value }));
      }}
      lang={lang}
      className={className}
      inputClassName={inputClassName}
      inputStyle={inputStyle}
      inputEditTarget={inputEditTarget}
    />
  );
}

describe("parseCustomFields - ksztalty wejscia z panelu widgetu", () => {
  it("brak konfiguracji daje pusta liste, a nie wyjatek", () => {
    expect(parseCustomFields(undefined)).toEqual([]);
    expect(parseCustomFields(null)).toEqual([]);
    expect(parseCustomFields("")).toEqual([]);
    expect(parseCustomFields(0)).toEqual([]);
    expect(parseCustomFields(false)).toEqual([]);
  });

  it("gotowa tablica obiektow przechodzi w calosci i zachowuje kolejnosc", () => {
    const wynik = parseCustomFields([
      { id: "nip", type: "text", labelPl: "NIP" },
      { id: "zgoda", type: "checkbox", labelPl: "Zgoda", required: true },
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["nip", "zgoda"]);
    expect(wynik[1]).toMatchObject({ type: "checkbox", required: true });
  });

  it("stringArray z panelu - kazda linia to osobny obiekt JSON", () => {
    const wynik = parseCustomFields([
      '{"id":"nip","type":"text","labelPl":"NIP"}',
      '{"id":"stanowisko","type":"text","labelEn":"Job title"}',
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["nip", "stanowisko"]);
  });

  it("linia zawierajaca CALA tablice JSON jest rozpakowywana, a nie odrzucana", () => {
    const wynik = parseCustomFields([
      '[{"id":"a","type":"text"},{"id":"b","type":"email"}]',
      '{"id":"c","type":"tel"}',
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("pojedynczy string z tablica JSON to trzeci akceptowany ksztalt", () => {
    const wynik = parseCustomFields('[{"id":"a","type":"url"},{"id":"b","type":"textarea"}]');

    expect(wynik.map((f) => f.type)).toEqual(["url", "textarea"]);
  });

  it("pojedynczy string z jednym obiektem JSON tez przechodzi", () => {
    expect(parseCustomFields('{"id":"a","type":"select"}')).toEqual([{ id: "a", type: "select" }]);
  });

  it("USZKODZONA linia wypada po cichu, a sasiednie poprawne zostaja", () => {
    const wynik = parseCustomFields([
      '{"id":"a","type":"text"}',
      "{to nie jest JSON",
      '{"id":"b","type":"text"}',
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("caly uszkodzony string konfiguracji daje pusta liste zamiast wyjatku", () => {
    expect(() => parseCustomFields("[{niedomkniete")).not.toThrow();
    expect(parseCustomFields("[{niedomkniete")).toEqual([]);
  });

  it("wpis bez identyfikatora albo z pustym identyfikatorem jest odrzucany", () => {
    const wynik = parseCustomFields([
      { type: "text" },
      { id: "   ", type: "text" },
      { id: 42, type: "text" },
      { id: "ok", type: "text" },
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["ok"]);
  });

  it("wpis z typem spoza katalogu jest odrzucany w calosci", () => {
    const wynik = parseCustomFields([
      { id: "plik", type: "file" },
      { id: "data", type: "date" },
      { id: "ok", type: "text" },
    ]);

    expect(wynik.map((f) => f.id)).toEqual(["ok"]);
  });

  it("wartosci nie bedace obiektem (null, liczba, prawda) wypadaja z tablicy", () => {
    const wynik = parseCustomFields([null, 7, true, "nie-json", { id: "ok", type: "text" }]);

    expect(wynik.map((f) => f.id)).toEqual(["ok"]);
  });

  it("wszystkie siedem typow z katalogu przechodzi przez parser", () => {
    const typy: CustomFieldDef["type"][] = [
      "text",
      "email",
      "tel",
      "url",
      "textarea",
      "select",
      "checkbox",
    ];
    const wynik = parseCustomFields(typy.map((type, i) => ({ id: `f${i}`, type })));

    expect(wynik.map((f) => f.type)).toEqual(typy);
  });

  it("goly obiekt (bez tablicy i bez JSON-a) NIE jest akceptowanym ksztaltem", () => {
    // Udokumentowane sa trzy ksztalty wejscia; obiekt podany wprost do nich
    // nie nalezy i ma dac pustke, a nie pole "widmo" bez konfiguracji.
    expect(parseCustomFields({ id: "nip", type: "text" })).toEqual([]);
    expect(parseCustomFields(42)).toEqual([]);
  });

  // DEFEKT: POWTORZONY IDENTYFIKATOR POLA PRZECHODZI PRZEZ PARSER.
  //
  // WEJSCIE: konfiguracja widgetu z dwoma wpisami o tym samym `id` (realne,
  //   bo panel to zwykla textarea - wystarczy skopiowac linie i zmienic
  //   etykiete, a nie zmienic identyfikatora).
  // CO PSUJE: `parseCustomFields` (src/lib/builder/formFieldConfig.tsx:60-94)
  //   nie prowadzi zbioru widzianych identyfikatorow. Blizniaczy silnik
  //   `src/lib/content-model/formFields.ts:99,111` robi dokladnie to samo
  //   zadanie i ma tam `const seen = new Set<string>()` z pominieciem
  //   duplikatu - czyli kontrakt jest w repo ustalony, a ta kopia go lamie.
  // KONSEKWENCJA: renderer dostaje dwa pola o tym samym kluczu Reacta i o tej
  //   samej komorce w mapie wartosci. Wpis w jednym natychmiast nadpisuje
  //   drugi, uzytkownik widzi "przeskakujaca" tresc, a `validateCustomFields`
  //   zwraca ten sam identyfikator dwa razy, wiec komunikat o brakujacym polu
  //   dubluje sie na ekranie.
  // WYMAGANA POPRAWKA: parser ma pomijac kolejne wystapienia znanego juz `id`
  //   (pierwszy wpis wygrywa), tak jak `formFields.ts`.
  it.fails("DEFEKT: powtorzony identyfikator pola NIE moze przechodzic przez parser", () => {
    const wynik = parseCustomFields([
      { id: "nip", type: "text", labelPl: "NIP" },
      { id: "nip", type: "email", labelPl: "NIP - kopia" },
    ]);

    expect(wynik).toHaveLength(1);
  });
});

describe("pickI18n - MARTWA kopia lancucha jezykowego (przypiecie stanu na dzis)", () => {
  it("brak calego obiektu tresci zwraca wartosc zapasowa", () => {
    expect(pickI18n(undefined, "title", "pl", "zapas")).toBe("zapas");
  });

  it("klucz w biezacym jezyku wygrywa", () => {
    expect(pickI18n({ title_pl: "Tytul", title_en: "Title" }, "title", "en")).toBe("Title");
    expect(pickI18n({ title_pl: "Tytul", title_en: "Title" }, "title", "pl")).toBe("Tytul");
  });

  it("pusty lub bialy napis w biezacym jezyku cofa sie do polskiego", () => {
    expect(pickI18n({ title_pl: "Tytul", title_en: "   " }, "title", "en")).toBe("Tytul");
  });

  it("wartosc nie bedaca napisem jest ignorowana tak samo jak brak klucza", () => {
    expect(pickI18n({ title_en: 7, title_pl: "Tytul" }, "title", "en")).toBe("Tytul");
  });

  it("brak obu wersji daje wartosc zapasowa, a domyslna zapasowa to pusty napis", () => {
    expect(pickI18n({ inne: "x" }, "title", "en", "zapas")).toBe("zapas");
    expect(pickI18n({ inne: "x" }, "title", "en")).toBe("");
  });
});

describe("resolveCustomFieldLabel - lancuch etykiety", () => {
  it("angielski bierze labelEn, polski bierze labelPl", () => {
    const f = pole({ id: "nip", labelPl: "NIP", labelEn: "Tax ID" });

    expect(resolveCustomFieldLabel(f, "en")).toBe("Tax ID");
    expect(resolveCustomFieldLabel(f, "pl")).toBe("NIP");
  });

  it("brak wersji angielskiej cofa etykiete do polskiej, a nie gasi pola", () => {
    expect(resolveCustomFieldLabel(pole({ id: "nip", labelPl: "NIP" }), "en")).toBe("NIP");
  });

  it("brak wersji polskiej cofa etykiete do angielskiej", () => {
    expect(resolveCustomFieldLabel(pole({ id: "nip", labelEn: "Tax ID" }), "pl")).toBe("Tax ID");
  });

  it("etykieta zlozona z samych spacji nie liczy sie jako wypelniona", () => {
    const f = pole({ id: "nip", labelPl: "  ", labelEn: "Tax ID" });

    expect(resolveCustomFieldLabel(f, "pl")).toBe("Tax ID");
  });

  it("brak obu etykiet konczy lancuch na identyfikatorze pola (stan na dzis)", () => {
    expect(resolveCustomFieldLabel(pole({ id: "nip_firmy" }), "pl")).toBe("nip_firmy");
  });
});

describe("resolveCustomFieldPlaceholder - lancuch podpowiedzi", () => {
  it("angielski bierze placeholderEn, polski placeholderPl", () => {
    const f = pole({
      id: "nip",
      placeholderPl: "np. 1234567890",
      placeholderEn: "e.g. 1234567890",
    });

    expect(resolveCustomFieldPlaceholder(f, "en")).toBe("e.g. 1234567890");
    expect(resolveCustomFieldPlaceholder(f, "pl")).toBe("np. 1234567890");
  });

  it("brak wersji w biezacym jezyku cofa sie do drugiej wersji", () => {
    expect(resolveCustomFieldPlaceholder(pole({ id: "a", placeholderPl: "PL" }), "en")).toBe("PL");
    expect(resolveCustomFieldPlaceholder(pole({ id: "a", placeholderEn: "EN" }), "pl")).toBe("EN");
  });

  it("bialy napis nie liczy sie jako podpowiedz", () => {
    const f = pole({ id: "a", placeholderEn: "   ", placeholderPl: "PL" });

    expect(resolveCustomFieldPlaceholder(f, "en")).toBe("PL");
  });

  it("brak obu podpowiedzi daje PUSTY napis - w odroznieniu od etykiety NIE cofa sie do id", () => {
    expect(resolveCustomFieldPlaceholder(pole({ id: "nip" }), "pl")).toBe("");
  });
});

describe("validateCustomFields - bramka wysylki po stronie klienta", () => {
  const wymagane = pole({ id: "nip", labelPl: "NIP", required: true });

  it("wymagane i puste blokuje wysylke i wskazuje identyfikator pola", () => {
    expect(validateCustomFields([wymagane], {})).toEqual(["nip"]);
    expect(validateCustomFields([wymagane], { nip: "" })).toEqual(["nip"]);
  });

  it("same biale znaki nie zaliczaja wymaganego pola", () => {
    expect(validateCustomFields([wymagane], { nip: "   \n\t " })).toEqual(["nip"]);
  });

  it("wypelnione wymagane pole przepuszcza wysylke", () => {
    expect(validateCustomFields([wymagane], { nip: "1234567890" })).toEqual([]);
  });

  it("pole nieobowiazkowe nigdy nie blokuje, nawet puste", () => {
    expect(validateCustomFields([pole({ id: "uwagi" })], { uwagi: "" })).toEqual([]);
  });

  it("zaznaczona zgoda ('1') zalicza wymagany checkbox, odznaczona ('') nie", () => {
    const zgoda = pole({ id: "zgoda", type: "checkbox", required: true });

    expect(validateCustomFields([zgoda], { zgoda: "1" })).toEqual([]);
    expect(validateCustomFields([zgoda], { zgoda: "" })).toEqual(["zgoda"]);
  });

  it("zglasza WSZYSTKIE brakujace pola w kolejnosci konfiguracji", () => {
    const lista = [
      pole({ id: "a", required: true }),
      pole({ id: "b" }),
      pole({ id: "c", required: true }),
    ];

    expect(validateCustomFields(lista, { b: "" })).toEqual(["a", "c"]);
  });

  it("pusta konfiguracja nie ma czego blokowac", () => {
    expect(validateCustomFields([], { cokolwiek: "x" })).toEqual([]);
  });
});

describe("CustomFieldsRenderer - siatka i pola tekstowe", () => {
  it("pusta konfiguracja nie zostawia w DOM ani jednego wezla", () => {
    const { container } = render(<Oprawa fields={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("siatka ma dwie kolumny od breakpointu sm i przyjmuje dodatkowa klase", () => {
    const { container } = render(
      <Oprawa fields={[pole({ id: "a", labelPl: "A" })]} className="mt-4" />,
    );
    const siatka = container.firstElementChild;

    expect(siatka?.className).toContain("grid gap-2 sm:grid-cols-2");
    expect(siatka?.className).toContain("mt-4");
  });

  it("typ pola przeklada sie na atrybut type kontrolki", () => {
    render(
      <Oprawa
        fields={[
          pole({ id: "a", type: "text", labelPl: "Tekst" }),
          pole({ id: "b", type: "email", labelPl: "Mail" }),
          pole({ id: "c", type: "tel", labelPl: "Telefon" }),
          pole({ id: "d", type: "url", labelPl: "Strona" }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Tekst").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("Mail").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Telefon").getAttribute("type")).toBe("tel");
    expect(screen.getByLabelText("Strona").getAttribute("type")).toBe("url");
  });

  it("wpisana wartosc wraca do rodzica pod identyfikatorem pola i wyswietla sie z powrotem", () => {
    const zapis: [string, string][] = [];
    render(
      <Oprawa
        fields={[pole({ id: "nip", labelPl: "NIP" })]}
        onEach={(id, value) => zapis.push([id, value])}
      />,
    );

    const wejscie = screen.getByLabelText("NIP");
    fireEvent.change(wejscie, { target: { value: "1234567890" } });

    expect(zapis).toEqual([["nip", "1234567890"]]);
    expect((wejscie as HTMLInputElement).value).toBe("1234567890");
  });

  it("wartosc z mapy rodzica jest wyswietlana od pierwszego renderu", () => {
    render(<Oprawa fields={[pole({ id: "nip", labelPl: "NIP" })]} initial={{ nip: "999" }} />);

    expect((screen.getByLabelText("NIP") as HTMLInputElement).value).toBe("999");
  });

  it("brak wpisu w mapie wartosci daje pole PUSTE, a nie niekontrolowane", () => {
    render(<Oprawa fields={[pole({ id: "nip", labelPl: "NIP" })]} />);

    expect((screen.getByLabelText("NIP") as HTMLInputElement).value).toBe("");
  });

  it("podpowiedz wymaganego pola tekstowego dostaje doklejona gwiazdke", () => {
    render(
      <Oprawa
        fields={[
          pole({ id: "nip", labelPl: "NIP", placeholderPl: "np. 1234567890", required: true }),
        ]}
      />,
    );

    expect(screen.getByLabelText("NIP").getAttribute("placeholder")).toBe("np. 1234567890 *");
  });

  it("podpowiedz pola nieobowiazkowego zostaje bez gwiazdki", () => {
    render(
      <Oprawa fields={[pole({ id: "nip", labelPl: "NIP", placeholderPl: "np. 1234567890" })]} />,
    );

    expect(screen.getByLabelText("NIP").getAttribute("placeholder")).toBe("np. 1234567890");
  });

  it("pole bez podpowiedzi uzywa etykiety jako podpowiedzi", () => {
    render(<Oprawa fields={[pole({ id: "nip", labelPl: "NIP" })]} />);

    expect(screen.getByLabelText("NIP").getAttribute("placeholder")).toBe("NIP");
  });

  it("wymagalnosc trafia do aria-required, a jej brak nie zostawia atrybutu", () => {
    render(
      <Oprawa
        fields={[
          pole({ id: "a", labelPl: "Wymagane", required: true }),
          pole({ id: "b", labelPl: "Opcjonalne" }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Wymagane").getAttribute("aria-required")).toBe("true");
    expect(screen.getByLabelText("Opcjonalne").hasAttribute("aria-required")).toBe(false);
  });

  it("limit znakow pola tekstowego domyslnie wynosi 300 i daje sie nadpisac konfiguracja", () => {
    render(
      <Oprawa
        fields={[
          pole({ id: "a", labelPl: "Domyslne" }),
          pole({ id: "b", labelPl: "Wlasne", maxLength: 25 }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Domyslne").getAttribute("maxlength")).toBe("300");
    expect(screen.getByLabelText("Wlasne").getAttribute("maxlength")).toBe("25");
  });

  it("bez wlasnej klasy pole dostaje styl bazowy formularzy", () => {
    render(<Oprawa fields={[pole({ id: "a", labelPl: "A" })]} />);

    expect(screen.getByLabelText("A").className).toBe(
      "px-3 py-2 rounded border border-input bg-background text-sm w-full",
    );
  });

  it("klasa podana przez widget CALKOWICIE zastepuje styl bazowy", () => {
    render(<Oprawa fields={[pole({ id: "a", labelPl: "A" })]} inputClassName="moja-klasa" />);

    expect(screen.getByLabelText("A").className).toBe("moja-klasa");
  });

  it("styl i cel edycji z buildera doklejaja sie do kontrolki", () => {
    render(
      <Oprawa
        fields={[pole({ id: "a", labelPl: "A" })]}
        inputStyle={{ fontSize: "13px" }}
        inputEditTarget="widget-join-us"
      />,
    );
    const wejscie = screen.getByLabelText("A");

    expect(wejscie.getAttribute("style")).toContain("font-size: 13px");
    expect(wejscie.getAttribute("data-edit-target")).toBe("widget-join-us");
  });

  // DEFEKT: WYMAGANE POLE TEKSTOWE TRACI ZNACZNIK WYMAGALNOSCI PO PIERWSZYM ZNAKU.
  //
  // WEJSCIE: pole tekstowe z `required: true` i wlasna podpowiedzia.
  // CO PSUJE: gałąź tekstowa (src/lib/builder/formFieldConfig.tsx:261) sklada
  //   gwiazdke W TRESC PODPOWIEDZI (`${placeholder} *`), podczas gdy droplista
  //   (:204) i zgoda (:240) rysuja ja jako trwaly `<span class="text-destructive">*</span>`
  //   obok widocznej etykiety. Pole tekstowe nie ma zadnej widocznej etykiety -
  //   caly jego opis siedzi w podpowiedzi, a ta ZNIKA, gdy uzytkownik zacznie pisac.
  // KONSEKWENCJA: w tym samym formularzu dwa pola wymagane sygnalizuja
  //   wymagalnosc na dwa rozne sposoby, a ten slabszy dziala tylko do pierwszego
  //   znaku. Po bledzie walidacji uzytkownik widzi wypelniona liste pol i nie ma
  //   czym odroznic, ktore z nich sa obowiazkowe. Gwiazdka w podpowiedzi jest
  //   tez nieczytelna dla czytnika ekranu - `aria-label` niesie sama etykiete.
  // WYMAGANA POPRAWKA: gałąź tekstowa ma rysowac ten sam trwaly znacznik co
  //   droplista i zgoda (widoczna etykieta + `<span class="text-destructive">*</span>`),
  //   a podpowiedz zostawic wylacznie na podpowiedz.
  it.fails("DEFEKT: wymagane pole tekstowe MUSI miec trwaly znacznik wymagalnosci", () => {
    const { container } = render(
      <Oprawa
        fields={[
          pole({ id: "nip", labelPl: "NIP", placeholderPl: "np. 1234567890", required: true }),
        ]}
      />,
    );

    expect(container.querySelector("span.text-destructive")).not.toBeNull();
  });

  // DEFEKT: SUROWY IDENTYFIKATOR POLA TRAFIA DO INTERFEJSU UZYTKOWNIKA.
  //
  // WEJSCIE: wpis konfiguracji bez `labelPl` i bez `labelEn` - realny, bo
  //   parser (:41-55) wymaga WYLACZNIE `id` i `type`, wiec taki wiersz
  //   przechodzi przez brame bez slowa ostrzezenia.
  // CO PSUJE: `resolveCustomFieldLabel` (src/lib/builder/formFieldConfig.tsx:112-117)
  //   konczy lancuch zapasowy na `f.id`. Renderer wpisuje ten napis w
  //   `aria-label` (:264) ORAZ - przy braku podpowiedzi - w `placeholder` (:261).
  // KONSEKWENCJA: uzytkownik obu wersji jezykowych widzi w formularzu techniczny
  //   klucz bazy ("nip_firmy", "utm_source"), a czytnik ekranu odczytuje go jako
  //   nazwe pola. Identyfikator nie jest tlumaczony i nigdy nie bedzie, bo nie ma
  //   go w zadnym slowniku - to nie jest degradacja jezykowa, tylko wyciek
  //   nazewnictwa wewnetrznego na publiczna strone.
  // WYMAGANA POPRAWKA: przy braku OBU etykiet pole nie powinno sie renderowac
  //   (blad konfiguracji widoczny w panelu), a w ostatecznosci uzywac neutralnej
  //   etykiety ze slownika zamiast `f.id`.
  it.fails("DEFEKT: pole bez etykiet NIE moze pokazywac surowego identyfikatora", () => {
    render(<Oprawa fields={[pole({ id: "nip_firmy" })]} />);

    expect(screen.queryByLabelText("nip_firmy")).toBeNull();
  });
});

describe("CustomFieldsRenderer - droplista", () => {
  const opcje = [
    { value: "malo", labelPl: "Do 10 osob", labelEn: "Up to 10" },
    { value: "duzo", labelPl: "Powyzej 10 osob", labelEn: "Over 10" },
  ];

  it("etykieta droplisty jest widoczna, a wybor wraca do rodzica", () => {
    const zapis: [string, string][] = [];
    render(
      <Oprawa
        fields={[
          pole({ id: "wielkosc", type: "select", labelPl: "Wielkosc firmy", options: opcje }),
        ]}
        onEach={(id, value) => zapis.push([id, value])}
      />,
    );

    expect(screen.getByText("Wielkosc firmy")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Wielkosc firmy"), { target: { value: "duzo" } });

    expect(zapis).toEqual([["wielkosc", "duzo"]]);
  });

  it("etykiety opcji ida za jezykiem interfejsu", () => {
    render(
      <Oprawa
        lang="en"
        fields={[pole({ id: "w", type: "select", labelEn: "Company size", options: opcje })]}
      />,
    );

    expect(screen.getByRole("option", { name: "Up to 10" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Over 10" })).toBeInTheDocument();
  });

  it("opcja bez etykiety w biezacym jezyku cofa sie do drugiej wersji", () => {
    render(
      <Oprawa
        lang="en"
        fields={[
          pole({
            id: "w",
            type: "select",
            labelEn: "Size",
            options: [{ value: "x", labelPl: "Tylko po polsku" }],
          }),
        ]}
      />,
    );

    expect(screen.getByRole("option", { name: "Tylko po polsku" })).toBeInTheDocument();
  });

  it("opcja bez zadnej etykiety pokazuje swoja wartosc, zeby nie byla pusta", () => {
    render(
      <Oprawa
        fields={[
          pole({ id: "w", type: "select", labelPl: "Rozmiar", options: [{ value: "sme" }] }),
        ]}
      />,
    );

    expect(screen.getByRole("option", { name: "sme" })).toBeInTheDocument();
  });

  it("droplista bez opcji renderuje sie z samym placeholderem, a nie wybucha", () => {
    render(<Oprawa fields={[pole({ id: "w", type: "select", labelPl: "Rozmiar" })]} />);

    expect(screen.getByLabelText("Rozmiar")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("brak wlasnej podpowiedzi daje domyslne zaproszenie w jezyku interfejsu", () => {
    const { unmount } = render(
      <Oprawa fields={[pole({ id: "w", type: "select", labelPl: "Rozmiar", options: opcje })]} />,
    );
    expect(screen.getByRole("option", { name: "Wybierz..." })).toBeInTheDocument();
    unmount();

    render(
      <Oprawa
        lang="en"
        fields={[pole({ id: "w", type: "select", labelEn: "Size", options: opcje })]}
      />,
    );
    expect(screen.getByRole("option", { name: "Choose..." })).toBeInTheDocument();
  });

  it("wlasna podpowiedz wypiera domyslne zaproszenie", () => {
    render(
      <Oprawa
        fields={[
          pole({
            id: "w",
            type: "select",
            labelPl: "Rozmiar",
            placeholderPl: "Wskaz przedzial",
            options: opcje,
          }),
        ]}
      />,
    );

    expect(screen.getByRole("option", { name: "Wskaz przedzial" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Wybierz..." })).toBeNull();
  });

  it("wymagana droplista dostaje gwiazdke i aria-required", () => {
    const { container } = render(
      <Oprawa
        fields={[
          pole({ id: "w", type: "select", labelPl: "Rozmiar", required: true, options: opcje }),
        ]}
      />,
    );

    expect(container.querySelector("span.text-destructive")?.textContent).toBe("*");
    expect(screen.getByLabelText("Rozmiar").getAttribute("aria-required")).toBe("true");
  });

  it("droplista nieobowiazkowa nie rysuje gwiazdki", () => {
    const { container } = render(
      <Oprawa fields={[pole({ id: "w", type: "select", labelPl: "Rozmiar", options: opcje })]} />,
    );

    expect(container.querySelector("span.text-destructive")).toBeNull();
  });

  it("styl, klasa i cel edycji dochodza do atomu droplisty", () => {
    render(
      <Oprawa
        fields={[pole({ id: "w", type: "select", labelPl: "Rozmiar", options: opcje })]}
        inputClassName="klasa-droplisty"
        inputStyle={{ fontSize: "11px" }}
        inputEditTarget="widget-join-us"
      />,
    );
    const lista = screen.getByLabelText("Rozmiar");

    expect(lista.className).toBe("klasa-droplisty");
    expect(lista.getAttribute("style")).toContain("font-size: 11px");
    expect(lista.getAttribute("data-edit-target")).toBe("widget-join-us");
  });

  it("wybrana wartosc z mapy rodzica jest ustawiona na dropliscie", () => {
    render(
      <Oprawa
        fields={[pole({ id: "w", type: "select", labelPl: "Rozmiar", options: opcje })]}
        initial={{ w: "malo" }}
      />,
    );

    expect((screen.getByLabelText("Rozmiar") as HTMLSelectElement).value).toBe("malo");
  });
});

describe("CustomFieldsRenderer - zgoda (checkbox)", () => {
  const zgoda = pole({ id: "zgoda", type: "checkbox", labelPl: "Zgoda na kontakt" });

  it("zaznaczenie zapisuje wartosc '1', a odznaczenie pusty napis", () => {
    const zapis: [string, string][] = [];
    render(<Oprawa fields={[zgoda]} onEach={(id, value) => zapis.push([id, value])} />);
    const pudelko = screen.getByRole("checkbox");

    fireEvent.click(pudelko);
    expect(zapis).toEqual([["zgoda", "1"]]);

    fireEvent.click(pudelko);
    expect(zapis).toEqual([
      ["zgoda", "1"],
      ["zgoda", ""],
    ]);
  });

  it("wartosc '1' i wartosc 'true' obie znacza ZAZNACZONE", () => {
    const { unmount } = render(<Oprawa fields={[zgoda]} initial={{ zgoda: "1" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    unmount();

    render(<Oprawa fields={[zgoda]} initial={{ zgoda: "true" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("kazda inna wartosc znaczy ODZNACZONE", () => {
    render(<Oprawa fields={[zgoda]} initial={{ zgoda: "tak" }} />);

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("etykieta zgody jest klikalnym opisem obok pudelka i zajmuje cala szerokosc siatki", () => {
    const { container } = render(<Oprawa fields={[zgoda]} />);
    const etykieta = container.querySelector("label");

    expect(etykieta?.textContent).toBe("Zgoda na kontakt");
    expect(etykieta?.className).toContain("sm:col-span-2");
  });

  it("wymagana zgoda dostaje gwiazdke i aria-required", () => {
    const { container } = render(<Oprawa fields={[pole({ ...zgoda, required: true })]} />);

    expect(container.querySelector("span.text-destructive")?.textContent).toBe("*");
    expect(screen.getByRole("checkbox").getAttribute("aria-required")).toBe("true");
  });

  it("zgoda nieobowiazkowa nie ma ani gwiazdki, ani aria-required", () => {
    const { container } = render(<Oprawa fields={[zgoda]} />);

    expect(container.querySelector("span.text-destructive")).toBeNull();
    expect(screen.getByRole("checkbox").hasAttribute("aria-required")).toBe(false);
  });

  it("styl i cel edycji ladują na ETYKIECIE, nie na samym pudelku", () => {
    // Asymetria wobec pozostalych typow: dla zgody nosnikiem stylu buildera
    // jest <label>, bo natywny checkbox ma stala wielkosc.
    const { container } = render(
      <Oprawa
        fields={[zgoda]}
        inputStyle={{ fontSize: "12px" }}
        inputEditTarget="widget-join-us"
      />,
    );
    const etykieta = container.querySelector("label");

    expect(etykieta?.getAttribute("style")).toContain("font-size: 12px");
    expect(etykieta?.getAttribute("data-edit-target")).toBe("widget-join-us");
    expect(screen.getByRole("checkbox").hasAttribute("data-edit-target")).toBe(false);
  });
});

describe("CustomFieldsRenderer - dluzsza wiadomosc (textarea)", () => {
  it("pole wiadomosci zajmuje obie kolumny siatki i niesie etykiete", () => {
    const { container } = render(
      <Oprawa fields={[pole({ id: "opis", type: "textarea", labelPl: "Opis potrzeby" })]} />,
    );

    expect(screen.getByLabelText("Opis potrzeby").tagName).toBe("TEXTAREA");
    expect(container.querySelector(".sm\\:col-span-2")).not.toBeNull();
  });

  it("wpisana tresc wraca do rodzica pod identyfikatorem pola", () => {
    const zapis: [string, string][] = [];
    render(
      <Oprawa
        fields={[pole({ id: "opis", type: "textarea", labelPl: "Opis" })]}
        onEach={(id, value) => zapis.push([id, value])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Opis"), {
      target: { value: "Prosze o kontakt na biuro@example.com" },
    });

    expect(zapis).toEqual([["opis", "Prosze o kontakt na biuro@example.com"]]);
  });

  it("limit znakow wiadomosci domyslnie wynosi 2000 i daje sie nadpisac", () => {
    const { unmount } = render(
      <Oprawa fields={[pole({ id: "opis", type: "textarea", labelPl: "Opis" })]} />,
    );
    expect(screen.getByLabelText("Opis").getAttribute("maxlength")).toBe("2000");
    unmount();

    render(
      <Oprawa fields={[pole({ id: "opis", type: "textarea", labelPl: "Opis", maxLength: 140 })]} />,
    );
    expect(screen.getByLabelText("Opis").getAttribute("maxlength")).toBe("140");
  });

  it("podpowiedz, wymagalnosc, styl i cel edycji dochodza do textarei", () => {
    render(
      <Oprawa
        fields={[
          pole({
            id: "opis",
            type: "textarea",
            labelPl: "Opis",
            placeholderPl: "Napisz kilka zdan",
            required: true,
          }),
        ]}
        inputStyle={{ fontSize: "15px" }}
        inputEditTarget="widget-join-us"
      />,
    );
    const obszar = screen.getByLabelText("Opis");

    expect(obszar.getAttribute("placeholder")).toBe("Napisz kilka zdan");
    expect(obszar.hasAttribute("required")).toBe(true);
    expect(obszar.getAttribute("style")).toContain("font-size: 15px");
    expect(obszar.getAttribute("data-edit-target")).toBe("widget-join-us");
  });
});

describe("CustomFieldsRenderer - wiele pol naraz", () => {
  it("cala konfiguracja z panelu przechodzi droga: parser -> render -> walidacja", () => {
    const fields = parseCustomFields([
      '{"id":"nip","type":"text","labelPl":"NIP","required":true}',
      '{"id":"wielkosc","type":"select","labelPl":"Wielkosc","options":[{"value":"sme","labelPl":"MSP"}]}',
      '{"id":"zgoda","type":"checkbox","labelPl":"Zgoda","required":true}',
      '{"id":"opis","type":"textarea","labelPl":"Opis"}',
      "{smiec}",
    ]);

    expect(fields.map((f) => f.id)).toEqual(["nip", "wielkosc", "zgoda", "opis"]);

    render(<Oprawa fields={fields} initial={{ nip: "1234567890", zgoda: "1" }} />);

    expect(screen.getByLabelText("NIP")).toBeInTheDocument();
    expect(screen.getByLabelText("Wielkosc")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Opis")).toBeInTheDocument();
    expect(validateCustomFields(fields, { nip: "1234567890", zgoda: "1" })).toEqual([]);
    expect(validateCustomFields(fields, { nip: "1234567890" })).toEqual(["zgoda"]);
  });
});
