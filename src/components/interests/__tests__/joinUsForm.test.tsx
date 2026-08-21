// Formularz „Dołącz do nas": walidacja, kształt payloadu, błąd API, podwójny submit.
//
// CO TEN PLIK DOWODZI. `JoinUsForm.tsx` stał na 47% linii przy 113
// niepokrytych. Jest jedynym publicznym formularzem, który jednocześnie zapisuje
// do newslettera, do CRM i do zainteresowań użytkownika - więc pomyłka w KSZTAŁCIE
// payloadu nie psuje ekranu, tylko cicho gubi dane osoby, która je podała.
// Pięć reguł, których złamanie widzi zapisujący się, nie administrator:
//
//   1. ASERCJE IDĄ NA PAYLOAD, NIE NA DOM. Pola widoczne w formularzu nie
//      dowodzą, że ich wartości dojechały do server fn - a to jest cały sens
//      tego formularza.
//   2. ZGODA MARKETINGOWA JEST WARUNKIEM WYSYŁKI (RODO). Formularz bez
//      zaznaczonej zgody nie ma prawa nic wysłać, a treść zgody musi jechać
//      w payloadzie razem z językiem - to ona jest dowodem w rejestrze zgód.
//   3. WYMAGALNOŚĆ POLA LICZY SIĘ TYLKO DLA POLA WIDOCZNEGO. `requirePhone`
//      przy `showPhone={false}` blokowałby wysyłkę na polu, którego nikt nie
//      widzi - formularz stawałby się nieprzechodni bez śladu na ekranie.
//   4. ZAINTERESOWANIA JADĄ DO CRM POGRUPOWANE PO OBSZARZE. `interests_areas`,
//      `interests_topics`, `interests` i `interests_<slug_obszaru>` - CRM ma
//      widzieć tę samą strukturę, którą widział wypełniający.
//   5. BŁĄD ZAPISU NIE CZYŚCI FORMULARZA. Wyczyszczone pola po nieudanym
//      zapisie każą wpisywać wszystko od nowa i wyglądają jak sukces.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ROZMIARÓW Z BUDOWNICZEGO: `joinUsWidgetSizes.test.tsx` dowodzi, że
//   `titleSize`/`labelSize`/`iconSize` docierają do DOM i wygrywają z kaskadą.
// - DROPLISTY TEMATÓW: `topicsDroplist.test.tsx` (grupowanie, portal, zakładki).
// - COMBOBOKSU KRAJÓW: `countryCombobox.test.tsx` (diakrytyki, klawiatura).
// - WARSTWY DANYCH ZAINTERESOWAŃ: `src/hooks/__tests__/useInterests.test.tsx`
//   (różnica zapisu, magazyn gościa).
// - SERVER FN NEWSLETTERA: `subscribeToNewsletter` ma własne testy; tutaj jest
//   atrapą, która ZAPISUJE PAYLOAD.
// - POLA WŁASNYCH: `CustomFieldsRenderer` i `validateCustomFields` mają testy
//   przy konfiguracji pól; tutaj sprawdzamy tylko, że formularz respektuje wynik.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

interface SubscribePayload {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  language: string;
  source: string;
  consents: { key: string; text: string; given: boolean; lang: string }[];
  meta?: Record<string, string>;
  custom?: Record<string, string>;
  requiredFields: string[];
  formType: string;
}

const h = vi.hoisted(() => ({
  categories: [] as Record<string, unknown>[],
  tags: [] as Record<string, unknown>[],
  userId: null as string | null,
  newsletterEnabled: true,
  /** Payloady przekazane do server fn zapisu - przedmiot dowodu. */
  subscribePayloads: [] as SubscribePayload[],
  subscribeResult: { ok: true } as { ok: boolean; error?: string },
  subscribeThrows: null as unknown,
  /**
   * Bramka wstrzymująca odpowiedź zapisu. Dopóki jest ustawiona, formularz stoi
   * w stanie oczekiwania - to jedyny sposób podejrzenia blokady drugiego
   * kliknięcia bez zegarów i bez `setTimeout`.
   */
  subscribeGate: null as Promise<void> | null,
  /** Ile razy formularz zawołał zapis - dowód na blokadę podwójnego submitu. */
  linkCalls: 0,
  consentCalls: 0,
  savedInterests: [] as { categoryIds: string[]; tagIds: string[] }[],
  /** Język interfejsu - decyduje o komunikatach składanych w kodzie. */
  language: "pl",
}));

