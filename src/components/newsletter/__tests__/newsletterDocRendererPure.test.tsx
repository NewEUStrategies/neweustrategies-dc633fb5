// Walidacja i normalizacja pól formularza zapisu (NewsletterDocRenderer).
//
// MAILA NIE DA SIĘ WYCOFAĆ, ALE ZAPISU TEŻ NIE DA SIĘ COFNĄĆ W SKUTKACH.
// Ten formularz jest punktem zbierania zgody i jedynym miejscem, w którym
// numer telefonu i profil LinkedIn wchodzą do CRM. Wartość zapisana w złym
// kształcie (spacje w numerze, adres bez schematu, cudzy serwis podany jako
// LinkedIn) zostaje w bazie i jedzie dalej do kampanii - nikt jej nie zobaczy
// przed wysyłką, bo formularz nie pokazuje operatorowi, co naprawdę zapisał.
// Dlatego asercje idą na PAYLOAD wysłany do `subscribeToNewsletter`, a nie na
// to, co widać w polu.
//
// CO DOWODZI TEN PLIK:
//   1. `normalizePhone` - jaka postać numeru trafia do CRM i który numer jest
//      odrzucony ZANIM dojdzie do zapisu (7-15 cyfr, opcjonalne `+`).
//   2. `normalizeLinkedin` - który adres jest uznany za LinkedIn i czy dostaje
//      schemat `https://`; stan faktyczny dla adresów z parametrami i dla
//      obcych serwisów jest tu PRZYPIĘTY, nie zgadywany.
//   3. `widgetErrorKey` - PRZY KTÓRYM polu staje komunikat błędu. Błąd
//      pokazany pod cudzym polem jest gorszy niż brak błędu: człowiek poprawia
//      wartość, która była dobra, i nie widzi tej, która blokuje zapis.
//
// CZEGO TU NIE MA: renderu widgetów (`...Widgets.test.tsx`) i całego dokumentu
// wraz ze ścieżką sukcesu/błędu zapisu (`...Sections.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { NlDoc, NlLang } from "@/lib/newsletter-builder/types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { SubscribePayload } from "./docFixtures";

const h = vi.hoisted(() => ({
  /** Payloady, które renderer wysłał do zapisu - przedmiot dowodu. */
  payloads: [] as SubscribePayload[],
  result: { ok: true, status: "pending" } as { ok: boolean; status?: string; error?: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  interface CountChain extends PromiseLike<{ count: number | null; error: null }> {
    select: () => CountChain;
    eq: () => CountChain;
  }
  const chain: CountChain = {
    select: () => chain,
    eq: () => chain,
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ count: 0, error: null }).then(onFulfilled, onRejected),
  };
  return { supabase: { from: () => chain } };
});

vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (dirty: string) => dirty.replace(/<script[\s\S]*?<\/script>/gi, ""),
}));

// `useServerFn` oddaje samą funkcję, więc atrapa modułu serwerowego niżej jest
// jednocześnie tym, co formularz wywoła. Reszta pakietu zostaje prawdziwa.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: ({ data }: { data: SubscribePayload }) => {
    h.payloads.push(data);
    return Promise.resolve(h.result);
  },
}));

import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  makeCheckbox,
  makeEmailField,
  makeFormDoc,
  makeMailingList,
  makeMailingLists,
  makeSelect,
  makeSettings,
  makeTextField,
  resetDocIds,
} from "./docFixtures";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
  resetDocIds();
  h.payloads = [];
  h.result = { ok: true, status: "pending" };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function mount(
  doc: NlDoc,
  opts: { lang?: NlLang; settings?: NewsletterSettings; source?: string } = {},
) {
  return renderWithQueryClient(
    <NewsletterDocRenderer
      doc={doc}
      settings={opts.settings ?? makeSettings()}
      lang={opts.lang ?? "pl"}
      source={opts.source}
    />,
  );
}

