// Molekuły warstwy semantycznej: definicja metryki, wiersz uzgodnienia,
// siatka dostępności strumieni i pochodzenie okna. Pierwszy test wszystkich czterech.
//
// PO CO. Te cztery komponenty odpowiadają na cztery pytania, bez których żadna
// liczba w raporcie zarządczym nie ma sensu: CO ta liczba znaczy, CZY inne
// strumienie ją potwierdzają, CZEGO w niej NIE MA i Z JAKIEGO OKNA pochodzi.
// Reguły stojące za odpowiedziami są policzone i pokryte w `src/lib/analytics/
// semantic/**`; tutaj przedmiotem dowodu jest wyłącznie to, czy odpowiedź
// DOJEŻDŻA do człowieka. Klasy defektów, które ten plik łapie:
//
//   1. BRAK WARTOŚCI POKAZANY JAKO ZERO. `formatMetricValue(null)` ma oddać
//      napis „brak danych”, bo „0 %” w raporcie czyta się jako „nikt nie
//      kliknął”, a nie jako „nie ma podstawy do wyliczenia”. To dwie różne
//      informacje i tylko jedna z nich jest prawdziwa.
//   2. JEDNOSTKA ZGUBIONA W PREZENTACJI. Wskaźnik, milisekundy, wynik CLS i
//      liczba mają CZTERY różne formaty sterowane słownikiem metryk. CLS
//      pokazany z sufiksem „ms” (był taki dashboard) to liczba, której nie da
//      się obronić.
//   3. TRZY POWODY ZERA ZLANE W JEDEN. Brak konfiguracji, nieudany odczyt i
//      pusty zbiór prowadzą do TRZECH różnych decyzji, a wcześniej wyglądały
//      identycznie. Siatka musi je rozróżniać napisem, nie tylko ikoną -
//      ikony lucide są `aria-hidden`, więc dla czytnika ekranu nie istnieją.
//   4. OKNO BEZ POCHODZENIA. Admin porównujący naszą zakładkę z interfejsem
//      Google widzi inne liczby, bo Google domyślnie dolicza dzień bieżący.
//      Karta okna musi pokazać DOKŁADNY zakres wysłany do GA4 i zastrzeżenia,
//      inaczej różnicy nie da się wyjaśnić.
//   5. PARA NIEPORÓWNYWALNA OPISANA JAKO ROZJAZD. Werdykt `incomparable`
//      znaczy „liczby są poprawne, ale mierzą różne populacje albo okno nie
//      pozwala na uczciwe porównanie”. Podpisanie tego jako rozbieżności
//      wysyła admina na polowanie na błąd, którego nie ma.
//   6. IZOLACJA WARSZTATÓW. Wszystkie cztery molekuły są czysto prezentacyjne:
//      dane wchodzą propsem, rejestr jest wspólny dla wszystkich warsztatów.
//      Test dowodzi, że dwa kolejne rendery nie przenoszą ani liczby, ani
//      nazwy między warsztatami.
//
// Napisy sprawdzamy PRAWDZIWYM tłumaczem (`realT`) w PL i EN.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import {
  METRICS,
  STREAMS,
  metricById,
  reconcileMetric,
  resolveWindow,
  streamById,
  type CanonicalWindow,
  type MetricId,
  type ReconciliationEntry,
  type StreamObservation,
  type WindowNote,
} from "@/lib/analytics/semantic";
import type { SemanticStreamHealth } from "@/lib/analytics/semantic/snapshot.functions";
import "@/lib/i18n-admin-semantic";
import { MetricDefinitionPopover } from "../molecules/MetricDefinitionPopover";
import { ReconciliationRow } from "../molecules/ReconciliationRow";
import { StreamHealthGrid } from "../molecules/StreamHealthGrid";
import { WindowProvenance } from "../molecules/WindowProvenance";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-07-15T14:37:00.000Z");
/** Okno dobowe bez dnia otwartego - na takim wolno uzgadniać liczby. */
const SAFE = resolveWindow({ presetId: "28d", nowMs: NOW });
/** To samo okno Z dniem otwartym - GA4 nie domknęło doby, uzgadnianie wstrzymane. */
const OPEN = resolveWindow({ presetId: "28d", nowMs: NOW, includeOpenDay: true });
/** Okno kroczące - ziarno, którego GA4 nie ma. */
const INSTANT = resolveWindow({ presetId: "24h", nowMs: NOW });

function obs(streamId: StreamObservation["streamId"], value: number | null): StreamObservation {
  return { streamId, value };
}

/** Uzgodnienie policzone PRAWDZIWYMI regułami - werdykt nie jest tu wpisany ręcznie. */
function real(
  metricId: MetricId,
  observations: readonly StreamObservation[],
  window: CanonicalWindow = SAFE,
): ReconciliationEntry {
  return reconcileMetric(metricId, observations, { window });
}

/**
 * Wpis SKŁADANY RĘCZNIE - wyłącznie dla stanów, których obecny rejestr metryk
 * nie potrafi wyprodukować (werdykt `aligned` wymaga powiązania równoważnego,
 * a każde powiązanie potwierdzające w słowniku jest dziś analogiczne; pusta
 * lista `reasons` wymaga tego samego). Typ `ReconciliationEntry` te stany
 * dopuszcza, więc komponent musi je udźwignąć.
 */
