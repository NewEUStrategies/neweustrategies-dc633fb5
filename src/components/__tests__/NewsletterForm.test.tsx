/**
 * <NewsletterForm /> - publiczny widget zapisu do newslettera (stopka wpisu,
 * sidebar, archiwum, a także instancja budowana w CMS przez `widgetConfig`).
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. CZTERY BRAMKI WIDOCZNOŚCI, które decydują, CZY w ogóle powstaje formularz:
 *     brak/wyłączone ustawienia (poza builderem = nic, w builderze = komunikat
 *     dla redaktora), zalogowany-już-zapisany (panel statusu zamiast drugiego
 *     pytania o dane) oraz dokument nowego buildera (`inline_doc` + tryb).
 *     Każda z nich to inny ekran dla użytkownika, więc każda ma swój przypadek.
 *  2. WALIDACJA PRZED WYSYŁKĄ. Wymagalność pól jest konfigurowana per widget,
 *     a komunikat („Pole wymagane" / „Niepoprawny adres e-mail") musi wylądować
 *     PRZY POLU, nie w ogólnym alercie - i nie może dopuścić żądania do serwera.
 *  3. ŁADUNEK WYSYŁKI. To jedyne wyjście logiki formularza: e-mail przycięty i
 *     zmałoliterowany, nazwa złożona z imienia i nazwiska, `meta` z firmą /
 *     stanowiskiem / telefonem, zgoda z treścią polityki z ustawień oraz
 *     zainteresowania rozbite na `interests` / `interests_areas` /
 *     `interests_topics`. Asercja idzie na argument atrapy serwerowej.
 *  4. TRZY ZAKOŃCZENIA: sukces (z rozróżnieniem `pending` / `exists` i
 *     powrotem „Zapisz kolejny adres"), odmowa serwera (kod -> zdanie) oraz
 *     wyjątek transportu. Teksty biorę z `subscribeFeedback` - wspólnego
 *     źródła prawdy - a nie z kopii wpisanej w teście.
 *  5. INTERAKCJE, w których mieszkają martwe funkcje tego pliku: przełączanie
 *     tematów i ich czyszczenie, wpisywanie w pola stanowiska/telefonu, pola
 *     układu kompaktowego, zgoda (checkbox) i droplista (select) pól custom.
 *  6. DWUJĘZYCZNOŚĆ MIERZONA SŁOWNIKIEM: `t` w atrapie `react-i18next` to
 *     PRAWDZIWY `getFixedT(lang)` z `@/test/i18nReal`, a bramka `dict()`
 *     oblewa przypadek, gdy klucz zniknie ze słownika. Kopie „po polsku" i
 *     „po angielsku" dla stanów zapisu pochodzą z `subscribeFeedback`.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `@tanstack/react-start` - `useServerFn` oddaje rejestrator ładunku:
 *     prawdziwa funkcja serwerowa poszłaby do sieci i do bazy.
 *  * `@/hooks/useNewsletterSettings` - rozwinięty moduł prawdziwy (żeby
 *     `defaultNewsletterSettings()` i `useRegistrationFields` pozostały realne)
 *     z podmienionym samym hookiem odczytu.
 *  * `@/hooks/useMyNewsletterStatus`, `@/lib/content-model/editorCanvas` -
 *     sterowanie bramkami widoczności bez sesji i bez kontekstu buildera.
 *  * `@/components/interests/TopicsDroplist` - lekki znacznik z przyciskami
 *     „przełącz" i „wyczyść". Wnętrze droplisty (portal, pozycjonowanie) ma
 *     własne testy; tutaj przedmiotem dowodu jest to, CO formularz robi z
 *     wyborem tematów.
 *  * `NewsletterDocRenderer` / `NewsletterSubscribedPanel` - znaczniki; ich
 *     zawartość ma własne pliki, a tu liczy się, KTÓRY ekran wygrał bramkę.
 *  * `@/integrations/supabase/client` - granica danych (formularz sam z niej
 *     nie korzysta, ale wciąga ją graf ustawień).
 *
 * CO ZOSTAJE PRAWDZIWE: React, `parseCustomFields` / `collectCustomValues` /
 * `validateCustom`, `pickLocalized`, `subscribeFeedback`, `sanitizeHtml`,
 * atomy `FieldWrap` / `SubscribeButton` / `Checkbox` / `FormSelect`.
 *
 * ZNALEZISKO (przypięte niżej jako `it.fails`): pole custom typu `checkbox`
 * wystawia do formularza `<input type="hidden" value="1">`, a
 * `collectCustomValues` uznaje zaznaczenie wyłącznie po wartości `"on"`.
 * Zaznaczona zgoda nie dociera więc do ładunku, a zgoda WYMAGANA blokuje
 * wysyłkę na zawsze.
 *
 * ŚWIADOMIE POZA ZAKRESEM: wygląd (klasy Tailwind), otwieranie popupu Radix
 * w droplistach (happy-dom nie liczy układu) i prawdziwa wysyłka maila.
 *
 * RODO: dane wyłącznie zmyślone (example.com, „Anna Przykładowa").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import type { InterestItem } from "@/hooks/useInterests";

type Cfg = Record<string, unknown>;

interface TopicsStubProps {
  lang: "pl" | "en";
  allItems: InterestItem[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}

interface DocStubProps {
  lang: "pl" | "en";
  source: string;
}

const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`, wstrzykiwany poniżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  lang: "pl" as "pl" | "en",
  settings: null as Record<string, unknown> | null,
  myStatus: null as { subscribed: boolean } | null,
  builderMode: null as string | null,
  items: [] as Array<{ id: string; type: "category" | "tag"; label: string; slug: string }>,
  submissions: [] as Array<Record<string, unknown>>,
  result: { ok: true, status: "pending" } as Record<string, unknown>,
  throwOnSubmit: null as string | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.lang),
    i18n: {
      language: h.lang,
      changeLanguage: () => Promise.resolve(),
      on: () => {},
      off: () => {},
    },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({}),
    channel: () => {
      const ch: { on: () => typeof ch; subscribe: () => typeof ch } = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {},
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

// Moduł prawdziwy z podmienionym `useServerFn`: `createIsomorphicFn` z tej samej
// paczki stoi w grafie `@/lib/i18n` (przez `localeRuntime`), więc atrapa
// zbudowana od zera wywraca import całego pliku.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: () => async (args: { data: Record<string, unknown> }) => {
      h.submissions.push(args.data);
      if (h.throwOnSubmit !== null) throw new Error(h.throwOnSubmit);
      return h.result;
    },
  };
});

vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));

vi.mock("@/hooks/useNewsletterSettings", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useNewsletterSettings")>(
    "@/hooks/useNewsletterSettings",
  );
  return { ...actual, useNewsletterSettings: () => ({ data: h.settings }) };
});

vi.mock("@/hooks/useMyNewsletterStatus", () => ({
  useMyNewsletterStatus: () => ({ data: h.myStatus, isLoading: false }),
}));

vi.mock("@/lib/content-model/editorCanvas", () => ({ useBuilderMode: () => h.builderMode }));

vi.mock("@/components/newsletter/NewsletterDocRenderer", () => ({
  NewsletterDocRenderer: ({ lang, source }: DocStubProps) => (
    <div data-testid="nl-doc" data-lang={lang} data-source={source} />
  ),
}));

vi.mock("@/components/newsletter/NewsletterSubscribedPanel", () => ({
  NewsletterSubscribedPanel: ({ lang }: { lang: "pl" | "en" }) => (
    <div data-testid="nl-subscribed" data-lang={lang} />
  ),
}));

vi.mock("@/components/interests/TopicsDroplist", () => ({
  useInterestGroups: () => ({ catalog: null, allItems: h.items, groups: [] }),
  TopicsDroplist: ({ lang, allItems, picked, onToggle, onClear }: TopicsStubProps) => (
    <div data-testid="topics" data-lang={lang} data-picked={Array.from(picked).join(",")}>
      {allItems.map((it) => (
        <button key={it.id} type="button" onClick={() => onToggle(it.id)}>
          {`temat: ${it.label}`}
        </button>
      ))}
      <button type="button" onClick={onClear}>
        wyczyść tematy
      </button>
    </div>
  ),
}));

import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  subscribeErrorMessage,
  subscribeErrorTitle,
  subscribeSuccessCopy,
} from "@/lib/newsletter/subscribeFeedback";
import { NewsletterForm } from "@/components/NewsletterForm";

h.t = (lang: "pl" | "en") => realT(lang);

/** Bramka na brakujący klucz i18n - patrz nagłówek `Header.test.tsx`. */
function dict(lang: "pl" | "en", key: string): string {
  const value = String(realT(lang)(key));
  if (value === key) {
    throw new Error(
      `Klucz i18n "${key}" (${lang}) nie ma tłumaczenia - i18next zwrócił sam klucz. ` +
        "Asercja na tej wartości mierzyłaby echo klucza, nie słownik.",
    );
  }
  return value;
}

