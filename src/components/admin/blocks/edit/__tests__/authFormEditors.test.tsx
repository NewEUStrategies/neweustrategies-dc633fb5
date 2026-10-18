// EDYTORY FORMULARZY KONT (`login-form`, `register-form`, `lost-password-form`,
// `reset-password-form`) - POLA, PRZEŁĄCZNIKI I ZGODNOŚĆ Z RENDEREREM.
//
// PO CO TEN PLIK. Cztery edytory ustawiają teksty, adresy przekierowań
// i widoczność pól formularzy, które renderuje `components/blocks/
// AuthFormBlocks.tsx`. Ten renderer czyta przełączniki przez `readAuthFlag`
// (`lib/content-model/authFormSettings.ts`), który rozumie historyczne
// zapisy „0"/„1"/„tak"/„nie" i pomija `null`. Panel, który czyta je
// `Boolean(x)`, pokazywał „0" jako WŁĄCZONE, a `null` jako WYŁĄCZONE -
// czyli dokładnie odwrotnie niż strona.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każde pole tekstowe ma nazwę dostępną ze swojej etykiety (`<Label
//    htmlFor>`) i zapisuje WŁASNY klucz; `id`, `type` i reszta danych bloku
//    przechodzą bez zmian, a na samym renderze nic się nie zapisuje,
//  * pola z wartością domyślną (przekierowania, linki) pokazują te same
//    domyślne, których użyje renderer, gdy klucza nie ma,
//  * przełącznik zapisuje `boolean`, a odczyt idzie tą samą koercją, tymi
//    samymi aliasami kluczy i z tą samą wartością domyślną, co renderer:
//    „0" to wyłączone, `null` to wartość domyślna, a przy obecnym kluczu
//    kanonicznym schematu zapis trafia właśnie w niego,
//  * tekst w kształcie obiektu nie wchodzi do pola jako „[object Object]",
//    a minimalna długość hasła zapisana słowem pokazuje domyślne 8.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch` (natywny `role="switch"`), `<Link>`
// routera, klient Supabase, kontekst najemcy, `fetch`. i18n PRAWDZIWE.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor, type BlockEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { LoginFormBlock } from "../LoginForm";
import { RegisterFormBlock } from "../RegisterForm";
import { LostPasswordFormBlock } from "../LostPasswordForm";
import { ResetPasswordFormBlock } from "../ResetPasswordForm";