vi.mock("@/integrations/supabase/client", () => {
  interface Chain {
    select: () => Chain;
    order: () => Chain;
    eq: () => Chain;
    in: () => Chain;
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => unknown;
  }
  const makeChain = (table: string): Chain => {
    const chain: Chain = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve) =>
        resolve({ data: table === "categories" ? h.categories : h.tags, error: null }),
    };
    return chain;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      channel: () => channel,
      removeChannel: () => Promise.resolve("ok"),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.userId === null ? null : { id: h.userId } }),
}));
vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({ data: { enabled: h.newsletterEnabled } }),
}));
vi.mock("@/lib/content-model/editorCanvas", () => ({ useBuilderMode: () => null }));
// Atrapa `useServerFn` zwraca samą server fn - dzięki temu atrapy modułów
// serwerowych niżej są jednocześnie tym, co formularz wywoła. Reszta modułu
// (`createServerFn`, `createMiddleware`) musi zostać PRAWDZIWA: importują ją
// moduły `*.functions.ts` w grafie tego testu.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: async ({ data }: { data: SubscribePayload }) => {
    h.subscribePayloads.push(data);
    if (h.subscribeGate !== null) await h.subscribeGate;
    if (h.subscribeThrows !== null) throw h.subscribeThrows;
    return h.subscribeResult;
  },
}));
vi.mock("@/lib/joinUsSync.functions", () => ({
  getJoinUsPrefill: () => Promise.resolve(null),
  linkJoinUsAndBackfill: () => {
    h.linkCalls += 1;
    return Promise.resolve({ ok: true });
  },
}));
vi.mock("@/lib/consents.functions", () => ({
  setMyConsent: () => {
    h.consentCalls += 1;
    return Promise.resolve({ ok: true });
  },
}));
// UWAGA NA TOŻSAMOŚĆ OBIEKTU - to nie jest kosmetyka.
//
// `JoinUsForm` ma `useEffect(..., [my.data])`, którego ciało robi
// `setPicked(new Set(...))`. Atrapa zwracająca ŚWIEŻY literał przy każdym
// renderze zmienia tożsamość `my.data` w każdym cyklu, więc efekt odpala się
// bez końca i plik testowy WISI do timeoutu - bez ani jednego komunikatu.
// W produkcji `my.data` przychodzi z react-query i jest referencyjnie stabilne,
// więc pętla jest wyłącznie własnością atrapy. Stąd jeden obiekt na moduł,
// z getterami na pola zmienne per test.
vi.mock("@/hooks/useInterests", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useInterests")>("@/hooks/useInterests");
  const stable = {
    data: { categoryIds: [] as string[], tagIds: [] as string[] },
    isLoading: false,
    get userId() {
      return h.userId;
    },
    get isAnonymous() {
      return h.userId === null;
    },
    save: (next: { categoryIds: string[]; tagIds: string[] }) => {
      h.savedInterests.push(next);
      return Promise.resolve({ ok: true as const, anon: h.userId === null });
    },
  };
  return { ...actual, useMyInterests: () => stable };
});
vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

import { JoinUsForm } from "@/components/interests/JoinUsForm";

function mount(props: Partial<React.ComponentProps<typeof JoinUsForm>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(wrap(<JoinUsForm showInterests={false} {...props} />));
}

/**
 * Pole po atrybucie `autocomplete`, NIE po etykiecie.
 *
 * PO CO TAK. Etykiety tych pól nie są kluczami i18n: składają się z globalnej
 * konfiguracji rejestracji, nadpisania per-widget i stałej fabrycznej - trzy
 * warstwy, z których każda może zmienić brzmienie bez zmiany zachowania.
 * `autocomplete` jest KONTRAKTEM wobec przeglądarki (autouzupełnianie), więc
 * jest jednocześnie stabilny i wart pilnowania: pole adresu bez
 * `autocomplete="email"` to pole, którego przeglądarka nie umie wypełnić.
 */
function field(autocomplete: string): HTMLInputElement {
  const node = document.querySelector(`input[autocomplete="${autocomplete}"]`);
  if (!(node instanceof HTMLInputElement)) {
    throw new Error(`test: brak pola z autocomplete="${autocomplete}"`);
  }
  return node;
}
const form = () => document.querySelector("form")!;
const consent = () => screen.getByRole("checkbox");
const submit = () => fireEvent.submit(form());

/** Wypełnia minimum potrzebne do przejścia walidacji. */
function fillMinimum(email = "osoba@example.com") {
  fireEvent.change(field("email"), { target: { value: email } });
  fireEvent.click(consent());
}

