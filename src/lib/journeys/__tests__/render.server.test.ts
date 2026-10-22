// Render maila ścieżki (S5) i zmienne. Dwie rzeczy, których pomyłka jest
// cicha: (1) dane kontaktu w HTML muszą być escapowane, a w adresach w ogóle
// niedozwolone (wyciek PII, otwarte przekierowanie); (2) każdy link musi
// przejść przez PODPISANE przekierowanie (`m`, `i`, `u`, `k`), a wypis - nie
// (RFC 8058). Podpisy liczymy prawdziwym HMAC, tak jak trasa `nl-click`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  verifyJourneyLink,
  verifyJourneyMessageToken,
} from "@/lib/newsletter/trackingToken.server";
import {
  OWN_UNSUBSCRIBE_END,
  OWN_UNSUBSCRIBE_START,
  stripOwnUnsubscribe,
} from "@/lib/email/ownUnsubscribeFooter";
import {
  JourneyRenderError,
  htmlToText,
  journeyClickUrl,
  journeyPixelUrl,
  journeyUnsubscribeUrl,
  renderJourneyEmail,
  substituteDocVariables,
} from "../render.server";
import { button, emailDoc, footnote, heading, paragraph } from "../templates/doc";
import {
  JOURNEY_VARIABLE_KEYS,
  JOURNEY_VARIABLE_SAMPLES,
  escapeHtml,
  substituteJourneyVariables,
  unknownJourneyVariables,
} from "../variables";