function inputByName(name: string): HTMLInputElement {
  const el = document.querySelector(`input[name="${name}"]`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola input[name=${name}]`);
  return el;
}

function selectByName(name: string): HTMLSelectElement {
  const el = document.querySelector(`select[name="${name}"]`);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`test: brak listy select[name=${name}]`);
  return el;
}

function typeInto(name: string, value: string): void {
  fireEvent.change(inputByName(name), { target: { value } });
}

const form = (): HTMLFormElement => {
  const el = document.querySelector("form");
  if (!(el instanceof HTMLFormElement)) throw new Error("test: brak formularza");
  return el;
};

/**
 * Wysyła formularz i domyka asynchroniczny handler. `act` z asynchroniczną
 * funkcją opróżnia kolejkę mikrozadań, więc po powrocie stan formularza jest
 * już ostateczny - bez czekania na zegar i bez wyścigu z odpowiedzią zapisu.
 */
async function submitAndSettle(): Promise<void> {
  await act(async () => {
    fireEvent.submit(form());
  });
}

/** Grupa pola (`.input-group`), w której stanął komunikat błędu. */
function groupOf(el: Element): HTMLElement {
  const group = el.closest(".input-group");
  if (!(group instanceof HTMLElement)) throw new Error("test: pole poza grupą .input-group");
  return group;
}

/** Ostatni payload - rzucamy wprost, bo brak zapisu to inny wynik niż zły zapis. */
function lastPayload(): SubscribePayload {
  const p = h.payloads.at(-1);
  if (!p) throw new Error("test: formularz nie wykonał zapisu");
  return p;
}

// ---------------------------------------------------------------------------
// normalizePhone - jaki numer wchodzi do CRM
// ---------------------------------------------------------------------------

describe("numer telefonu w zapisie do CRM", () => {
  async function submitPhone(raw: string, lang: NlLang = "pl"): Promise<void> {
    mount(makeFormDoc([makeTextField("phone")]), { lang });
    typeInto("email", "jan@example.pl");
    typeInto("phone", raw);
    await submitAndSettle();
  }

  it("numer wpisany ze spacjami trafia do CRM jednym ciągiem, a nie tak jak go wpisano", async () => {
    await submitPhone("+48 123 456 789");

    expect(lastPayload().meta).toEqual({ phone: "+48123456789" });
  });

  it("nawiasy i myślniki z wizytówki nie zostają w numerze zapisanym w bazie", async () => {
    await submitPhone("(22) 123-45-67");

    expect(lastPayload().meta?.phone).toBe("221234567");
  });

  it("numer bez kierunkowego zapisuje się bez dopisywania kierunkowego z powietrza", async () => {
    await submitPhone("221234567");

    expect(lastPayload().meta?.phone).toBe("221234567");
  });

  it("numer już znormalizowany przechodzi bez zmian - ponowny zapis nie psuje wartości", async () => {
    await submitPhone("+48123456789");
    const pierwszy = lastPayload().meta?.phone;

    cleanup();
    await submitPhone(pierwszy ?? "");

    expect(lastPayload().meta?.phone).toBe(pierwszy);
    expect(pierwszy).toBe("+48123456789");
  });

  it("kropki w numerze też są usuwane, więc format z faktury nie blokuje zapisu", async () => {
    await submitPhone("22.123.45.67");

    expect(lastPayload().meta?.phone).toBe("221234567");
  });

  it("za krótki numer (6 cyfr) zatrzymuje zapis, zamiast wpuścić bezużyteczny kontakt do CRM", async () => {
    await submitPhone("123456");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("phone")).textContent).toContain("Niepoprawny numer telefonu");
  });

  it("za długi numer (16 cyfr) zatrzymuje zapis", async () => {
    await submitPhone("1234567890123456");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("phone")).dataset.invalid).toBe("true");
  });

  it("tekst zamiast numeru nie jedzie do CRM jako telefon", async () => {
    await submitPhone("zadzwon do mnie");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("phone")).dataset.invalid).toBe("true");
  });

  it("puste pole nieobowiązkowe nie blokuje zapisu i nie dokłada pustego telefonu do CRM", async () => {
    await submitPhone("   ");

    expect(h.payloads).toHaveLength(1);
    expect(lastPayload().meta).toBeUndefined();
  });

  it("komunikat o złym numerze jest po angielsku, gdy formularz stoi na wersji EN", async () => {
    await submitPhone("123", "en");

    expect(groupOf(inputByName("phone")).textContent).toContain("Invalid phone number");
  });

  it("pole telefonu oznaczone jako wymagane blokuje pusty zapis komunikatem o wymagalności", async () => {
    mount(makeFormDoc([makeTextField("phone", { required: true })]));
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("phone")).textContent).toContain("Pole wymagane");
  });

  it("wymagane pole telefonu jedzie w `requiredFields`, żeby serwer wymusił tę samą regułę", async () => {
    mount(makeFormDoc([makeTextField("phone", { required: true })]));
    typeInto("email", "jan@example.pl");
    typeInto("phone", "+48 123 456 789");
    await submitAndSettle();

    expect(lastPayload().requiredFields).toEqual(["phone"]);
  });
});

// ---------------------------------------------------------------------------
// normalizeLinkedin - który adres uznajemy za profil
// ---------------------------------------------------------------------------

describe("adres LinkedIn w zapisie do CRM", () => {
  async function submitLinkedin(raw: string, lang: NlLang = "pl"): Promise<void> {
    mount(makeFormDoc([makeTextField("linkedin")]), { lang });
    typeInto("email", "jan@example.pl");
    typeInto("linkedin", raw);
    await submitAndSettle();
  }

  it("pełny adres z profilu zapisuje się bez zmian", async () => {
    await submitLinkedin("https://www.linkedin.com/in/jan-kowalski");

    expect(lastPayload().meta?.linkedin).toBe("https://www.linkedin.com/in/jan-kowalski");
  });

  it("adres wklejony bez `https://` dostaje schemat, więc link w CRM da się kliknąć", async () => {
    await submitLinkedin("linkedin.com/in/jan-kowalski");

    expect(lastPayload().meta?.linkedin).toBe("https://linkedin.com/in/jan-kowalski");
  });

  it("spacje wokół wklejonego adresu nie unieważniają go", async () => {
    await submitLinkedin("  linkedin.com/in/jan-kowalski  ");

    expect(lastPayload().meta?.linkedin).toBe("https://linkedin.com/in/jan-kowalski");
  });

  it("adres firmowy (/company/) jest przyjmowany na równi z profilem osobowym", async () => {
    await submitLinkedin("https://linkedin.com/company/new-european-strategies");

    expect(lastPayload().meta?.linkedin).toBe(
      "https://linkedin.com/company/new-european-strategies",
    );
  });

  it("stary format profilu (/pub/) nadal przechodzi - kontakty sprzed lat nie wypadają", async () => {
    await submitLinkedin("linkedin.com/pub/jan-kowalski");

    expect(lastPayload().meta?.linkedin).toBe("https://linkedin.com/pub/jan-kowalski");
  });

  it("poddomena krajowa (pl.linkedin.com) jest przyjmowana", async () => {
    await submitLinkedin("https://pl.linkedin.com/in/jan-kowalski");

    expect(lastPayload().meta?.linkedin).toBe("https://pl.linkedin.com/in/jan-kowalski");
  });

  it("sam identyfikator bez domeny nie jest zapisywany jako profil", async () => {
    await submitLinkedin("jan-kowalski");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("linkedin")).textContent).toContain("Niepoprawny URL LinkedIn");
  });

  it("adres innego serwisu jest odrzucany - do pola LinkedIn nie wejdzie profil z X", async () => {
    await submitLinkedin("https://x.com/jan-kowalski");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("linkedin")).dataset.invalid).toBe("true");
  });

  it("domena udająca LinkedIn w ścieżce obcego hosta jest odrzucana", async () => {
    await submitLinkedin("https://evil.test/linkedin.com/in/jan-kowalski");

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("linkedin")).dataset.invalid).toBe("true");
  });

  it.fails(
    "adres skopiowany z przeglądarki (z parametrami ?trk=) POWINIEN być przyjmowany",
    async () => {
      // STAN FAKTYCZNY, PRZYPIĘTY ŚWIADOMIE: `LINKEDIN_RE` kończy się na `$` po
      // opcjonalnym ukośniku, więc każdy adres z parametrami - a taki właśnie
      // podsuwa przycisk „kopiuj link" na LinkedIn - jest odrzucany jako
      // niepoprawny. KONSEKWENCJA: człowiek, który wkleił dokładnie to, co dał
      // mu serwis, dostaje komunikat o błędnym adresie i najczęściej rezygnuje
      // z wypełnienia pola. Naprawa to obcięcie query stringa w normalizacji -
      // zmiana kodu produkcyjnego, więc tutaj tylko zgłoszenie.
      await submitLinkedin("https://www.linkedin.com/in/jan-kowalski?trk=nav");

      expect(lastPayload().meta?.linkedin).toBe("https://www.linkedin.com/in/jan-kowalski");
    },
  );

  it("puste pole LinkedIn nie blokuje zapisu i nie dokłada pustego klucza do CRM", async () => {
    await submitLinkedin("");

    expect(h.payloads).toHaveLength(1);
    expect(lastPayload().meta).toBeUndefined();
  });

  it("komunikat o złym adresie jest po angielsku na wersji EN formularza", async () => {
    await submitLinkedin("jan-kowalski", "en");

    expect(groupOf(inputByName("linkedin")).textContent).toContain("Invalid LinkedIn URL");
  });
});