const lastPayload = () => h.subscribePayloads.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  h.categories = [];
  h.tags = [];
  h.userId = null;
  h.newsletterEnabled = true;
  h.subscribePayloads = [];
  h.subscribeResult = { ok: true };
  h.subscribeThrows = null;
  h.subscribeGate = null;
  h.linkCalls = 0;
  h.consentCalls = 0;
  h.savedInterests = [];
  h.language = "pl";
});

afterEach(() => cleanup());

describe("widoczność widgetu", () => {
  it("wyłączony newsletter ukrywa widget na stronie publicznej", () => {
    // Widget zapisu do wyłączonego newslettera zbierałby adresy, których nikt
    // nie wyśle - lepiej go nie pokazywać wcale.
    h.newsletterEnabled = false;
    const { container } = mount();
    expect(container.innerHTML).toBe("");
  });

  it("włączony newsletter renderuje formularz z polem adresu i zgodą", () => {
    mount();
    expect(field("email")).toBeTruthy();
    expect(consent()).toBeTruthy();
  });
});

describe("walidacja przed wysłaniem", () => {
  it("adres bez znaku @ nie jedzie do serwera", async () => {
    mount();
    fireEvent.change(field("email"), { target: { value: "osoba" } });
    fireEvent.click(consent());
    submit();
    await waitFor(() => expect(screen.getByText("joinUs.errorEmail")).toBeTruthy());
    expect(h.subscribePayloads).toEqual([]);
  });

  it.each(["", "osoba@", "osoba@example", "osoba @example.com"])(
    "adres %j jest odrzucany bez żądania",
    async (value) => {
      mount();
      fireEvent.change(field("email"), { target: { value } });
      fireEvent.click(consent());
      submit();
      await waitFor(() => expect(screen.getByText("joinUs.errorEmail")).toBeTruthy());
      expect(h.subscribePayloads).toEqual([]);
    },
  );

  it("BRAK ZGODY MARKETINGOWEJ blokuje wysyłkę - to jest wymóg RODO", async () => {
    mount();
    fireEvent.change(field("email"), { target: { value: "osoba@example.com" } });
    submit();
    await waitFor(() => expect(screen.getByText("joinUs.consentRequired")).toBeTruthy());
    expect(h.subscribePayloads).toEqual([]);
  });

  it("wymagane pole WIDOCZNE i puste blokuje wysyłkę i wymienia je w komunikacie", async () => {
    mount({ showPhone: true, requirePhone: true });
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText(/phone/)).toBeTruthy());
    expect(h.subscribePayloads).toEqual([]);
  });

  it("wymagane pole UKRYTE nie blokuje wysyłki - i to jest cała treść testu", async () => {
    // `requirePhone` przy `showPhone={false}` czyniłby formularz nieprzechodnim
    // na polu, którego nikt nie widzi. Administrator zobaczyłby spadek zapisów
    // bez żadnego śladu na ekranie.
    mount({ showPhone: false, requirePhone: true });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
  });

  it("wymagane zainteresowania blokują wysyłkę przy pustym wyborze", async () => {
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: null },
    ];
    mount({ showInterests: true, requireInterests: true, interestsDisplay: "chips" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Afryka" })).toBeTruthy());
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toEqual([]));
  });

  it("wymagane zainteresowania przy PUSTYM katalogu nie blokują - nie ma z czego wybrać", async () => {
    // Inaczej instalacja bez tematów w bazie miałaby nieprzechodni formularz.
    mount({ showInterests: true, requireInterests: true });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
  });

  it("adres z wielkich liter i spacji jest normalizowany PRZED wysłaniem", async () => {
    mount();
    fireEvent.change(field("email"), {
      target: { value: "  OSOBA@Example.COM  " },
    });
    fireEvent.click(consent());
    submit();
    await waitFor(() => expect(lastPayload()?.email).toBe("osoba@example.com"));
  });
});