const ORIGIN = "https://nes.example.test";
const MESSAGE = "adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9";
const previous = process.env.SESSION_SECRET;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-journeys";
});
afterAll(() => {
  if (previous === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previous;
});

const doc = () =>
  emailDoc(
    heading("h1", "Witaj, {{first_name}}", "Hello, {{first_name}}"),
    paragraph("p1", "Plan: <b>{{plan_name}}</b> {{nieznana}}", "Plan: <b>{{plan_name}}</b>"),
    button("b1", "Cennik", "Pricing", "{{pricing_url}}?utm=journey&x=1"),
    footnote("f1", "Stopka {{site_name}}", "Footer {{site_name}}"),
  );

describe("zmienne", () => {
  it("html escapuje, tekst zostawia surowy, adres dopuszcza wyłącznie zmienne serwisu", () => {
    const values = { first_name: '<img src=x onerror="1">', site_url: "https://a.test" };
    expect(substituteJourneyVariables("Cześć {{ first_name }}", values, "html")).toBe(
      "Cześć &lt;img src=x onerror=&quot;1&quot;&gt;",
    );
    expect(substituteJourneyVariables("{{first_name}}", values, "text")).toBe(
      '<img src=x onerror="1">',
    );
    expect(substituteJourneyVariables("{{site_url}}/{{first_name}}", values, "url")).toBe(
      "https://a.test/",
    );
    expect(substituteJourneyVariables("{{plan_name}}|{{nieznana}}", {}, "text")).toBe("|");
  });

  it("nieznane znaczniki do walidacji edytora, słownik i próbki PL/EN", () => {
    expect(unknownJourneyVariables("{{first_name}} {{x}} {{x}} {{ y }}")).toEqual(["x", "y"]);
    expect(JOURNEY_VARIABLE_KEYS).toContain("trial_ends_at");
    expect(Object.keys(JOURNEY_VARIABLE_SAMPLES.pl).sort()).toEqual(
      Object.keys(JOURNEY_VARIABLE_SAMPLES.en).sort(),
    );
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("dokument: zmienne pole po polu wg rodzaju pola", () => {
    const out = substituteDocVariables(
      emailDoc(
        ...doc().blocks,
        {
          id: "i1",
          type: "image",
          url: "{{site_url}}/logo.png",
          href: null,
          alt: "{{site_name}}",
        },
        {
          id: "q1",
          type: "quote",
          text: { pl: "{{first_name}}", en: "{{first_name}}" },
          attribution: { pl: "{{site_name}}", en: "{{site_name}}" },
        },
        {
          id: "pl1",
          type: "post-list",
          heading: { pl: "Dla {{first_name}}", en: "For {{first_name}}" },
          source: "latest",
          count: 3,
          postIds: [],
        } as never,
        { id: "d1", type: "divider" } as never,
      ),
      { first_name: "A&B", site_name: "NES", site_url: ORIGIN, plan_name: "Pro" },
    );
    const [h, p, b, f, img, q, list, divider] = out.blocks as never[] as Record<string, never>[];
    expect(h.text).toEqual({ pl: "Witaj, A&B", en: "Hello, A&B" });
    expect(p.html).toEqual({ pl: "Plan: <b>Pro</b> ", en: "Plan: <b>Pro</b>" });
    expect(b.url).toBe("?utm=journey&x=1");
    expect(f.html).toEqual({ pl: "Stopka NES", en: "Footer NES" });
    expect(img.url).toBe(`${ORIGIN}/logo.png`);
    expect(img.href).toBeNull();
    expect(img.alt).toBe("NES");
    expect(q.text).toEqual({ pl: "A&B", en: "A&B" });
    expect(q.attribution).toEqual({ pl: "NES", en: "NES" });
    expect(list.heading).toEqual({ pl: "Dla A&B", en: "For A&B" });
    expect(divider).toEqual({ id: "d1", type: "divider" });
  });
});

describe("adresy trackingu", () => {
  it("kliknięcie niesie token wiadomości, numer, cel i podpis wiążący cel z numerem", () => {
    const url = new URL(journeyClickUrl(ORIGIN, MESSAGE, "https://cel.test/a?b=1", 3));
    expect(url.pathname).toBe("/api/public/nl-click");
    expect(verifyJourneyMessageToken(url.searchParams.get("m"))).toBe(MESSAGE);
    expect(url.searchParams.get("i")).toBe("3");
    expect(url.searchParams.get("u")).toBe("https://cel.test/a?b=1");
    const sig = url.searchParams.get("k");
    expect(verifyJourneyLink(MESSAGE, "https://cel.test/a?b=1", sig, 3)).toBe(true);
    expect(verifyJourneyLink(MESSAGE, "https://cel.test/a?b=1", sig, 4)).toBe(false);
  });

  it("piksel i wypis na publicznych trasach", () => {
    expect(journeyPixelUrl(ORIGIN, MESSAGE)).toMatch(
      /^https:\/\/nes\.example\.test\/api\/public\/nl-open\?m=/,
    );
    const unsub = new URL(journeyUnsubscribeUrl(ORIGIN, MESSAGE));
    expect(unsub.searchParams.get("token")).toMatch(/^j[0-9a-f]{64}$/);
  });
});

describe("render", () => {
  const base = {
    doc: doc(),
    subject: "Witaj {{first_name}}",
    preheader: "Na start: {{plan_name}}",
    locale: "pl" as const,
    vars: {
      first_name: "Anna",
      plan_name: "Pro",
      site_name: "NES",
      pricing_url: `${ORIGIN}/pricing`,
    },
    origin: ORIGIN,
  };

  it("marketing ze zgodą na pomiar: linki przez podpisane przekierowanie, piksel, stopka wypisu poza trackingiem", () => {
    const unsubscribeUrl = journeyUnsubscribeUrl(ORIGIN, MESSAGE);
    const out = renderJourneyEmail({
      ...base,
      messageId: MESSAGE,
      unsubscribeUrl,
      openTracking: true,
      linkTracking: true,
    });
    expect(out.subject).toBe("Witaj Anna");
    expect(out.trackedLinks).toBe(1);
    const href = /href="([^"]*nl-click[^"]*)"/.exec(out.html)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBeTruthy();
    const click = new URL(href as string);
    expect(click.searchParams.get("u")).toBe(`${ORIGIN}/pricing?utm=journey&x=1`);
    expect(
      verifyJourneyLink(
        MESSAGE,
        click.searchParams.get("u") as string,
        click.searchParams.get("k"),
        0,
      ),
    ).toBe(true);
    expect(out.html).toContain("nl-open?m=");
    expect(out.html).toContain("Na start: Pro");
    expect(out.html).toContain("Wypisz się jednym kliknięciem");
    // Wypis RFC 8058 NIE przechodzi przez przekierowanie trackingu.
    expect(out.html).toContain(unsubscribeUrl.replace(/&/g, "&amp;"));
    expect(out.html).not.toContain(`u=${encodeURIComponent(unsubscribeUrl)}`);
    expect(out.text).toContain("Witaj, Anna");
    expect(out.text).toContain(`Wypisz się jednym kliknięciem: ${unsubscribeUrl}`);
  });

  it("stopka wypisu w znacznikach (Z-S5-05): dokładnie jeden blok w HTML i w tekście, poza nim treść", () => {
    const unsubscribeUrl = journeyUnsubscribeUrl(ORIGIN, MESSAGE);
    const out = renderJourneyEmail({ ...base, messageId: MESSAGE, unsubscribeUrl });
    for (const content of [out.html, out.text]) {
      expect(content.split(OWN_UNSUBSCRIBE_START)).toHaveLength(2);
      expect(content.split(OWN_UNSUBSCRIBE_END)).toHaveLength(2);
      const block = content.slice(
        content.indexOf(OWN_UNSUBSCRIBE_START),
        content.indexOf(OWN_UNSUBSCRIBE_END),
      );
      expect(block).toContain("Wypisz się jednym kliknięciem");
      // Wycięcie bloku (droga platformy) zostawia treść maila, a zabiera
      // WYŁĄCZNIE stopkę wypisu - druga stopka przychodzi od platformy.
      const stripped = stripOwnUnsubscribe(content);
      expect(stripped).not.toContain("Wypisz się jednym kliknięciem");
      expect(stripped).toContain("Witaj");
    }
  });

  it("komunikacja usługowa (bez adresu wypisu): bez znaczników stopki", () => {
    const out = renderJourneyEmail({ ...base, messageId: MESSAGE, unsubscribeUrl: null });
    expect(out.html).not.toContain("nes:unsub");
    expect(out.text).not.toContain("nes:unsub");
  });

  it("bez zgody na pomiar (albo przełącznik wyłączony): bez piksela, linki wprost, wypis zostaje (I9d-Y2)", () => {
    const unsubscribeUrl = journeyUnsubscribeUrl(ORIGIN, MESSAGE);
    for (const flags of [
      { openTracking: false, linkTracking: false },
      // Brak pól = bez pomiaru (dotąd brak `openTracking` znaczył piksel).
      {},
    ]) {
      const out = renderJourneyEmail({ ...base, messageId: MESSAGE, unsubscribeUrl, ...flags });
      expect(out.html).not.toContain("nl-open");
      expect(out.html).not.toContain("nl-click");
      expect(out.trackedLinks).toBe(0);
      expect(out.html).toContain(`href="${ORIGIN}/pricing?utm=journey&amp;x=1"`);
      // Wypis RFC 8058 nie jest pomiarem - zostaje.
      expect(out.html).toContain("Wypisz się jednym kliknięciem");
      expect(out.html).toContain(unsubscribeUrl.replace(/&/g, "&amp;"));
    }
  });

  it("piksel i linki sterowane osobno, każde tylko jawnym `true`", () => {
    const onlyLinks = renderJourneyEmail({
      ...base,
      messageId: MESSAGE,
      unsubscribeUrl: null,
      linkTracking: true,
    });
    expect(onlyLinks.html).toContain("nl-click?m=");
    expect(onlyLinks.html).not.toContain("nl-open");
    const onlyPixel = renderJourneyEmail({
      ...base,
      messageId: MESSAGE,
      unsubscribeUrl: null,
      openTracking: true,
    });
    expect(onlyPixel.html).toContain("nl-open?m=");
    expect(onlyPixel.html).not.toContain("nl-click");
  });

  it('stopka „Nie mierz moich otwarć i kliknięć" poza przekierowaniem trackingu, PL i EN, HTML i tekst', () => {
    const optOut = `${ORIGIN}/api/public/newsletter/measurement?token=wlabc&lang=pl`;
    const pl = renderJourneyEmail({
      ...base,
      messageId: MESSAGE,
      unsubscribeUrl: journeyUnsubscribeUrl(ORIGIN, MESSAGE),
      openTracking: true,
      linkTracking: true,
      measurementOptOutUrl: optOut,
    });
    expect(pl.html).toContain(
      "Nasze wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia.",
    );
    expect(pl.html).toContain(`href="${optOut.replace(/&/g, "&amp;")}"`);
    expect(pl.html).toContain("Nie mierz moich otwarć i kliknięć</a>");
    // Link wycofania nie idzie przez `nl-click` (jeden link przepisany - przycisk treści).
    expect(pl.trackedLinks).toBe(1);
    expect(pl.html).not.toContain(`u=${encodeURIComponent(optOut)}`);
    expect(pl.text).toContain(`Nie mierz moich otwarć i kliknięć: ${optOut}`);
    const en = renderJourneyEmail({
      ...base,
      locale: "en",
      messageId: null,
      unsubscribeUrl: null,
      measurementOptOutUrl: optOut,
    });
    expect(en.html).toContain("Don&#39;t measure my opens and clicks</a>");
    expect(en.text).toContain(`Don't measure my opens and clicks: ${optOut}`);
    // Brak adresu = brak linii (podgląd edytora, usługa bez pomiaru).
    const none = renderJourneyEmail({ ...base, messageId: null, unsubscribeUrl: null });
    expect(none.html).not.toContain("newsletter/measurement");
    expect(none.html).not.toContain("mierzące");
  });

  it("usługa / podgląd: bez stopki wypisu, bez trackingu i piksela; EN", () => {
    const out = renderJourneyEmail({
      ...base,
      locale: "en",
      preheader: null,
      messageId: null,
      unsubscribeUrl: null,
    });
    expect(out.trackedLinks).toBe(0);
    expect(out.html).not.toContain("nl-click");
    expect(out.html).not.toContain("nl-open");
    expect(out.html).not.toContain("Unsubscribe");
    expect(out.html).toContain(`href="${ORIGIN}/pricing?utm=journey&amp;x=1"`);
    expect(out.text).toContain("Hello, Anna");
    expect(out.text).not.toContain("Unsubscribe");
  });

  it("błędy: zły dokument, pusty temat, dokument bez treści", () => {
    const fail = (input: Partial<Parameters<typeof renderJourneyEmail>[0]>) => {
      try {
        renderJourneyEmail({ ...base, messageId: null, unsubscribeUrl: null, ...input });
        return null;
      } catch (err) {
        expect(err).toBeInstanceOf(JourneyRenderError);
        return (err as JourneyRenderError).code;
      }
    };
    expect(fail({ doc: { version: 2 } })).toBe("doc_invalid");
    expect(fail({ subject: "  {{nieznana}} " })).toBe("subject_empty");
    expect(fail({ doc: emailDoc() })).toBe("doc_empty");
  });
});

describe("wersja tekstowa", () => {
  it("akapity, linki z adresem, encje", () => {
    expect(
      htmlToText(
        '<p>A &amp; B</p><p>Link: <a href="https://x.test/a">tu</a>&nbsp;&quot;c&#39;&lt;&gt;</p>',
      ),
    ).toBe(`A & B\n Link: tu (https://x.test/a) "c'<>`);
  });
});
