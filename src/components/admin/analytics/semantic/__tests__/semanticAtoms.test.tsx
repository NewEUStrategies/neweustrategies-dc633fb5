// Atomy warstwy semantycznej: `VerdictBadge` i `StreamChip` - pierwszy test obu.
//
// PO CO. Reguły uzgadniania (`reconcile.ts`, `streams.ts`, `metrics.ts`) mają
// pokrycie z progami i policzą werdykt poprawnie. Te dwa atomy są jednak JEDYNYM
// miejscem, w którym policzony werdykt zamienia się w napis dla człowieka - a
// werdykt policzony poprawnie i WYŚWIETLONY BŁĘDNIE jest dla czytelnika raportu
// nieodróżnialny od werdyktu błędnego. Klasy defektów, które ten plik łapie:
//
//   1. ZLANIE STANÓW. `VERDICT_CLASS` to rekord po siedmiu werdyktach, a napis
//      leci przez klucz składany dynamicznie (`verdict.${verdict}`). Literówka w
//      kluczu, brak wpisu w słowniku albo skopiowany wiersz rekordu dają badge,
//      który dla „Rozbieżności" i „Zgodności" pokazuje TO SAMO - i nic w kodzie
//      tego nie zauważy. Dlatego asercja idzie na ROZŁĄCZNOŚĆ siedmiu napisów,
//      nie na jeden wybrany werdykt.
//   2. STAN WYMAGAJĄCY REAKCJI POMALOWANY JAK STAN SPOKOJNY. `divergent` i
//      `order_inverted` to sygnał złej konfiguracji; jeśli dostaną paletę
//      neutralną, admin przewinie panel dalej.
//   3. BRAMKA ZGODY. `streams.ts` deklaruje ją per strumień, bo dwa strumienie
//      za różnymi bramkami mierzą RÓŻNE POPULACJE. Chip jest jedynym miejscem,
//      w którym ta własność dojeżdża do czytelnika; cztery bramki muszą dać
//      cztery różne napisy, inaczej „marketing" czyta się jak „analityka".
//   4. GAŁĘZIE PROGOWE CHIPA. `latencyHours === 0` (czas rzeczywisty) vs 24 h
//      GA4 oraz `dedupeWindowMinutes` wstrzykiwane do liczebnika - obie ścieżki
//      są w kodzie, żadna nie była renderowana.
//   5. IZOLACJA WARSZTATÓW. Oba atomy czytają WYŁĄCZNIE rejestr w kodzie i
//      propsy - żadnego odczytu tenantowego, żadnej pamięci między renderami.
//      Test dowodzi, że dwa kolejne rendery nie przenoszą treści.
//
// Napisy sprawdzamy PRAWDZIWYM tłumaczem (`realT`) w PL i EN - atrapa `t`
// zwracająca klucz przepuściłaby brak tłumaczenia, czyli dokładnie ten defekt,
// który psuje raport zarządczy dla anglojęzycznego czytelnika.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import {
  STREAMS,
  streamById,
  type ReconciliationVerdict,
  type StreamId,
} from "@/lib/analytics/semantic";
import "@/lib/i18n-admin-semantic";
import { StreamChip } from "../atoms/StreamChip";
import { VerdictBadge } from "../atoms/VerdictBadge";

/** Wszystkie werdykty rejestru - lista wzięta z typu, nie z pamięci autora testu. */
const VERDICTS: readonly ReconciliationVerdict[] = [
  "aligned",
  "expected_drift",
  "single_source",
  "incomparable",
  "divergent",
  "order_inverted",
  "unavailable",
];

/** Werdykty, po których admin MA coś zrobić - reszta jest informacyjna. */
const ACTIONABLE: readonly ReconciliationVerdict[] = ["divergent", "order_inverted"];

/** Treść WIDOCZNEGO dymka (Radix montuje go w portalu poza kontenerem testu). */
function tooltipText(): string {
  return Array.from(document.querySelectorAll("[data-radix-popper-content-wrapper]"))
    .map((el) => el.textContent ?? "")
    .join("\n");
}

/** Jedyny element atomu - jednocześnie wyzwalacz dymka. */
function root(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error("test: atom nic nie wyrenderował");
  return el;
}

/** Otwiera dymek fokusem i oddaje jego treść. */
function openTooltip(container: HTMLElement): string {
  fireEvent.focus(root(container));
  return tooltipText();
}