// ---------------------------------------------------------------------------
// Imię, nazwisko, firma, stanowisko
// ---------------------------------------------------------------------------

describe("imię, nazwisko i dane firmowe", () => {
  it("imię i nazwisko jadą na wierzch payloadu i sklejają się w pełną nazwę odbiorcy", async () => {
    mount(makeFormDoc([makeTextField("firstName"), makeTextField("lastName")]));
    typeInto("email", "jan@example.pl");
    typeInto("firstName", "Jan");
    typeInto("lastName", "Kowalski-Nowak");
    await submitAndSettle();

    const p = lastPayload();
    expect(p.firstName).toBe("Jan");
    expect(p.lastName).toBe("Kowalski-Nowak");
    expect(p.name).toBe("Jan Kowalski-Nowak");
  });

  it("imię z polskimi znakami i apostrofem przechodzi - nie odrzucamy prawdziwych nazwisk", async () => {
    mount(makeFormDoc([makeTextField("firstName"), makeTextField("lastName")]));
    typeInto("email", "jan@example.pl");
    typeInto("firstName", "Zażółć");
    typeInto("lastName", "O’Brien");
    await submitAndSettle();

    expect(lastPayload().name).toBe("Zażółć O’Brien");
  });

  it("jednoliterowe imię zatrzymuje zapis - w mailu powitalnym nie stanie „Cześć J”", async () => {
    mount(makeFormDoc([makeTextField("firstName")]));
    typeInto("email", "jan@example.pl");
    typeInto("firstName", "J");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("firstName")).textContent).toContain("Dozwolone litery");
  });

  it("cyfry w nazwisku nie wchodzą do bazy adresatów", async () => {
    mount(makeFormDoc([makeTextField("lastName")]));
    typeInto("email", "jan@example.pl");
    typeInto("lastName", "Kowalski3");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("lastName")).dataset.invalid).toBe("true");
  });

  it("nazwa firmy i stanowisko jadą do CRM w `meta`, a nie na wierzch payloadu", async () => {
    mount(makeFormDoc([makeTextField("company"), makeTextField("position")]));
    typeInto("email", "jan@example.pl");
    typeInto("company", "New European Strategies");
    typeInto("position", "Public Affairs Manager");
    await submitAndSettle();

    expect(lastPayload().meta).toEqual({
      company: "New European Strategies",
      position: "Public Affairs Manager",
    });
  });

  it("jednoznakowa nazwa firmy zatrzymuje zapis zamiast trafić do CRM jako „x”", async () => {
    mount(makeFormDoc([makeTextField("company")]));
    typeInto("email", "jan@example.pl");
    typeInto("company", "x");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("company")).textContent).toContain("Nieprawidlowa wartosc");
  });

  it("stanowisko dłuższe niż 120 znaków jest odrzucane, a nie ucinane po cichu", async () => {
    mount(makeFormDoc([makeTextField("position")]));
    typeInto("email", "jan@example.pl");
    typeInto("position", "a".repeat(121));
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("position")).dataset.invalid).toBe("true");
  });

  it("dokładnie 120 znaków stanowiska jeszcze przechodzi - granica nie jest zaniżona", async () => {
    mount(makeFormDoc([makeTextField("position")]));
    typeInto("email", "jan@example.pl");
    typeInto("position", "a".repeat(120));
    await submitAndSettle();

    expect(lastPayload().meta?.position).toHaveLength(120);
  });
});

