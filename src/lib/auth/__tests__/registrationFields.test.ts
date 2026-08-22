// Globalna konfiguracja pól rejestracji i kanoniczne `user_metadata` konta.
//
// CO TEN PLIK DOWODZI. `registrationFields.ts` rozstrzyga dwie rzeczy, których
// pomyłka jest widoczna dopiero PO założeniu konta, czyli wtedy, gdy nie da się
// już jej cofnąć bez kontaktu z administratorem:
//
//   1. KTÓRE POLA SĄ WŁĄCZONE I WYMAGANE. Ten sam rejestr obsługuje stronę
//      /login, popup rejestracji, widget w builderze i formularz newslettera.
//      Jeśli `isEnabled`/`isRequired` przestaną czytać zapis administratora,
//      formularz albo przepuści konto bez danych wymaganych regulaminem, albo
//      zablokuje rejestrację na poprawnych danych. Osobno pilnujemy pól
//      ZABLOKOWANYCH (e-mail, hasło, powtórzenie hasła): ich nie wolno wyłączyć
//      ani odznaczyć jako wymagane ŻADNYM zapisem w bazie - konto bez hasła
//      albo bez adresu jest kontem, do którego nikt się nie zaloguje.
//   2. CO LĄDUJE W `user_metadata` PRZY `signUp()`. Klucze tej mapy przepisuje
//      trigger `handle_new_user` do `public.profiles`, więc literówka w nazwie
//      klucza to trwale puste pole profilu. Dowodzimy granic: pole puste, samo
//      z odstępów, brak pola, oraz zgody marketingowej, która musi być JAWNYM
//      `true`, a nie czymkolwiek prawdziwym (RODO - zgody się nie domyślamy).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ SCALANIA REJESTRU: `resolvePopupFields`, `str`/`bool`, kolejność
//   `POPUP_FIELD_KEYS` i domyślne etykiety mają `src/lib/newsletter/__tests__/`
//   (popupFields). Tutaj sprawdzamy wyłącznie WARSTWĘ API rejestracji nad nim.
// - PRECEDENCJI ETYKIET W WIDGETACH NEWSLETTERA: to jest przedmiotem
//   `src/lib/newsletter/__tests__/newsletterFieldLabels.test.ts`.
// - RENDEROWANIA FORMULARZY: `src/components/auth/__tests__/AuthPortal.test.tsx`
//   i `src/components/blocks/__tests__/authFormBlocks.test.tsx`.
// - WARSTWY DANYCH: `useNewsletterSettings` (zapytanie, defaulty wiersza) ma
//   testy przy panelu newslettera; tutaj jest atrapą.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { POPUP_FIELD_KEYS, type PopupFieldConfig } from "@/lib/newsletter/popupFields";

const h = vi.hoisted(() => ({
  /** To, co panel administratora ma zapisane w `newsletter_settings.popup_fields`. */
  popupFields: undefined as unknown,
  /** `false` = zapytanie jeszcze w locie (brak `data`). */
  loaded: true,
}));

vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () =>
    h.loaded ? { data: { popup_fields: h.popupFields } } : { data: undefined },
}));

import {
  buildRegistrationFieldsApi,
  buildSignupMetadata,
  useRegistrationFields,
  type RegistrationValues,
} from "@/lib/auth/registrationFields";

/** Adres wyłącznie z domeny testowej - RODO, żadnych realnych osób. */
const EMAIL = "rejestracja@example.com";

/** Minimalny poprawny wniosek rejestracyjny - baza dla przypadków granicznych. */
function values(patch: Partial<RegistrationValues> = {}): RegistrationValues {
  return { email: EMAIL, ...patch };
}

/** Metadane dla domyślnego wniosku, z jawnym źródłem i językiem. */
function metadata(patch: Partial<RegistrationValues> = {}, lang: "pl" | "en" = "pl") {
  return buildSignupMetadata(values(patch), { lang, source: "test" });
}

afterEach(() => {
  cleanup();
  h.popupFields = undefined;
  h.loaded = true;
});