function renderVerdict(verdict: ReconciliationVerdict) {
  const { container, unmount } = render(<VerdictBadge verdict={verdict} />);
  return { badge: root(container), container, unmount };
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("VerdictBadge - rozłączność siedmiu werdyktów", () => {
  it("każdy z siedmiu werdyktów ma WŁASNY napis ze słownika (żadne dwa się nie zlewają)", () => {
    const t = realT("pl");
    const labels = VERDICTS.map((v) => {
      const { badge, unmount } = renderVerdict(v);
      const text = badge.textContent ?? "";
      unmount();
      return text;
    });

    // Rozłączność jest tu całą treścią dowodu: badge, który dla „Zgodne" i
    // „Rozbieżność" pokazuje ten sam napis, jest gorszy niż brak badge'a.
    expect(new Set(labels).size).toBe(VERDICTS.length);
    expect(labels).toEqual(VERDICTS.map((v) => t(`adminAnalytics.semantic.verdict.${v}`)));
    // Żaden napis nie może być surowym kodem werdyktu ani kluczem i18n.
    for (const label of labels) {
      expect(label).not.toContain("adminAnalytics.");
      expect(VERDICTS as readonly string[]).not.toContain(label);
    }
  });

  it("napis werdyktu jest dostępną treścią badge'a, nie tylko kolorem", async () => {
    const t = realT("pl");
    const { container } = render(<VerdictBadge verdict="divergent" />);

    // Werdykt musi być czytelny dla czytnika ekranu i dla druku czarno-białego.
    expect(screen.getByText(t("adminAnalytics.semantic.verdict.divergent"))).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("werdykty wymagające reakcji dostają paletę inną niż stany spokojne", () => {
    const classOf = (v: ReconciliationVerdict): string => {
      const { badge, unmount } = renderVerdict(v);
      const cls = badge.className;
      unmount();
      return cls;
    };

    const alertClasses = ACTIONABLE.map(classOf);
    const calmClasses = VERDICTS.filter((v) => !ACTIONABLE.includes(v)).map(classOf);

    // „Rozbieżność" i „Relacja odwrócona" to dwa różne stopnie pilności -
    // nie wolno im wyglądać identycznie ani wyglądać jak zgodność.
    expect(new Set(alertClasses).size).toBe(ACTIONABLE.length);
    for (const alert of alertClasses) {
      for (const calm of calmClasses) expect(alert).not.toBe(calm);
    }
    // Zgodność, dryf oczekiwany i brak wartości też są rozróżnialne wzrokowo.
    expect(classOf("aligned")).not.toBe(classOf("expected_drift"));
    expect(classOf("unavailable")).not.toBe(classOf("single_source"));
  });

  it("podpowiedź werdyktu tłumaczy KAŻDY z siedmiu stanów innym zdaniem", () => {
    const t = realT("pl");
    const hints = VERDICTS.map((v) => {
      const { container, unmount } = renderVerdict(v);
      const text = openTooltip(container);
      unmount();
      return text;
    });

    expect(new Set(hints).size).toBe(VERDICTS.length);
    VERDICTS.forEach((v, idx) => {
      expect(hints[idx]).toContain(t(`adminAnalytics.semantic.verdictHint.${v}`));
    });
  });

  it("„nieporównywalne” i „rozbieżność” to DWA różne komunikaty, nie jeden", () => {
    const t = realT("pl");
    const incomparable = renderVerdict("incomparable");
    const incomparableText = incomparable.badge.textContent;
    incomparable.unmount();
    const divergent = renderVerdict("divergent");

    // Para nieporównywalna (inne bramki zgody) NIE jest rozjazdem - liczby są
    // poprawne, tylko mierzą różne populacje. Zlanie tych dwóch komunikatów
    // wysyła admina na polowanie na błąd konfiguracji, którego nie ma.
    expect(incomparableText).toBe(t("adminAnalytics.semantic.verdict.incomparable"));
    expect(divergent.badge.textContent).toBe(t("adminAnalytics.semantic.verdict.divergent"));
    expect(incomparableText).not.toBe(divergent.badge.textContent);
  });

  it("po przełączeniu na EN napisy są angielskie, bez polskiej awaryjnej treści", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");

    for (const v of VERDICTS) {
      const { badge, container, unmount } = renderVerdict(v);
      expect(badge.textContent).toBe(en(`adminAnalytics.semantic.verdict.${v}`));
      expect(openTooltip(container)).toContain(en(`adminAnalytics.semantic.verdictHint.${v}`));
      expect(badge.textContent).not.toBe(pl(`adminAnalytics.semantic.verdict.${v}`));
      unmount();
    }
  });
});

describe("StreamChip - nazwa strumienia i jego własności", () => {
  it("nazwa chipa pochodzi z rejestru i jest inna dla każdego z sześciu strumieni", () => {
    const labels = STREAMS.map((s) => {
      const { container, unmount } = render(<StreamChip streamId={s.id} />);
      const text = root(container).textContent ?? "";
      unmount();
      return text;
    });

    expect(labels).toEqual(STREAMS.map((s) => s.labelPl));
    expect(new Set(labels).size).toBe(STREAMS.length);
  });

  it("w EN chip bierze `labelEn`, a nie polską nazwę rejestru", async () => {
    await i18n.changeLanguage("en");

    const { container } = render(<StreamChip streamId="content_views" />);

    expect(root(container).textContent).toBe(streamById("content_views").labelEn);
    expect(root(container).textContent).not.toBe(streamById("content_views").labelPl);
  });

  it("strumień autorytatywny jest wyróżniony wzrokowo i nazwany w dymku", () => {
    const t = realT("pl");
    const auth = render(<StreamChip streamId="ga4" role="authoritative" />);
    const authClass = root(auth.container).className;
    const authTooltip = openTooltip(auth.container);
    auth.unmount();

    const corr = render(<StreamChip streamId="ga4" role="corroborating" />);

    // Raport zarządczy cytuje WYŁĄCZNIE strumień autorytatywny - chip musi
    // mówić wprost, który to jest, zamiast pozostawiać to domysłowi.
    expect(authClass).not.toBe(root(corr.container).className);
    expect(authTooltip).toContain(t("adminAnalytics.semantic.authoritative"));
    expect(openTooltip(corr.container)).toContain(t("adminAnalytics.semantic.corroborating"));
  });

  it("bez roli chip nie twierdzi ani autorytatywności, ani potwierdzania", () => {
    const t = realT("pl");
    const { container } = render(<StreamChip streamId="ga4" />);

    const text = openTooltip(container);
    expect(text).not.toContain(t("adminAnalytics.semantic.authoritative"));
    expect(text).not.toContain(t("adminAnalytics.semantic.corroborating"));
  });

  it("bramka zgody każdego strumienia jest nazwana, a cztery bramki mają cztery napisy", () => {
    const t = realT("pl");
    const gates = new Set(STREAMS.map((s) => s.consentGate));
    const gateLabels = [...gates].map((g) => t(`adminAnalytics.semantic.consentGate.${g}`));

    // Cztery bramki = cztery napisy. Gdyby dwie się zlały, „marketing"
    // czytałoby się jak „analityka", a to inne populacje odwiedzających.
    expect(new Set(gateLabels).size).toBe(gates.size);

    for (const stream of STREAMS) {
      const { container, unmount } = render(<StreamChip streamId={stream.id} />);
      const text = openTooltip(container);
      expect(text).toContain(t("adminAnalytics.semantic.streams.consentGate"));
      expect(text).toContain(t(`adminAnalytics.semantic.consentGate.${stream.consentGate}`));
      unmount();
    }
  });

  it("strumień reklamowy (marketing) nie czyta się jak strumień analityczny", () => {
    const t = realT("pl");
    const ads = render(<StreamChip streamId="ad_events" />);
    const adsTooltip = openTooltip(ads.container);
    ads.unmount();
    const firstParty = render(<StreamChip streamId="first_party" />);
    const fpTooltip = openTooltip(firstParty.container);

    expect(adsTooltip).toContain(t("adminAnalytics.semantic.consentGate.marketing"));
    expect(adsTooltip).not.toContain(t("adminAnalytics.semantic.consentGate.analytics"));
    expect(fpTooltip).toContain(t("adminAnalytics.semantic.consentGate.analytics"));
  });

  it("ziarno tożsamości rozróżnia sesję GA4 od sesji per karta", () => {
    const t = realT("pl");
    const ga4 = render(<StreamChip streamId="ga4" />);
    const ga4Tooltip = openTooltip(ga4.container);
    ga4.unmount();
    const fp = render(<StreamChip streamId="first_party" />);

    // To jest cały powód, dla którego „sesje" z dwóch strumieni nie są tą samą
    // liczbą - chip musi tę różnicę pokazać, a nie schować.
    expect(ga4Tooltip).toContain(t("adminAnalytics.semantic.identityGrain.ga4_session"));
    expect(openTooltip(fp.container)).toContain(
      t("adminAnalytics.semantic.identityGrain.tab_session"),
    );
    expect(t("adminAnalytics.semantic.identityGrain.ga4_session")).not.toBe(
      t("adminAnalytics.semantic.identityGrain.tab_session"),
    );
  });

  it("okno deduplikacji wchodzi do napisu liczbą z rejestru, nie zerem", () => {
    const t = realT("pl");
    const stream = streamById("content_views");
    const { container } = render(<StreamChip streamId="content_views" />);

    // `dedupeWindowMinutes` z rejestru to 5; gałąź `?? 0` nie może wygrać,
    // bo „okno 0 min" znaczy „brak deduplikacji", czyli inną metrykę.
    expect(stream.dedupeWindowMinutes).toBe(5);
    const text = openTooltip(container);
    expect(text).toContain(
      t("adminAnalytics.semantic.dedupe.window", { minutes: stream.dedupeWindowMinutes ?? 0 }),
    );
    expect(text).not.toContain(t("adminAnalytics.semantic.dedupe.window", { minutes: 0 }));
  });

  it("strumień bez okna deduplikacji pokazuje tryb `brak`, nie okno zerowe", () => {
    const t = realT("pl");
    const { container } = render(<StreamChip streamId="first_party" />);

    expect(streamById("first_party").dedupe).toBe("none");
    expect(openTooltip(container)).toContain(t("adminAnalytics.semantic.dedupe.none"));
  });

  it("opóźnienie zero czyta się jako czas rzeczywisty, a GA4 jako godziny", () => {
    const t = realT("pl");
    const fp = render(<StreamChip streamId="first_party" />);
    const fpTooltip = openTooltip(fp.container);
    fp.unmount();
    const ga4 = render(<StreamChip streamId="ga4" />);
    const ga4Tooltip = openTooltip(ga4.container);

    // Obie gałęzie `latencyHours === 0` istnieją w kodzie i znaczą co innego:
    // „0" wyświetlone jako „do 0 godz." brzmi jak awaria, nie jak beacon.
    expect(streamById("first_party").latencyHours).toBe(0);
    expect(fpTooltip).toContain(t("adminAnalytics.semantic.streams.latencyRealtime"));
    expect(fpTooltip).not.toContain(
      t("adminAnalytics.semantic.streams.latencyHours", { count: 0 }),
    );
    expect(ga4Tooltip).toContain(
      t("adminAnalytics.semantic.streams.latencyHours", {
        count: streamById("ga4").latencyHours,
      }),
    );
  });

  it("chip nie ma naruszeń axe i niesie nazwę jako tekst, nie jako kolor", async () => {
    const { container } = render(<StreamChip streamId="newsletter" role="authoritative" />);

    expect(summarize(await axeViolations(container))).toBe("");
    expect(root(container).textContent?.trim()).toBe(streamById("newsletter").labelPl);
  });

  it.fails(
    "DEFEKT: własności strumienia z dymka są NIEDOSTĘPNE z klawiatury - wyzwalacz nie jest fokusowalny",
    () => {
      // `Badge` renderuje `div`, a `TooltipTrigger asChild` tylko go klonuje -
      // nie dokłada `tabindex`. Bramka zgody, ziarno tożsamości, tryb
      // deduplikacji i opóźnienie NIE ISTNIEJĄ nigdzie indziej w drzewie, więc
      // osoba pracująca klawiaturą albo czytnikiem ekranu nie ma jak
      // dowiedzieć się, dlaczego dwie liczby o tej samej nazwie są różne.
      // Naprawa: `Badge asChild` na `button type="button"` albo `tabIndex={0}`
      // z `role="button"` na wyzwalaczu.
      const { container } = render(<StreamChip streamId="ga4" role="authoritative" />);
      const trigger = root(container);

      expect(trigger.matches("button, a[href], input, select, textarea, [tabindex]")).toBe(true);
    },
  );
});

describe("Atomy semantyczne - izolacja warsztatów", () => {
  it("chip i badge czytają wyłącznie rejestr i propsy - dwa rendery nic nie przenoszą", () => {
    const t = realT("pl");
    // Warsztat A patrzy na newsletter z werdyktem rozbieżnym...
    const a = render(
      <div>
        <StreamChip streamId="newsletter" role="authoritative" />
        <VerdictBadge verdict="divergent" />
      </div>,
    );
    expect(a.container.textContent).toContain(streamById("newsletter").labelPl);
    a.unmount();

    // ...warsztat B na reklamy z werdyktem jednego źródła.
    const b = render(
      <div>
        <StreamChip streamId="ad_events" role="authoritative" />
        <VerdictBadge verdict="single_source" />
      </div>,
    );

    expect(b.container.textContent).toContain(streamById("ad_events").labelPl);
    expect(b.container.textContent).not.toContain(streamById("newsletter").labelPl);
    expect(b.container.textContent).not.toContain(t("adminAnalytics.semantic.verdict.divergent"));
  });

  it("atomy nie przyjmują ani identyfikatora warsztatu, ani hosta - nie mają czym wyciec", () => {
    const streamId: StreamId = "web_vitals";
    const { container } = render(<StreamChip streamId={streamId} />);

    // Kontrakt typu: jedyne wejścia to `streamId` i `role`. Gdyby chip
    // przyjmował `tenantId` albo nagłówek hosta, dane cudzego warsztatu
    // dałoby się wstrzyknąć z poziomu wywołania.
    expect(root(container).textContent).toBe(streamById(streamId).labelPl);
    expect(container.innerHTML).not.toContain("tenant");
    expect(container.innerHTML).not.toContain("example.com");
  });
});