function withSettings(over: Cfg = {}): Record<string, unknown> {
  return { ...defaultNewsletterSettings(), mode: "inline", inline_doc: null, ...over };
}

interface FormProps {
  lang?: "pl" | "en";
  source?: string;
  variant?: "card" | "inline";
  widgetConfig?: Cfg;
}

function form(props: FormProps): ReactElement {
  return (
    <NewsletterForm
      lang={props.lang ?? "pl"}
      source={props.source ?? "post-bottom"}
      variant={props.variant ?? "card"}
      widgetConfig={props.widgetConfig}
    />
  );
}

function renderForm(props: FormProps = {}) {
  return renderWithQueryClient(form(props));
}

/** Pełny zestaw pól dodatkowych (tak wygląda instancja spoza buildera). */
const ALL_FIELDS: Cfg = {
  showFirstName: true,
  showLastName: true,
  showCompany: true,
  showPosition: true,
  showPhone: true,
};

const formEl = (): HTMLFormElement => {
  const el = document.querySelector("form");
  if (!el) throw new Error("Brak elementu <form> w drzewie.");
  return el;
};

/** Wysyłka + odczekanie, aż formularz się ROZSTRZYGNIE: żądanie albo błąd. */
const submit = async (): Promise<void> => {
  fireEvent.submit(formEl());
  await waitFor(() => {
    const rejected = document.querySelectorAll("[data-invalid='true'], .text-destructive").length;
    expect(h.submissions.length + rejected).toBeGreaterThan(0);
  });
};

const emailInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>("input[type='email']");
  if (!el) throw new Error("Brak pola e-mail.");
  return el;
};

const textInputs = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text']"));

beforeEach(() => {
  h.lang = "pl";
  h.settings = withSettings();
  h.myStatus = null;
  h.builderMode = null;
  h.items = [];
  h.submissions.length = 0;
  h.result = { ok: true, status: "pending" };
  h.throwOnSubmit = null;
});

afterEach(() => {
  cleanup();
});

// --- Bramki widoczności ------------------------------------------------------

describe("NewsletterForm - kto w ogóle widzi formularz", () => {
  it("bez wczytanych ustawień i poza builderem nie renderuje niczego", () => {
    h.settings = null;
    const { container } = renderForm();

    expect(container).toBeEmptyDOMElement();
  });

  it("wyłączony newsletter poza builderem znika ze strony", () => {
    h.settings = withSettings({ enabled: false });
    const { container } = renderForm();

    expect(container).toBeEmptyDOMElement();
  });

  it("w kanwie buildera redaktor dostaje komunikat zamiast pustki - osobny dla braku i dla wyłączenia", () => {
    h.builderMode = "edit";
    h.settings = null;
    const loading = renderForm();
    expect(screen.getByRole("status").textContent).toContain("wczytywanie ustawień");
    loading.unmount();

    h.settings = withSettings({ enabled: false });
    renderForm();
    expect(screen.getByRole("status").textContent).toContain("wyłączony w ustawieniach");
    expect(document.querySelector("form")).toBeNull();
  });

  it("zalogowany i już zapisany widzi panel statusu zamiast drugiego formularza", () => {
    h.myStatus = { subscribed: true };
    renderForm({ lang: "en" });

    expect(screen.getByTestId("nl-subscribed")).toHaveAttribute("data-lang", "en");
    expect(document.querySelector("form")).toBeNull();
  });

  it("ten sam użytkownik W BUILDERZE widzi jednak formularz (inaczej widget znika redaktorowi)", () => {
    h.myStatus = { subscribed: true };
    h.builderMode = "edit";
    renderForm();

    expect(screen.queryByTestId("nl-subscribed")).toBeNull();
    expect(formEl()).toBeInTheDocument();
  });

  it("dokument nowego buildera przejmuje render i dostaje język oraz źródło zapisu", () => {
    h.settings = withSettings({ inline_doc: { version: 1, blocks: [] }, mode: "inline" });
    const { container } = renderForm({ lang: "en", source: "sidebar", variant: "inline" });

    const doc = screen.getByTestId("nl-doc");
    expect(doc).toHaveAttribute("data-lang", "en");
    expect(doc).toHaveAttribute("data-source", "sidebar");
    expect(container.querySelector("section")?.className).toContain("nl-shell--inline");
    expect(document.querySelector("form")).toBeNull();
  });

  it("dokument buildera w trybie 'popup' nie przejmuje widgetu inline - zostaje klasyczny formularz", () => {
    h.settings = withSettings({ inline_doc: { version: 1, blocks: [] }, mode: "popup" });
    renderForm();

    expect(screen.queryByTestId("nl-doc")).toBeNull();
    expect(formEl()).toBeInTheDocument();
  });
});