describe("kształt payloadu", () => {
  it("niesie zgodę marketingową z TREŚCIĄ i językiem", async () => {
    // Rejestr zgód jest dowodem w rozumieniu RODO - sama flaga „true" nie mówi,
    // na co dokładnie osoba się zgodziła.
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.consents).toHaveLength(1);
    expect(lastPayload()?.consents[0]).toMatchObject({
      key: "newsletter",
      given: true,
      lang: "pl",
    });
    expect(lastPayload()?.consents[0].text.length).toBeGreaterThan(20);
  });

  it("niesie źródło i typ formularza - CRM musi wiedzieć, skąd przyszedł lead", async () => {
    mount({ source: "strona-kontakt" });
    fillMinimum();
    submit();
    await waitFor(() =>
      expect(lastPayload()).toMatchObject({
        source: "strona-kontakt",
        formType: "join_us",
      }),
    );
  });

  it("niesie LISTĘ pól wymaganych - serwer sprawdza tę samą politykę", async () => {
    mount({ showPhone: true, requirePhone: true, showCompany: true, requireCompany: false });
    fireEvent.change(field("tel"), { target: { value: "+48000000000" } });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.requiredFields.sort()).toEqual(["email", "phone"]));
  });

  it("tryb JEDNEGO pola nazwy wysyła `name`, bez rozbicia", async () => {
    mount();
    fireEvent.change(field("name"), { target: { value: "Anna Kowalska" } });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()).toMatchObject({ name: "Anna Kowalska" }));
    expect(lastPayload()?.firstName).toBeUndefined();
  });

  it("tryb ROZBITY wysyła imię, nazwisko ORAZ ich sklejenie", async () => {
    // Sklejenie zostaje dla automatyzacji, które znają tylko `name`.
    mount({ showFirstName: true, showLastName: true });
    fireEvent.change(field("given-name"), { target: { value: "Anna" } });
    fireEvent.change(field("family-name"), { target: { value: "Kowalska" } });
    fillMinimum();
    submit();
    await waitFor(() =>
      expect(lastPayload()).toMatchObject({
        firstName: "Anna",
        lastName: "Kowalska",
        name: "Anna Kowalska",
      }),
    );
  });

  it("tryb rozbity z JEDNYM wypełnionym polem nie zostawia wiszącej spacji", async () => {
    mount({ showFirstName: true, showLastName: true });
    fireEvent.change(field("given-name"), { target: { value: "Anna" } });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.name).toBe("Anna"));
  });

  it("pola kontaktowe jadą do `meta`, nie do kolumn pierwszej klasy", async () => {
    mount({
      showPosition: true,
      showLinkedin: true,
      showPhone: true,
      showCompany: true,
      showCountry: true,
    });
    fireEvent.change(field("organization-title"), { target: { value: "Analityk" } });
    fireEvent.change(field("url"), {
      target: { value: "https://example.org/in/anna" },
    });
    fireEvent.change(field("tel"), { target: { value: "+48000000000" } });
    fireEvent.change(field("organization"), { target: { value: "Instytut" } });
    fillMinimum();
    submit();
    await waitFor(() =>
      expect(lastPayload()?.meta).toEqual({
        position: "Analityk",
        linkedin: "https://example.org/in/anna",
        phone: "+48000000000",
        company: "Instytut",
      }),
    );
  });

  it("pole kontaktowe UKRYTE nie trafia do `meta`, choćby miało wartość w stanie", async () => {
    mount({ showPhone: false });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.meta).toBeUndefined();
  });

  it("puste pola nie zaśmiecają `meta` kluczami o pustej wartości", async () => {
    mount({ showPhone: true, showCompany: true });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.meta).toBeUndefined();
  });

  it("wartość pola kontaktowego jest przycinana do 500 znaków", async () => {
    // Bez sufitu jedno wklejenie z pliku wysadza wiersz w CRM.
    mount({ showCompany: true });
    fireEvent.change(field("organization"), { target: { value: "x".repeat(900) } });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.meta?.company).toHaveLength(500));
  });
});