function synthetic(
  over: Partial<ReconciliationEntry> & { metricId: MetricId },
): ReconciliationEntry {
  return {
    canonicalValue: 100,
    authoritativeStream: "ga4",
    observations: [
      { streamId: "ga4", value: 100, role: "authoritative", deviation: 0, counted: true },
    ],
    spread: null,
    verdict: "aligned",
    reasons: [],
    ...over,
  };
}

function health(
  streamId: SemanticStreamHealth["streamId"],
  available: boolean,
  reason?: SemanticStreamHealth["reason"],
): SemanticStreamHealth {
  return reason ? { streamId, available, reason } : { streamId, available };
}

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

/** Treść WIDOCZNEJ warstwy Radiksa (dymek/popover jadą do portalu). */
function popperText(): string {
  return Array.from(document.querySelectorAll("[data-radix-popper-content-wrapper]"))
    .map((el) => el.textContent ?? "")
    .join("\n");
}

/**
 * Otwiera popover definicji i DOMYKA asynchroniczne pozycjonowanie Radiksa.
 * Bez `await act` floating-ui aktualizuje stan po zakończeniu ciała testu, co
 * React raportuje jako aktualizację poza `act` - ostrzeżenie zaśmieca log
 * całego przebiegu, nie tylko tego pliku.
 */
async function openDefinition(scope?: HTMLElement): Promise<void> {
  const label = realT(i18n.language?.toLowerCase().startsWith("en") ? "en" : "pl")(
    "adminAnalytics.semantic.showDefinition",
  );
  fireEvent.click((scope ? within(scope) : screen).getByRole("button", { name: label }));
  await act(async () => {});
}

/** Wiersz uzgodnienia jest elementem listy - renderujemy go w prawdziwej `ul`. */
function renderRow(entry: ReconciliationEntry, deltaPct?: number | null) {
  return render(
    <ul>
      <ReconciliationRow entry={entry} deltaPct={deltaPct} />
    </ul>,
  );
}

/** Wielka liczba wiersza - jedyna wartość, którą wolno zacytować w raporcie. */
function canonicalText(container: HTMLElement): string {
  const el = container.querySelector(".text-xl");
  if (!el) throw new Error("test: wiersz nie pokazał wartości kanonicznej");
  return el.textContent ?? "";
}

/** Klasy ikon statusu w siatce, w kolejności prezentacji rejestru. */
function statusIconClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li > div > svg")).map(
    (el) => el.getAttribute("class") ?? "",
  );
}

/** Kafelek strumienia w siatce - szukany po nazwie z rejestru. */
function streamTile(streamId: SemanticStreamHealth["streamId"]): HTMLElement {
  const label = screen.getByText(streamById(streamId).labelPl);
  const tile = label.closest("li");
  if (!tile) throw new Error(`test: brak kafelka strumienia ${streamId}`);
  return tile;
}