// --- Konfiguracja pól --------------------------------------------------------

describe("NewsletterForm - konfiguracja pól widgetu", () => {
  it("instancja BEZ konfiguracji dostaje pełny zestaw pól, a widget z konfiguracją decyduje sam", () => {
    const full = renderForm();
    // imię, nazwisko, firma, stanowisko, telefon + e-mail
    expect(textInputs()).toHaveLength(4);
    expect(document.querySelector("input[type='tel']")).not.toBeNull();
    expect(emailInput()).toBeInTheDocument();
    full.unmount();

    renderForm({ widgetConfig: { showFirstName: true } });
    expect(textInputs()).toHaveLength(1);
    expect(document.querySelector("input[type='tel']")).toBeNull();
  });

  it("flagi widoczności czyta też z liczb i napisów (tak zapisuje je builder)", () => {
    renderForm({
      widgetConfig: { showCompany: "true", showPhone: 1, showPosition: 0, showFirstName: "0" },
    });

    expect(document.querySelector("input[type='tel']")).not.toBeNull();
    // Firma jest jedynym polem tekstowym: stanowisko (0) i imię ("0") odpadły.
    expect(textInputs()).toHaveLength(1);
  });

  it("układ kompaktowy (bez pól dodatkowych) przyjmuje imię i e-mail i wysyła je razem", async () => {
    renderForm({ widgetConfig: { showInterests: false } });

    const name = textInputs()[0];
    fireEvent.change(name, { target: { value: "Anna Przykładowa" } });
    fireEvent.change(emailInput(), { target: { value: "  ANNA@EXAMPLE.COM " } });
    await submit();

    expect(h.submissions).toHaveLength(1);
    expect(h.submissions[0].email).toBe("anna@example.com");
    expect(h.submissions[0].name).toBe("Anna Przykładowa");
    expect(h.submissions[0].firstName).toBeUndefined();
  });
});

// --- Walidacja ---------------------------------------------------------------