describe("zainteresowania w payloadzie CRM", () => {
  beforeEach(() => {
    h.categories = [
      { id: "region", slug: "region", name_pl: "Region", name_en: null, parent_id: null },
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: "region" },
    ];
    h.tags = [{ id: "handel", slug: "handel", name: "Handel" }];
  });

  async function pickTopics(labels: string[]) {
    for (const label of labels) {
      fireEvent.click(await screen.findByRole("button", { name: label }));
    }
  }

  it("wybór jedzie POGRUPOWANY: obszary, tematy, płaska lista i klucz obszaru", async () => {
    // CRM ma widzieć tę samą strukturę, którą widział wypełniający - płaska
    // lista bez podziału zamienia raport w worek nazw.
    mount({ showInterests: true, interestsDisplay: "chips" });
    await pickTopics(["Afryka", "Handel"]);
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.custom).toMatchObject({
      interests_areas: "Afryka",
      interests_topics: "Handel",
      interests_region: "Afryka",
    });
    expect(lastPayload()?.custom?.interests).toContain("Afryka");
    expect(lastPayload()?.custom?.interests).toContain("Handel");
  });

  it("bez wyboru nie wysyła ANI JEDNEGO klucza zainteresowań", async () => {
    mount({ showInterests: true, interestsDisplay: "chips" });
    await screen.findByRole("button", { name: "Afryka" });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.custom).toBeUndefined();
  });

  it("sam tag nie generuje klucza obszarów", async () => {
    mount({ showInterests: true, interestsDisplay: "chips" });
    await pickTopics(["Handel"]);
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.custom?.interests_areas).toBeUndefined();
    expect(lastPayload()?.custom?.interests_topics).toBe("Handel");
  });

  it("kategoria BEZ rodzica nie tworzy klucza `interests_undefined`", async () => {
    h.categories = [
      { id: "obszar", slug: "obszar", name_pl: "Obszar", name_en: null, parent_id: null },
    ];
    h.tags = [];
    mount({ showInterests: true, interestsDisplay: "chips" });
    await pickTopics(["Obszar"]);
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    const keys = Object.keys(lastPayload()?.custom ?? {});
    expect(keys.filter((k) => k.startsWith("interests_") && k !== "interests_areas")).toEqual([]);
  });

  it("po udanym zapisie wybór jedzie też do zainteresowań użytkownika", async () => {
    mount({ showInterests: true, interestsDisplay: "chips" });
    await pickTopics(["Afryka", "Handel"]);
    fillMinimum();
    submit();
    await waitFor(() => expect(h.savedInterests).toHaveLength(1));
    // Rozdzielenie po typie jest istotne: `user_follows` trzyma osobno kategorie
    // i tagi, a pomyłka zapisałaby tag jako kategorię.
    expect(h.savedInterests[0]).toEqual({ categoryIds: ["afryka"], tagIds: ["handel"] });
  });

  it("NIEUDANY zapis do newslettera NIE zapisuje zainteresowań", async () => {
    // Kolejność ma znaczenie: zainteresowania bez subskrypcji to stan, którego
    // użytkownik nie zamawiał.
    h.subscribeResult = { ok: false, error: "rate_limited" };
    mount({ showInterests: true, interestsDisplay: "chips" });
    await pickTopics(["Afryka"]);
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("rate_limited")).toBeTruthy());
    expect(h.savedInterests).toEqual([]);
  });
});

describe("użytkownik zalogowany", () => {
  it("po zapisie wiąże subskrypcję z kontem i zapisuje zgodę w rejestrze", async () => {
    h.userId = "user-1";
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(h.linkCalls).toBe(1));
    expect(h.consentCalls).toBe(1);
  });

  it("gość nie woła ani wiązania, ani rejestru zgód", async () => {
    h.userId = null;
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(h.linkCalls).toBe(0);
    expect(h.consentCalls).toBe(0);
  });
});