/** Linia statusu kafelka (napis pod nazwą strumienia). */
function statusLine(streamId: SemanticStreamHealth["streamId"]): string {
  const label = screen.getByText(streamById(streamId).labelPl);
  return label.nextElementSibling?.textContent ?? "";
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("MetricDefinitionPopover - definicja przy każdej liczbie", () => {
  it("wyzwalacz jest nazwanym przyciskiem typu `button`, nie samą ikoną", () => {
    const t = realT("pl");
    render(<MetricDefinitionPopover metricId="sessions" />);

    // Popover stoi obok liczb w formularzach i kartach panelu: przycisk bez
    // jawnego typu wysyłałby formularz, a bez nazwy nie istnieje dla czytnika.
    const trigger = screen.getByRole("button", {
      name: t("adminAnalytics.semantic.showDefinition"),
    });
    expect(trigger).toHaveAttribute("type", "button");
  });

  it("po otwarciu pokazuje JEDNO obowiązujące zdanie definicji z rejestru", async () => {
    const t = realT("pl");
    const metric = metricById("page_views");
    render(<MetricDefinitionPopover metricId="page_views" />);

    await openDefinition();

    const text = popperText();
    expect(text).toContain(metric.labelPl);
    expect(text).toContain(metric.definitionPl);
    expect(text).toContain(t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`));
  });

  it("każde powiązanie ma wzór i rolę, a rola autorytatywna jest wyróżniona", async () => {
    const t = realT("pl");
    const metric = metricById("sessions");
    render(<MetricDefinitionPopover metricId="sessions" />);
    await openDefinition();

    const text = popperText();
    // Dwa powiązania: GA4 (autorytatywne) i first-party (potwierdzające).
    expect(metric.bindings).toHaveLength(2);
    for (const binding of metric.bindings) {
      expect(text).toContain(binding.formula);
      expect(text).toContain(streamById(binding.streamId).labelPl);
    }
    expect(text).toContain(t("adminAnalytics.semantic.authoritative"));
    expect(text).toContain(t("adminAnalytics.semantic.corroborating"));

    // Wyróżnienie wzrokowe: kafelek autorytatywny ma inną obwódkę niż potwierdzający.
    const cards = Array.from(
      document.querySelectorAll("[data-radix-popper-content-wrapper] .rounded-md.border.p-2"),
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].className).not.toBe(cards[1].className);
  });

  it("lista „czego nie wolno” jest widoczna razem z definicją", async () => {
    const t = realT("pl");
    const metric = metricById("ad_impressions");
    render(<MetricDefinitionPopover metricId="ad_impressions" />);
    await openDefinition();

    const text = popperText();
    expect(metric.guards.length).toBeGreaterThan(0);
    expect(text).toContain(t("adminAnalytics.semantic.dictionary.colGuards"));
    for (const guard of metric.guards) expect(text).toContain(guard);
  });

  it("w EN definicja i etykieta jadą po angielsku, bez polskiej awaryjnej treści", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const metric = metricById("content_views");
    render(<MetricDefinitionPopover metricId="content_views" />);

    await openDefinition();

    const text = popperText();
    expect(text).toContain(metric.definitionEn);
    expect(text).not.toContain(metric.definitionPl);
    expect(text).toContain(metric.labelEn);
    expect(text).toContain(en(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`));
  });

  it("jest dostępny z klawiatury i zamyka się Escapem", async () => {
    const t = realT("pl");
    render(<MetricDefinitionPopover metricId="sessions" />);
    const trigger = screen.getByRole("button", {
      name: t("adminAnalytics.semantic.showDefinition"),
    });

    // Fokus dochodzi do przycisku, klawiatura go otwiera...
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await openDefinition();
    expect(popperText()).toContain(metricById("sessions").definitionPl);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // ...i Escape go zamyka, bez pułapki fokusa na środku panelu.
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {});
    expect(popperText()).not.toContain(metricById("sessions").definitionPl);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("dodatkowa klasa nie zjada klas bazowych wyzwalacza", () => {
    const t = realT("pl");
    render(<MetricDefinitionPopover metricId="sessions" className="ml-1" />);

    const trigger = screen.getByRole("button", {
      name: t("adminAnalytics.semantic.showDefinition"),
    });
    expect(trigger.className).toContain("ml-1");
    expect(trigger.className).toContain("focus-visible:ring-2");
  });

  it("poza nienazwanym okienkiem otwarty popover nie ma innych naruszeń axe", async () => {
    render(<MetricDefinitionPopover metricId="lcp_p75" />);
    await openDefinition();

    // Regułę `aria-dialog-name` wyłączamy TYLKO tutaj i tylko po to, żeby jeden
    // znany defekt (test niżej) nie przykrywał wszystkiego innego: kolejności
    // nagłówków, poprawności ARIA i semantyki list.
    expect(
      summarize(await axeViolations(document.body, { "aria-dialog-name": { enabled: false } })),
    ).toBe("");
  });

  it.fails("DEFEKT: treść popovera jest okienkiem `dialog` BEZ dostępnej nazwy", async () => {
    // `PopoverContent` Radiksa renderuje `role="dialog"`. Czytnik ekranu
    // ogłasza więc „okno dialogowe” i milczy o tym, CZYJEJ metryki definicja
    // się otwarła - a popover stoi przy KAŻDEJ liczbie panelu, więc bez nazwy
    // nie da się ich rozróżnić. Nazwa jest w drzewie (nagłówek `h4` z etykietą
    // metryki), brakuje wyłącznie `aria-labelledby` wiążącego ją z okienkiem.
    render(<MetricDefinitionPopover metricId="lcp_p75" />);
    await openDefinition();

    expect(summarize(await axeViolations(document.body))).toBe("");
  });

  it("każda metryka rejestru daje popover z definicją - żaden klucz nie gubi treści", async () => {
    for (const metric of METRICS) {
      const view = render(<MetricDefinitionPopover metricId={metric.id} />);
      await openDefinition(view.container);
      const text = popperText();
      expect(text).toContain(metric.definitionPl);
      expect(text).not.toContain("adminAnalytics.semantic.dictionary.unit.");
      view.unmount();
      cleanup();
    }
  });
});

describe("ReconciliationRow - jedna liczba, potem werdykt", () => {
  it("wartość kanoniczna stoi PRZED werdyktem w kolejności czytania", () => {
    const t = realT("pl");
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 1100)]);
    const { container } = renderRow(entry);

    const text = container.textContent ?? "";
    const value = canonicalText(container);
    const verdict = t(`adminAnalytics.semantic.verdict.${entry.verdict}`);
    // Odwrotna kolejność (dwie równorzędne liczby obok siebie) była właśnie tym,
    // co pozwalało czytelnikowi wybrać liczbę pasującą do narracji.
    expect(text.indexOf(value)).toBeLessThan(text.indexOf(verdict));
    expect(text).toContain(metricById("sessions").labelPl);
  });

  it("brak wartości autorytatywnej pokazuje „brak danych”, nigdy zera", () => {
    const t = realT("pl");
    const entry = real("sessions", [obs("ga4", null), obs("first_party", 500)]);
    const { container } = renderRow(entry);

    expect(entry.verdict).toBe("unavailable");
    expect(canonicalText(container)).toBe(t("adminAnalytics.semantic.noValue"));
    expect(canonicalText(container)).not.toBe("0");
  });

  it("format wartości wynika z JEDNOSTKI metryki, nie z jej nazwy", () => {
    const cases: Array<[MetricId, StreamObservation[], RegExp]> = [
      // wskaźnik: ułamek pokazany jako procent
      ["engagement_rate", [obs("ga4", 0.634)], /%$/],
      // milisekundy: sufiks jednostki
      ["lcp_p75", [obs("web_vitals", 2480)], /ms$/],
      // CLS jest bezwymiarowy: trzy miejsca po przecinku, bez sufiksu
      ["cls_p75", [obs("web_vitals", 0.081)], /^0[.,]081$/],
    ];

    for (const [metricId, observations, shape] of cases) {
      const view = renderRow(real(metricId, observations));
      expect(canonicalText(view.container)).toMatch(shape);
      view.unmount();
    }

    // Liczba: bez procentu i bez „ms”.
    const counted = renderRow(real("page_views", [obs("ga4", 12345)]));
    expect(canonicalText(counted.container)).not.toContain("%");
    expect(canonicalText(counted.container)).not.toContain("ms");
    expect(canonicalText(counted.container)).toMatch(/^12\s?345$/);
  });

  it("zmiana wobec okna poprzedniego ma znak i kierunek, a jej brak nie rysuje nic", () => {
    const t = realT("pl");
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 1100)]);

    const up = renderRow(entry, 18.4);
    const upEl = up.container.querySelector(
      `[title="${t("adminAnalytics.semantic.deltaVsPrevious")}"]`,
    );
    expect(upEl?.textContent).toContain("+");
    expect(upEl?.className).toContain("emerald");
    up.unmount();

    const down = renderRow(entry, -3.1);
    const downEl = down.container.querySelector(
      `[title="${t("adminAnalytics.semantic.deltaVsPrevious")}"]`,
    );
    expect(downEl?.textContent).toMatch(/^-/);
    expect(downEl?.className).toContain("destructive");
    down.unmount();

    // Zero to informacja („bez zmiany”), nie stan neutralny bez treści...
    const flat = renderRow(entry, 0);
    const flatEl = flat.container.querySelector(
      `[title="${t("adminAnalytics.semantic.deltaVsPrevious")}"]`,
    );
    expect(flatEl?.className).toContain("muted-foreground");
    flat.unmount();

    // ...a brak bazy porównawczej NIE MOŻE udawać zera.
    const none = renderRow(entry, null);
    expect(
      none.container.querySelector(`[title="${t("adminAnalytics.semantic.deltaVsPrevious")}"]`),
    ).toBeNull();
  });

  it("werdykt wymagający reakcji podświetla cały wiersz, spokojny nie", () => {
    const divergent = real("sessions", [obs("ga4", 1000), obs("first_party", 2000)]);
    const drift = real("sessions", [obs("ga4", 1000), obs("first_party", 1100)]);

    const hot = renderRow(divergent);
    const hotClass = hot.container.querySelector("li")?.className ?? "";
    hot.unmount();
    const calm = renderRow(drift);

    expect(divergent.verdict).toBe("divergent");
    expect(drift.verdict).toBe("expected_drift");
    expect(hotClass).toContain("amber");
    expect(calm.container.querySelector("li")?.className).not.toContain("amber");
  });

  it("odwrócona relacja strumieni jest podpisana jako odwrócenie, nie jako rozjazd", () => {
    const t = realT("pl");
    // GA4 filtruje boty, więc NIE MOŻE raportować więcej niż surowy licznik
    // first-party. Odwrócenie to błąd konfiguracji, nie naturalny dryf.
    const entry = real("sessions", [obs("ga4", 2000), obs("first_party", 1000)]);
    const { container } = renderRow(entry);

    expect(entry.verdict).toBe("order_inverted");
    expect(container.textContent).toContain(t("adminAnalytics.semantic.verdict.order_inverted"));
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.verdict.divergent"));
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.reason.expected_order_inverted"),
    );
  });

  it("para nieporównywalna jest podpisana jako nieporównywalna i mówi DLACZEGO", () => {
    const t = realT("pl");
    // Okno z dniem otwartym: liczby są poprawne osobno, ale zderzenie ich
    // pokazałoby fałszywy deficyt po stronie GA4.
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 2000)], OPEN);
    const { container } = renderRow(entry);

    expect(entry.verdict).toBe("incomparable");
    expect(container.textContent).toContain(t("adminAnalytics.semantic.verdict.incomparable"));
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.verdict.divergent"));
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.reason.window_not_cross_stream_safe"),
    );
    // Bez porównania nie ma rozjazdu do pokazania.
    expect(entry.spread).toBeNull();
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.spreadLabel"));
  });

  it("rozjazd pokazuje się przy werdykcie, gdy jest co porównywać", () => {
    const t = realT("pl");
    const entry = real("page_views", [obs("ga4", 1000), obs("first_party", 1500)]);
    const { container } = renderRow(entry);

    expect(entry.spread).toBeCloseTo(0.5, 6);
    expect(container.textContent).toContain(t("adminAnalytics.semantic.spreadLabel"));
    expect(container.textContent).toMatch(/50\s?%/);
  });

  it("obserwacje potwierdzające mają własną liczbę i odchylenie ze znakiem", () => {
    const entry = real("visitors", [obs("ga4", 800), obs("first_party", 1000)]);
    const { container } = renderRow(entry);

    const corr = entry.observations.find((o) => o.role === "corroborating");
    expect(corr?.counted).toBe(true);
    expect(corr?.deviation).toBeCloseTo(0.25, 6);
    // Chip strumienia potwierdzającego, jego liczba i odchylenie +25 %.
    expect(container.textContent).toContain(streamById("first_party").labelPl);
    expect(container.textContent).toMatch(/1\s?000/);
    expect(container.textContent).toMatch(/\+25\s?%/);
  });

  it("obserwacja bez wartości nie zostawia po sobie pustego wiersza", () => {
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", null)]);
    const { container } = renderRow(entry);

    expect(entry.verdict).toBe("single_source");
    expect(container.textContent).not.toContain(streamById("first_party").labelPl);
    // Sam strumień autorytatywny jest nadal opisany.
    expect(container.textContent).toContain(streamById("ga4").labelPl);
  });

  it("obserwacja nieuwzględniona w ocenie nie dostaje badge'a odchylenia", () => {
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 2000)], OPEN);
    const { container } = renderRow(entry);

    const corr = entry.observations.find((o) => o.role === "corroborating");
    expect(corr?.counted).toBe(false);
    expect(corr?.deviation).not.toBeNull();
    // Liczba potwierdzająca jest pokazana, ale BEZ odchylenia - na tym oknie
    // odchylenie nie znaczy nic i podanie go byłoby fałszywą precyzją.
    expect(container.textContent).toContain(streamById("first_party").labelPl);
    expect(container.textContent).not.toMatch(/\+100\s?%/);
  });

  it("wiersz bez powodów rozjazdu nie rysuje pustej listy przypisów", () => {
    const entry = synthetic({ metricId: "cta_clicks", authoritativeStream: "first_party" });
    const { container } = renderRow(entry);

    expect(entry.reasons).toHaveLength(0);
    expect(container.querySelectorAll("li ul")).toHaveLength(0);
  });

  it("w EN nazwa metryki i powody rozjazdu są angielskie", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 2000)]);
    const { container } = renderRow(entry, 12.5);

    expect(container.textContent).toContain(metricById("sessions").labelEn);
    expect(container.textContent).not.toContain(metricById("sessions").labelPl);
    for (const reason of entry.reasons) {
      expect(container.textContent).toContain(en(`adminAnalytics.semantic.reason.${reason}`));
    }
  });

  it("wiersz uzgodnienia jest wolny od naruszeń axe", async () => {
    const entry = real("sessions", [obs("ga4", 1000), obs("first_party", 2000)]);
    const { container } = renderRow(entry, -8.2);

    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("StreamHealthGrid - czego w liczbach NIE MA", () => {
  it("pokazuje wszystkie sześć strumieni rejestru, także te nieobecne w odpowiedzi", () => {
    render(<StreamHealthGrid streams={[health("ga4", true)]} />);

    // Strumień pominięty w odpowiedzi to NIE strumień zdrowy - siatka musi go
    // wymienić, bo inaczej „czego nie ma” samo znika z ekranu.
    expect(screen.getAllByRole("listitem")).toHaveLength(STREAMS.length);
    for (const stream of STREAMS) {
      expect(screen.getByText(stream.labelPl)).toBeInTheDocument();
    }
  });

  it("cztery stany dostępności dają CZTERY różne napisy i cztery różne ikony", () => {
    const t = realT("pl");
    const { container } = render(
      <StreamHealthGrid
        streams={[
          health("ga4", true),
          health("first_party", false, "not_configured"),
          health("web_vitals", false, "read_failed"),
          health("ad_events", false, "no_data"),
          health("newsletter", false, "no_data"),
          health("content_views", false, "no_data"),
        ]}
      />,
    );

    // Napis jest jedynym nośnikiem statusu dla czytnika ekranu: ikony lucide
    // są `aria-hidden`, więc dla osoby niewidzącej NIE ISTNIEJĄ.
    expect(statusLine("ga4")).toBe(t("adminAnalytics.semantic.streams.available"));
    expect(statusLine("first_party")).toBe(t("adminAnalytics.semantic.streams.not_configured"));
    expect(statusLine("web_vitals")).toBe(t("adminAnalytics.semantic.streams.read_failed"));
    expect(statusLine("ad_events")).toBe(t("adminAnalytics.semantic.streams.no_data"));
    expect(
      new Set([
        statusLine("ga4"),
        statusLine("first_party"),
        statusLine("web_vitals"),
        statusLine("ad_events"),
      ]).size,
    ).toBe(4);

    // Ikony też muszą się różnić - inaczej wzrokowe skanowanie siatki kłamie.
    const icons = statusIconClasses(container);
    expect(new Set(icons.slice(0, 4)).size).toBe(4);
    expect(icons[0]).toContain("emerald");
    expect(icons[2]).toContain("amber");
  });

  it("strumień pominięty w odpowiedzi czyta się jako nieudany odczyt, nie jako pustka", () => {
    const t = realT("pl");
    render(<StreamHealthGrid streams={[health("ga4", true)]} />);

    // Domyślna gałąź `byId.get(...) ?? read_failed`: brak wpisu znaczy, że
    // odczyt nie doszedł, a nie że w oknie nie było zdarzeń.
    expect(statusLine("newsletter")).toBe(t("adminAnalytics.semantic.streams.read_failed"));
    expect(statusLine("newsletter")).not.toBe(t("adminAnalytics.semantic.streams.no_data"));
  });

  it("niedostępność bez kodu przyczyny spada na „brak danych w oknie”", () => {
    const t = realT("pl");
    render(<StreamHealthGrid streams={[health("ga4", false)]} />);

    expect(statusLine("ga4")).toBe(t("adminAnalytics.semantic.streams.no_data"));
  });

  it("pusta odpowiedź nie maluje ani jednego strumienia jako zbierającego dane", () => {
    const t = realT("pl");
    render(<StreamHealthGrid streams={[]} />);

    // Stan pusty listy: sześć kafelków, zero deklaracji „zbiera dane”.
    expect(screen.getAllByRole("listitem")).toHaveLength(STREAMS.length);
    expect(screen.queryByText(t("adminAnalytics.semantic.streams.available"))).toBeNull();
    expect(screen.getAllByText(t("adminAnalytics.semantic.streams.read_failed"))).toHaveLength(
      STREAMS.length,
    );
  });

  it("bramka zgody stoi na KAŻDYM kafelku, niezależnie od statusu", () => {
    const t = realT("pl");
    render(<StreamHealthGrid streams={STREAMS.map((s) => health(s.id, false, "no_data"))} />);

    // Zero w strumieniu za bramką zgody może być artefaktem braku zgody, a nie
    // brakiem ruchu. Bramka musi być widoczna także wtedy, gdy liczby nie ma.
    for (const stream of STREAMS) {
      expect(
        within(streamTile(stream.id)).getByText(
          t(`adminAnalytics.semantic.consentGate.${stream.consentGate}`),
        ),
      ).toBeInTheDocument();
    }
    // Strumień marketingowy nie czyta się jak analityczny.
    expect(
      within(streamTile("ad_events")).getByText(t("adminAnalytics.semantic.consentGate.marketing")),
    ).toBeInTheDocument();
    expect(
      within(streamTile("content_views")).getByText(t("adminAnalytics.semantic.consentGate.none")),
    ).toBeInTheDocument();
  });

  it("zastrzeżenia strumienia są w podpowiedzi przy ziarnie tożsamości", () => {
    const t = realT("pl");
    render(<StreamHealthGrid streams={[health("content_views", true)]} />);

    const badge = within(streamTile("content_views")).getByText(
      t("adminAnalytics.semantic.identityGrain.viewer_hash"),
    );
    fireEvent.focus(badge);

    const text = popperText();
    expect(text).toContain(t("adminAnalytics.semantic.streams.caveats"));
    for (const caveat of streamById("content_views").caveats) {
      expect(text).toContain(caveat);
    }
  });

  it("w EN nazwy strumieni i statusy są angielskie", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const { container } = render(
      <StreamHealthGrid streams={[health("ga4", false, "not_configured")]} />,
    );

    expect(container.textContent).toContain(en("adminAnalytics.semantic.streams.title"));
    expect(container.textContent).toContain(en("adminAnalytics.semantic.streams.not_configured"));
    expect(container.textContent).toContain(streamById("content_views").labelEn);
    expect(container.textContent).not.toContain(streamById("content_views").labelPl);
  });

  it("siatka jest prawdziwą listą i nie ma naruszeń axe", async () => {
    const { container } = render(
      <StreamHealthGrid streams={[health("ga4", true), health("first_party", false, "no_data")]} />,
    );

    // Sześć kafelków w `ul`/`li`: dla czytnika ekranu to lista o znanej
    // długości, a nie ciąg nieopisanych pudełek.
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails(
    "DEFEKT: brak zgody analitycznej czyta się identycznie jak brak ruchu - status „za bramką” nie istnieje",
    () => {
      // `streams.ts` deklaruje `consentGate` właśnie dlatego, że strumień za
      // bramką „analityka” bez zgody odwiedzającego jest STRUKTURALNIE pusty -
      // to inna informacja niż „w oknie nie było zdarzeń” i prowadzi do innej
      // decyzji (popraw baner zgody vs popraw dystrybucję treści).
      // `SemanticStreamHealth.reason` zna tylko `not_configured | read_failed |
      // no_data`, a słownik nie ma klucza `streams.gated`, więc oba przypadki
      // dostają ten sam napis. Naprawa wymaga trzeciego kodu przyczyny w DTO
      // migawki i klucza `adminAnalytics.semantic.streams.gated`.
      const t = realT("pl");
      render(<StreamHealthGrid streams={STREAMS.map((s) => health(s.id, false, "no_data"))} />);

      expect(streamById("first_party").consentGate).toBe("analytics");
      expect(streamById("content_views").consentGate).toBe("none");
      expect(statusLine("first_party")).not.toBe(statusLine("content_views"));
      expect(t("adminAnalytics.semantic.streams.gated")).not.toBe(
        "adminAnalytics.semantic.streams.gated",
      );
    },
  );

  it.fails(
    "DEFEKT: zastrzeżenia strumienia są NIEDOSTĘPNE z klawiatury - wyzwalacz nie jest fokusowalny",
    () => {
      // `Badge` to `div`, a `TooltipTrigger asChild` go tylko klonuje. Treść
      // zastrzeżeń (np. „widok liczony po 1,5 s obecności”, „odsłony autora są
      // pomijane”) nie istnieje NIGDZIE indziej w drzewie, więc dla osoby
      // pracującej klawiaturą albo czytnikiem ekranu ta wiedza przepada.
      const t = realT("pl");
      render(<StreamHealthGrid streams={[health("content_views", true)]} />);
      const badge = within(streamTile("content_views")).getByText(
        t("adminAnalytics.semantic.identityGrain.viewer_hash"),
      );

      expect(badge.matches("button, a[href], input, select, textarea, [tabindex]")).toBe(true);
    },
  );
});

describe("WindowProvenance - z jakiego okna pochodzą liczby", () => {
  it("pokazuje granice okna, jego długość i ziarno", () => {
    const t = realT("pl");
    const { container } = render(<WindowProvenance window={SAFE} />);

    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.title"));
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.range", {
        since: SAFE.sinceIso.slice(0, 10),
        until: SAFE.untilIso.slice(0, 10),
      }),
    );
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.days", { count: SAFE.days }),
    );
    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.grainDay"));
  });

  it("pokazuje DOKŁADNY zakres dat wysłany do GA4, a nie tylko granice ISO", () => {
    const t = realT("pl");
    const { container } = render(<WindowProvenance window={SAFE} />);

    // To jest cała pointa tej karty: admin porównujący panel z interfejsem
    // Google musi widzieć, o które dni pytaliśmy Data API.
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.ga4Range", {
        start: SAFE.ga4.startDate,
        end: SAFE.ga4.endDate,
      }),
    );
    expect(SAFE.ga4.endDate).toBe("2026-07-14");
  });

  it("ziarno kroczące jest nazwane inaczej niż dobowe i traci bezpieczeństwo porównań", () => {
    const t = realT("pl");
    const day = render(<WindowProvenance window={SAFE} />);
    const dayText = day.container.textContent ?? "";
    day.unmount();
    const instant = render(<WindowProvenance window={INSTANT} />);
    const instantText = instant.container.textContent ?? "";

    expect(INSTANT.grain).toBe("instant");
    expect(dayText).toContain(t("adminAnalytics.semantic.window.grainDay"));
    expect(instantText).toContain(t("adminAnalytics.semantic.window.grainInstant"));
    expect(t("adminAnalytics.semantic.window.grainDay")).not.toBe(
      t("adminAnalytics.semantic.window.grainInstant"),
    );
    // Okno kroczące jest jawnie oznaczone jako nieporównywalne między strumieniami.
    expect(instantText).toContain(t("adminAnalytics.semantic.window.unsafe"));
    expect(dayText).toContain(t("adminAnalytics.semantic.window.safe"));
  });

  it("okno niebezpieczne dla porównań ma inną odznakę niż bezpieczne", () => {
    const safe = render(<WindowProvenance window={SAFE} />);
    const safeBadge = safe.container.querySelector(".rounded-\\[6px\\]")?.className ?? "";
    safe.unmount();
    const unsafe = render(<WindowProvenance window={OPEN} />);
    const unsafeBadge = unsafe.container.querySelector(".rounded-\\[6px\\]")?.className ?? "";

    expect(SAFE.crossStreamSafe).toBe(true);
    expect(OPEN.crossStreamSafe).toBe(false);
    expect(safeBadge).toContain("emerald");
    expect(unsafeBadge).toContain("amber");
    expect(safeBadge).not.toBe(unsafeBadge);
  });

  it("okno poprzednie pokazuje się tylko wtedy, gdy panel liczy zmiany", () => {
    const t = realT("pl");
    const previous = { sinceIso: "2026-05-20T00:00:00.000Z", untilIso: "2026-06-16T23:59:59.999Z" };
    const withPrev = render(<WindowProvenance window={SAFE} previous={previous} />);

    expect(withPrev.container.textContent).toContain(t("adminAnalytics.semantic.window.previous"));
    expect(withPrev.container.textContent).toContain("2026-05-20");
    expect(withPrev.container.textContent).toContain("2026-06-16");
    withPrev.unmount();

    const withoutPrev = render(<WindowProvenance window={SAFE} />);
    expect(withoutPrev.container.textContent).not.toContain(
      t("adminAnalytics.semantic.window.previous"),
    );
  });

  it("zastrzeżenia zmieniające interpretację mają ostrzeżenie, informacyjne - nie", () => {
    const t = realT("pl");
    const warned: WindowNote[] = ["ga4_open_day", "legacy_rpc_window_ends_now"];
    const notes: WindowNote[] = [...warned, "ga4_property_timezone", "excludes_open_day"];
    const { container } = render(
      <WindowProvenance window={{ ...SAFE, crossStreamSafe: false, notes }} />,
    );

    for (const note of notes) {
      expect(container.textContent).toContain(t(`adminAnalytics.semantic.windowNotes.${note}`));
    }

    // Trzy klasy zastrzeżeń = trzy różne ikony: ostrzeżenie (bursztyn),
    // potwierdzenie pominięcia dnia otwartego (zieleń), informacja (błękit).
    const noteIcons = Array.from(container.querySelectorAll("li > svg")).map(
      (el) => el.getAttribute("class") ?? "",
    );
    expect(noteIcons).toHaveLength(4);
    expect(noteIcons[0]).toContain("amber");
    expect(noteIcons[1]).toContain("amber");
    expect(noteIcons[2]).toContain("sky");
    expect(noteIcons[3]).toContain("emerald");
    expect(new Set(noteIcons).size).toBe(3);
  });

  it("okno bez zastrzeżeń nie rysuje pustej listy", () => {
    const { container } = render(<WindowProvenance window={{ ...SAFE, notes: [] }} />);

    expect(container.querySelector("ul")).toBeNull();
  });

  it("wariant zwięzły jest jedną linią bez karty, ale wciąż niesie okno i ziarno", () => {
    const t = realT("pl");
    const { container } = render(<WindowProvenance window={SAFE} compact className="mt-1" />);

    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.window.title"));
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.days", { count: SAFE.days }),
    );
    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.grainDay"));
    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.safe"));
    // Nagłówki dashboardów nie potrzebują zakresu GA4 ani okna poprzedniego.
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.window.previous"));
    expect(container.firstElementChild?.className).toContain("mt-1");
  });

  it("wariant zwięzły też odróżnia okno niebezpieczne od bezpiecznego", () => {
    const t = realT("pl");
    const { container } = render(<WindowProvenance window={INSTANT} compact />);

    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.unsafe"));
    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.grainInstant"));
  });

  it("w EN cała karta okna jest angielska", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = render(<WindowProvenance window={SAFE} />);

    expect(container.textContent).toContain(en("adminAnalytics.semantic.window.title"));
    expect(container.textContent).toContain(en("adminAnalytics.semantic.window.grainDay"));
    expect(container.textContent).toContain(
      en("adminAnalytics.semantic.windowNotes.excludes_open_day"),
    );
    expect(container.textContent).not.toContain(pl("adminAnalytics.semantic.window.title"));
  });

  it("karta okna i wariant zwięzły są wolne od naruszeń axe", async () => {
    const card = render(
      <WindowProvenance
        window={OPEN}
        previous={{ sinceIso: SAFE.sinceIso, untilIso: SAFE.untilIso }}
      />,
    );
    expect(summarize(await axeViolations(card.container))).toBe("");
    card.unmount();

    const compact = render(<WindowProvenance window={SAFE} compact />);
    expect(summarize(await axeViolations(compact.container))).toBe("");
  });
});

