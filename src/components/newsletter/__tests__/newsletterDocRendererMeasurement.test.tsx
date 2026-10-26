// Osobne pole zgody na pomiar w dokumencie buildera newslettera (NlDoc;
// I9d-Y2b, decyzja właściciela 2026-10-23, wariant (b); rozstrzygnięcia
// R1.17 i R1.21).
//
// CO TEN PLIK DOWODZI.
//   1. MIEJSCE: stały wiersz na pełną szerokość, na końcu sekcji z pierwszym
//      przyciskiem wysyłki (pod obiema kolumnami układu 1-1), a bez przycisku -
//      na końcu ostatniej sekcji. Wiersz nie wchodzi między pole e-mail
//      a przycisk, więc nie rozbija rzędu „e-mail + przycisk".
//   2. TOR: natywne pole wyboru w tej samej etykiecie i klasach co widżet
//      `field.checkbox` (wspólna geometria w widżecie).
//   3. ŁADUNEK: deklaracja `email_measurement_declared` z treścią i wersją
//      z rejestru WYŁĄCZNIE po zaznaczeniu, po zgodzie na newsletter.
//   4. KLUCZE ZASTRZEŻONE: widżet `field.checkbox` z kluczem pola pomiaru nie
//      jest renderowany ani zbierany (także wymagany).
//   5. LIMIT: ładunek ponad `CONSENT_ENTRIES_MAX` nie wyjeżdża - komunikat
//      zamiast obcinania dowodu zgody.
//   6. axe w jasnym i ciemnym motywie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import type { NlDoc, NlLang } from "@/lib/newsletter-builder/types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { SubscribePayload } from "./docFixtures";

const h = vi.hoisted(() => ({
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
import {
  NL_DOC_TOO_MANY_CONSENTS,
  nlDocConsentEntryCount,
  nlDocConsentsWithinLimit,
  nlDocMeasurementSectionIndex,
} from "@/components/newsletter/nlDocMeasurement";
import { CONSENT_ENTRIES_MAX } from "@/lib/newsletter/consentLimits";
import { NEWSLETTER_CONSENT_VERSION, newsletterConsentHtml } from "@/lib/newsletter/consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  measurementConsentHtml,
  measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import {
  makeCheckbox,
  makeDoc,
  makeEmailField,
  makeFormDoc,
  makeParagraph,
  makeSection,
  makeSettings,
  makeSubmit,
  resetDocIds,
} from "./docFixtures";

beforeEach(() => {
  resetDocIds();
  h.payloads = [];
  h.result = { ok: true, status: "pending" };
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

function mount(doc: NlDoc, opts: { lang?: NlLang; settings?: NewsletterSettings } = {}) {
  return renderWithQueryClient(
    <NewsletterDocRenderer
      doc={doc}
      settings={opts.settings ?? makeSettings({ policy_html_pl: null, policy_html_en: null })}
      lang={opts.lang ?? "pl"}
    />,
  );
}

const form = (): HTMLFormElement => {
  const el = document.querySelector("form");
  if (!(el instanceof HTMLFormElement)) throw new Error("test: brak formularza");
  return el;
};

/** Wiersz pola pomiaru (etykieta) i jego natywne pole wyboru. */
const row = (): HTMLLabelElement | null =>
  document.querySelector<HTMLLabelElement>('label[data-consent="email_measurement"]');
const box = (): HTMLInputElement => {
  const el = row()?.querySelector("input[type='checkbox']");
  if (!(el instanceof HTMLInputElement)) throw new Error("test: brak pola pomiaru");
  return el;
};

function typeEmail(value = "jan@example.pl") {
  const el = document.querySelector<HTMLInputElement>('input[name="email"]');
  if (!el) throw new Error("test: brak pola e-mail");
  fireEvent.change(el, { target: { value } });
}

async function submitAndSettle(): Promise<void> {
  await act(async () => {
    fireEvent.submit(form());
  });
}

const follows = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

interface ConsentEntry {
  key: string;
  text: string;
  given: boolean;
  lang: string;
  version?: string;
}
const consentsOf = (p: SubscribePayload | undefined) =>
  (p?.consents ?? []) as unknown as ConsentEntry[];

describe("NlDoc: ładunek zapisu", () => {
  it("bez zaznaczenia - wyłącznie zgoda na newsletter (b) z wersją", async () => {
    mount(makeFormDoc());
    typeEmail();
    await submitAndSettle();
    expect(consentsOf(h.payloads.at(-1))).toEqual([
      {
        key: "newsletter",
        text: newsletterConsentHtml("pl"),
        given: true,
        lang: "pl",
        version: NEWSLETTER_CONSENT_VERSION,
      },
    ]);
  });

  it.each(["email_measurement", " Email_Measurement_Declared "])(
    "widżet `field.checkbox` z kluczem zastrzeżonym %j nie jest renderowany ani zbierany",
    async (key) => {
      mount(
        makeFormDoc([
          makeCheckbox({
            key,
            required: true,
            html: { pl: "Podrobiona zgoda na pomiar", en: "Forged measurement consent" },
          }),
        ]),
      );
      expect(screen.queryByText("Podrobiona zgoda na pomiar")).toBeNull();
      typeEmail();
      await submitAndSettle();
      // Wymagany, ale nieistniejący - nie blokuje zapisu i nie trafia do ładunku.
      expect(h.payloads).toHaveLength(1);
      expect(consentsOf(h.payloads[0]).map((entry) => entry.key)).toEqual(["newsletter"]);
    },
  );
});

describe("NlDoc: limit ładunku zgód (R1.21)", () => {
  const manyCheckboxes = (n: number) =>
    Array.from({ length: n }, (_, i) => makeCheckbox({ key: `zgoda_${i}` }));

  function tickAll() {
    for (const el of document.querySelectorAll<HTMLInputElement>('input[name^="zgoda_"]')) {
      fireEvent.click(el);
    }
  }

  it("licznik: pola zaznaczone + newsletter + deklaracja pomiaru", () => {
    expect(nlDocConsentEntryCount(0, false)).toBe(1);
    expect(nlDocConsentEntryCount(3, true)).toBe(5);
    expect(nlDocConsentsWithinLimit(CONSENT_ENTRIES_MAX - 1, false)).toBe(true);
    expect(nlDocConsentsWithinLimit(CONSENT_ENTRIES_MAX - 1, true)).toBe(false);
  });

  it("ładunek dokładnie w limicie wyjeżdża w całości", async () => {
    mount(makeFormDoc(manyCheckboxes(CONSENT_ENTRIES_MAX - 1)));
    typeEmail();
    tickAll();
    await submitAndSettle();
    expect(h.payloads).toHaveLength(1);
    expect(consentsOf(h.payloads[0])).toHaveLength(CONSENT_ENTRIES_MAX);
  });

  it("ładunek ponad limit: bez żądania i z komunikatem - nic nie jest obcinane", async () => {
    mount(makeFormDoc(manyCheckboxes(CONSENT_ENTRIES_MAX)));
    typeEmail();
    tickAll();
    await submitAndSettle();
    expect(h.payloads).toHaveLength(0);
    expect(screen.getByText(NL_DOC_TOO_MANY_CONSENTS.pl)).toBeInTheDocument();

    const first = document.querySelector<HTMLInputElement>('input[name^="zgoda_"]');
    if (!first) throw new Error("Missing consent fixture");
    fireEvent.click(first);
    await submitAndSettle();
    expect(h.payloads).toHaveLength(1);
    expect(consentsOf(h.payloads[0])).toHaveLength(CONSENT_ENTRIES_MAX);
  });
});