// ---------------------------------------------------------------------------
// Adres e-mail - jedyne pole obowiązkowe zawsze
// ---------------------------------------------------------------------------

describe("adres e-mail", () => {
  it("pusty adres zatrzymuje zapis komunikatem o wymagalności", async () => {
    mount(makeFormDoc());
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("email")).textContent).toContain("Pole wymagane");
  });

  it("adres bez domeny nie jedzie do zapisu - inaczej potwierdzenie nie ma dokąd pójść", async () => {
    mount(makeFormDoc());
    typeInto("email", "jan-bez-domeny");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(inputByName("email")).textContent).toContain("Niepoprawny adres e-mail");
  });

  it("adres zapisuje się małymi literami i bez spacji - te same skrzynki nie dublują się w bazie", async () => {
    mount(makeFormDoc());
    typeInto("email", "  Jan.Kowalski@Example.PL  ");
    await submitAndSettle();

    expect(lastPayload().email).toBe("jan.kowalski@example.pl");
  });

  it("komunikat o złym adresie jest po angielsku na wersji EN", async () => {
    mount(makeFormDoc(), { lang: "en" });
    typeInto("email", "jan-bez-domeny");
    await submitAndSettle();

    expect(groupOf(inputByName("email")).textContent).toContain("Invalid email address");
  });

  it("brak adresu po angielsku mówi o wymagalności w tym samym języku co formularz", async () => {
    mount(makeFormDoc(), { lang: "en" });
    await submitAndSettle();

    expect(groupOf(inputByName("email")).textContent).toContain("Required field");
  });
});