describe("Molekuły semantyczne - izolacja warsztatów", () => {
  it("wiersz uzgodnienia nie przenosi liczby warsztatu A do panelu warsztatu B", () => {
    // Warsztat A: 12 345 odsłon.
    const a = renderRow(real("page_views", [obs("ga4", 12345), obs("first_party", 13000)]));
    expect(a.container.textContent).toMatch(/12\s?345/);
    a.unmount();

    // Warsztat B: 77 odsłon i inny werdykt.
    const b = renderRow(real("page_views", [obs("ga4", 77), obs("first_party", 80)]));

    expect(b.container.textContent).toContain("77");
    expect(b.container.textContent).not.toMatch(/12\s?345/);
    expect(b.container.textContent).not.toMatch(/13\s?000/);
  });

  it("siatka strumieni warsztatu B nie pokazuje statusów warsztatu A", () => {
    const t = realT("pl");
    const a = render(<StreamHealthGrid streams={STREAMS.map((s) => health(s.id, true))} />);
    expect(a.container.textContent).toContain(t("adminAnalytics.semantic.streams.available"));
    a.unmount();
    cleanup();

    const b = render(
      <StreamHealthGrid streams={STREAMS.map((s) => health(s.id, false, "not_configured"))} />,
    );

    expect(b.container.textContent).not.toContain(t("adminAnalytics.semantic.streams.available"));
    expect(b.container.textContent).toContain(t("adminAnalytics.semantic.streams.not_configured"));
  });

  it("karta okna warsztatu B pokazuje okno warsztatu B, nie zapamiętane granice", () => {
    const other: CanonicalWindow = resolveWindow({
      presetId: "7d",
      nowMs: Date.parse("2026-03-10T09:00:00.000Z"),
    });
    const a = render(<WindowProvenance window={SAFE} />);
    expect(a.container.textContent).toContain(SAFE.ga4.startDate);
    a.unmount();

    const b = render(<WindowProvenance window={other} />);

    expect(b.container.textContent).toContain(other.ga4.startDate);
    expect(b.container.textContent).not.toContain(SAFE.ga4.startDate);
  });

  it("żadna molekuła nie przyjmuje identyfikatora warsztatu ani hosta", () => {
    const { container } = render(
      <div>
        <StreamHealthGrid streams={[health("ga4", true)]} />
        <WindowProvenance window={SAFE} />
        <MetricDefinitionPopover metricId="sessions" />
      </div>,
    );

    // Dane tenantowe wchodzą WYŁĄCZNIE propsem policzonym po stronie serwera
    // z profilu wywołującego - w drzewie nie ma ani tenanta, ani nagłówka hosta.
    expect(container.innerHTML).not.toContain("tenant");
    expect(container.innerHTML).not.toContain("x-tenant-host");
    expect(container.innerHTML).not.toContain("example.com");
  });
});