const t = realT("pl");
const af = (key: string) => t(`blocks.editors.authForms.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `af-${type}`, type, data };
}

/** Montaż, akcja, odmontowanie i ostatni zapis - z kontrolą `id` i `type`. */
function zapisPo(Editor: BlockEditor, start: Block, akcja: () => void): Record<string, Json> {
  const { changes, unmount } = renderEditor(Editor, start);
  akcja();
  unmount();
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  const zapis = changes[changes.length - 1];
  expect(zapis.id).toBe(start.id);
  expect(zapis.type).toBe(start.type);
  return zapis.data;
}

const tekst = (etykieta: string) =>
  screen.getByRole("textbox", { name: etykieta }) as HTMLInputElement;
const przelacznik = (etykieta: string) =>
  screen.getByRole("switch", { name: etykieta }) as HTMLInputElement;

type Formularz = readonly [name: string, Editor: BlockEditor, type: BlockType];

const LOGIN: Formularz = ["LoginFormBlock", LoginFormBlock, "login-form"];
const REJESTRACJA: Formularz = ["RegisterFormBlock", RegisterFormBlock, "register-form"];
const ZAPOMNIANE: Formularz = [
  "LostPasswordFormBlock",
  LostPasswordFormBlock,
  "lost-password-form",
];
const NOWE_HASLO: Formularz = [
  "ResetPasswordFormBlock",
  ResetPasswordFormBlock,
  "reset-password-form",
];

/** [formularz, etykieta pola, klucz w dokumencie] - pełna lista pól tekstowych. */
const POLA_TEKSTOWE: ReadonlyArray<readonly [Formularz, string, string]> = [
  ...(["fTitlePl:title_pl", "fTitleEn:title_en", "fSubmitPl:submitLabel_pl"] as const).flatMap(
    (para) => {
      const [etykieta, klucz] = para.split(":");
      return [LOGIN, REJESTRACJA, ZAPOMNIANE, NOWE_HASLO].map(
        (f) => [f, af(etykieta), klucz] as const,
      );
    },
  ),
  [LOGIN, af("fSubtitlePl"), "subtitle_pl"],
  [LOGIN, af("fSubtitleEn"), "subtitle_en"],
  [LOGIN, af("fSubmitEn"), "submitLabel_en"],
  [LOGIN, af("redirectLogin"), "redirectTo"],
  [LOGIN, af("linkRegister"), "registerHref"],
  [LOGIN, af("linkForgot"), "forgotHref"],
  [REJESTRACJA, af("fSubtitlePl"), "subtitle_pl"],
  [REJESTRACJA, af("fSubtitleEn"), "subtitle_en"],
  [REJESTRACJA, af("fSubmitEn"), "submitLabel_en"],
  [REJESTRACJA, af("fConsentPl"), "consentLabel_pl"],
  [REJESTRACJA, af("fConsentEn"), "consentLabel_en"],
  [REJESTRACJA, af("redirectRegister"), "redirectTo"],
  [REJESTRACJA, af("linkLogin"), "loginHref"],
  [ZAPOMNIANE, af("fSubtitlePl"), "subtitle_pl"],
  [ZAPOMNIANE, af("fSubtitleEn"), "subtitle_en"],
  [ZAPOMNIANE, af("fSubmitEn"), "submitLabel_en"],
  [ZAPOMNIANE, af("resetPageLink"), "redirectTo"],
  [ZAPOMNIANE, af("linkBackToLogin"), "loginHref"],
  [NOWE_HASLO, af("fSubmitEn"), "submitLabel_en"],
  [NOWE_HASLO, af("redirectSave"), "redirectTo"],
];

describe("pola tekstowe - nazwa z etykiety i zapis WŁASNEGO klucza", () => {
  it.each(POLA_TEKSTOWE)("%s: „%s” zapisuje `%s`", ([, Editor, type], etykieta, klucz) => {
    const start = blok(type, { variant: "card", notatka: "z importu" });
    const zapis = zapisPo(Editor, start, () =>
      fireEvent.change(tekst(etykieta), { target: { value: "Wpis redakcji" } }),
    );
    expect(zapis).toEqual({ variant: "card", notatka: "z importu", [klucz]: "Wpis redakcji" });
  });

  it.each([LOGIN, REJESTRACJA, ZAPOMNIANE, NOWE_HASLO])(
    "%s nie zapisuje niczego na samym renderze",
    (_n, Editor, type) => {
      const { changes } = renderEditor(Editor, blok(type, {}));
      expect(changes).toEqual([]);
    },
  );
});

describe("domyślne wartości - te same, których użyje renderer", () => {
  it.each<readonly [Formularz, string, string]>([
    [LOGIN, af("redirectLogin"), "/"],
    [LOGIN, af("linkRegister"), "?mode=signup"],
    [LOGIN, af("linkForgot"), "?mode=reset"],
    [REJESTRACJA, af("redirectRegister"), "/"],
    [REJESTRACJA, af("linkLogin"), "?mode=signin"],
    [ZAPOMNIANE, af("resetPageLink"), "/reset-password"],
    [ZAPOMNIANE, af("linkBackToLogin"), "?mode=signin"],
    [NOWE_HASLO, af("redirectSave"), "/login"],
  ])("%s: „%s” bez danych pokazuje „%s”", ([, Editor, type], etykieta, domyslna) => {
    renderEditor(Editor, blok(type, {}));
    expect(tekst(etykieta).value).toBe(domyslna);
  });

  // NAPRAWIONE 2026-10-18: bez klucza `showOAuthGoogle` panel pokazywał Google
  // jako WYŁĄCZONE, a `LoginFormView` (`readAuthFlag(…, true)`) rysował
  // przycisk Google. Paleta zapisuje `false` jawnie, więc rozjazd widział
  // dopiero dokument bez klucza (import, starsza wersja palety).
  it("logowanie: bez danych wszystkie przełączniki są włączone - także Google, jak na stronie", () => {
    renderEditor(LoginFormBlock, blok("login-form", {}));
    for (const k of [
      "showRemember",
      "showShowPassword",
      "showForgot",
      "showRegister",
      "oauthGoogle",
    ]) {
      expect(przelacznik(af(k)).checked, k).toBe(true);
    }
  });

  // NAPRAWIONE 2026-10-18: „Powtórz hasło" było domyślnie WŁĄCZONE, choć
  // `RegisterFormView` bez obu kluczy (`showPasswordConfirm`,
  // `showConfirmPassword`) pola nie rysuje.
  it("rejestracja: bez danych potwierdzenie hasła jest wyłączone, reszta - włączona", () => {
    renderEditor(RegisterFormBlock, blok("register-form", {}));
    expect(przelacznik(af("showConfirmPassword")).checked).toBe(false);
    for (const k of ["showName", "showNewsletterOptIn", "requireConsent", "oauthGoogle"]) {
      expect(przelacznik(af(k)).checked, k).toBe(true);
    }
  });
});

describe("przełączniki - zapis `boolean` i odczyt tą samą koercją, co renderer", () => {
  it.each<readonly [Formularz, string, string, boolean]>([
    [LOGIN, af("showRemember"), "showRemember", false],
    [LOGIN, af("showShowPassword"), "showShowPassword", false],
    [LOGIN, af("showForgot"), "showForgot", false],
    [LOGIN, af("showRegister"), "showRegister", false],
    [LOGIN, af("oauthGoogle"), "showOAuthGoogle", false],
    [REJESTRACJA, af("showName"), "showName", false],
    [REJESTRACJA, af("showConfirmPassword"), "showConfirmPassword", true],
    [REJESTRACJA, af("oauthGoogle"), "showOAuthGoogle", false],
    [REJESTRACJA, af("showNewsletterOptIn"), "showNewsletterOptIn", false],
    [REJESTRACJA, af("requireConsent"), "requireConsent", false],
    [NOWE_HASLO, af("resetConfirmPassword"), "showConfirmPassword", false],
  ])("%s: „%s” zapisuje `%s: %s`", ([, Editor, type], etykieta, klucz, wartosc) => {
    const zapis = zapisPo(Editor, blok(type, {}), () => fireEvent.click(przelacznik(etykieta)));
    expect(zapis).toEqual({ [klucz]: wartosc });
  });

  it.each<readonly [Formularz, string, string]>([
    [LOGIN, af("showRemember"), "showRemember"],
    [REJESTRACJA, af("requireConsent"), "requireConsent"],
    [NOWE_HASLO, af("resetConfirmPassword"), "showConfirmPassword"],
  ])("%s: „%s” zapisane jako „0” jest pokazane jako WYŁĄCZONE", ([, Editor, type], e, klucz) => {
    // Panel właściwości commitował historycznie napisy „0"/„1"; renderer
    // (`readAuthFlag`) czyta „0" jako `false`. `Boolean("0")` to `true`.
    renderEditor(Editor, blok(type, { [klucz]: "0" }));
    expect(przelacznik(e).checked).toBe(false);
  });

  it("`null` w przełączniku czyta się jak brak ustawienia - czyli wartość domyślną", () => {
    // `readAuthFlag` pomija `null` i bierze domyślne „włączone".
    // `Boolean(null)` pokazywał wyłączenie, którego strona nie stosuje.
    renderEditor(RegisterFormBlock, blok("register-form", { showName: null }));
    expect(przelacznik(af("showName")).checked).toBe(true);
  });

  it("napis „nie” w przełączniku Google czyta się jako WYŁĄCZONE", () => {
    renderEditor(LoginFormBlock, blok("login-form", { showOAuthGoogle: "nie" }));
    expect(przelacznik(af("oauthGoogle")).checked).toBe(false);
  });
});

describe("przełączniki z kluczem kanonicznym schematu - odczyt i zapis jak na stronie", () => {
  // Renderer czyta aliasy w kolejności: kanoniczny klucz schematu
  // (`showPasswordConfirm`, `newsletterOptIn`) PRZED historycznym, który pisze
  // paleta i panel. Panel znał tylko historyczny - przy obecnym kluczu
  // kanonicznym pokazywał nie ten stan, a jego zapis strony nie zmieniał.
  it.each<readonly [Formularz, string, Record<string, Json>, boolean]>([
    [REJESTRACJA, af("showConfirmPassword"), { showPasswordConfirm: true }, true],
    [
      REJESTRACJA,
      af("showConfirmPassword"),
      { showPasswordConfirm: false, showConfirmPassword: true },
      false,
    ],
    [REJESTRACJA, af("showNewsletterOptIn"), { newsletterOptIn: false }, false],
    [NOWE_HASLO, af("resetConfirmPassword"), { showPasswordConfirm: "0" }, false],
  ])("%s: „%s” przy %j pokazuje %s", ([, Editor, type], etykieta, dane, widac) => {
    renderEditor(Editor, blok(type, dane));
    expect(przelacznik(etykieta).checked).toBe(widac);
  });

  it.each<readonly [Formularz, string, Record<string, Json>, string]>([
    [
      REJESTRACJA,
      af("showConfirmPassword"),
      { showPasswordConfirm: false, showConfirmPassword: true },
      "showPasswordConfirm",
    ],
    [REJESTRACJA, af("showNewsletterOptIn"), { newsletterOptIn: false }, "newsletterOptIn"],
    [NOWE_HASLO, af("resetConfirmPassword"), { showPasswordConfirm: false }, "showPasswordConfirm"],
  ])("%s: „%s” zapisuje klucz, który strona czyta PIERWSZY", ([, Editor, type], e, dane, klucz) => {
    const zapis = zapisPo(Editor, blok(type, dane), () => fireEvent.click(przelacznik(e)));
    // Przełączona wartość ląduje pod kluczem kanonicznym; reszta danych zostaje.
    expect(zapis).toEqual({ ...dane, [klucz]: !dane[klucz] });
  });

  it("klucz kanoniczny ustawiony na `null` nie przejmuje zapisu - trafia on w klucz palety", () => {
    // `readAuthFlag` pomija `null`, więc stronę steruje wtedy klucz historyczny.
    const zapis = zapisPo(
      RegisterFormBlock,
      blok("register-form", { showPasswordConfirm: null, showConfirmPassword: true }),
      () => fireEvent.click(przelacznik(af("showConfirmPassword"))),
    );
    expect(zapis).toEqual({ showPasswordConfirm: null, showConfirmPassword: false });
  });
});

describe("wariant powłoki", () => {
  it.each<readonly [Formularz, string[]]>([
    [LOGIN, ["card", "plain", "split"]],
    [REJESTRACJA, ["card", "plain", "split"]],
    [ZAPOMNIANE, ["card", "plain"]],
    [NOWE_HASLO, ["card", "plain"]],
  ])("%s: oferuje %j i zapisuje wybrany wariant", ([, Editor, type], warianty) => {
    const zapis = zapisPo(Editor, blok(type, {}), () => {
      const lista = screen.getByRole("combobox") as HTMLSelectElement;
      expect(lista.value).toBe("card");
      expect(Array.from(lista.options, (o) => o.value)).toEqual(warianty);
      fireEvent.change(lista, { target: { value: "plain" } });
    });
    expect(zapis).toEqual({ variant: "plain" });
  });
});

describe("dane z importu i minimalna długość hasła", () => {
  it("tytuł w kształcie OBIEKTU nie wpisuje „[object Object]” w pole", () => {
    renderEditor(LoginFormBlock, blok("login-form", { title_pl: { tekst: "Zaloguj" } as Json }));
    expect(tekst(af("fTitlePl")).value).toBe("");
  });

  it("przekierowanie-obiekt pokazuje domyślne przekierowanie", () => {
    renderEditor(LostPasswordFormBlock, blok("lost-password-form", { redirectTo: [] }));
    expect(tekst(af("resetPageLink")).value).toBe("/reset-password");
  });

  it("minimalna długość: domyślnie 8, zapis jako LICZBA, puste pole wraca do 8", () => {
    const start = blok("reset-password-form", {});
    const pole = () =>
      screen.getByRole("spinbutton", { name: af("minLength") }) as HTMLInputElement;
    expect(
      zapisPo(ResetPasswordFormBlock, start, () => {
        expect(pole().value).toBe("8");
        fireEvent.change(pole(), { target: { value: "12" } });
      }),
    ).toEqual({ minLength: 12 });
    expect(
      zapisPo(ResetPasswordFormBlock, start, () =>
        fireEvent.change(pole(), { target: { value: "" } }),
      ),
    ).toEqual({ minLength: 8 });
  });

  it("minimalna długość powyżej granicy pola zapisuje granicę pola", () => {
    // Strona przyjęłaby do 128, ale Supabase odrzuca hasła dłuższe niż 72 znaki
    // - minimum 500 zamknęłoby reset hasła wszystkim użytkownikom.
    const zapis = zapisPo(ResetPasswordFormBlock, blok("reset-password-form", {}), () => {
      const pole = screen.getByRole("spinbutton", { name: af("minLength") }) as HTMLInputElement;
      fireEvent.change(pole, { target: { value: "500" } });
    });
    expect(zapis).toEqual({ minLength: 64 });
  });

  it("minimalna długość zapisana słowem pokazuje domyślne 8, a nie `NaN`", () => {
    // Renderer (`asNumInRange(data.minLength, 8, 6, 128)`) liczy wtedy z 8.
    renderEditor(ResetPasswordFormBlock, blok("reset-password-form", { minLength: "osiem" }));
    expect(
      (screen.getByRole("spinbutton", { name: af("minLength") }) as HTMLInputElement).value,
    ).toBe("8");
  });
});