describe("błąd i stan przycisku", () => {
  it("odmowa serwera pokazuje JEJ komunikat", async () => {
    h.subscribeResult = { ok: false, error: "Adres jest już zapisany" };
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("Adres jest już zapisany")).toBeTruthy());
  });

  it.each(["not_configured", "disabled"])(
    "błąd konfiguracji (%s) jedzie komunikatem OGÓLNYM, nie kodem",
    async (error) => {
      // „not_configured" na stronie publicznej mówi odwiedzającemu o stanie
      // naszej integracji, a nie o tym, co ma zrobić.
      h.subscribeResult = { ok: false, error };
      mount();
      fillMinimum();
      submit();
      await waitFor(() => expect(screen.getByText("joinUs.errorGeneric")).toBeTruthy());
    },
  );

  it("wyjątek sieciowy pokazuje komunikat wyjątku", async () => {
    h.subscribeThrows = new Error("Network request failed");
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("Network request failed")).toBeTruthy());
  });

  it("wyjątek bez komunikatu degraduje do klucza ogólnego", async () => {
    h.subscribeThrows = { code: 500 };
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("joinUs.errorGeneric")).toBeTruthy());
  });

  it("BŁĄD NIE CZYŚCI FORMULARZA - i to jest cała treść testu", async () => {
    // Wyczyszczone pola po nieudanym zapisie każą wpisać wszystko od nowa
    // i wyglądają jak sukces.
    h.subscribeResult = { ok: false, error: "Odmowa" };
    mount({ showCompany: true });
    fireEvent.change(field("organization"), { target: { value: "Instytut" } });
    fillMinimum("anna@example.org");
    submit();
    await waitFor(() => expect(screen.getByText("Odmowa")).toBeTruthy());
    expect(field("email").value).toBe("anna@example.org");
    expect(field("organization").value).toBe("Instytut");
  });

  it("SUKCES zastępuje formularz potwierdzeniem, a nie pustymi polami", async () => {
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it("PODWÓJNY SUBMIT nie wysyła dwóch zapisów", async () => {
    // Dwa kliknięcia „Zapisz się" to dwa leady w CRM z tym samym adresem.
    // Odpowiedź serwera jest wstrzymana bramką (bez zegarów), więc formularz
    // stoi w stanie oczekiwania dokładnie tak długo, jak potrzebuje test.
    //
    // ZAPORĄ JEST WYŁĄCZONY PRZYCISK, nie strażnik w handlerze - i to jest
    // przedmiotem dowodu. Sam `submit` handler nie ma blokady ponownego wejścia,
    // ale nie da się jej wywołać z interfejsu: przycisk jest jedynym elementem
    // zgłaszającym ten formularz, a zgłoszenie niejawne (Enter w polu) aktywuje
    // ten sam przycisk - wyłączony nie zgłasza niczego. Test strzelający
    // zdarzeniem `submit` wprost w formularz omijałby tę drogę i „dowodził"
    // defektu, którego użytkownik nie umie osiągnąć.
    let release: () => void = () => undefined;
    h.subscribeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));

    const button = document.querySelector('button[type="submit"]');
    expect(button?.hasAttribute("disabled")).toBe(true);
    // Kliknięcie w wyłączony przycisk nie wysyła drugiego zapisu.
    fireEvent.click(button as HTMLButtonElement);
    expect(h.subscribePayloads).toHaveLength(1);

    release();
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(h.subscribePayloads).toHaveLength(1);
  });

  it("przycisk zapisu wraca do stanu aktywnego po BŁĘDZIE", async () => {
    // Przycisk zablokowany na zawsze po jednym nieudanym zapisie zamyka drogę
    // ponowienia - a to jest najczęstsza reakcja na komunikat o błędzie sieci.
    h.subscribeResult = { ok: false, error: "Odmowa" };
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("Odmowa")).toBeTruthy());
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false);
  });
});