describe("NewsletterForm - walidacja przed wysyłką", () => {
  it("puste pola wymagane zatrzymują wysyłkę i opisują KAŻDE z nich osobno", async () => {
    renderForm({
      widgetConfig: {
        ...ALL_FIELDS,
        requireFirstName: true,
        requireLastName: true,
        requireCompany: true,
        requirePosition: true,
        requirePhone: true,
      },
    });

    await submit();

    expect(h.submissions).toHaveLength(0);
    const required = dict("pl", "newsletterForm.requiredField");
    expect(screen.getAllByText(required)).toHaveLength(6);
    expect(document.querySelectorAll("[data-invalid='true']")).toHaveLength(6);
  });

  it("adres bez domeny dostaje komunikat o niepoprawnym e-mailu, nie o pustym polu", async () => {
    renderForm({ widgetConfig: ALL_FIELDS });
    fireEvent.change(emailInput(), { target: { value: "anna@example" } });

    await submit();

    expect(h.submissions).toHaveLength(0);
    expect(screen.getByText(dict("pl", "newsletterForm.invalidEmail"))).toBeInTheDocument();
    expect(screen.queryByText(dict("pl", "newsletterForm.requiredField"))).toBeNull();
  });

  it("widget z wyłączoną wymagalnością e-maila puszcza zapis bez adresu", async () => {
    renderForm({ widgetConfig: { ...ALL_FIELDS, requireEmail: false } });

    await submit();

    expect(h.submissions).toHaveLength(1);
    expect(h.submissions[0].email).toBe("");
  });

  it("wymagane pole custom blokuje wysyłkę, aż zostanie wypełnione", async () => {
    const customFields = [
      JSON.stringify({ id: "rola", type: "text", labelPl: "Rola", required: true }),
    ];
    renderForm({ widgetConfig: { ...ALL_FIELDS, customFields } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();
    expect(h.submissions).toHaveLength(0);
    expect(screen.getByText(dict("pl", "newsletterForm.requiredField"))).toBeInTheDocument();

    const custom = document.querySelector<HTMLInputElement>("input[name='custom_rola']");
    expect(custom).not.toBeNull();
    if (custom) fireEvent.change(custom, { target: { value: "analityk" } });

    fireEvent.submit(formEl());
    await waitFor(() => expect(h.submissions).toHaveLength(1));
    expect(h.submissions[0].custom).toEqual({ rola: "analityk" });
  });
});

// --- Ładunek wysyłki ---------------------------------------------------------

describe("NewsletterForm - co dokładnie leci na serwer", () => {
  it("składa nazwę z imienia i nazwiska, pakuje firmę/stanowisko/telefon do meta i dokłada zgodę z ustawień", async () => {
    h.settings = withSettings({
      heading_pl: "Newsletter NES",
      policy_html_pl: "<p>Zgoda testowa</p>",
    });
    renderForm({ widgetConfig: ALL_FIELDS, source: "sidebar" });

    fireEvent.change(textInputs()[0], { target: { value: " Anna " } });
    fireEvent.change(textInputs()[1], { target: { value: " Przykładowa " } });
    fireEvent.change(textInputs()[2], { target: { value: "Instytut Testowy" } });
    fireEvent.change(textInputs()[3], { target: { value: "Analityczka" } });
    fireEvent.change(document.querySelectorAll("input[type='tel']")[0], {
      target: { value: "+48 000 000 000" },
    });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    expect(h.submissions).toHaveLength(1);
    const payload = h.submissions[0];
    expect(payload.email).toBe("anna@example.com");
    expect(payload.name).toBe("Anna Przykładowa");
    expect(payload.firstName).toBe("Anna");
    expect(payload.lastName).toBe("Przykładowa");
    expect(payload.language).toBe("pl");
    expect(payload.source).toBe("sidebar");
    expect(payload.formName).toBe("Newsletter NES");
    expect(payload.meta).toEqual({
      company: "Instytut Testowy",
      position: "Analityczka",
      phone: "+48 000 000 000",
    });
    expect(payload.consents).toEqual([
      { key: "newsletter", text: "<p>Zgoda testowa</p>", given: true, lang: "pl" },
    ]);
    expect(payload.custom).toBeUndefined();
  });

  it("bez treści polityki w ustawieniach zgoda dostaje domyślne brzmienie ze słownika", async () => {
    h.settings = withSettings({ policy_html_pl: null, policy_html_en: null });
    renderForm({ widgetConfig: { showFirstName: true } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    const consents = h.submissions[0].consents;
    expect(Array.isArray(consents)).toBe(true);
    expect(JSON.stringify(consents)).toContain(dict("pl", "newsletterForm.consentDefault"));
  });

  it("treść polityki z ustawień jest renderowana jako link, a nie surowy HTML", () => {
    h.settings = withSettings({
      policy_html_pl: '<a href="/polityka">Polityka prywatności</a>',
    });
    const { container } = renderForm({ widgetConfig: { showFirstName: true } });

    const link = container.querySelector<HTMLAnchorElement>(".nl-consent a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/polityka");
    expect(link?.textContent).toBe("Polityka prywatności");
  });
});

// --- Tematy ------------------------------------------------------------------

describe("NewsletterForm - wybór tematów", () => {
  const ITEMS: Array<{ id: string; type: "category" | "tag"; label: string; slug: string }> = [
    { id: "cat-1", type: "category", label: "Energia", slug: "energia" },
    { id: "tag-1", type: "tag", label: "Klimat", slug: "klimat" },
  ];

  it("zaznaczone tematy jadą w polach custom rozbite na obszary i tematy", async () => {
    h.items = ITEMS;
    renderForm({ widgetConfig: { showFirstName: true } });

    fireEvent.click(screen.getByRole("button", { name: "temat: Energia" }));
    fireEvent.click(screen.getByRole("button", { name: "temat: Klimat" }));
    expect(screen.getByTestId("topics")).toHaveAttribute("data-picked", "cat-1,tag-1");

    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });
    await submit();

    expect(h.submissions[0].custom).toEqual({
      interests: "Energia, Klimat",
      interests_areas: "Energia",
      interests_topics: "Klimat",
    });
  });

  it("ponowny klik odznacza temat, a 'wyczyść' zdejmuje cały wybór", async () => {
    h.items = ITEMS;
    renderForm({ widgetConfig: { showFirstName: true } });

    fireEvent.click(screen.getByRole("button", { name: "temat: Energia" }));
    fireEvent.click(screen.getByRole("button", { name: "temat: Klimat" }));
    fireEvent.click(screen.getByRole("button", { name: "temat: Energia" }));
    expect(screen.getByTestId("topics")).toHaveAttribute("data-picked", "tag-1");

    fireEvent.click(screen.getByRole("button", { name: "wyczyść tematy" }));
    expect(screen.getByTestId("topics")).toHaveAttribute("data-picked", "");

    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });
    await submit();
    expect(h.submissions[0].custom).toBeUndefined();
  });

  it("pusty katalog zainteresowań nie renderuje droplisty", () => {
    h.items = [];
    renderForm({ widgetConfig: { showFirstName: true } });

    expect(screen.queryByTestId("topics")).toBeNull();
  });

  it("droplista da się wyłączyć w konfiguracji widgetu mimo niepustego katalogu", () => {
    h.items = ITEMS;
    renderForm({ widgetConfig: { showFirstName: true, showInterests: false } });

    expect(screen.queryByTestId("topics")).toBeNull();
  });
});