describe("rejestr pól rejestracji: kształt listy", () => {
  it("bez zapisu w bazie zwraca WSZYSTKIE pola rejestru w kolejności rejestru", () => {
    // Kolejność jest częścią kontraktu: podgląd w adminie i strona publiczna
    // muszą pokazywać identyczny układ formularza.
    const api = buildRegistrationFieldsApi(null, "pl");
    expect(api.fields.map((f) => f.key)).toEqual([...POPUP_FIELD_KEYS]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["obiekt zamiast tablicy", { first_name: { enabled: false } }],
    ["napis", "[]"],
    ["liczba", 7],
  ])("zapis w nieoczekiwanym kształcie (%s) nie gubi ani jednego pola", (_opis, raw) => {
    const api = buildRegistrationFieldsApi(raw, "pl");
    expect(api.fields).toHaveLength(POPUP_FIELD_KEYS.length);
    // Awaria odczytu konfiguracji nie może zamienić rejestracji w pusty
    // formularz - domyślnie widoczne pola muszą zostać.
    expect(api.visible.length).toBeGreaterThan(0);
  });

  it("wpis o kluczu spoza rejestru jest ignorowany, a nie dopisywany do formularza", () => {
    const api = buildRegistrationFieldsApi(
      [{ key: "pesel", enabled: true, required: true, label_pl: "PESEL" }],
      "pl",
    );
    expect(api.fields.map((f) => f.key)).toEqual([...POPUP_FIELD_KEYS]);
    expect(api.get("email")).toBeDefined();
  });

  it("`visible` to dokładnie pola włączone, a nie cała lista", () => {
    const api = buildRegistrationFieldsApi(
      [
        { key: "phone", enabled: false },
        { key: "linkedin", enabled: false },
      ],
      "pl",
    );
    expect(api.visible.every((f) => f.enabled)).toBe(true);
    expect(api.visible.map((f) => f.key)).not.toContain("phone");
    expect(api.fields.map((f) => f.key)).toContain("phone");
  });
});

describe("rejestr pól rejestracji: włączone i wymagane", () => {
  it("wyłączenie pola opcjonalnego jest respektowane", () => {
    const api = buildRegistrationFieldsApi([{ key: "job", enabled: false }], "pl");
    expect(api.isEnabled("job")).toBe(false);
    expect(api.isEnabled("company")).toBe(true);
  });

  it("podniesienie pola do wymaganego jest respektowane", () => {
    const api = buildRegistrationFieldsApi([{ key: "company", required: true }], "pl");
    expect(api.isRequired("company")).toBe(true);
    expect(api.isRequired("job")).toBe(false);
  });

  it.each(["email", "password", "password_confirm"] as const)(
    "pola zablokowanego (%s) NIE DA SIĘ wyłączyć zapisem w bazie",
    (key) => {
      // Gdyby ten zapis przechodził, formularz rejestracji potrafiłby założyć
      // konto bez hasła albo bez adresu - konto, do którego nikt się nie
      // zaloguje i którego nie da się odzyskać.
      const api = buildRegistrationFieldsApi([{ key, enabled: false, required: false }], "pl");
      expect(api.isEnabled(key)).toBe(true);
      expect(api.isRequired(key)).toBe(true);
    },
  );

  it("wartość spoza typu (napis „true”) nie udaje wartości logicznej", () => {
    // `bool()` przyjmuje TYLKO wartość logiczną; „true” z ręcznie sklejonego
    // JSON-a musi zostawić default, a nie po cichu włączyć pole.
    const api = buildRegistrationFieldsApi(
      [{ key: "phone", enabled: "false", required: "true" }],
      "pl",
    );
    expect(api.isEnabled("phone")).toBe(true);
    expect(api.isRequired("phone")).toBe(false);
  });
});

describe("rejestr pól rejestracji: etykiety i podpowiedzi", () => {
  it("etykieta idzie za językiem, w obu kierunkach", () => {
    const raw = [{ key: "company", label_pl: "Organizacja", label_en: "Organisation" }];
    expect(buildRegistrationFieldsApi(raw, "pl").label("company")).toBe("Organizacja");
    expect(buildRegistrationFieldsApi(raw, "en").label("company")).toBe("Organisation");
  });

  it("etykieta z samych odstępów ustępuje etykiecie fabrycznej", () => {
    // Pusta etykieta to pole bez opisu; formularz musi wrócić do fabrycznej.
    const api = buildRegistrationFieldsApi([{ key: "company", label_pl: "   " }], "pl");
    expect(api.label("company").trim()).not.toBe("");
  });

  it("podpowiedź idzie za językiem", () => {
    const api = buildRegistrationFieldsApi(null, "en");
    expect(api.placeholder("first_name")).toBe("Jane");
    expect(buildRegistrationFieldsApi(null, "pl").placeholder("first_name")).toBe("Jan");
  });

  it("pole bez fabrycznej podpowiedzi bierze podpowiedź podaną przez wywołującego", () => {
    // `newsletter_optin` to zgoda (checkbox) - nie ma fabrycznej podpowiedzi,
    // więc pusty wynik MUSI ustąpić zapasowi przekazanemu z formularza.
    const api = buildRegistrationFieldsApi(null, "pl");
    expect(api.placeholder("newsletter_optin")).toBe("");
    expect(api.placeholder("newsletter_optin", "Zapas z formularza")).toBe("Zapas z formularza");
  });

  it("jawnie wyczyszczona podpowiedź ustępuje zapasowi wywołującego", () => {
    const api = buildRegistrationFieldsApi([{ key: "phone", placeholder_pl: "" }], "pl");
    expect(api.placeholder("phone", "+48 000 000 000")).toBe("+48 000 000 000");
  });

  it("podpowiedź z samych odstępów zostaje taka, jaka jest - OPIS STANU FAKTYCZNEGO", () => {
    // To nie jest życzenie, tylko zapis rzeczywistości: `resolvePopupFields`
    // nie przycina podpowiedzi (w przeciwieństwie do etykiet), a `value ||
    // fallback` widzi odstępy jako wartość prawdziwą. Skutek dla użytkownika
    // jest niegroźny (niewidoczna podpowiedź), więc zostawiamy stan faktyczny
    // pod asercją - żeby zmiana tej reguły była zauważona przez test.
    const api = buildRegistrationFieldsApi([{ key: "phone", placeholder_pl: "   " }], "pl");
    expect(api.placeholder("phone", "zapas")).toBe("   ");
  });

  it("`get` zwraca ten sam obiekt, który jest na liście", () => {
    const api = buildRegistrationFieldsApi(null, "pl");
    const fromList = api.fields.find((f) => f.key === "email");
    expect(api.get("email")).toBe(fromList);
  });
});

describe("hook `useRegistrationFields`", () => {
  it("czyta konfigurację z ustawień newslettera", () => {
    h.popupFields = [{ key: "job", enabled: false, label_pl: "Rola" }];
    const { result } = renderHook(() => useRegistrationFields("pl"));
    expect(result.current.isEnabled("job")).toBe(false);
    expect(result.current.label("job")).toBe("Rola");
  });

  it("zapytanie jeszcze w locie daje pełny rejestr fabryczny, nie pusty formularz", () => {
    // Formularz rejestracji renderuje się przed odpowiedzią serwera; gdyby
    // wtedy nie było pól, użytkownik zobaczyłby pusty ekran rejestracji.
    h.loaded = false;
    const { result } = renderHook(() => useRegistrationFields("pl"));
    expect(result.current.fields).toHaveLength(POPUP_FIELD_KEYS.length);
    expect(result.current.isRequired("email")).toBe(true);
  });

  it("zmiana języka przelicza etykiety, a stabilny zapis nie tworzy nowego API", () => {
    h.popupFields = [{ key: "company", label_pl: "Organizacja", label_en: "Organisation" }];
    // Typ propsów musi być SZERSZY niż wartość początkowa, inaczej `rerender`
    // z drugim językiem nie kompiluje się.
    const initialProps: { lang: "pl" | "en" } = { lang: "pl" };
    const { result, rerender } = renderHook(
      ({ lang }: { lang: "pl" | "en" }) => useRegistrationFields(lang),
      { initialProps },
    );
    const first = result.current;
    expect(first.label("company")).toBe("Organizacja");

    rerender({ lang: "pl" });
    expect(result.current).toBe(first);

    rerender({ lang: "en" });
    expect(result.current).not.toBe(first);
    expect(result.current.label("company")).toBe("Organisation");
  });
});

describe("`buildSignupMetadata`: nazwa wyświetlana", () => {
  it("imię i nazwisko sklejają się w jedną nazwę", () => {
    const m = metadata({ firstName: "Anna", lastName: "Nowak" });
    expect(m.display_name).toBe("Anna Nowak");
    expect(m.full_name).toBe("Anna Nowak");
    expect(m.first_name).toBe("Anna");
    expect(m.last_name).toBe("Nowak");
  });

  it("same odstępy w imieniu i nazwisku liczą się jako brak", () => {
    const m = metadata({ firstName: "   ", lastName: "\t\n" });
    expect(m.first_name).toBe("");
    expect(m.last_name).toBe("");
    // Brak nazwy nie może dać pustej nazwy wyświetlanej - profil bez nazwy
    // jest w listach i komentarzach nie do zidentyfikowania.
    expect(m.display_name).toBe("rejestracja");
  });

  it("brak pól imienia i nazwiska daje nazwę z części adresu przed małpą", () => {
    // Ta gałąź to `v ?? ""` w `clean()` - wniosek bez pola, nie z pustym polem.
    const m = metadata();
    expect(m.first_name).toBe("");
    expect(m.last_name).toBe("");
    expect(m.display_name).toBe("rejestracja");
    expect(m.full_name).toBe("rejestracja");
  });

  it("samo imię wystarcza - nazwa nie spada do adresu e-mail", () => {
    const m = metadata({ firstName: "Anna" });
    expect(m.display_name).toBe("Anna");
    expect(m.full_name).toBe("Anna");
    expect(m.last_name).toBe("");
  });

  it("samo nazwisko też wystarcza i nie zostawia wiszącego odstępu", () => {
    const m = metadata({ lastName: "Nowak" });
    expect(m.display_name).toBe("Nowak");
    expect(m.full_name).toBe("Nowak");
  });

  it("nazwa wyświetlana nigdy nie zawiera pełnego adresu e-mail", () => {
    // RODO: nazwa wyświetlana jest publiczna (komentarze, lista autorów), więc
    // nie wolno w niej wystawić domeny ani całego adresu.
    const m = metadata();
    expect(m.display_name).not.toContain("@");
    expect(m.display_name).not.toContain("example.com");
  });
});

describe("`buildSignupMetadata`: pola opcjonalne", () => {
  it("wypełnione pola opcjonalne trafiają do metadanych pod kanonicznymi kluczami", () => {
    // `job` wchodzi jako `position` - to nazwa kolumny, którą czyta trigger
    // `handle_new_user`. Pomyłka tutaj daje trwale puste stanowisko w profilu.
    const m = metadata({
      job: "Analityk",
      company: "Przykładowa Organizacja",
      linkedin: "https://example.org/in/konto",
      phone: "+48 000 000 000",
    });
    expect(m.position).toBe("Analityk");
    expect(m.company).toBe("Przykładowa Organizacja");
    expect(m.linkedin).toBe("https://example.org/in/konto");
    expect(m.phone).toBe("+48 000 000 000");
  });

  it("pola opcjonalne są przycinane z odstępów przed zapisem", () => {
    const m = metadata({ job: "  Analityk  ", linkedin: " https://example.org/in/konto " });
    expect(m.position).toBe("Analityk");
    expect(m.linkedin).toBe("https://example.org/in/konto");
  });

  it.each([
    ["puste", ""],
    ["same odstępy", "   "],
  ])("pole opcjonalne %s nie tworzy klucza w metadanych", (_opis, value) => {
    // Nieobecność klucza, a nie pusty napis: trigger nadpisuje kolumnę tylko
    // wtedy, gdy klucz jest, więc pusty napis wyczyściłby dane profilu.
    const m = metadata({ job: value, company: value, linkedin: value, phone: value });
    expect(m).not.toHaveProperty("position");
    expect(m).not.toHaveProperty("company");
    expect(m).not.toHaveProperty("linkedin");
    expect(m).not.toHaveProperty("phone");
  });

  it("brak pól opcjonalnych w ogóle nie tworzy kluczy", () => {
    expect(Object.keys(metadata()).sort()).toEqual([
      "display_name",
      "first_name",
      "full_name",
      "last_name",
      "marketing_opt_in",
      "preferred_language",
      "signup_source",
      "signup_type",
    ]);
  });
});

describe("`buildSignupMetadata`: zgoda marketingowa i pola dodatkowe", () => {
  it("zgoda zapisuje się tylko przy JAWNYM `true`", () => {
    expect(metadata({ newsletterOptIn: true }).marketing_opt_in).toBe(true);
  });

  it.each([
    ["brak pola", undefined],
    ["jawne `false`", false],
  ])("zgoda przy %s jest zapisana jako `false`, nigdy jako brak klucza", (_opis, optIn) => {
    // RODO: zgody się nie domyślamy, ale i nie gubimy - brak klucza w
    // metadanych zostawiłby kolumnę `marketing_opt_in` w profilu na NULL,
    // czyli w stanie „nie wiemy”, którego nie da się rozliczyć.
    const m = metadata({ newsletterOptIn: optIn });
    expect(m).toHaveProperty("marketing_opt_in");
    expect(m.marketing_opt_in).toBe(false);
  });

  it("język i źródło rejestracji zapisują się dosłownie", () => {
    expect(metadata({}, "en").preferred_language).toBe("en");
    expect(metadata().preferred_language).toBe("pl");
    expect(buildSignupMetadata(values(), { lang: "pl", source: "popup" }).signup_source).toBe(
      "popup",
    );
    expect(metadata().signup_type).toBe("reader");
  });

  it("pola dodatkowe trafiają do metadanych, gdy jest co przekazać", () => {
    const m = metadata({ customFields: { ulubiony_temat: "energia" } });
    expect(m.custom_fields).toEqual({ ulubiony_temat: "energia" });
  });

  it.each([
    ["brak mapy", undefined],
    ["pusta mapa", {}],
  ])("pola dodatkowe: %s nie tworzy klucza `custom_fields`", (_opis, customFields) => {
    expect(metadata({ customFields })).not.toHaveProperty("custom_fields");
  });

  it("metadane nie przenoszą hasła ani niczego poza zadeklarowanym zestawem", () => {
    // Metadane użytkownika są czytelne dla samego użytkownika przez API, więc
    // nie może w nich wylądować nic z formularza poza tym, co wymienione.
    const m = metadata({
      firstName: "Anna",
      job: "Analityk",
      customFields: { temat: "energia" },
      newsletterOptIn: true,
    });
    expect(Object.keys(m).sort()).toEqual([
      "custom_fields",
      "display_name",
      "first_name",
      "full_name",
      "last_name",
      "marketing_opt_in",
      "position",
      "preferred_language",
      "signup_source",
      "signup_type",
    ]);
  });
});

describe("spójność rejestru z metadanymi", () => {
  it("każde pole rejestru, które trafia do profilu, ma odpowiednik w metadanych", () => {
    // Bramka na rozjazd: dopisanie pola do rejestru bez dopisania go do
    // `buildSignupMetadata` daje pole, które użytkownik wypełnia, a które
    // nigdy nie dojeżdża do profilu.
    const m = buildSignupMetadata(
      values({
        firstName: "Anna",
        lastName: "Nowak",
        job: "Analityk",
        company: "Przykładowa Organizacja",
        linkedin: "https://example.org/in/konto",
        phone: "+48 000 000 000",
        newsletterOptIn: true,
      }),
      { lang: "pl", source: "login" },
    );
    const mapped: Record<string, string> = {
      first_name: "first_name",
      last_name: "last_name",
      job: "position",
      company: "company",
      linkedin: "linkedin",
      phone: "phone",
      newsletter_optin: "marketing_opt_in",
      email: "display_name",
    };
    const api = buildRegistrationFieldsApi(null, "pl");
    const dataFields = api.fields.filter(
      (f: PopupFieldConfig) => !["password", "password_confirm", "list"].includes(f.key),
    );
    for (const field of dataFields) {
      expect(Object.keys(mapped)).toContain(field.key);
      expect(m).toHaveProperty(mapped[field.key]);
    }
  });
});