// ---------------------------------------------------------------------------
// widgetErrorKey - PRZY KTÓRYM polu staje komunikat
// ---------------------------------------------------------------------------

describe("miejsce, w którym staje komunikat błędu", () => {
  it("błąd adresu staje przy polu e-mail, a nie przy sąsiednim polu tekstowym", async () => {
    mount(makeFormDoc([makeTextField("company")]));
    typeInto("email", "zly-adres");
    typeInto("company", "New European Strategies");
    await submitAndSettle();

    expect(groupOf(inputByName("email")).dataset.invalid).toBe("true");
    expect(groupOf(inputByName("company")).dataset.invalid).toBeUndefined();
  });

  it("błąd pola tekstowego staje tylko przy polu, którego dotyczy", async () => {
    mount(makeFormDoc([makeTextField("phone"), makeTextField("company")]));
    typeInto("email", "jan@example.pl");
    typeInto("phone", "123");
    typeInto("company", "New European Strategies");
    await submitAndSettle();

    expect(groupOf(inputByName("phone")).dataset.invalid).toBe("true");
    expect(groupOf(inputByName("company")).dataset.invalid).toBeUndefined();
  });

  it("dwa pola e-mail w jednym dokumencie zapalają się razem - błąd adresu nie jest per widget", async () => {
    // KONSEKWENCJA: operator, który wstawił drugie pole e-mail (np. w kolumnie
    // obok), zobaczy ten sam komunikat dwa razy. To jest cena trzymania błędu
    // adresu pod stałym kluczem `email` - i dlatego jest tu przypięta.
    mount(makeFormDoc([makeEmailField()]));
    await submitAndSettle();

    const groups = document.querySelectorAll("[data-invalid='true']");
    expect(groups).toHaveLength(2);
  });

  it("błąd wyboru z listy staje przy tej liście, którą operator oznaczył jako wymaganą", async () => {
    mount(
      makeFormDoc([
        makeSelect({ name: "country", required: true }),
        makeSelect({ name: "sector", required: false }),
      ]),
    );
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(groupOf(selectByName("country")).textContent).toContain("Pole wymagane");
    expect(groupOf(selectByName("sector")).dataset.invalid).toBeUndefined();
  });

  it("wybrana wartość z listy jedzie do CRM pod nazwą pola", async () => {
    mount(makeFormDoc([makeSelect({ name: "country" })]));
    typeInto("email", "jan@example.pl");
    fireEvent.change(selectByName("country"), { target: { value: "be" } });
    await submitAndSettle();

    expect(lastPayload().meta).toEqual({ country: "be" });
  });

  it("błąd zgody staje pod tą zgodą, a nie w stopce formularza", async () => {
    mount(makeFormDoc([makeCheckbox({ key: "terms", required: true })]));
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    const box = inputByName("terms");
    const wrapper = box.closest("div");
    expect(h.payloads).toHaveLength(0);
    expect(wrapper?.textContent).toContain("Pole wymagane");
  });

  it("zaznaczona zgoda jedzie do rejestru zgód z treścią i językiem, w którym ją pokazano", async () => {
    mount(makeFormDoc([makeCheckbox({ key: "terms", required: true })]), { lang: "en" });
    typeInto("email", "jan@example.pl");
    fireEvent.click(inputByName("terms"));
    await submitAndSettle();

    expect(lastPayload().consents).toContainEqual({
      key: "terms",
      text: "I accept the <a href='/tos'>ToS</a>",
      given: true,
      lang: "en",
    });
  });

  it("błąd list tematycznych staje przy TEJ liście widgetów, która go wywołała", async () => {
    const wymagana = makeMailingLists({ id: "obowiazkowa", required: true });
    const opcjonalna = makeMailingLists({ id: "dodatkowa" });
    mount(makeFormDoc([wymagana, opcjonalna]), {
      settings: makeSettings({ popup_mailing_lists: [makeMailingList("brief")] }),
    });
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    const fieldsets = document.querySelectorAll("fieldset");
    expect(h.payloads).toHaveLength(0);
    expect(fieldsets[0].textContent).toContain("Pole wymagane");
    expect(fieldsets[1].textContent).not.toContain("Pole wymagane");
  });

  it("zaznaczone listy jadą do CRM jednym polem po przecinku", async () => {
    mount(makeFormDoc([makeMailingLists({ id: "listy" })]), {
      settings: makeSettings({
        popup_mailing_lists: [makeMailingList("brief"), makeMailingList("wydarzenia")],
      }),
    });
    typeInto("email", "jan@example.pl");
    const boxes = document.querySelectorAll("input[name='ml_listy']");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    await submitAndSettle();

    expect(lastPayload().meta).toEqual({ mailing_lists: "brief,wydarzenia" });
  });
});