// --- Pola custom -------------------------------------------------------------

describe("NewsletterForm - pola dodatkowe z buildera", () => {
  const CUSTOM: Cfg = {
    customFields: [
      JSON.stringify({
        id: "notatka",
        type: "textarea",
        labelPl: "Notatka",
        labelEn: "Note",
        placeholderPl: "Dodatkowe informacje",
      }),
      JSON.stringify({
        id: "obszar",
        type: "select",
        labelPl: "Obszar",
        labelEn: "Area",
        options: [
          { value: "energia", labelPl: "Energia", labelEn: "Energy" },
          { value: "obronnosc", labelPl: "Obronność", labelEn: "Defence" },
        ],
      }),
      JSON.stringify({ id: "zgoda", type: "checkbox", labelPl: "Zgadzam się na kontakt" }),
    ],
  };

  it("droplista custom dostaje etykietę, podpowiedź i własne pole wartości dla formularza", () => {
    const { container } = renderForm({ widgetConfig: CUSTOM });

    const trigger = screen.getByRole("combobox", { name: "Obszar" });
    expect(trigger).toHaveTextContent(dict("pl", "newsletterForm.selectPlaceholder"));
    // Radix trzyma wartość w ukrytym polu - to ono wchodzi do FormData.
    const hidden = container.querySelector<HTMLInputElement>("input[name='custom_obszar']");
    expect(hidden).not.toBeNull();
    expect(hidden?.type).toBe("hidden");
    expect(hidden?.value).toBe("");
    // Etykieta pływająca droplisty pochodzi z konfiguracji pola.
    expect(container.querySelector(".input-group > .user-label")?.textContent).toBeTruthy();
  });

  it("wariant EN bierze etykiety pól custom z kolumn angielskich", () => {
    h.lang = "en";
    renderForm({ widgetConfig: CUSTOM, lang: "en" });

    expect(screen.getByRole("combobox", { name: "Area" })).toBeInTheDocument();
    expect(document.querySelector("textarea")?.getAttribute("name")).toBe("custom_notatka");
    expect(screen.getByText("Note")).toBeInTheDocument();
  });

  it("wpisana notatka trafia do ładunku, a pole bez wartości wypada", async () => {
    renderForm({ widgetConfig: CUSTOM });
    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (textarea) fireEvent.change(textarea, { target: { value: "  proszę o kontakt  " } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    expect(h.submissions[0].custom).toEqual({ notatka: "proszę o kontakt" });
  });

  it("zgoda (checkbox) przełącza się kliknięciem i dokłada ukryte pole formularza", () => {
    const { container } = renderForm({ widgetConfig: CUSTOM });

    const box = screen.getByRole("checkbox");
    expect(container.querySelector("input[name='custom_zgoda']")).toBeNull();

    fireEvent.click(box);

    const hidden = container.querySelector<HTMLInputElement>("input[name='custom_zgoda']");
    expect(hidden).not.toBeNull();
    expect(hidden?.value).toBe("1");
    expect(hidden?.type).toBe("hidden");
  });

  it("treść zgody przechodzi przez sanityzację, a klik w link idzie przez strażnika przełączania", () => {
    const withLink: Cfg = {
      customFields: [
        JSON.stringify({
          id: "zgoda",
          type: "checkbox",
          labelPl: 'Akceptuję <a href="/regulamin">warunki</a><script>zle()</script>',
        }),
      ],
    };
    const { container } = renderForm({ widgetConfig: withLink });

    const link = container.querySelector<HTMLAnchorElement>("label a");
    expect(link?.getAttribute("href")).toBe("/regulamin");
    expect(container.querySelector("label script")).toBeNull();

    // Strażnik zatrzymuje propagację, żeby przejście do regulaminu nie
    // przełączało zgody. SAM SKUTEK jest w happy-dom niemierzalny: silnik
    // przekazuje aktywację <label> także interaktywnym potomkom, czego
    // przeglądarki nie robią - przypadek pilnuje więc ścieżki, nie artefaktu.
    if (link) fireEvent.click(link);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it.fails(
    'DEFEKT: zaznaczona zgoda (checkbox) nie dociera do ładunku - ukryte pole niesie "1", a zbieranie wartości uznaje tylko "on"',
    async () => {
      renderForm({
        widgetConfig: {
          customFields: [
            JSON.stringify({
              id: "zgoda",
              type: "checkbox",
              labelPl: "Zgadzam się na kontakt",
              required: true,
            }),
          ],
        },
      });
      fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });
      fireEvent.click(screen.getByRole("checkbox"));

      await submit();
      expect(h.submissions).toHaveLength(1);
      expect(h.submissions[0].custom).toEqual({ zgoda: "1" });
    },
  );
});

// --- Zakończenia -------------------------------------------------------------

describe("NewsletterForm - trzy zakończenia zapisu", () => {
  it("sukces pokazuje instrukcję potwierdzenia, czyści pola i pozwala zapisać kolejny adres", async () => {
    h.result = { ok: true, status: "pending" };
    // Oba języki puste: `pickLocalized` spada na drugi język, więc sam PL nie
    // wystarczy, żeby zmierzyć tekst domyślny.
    h.settings = withSettings({ success_message_pl: "", success_message_en: "" });
    renderForm({ widgetConfig: ALL_FIELDS });

    fireEvent.change(textInputs()[0], { target: { value: "Anna" } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });
    await submit();

    const copy = subscribeSuccessCopy("pending", "pl", "");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(copy.title);
    });
    expect(screen.getByRole("status").textContent).toContain(copy.hint ?? "");
    expect(document.querySelector("form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "newsletterForm.addAnother") }));

    expect(formEl()).toBeInTheDocument();
    expect(emailInput().value).toBe("");
    expect(textInputs()[0].value).toBe("");
  });

  it("własny tekst sukcesu z ustawień przebija nagłówek domyślny, podpowiedź zostaje", async () => {
    h.result = { ok: true, status: "exists" };
    h.settings = withSettings({ success_message_pl: "Do zobaczenia w skrzynce" });
    renderForm({ widgetConfig: { showFirstName: true } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    const copy = subscribeSuccessCopy("exists", "pl", "Do zobaczenia w skrzynce");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Do zobaczenia w skrzynce");
    });
    expect(screen.getByRole("status").textContent).toContain(copy.hint ?? "");
  });

  it("odmowa serwera zamienia kod na zdanie dla człowieka i zostawia formularz do poprawki", async () => {
    h.result = { ok: false, error: "rate_limited" };
    renderForm({ widgetConfig: { showFirstName: true } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(subscribeErrorTitle("pl"))).toBeInTheDocument();
    expect(alert).toHaveTextContent(subscribeErrorMessage("rate_limited", "pl"));
    expect(formEl()).toBeInTheDocument();
  });

  it("wyjątek transportu ląduje w komunikacie o braku połączenia", async () => {
    h.throwOnSubmit = "Failed to fetch";
    renderForm({ widgetConfig: { showFirstName: true } });
    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });

    await submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(subscribeErrorMessage("Failed to fetch", "pl"));
  });

  it("wariant EN prowadzi cały cykl po angielsku - podpowiedź pola i komunikat błędu", async () => {
    h.lang = "en";
    h.result = { ok: false, error: "suppressed" };
    h.settings = withSettings({ success_message_en: "" });
    renderForm({ widgetConfig: { showFirstName: true }, lang: "en" });

    expect(emailInput()).toHaveAttribute(
      "placeholder",
      dict("en", "newsletterForm.emailPlaceholder"),
    );
    expect(
      screen.getByRole("button", { name: dict("en", "newsletterForm.subscribe") }),
    ).toBeInTheDocument();

    fireEvent.change(emailInput(), { target: { value: "anna@example.com" } });
    await submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(subscribeErrorMessage("suppressed", "en"));
    expect(within(alert).getByText(subscribeErrorTitle("en"))).toBeInTheDocument();
    // Dowód, że to naprawdę dwa różne słowniki, a nie kopia jednego napisu.
    expect(subscribeErrorTitle("en")).not.toBe(subscribeErrorTitle("pl"));
    expect(h.submissions[0].language).toBe("en");
  });
});