describe("warianty prezentacji i nadpisania z buildera", () => {
  // Widget ma cztery warianty i ~30 pól konfiguracji. Nie klikamy ich po kolei
  // dla procentu: każda asercja niżej pilnuje kontraktu, którego złamanie widzi
  // operator CMS („zmieniłem, nic się nie stało") albo odwiedzający (formularz
  // bez korzyści, obraz bez opisu alternatywnego).
  it.each([
    ["card", "join-us-shell--card"],
    ["inline", "join-us-shell--inline"],
    ["split", "join-us-shell--split"],
    ["split-image", "join-us-shell--split-image"],
  ])("wariant %s dostaje własną klasę powłoki", (variant, shellClass) => {
    const { container } = mount({
      variant: variant as "card" | "inline" | "split" | "split-image",
    });
    expect(container.querySelector("section")?.className).toContain(shellClass);
  });

  it.each(["split", "split-image"])(
    "wariant %s pokazuje TRZY korzyści obok formularza",
    (variant) => {
      // Wariant dwukolumnowy bez listy korzyści to pusta kolumna obok pól.
      mount({ variant: variant as "split" | "split-image" });
      expect(document.querySelectorAll(".join-us-perks li")).toHaveLength(3);
    },
  );

  it("nagłówek ma id UNIKALNE - dwa widgety na stronie nie kradną sobie nazwy", () => {
    const first = mount();
    const second = mount();
    const ids = [first, second].map((view) =>
      view.container.querySelector("section")?.getAttribute("aria-labelledby"),
    );
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    // `aria-labelledby` musi wskazywać na nagłówek WŁASNEJ sekcji.
    for (const view of [first, second]) {
      const section = view.container.querySelector("section");
      const target = section?.getAttribute("aria-labelledby");
      expect(section?.querySelector(`#${target}`)).toBeTruthy();
    }
  });

  it("nadpisane teksty wygrywają nad ustawieniami newslettera i słownikiem", () => {
    mount({
      variant: "split",
      title: "Własny tytuł",
      subtitle: "Własny podtytuł",
      perk1: "Korzyść jeden",
      perk2: "Korzyść dwa",
      perk3: "Korzyść trzy",
      submitLabel: "Wyślij",
      consentText: "Moja zgoda",
    });
    for (const text of [
      "Własny tytuł",
      "Własny podtytuł",
      "Korzyść jeden",
      "Korzyść dwa",
      "Korzyść trzy",
      "Wyślij",
      "Moja zgoda",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("nadpisany komunikat sukcesu zastępuje domyślny", async () => {
    mount({ successText: "Do zobaczenia w skrzynce" });
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText("Do zobaczenia w skrzynce")).toBeTruthy());
  });

  it("nadpisana etykieta pola zastępuje etykietę z konfiguracji rejestracji", () => {
    mount({ showCompany: true, companyPlaceholder: "Instytucja" });
    expect(screen.getByLabelText("Instytucja", { exact: false })).toBeTruthy();
  });

  it("własne tło emituje scoped CSS przypięty do TEGO widgetu", () => {
    // Reguła globalna zmieniłaby tło wszystkim widgetom na stronie.
    const { container } = mount({ bgLight: "#ffffff", bgDark: "#101010" });
    const style = container.querySelector("style")?.textContent ?? "";
    const jusId = container.querySelector("section")?.getAttribute("data-jus-id");
    expect(jusId).toBeTruthy();
    expect(style).toContain(`[data-jus-id="${jusId}"]`);
    expect(style).toContain("#ffffff");
    expect(style).toContain("#101010");
  });

  it("samo tło jasne wystarcza - tryb ciemny dziedziczy je zamiast wracać do karty", () => {
    const { container } = mount({ bgLight: "#ffffff" });
    const style = container.querySelector("style")?.textContent ?? "";
    expect(style.match(/#ffffff/g)?.length).toBe(2);
  });

  it("bez własnego tła powłoka jest przezroczysta i nie emituje CSS tła", () => {
    const { container } = mount();
    expect(container.querySelector("section")?.className).toContain("bg-transparent");
    expect(container.querySelector("style")?.textContent ?? "").not.toContain("background:");
  });

  it("rozmiary z buildera jadą przez scoped CSS, nie tylko inline", () => {
    // Rozmiar wyłącznie inline przegrywa z globalnymi regułami platformy -
    // operator zmienia liczbę i nic się nie dzieje.
    const { container } = mount({ titleSize: 30, buttonSize: 18 });
    const style = container.querySelector("style")?.textContent ?? "";
    expect(style).toContain("30px");
    expect(style).toContain("18px");
  });

  it("wariant z obrazem pokazuje obraz z OPISEM alternatywnym w bieżącym języku", () => {
    mount({
      variant: "split-image",
      imageUrl: "https://cdn.example.org/hero.webp",
      imageAlt: "Zespół na konferencji",
      imageAltEn: "Team at a conference",
    });
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toBe("https://cdn.example.org/hero.webp");
    expect(image.getAttribute("alt")).toBe("Zespół na konferencji");
  });

  it("brak opisu w bieżącym języku cofa się do drugiego, nie do pustki", () => {
    // Obraz bez opisu alternatywnego jest dla czytnika ekranu niewidoczny.
    mount({
      variant: "split-image",
      imageUrl: "https://cdn.example.org/hero.webp",
      imageAltEn: "Team at a conference",
    });
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Team at a conference");
  });

  it("wariant z obrazem BEZ obrazu zostawia kolumnę o niezerowej wysokości", () => {
    // Kolumna bez obrazu i bez minimalnej wysokości zapada się do zera, a układ
    // dwukolumnowy zamienia się w jedną kolumnę z formularzem.
    //
    // NIE asertujemy tu samego gradientu zastępczego: jego wartość domyślna
    // używa `color-mix()`, którego happy-dom nie parsuje i wycina cały skrót
    // `background` ze stylu inline. Że ta ŚCIEŻKA działa, dowodzi test niżej -
    // z gradientem o składni, którą happy-dom rozumie.
    const { container } = mount({ variant: "split-image" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("min-h-[220px]");
  });

  it("własny gradient zastępczy wygrywa nad wbudowanym", () => {
    const { container } = mount({
      variant: "split-image",
      imageGradient: "linear-gradient(90deg, red, blue)",
    });
    expect(container.innerHTML).toContain("red");
  });

  it("proporcja kadru z konfiguracji dociera do stylu", () => {
    const { container } = mount({ variant: "split-image", imageAspect: "16/9" });
    const framed = [...container.querySelectorAll<HTMLElement>("div")].some(
      (node) => node.style.aspectRatio !== "",
    );
    expect(framed).toBe(true);
  });

  it("proporcja „auto” zostawia minimalną wysokość kolumny", () => {
    const { container } = mount({ variant: "split-image", imageAspect: "auto" });
    expect(container.innerHTML).toContain("min-h-[220px]");
  });

  it("własny kolor ikon korzyści jest chroniony przed globalnym override'em", () => {
    const { container } = mount({ variant: "split", perkIconColor: "#ff0000" });
    const marked = container.querySelector("[data-keep-color]");
    expect(marked).toBeTruthy();
  });

  it("pola własne z konfiguracji są renderowane", () => {
    mount({
      customFields: [
        { id: "cf1", labelPl: "Nr członkowski", labelEn: "Member no", type: "text" as const },
      ],
    });
    expect(screen.getByLabelText("Nr członkowski", { exact: false })).toBeTruthy();
  });

  it("wartość pola własnego jedzie do payloadu pod swoim identyfikatorem", async () => {
    mount({
      customFields: [
        { id: "cf1", labelPl: "Nr członkowski", labelEn: "Member no", type: "text" as const },
      ],
    });
    fireEvent.change(screen.getByLabelText("Nr członkowski", { exact: false }), {
      target: { value: "12345" },
    });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.custom).toMatchObject({ cf1: "12345" }));
  });

  it("puste pole własne nie zaśmieca payloadu", async () => {
    mount({
      customFields: [
        { id: "cf1", labelPl: "Nr członkowski", labelEn: "Member no", type: "text" as const },
      ],
    });
    fillMinimum();
    submit();
    await waitFor(() => expect(h.subscribePayloads).toHaveLength(1));
    expect(lastPayload()?.custom).toBeUndefined();
  });

  it("WYMAGANE pole własne blokuje wysyłkę", async () => {
    mount({
      customFields: [
        {
          id: "cf1",
          labelPl: "Nr członkowski",
          labelEn: "Member no",
          type: "text" as const,
          required: true,
        },
      ],
    });
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText(/Nr członkowski|cf1/)).toBeTruthy());
    expect(h.subscribePayloads).toEqual([]);
  });

  it("dodatkowa klasa z konfiguracji dociera do powłoki", () => {
    const { container } = mount({ className: "mt-12" });
    expect(container.querySelector("section")?.className).toContain("mt-12");
  });

  it("nieparzysta liczba pól dodatkowych rozciąga ostatnie na dwie kolumny", () => {
    // Inaczej w siatce zostaje puste oczko obok ostatniego pola.
    const { container } = mount({ showPhone: true });
    expect(container.innerHTML).toContain("sm:col-span-2");
  });

  it("parzysta liczba pól dodatkowych nie rozciąga żadnego", () => {
    const { container } = mount({ showPhone: true, showCompany: true });
    expect(container.innerHTML).not.toContain("sm:col-span-2");
  });

  it("pole kraju renderuje się jako combobox, nie zwykły input", () => {
    mount({ showCountry: true });
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("wartość kraju jedzie do `meta`", async () => {
    mount({ showCountry: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Polska" } });
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.meta).toMatchObject({ country: "Polska" }));
  });
});

describe("język angielski", () => {
  it("komunikaty walidacji i zgoda jadą po angielsku", async () => {
    // Atrapa i18n zwraca klucze, ale KOMUNIKATY ZŁOŻONE w kodzie („Please fill
    // in required fields") są budowane z `lang` - i to je sprawdzamy.
    h.language = "en";
    mount({ showPhone: true, requirePhone: true });
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText(/Please fill in required fields/)).toBeTruthy());
  });

  it("treść zgody w payloadzie jest w języku interfejsu", async () => {
    h.language = "en";
    mount();
    fillMinimum();
    submit();
    await waitFor(() => expect(lastPayload()?.consents[0].lang).toBe("en"));
    expect(lastPayload()?.consents[0].text).toContain("newsletter");
    expect(lastPayload()?.language).toBe("en");
  });

  it("brak wybranego tematu po angielsku ma angielski komunikat", async () => {
    h.language = "en";
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: "Africa", parent_id: null },
    ];
    mount({ showInterests: true, requireInterests: true, interestsDisplay: "chips" });
    await screen.findByRole("button", { name: "Africa" });
    fillMinimum();
    submit();
    await waitFor(() => expect(screen.getByText(/Please pick at least one topic/)).toBeTruthy());
  });
});