// ---------------------------------------------------------------------------
// Zgoda newsletterowa i kształt payloadu
// ---------------------------------------------------------------------------

describe("zgoda newsletterowa doklejana zawsze", () => {
  it("treść zgody bierze się z polityki tenanta w języku formularza", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ policy_html_pl: "Zgoda PL", policy_html_en: "Consent EN" }),
    });
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(lastPayload().consents).toEqual([
      { key: "newsletter", text: "Zgoda PL", given: true, lang: "pl" },
    ]);
  });

  it("wersja EN zapisuje angielską treść zgody - rejestr zgód ma trzymać to, co widział człowiek", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ policy_html_pl: "Zgoda PL", policy_html_en: "Consent EN" }),
      lang: "en",
    });
    typeInto("email", "jane@example.com");
    await submitAndSettle();

    expect(lastPayload().consents[0]).toMatchObject({ text: "Consent EN", lang: "en" });
  });

  it("brak polityki w ustawieniach nie zostawia pustej zgody w rejestrze", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ policy_html_pl: null, policy_html_en: null }),
    });
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(lastPayload().consents[0].text).toBe("Wyrazam zgode na otrzymywanie newslettera.");
  });

  it("brak polityki na wersji EN daje angielską treść zastępczą, nie polską", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ policy_html_pl: null, policy_html_en: null }),
      lang: "en",
    });
    typeInto("email", "jane@example.com");
    await submitAndSettle();

    expect(lastPayload().consents[0].text).toBe("I agree to receive the newsletter.");
  });

  it("zapis niesie nazwę formularza i język - inaczej w CRM nie wiadomo, skąd wzięła się osoba", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ heading_pl: "Newsletter NES", heading_en: "NES newsletter" }),
    });
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    const p = lastPayload();
    expect(p.formName).toBe("Newsletter NES");
    expect(p.language).toBe("pl");
  });

  it("źródło zapisu domyślnie mówi „form”, gdy osadzenie go nie podało", async () => {
    mount(makeFormDoc());
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(lastPayload().source).toBe("form");
  });

  it("źródło podane przez osadzenie (np. popup) jedzie do zapisu bez podmiany", async () => {
    mount(makeFormDoc(), { source: "popup-exit-intent" });
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    expect(lastPayload().source).toBe("popup-exit-intent");
  });

  it("formularz bez dodatkowych pól nie wysyła pustych obiektów `meta` ani `requiredFields`", async () => {
    mount(makeFormDoc());
    typeInto("email", "jan@example.pl");
    await submitAndSettle();

    const p = lastPayload();
    expect(p.meta).toBeUndefined();
    expect(p.requiredFields).toBeUndefined();
    expect(p.firstName).toBeUndefined();
    expect(p.name).toBeUndefined();
  });

  it("kilka błędów naraz pokazuje się jednocześnie - poprawianie po jednym to porzucony formularz", async () => {
    mount(
      makeFormDoc([
        makeTextField("phone"),
        makeTextField("firstName"),
        makeSelect({ name: "country", required: true }),
      ]),
    );
    typeInto("email", "zly");
    typeInto("phone", "123");
    typeInto("firstName", "J");
    await submitAndSettle();

    expect(document.querySelectorAll("[data-invalid='true']")).toHaveLength(4);
    expect(h.payloads).toHaveLength(0);
  });

  it("poprawienie danych po odrzuceniu kończy się zapisem - komunikaty znikają", async () => {
    mount(makeFormDoc([makeTextField("phone")]));
    typeInto("email", "jan@example.pl");
    typeInto("phone", "123");
    await submitAndSettle();
    expect(h.payloads).toHaveLength(0);

    typeInto("phone", "+48 123 456 789");
    await submitAndSettle();

    await waitFor(() => expect(h.payloads).toHaveLength(1));
    expect(screen.queryByText(/Niepoprawny numer telefonu/)).toBeNull();
  });
});
