// Inwarianty rejestru warstwy semantycznej. Te testy pilnują właściwości, na
// których opiera się cała reszta: dokładnie jeden strumień autorytatywny na
// metrykę, kompletność deskryptorów strumieni i spójność reguł porównywalności.
// Bez nich rejestr mógłby cicho zgnić i znowu wpuścić dwie liczby pod jedną nazwą.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-semantic";
import {
  ALL_STREAMS,
  HUB_METRIC_IDS,
  HUB_STREAMS,
  METRICS,
  METRIC_GROUP,
  STREAMS,
  assertSameStreamRatio,
  authoritativeBinding,
  bindingFor,
  comparabilityOf,
  metricById,
  metricsForStream,
  sharesConsentPopulation,
  sharesIdentityGrain,
  streamById,
  type MetricGroup,
  type MetricId,
  type StreamId,
} from ".";

describe("rejestr strumieni", () => {
  it("zawiera dokładnie sześć strumieni z unikalnymi id", () => {
    expect(STREAMS).toHaveLength(6);
    const ids = STREAMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("pełny rejestr ma DZIEWIĘĆ strumieni, a `STREAMS` świadomie zostaje przy sześciu", () => {
    // ŚWIADOMIE: `STREAMS` to zakres migawki analitycznej - iterują po nim
    // `getSemanticSnapshot` i `StreamHealthGrid`. Strumienie huba w tej liście
    // dałyby trzy fałszywe „odczyt nie powiódł się” na zakładce uzgodnienia.
    expect(ALL_STREAMS).toHaveLength(9);
    expect(new Set(ALL_STREAMS.map((s) => s.id)).size).toBe(9);
    expect(HUB_STREAMS.map((s) => s.id)).toEqual(["billing", "lifecycle", "community"]);
    expect(ALL_STREAMS.map((s) => s.id)).toEqual([
      ...STREAMS.map((s) => s.id),
      ...HUB_STREAMS.map((s) => s.id),
    ]);
    for (const hub of HUB_STREAMS) {
      expect(
        STREAMS.some((s) => s.id === hub.id),
        hub.id,
      ).toBe(false);
    }
  });

  it("strumienie huba stoją na umowie (bez bramki cookie) i na ziarnie konta", () => {
    for (const s of HUB_STREAMS) {
      expect(s.consentGate, s.id).toBe("none");
      expect(s.identityGrain, s.id).toBe("account");
      expect(streamById(s.id)).toBe(s);
    }
    // Zastrzeżenia strukturalne, bez których liczby huba czytałoby się źle.
    const caveats = HUB_STREAMS.flatMap((s) => s.caveats).join(" ");
    expect(caveats).toMatch(/environment = 'live'/);
    expect(caveats).toMatch(/data_since/);
    expect(caveats).toMatch(/[Cc]atalogue prices|CATALOGUE prices/);
    expect(streamById("lifecycle").caveats.join(" ")).toMatch(/Anonymous visitors/);
    expect(streamById("community").caveats.join(" ")).toMatch(/event_rsvps/);
  });

  it("nazwy strumieni są unikalne w całym rejestrze (PL i EN)", () => {
    expect(new Set(ALL_STREAMS.map((s) => s.labelPl)).size).toBe(ALL_STREAMS.length);
    expect(new Set(ALL_STREAMS.map((s) => s.labelEn)).size).toBe(ALL_STREAMS.length);
  });

  it("każdy strumień deklaruje pełny zestaw atrybutów semantycznych", () => {
    for (const s of ALL_STREAMS) {
      expect(s.labelPl.length).toBeGreaterThan(0);
      expect(s.labelEn.length).toBeGreaterThan(0);
      expect(s.store.length).toBeGreaterThan(0);
      expect(s.producer.length).toBeGreaterThan(0);
      expect(s.latencyHours).toBeGreaterThanOrEqual(0);
      // Zastrzeżenia są sensem istnienia rejestru - strumień bez nich znaczy,
      // że ktoś dodał źródło, nie opisawszy jego semantyki.
      expect(s.caveats.length).toBeGreaterThan(0);
    }
  });

  it("okno deduplikacji jest podane wtedy i tylko wtedy, gdy tryb to `window`", () => {
    for (const s of ALL_STREAMS) {
      if (s.dedupe === "window") {
        expect(s.dedupeWindowMinutes).toBeGreaterThan(0);
      } else {
        expect(s.dedupeWindowMinutes).toBeUndefined();
      }
    }
  });

  it("streamById rzuca dla nieznanego strumienia", () => {
    expect(() => streamById("nope" as StreamId)).toThrow(/Unknown analytics stream/);
  });

  it("reklamy i zdarzenia first-party stoją za RÓŻNYMI bramkami zgody", () => {
    // To jest powód, dla którego CTR reklam nie wolno liczyć na odsłonach stron.
    expect(sharesConsentPopulation("ad_events", "first_party")).toBe(false);
    expect(streamById("ad_events").consentGate).toBe("marketing");
    expect(streamById("first_party").consentGate).toBe("analytics");
  });

  it("sesja GA4 i sesja first-party to różne ziarna tożsamości", () => {
    expect(sharesIdentityGrain("ga4", "first_party")).toBe(false);
  });
});

describe("słownik metryk kanonicznych", () => {
  it("każda metryka ma DOKŁADNIE jedno powiązanie autorytatywne", () => {
    for (const m of METRICS) {
      const authoritative = m.bindings.filter((b) => b.role === "authoritative");
      expect(authoritative, `metryka ${m.id}`).toHaveLength(1);
    }
  });

  it("każda metryka ma definicję PL i EN oraz co najmniej jeden guard", () => {
    for (const m of METRICS) {
      expect(m.definitionPl.length, m.id).toBeGreaterThan(20);
      expect(m.definitionEn.length, m.id).toBeGreaterThan(20);
      expect(m.labelPl.length, m.id).toBeGreaterThan(0);
      expect(m.labelEn.length, m.id).toBeGreaterThan(0);
      expect(m.guards.length, m.id).toBeGreaterThan(0);
    }
  });

  it("tolerancja rozjazdu jest niezerowa tylko przy wielu strumieniach", () => {
    for (const m of METRICS) {
      if (m.bindings.length === 1) {
        expect(m.driftTolerance, m.id).toBe(0);
      } else {
        expect(m.driftTolerance, m.id).toBeGreaterThan(0);
      }
    }
  });

  it("każde id strumienia w powiązaniach istnieje w rejestrze strumieni", () => {
    const known = new Set(ALL_STREAMS.map((s) => s.id));
    for (const m of METRICS) {
      for (const b of m.bindings) {
        expect(known.has(b.streamId), `${m.id} -> ${b.streamId}`).toBe(true);
      }
    }
  });

  it("expectedOrder odwołuje się wyłącznie do powiązanych strumieni", () => {
    for (const m of METRICS) {
      const bound = new Set(m.bindings.map((b) => b.streamId));
      for (const id of m.expectedOrder ?? []) {
        expect(bound.has(id), `${m.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("metricById / authoritativeBinding rzucają dla nieznanej metryki", () => {
    // @ts-expect-error - celowo poza unią MetricId
    expect(() => metricById("ghost")).toThrow(/Unknown canonical metric/);
    // @ts-expect-error - celowo poza unią MetricId
    expect(() => authoritativeBinding("ghost")).toThrow(/Unknown canonical metric/);
  });

  it("bindingFor zwraca undefined dla strumienia, który metryki nie obsługuje", () => {
    expect(bindingFor("sessions", "newsletter")).toBeUndefined();
    expect(bindingFor("sessions", "ga4")?.field).toBe("sessions");
  });

  it("metricsForStream wskazuje metryki obsługiwane przez dany strumień", () => {
    const vitals = metricsForStream("web_vitals").map((m) => m.id);
    expect(vitals).toEqual(["lcp_p75", "inp_p75", "cls_p75"]);
    expect(metricsForStream("ga4").map((m) => m.id)).toContain("engagement_rate");
  });

  it("odsłony stron i odsłony treści są ODDZIELNYMI metrykami", () => {
    // Sedno fragmentacji: obie nazywały się „views”, a mierzą co innego.
    const pv = metricById("page_views");
    const cv = metricById("content_views");
    expect(pv.id).not.toBe(cv.id);
    expect(authoritativeBinding("page_views").streamId).toBe("ga4");
    expect(authoritativeBinding("content_views").streamId).toBe("content_views");
    expect(cv.definitionEn).toMatch(/1\.5 s of dwell/);
  });
});

describe("porównywalność powiązań", () => {
  it("różne bramki zgody dają `incomparable`", () => {
    const impressions = authoritativeBinding("ad_impressions");
    const views = authoritativeBinding("page_views");
    expect(comparabilityOf(impressions, views)).toBe("incomparable");
  });

  it("ta sama bramka, inne ziarno daje `analogous`", () => {
    const ga4 = bindingFor("sessions", "ga4");
    const fp = bindingFor("sessions", "first_party");
    expect(ga4 && fp && comparabilityOf(ga4, fp)).toBe("analogous");
  });

  it("porównanie powiązania z samym sobą daje `equivalent`", () => {
    const b = authoritativeBinding("cta_clicks");
    expect(comparabilityOf(b, b)).toBe("equivalent");
  });
});

describe("assertSameStreamRatio", () => {
  it("przepuszcza wskaźnik liczony w jednym strumieniu", () => {
    expect(assertSameStreamRatio("ad_clicks", "ad_impressions")).toEqual({ ok: true });
    expect(assertSameStreamRatio("email_clicks", "email_opens")).toEqual({ ok: true });
  });

  it("blokuje CTR reklam liczony na odsłonach stron i wyjaśnia dlaczego", () => {
    const result = assertSameStreamRatio("ad_clicks", "page_views");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/consent: marketing/);
      expect(result.reason).toMatch(/consent: analytics/);
      expect(result.reason).toMatch(/do not cancel out/);
    }
  });

  it("blokuje CTR rekomendacji liczony na odsłonach stron", () => {
    // related_clicks żyje w strumieniu content_views (dwell 1,5 s + dedup 5 min),
    // page_views w GA4 - jedyny poprawny mianownik to content_views.
    expect(assertSameStreamRatio("related_clicks", "page_views").ok).toBe(false);
    expect(assertSameStreamRatio("related_clicks", "content_views").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Metryki huba „Przychód i lejek” (SPEC §5.5)
// ---------------------------------------------------------------------------

/** Lista z SPEC §5.5 przepisana LITERALNIE - kolejność grup i pozycji jest kontraktem. */
const SPEC_HUB_METRICS: Readonly<Record<Exclude<MetricGroup, "traffic">, readonly MetricId[]>> = {
  revenue: [
    "mrr",
    "arr",
    "arpa",
    "arpu",
    "active_subscriptions",
    "mrr_growth_mom",
    "net_new_mrr",
    "saas_quick_ratio",
    "expansion_share_new_mrr",
    "annual_plan_share",
    "revenue_realized",
    "price_realization",
    "average_discount",
    "coupon_redemption_rate",
  ],
  retention: [
    "logo_churn_monthly",
    "logo_churn_annual",
    "gross_revenue_churn",
    "net_revenue_retention",
    "gross_revenue_retention",
    "involuntary_churn_share",
    "dunning_recovery_rate",
    "cancellation_save_rate",
    "winback_rate_12m",
    "returning_subscriber_share",
    "cohort_retention_m1",
    "cohort_retention_m3",
    "cohort_retention_m12",
  ],
  funnel: [
    "visitor_to_registration_rate",
    "registered_to_paid_rate",
    "paywall_conversion_rate",
    "paywall_hit_rate",
    "trial_to_paid_rate",
    "checkout_conversion_rate",
    "checkout_abandonment_rate",
    "pricing_page_conversion_rate",
    "signup_form_conversion_rate",
  ],
  economics: [
    "ltv",
    "cac",
    "new_cac_ratio",
    "ltv_cac_ratio",
    "cac_payback_months",
    "subscription_gross_margin",
    "rule_of_40",
  ],
  email: [
    "email_open_rate",
    "email_ctr_delivered",
    "email_unsubscribe_rate",
    "email_hard_bounce_rate",
    "email_soft_bounce_rate",
    "email_spam_complaint_rate",
    "newsletter_list_growth_rate",
    "doi_confirmation_rate",
    "email_disaffection_rate",
    "journey_open_rate",
    "journey_click_rate",
    "journey_goal_rate",
  ],
  community: [
    "event_ticket_revenue",
    "event_attendance_rate",
    "no_show_rate",
    "event_registration_conversion",
    "club_application_acceptance",
    "club_decision_time",
    "club_active_member_rate",
    "club_contributor_rate",
    "dau_mau",
    "wau_mau",
  ],
  crm: [
    "lead_to_mql_rate",
    "mql_to_sql_rate",
    "win_rate",
    "lead_response_time",
    "sales_cycle_length",
  ],
};

const SPEC_ORDER: readonly (keyof typeof SPEC_HUB_METRICS)[] = [
  "revenue",
  "retention",
  "funnel",
  "economics",
  "email",
  "community",
  "crm",
];

describe("metryki huba - kompletność i kolejność", () => {
  it("rejestr ma 88 metryk: 18 ruchu i 70 huba", () => {
    expect(METRICS).toHaveLength(88);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(88);
    expect(HUB_METRIC_IDS).toHaveLength(70);
  });

  it("HUB_METRIC_IDS = lista SPEC §5.5 w kolejności grup i pozycji", () => {
    expect(HUB_METRIC_IDS).toEqual(SPEC_ORDER.flatMap((g) => SPEC_HUB_METRICS[g]));
    // Słownik iteruje METRICS - metryki huba idą po 18 metrykach ruchu.
    expect(METRICS.slice(18).map((m) => m.id)).toEqual(HUB_METRIC_IDS);
  });

  it("liczności grup: przychód 14, retencja 13, lejek 9, ekonomika 7, e-mail 12, społeczność 10, CRM 5", () => {
    expect(SPEC_ORDER.map((g) => SPEC_HUB_METRICS[g].length)).toEqual([14, 13, 9, 7, 12, 10, 5]);
  });

  it("METRIC_GROUP ma grupę dla KAŻDEJ metryki i zgadza się z grupami SPEC", () => {
    expect(Object.keys(METRIC_GROUP).sort()).toEqual(METRICS.map((m) => m.id).sort());
    for (const group of SPEC_ORDER) {
      for (const id of SPEC_HUB_METRICS[group]) expect(METRIC_GROUP[id], id).toBe(group);
    }
    // Trzy metryki newslettera sprzed huba należą do e-maila, reszta to ruch.
    const base = METRICS.slice(0, 18).map((m) => m.id);
    expect(base.filter((id) => METRIC_GROUP[id] === "email")).toEqual([
      "email_opens",
      "email_clicks",
      "email_ctr",
    ]);
    expect(
      base
        .filter((id) => METRIC_GROUP[id] !== "email")
        .every((id) => METRIC_GROUP[id] === "traffic"),
    ).toBe(true);
  });

  it("każda metryka huba deklaruje charakter okna", () => {
    for (const id of HUB_METRIC_IDS) expect(metricById(id).windowKind, id).toBeDefined();
  });

  it("kwota (`money_minor`) ⇔ `currencyBound` - kwota bez waluty nie istnieje", () => {
    for (const m of METRICS) {
      expect(m.currencyBound === true, m.id).toBe(m.unit === "money_minor");
    }
    expect(METRICS.filter((m) => m.currencyBound).map((m) => m.id)).toEqual([
      "mrr",
      "arr",
      "arpa",
      "arpu",
      "net_new_mrr",
      "revenue_realized",
      "ltv",
      "cac",
      "event_ticket_revenue",
    ]);
  });

  it("jednostki czasu i krotności tam, gdzie mierzy je źródło", () => {
    expect(metricById("sales_cycle_length").unit).toBe("days");
    expect(metricById("lead_response_time").unit).toBe("hours");
    expect(metricById("club_decision_time").unit).toBe("hours");
    expect(metricById("cac_payback_months").unit).toBe("months");
    for (const id of ["saas_quick_ratio", "new_cac_ratio", "ltv_cac_ratio"] as const) {
      expect(metricById(id).unit, id).toBe("multiple");
    }
  });
});

describe("metryki huba - strumienie i polityka ilorazów", () => {
  it("strumień autorytatywny wg DANE §9.2", () => {
    const byStream = (stream: StreamId) =>
      HUB_METRIC_IDS.filter((id) => authoritativeBinding(id).streamId === stream);
    expect(byStream("first_party")).toEqual([
      "visitor_to_registration_rate",
      "pricing_page_conversion_rate",
      "event_registration_conversion",
    ]);
    expect(byStream("content_views")).toEqual(["dau_mau", "wau_mau"]);
    expect(byStream("community")).toEqual([
      "event_ticket_revenue",
      "event_attendance_rate",
      "no_show_rate",
      "club_application_acceptance",
      "club_decision_time",
      "club_active_member_rate",
      "club_contributor_rate",
    ]);
    // Kampanie newslettera - strumień newslettera; ścieżki automatyczne - cykl życia.
    for (const id of SPEC_HUB_METRICS.email) {
      const expected = id.startsWith("journey_") ? "lifecycle" : "newsletter";
      expect(authoritativeBinding(id).streamId, id).toBe(expected);
    }
    for (const id of [...SPEC_HUB_METRICS.economics, ...SPEC_HUB_METRICS.retention]) {
      const expected = id === "cancellation_save_rate" ? "lifecycle" : "billing";
      expect(authoritativeBinding(id).streamId, id).toBe(expected);
    }
    for (const id of SPEC_HUB_METRICS.crm) {
      expect(authoritativeBinding(id).streamId, id).toBe("lifecycle");
      expect(authoritativeBinding(id).grain, id).toBe("crm_contact");
    }
    expect(authoritativeBinding("dau_mau").grain).toBe("account");
    expect(authoritativeBinding("wau_mau").grain).toBe("account");
  });

  it("strumień potwierdzający ma wyłącznie przychód zrealizowany (księga vs zamówienia)", () => {
    const multi = HUB_METRIC_IDS.filter((id) => metricById(id).bindings.length > 1);
    expect(multi).toEqual(["revenue_realized"]);
    const realized = metricById("revenue_realized");
    expect(realized.bindings.map((b) => [b.streamId, b.role])).toEqual([
      ["billing", "authoritative"],
      ["lifecycle", "corroborating"],
    ]);
    // Księga obejmuje raty odnowień, których kasa nie widzi - zamówienia
    // POWYŻEJ księgi to sygnał zgubionych dokumentów, nie dryf.
    expect(realized.expectedOrder).toEqual(["billing", "lifecycle"]);
    expect(realized.driftTolerance).toBeGreaterThan(0);
    const auth = authoritativeBinding("revenue_realized");
    const corr = bindingFor("revenue_realized", "lifecycle");
    expect(corr && comparabilityOf(auth, corr)).toBe("analogous");
  });

  it("iloraz złożony z metryk huba jest liczony w obrębie JEDNEGO strumienia - bez wyjątków", () => {
    // Pary licznik/mianownik nowych ilorazów, których obie strony są metrykami rejestru.
    const pairs: ReadonlyArray<readonly [MetricId, MetricId]> = [
      ["mrr", "active_subscriptions"], // ARPA
      ["net_new_mrr", "mrr"], // wzrost m/m
      ["ltv", "cac"], // LTV/CAC
      ["cac", "arpu"], // zwrot CAC
      ["arpu", "logo_churn_monthly"], // LTV
      ["checkout_conversion_rate", "checkout_abandonment_rate"],
      ["paywall_conversion_rate", "paywall_hit_rate"],
      ["event_attendance_rate", "no_show_rate"],
      ["club_contributor_rate", "club_active_member_rate"],
      ["dau_mau", "wau_mau"],
      ["email_ctr_delivered", "email_open_rate"],
      ["email_clicks", "email_opens"], // CTOR
      ["journey_click_rate", "journey_open_rate"],
      ["lead_to_mql_rate", "mql_to_sql_rate"],
      ["win_rate", "mql_to_sql_rate"],
      ["visitor_to_registration_rate", "pricing_page_conversion_rate"],
    ];
    const wrong = pairs.filter(([n, d]) => !assertSameStreamRatio(n, d).ok);
    expect(wrong).toEqual([]);
  });

  it("V2P (rejestracje serwerowe ÷ odwiedzający first-party) jest ZABLOKOWANE", () => {
    // Odwiedzający stoją za zgodą analityczną, konta za umową - dwie populacje.
    const v2p = assertSameStreamRatio("registered_to_paid_rate", "visitor_to_registration_rate");
    expect(v2p.ok).toBe(false);
    if (!v2p.ok) expect(v2p.reason).toMatch(/consent: none.*consent: analytics/);
    // Bilety (wspólnota) nie dzielą się przez przychód z księgi (rozliczenia).
    expect(assertSameStreamRatio("event_ticket_revenue", "revenue_realized").ok).toBe(false);
  });
});

describe("metryki huba - treść", () => {
  it("email_ctr to CTOR: nowa etykieta, definicja bez zmian", () => {
    const ctor = metricById("email_ctr");
    expect(ctor.labelPl).toBe("CTOR newslettera");
    expect(ctor.labelEn).toBe("Newsletter CTOR");
    expect(ctor.definitionEn).toBe(
      "Clicks / opens in the same window (CTOR). The denominator inherits the unreliability of opens - report it with that caveat.",
    );
    expect(metricById("email_ctr_delivered").definitionEn).toMatch(/denominator is deliveries/);
  });

  it("guardy i definicje są UNIKALNE w całym rejestrze", () => {
    // Słownik renderuje każdy guard i definicję osobno, a test organizmu
    // (`semanticOrganisms.test.tsx`) szuka ich po treści: duplikat byłby
    // niejednoznaczny dla czytelnika i dla `getByText`.
    const guards = METRICS.flatMap((m) => m.guards);
    expect(guards.length - new Set(guards).size).toBe(0);
    for (const key of ["definitionPl", "definitionEn"] as const) {
      const all = METRICS.map((m) => m[key]);
      expect(all.length - new Set(all).size, key).toBe(0);
    }
    const everyText = [...guards, ...METRICS.flatMap((m) => [m.definitionPl, m.definitionEn])];
    expect(everyText.length - new Set(everyText).size).toBe(0);
  });

  it("etykiety są unikalne, a żadna nie jest początkiem etykiety WCZEŚNIEJSZEJ", () => {
    // Wiersz słownika szuka się po początku tekstu nagłówka (etykieta + jednostka).
    // „MRR” przed „MRR growth (MoM)” jest jednoznaczne; odwrotna kolejność
    // kazałaby wyszukiwaniu po „MRR” trafić w cudzy wiersz.
    for (const key of ["labelPl", "labelEn"] as const) {
      const labels = METRICS.map((m) => m[key]);
      expect(new Set(labels.map((l) => l.toLowerCase())).size, key).toBe(labels.length);
      const shadowed = labels.flatMap((label, i) =>
        labels
          .slice(0, i)
          .filter((earlier) => earlier.startsWith(label))
          .map((earlier) => `${label} ⊂ ${earlier}`),
      );
      expect(shadowed, key).toEqual([]);
    }
  });

  it("definicje mówią, kiedy wartości NIE MA - brak nie jest zerem", () => {
    for (const id of HUB_METRIC_IDS) {
      const m = metricById(id);
      expect(m.definitionPl, id).toMatch(/Brak wartości/);
      expect(m.definitionEn, id).toMatch(/Undefined/);
    }
  });

  it("guardy huba są po angielsku, jak reszta rejestru", () => {
    for (const id of HUB_METRIC_IDS) {
      for (const g of metricById(id).guards) {
        expect(g, id).not.toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/);
      }
    }
  });

  it("tekst rejestru huba nie zawiera samodzielnych słów-klas Tailwinda spoza arkusza publicznego", () => {
    // `src/lib/**` jest skanowany do arkusza PUBLICZNEGO (`src/styles.css`),
    // którego budżet jest zamrożony. Samodzielne słowo „table” w definicji
    // dokłada regułę `.table{display:table}` do CSS każdego czytelnika.
    const RISKY =
      /\b(table|contents|isolate|collapse|invisible|italic|ordinal|grow|shrink|sticky|truncate|filter|transform|static)\b/;
    const texts = [
      ...HUB_METRIC_IDS.flatMap((id) => {
        const m = metricById(id);
        return [
          m.labelPl,
          m.labelEn,
          m.definitionPl,
          m.definitionEn,
          ...m.guards,
          ...m.bindings.flatMap((b) => [b.field, b.formula]),
        ];
      }),
      ...HUB_STREAMS.flatMap((s) => [s.labelPl, s.labelEn, s.store, s.producer, ...s.caveats]),
    ];
    expect(texts.filter((t) => RISKY.test(t))).toEqual([]);
  });
});

describe("metryki huba - słownik i18n", () => {
  it("ziarno, bramka i deduplikacja każdego strumienia huba mają klucz w PL i EN", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const s of HUB_STREAMS) {
        for (const key of [
          `adminAnalytics.semantic.consentGate.${s.consentGate}`,
          `adminAnalytics.semantic.identityGrain.${s.identityGrain}`,
          `adminAnalytics.semantic.dedupe.${s.dedupe}`,
        ]) {
          expect(i18n.exists(key, { lng: lang }), `${lang}/${key}`).toBe(true);
        }
      }
      // Ziarno CRM nie jest ziarnem strumienia, ale niosą je bindingi CRM.
      expect(i18n.exists("adminAnalytics.semantic.identityGrain.crm_contact", { lng: lang })).toBe(
        true,
      );
    }
  });

  it("każda jednostka rejestru ma etykietę w PL i EN, różną między językami tam, gdzie to słowo", () => {
    const units = new Set(METRICS.map((m) => m.unit));
    expect([...units].sort()).toEqual([
      "count",
      "days",
      "hours",
      "milliseconds",
      "money_minor",
      "months",
      "multiple",
      "ratio",
      "score",
    ]);
    for (const unit of units) {
      const key = `adminAnalytics.semantic.dictionary.unit.${unit}`;
      expect(i18n.exists(key, { lng: "pl" }), `pl/${unit}`).toBe(true);
      expect(i18n.exists(key, { lng: "en" }), `en/${unit}`).toBe(true);
    }
    for (const unit of ["money_minor", "months", "multiple", "hours", "days"] as const) {
      const key = `adminAnalytics.semantic.dictionary.unit.${unit}`;
      expect(i18n.getFixedT("pl")(key), unit).not.toBe(i18n.getFixedT("en")(key));
    }
  });
});
