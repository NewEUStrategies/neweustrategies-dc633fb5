// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/przychod.json, docs/benchmarki/2026-10-18/przychod.overlay.json, docs/benchmarki/2026-10-18/ekonomika.json, docs/benchmarki/2026-10-18/ekonomika.overlay.json
// SHA-256 treści kanonicznej wejść: 16f4256751e77afec13b5ffaa8894372f114f199aa0a6feb7139e3f51488acfa
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „revenue” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const REVENUE_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "mrr",
    metricId: "mrr",
    group: "revenue",
    abbr: "MRR",
    name: {
      pl: "Miesięczny przychód powtarzalny",
      en: "Monthly Recurring Revenue",
    },
    expansion: {
      pl: "Monthly Recurring Revenue – miesięczny przychód powtarzalny z aktywnych subskrypcji",
      en: "Monthly Recurring Revenue",
    },
    formula: {
      pl: "MRR = Σ (kwota fakturowana netto, bez VAT, po rabatach za aktywną płatną subskrypcję ÷ liczba miesięcy okresu rozliczeniowego); plan roczny 600 zł = 50 zł MRR; bez opłat jednorazowych (bilety, sponsoring, zlecenia raportów)",
      en: "MRR = Σ (net amount invoiced, excluding VAT, after discounts, for each active paid subscription ÷ number of months in the billing period); an annual plan of PLN 600 = PLN 50 MRR; excluding one-off fees (tickets, sponsorship, commissioned reports)",
    },
    interpretation: {
      pl: "Znormalizowany miesięczny przychód z aktywnych subskrypcji (osoby, firmy/instytucje, studenci/NGO) – baza dla wszystkich wskaźników przychodu. Czytaj go jako trend i w rozbiciu na ruchy: nowy, ekspansja, kontrakcja, churn, reaktywacja; sam poziom kwotowy nie ma uniwersalnego benchmarku. Pułapki: wliczanie biletów na wydarzenia lub całej kwoty planu rocznego w miesiącu zakupu, liczenie triali za 0 zł i pomijanie rabatów czasowych zawyżają MRR.",
      en: "Normalised monthly revenue from active paid subscriptions (individual, corporate/institutional, student/NGO) – the base for every revenue metric. Read it as a trend and decomposed into new, expansion, contraction, churn and reactivation movements; the absolute level has no universal benchmark. Pitfalls: counting event tickets or the full annual-plan payment in the month of purchase, counting free trials and ignoring time-limited discounts all inflate MRR.",
    },
    levers: {
      pl: "Przenoś czytelników z planów miesięcznych na roczne i instytucjonalne (licencje zespołowe z raportami i spotkaniami zamkniętymi). Ogranicz churn mimowolny: ponawianie płatności, aktualizacja kart i przypomnienia przed odnowieniem. Pakietuj wydarzenia i raporty w abonamencie zamiast sprzedawać je jednorazowo - wtedy trafiają do MRR. Planuj MRR w rozbiciu na ruchy (nowy, ekspansja, kontrakcja, churn), aby lukę wobec planu przypisać konkretnej dźwigni.",
      en: "Move readers from monthly to annual and institutional plans (team licences bundled with reports and closed-door meetings). Cut involuntary churn with payment retries, card updates and pre-renewal reminders. Bundle events and reports into the subscription instead of selling them one-off, so that they count towards MRR. Plan MRR by movement (new, expansion, contraction, churn) so that any gap to plan can be traced to a specific lever.",
    },
    caveats: [
      {
        text: {
          pl: "Poziom MRR oceniaj przez dynamikę (wzrost m/m, r/r) i Net New MRR – benchmarki zewnętrzne dotyczą tempa, nie kwoty.",
          en: "Assess the MRR level through its dynamics (MoM and YoY growth) and Net New MRR – external benchmarks concern pace, not amount.",
        },
      },
      {
        text: {
          pl: "Przychody z wydarzeń, sponsoringu i zleceń raportów prezentuj osobno jako przychód niepowtarzalny.",
          en: "Present revenue from events, sponsorship and commissioned reports separately as non-recurring revenue.",
        },
      },
      {
        text: {
          pl: "Raportuj MRR osobno dla B2C, B2B i planów ulgowych (studenci/NGO), aby efekt miksu nie maskował trendów.",
          en: "Report MRR separately for B2C, B2B and reduced-price plans (students/NGOs) so that mix effects do not mask trends.",
        },
      },
      {
        text: {
          pl: "Przedziały realizacji planu to heurystyka – dostosuj je do historycznej trafności własnego budżetowania.",
          en: "The plan-attainment ranges are a heuristic – adjust them to the historical accuracy of your own budgeting.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "mrr.plan_attainment",
        label: {
          pl: "Realizacja planu MRR (MRR rzeczywisty ÷ MRR budżetowany, %) – wszystkie segmenty",
          en: "MRR plan attainment (actual MRR ÷ budgeted MRR, %) – all segments",
        },
        segments: ["all"],
        measure: "attainment_vs_plan",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka – brak zewnętrznych benchmarków poziomu MRR; definicja i normalizacja wg ChartMogul. Okres: miesięcznie.",
          en: "Heuristic – no external benchmarks for the MRR level; definition and normalisation per ChartMogul. Period: monthly.",
        },
        sourceIds: ["chartmogul_mrr_definition"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 85,
            note: {
              pl: "luka >15% – rewizja planu i lejka akwizycji",
              en: "gap >15% – revise the plan and the acquisition funnel",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 85,
            max: 95,
            basis: "E",
          },
          {
            tier: "normal",
            min: 95,
            max: 100,
            basis: "E",
          },
          {
            tier: "good",
            min: 100,
            max: 110,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 110,
            max: null,
            note: {
              pl: "sprawdź, czy nadwyżka nie wynika z wpływów jednorazowych lub złej normalizacji planów rocznych",
              en: "check whether the surplus stems from one-off receipts or incorrect normalisation of annual plans",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "mrr.plan_attainment",
    },
  },
  {
    key: "arr",
    metricId: "arr",
    group: "revenue",
    abbr: "ARR",
    name: {
      pl: "Roczny przychód powtarzalny (run-rate)",
      en: "Annual Recurring Revenue",
    },
    expansion: {
      pl: "Annual Recurring Revenue – roczny przychód powtarzalny w ujęciu run-rate",
      en: "Annual Recurring Revenue (run-rate)",
    },
    formula: {
      pl: "ARR = MRR × 12 (stan na koniec okresu); przedziały dotyczą wzrostu ARR r/r = (ARR_t − ARR_t−12) ÷ ARR_t−12 × 100%",
      en: "ARR = MRR × 12 (as at period end); the ranges concern YoY ARR growth = (ARR_t − ARR_t−12) ÷ ARR_t−12 × 100%",
    },
    interpretation: {
      pl: "Roczna wartość bieżącej bazy powtarzalnej – miara skali i podstawa porównań z benchmarkami wzrostu. Przedziały dotyczą tempa wzrostu ARR r/r, bo to ono różnicuje firmy podobnej wielkości; im mniejsza baza, tym wyższy wymagany wzrost (efekt mianownika). Pułapka: ARR to run-rate, nie przychód księgowy roku – nie dodawaj biletów ani jednorazowych projektów.",
      en: "Annualised value of the current recurring base – a measure of scale and the basis for growth benchmarks. Bands apply to year-over-year ARR growth, because growth differentiates companies of similar size; the smaller the base, the higher the growth required (denominator effect). Pitfall: ARR is a run-rate, not booked annual revenue – never add tickets or one-off projects.",
    },
    levers: {
      pl: "Napędzaj wzrost retencją, nie tylko akwizycją: ARR rośnie szybciej, gdy instytucje odnawiają i rozszerzają licencje. Pozyskuj umowy instytucjonalne (firmy, uczelnie, administracja) z dostępem zespołu do analiz i wydarzeń. Wprowadzaj plany roczne z rabatem zamiast promocji pierwszego miesiąca. Raportuj ARR w stałym kursie i osobno dla B2C i B2B, żeby widzieć, który segment napędza wzrost.",
      en: "Drive growth through retention, not just acquisition: ARR rises faster when institutions renew and extend their licences. Win institutional contracts (companies, universities, public administration) with team access to analysis and events. Offer discounted annual plans instead of first-month promotions. Report ARR at a constant exchange rate and separately for B2C and B2B to see which segment drives growth.",
    },
    caveats: [
      {
        text: {
          pl: "Ogólna mediana wzrostu prywatnych firm B2B SaaS spadła do 22% za 2025 r. (SaaS Capital 2026); kwartyle wg wielkości ARR pochodzą z edycji 2025 (dane za 2024), bo strona edycji 2026 nie publikuje percentyli wg ARR ani PDF – pozostają najnowszymi publicznymi.",
          en: "The overall median growth of private B2B SaaS companies fell to 22% for 2025 (SaaS Capital 2026); quartiles by ARR size come from the 2025 edition (2024 data), because the 2026 edition page publishes neither percentiles by ARR nor a PDF – they remain the latest public ones.",
        },
      },
      {
        text: {
          pl: "Benchmarki SaaS są w USD – porównując wzrost, przeliczaj ARR po stałym kursie, aby wahania PLN/USD nie fałszowały wyniku.",
          en: "SaaS benchmarks are in USD – when comparing growth, convert ARR at a constant exchange rate so that PLN/USD fluctuations do not distort the result.",
        },
      },
      {
        text: {
          pl: "Dla think tanku z przewagą B2C bardziej adekwatne są konteksty niskiego ARPA i mediów niż B2B SaaS.",
          en: "For a think tank with a B2C majority, the low-ARPA and media contexts are more relevant than B2B SaaS.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "arr.b2b_saas_under_1m_usd",
        label: {
          pl: "B2B SaaS prywatne, ARR < 1 mln USD – wzrost ARR r/r (%)",
          en: "Private B2B SaaS, ARR < USD 1m – YoY ARR growth (%)",
        },
        segments: ["b2b_institution"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (SaaS Capital, dane za 2024): P25 20%, P50 40%, P75 100%; wzrost ≤ 0 = krytyczny. Okres: rocznie.",
          en: "Source quartiles (SaaS Capital, 2024 data): P25 20%, P50 40%, P75 100%; growth ≤ 0 = critical. Period: annually.",
        },
        sourceIds: ["saascapital_growth_2025", "saascapital_growth_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            note: {
              pl: "6,9% (2024) i 7,3% (2025) firm w badaniu miało wzrost płaski lub ujemny",
              en: "6.9% (2024) and 7.3% (2025) of surveyed companies had flat or negative growth",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 20,
            basis: "B",
          },
          {
            tier: "normal",
            min: 20,
            max: 40,
            basis: "B",
          },
          {
            tier: "good",
            min: 40,
            max: 100,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 100,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "arr.b2b_saas_1_3m_usd",
        label: {
          pl: "B2B SaaS prywatne, ARR 1–3 mln USD – wzrost ARR r/r (%)",
          en: "Private B2B SaaS, ARR USD 1–3m – YoY ARR growth (%)",
        },
        segments: ["b2b_institution"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (SaaS Capital, dane za 2024): P25 14%, P50 28%, P75 50%. Okres: rocznie.",
          en: "Source quartiles (SaaS Capital, 2024 data): P25 14%, P50 28%, P75 50%. Period: annually.",
        },
        sourceIds: ["saascapital_growth_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 14,
            basis: "B",
          },
          {
            tier: "normal",
            min: 14,
            max: 28,
            basis: "B",
          },
          {
            tier: "good",
            min: 28,
            max: 50,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 50,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "arr.low_arpa_subscriptions",
        label: {
          pl: "Subskrypcje o niskim ARPA (< 25 USD/mies., typowo B2C) – wzrost ARR r/r (%)",
          en: "Low-ARPA subscriptions (< USD 25/month, typically B2C) – YoY ARR growth (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (ChartMogul, LTM do 03.2023): dolny 2%, mediana 24%, górny 70%; dane LTM do 03.2023 – brak nowszych publicznych kwartyli wg ARPA (ChartMogul 2026, S100, to próba selekcjonowana firm rosnących ≥ 20% w 2024: mediana 65% → 28% w 2025 – nie zastępuje kwartyli). Okres: rocznie.",
          en: "Source quartiles (ChartMogul, LTM to 03.2023): lower 2%, median 24%, upper 70%; LTM data to 03.2023 – no newer public quartiles by ARPA (ChartMogul 2026, S100, is a selected sample of companies growing ≥ 20% in 2024: median 65% → 28% in 2025 – it does not replace the quartiles). Period: annually.",
        },
        sourceIds: ["chartmogul_benchmarks_2023", "chartmogul_growth_decay_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 2,
            basis: "B",
          },
          {
            tier: "normal",
            min: 2,
            max: 24,
            basis: "B",
          },
          {
            tier: "good",
            min: 24,
            max: 70,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 70,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "arr.digital_publishers",
        label: {
          pl: "Wydawcy cyfrowi / media subskrypcyjne – wzrost przychodu lub bazy subskrypcji cyfrowych r/r (%)",
          en: "Digital publishers / subscription media – YoY growth in digital subscription revenue or base (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka z punktów odniesienia: Mather (wydawcy prasowi USA, Q2 2025: cyfrowe subskrypcje ok. −6% r/r; nowszy raport Q1 2026 za formularzem – niezweryfikowany), Zuora (+25% subskrybentów w 2 lata; indeks wszystkich branż, nie mediów), NYT/WSJ +13% r/r; próg 20% = ok. 1,5 × NYT/WSJ (heurystyka). Agregat 100k Club (+21%) nie kotwiczy progu – porównuje listy o różnym składzie. Okres: rocznie.",
          en: "Heuristic from reference points: Mather (US newspaper publishers, Q2 2025: digital subscriptions approx. −6% YoY; the newer Q1 2026 report is gated – unverified), Zuora (+25% subscribers over 2 years; an all-industry index, not media), NYT/WSJ +13% YoY; the 20% threshold = approx. 1.5 × NYT/WSJ (heuristic). The 100k Club aggregate (+21%) does not anchor the threshold – it compares lists of different composition. Period: annually.",
        },
        sourceIds: [
          "mather_q2_2025",
          "mather_q1_2026",
          "zuora_sei_2025",
          "pressgazette_100k_club_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -5,
            note: {
              pl: "poziom spadku cyfrowych subskrypcji (Mather: wydawcy prasowi USA, Q2 2025); nowszy raport Mather Q1 2026 (05.2026) jest za formularzem – zweryfikuj",
              en: "level of decline in digital subscriptions (Mather: US newspaper publishers, Q2 2025); the newer Mather Q1 2026 report (05.2026) is gated – verify",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: -5,
            max: 0,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0,
            max: 10,
            note: {
              pl: "ok. 11–12% r/r to średnie tempo przyrostu subskrybentów w indeksie Zuora – indeks obejmuje wszystkie branże, nie media",
              en: "approx. 11–12% YoY is the average subscriber growth rate in the Zuora index – the index covers all industries, not media",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 10,
            max: 20,
            note: {
              pl: "NYT i WSJ: +13% r/r",
              en: "NYT and WSJ: +13% YoY",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 20,
            max: null,
            note: {
              pl: "próg heurystyczny ok. 1,5 × NYT/WSJ (+13% r/r); 100k Club (+21%) to porównanie list o różnym składzie (59 → 62 wydawców) i częściowo nieaktualnych danych – nie jest to wzrost organiczny",
              en: "heuristic threshold approx. 1.5 × NYT/WSJ (+13% YoY); the 100k Club (+21%) compares lists of different composition (59 → 62 publishers) and partly outdated data – this is not organic growth",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "arr.digital_publishers",
      b2c_individual: "arr.digital_publishers",
      b2c_reduced: "arr.digital_publishers",
      b2b_institution: "arr.b2b_saas_under_1m_usd",
    },
  },
  {
    key: "arpa",
    metricId: "arpa",
    group: "revenue",
    abbr: "ARPA",
    name: {
      pl: "Średni przychód na konto (klienta)",
      en: "Average Revenue Per Account",
    },
    expansion: {
      pl: "Average Revenue Per Account – średni miesięczny przychód powtarzalny na jedno konto klienta",
      en: "Average Revenue Per Account",
    },
    formula: {
      pl: "ARPA = MRR ÷ liczba aktywnych płatnych kont na koniec okresu (instytucja z wieloma licencjami = 1 konto); zmiana r/r = (ARPA_t − ARPA_t−12) ÷ ARPA_t−12 × 100%",
      en: "ARPA = MRR ÷ number of active paying accounts at period end (an institution with multiple licences = 1 account); YoY change = (ARPA_t − ARPA_t−12) ÷ ARPA_t−12 × 100%",
    },
    interpretation: {
      pl: "Średni miesięczny przychód na konto, kluczowy w B2B: rosnące ARPA oznacza skuteczny upsell, większe pakiety licencji lub lepszą realizację ceny. Czytaj w podziale na segmenty i razem z medianą – średnią łatwo zawyża kilka dużych instytucji. Pułapka: zmiana miksu (np. napływ tanich kont studenckich) obniża ARPA mimo zdrowego biznesu.",
      en: "Average monthly revenue per account, key in B2B: rising ARPA signals successful upsell, larger seat packages or better price realisation. Read it by segment and alongside the median – a few large institutions easily inflate the mean. Pitfall: mix shifts (e.g. an influx of cheap student accounts) lower ARPA even when the business is healthy.",
    },
    levers: {
      pl: "Sprzedawaj instytucjom pakiety zespołowe zamiast pojedynczych kont i dodawaj do nich wartość: dostęp do raportów, briefingów i spotkań zamkniętych. Wprowadź wyższy próg członkostwa partnerskiego z udziałem w wydarzeniach. Podnoś ceny przy odnowieniu z wyprzedzeniem i uzasadnieniem wartości, a nie skokowo. Analizuj ARPA przy stałym miksie segmentów, aby rosnący udział planów ulgowych nie maskował realnej zmiany cen.",
      en: "Sell institutions team packages instead of single accounts and add value to them: access to reports, briefings and closed-door meetings. Introduce a higher partner-membership tier that includes event participation. Raise prices at renewal with advance notice and a clear value case rather than abruptly. Analyse ARPA at a constant segment mix so that a rising share of reduced-price plans does not mask real price changes.",
    },
    caveats: [
      {
        text: {
          pl: "Niskie ARPA ogranicza potencjał retencji przychodu: tylko 2,7% firm z ARPA < 10 USD/mies. ma NRR > 100%, wobec 41,1% przy ARPA > 500 USD/mies. (ChartMogul).",
          en: "Low ARPA limits the potential for revenue retention: only 2.7% of companies with ARPA < USD 10/month have NRR > 100%, against 41.1% with ARPA > USD 500/month (ChartMogul).",
        },
      },
      {
        text: {
          pl: "ARPA liczy konta, ARPU – użytkowników; w B2B z wieloma licencjami ARPA jest wielokrotnie wyższe od ARPU.",
          en: "ARPA counts accounts, ARPU counts users; in B2B with multiple licences ARPA is several times higher than ARPU.",
        },
      },
      {
        text: {
          pl: "Brak wiarygodnych publicznych benchmarków poziomu ARPA dla członkostw instytucjonalnych think tanków – przedziały dotyczą wyłącznie dynamiki.",
          en: "There are no reliable public benchmarks for the ARPA level of institutional think-tank memberships – the ranges concern dynamics only.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "arpa.b2b_change_yoy",
        label: {
          pl: "B2B – firmy i instytucje: zmiana ARPA r/r (%)",
          en: "B2B – companies and institutions: YoY change in ARPA (%)",
        },
        segments: ["b2b_institution"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka; punkty odniesienia (ChartMogul): ARPA firm, które doszły do 20 mln USD ARR (outliers), +82% (564 → 1 024 USD); u firm, które utknęły między 1 a 20 mln USD (normies), +63%; 72% firm poprawiło ARPA o >10%. SaaS Capital (RB33): sam poziom ACV nie koreluje ze wzrostem – powyżej średniej rosną tylko firmy z ACV > 250 tys. USD (związek rosnącego ACV z szybszym wzrostem pochodzi z osobnej analizy SaaS Capital 'Changing ACVs', niepodpiętej tutaj). Okres: rocznie.",
          en: "Heuristic; reference points (ChartMogul): ARPA of companies that reached USD 20m ARR (outliers) +82% (USD 564 → 1,024); for companies stuck between USD 1m and 20m (normies) +63%; 72% of companies improved ARPA by >10%. SaaS Capital (RB33): the ACV level alone does not correlate with growth – only companies with ACV > USD 250k achieve above-average growth (the link between rising ACV and faster growth comes from a separate SaaS Capital analysis, 'Changing ACVs', not attached here). Period: annually.",
        },
        sourceIds: ["chartmogul_growth_levers_2025", "saascapital_growth_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -10,
            basis: "E",
          },
          {
            tier: "weak",
            min: -10,
            max: 0,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0,
            max: 5,
            basis: "E",
          },
          {
            tier: "good",
            min: 5,
            max: 15,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 15,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "arpa.mixed_change_yoy",
        label: {
          pl: "Mieszany portfel B2C + B2B: zmiana ARPA r/r przy stałym miksie segmentów (%)",
          en: "Mixed B2C + B2B portfolio: YoY change in ARPA at a constant segment mix (%)",
        },
        segments: ["all"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka; punkty odniesienia: standardowe ceny cyfrowe w UK +3% r/r (2026), ARPU NYT +0,7%, Newsquest ok. −8,7%. Okres: rocznie.",
          en: "Heuristic; reference points: standard UK digital prices +3% YoY (2026), NYT ARPU +0.7%, Newsquest approx. −8.7%. Period: annually.",
        },
        sourceIds: ["pressgazette_prices_2026", "pressgazette_100k_club_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -10,
            basis: "E",
          },
          {
            tier: "weak",
            min: -10,
            max: -2,
            basis: "E",
          },
          {
            tier: "normal",
            min: -2,
            max: 3,
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 10,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 10,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "arpa.mixed_change_yoy",
      b2b_institution: "arpa.b2b_change_yoy",
    },
  },
  {
    key: "arpu",
    metricId: "arpu",
    group: "revenue",
    abbr: "ARPU",
    name: {
      pl: "Średni przychód na płacącego użytkownika",
      en: "Average Revenue Per User",
    },
    expansion: {
      pl: "Average Revenue Per User – średni miesięczny przychód na płacącego użytkownika",
      en: "Average Revenue Per User",
    },
    formula: {
      pl: "ARPU = przychód powtarzalny z subskrypcji w okresie ÷ średnia liczba płacących użytkowników w okresie (na miesiąc); wariant medialny ARPU/MAU = przychód ÷ wszyscy aktywni użytkownicy – zawsze oznacz mianownik",
      en: "ARPU = recurring subscription revenue in the period ÷ average number of paying users in the period (per month); media variant ARPU/MAU = revenue ÷ all active users – always label the denominator",
    },
    interpretation: {
      pl: "Średni miesięczny przychód na płacącego użytkownika – mierzy skuteczność cennika i promocji w B2C. Spadek ARPU przy rosnącej bazie zwykle oznacza napływ subskrybentów z głębokimi ofertami wejściowymi, wzrost – wygasanie promocji lub podwyżki. Pułapka: mieszanie mianowników (płacący vs wszyscy zarejestrowani) i porównywanie z rynkami o innej sile nabywczej bez korekty.",
      en: "Average monthly revenue per paying user – measures pricing and promotion effectiveness in B2C. Falling ARPU with a growing base usually means an influx of deeply discounted introductory subscribers; rising ARPU means promotions rolling off or price increases. Pitfall: mixing denominators (paying vs all registered users) and comparing with markets of different purchasing power without adjustment.",
    },
    levers: {
      pl: "Skracaj promocje wejściowe i planuj przejście do pełnej ceny przy pierwszym odnowieniu, z przypomnieniem o otrzymanej wartości. Promuj plany roczne i premium (raporty, spotkania zamknięte, dostęp ekspercki) zamiast głębokich rabatów. Prowadź ceny ulgowe (studenci, NGO) jako osobne plany, aby nie zaniżały ARPU bazowego. Licz ARPU netto i porównuj z pasmami netto - kwoty brutto z cenników B2C wymagają odjęcia VAT.",
      en: "Shorten introductory promotions and plan the move to full price at the first renewal, with a reminder of the value received. Promote annual and premium plans (reports, closed-door meetings, expert access) instead of deep discounts. Keep reduced prices (students, NGOs) as separate plans so that they do not depress core ARPU. Calculate ARPU net and compare it with net bands – gross amounts from B2C price lists require VAT to be deducted.",
    },
    caveats: [
      {
        text: {
          pl: "Przedziały poziomu ARPU to heurystyka z pojedynczych punktów odniesienia – kwartyle INMA są dostępne tylko w płatnym serwisie benchmarkowym.",
          en: "The ARPU level ranges are a heuristic built from individual reference points – INMA quartiles are available only in the paid benchmarking service.",
        },
      },
      {
        text: {
          pl: "Szacunek polski jest niepewny: licznik może obejmować reklamę cyfrową (definicja niezweryfikowana), a mianownik to stan na koniec kwartału.",
          en: "The Polish estimate is uncertain: the numerator may include digital advertising (definition unverified), and the denominator is the end-of-quarter count.",
        },
      },
      {
        text: {
          pl: "W Polsce 78% subskrybentów nie płaci pełnej ceny (DNR 2024), więc ARPU jest naturalnie niższe od cen katalogowych.",
          en: "In Poland 78% of subscribers do not pay the full price (DNR 2024), so ARPU is naturally lower than list prices.",
        },
      },
      {
        text: {
          pl: "Rynek płacących jest w Polsce wąski: za wiadomości online płaci 11% (−2 pp r/r; DNR 2026).",
          en: "The paying market in Poland is narrow: 11% pay for online news (−2 pp YoY; DNR 2026).",
        },
      },
      {
        text: {
          pl: "Polscy wydawcy nie ujawniają ARPU (Agora nie podaje osobno przychodów z prenumerat Wyborczej) – progi w zł to heurystyka oparta na cennikach i badaniach postaw.",
          en: "Polish publishers do not disclose ARPU (Agora does not report Wyborcza subscription revenue separately) – the PLN thresholds are a heuristic based on price lists and attitude surveys.",
        },
      },
      {
        text: {
          pl: "Polska wyróżnia się rabatowaniem: 78% płacących w Polsce nie płaci pełnej ceny wobec 41% średnio w 20 krajach (DNR 2024; dane sprzed ponad 2 lat, nowszego pomiaru brak) – ARPU będzie wyraźnie niższe od cen katalogowych.",
          en: "Poland stands out for discounting: 78% of payers in Poland do not pay the full price against an average of 41% across 20 countries (DNR 2024; data more than 2 years old, no newer measurement) – ARPU will be clearly lower than list prices.",
        },
        sourceIds: ["risj_dnr2024_pay"],
      },
      {
        text: {
          pl: "Za newsy online płaci w Polsce 11% internautów (DNR 2026, −2 pp – zmiana nieistotna statystycznie; 2025: 13%) wobec 17% średnio w 20 krajach; 10–20% to praktyczny sufit w większości rynków.",
          en: "In Poland 11% of internet users pay for online news (DNR 2026, −2 pp – a statistically insignificant change; 2025: 13%) against an average of 17% across 20 countries; 10–20% is a practical ceiling in most markets.",
        },
        sourceIds: ["dnr_2026_poland", "risj_dnr2025_pl", "risj_dnr2026_exec"],
      },
      {
        text: {
          pl: "Europa 2025: średnia cena najtańszego planu 10,08 EUR (CEE 7,84 EUR, Europa Zachodnia 13,01 EUR); plany roczne średnio ok. 22% taniej; ceny wyłącznie katalogowe, bez rabatów.",
          en: "Europe 2025: the average price of the cheapest plan is EUR 10.08 (CEE EUR 7.84, Western Europe EUR 13.01); annual plans are approx. 22% cheaper on average; list prices only, without discounts.",
        },
        sourceIds: ["mfm_pricing_2025"],
      },
      {
        text: {
          pl: "Segmenty studenci/NGO i licencje grupowe licz jako osobne ARPU – 21 na 101 europejskich wydawców ma zniżki studenckie, 35 ma rabaty dla wielu kont (plany firmowe i rodzinne).",
          en: "Count the student/NGO segments and group licences as separate ARPU – 21 of 101 European publishers offer student discounts, 35 offer multi-account discounts (company and family plans).",
        },
        sourceIds: ["mfm_pricing_2025"],
      },
      {
        text: {
          pl: "Kwoty B2C są brutto (jak w cennikach konsumenckich), a LTV i CAC wymagają ARPU netto – w UI pokazuj obie wartości lub przelicznik (netto = brutto ÷ (1 + stawka VAT)), żeby LTV i CAC nie były liczone od kwot z VAT.",
          en: "B2C amounts are gross (as in consumer price lists), while LTV and CAC require net ARPU – show both values or a converter in the UI (net = gross ÷ (1 + VAT rate)), so that LTV and CAC are not calculated from amounts including VAT.",
        },
      },
      {
        text: {
          pl: "Kontekst B2B jest w zł netto, a kotwice (RP.PL, DGP) to ceny brutto ‘od’; kotwicę Chatham House usunięto jako niezweryfikowaną – do zastąpienia sprawdzalnym cennikiem polskiego think tanku lub serwisu eksperckiego.",
          en: "The B2B context is in PLN net, while the anchors (RP.PL, DGP) are gross 'from' prices; the Chatham House anchor was removed as unverified – to be replaced with a verifiable price list of a Polish think tank or expert service.",
        },
      },
      {
        text: {
          pl: "PIE 2021 (badanie z XII 2020) to historyczna kotwica sprzed inflacji 2022–2023 – jej wartości (10/20 zł) nie wyznaczają progów.",
          en: "PIE 2021 (survey from Dec 2020) is a historical anchor from before the 2022–2023 inflation – its values (PLN 10/20) do not set the thresholds.",
        },
        sourceIds: ["pie_2021"],
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "arpu.b2c_media_usd",
        label: {
          pl: "Media cyfrowe B2C, rynki rozwinięte – ARPU na płacącego subskrybenta (USD/mies.)",
          en: "B2C digital media, developed markets – ARPU per paying subscriber (USD/month)",
        },
        segments: ["b2c_individual"],
        measure: "level",
        unit: "money_minor",
        currency: "USD",
        vat: "net",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka z punktów odniesienia: Piano 2026 (6,57–9,69 USD wg okresu planu), NYT 9,72 USD, USA Today Co 10,22 USD, Newsquest 5,67 USD, Mather (12,64 USD plany miesięczne). Okres: miesięcznie.",
          en: "Heuristic from reference points: Piano 2026 (USD 6.57–9.69 by plan term), NYT USD 9.72, USA Today Co USD 10.22, Newsquest USD 5.67, Mather (USD 12.64 monthly plans). Period: monthly.",
        },
        sourceIds: [
          "piano_monthly_annual_2026",
          "pressgazette_100k_club_2026",
          "mather_annual_monthly_2024",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 400,
            basis: "E",
          },
          {
            tier: "weak",
            min: 400,
            max: 600,
            note: {
              pl: "Newsquest 5,67 USD",
              en: "Newsquest USD 5.67",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 600,
            max: 800,
            note: {
              pl: "Piano 2026: 6,57 USD (miesięczne) i 6,62 USD (roczne)",
              en: "Piano 2026: USD 6.57 (monthly) and USD 6.62 (annual)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 800,
            max: 1100,
            note: {
              pl: "NYT 9,72 USD; USA Today Co 10,22 USD",
              en: "NYT USD 9.72; USA Today Co USD 10.22",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 1100,
            max: null,
            note: {
              pl: "Mather: ARPU planów miesięcznych 12,64 USD",
              en: "Mather: ARPU of monthly plans USD 12.64",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "arpu.b2c_media_pl_net",
        label: {
          pl: "Media cyfrowe B2C, Polska – ARPU na płacącego subskrybenta (PLN/mies.)",
          en: "B2C digital media, Poland – ARPU per paying subscriber (PLN/month)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "money_minor",
        currency: "PLN",
        vat: "net",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka; jedyny polski punkt odniesienia: 18,1 mln zł przychodów cyfrowych dziennika w Q3 2025 ÷ 317,6 tys. prenumerat ÷ 3 ≈ 19 zł/mies.; Agora w tym komunikacie nie definiuje przychodów cyfrowych; 78% subskrybentów w PL poniżej pełnej ceny (DNR 2024); kontekst rynkowy: DNR 2026. Okres: miesięcznie.",
          en: "Heuristic; the only Polish reference point: PLN 18.1m of a daily's digital revenue in Q3 2025 ÷ 317.6k subscriptions ÷ 3 ≈ PLN 19/month; Agora does not define digital revenue in this release; 78% of subscribers in PL pay below the full price (DNR 2024); market context: DNR 2026. Period: monthly.",
        },
        sourceIds: ["agora_q3_2025", "risj_dnr2024_pay", "dnr_2026_poland"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 800,
            basis: "E",
          },
          {
            tier: "weak",
            min: 800,
            max: 1200,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1200,
            max: 1800,
            basis: "E",
          },
          {
            tier: "good",
            min: 1800,
            max: 2500,
            note: {
              pl: "obejmuje szacunek ok. 19 zł/mies. dla Gazety Wyborczej (definicja przychodów cyfrowych niezweryfikowana)",
              en: "includes the estimate of approx. PLN 19/month for Gazeta Wyborcza (definition of digital revenue unverified)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 2500,
            max: null,
            note: {
              pl: "realne dla niszowych treści eksperckich z mocną propozycją wartości",
              en: "realistic for niche expert content with a strong value proposition",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "arpu.b2c_change_yoy",
        label: {
          pl: "Zmiana ARPU r/r – B2C (%)",
          en: "YoY change in ARPU – B2C (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka z punktów odniesienia: NYT +0,7%, ceny standardowe UK +3%, Newsquest ok. −8,7%, USA Today Co +27% (Q4). Okres: rocznie.",
          en: "Heuristic from reference points: NYT +0.7%, standard UK prices +3%, Newsquest approx. −8.7%, USA Today Co +27% (Q4). Period: annually.",
        },
        sourceIds: ["pressgazette_100k_club_2026", "pressgazette_prices_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -10,
            basis: "E",
          },
          {
            tier: "weak",
            min: -10,
            max: 0,
            note: {
              pl: "Newsquest ok. −8,7%",
              en: "Newsquest approx. −8.7%",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0,
            max: 5,
            note: {
              pl: "NYT +0,7%; ceny standardowe UK +3%",
              en: "NYT +0.7%; standard UK prices +3%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 5,
            max: 15,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 15,
            max: null,
            note: {
              pl: "USA Today Co +27% w Q4 – efekt wygaszania promocji",
              en: "USA Today Co +27% in Q4 – the effect of phasing out promotions",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "arpu.b2c_media_pl_gross",
        label: {
          pl: "media cyfrowe B2C – indywidualna subskrypcja cyfrowa (Polska), zł brutto/mies. po rabatach",
          en: "B2C digital media – individual digital subscription (Poland), PLN gross/month after discounts",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "money_minor",
        currency: "PLN",
        vat: "gross",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w cenach rynkowych: promocja Wyborcza 89 zł/rok ≈7,4 zł/mies.; RP.PL promo 9,90 zł ‘zamiast 39 zł’ (strona nie wskazuje wprost produktu; ceny ‘od’ mogą dotyczyć planów rocznych); ‘15–20 zł’ jako typowa subskrypcja – opinia eksperta (Wirtualnemedia 2026), nie zmierzona średnia; Radio Nowy Świat ≤ ok. 26,7 zł na osobę (obliczenie własne: prawie 800 tys. zł ÷ ponad 30 tys. osób); średnia cena katalogowa najtańszego planu w CEE 7,84 EUR ≈33 zł (przeliczenie własne ~4,25 PLN/EUR); PIE 2021 (‘uczciwa cena’: dominanta 10 zł, mediana 20 zł; badanie z XII 2020, sprzed inflacji 2022–2023) – wyłącznie historyczna kotwica, nie wyznacza progów. Okres: miesięcznie.",
          en: "Heuristic anchored in market prices: the Wyborcza promotion of PLN 89/year ≈ PLN 7.4/month; RP.PL promo PLN 9.90 'instead of PLN 39' (the page does not name the product explicitly; 'from' prices may apply to annual plans); 'PLN 15–20' as a typical subscription – an expert opinion (Wirtualnemedia 2026), not a measured average; Radio Nowy Swiat ≤ approx. PLN 26.7 per person (own calculation: almost PLN 800k ÷ over 30k people); average list price of the cheapest plan in CEE EUR 7.84 ≈ PLN 33 (own conversion ~4.25 PLN/EUR); PIE 2021 ('fair price': mode PLN 10, median PLN 20; survey from Dec 2020, before the 2022–2023 inflation) – solely a historical anchor, does not set the thresholds. Period: monthly.",
        },
        sourceIds: [
          "wyborcza_blik_2026",
          "rp_offer_2026",
          "pie_2021",
          "wm_anatomia_2026",
          "mfm_pricing_2025",
          "risj_dnr2024_pay",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 800,
            note: {
              pl: "baza zdominowana przez głębokie promocje",
              en: "base dominated by deep promotions",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 800,
            max: 1500,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1500,
            max: 2500,
            note: {
              pl: "15–20 zł – opinia eksperta (Wirtualnemedia 2026), nie zmierzony poziom rynkowy",
              en: "PLN 15–20 – an expert opinion (Wirtualnemedia 2026), not a measured market level",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 2500,
            max: 3500,
            note: {
              pl: "blisko średniej ceny katalogowej w CEE",
              en: "close to the average list price in CEE",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 3500,
            max: null,
            note: {
              pl: "blisko ceny ‘zamiast 39 zł’ RP.PL lub plany premium",
              en: "close to the RP.PL 'instead of PLN 39' price or premium plans",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "arpu.b2b_seat_pl_net",
        label: {
          pl: "B2B / profesjonalne – licencja na stanowisko (seat) lub dostęp ekspercki, zł netto/mies.",
          en: "B2B / professional – per-seat licence or expert access, PLN net/month",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "money_minor",
        currency: "PLN",
        vat: "net",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w cennikach (ceny brutto ‘od’ – mogą dotyczyć planów rocznych przeliczonych na miesiąc): PRO.RP.PL od 39 zł/mies.; e-prenumerata ‘Rzeczpospolitej’ od 174,50 zł/mies.; DGP Premium 196 zł/mies. po pierwszym miesiącu. Kotwicę Chatham House (345 GBP/rok) usunięto – niezweryfikowana (strona zwraca 403) i dotyczy członkostwa indywidualnego, nie licencji na stanowisko. Okres: miesięcznie.",
          en: "Heuristic anchored in price lists (gross 'from' prices – may apply to annual plans converted to a monthly amount): PRO.RP.PL from PLN 39/month; the 'Rzeczpospolita' e-subscription from PLN 174.50/month; DGP Premium PLN 196/month after the first month. The Chatham House anchor (GBP 345/year) was removed – unverified (the page returns 403) and it concerns individual membership, not a per-seat licence. Period: monthly.",
        },
        sourceIds: ["rp_offer_2026", "wm_anatomia_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 4000,
            note: {
              pl: "brak premii B2B ponad cenę konsumencką",
              en: "no B2B premium over the consumer price",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 4000,
            max: 8000,
            basis: "E",
          },
          {
            tier: "normal",
            min: 8000,
            max: 15000,
            basis: "E",
          },
          {
            tier: "good",
            min: 15000,
            max: 25000,
            note: {
              pl: "poziom DGP Premium / e-prenumeraty RP",
              en: "level of DGP Premium / the RP e-subscription",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 25000,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "arpu.b2c_media_pl_net",
      b2c_individual: "arpu.b2c_media_pl_net",
      b2c_reduced: "arpu.b2c_media_pl_net",
      b2b_institution: "arpu.b2b_seat_pl_net",
    },
  },
  {
    key: "mrr_growth_mom",
    metricId: "mrr_growth_mom",
    group: "revenue",
    abbr: "MoM MRR",
    name: {
      pl: "Wzrost MRR miesiąc do miesiąca",
      en: "Month-over-Month MRR Growth",
    },
    expansion: {
      pl: "Month-over-Month MRR growth – miesięczna dynamika przychodu powtarzalnego",
      en: "Month-over-Month Monthly Recurring Revenue growth",
    },
    formula: {
      pl: "Wzrost m/m = (MRR_koniec − MRR_początek) ÷ MRR_początek × 100%; trend: CMGR = (MRR_t ÷ MRR_t−n)^(1/n) − 1; ekwiwalent miesięczny wzrostu rocznego g = (1+g)^(1/12) − 1",
      en: "MoM growth = (MRR_end − MRR_start) ÷ MRR_start × 100%; trend: CMGR = (MRR_t ÷ MRR_t−n)^(1/n) − 1; monthly equivalent of annual growth g = (1+g)^(1/12) − 1",
    },
    interpretation: {
      pl: "Tempo zmiany bazy przychodu powtarzalnego miesiąc do miesiąca. Pojedynczy miesiąc jest zaszumiony (sezonowość, odnowienia roczne, kampanie), dlatego oceniaj średnią z 3 miesięcy (CMGR). Pułapka: porównywanie z wartościami rocznymi bez procentu składanego – 2% m/m to ok. 27% r/r, nie 24%.",
      en: "Month-over-month rate of change of the recurring revenue base. A single month is noisy (seasonality, annual renewals, campaigns), so judge the 3-month compounded average (CMGR). Pitfall: comparing with annual figures without compounding – 2% MoM is about 27% YoY, not 24%.",
    },
    levers: {
      pl: "Planuj kampanie akwizycyjne na pierwszy kwartał, gdy popyt jest najwyższy, a w czwartym stawiaj na odnowienia i ekspansję. Wiąż sprzedaż subskrypcji z kalendarzem wydarzeń i premier raportów, które dają naturalne szczyty zainteresowania. Mierz CMGR ze średniej trzech miesięcy, żeby pojedyncza umowa instytucjonalna nie fałszowała trendu. Oddzielaj wzrost z nowych klientów od ekspansji i reaktywacji.",
      en: "Schedule acquisition campaigns for the first quarter, when demand peaks, and focus on renewals and expansion in the fourth. Tie subscription sales to the calendar of events and report launches, which create natural peaks of interest. Measure CMGR as a three-month average so that a single institutional contract does not distort the trend. Separate growth from new customers from expansion and reactivation.",
    },
    caveats: [
      {
        text: {
          pl: "Sezonowość: Q1 jest najsilniejszy dla akwizycji, Q4 najsłabszy (ChartMogul Billing Report 2025) – porównuj także r/r.",
          en: "Seasonality: Q1 is the strongest quarter for acquisition, Q4 the weakest (ChartMogul Billing Report 2025) – compare YoY as well.",
        },
      },
      {
        text: {
          pl: "Wzrost m/m naturalnie spada ze skalą: u firm, które doszły do 20 mln USD ARR (outliers ChartMogul), z 16,7% przy 1 mln USD do 5,1% przy 20 mln USD; normies przy 1 mln USD: 8,7% m/m (ChartMogul Growth Levers).",
          en: "MoM growth naturally declines with scale: for companies that reached USD 20m ARR (ChartMogul outliers), from 16.7% at USD 1m to 5.1% at USD 20m; normies at USD 1m: 8.7% MoM (ChartMogul Growth Levers).",
        },
      },
      {
        text: {
          pl: "Przy małej bazie pojedyncza umowa instytucjonalna zmienia wynik o kilka punktów procentowych.",
          en: "With a small base, a single institutional contract moves the result by several percentage points.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "mrr_growth_mom.b2b_saas_under_1m_usd",
        label: {
          pl: "B2B SaaS prywatne, ARR < 1 mln USD (% m/m)",
          en: "Private B2B SaaS, ARR < USD 1m (% MoM)",
        },
        segments: ["b2b_institution"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month_avg3",
        direction: "higher",
        method: {
          pl: "kwartyle SaaS Capital r/r (P25 20%, P50 40%, P75 100%) przeliczone na ekwiwalent miesięczny: 1,53% / 2,84% / 5,95%. Okres: miesięcznie (średnia 3-miesięczna).",
          en: "SaaS Capital YoY quartiles (P25 20%, P50 40%, P75 100%) converted to a monthly equivalent: 1.53% / 2.84% / 5.95%. Period: monthly (3-month average).",
        },
        sourceIds: ["saascapital_growth_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 1.5,
            basis: "B",
          },
          {
            tier: "normal",
            min: 1.5,
            max: 2.8,
            basis: "B",
          },
          {
            tier: "good",
            min: 2.8,
            max: 6,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 6,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "mrr_growth_mom.b2b_saas_1_3m_usd",
        label: {
          pl: "B2B SaaS prywatne, ARR 1–3 mln USD (% m/m)",
          en: "Private B2B SaaS, ARR USD 1–3m (% MoM)",
        },
        segments: ["b2b_institution"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month_avg3",
        direction: "higher",
        method: {
          pl: "kwartyle SaaS Capital r/r (14% / 28% / 50%) przeliczone: 1,10% / 2,08% / 3,44% m/m. Okres: miesięcznie (średnia 3-miesięczna).",
          en: "SaaS Capital YoY quartiles (14% / 28% / 50%) converted: 1.10% / 2.08% / 3.44% MoM. Period: monthly (3-month average).",
        },
        sourceIds: ["saascapital_growth_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 1.1,
            basis: "B",
          },
          {
            tier: "normal",
            min: 1.1,
            max: 2.1,
            basis: "B",
          },
          {
            tier: "good",
            min: 2.1,
            max: 3.4,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 3.4,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "mrr_growth_mom.b2c_low_arpa",
        label: {
          pl: "Subskrypcje B2C, ARPA < 25 USD/mies. (% m/m)",
          en: "B2C subscriptions, ARPA < USD 25/month (% MoM)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month_avg3",
        direction: "higher",
        method: {
          pl: "kwartyle ChartMogul r/r (2% / 24% / 70%) przeliczone: 0,17% / 1,81% / 4,52% m/m; kwartyle pochodzą z 2023 r. (LTM do 03.2023) – brak nowszych publicznych kwartyli wg ARPA (S100 to próba selekcjonowana). Okres: miesięcznie (średnia 3-miesięczna).",
          en: "ChartMogul YoY quartiles (2% / 24% / 70%) converted: 0.17% / 1.81% / 4.52% MoM; the quartiles date from 2023 (LTM to 03.2023) – no newer public quartiles by ARPA (S100 is a selected sample). Period: monthly (3-month average).",
        },
        sourceIds: ["chartmogul_benchmarks_2023", "chartmogul_growth_decay_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 0.17,
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.17,
            max: 1.8,
            basis: "B",
          },
          {
            tier: "good",
            min: 1.8,
            max: 4.5,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 4.5,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "mrr_growth_mom.digital_publishers",
        label: {
          pl: "Wydawcy cyfrowi / media subskrypcyjne (% m/m)",
          en: "Digital publishers / subscription media (% MoM)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month_avg3",
        direction: "higher",
        method: {
          pl: "heurystyka: −5% / 10% / 20% r/r przeliczone na miesiąc (Mather: wydawcy prasowi USA, Q2 2025, cyfrowe −6% r/r; NYT/WSJ +13%; próg 20% ≈ 1,5 × NYT/WSJ – 100k Club +21% to porównanie list o różnym składzie, nie kotwica); nowszy raport Mather Q1 2026 za formularzem – zweryfikuj. Okres: miesięcznie (średnia 3-miesięczna).",
          en: "Heuristic: −5% / 10% / 20% YoY converted to a monthly rate (Mather: US newspaper publishers, Q2 2025, digital −6% YoY; NYT/WSJ +13%; the 20% threshold ≈ 1.5 × NYT/WSJ – the 100k Club +21% compares lists of different composition and is not an anchor); the newer Mather Q1 2026 report is gated – verify. Period: monthly (3-month average).",
        },
        sourceIds: ["mather_q2_2025", "mather_q1_2026", "pressgazette_100k_club_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -0.4,
            basis: "E",
          },
          {
            tier: "weak",
            min: -0.4,
            max: 0,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0,
            max: 0.8,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.8,
            max: 1.5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 1.5,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "mrr_growth_mom.digital_publishers",
      b2c_individual: "mrr_growth_mom.digital_publishers",
      b2c_reduced: "mrr_growth_mom.digital_publishers",
      b2b_institution: "mrr_growth_mom.b2b_saas_under_1m_usd",
    },
  },
  {
    key: "net_new_mrr",
    metricId: "net_new_mrr",
    group: "revenue",
    abbr: "NNMRR",
    name: {
      pl: "Przyrost netto MRR",
      en: "Net New MRR",
    },
    expansion: {
      pl: "Net New MRR – przyrost netto miesięcznego przychodu powtarzalnego po uwzględnieniu utraty",
      en: "Net New Monthly Recurring Revenue",
    },
    formula: {
      pl: "Net New MRR = New MRR + Expansion MRR + Reactivation MRR − Contraction MRR − Churned MRR; względnie: Net New MRR ÷ MRR z początku miesiąca × 100%; efektywność: Net New MRR ÷ (New + Expansion + Reactivation MRR) × 100% = 1 − 1/QR (równość zachodzi, gdy QR zawiera reaktywacje; progi QR ChartMogul liczono bez nich)",
      en: "Net New MRR = New MRR + Expansion MRR + Reactivation MRR − Contraction MRR − Churned MRR; relative: Net New MRR ÷ MRR at the start of the month × 100%; efficiency: Net New MRR ÷ (New + Expansion + Reactivation MRR) × 100% = 1 − 1/QR (the equality holds when QR includes reactivations; the ChartMogul QR thresholds were calculated without them)",
    },
    interpretation: {
      pl: "Bilans przyrostu bazy w złotych: ile MRR faktycznie przybyło po odjęciu utraty. Wartość diagnostyczna leży w rozbiciu – ten sam wynik może wynikać z mocnej akwizycji i dużego churnu albo ze słabej akwizycji i świetnej retencji. Pułapka: raportowanie samej sumy bez składowych oraz liczenie zmian planów o tej samej cenie (MRR neutralny) jako ekspansji.",
      en: "Net balance of the recurring base in currency: how much MRR was actually added after subtracting losses. Its diagnostic value lies in the decomposition – the same total can come from strong acquisition with heavy churn or weak acquisition with excellent retention. Pitfall: reporting only the total without components, or counting same-price plan switches (neutral MRR) as expansion.",
    },
    levers: {
      pl: "Rozbijaj Net New MRR na ruchy i co miesiąc wskazuj największy ubytek: churn, kontrakcję albo słabą akwizycję. Uruchamiaj kampanię powrotną do byłych subskrybentów w pierwszych tygodniach po rezygnacji, gdy powroty są najczęstsze. Ograniczaj kontrakcję, proponując instytucjom zmianę zakresu licencji zamiast rezygnacji. Porównując efektywność z progami, licz ją bez reaktywacji.",
      en: "Break Net New MRR down into movements and each month identify the biggest drain: churn, contraction or weak acquisition. Run a win-back campaign to former subscribers in the first weeks after cancellation, when returns are most frequent. Limit contraction by offering institutions a change in licence scope instead of cancellation. When comparing efficiency with the thresholds, calculate it without reactivations.",
    },
    caveats: [
      {
        text: {
          pl: "Reaktywacje raportuj osobno. U firm, które doszły do 20 mln USD ARR (outliers ChartMogul), stanowiły 1,7% net-new MRR przy 1 mln USD i 3,8% przy 20 mln USD ARR. Nowsze dane: ChartMogul Winbacks Report (21.04.2026) – mediana winback 7% przy ARR < 500 tys. USD, 9% przy 0,5–10 mln USD; 45% powrotów w 30 dni, 66% w 90 dni. ChartMogul '30-day upsell window' (30.09.2026) – 2,67% reaktywacji w 1. miesiącu po rezygnacji, > 5% w 3 miesiące. Recurly 2026 – w B2C ok. 1 na 4 nowe zapisy to powracający subskrybenci. Wysoki udział reaktywacji w B2C jest więc normalny i nie musi być sygnałem alarmowym.",
          en: "Report reactivations separately. For companies that reached USD 20m ARR (ChartMogul outliers), they accounted for 1.7% of net-new MRR at USD 1m and 3.8% at USD 20m ARR. Newer data: ChartMogul Winbacks Report (21.04.2026) – median winback 7% at ARR < USD 500k, 9% at USD 0.5–10m; 45% of returns within 30 days, 66% within 90 days. ChartMogul '30-day upsell window' (30.09.2026) – 2.67% reactivation in the 1st month after cancellation, > 5% within 3 months. Recurly 2026 – in B2C approx. 1 in 4 new sign-ups is a returning subscriber. A high share of reactivations in B2C is therefore normal and need not be a warning sign.",
        },
      },
      {
        text: {
          pl: "Przy planach rocznych churn ujawnia się skokowo w miesiącach odnowień – oceniaj sumy 3- lub 12-miesięczne.",
          en: "With annual plans, churn appears in steps in renewal months – assess 3- or 12-month totals.",
        },
      },
      {
        text: {
          pl: "Klasyfikację ruchów (new/expansion/contraction/churn/reactivation/neutral) stosuj zgodnie z definicją ChartMogul, inaczej porównania z benchmarkami są niemiarodajne.",
          en: "Classify movements (new/expansion/contraction/churn/reactivation/neutral) in line with the ChartMogul definition; otherwise comparisons with benchmarks are unreliable.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "net_new_mrr.early_stage_share",
        label: {
          pl: "Wczesny etap subskrypcji, ARR < 300 tys. USD – Net New MRR jako % MRR z początku miesiąca",
          en: "Early-stage subscription business, ARR < USD 300k – Net New MRR as % of MRR at the start of the month",
        },
        segments: ["all"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month_avg3",
        direction: "higher",
        method: {
          pl: "kwartyle ChartMogul r/r (LTM do 03.2023: −5% / 37% / 153%) przeliczone na miesiąc: −0,43% / 2,66% / 8,04%; granica słaby/normalny (1%) heurystyczna. Okres: miesięcznie (średnia 3-miesięczna).",
          en: "ChartMogul YoY quartiles (LTM to 03.2023: −5% / 37% / 153%) converted to a monthly rate: −0.43% / 2.66% / 8.04%; the weak/normal boundary (1%) is heuristic. Period: monthly (3-month average).",
        },
        sourceIds: ["chartmogul_benchmarks_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: -0.43,
            note: {
              pl: "poniżej dolnego kwartyla – baza się kurczy",
              en: "below the lower quartile – the base is contracting",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: -0.43,
            max: 1,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1,
            max: 2.66,
            basis: "E",
          },
          {
            tier: "good",
            min: 2.66,
            max: 8,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 8,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "net_new_mrr.growth_efficiency",
        label: {
          pl: "Efektywność wzrostu – Net New MRR ÷ brutto pozyskany MRR (%) – wszystkie segmenty",
          en: "Growth efficiency – Net New MRR ÷ gross acquired MRR (%) – all segments",
        },
        segments: ["all"],
        measure: "ratio_of_flows",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "przeliczenie progów SaaS Quick Ratio wg ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki) wzorem 1 − 1/QR; progi QR ChartMogul liczono BEZ Reactivation MRR, więc efektywność z reaktywacją w mianowniku nie jest w pełni porównywalna – do porównań z progami licz wariant bez reaktywacji; skala reaktywacji: S101–S103 (zob. zastrzeżenia). Okres: kwartalnie.",
          en: "Conversion of the ChartMogul SaaS Quick Ratio thresholds (<2 low, 2–4 average, ≥4 high) using 1 − 1/QR; the ChartMogul QR thresholds were calculated WITHOUT Reactivation MRR, so efficiency with reactivation in the denominator is not fully comparable – for comparisons with the thresholds use the variant without reactivation; scale of reactivation: S101–S103 (see caveats). Period: quarterly.",
        },
        sourceIds: [
          "chartmogul_quick_ratio_2016",
          "chartmogul_saas_winbacks_2026",
          "growthunhinged_upsell_window_2026",
          "recurly_state_of_subscriptions_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            note: {
              pl: "utrata większa niż pozyskanie (QR < 1)",
              en: "losses exceed acquisition (QR < 1)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0,
            max: 30,
            note: {
              pl: "QR ok. 1–1,4",
              en: "QR approx. 1–1.4",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 50,
            note: {
              pl: "QR 1,4–2",
              en: "QR 1.4–2",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 50,
            max: 75,
            note: {
              pl: "QR 2–4",
              en: "QR from 2 to 4",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 75,
            max: null,
            note: {
              pl: "QR > 4",
              en: "QR > 4",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "net_new_mrr.growth_efficiency",
    },
  },
  {
    key: "saas_quick_ratio",
    metricId: "saas_quick_ratio",
    group: "revenue",
    abbr: "QR",
    name: {
      pl: "Wskaźnik szybkości wzrostu SaaS (Quick Ratio)",
      en: "SaaS Quick Ratio",
    },
    expansion: {
      pl: "SaaS Quick Ratio – stosunek pozyskanego MRR do utraconego MRR (nie mylić z księgowym wskaźnikiem płynności szybkiej)",
      en: "SaaS Quick Ratio (growth efficiency, not the accounting acid-test ratio)",
    },
    formula: {
      pl: "QR = (New MRR + Expansion MRR [+ Reactivation MRR]) ÷ (Churned MRR + Contraction MRR); progi ChartMogul (< 2, 2–4, ≥ 4) liczono BEZ Reactivation MRR – jeśli panel dodaje reaktywacje do licznika, do porównań z progami pokazuj wariant zgodny z definicją ChartMogul (bez reaktywacji); przy zerowej utracie wynik nieokreślony – pokazuj 'n/d'",
      en: "QR = (New MRR + Expansion MRR [+ Reactivation MRR]) ÷ (Churned MRR + Contraction MRR); the ChartMogul thresholds (< 2, 2–4, ≥ 4) were calculated WITHOUT Reactivation MRR – if the dashboard adds reactivations to the numerator, show the variant consistent with the ChartMogul definition (without reactivations) for comparisons with the thresholds; with zero losses the result is undefined – show 'n/a'",
    },
    interpretation: {
      pl: "Ile złotych nowego MRR przypada na każdy utracony złoty – mierzy jakość wzrostu, nie jego skalę. Wartość 4 to klasyczny próg zdrowego wzrostu młodej firmy B2B, ale wysoki wzrost potrafi maskować churn: przy QR = 4 i wzroście 15% m/m churn może sięgać 5% miesięcznie. Pułapka: QR z jednego miesiąca przy rocznych odnowieniach skacze – używaj okna kwartalnego lub rocznego.",
      en: "How many units of new MRR are gained per unit lost – measures growth quality, not scale. A value of 4 is the classic threshold for healthy growth in a young B2B company, but fast growth can mask churn: with QR = 4 and 15% monthly growth, churn can still be 5% per month. Pitfall: a single-month QR jumps around with annual renewals – use a quarterly or annual window.",
    },
    levers: {
      pl: "Podnoś licznik: łącz akwizycję z ekspansją (przejście na plan instytucjonalny, dodatkowe licencje, pakiety wydarzeń). Obniżaj mianownik: odzyskuj nieudane płatności i zatrzymuj rezygnujących uczciwą propozycją pauzy albo tańszego planu. Czytaj QR zawsze razem z churnem brutto - wysoki QR przy wysokim churnie oznacza kosztowną wymianę bazy. Z progami porównuj wariant bez reaktywacji.",
      en: "Raise the numerator: combine acquisition with expansion (moves to an institutional plan, additional licences, event packages). Lower the denominator: recover failed payments and retain those cancelling with a fair offer of a pause or a cheaper plan. Always read QR together with gross churn – a high QR with high churn means costly turnover of the base. Compare the variant without reactivations with the thresholds.",
    },
    caveats: [
      {
        text: {
          pl: "Brak publicznych kwartyli QR z badań pierwotnych; krążące w sieci 'mediany' (np. 2,5) pochodzą z nieweryfikowalnych agregatorów.",
          en: "There are no public QR quartiles from primary research; the 'medians' circulating online (e.g. 2.5) come from unverifiable aggregators.",
        },
      },
      {
        text: {
          pl: "W pierwszym roku działania wskaźnik jest mało informatywny (ChartMogul).",
          en: "In the first year of operation the ratio is of little informative value (ChartMogul).",
        },
      },
      {
        text: {
          pl: "Zawsze pokazuj obok QR churn brutto – ten sam QR może oznaczać 1% albo 6% churnu miesięcznie (Tunguz).",
          en: "Always show gross churn next to QR – the same QR can mean 1% or 6% monthly churn (Tunguz).",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "saas_quick_ratio.b2b_quarterly",
        label: {
          pl: "B2B SaaS / subskrypcje firm i instytucji (okno kwartalne)",
          en: "B2B SaaS / company and institutional subscriptions (quarterly window)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "multiple",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "progi ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki; definicja bez Reactivation MRR) i próg 4 jako poziom inwestycyjny (parafraza stanowiska M. Hamida we wpisie ChartMogul); kontrola: przy wzroście ok. 20% r/r i GRR ok. 90% (KeyBanc/Sapphire 2025) QR ≈ 1 + 0,20/0,10 = 3 – 20% to prognoza KeyBanc/Sapphire na 2025, nie wynik; przy wyniku za 2024 (15%) QR ≈ 2,5. Okres: kwartalnie.",
          en: "ChartMogul thresholds (<2 low, 2–4 average, ≥4 high; definition without Reactivation MRR) and 4 as the investment-grade threshold (paraphrase of M. Hamid's position in the ChartMogul post); check: with growth of approx. 20% YoY and GRR of approx. 90% (KeyBanc/Sapphire 2025), QR ≈ 1 + 0.20/0.10 = 3 – 20% is the KeyBanc/Sapphire forecast for 2025, not an actual; with the 2024 actual (15%), QR ≈ 2.5. Period: quarterly.",
        },
        sourceIds: [
          "chartmogul_quick_ratio_2016",
          "tunguz_quick_ratio_2015",
          "keybanc_sapphire_2025_survey",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "baza się kurczy",
              en: "the base is contracting",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 1,
            max: 2,
            basis: "B",
          },
          {
            tier: "normal",
            min: 2,
            max: 4,
            basis: "B",
          },
          {
            tier: "good",
            min: 4,
            max: 6,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 6,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "saas_quick_ratio.b2c_annual",
        label: {
          pl: "B2C subskrypcje / media cyfrowe (okno roczne)",
          en: "B2C subscriptions / digital media (annual window)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "multiple",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka wyprowadzona ze wzoru QR = 1 + wzrost ÷ utrata: przy rocznej utracie 35–45% przychodu (dane Piano: 12-miesięczna przeżywalność 34% planów miesięcznych i 70% rocznych) i wzroście 10–20% r/r QR ≈ 1,2–1,6. Okres: rocznie.",
          en: "Heuristic derived from the formula QR = 1 + growth ÷ loss: with an annual revenue loss of 35–45% (Piano data: 12-month survival of 34% of monthly plans and 70% of annual plans) and growth of 10–20% YoY, QR ≈ 1.2–1.6. Period: annually.",
        },
        sourceIds: [
          "ftstrategies_monthly_subscribers_2024",
          "piano_monthly_annual_2026",
          "pressgazette_100k_club_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 1.2,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.2,
            max: 1.5,
            basis: "E",
          },
          {
            tier: "good",
            min: 1.5,
            max: 2,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 2,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "saas_quick_ratio.b2c_annual",
      b2c_individual: "saas_quick_ratio.b2c_annual",
      b2c_reduced: "saas_quick_ratio.b2c_annual",
      b2b_institution: "saas_quick_ratio.b2b_quarterly",
    },
  },
  {
    key: "expansion_share_new_mrr",
    metricId: "expansion_share_new_mrr",
    group: "revenue",
    abbr: "EXP %",
    name: {
      pl: "Udział ekspansji w nowym MRR",
      en: "Expansion Share of New MRR",
    },
    expansion: {
      pl: "Expansion share – udział przychodu z rozszerzeń u obecnych klientów w całym pozyskanym MRR",
      en: "Expansion MRR share of total new MRR",
    },
    formula: {
      pl: "Udział ekspansji = Expansion MRR ÷ (New MRR + Expansion MRR [+ Reactivation MRR]) × 100% w okresie (Benchmarkit: Expansion ARR ÷ Total New ARR)",
      en: "Expansion share = Expansion MRR ÷ (New MRR + Expansion MRR [+ Reactivation MRR]) × 100% in the period (Benchmarkit: Expansion ARR ÷ Total New ARR)",
    },
    interpretation: {
      pl: "Jaka część nowego przychodu pochodzi od istniejących klientów (wyższy plan, więcej licencji instytucjonalnych, dodatki, przejście z planu indywidualnego na firmowy). Rośnie naturalnie ze skalą i szerokością oferty; zbyt niski oznacza brak ścieżki rozwoju klienta, zbyt wysoki – słabnącą akwizycję nowych. Pułapka: liczenie zmiany z planu miesięcznego na roczny o tej samej wartości miesięcznej jako ekspansji.",
      en: "Share of new revenue coming from existing customers (higher tier, more institutional seats, add-ons, moving from individual to corporate plans). It rises naturally with scale and product breadth; too low means no customer growth path, too high means weakening new-customer acquisition. Pitfall: counting a monthly-to-annual switch at the same monthly value as expansion.",
    },
    levers: {
      pl: "Zbuduj ścieżkę ekspansji: od konta indywidualnego do planu zespołowego i członkostwa instytucjonalnego z wydarzeniami. Proponuj zmianę planu przy odnowieniu rocznym, gdy takie decyzje zapadają najczęściej. Dodaj płatne rozszerzenia: raporty na zamówienie, briefingi, miejsca na spotkaniach zamkniętych. Gdy udział ekspansji jest bardzo wysoki, sprawdź akwizycję nowych klientów, zanim baza się wyczerpie.",
      en: "Build an expansion path: from an individual account to a team plan and institutional membership with events. Offer plan upgrades at annual renewal, when such decisions are most often made. Add paid extensions: commissioned reports, briefings, seats at closed-door meetings. When the expansion share is very high, check new-customer acquisition before the base is exhausted.",
    },
    caveats: [
      {
        text: {
          pl: "Starsze dane ChartMogul (2023): ekspansja stanowiła 32,3% pozyskanego ARR w firmach 1–30 mln USD ARR (28,8% w 2020).",
          en: "Older ChartMogul data (2023): expansion accounted for 32.3% of acquired ARR at companies with USD 1–30m ARR (28.8% in 2020).",
        },
      },
      {
        text: {
          pl: "Tylko 2,7% firm z ARPA < 10 USD/mies. ma NRR > 100% (ChartMogul) – w B2C nie oczekuj poziomów B2B.",
          en: "Only 2.7% of companies with ARPA < USD 10/month have NRR > 100% (ChartMogul) – do not expect B2B levels in B2C.",
        },
      },
      {
        text: {
          pl: "Pełne dane KeyBanc/Sapphire 2025 o podziale nowy/ekspansja są dostępne po rejestracji – nieuwzględnione liczbowo.",
          en: "Full KeyBanc/Sapphire 2025 data on the new/expansion split is available after registration – not included numerically.",
        },
      },
    ],
    direction: "range",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "expansion_share_new_mrr.b2b_saas",
        label: {
          pl: "B2B SaaS ogółem (%)",
          en: "B2B SaaS overall (%)",
        },
        segments: ["b2b_institution"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "year",
        direction: "range",
        method: {
          pl: "mediana Benchmarkit 2025 (40%, N=81; 25% w 2022) + heurystyka zakresu docelowego. Okres: rocznie.",
          en: "Benchmarkit 2025 median (40%, N=81; 25% in 2022) + target-range heuristic. Period: annually.",
        },
        sourceIds: ["bm2025", "maxio_benchmark_trends_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 10,
            basis: "E",
          },
          {
            tier: "weak",
            min: 10,
            max: 25,
            note: {
              pl: "poniżej mediany z 2022 r. (25%)",
              en: "below the 2022 median (25%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 25,
            max: 40,
            basis: "B",
          },
          {
            tier: "good",
            min: 40,
            max: 55,
            note: {
              pl: "mediana 2024: 40%",
              en: "2024 median: 40%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 55,
            max: 70,
            note: {
              pl: "poziom firm 50–100 mln USD ARR (58%) i >100 mln USD (67% – kohorta tylko 6 firm, statystycznie słaba; Benchmarkit); mediana ogółem 40% pochodzi z N = 81",
              en: "level of companies with USD 50–100m ARR (58%) and >USD 100m (67% – a cohort of only 6 companies, statistically weak; Benchmarkit); the overall median of 40% comes from N = 81",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 70,
            max: 100,
            note: {
              pl: "ryzyko zależności od bazy – sprawdź akwizycję nowych klientów",
              en: "risk of dependence on the existing base – check acquisition of new customers",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "expansion_share_new_mrr.small_subscription_1m_arr",
        label: {
          pl: "Mała firma subskrypcyjna, ok. 1 mln USD ARR (%)",
          en: "Small subscription business, approx. USD 1m ARR (%)",
        },
        segments: ["all"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "ltm",
        direction: "range",
        method: {
          pl: "heurystyka wokół punktów ChartMogul dla firm, które później doszły do 20 mln USD ARR (outliers): 15,4% przy 1 mln USD ARR i 34,7% przy 20 mln USD ARR; okres kroczący 12 mies., bo ok. 40% upgrade'ów planu w 1. roku następuje przy odnowieniu w 12. miesiącu (ChartMogul/Growth Unhinged 2026) – okno kwartalne byłoby skokowe. Okres: kroczące 12 miesięcy.",
          en: "Heuristic around ChartMogul points for companies that later reached USD 20m ARR (outliers): 15.4% at USD 1m ARR and 34.7% at USD 20m ARR; rolling 12-month period, because approx. 40% of plan upgrades in the 1st year happen at renewal in the 12th month (ChartMogul/Growth Unhinged 2026) – a quarterly window would jump in steps. Period: rolling 12 months.",
        },
        sourceIds: [
          "chartmogul_growth_levers_2025",
          "chartmogul_benchmarks_2023",
          "growthunhinged_upsell_window_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 5,
            basis: "E",
          },
          {
            tier: "weak",
            min: 5,
            max: 10,
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 15,
            basis: "E",
          },
          {
            tier: "good",
            min: 15,
            max: 25,
            note: {
              pl: "outliers (firmy, które później doszły do 20 mln USD ARR) przy 1 mln USD ARR: 15,4%",
              en: "outliers (companies that later reached USD 20m ARR) at USD 1m ARR: 15.4%",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 25,
            max: 40,
            note: {
              pl: "outliers przy 20 mln USD ARR: 34,7%",
              en: "outliers at USD 20m ARR: 34.7%",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 40,
            max: 100,
            note: {
              pl: "na tym etapie zwykle sygnał słabej akwizycji",
              en: "at this stage usually a sign of weak acquisition",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "expansion_share_new_mrr.media_b2c",
        label: {
          pl: "Media / B2C (upgrade planu, dodatki, przejście na plan instytucjonalny) (%)",
          en: "Media / B2C (plan upgrades, add-ons, switching to an institutional plan) (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "ltm",
        direction: "range",
        method: {
          pl: "heurystyka – brak publicznych benchmarków dla wydawców; uzasadnienie: w B2C o niskim ARPA ekspansja jest strukturalnie mała; okres kroczący 12 mies., bo upgrade'y kumulują się przy odnowieniu rocznym (ChartMogul/Growth Unhinged 2026: ok. 40% upgrade'ów w 1. roku w 12. miesiącu). Okres: kroczące 12 miesięcy.",
          en: "Heuristic – no public benchmarks for publishers; rationale: in low-ARPA B2C expansion is structurally small; rolling 12-month period, because upgrades accumulate at annual renewal (ChartMogul/Growth Unhinged 2026: approx. 40% of 1st-year upgrades in the 12th month). Period: rolling 12 months.",
        },
        sourceIds: ["chartmogul_retention_insights_2023", "growthunhinged_upsell_window_2026"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 2,
            note: {
              pl: "brak ścieżki ekspansji w ofercie",
              en: "no expansion path in the offer",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 2,
            max: 5,
            basis: "E",
          },
          {
            tier: "normal",
            min: 5,
            max: 10,
            basis: "E",
          },
          {
            tier: "good",
            min: 10,
            max: 20,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 20,
            max: 40,
            basis: "E",
          },
          {
            tier: "normal",
            min: 40,
            max: 100,
            note: {
              pl: "sprawdź, czy akwizycja nowych subskrybentów nie zamiera",
              en: "check whether acquisition of new subscribers is stalling",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "expansion_share_new_mrr.small_subscription_1m_arr",
      b2c_individual: "expansion_share_new_mrr.media_b2c",
      b2c_reduced: "expansion_share_new_mrr.media_b2c",
      b2b_institution: "expansion_share_new_mrr.b2b_saas",
    },
  },
  {
    key: "price_realization",
    metricId: "price_realization",
    group: "revenue",
    abbr: "PR",
    name: {
      pl: "Realizacja ceny",
      en: "Price Realization",
    },
    expansion: {
      pl: "Price Realization – odsetek ceny katalogowej faktycznie zrealizowany w przychodzie",
      en: "Price Realization",
    },
    formula: {
      pl: "PR = Σ przychód zafakturowany netto (po rabatach, kuponach, promocjach) ÷ Σ przychód według cennika katalogowego dla tych samych planów i okresów × 100%; wariant: realizacja podwyżki = faktyczny wzrost średniej ceny ÷ planowany wzrost × 100%",
      en: "PR = Σ net invoiced revenue (after discounts, coupons, promotions) ÷ Σ revenue at list prices for the same plans and periods × 100%; variant: price-increase realisation = actual increase in the average price ÷ planned increase × 100%",
    },
    interpretation: {
      pl: "Jaki procent ceny katalogowej faktycznie trafia do firmy – syntetyczna miara wycieku przez rabaty, oferty wejściowe i negocjacje. Spadek przy rosnącej sprzedaży oznacza kupowanie wolumenu ceną; rozbijaj na segmenty i kohorty (oferta wejściowa vs odnowienie po pełnej cenie). Pułapka: porównywanie z cennikiem sztucznie zawyżonym lub pomijanie rabatu za płatność roczną.",
      en: "Share of the list price that actually reaches the company – a summary measure of leakage through discounts, introductory offers and negotiation. A decline while sales grow means buying volume with price; break it down by segment and cohort (introductory offer vs full-price renewal). Pitfall: benchmarking against an artificially inflated list price or ignoring the annual-prepay discount.",
    },
    levers: {
      pl: "Ogranicz czas i zasięg promocji wejściowych, a przejście do pełnej ceny zapowiadaj z wyprzedzeniem. W umowach instytucjonalnych zastępuj rabaty dodatkową wartością (więcej licencji, udział w wydarzeniach) i ustal próg zgody na rabat. Podwyżki wprowadzaj stopniowo, przy odnowieniu i z uzasadnieniem wartości, mierząc churn po zmianie. Ceny ulgowe (studenci, NGO) traktuj jako osobne plany, nie jako rabat.",
      en: "Limit the duration and reach of introductory promotions and announce the move to full price in advance. In institutional contracts, replace discounts with added value (more licences, event participation) and set an approval threshold for discounts. Introduce price increases gradually, at renewal and with a clear value case, tracking churn after the change. Treat reduced prices (students, NGOs) as separate plans, not as a discount.",
    },
    caveats: [
      {
        text: {
          pl: "DNR mierzy odsetek subskrybentów poniżej pełnej ceny, a nie poziom realizacji – przedziały B2C to heurystyka.",
          en: "DNR measures the share of subscribers below the full price, not the realisation level – the B2C ranges are a heuristic.",
        },
      },
      {
        text: {
          pl: "Podwyżki niosą ryzyko churnu: 47% rezygnujących z subskrypcji wskazało podwyżkę ceny jako powód (Zuora/Harris Poll, USA, 2024).",
          en: "Price increases carry a churn risk: 47% of those cancelling a subscription cited a price increase as the reason (Zuora/Harris Poll, USA, 2024).",
        },
      },
      {
        text: {
          pl: "Realizacja zaplanowanej podwyżki (Simon-Kucher) to inna definicja niż realizacja ceny katalogowej – nie mieszaj wariantów na jednym wykresie.",
          en: "Realisation of a planned increase (Simon-Kucher) is a different definition from realisation of the list price – do not mix the variants on one chart.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "price_realization.b2c_media",
        label: {
          pl: "Media cyfrowe B2C (PL/UE) – cała aktywna baza (%)",
          en: "B2C digital media (PL/EU) – entire active base (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka: miks 50/25/25 (50% pełna cena, 25% oferty wejściowe, 25% roczne) cytowany przez Mather za N. Hunshikattim (Mather zastrzega: no one-size-fits-all) daje ok. 72–75% przy rabatach ofert wejściowych rzędu 70–80%, typowych dla UK (S13); przy rabatach wejściowych ok. 50% ten sam miks daje ok. 79–82%; DNR 2024: 78% subskrybentów w Polsce i 41% w 20 krajach poniżej pełnej ceny (deklaracje ankietowe); rabaty 1. roku w UK 17–89%. Okres: miesięcznie.",
          en: "Heuristic: a 50/25/25 mix (50% full price, 25% introductory offers, 25% annual) cited by Mather after N. Hunshikatti (Mather cautions: no one-size-fits-all) gives approx. 72–75% with introductory discounts of about 70–80%, typical of the UK (S13); with introductory discounts of approx. 50% the same mix gives approx. 79–82%; DNR 2024: 78% of subscribers in Poland and 41% across 20 countries below the full price (survey declarations); 1st-year discounts in the UK 17–89%. Period: monthly.",
        },
        sourceIds: ["mather_annual_monthly_2024", "risj_dnr2024_pay", "pressgazette_prices_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 50,
            basis: "E",
          },
          {
            tier: "weak",
            min: 50,
            max: 65,
            note: {
              pl: "np. FT w 1. roku: 279 vs 468 GBP ≈ 60%",
              en: "e.g. FT in year 1: GBP 279 vs 468 ≈ 60%",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 65,
            max: 75,
            basis: "E",
          },
          {
            tier: "good",
            min: 75,
            max: 85,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 85,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "price_realization.b2b_contracts",
        label: {
          pl: "B2B – umowy z firmami i instytucjami (%)",
          en: "B2B – contracts with companies and institutions (%)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "heurystyka z punktów odniesienia: średni rabat ok. 10% (Vendr wg SaaStr, dane z 2023 r., definicja rabatu niepodana; typowo 10–15%) i 33,8% od cennika w korporacyjnych zakupach oprogramowania (Vertice, Q2 2026). Okres: kwartalnie.",
          en: "Heuristic from reference points: an average discount of approx. 10% (Vendr via SaaStr, 2023 data, discount definition not given; typically 10–15%) and 33.8% off list price in corporate software purchasing (Vertice, Q2 2026). Period: quarterly.",
        },
        sourceIds: ["saastr_vendr_discount_2023", "vertice_list_discount_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 65,
            note: {
              pl: "gorzej niż średnia korporacyjnych zakupów IT (−33,8%)",
              en: "worse than the average for corporate IT purchasing (−33.8%)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 65,
            max: 80,
            basis: "E",
          },
          {
            tier: "normal",
            min: 80,
            max: 88,
            basis: "E",
          },
          {
            tier: "good",
            min: 88,
            max: 95,
            note: {
              pl: "odpowiada typowemu rabatowi 10–15%",
              en: "corresponds to a typical discount of 10–15%",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 95,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "price_realization.price_increase",
        label: {
          pl: "Realizacja planowanej podwyżki cen – dowolny segment (%)",
          en: "Realisation of a planned price increase – any segment (%)",
        },
        segments: ["all"],
        measure: "attainment_vs_plan",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia źródła (Simon-Kucher 2025: 43%, spadek o 5 pp w 2 lata) ± heurystyka. Okres: na kampanię cenową.",
          en: "Source average (Simon-Kucher 2025: 43%, down 5 pp in 2 years) ± heuristic. Period: per pricing campaign.",
        },
        sourceIds: ["simonkucher_pricing_study_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 20,
            basis: "E",
          },
          {
            tier: "weak",
            min: 20,
            max: 35,
            basis: "E",
          },
          {
            tier: "normal",
            min: 35,
            max: 50,
            note: {
              pl: "średnia globalna 43%",
              en: "global average 43%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 50,
            max: 70,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 70,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "price_realization.b2c_media",
      b2c_individual: "price_realization.b2c_media",
      b2c_reduced: "price_realization.b2c_media",
      b2b_institution: "price_realization.b2b_contracts",
    },
  },
  {
    key: "average_discount",
    metricId: "average_discount",
    group: "revenue",
    abbr: "ADD",
    name: {
      pl: "Średni rabat (głębokość rabatu)",
      en: "Average Discount Depth",
    },
    expansion: {
      pl: "Average Discount Depth – średnia głębokość rabatu w transakcjach objętych rabatem lub kuponem",
      en: "Average Discount Depth",
    },
    formula: {
      pl: "ADD = Σ (cena katalogowa − cena zapłacona) ÷ Σ cena katalogowa, dla transakcji z rabatem lub kuponem w okresie × 100%; osobno: penetracja rabatów = transakcje z rabatem ÷ wszystkie transakcje × 100%",
      en: "ADD = Σ (list price − price paid) ÷ Σ list price, for transactions with a discount or coupon in the period × 100%; separately: discount penetration = discounted transactions ÷ all transactions × 100%",
    },
    interpretation: {
      pl: "Jak głęboko obniżamy cenę, gdy już dajemy rabat. Głębokie rabaty wejściowe przyspieszają akwizycję, ale przyciągają klientów o niższej wartości: na danych gazety i internetowego sklepu spożywczego (Lewis 2006) rabat akwizycyjny 35% dawał klientów o ok. połowę niższej wartości długoterminowej. Pułapka: uśrednianie strukturalnego rabatu za płatność roczną z promocjami i ignorowanie penetracji – 10% dla wszystkich kosztuje więcej niż 50% dla nielicznych.",
      en: "How deep the price cut is when a discount is granted. Deep introductory discounts speed up acquisition but attract lower-value customers: in newspaper and online grocery data (Lewis 2006) a 35% acquisition discount produced customers worth about half as much over the long term. Pitfall: averaging the structural annual-prepay discount with promotions and ignoring penetration – 10% for everyone costs more than 50% for a few.",
    },
    levers: {
      pl: "Zastępuj głębokie rabaty procentowe krótszym okresem próbnym albo dodatkową wartością (raport, udział w wydarzeniu). Ustal w zespole sprzedaży progi zgody na rabat w umowach instytucjonalnych i raportuj ich wykorzystanie. Rabat za płatność roczną komunikuj jako liczbę miesięcy gratis i testuj jego wysokość, obserwując udział planów rocznych. Ceny dla studentów i NGO prowadź jako osobne plany.",
      en: "Replace deep percentage discounts with a shorter trial period or added value (a report, participation in an event). Set discount approval thresholds for institutional contracts in the sales team and report how they are used. Present the annual-payment discount as a number of free months and test its size while watching the share of annual plans. Run prices for students and NGOs as separate plans.",
    },
    caveats: [
      {
        text: {
          pl: "Mediany rabatów kuponowych Recurly (badanie z 2017 r.) są niesprawdzalne – URL nie zawiera badania – i nie kotwiczą przedziałów; nowszy raport Recurly 2026 nie publikuje danych o rabatach kuponowych.",
          en: "Recurly coupon-discount medians (2017 study) are unverifiable – the URL does not contain the study – and do not anchor the ranges; the newer Recurly 2026 report publishes no data on coupon discounts.",
        },
        sourceIds: ["recurly_acquisition_2017"],
      },
      {
        text: {
          pl: "SaaStr nie podaje definicji rabatu Vendr (dane z 2023 r.); Vertice mierzy rabat od cennika (Q2 2026).",
          en: "SaaStr does not give the definition of the Vendr discount (2023 data); Vertice measures the discount from list price (Q2 2026).",
        },
        sourceIds: ["saastr_vendr_discount_2023", "vertice_list_discount_2026"],
      },
      {
        text: {
          pl: "Ceny dla studentów/NGO raportuj jako osobne plany cenowe, nie jako rabat promocyjny.",
          en: "Report prices for students/NGOs as separate price plans, not as a promotional discount.",
        },
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "average_discount.b2c_intro_offers",
        label: {
          pl: "Oferty wejściowe B2C – media i subskrypcje indywidualne (%)",
          en: "B2C introductory offers – media and individual subscriptions (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "heurystyka: Lewis 2006 (rabat 35% ≈ połowa wartości klienta) oraz rabaty 1. roku wydawców UK 17–89% (dziesięć tytułów ≥ 70%, 2026); mediany kuponowe Recurly (2017) odpięte – źródło niesprawdzalne. Okres: na kampanię / miesięcznie.",
          en: "Heuristic: Lewis 2006 (a 35% discount ≈ half of customer value) and UK publishers' 1st-year discounts of 17–89% (ten titles ≥ 70%, 2026); Recurly coupon medians (2017) detached – source unverifiable. Period: per campaign / monthly.",
        },
        sourceIds: ["lewis_jmr_2006", "pressgazette_prices_2026"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 15,
            basis: "E",
          },
          {
            tier: "good",
            min: 15,
            max: 25,
            basis: "E",
          },
          {
            tier: "normal",
            min: 25,
            max: 35,
            note: {
              pl: "heurystyka między rabatami 17–89% wydawców UK (S13) a progiem 35% z badania Lewisa (S21)",
              en: "heuristic between the 17–89% discounts of UK publishers (S13) and the 35% threshold from Lewis's study (S21)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 35,
            max: 50,
            note: {
              pl: "≥35%: ok. połowa wartości długoterminowej klienta",
              en: "≥35%: approx. half of long-term customer value",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 50,
            max: null,
            note: {
              pl: "duzi wydawcy UK dają 70–89%, ale przy masowej skali i silnej marce",
              en: "large UK publishers give 70–89%, but at mass scale and with a strong brand",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "average_discount.b2b_negotiated",
        label: {
          pl: "B2B – rabaty negocjowane dla firm i instytucji (%)",
          en: "B2B – negotiated discounts for companies and institutions (%)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "lower",
        method: {
          pl: "heurystyka z punktów odniesienia: ok. 10% (Vendr wg SaaStr, dane z 2023 r., definicja rabatu niepodana; typowo 10–15%) i 33,8% od cennika w korporacyjnych zakupach IT (Vertice, Q2 2026). Okres: kwartalnie.",
          en: "Heuristic from reference points: approx. 10% (Vendr via SaaStr, 2023 data, discount definition not given; typically 10–15%) and 33.8% off list price in corporate IT purchasing (Vertice, Q2 2026). Period: quarterly.",
        },
        sourceIds: ["saastr_vendr_discount_2023", "vertice_list_discount_2026"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 5,
            basis: "E",
          },
          {
            tier: "good",
            min: 5,
            max: 12,
            note: {
              pl: "typowo 10–15% (SaaStr/Vendr, dane z 2023 r.)",
              en: "typically 10–15% (SaaStr/Vendr, 2023 data)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 12,
            max: 20,
            basis: "E",
          },
          {
            tier: "weak",
            min: 20,
            max: 30,
            basis: "E",
          },
          {
            tier: "critical",
            min: 30,
            max: null,
            note: {
              pl: "poziom korporacyjnych działów zakupów (33,8%)",
              en: "level of corporate procurement departments (33.8%)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "average_discount.annual_prepay",
        label: {
          pl: "Rabat za płatność roczną – strukturalny (%)",
          en: "Discount for annual payment – structural (%)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "snapshot",
        direction: "lower",
        method: {
          pl: "heurystyka z przykładów: 'Save 20%' (ChartMogul) i pogłębiony rabat roczny 33% (FT Strategies). Okres: przy zmianie cennika.",
          en: "Heuristic from examples: 'Save 20%' (ChartMogul) and a deepened annual discount of 33% (FT Strategies). Period: when the price list changes.",
        },
        sourceIds: [
          "chartmogul_billing_2025",
          "ftstrategies_monthly_subscribers_2024",
          "piano_monthly_annual_2026",
        ],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 17,
            note: {
              pl: "≈ 2 miesiące gratis; jeśli udział planów rocznych spada, rozważ wyższy rabat. TechCrunch po obniżce ceny planu rocznego (150 → 99 USD – obniżka ceny planu, nie rabat względem 12 × ceny miesięcznej) podwoił konwersję na plan roczny i zwiększył przychód z planów rocznych o 28% (Piano 2026)",
              en: "≈ 2 months free; if the share of annual plans is falling, consider a higher discount. After cutting the price of its annual plan (USD 150 → 99 – a cut in the plan price, not a discount against 12 × the monthly price), TechCrunch doubled conversion to the annual plan and increased revenue from annual plans by 28% (Piano 2026)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 17,
            max: 25,
            note: {
              pl: "typowe 'Save 20%'",
              en: "typical 'Save 20%'",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 25,
            max: 33,
            note: {
              pl: "przykład pogłębionego rabatu rocznego 33% (FT Strategies)",
              en: "example of a deepened annual discount of 33% (FT Strategies)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 33,
            max: 40,
            basis: "E",
          },
          {
            tier: "critical",
            min: 40,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "average_discount.b2c_intro_offers",
      b2c_individual: "average_discount.b2c_intro_offers",
      b2c_reduced: "average_discount.b2c_intro_offers",
      b2b_institution: "average_discount.b2b_negotiated",
    },
  },
  {
    key: "coupon_redemption_rate",
    metricId: "coupon_redemption_rate",
    group: "revenue",
    abbr: "CpRR",
    name: {
      pl: "Wskaźnik realizacji kuponów",
      en: "Coupon Redemption Rate",
    },
    expansion: {
      pl: "Coupon Redemption Rate – odsetek wydanych kodów rabatowych wykorzystanych przy zakupie",
      en: "Coupon Redemption Rate",
    },
    formula: {
      pl: "CpRR = liczba wykorzystanych kodów ÷ liczba wydanych (doręczonych) kodów × 100%, w kohorcie kampanii i stałym oknie (np. 30 dni); uzupełniająco: udział zamówień z kuponem",
      en: "CpRR = number of codes redeemed ÷ number of codes issued (delivered) × 100%, within the campaign cohort and a fixed window (e.g. 30 days); supplementary: share of orders with a coupon",
    },
    interpretation: {
      pl: "Jaka część rozesłanych kodów rabatowych zamienia się w zakup – miara trafności oferty i kanału. Kody spersonalizowane (win-back, oferta B2B, uczestnicy wydarzeń) powinny realizować się kilkukrotnie lepiej niż kody masowe. Pułapka: wysoka realizacja kodu publicznego może oznaczać wyciek do serwisów kuponowych i kanibalizację sprzedaży po pełnej cenie.",
      en: "Share of distributed discount codes that turn into a purchase – a measure of offer and channel fit. Personalised codes (win-back, B2B offers, event attendees) should redeem several times better than mass codes. Pitfall: high redemption of a public code may signal leakage to coupon sites and cannibalisation of full-price sales.",
    },
    levers: {
      pl: "Kieruj kody do segmentów z wysoką intencją: czytelników, którzy trafili na paywall, uczestników wydarzeń i byłych subskrybentów. Personalizuj kody 1:1 dla instytucji i poleceń zamiast publikować kod publiczny. Ustaw krótki termin ważności i przypomnienie przed wygaśnięciem. Mierz też przychód netto i retencję po kuponie, a nie tylko samo wykorzystanie.",
      en: "Target codes at high-intent segments: readers who hit the paywall, event participants and former subscribers. Personalise 1:1 codes for institutions and referrals instead of publishing a public code. Set a short validity period and send a reminder before expiry. Also measure net revenue and retention after the coupon, not just redemption itself.",
    },
    caveats: [
      {
        text: {
          pl: "Źródła to materiały dostawców, nie niezależne badania – Yotpo sam zaznacza, że zakresy są orientacyjne, a najlepszym punktem odniesienia jest własna historia.",
          en: "The sources are vendor materials, not independent research – Yotpo itself notes that the ranges are indicative and that your own history is the best reference point.",
        },
      },
      {
        text: {
          pl: "Zakresy Yotpo pochodzą z kontekstu e-commerce, nie subskrypcji – w subskrypcjach traktuj je kierunkowo.",
          en: "The Yotpo ranges come from an e-commerce context, not subscriptions – treat them as directional for subscriptions.",
        },
      },
      {
        text: {
          pl: "Dla porównania: w masowej dystrybucji kuponów CPG w USA wykorzystano 1,3% wydanych kuponów (Inmar, 2024).",
          en: "For comparison: in mass CPG coupon distribution in the USA, 1.3% of issued coupons were redeemed (Inmar, 2024).",
        },
        sourceIds: ["inmar_coupons_2025"],
      },
      {
        text: {
          pl: "W mianowniku licz także kody wygasłe; w przeciwnym razie wskaźnik jest zawyżony. Skrót CpRR celowo odróżnia od CRR (Customer Retention Rate).",
          en: "Include expired codes in the denominator; otherwise the rate is overstated. The abbreviation CpRR deliberately distinguishes it from CRR (Customer Retention Rate).",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "coupon_redemption_rate.mass_email",
        label: {
          pl: "Kupony w e-mailu masowym / newsletterze (%)",
          en: "Coupons in mass email / newsletter (%)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "typowy zakres źródła 1–5% (Yotpo) podzielony heurystycznie. Okres: na kampanię.",
          en: "Typical source range of 1–5% (Yotpo) split heuristically. Period: per campaign.",
        },
        sourceIds: ["yotpo_redemption_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.5,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.5,
            max: 1,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1,
            max: 3,
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 5,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "coupon_redemption_rate.on_site",
        label: {
          pl: "Kupony on-site (pop-up, paywall, exit intent) (%)",
          en: "On-site coupons (pop-up, paywall, exit intent) (%)",
        },
        segments: ["paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "zakres źródła 2–10% (Yotpo) podzielony heurystycznie. Okres: na kampanię.",
          en: "Source range of 2–10% (Yotpo) split heuristically. Period: per campaign.",
        },
        sourceIds: ["yotpo_redemption_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 2,
            basis: "E",
          },
          {
            tier: "normal",
            min: 2,
            max: 5,
            basis: "E",
          },
          {
            tier: "good",
            min: 5,
            max: 10,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 10,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "coupon_redemption_rate.personal_codes",
        label: {
          pl: "Kody spersonalizowane 1:1 (win-back, oferty B2B, polecenia, program lojalnościowy) (%)",
          en: "Personalised 1:1 codes (win-back, B2B offers, referrals, loyalty programme) (%)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "zakresy źródła: polecenia 5–20%, SMS 5–15%, programy lojalnościowe 10–30%+ (Yotpo) + heurystyka. Okres: na kampanię.",
          en: "Source ranges: referrals 5–20%, SMS 5–15%, loyalty programmes 10–30%+ (Yotpo) + heuristic. Period: per campaign.",
        },
        sourceIds: ["yotpo_redemption_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 3,
            basis: "E",
          },
          {
            tier: "weak",
            min: 3,
            max: 5,
            basis: "E",
          },
          {
            tier: "normal",
            min: 5,
            max: 10,
            basis: "E",
          },
          {
            tier: "good",
            min: 10,
            max: 20,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 20,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "coupon_redemption_rate.mass_email",
      newsletter: "coupon_redemption_rate.mass_email",
      paywall: "coupon_redemption_rate.on_site",
    },
  },
  {
    key: "annual_plan_share",
    metricId: "annual_plan_share",
    group: "revenue",
    abbr: "APS",
    name: {
      pl: "Udział planów rocznych",
      en: "Annual Plan Share",
    },
    expansion: {
      pl: "Annual Plan Share – udział subskrypcji z okresem rozliczeniowym 12 miesięcy lub dłuższym",
      en: "Annual Plan Share",
    },
    formula: {
      pl: "APS = aktywne płatne subskrypcje z okresem rozliczeniowym ≥ 12 mies. ÷ wszystkie aktywne płatne subskrypcje × 100%; wariant przychodowy: MRR z planów ≥ 12 mies. ÷ MRR całkowity × 100%",
      en: "APS = active paid subscriptions with a billing period ≥ 12 months ÷ all active paid subscriptions × 100%; revenue variant: MRR from plans ≥ 12 months ÷ total MRR × 100%",
    },
    interpretation: {
      pl: "Jaka część bazy jest zobowiązana na rok lub dłużej – wskaźnik stabilności przychodu i gotówki z przedpłat. Plany roczne retencjonują znacznie lepiej (Piano: po 4 latach aktywnych 18,0% subskrypcji rocznych vs 4,4% miesięcznych), ale zwykle konwertują wolniej i bywają tańsze. Pułapka: wymuszanie planów rocznych głębokimi rabatami kupuje retencję kosztem realizacji ceny, a na wczesnym etapie zbyt wysoki udział rocznych spowalnia wzrost.",
      en: "Share of the base committed for a year or longer – an indicator of revenue stability and prepaid cash. Annual plans retain far better (Piano: after 4 years 18.0% of annual vs 4.4% of monthly subscriptions remain active) but usually convert more slowly and can be cheaper. Pitfall: pushing annual plans with deep discounts buys retention at the cost of price realisation, and at an early stage too high an annual share slows growth.",
    },
    levers: {
      pl: "Kieruj propozycję przejścia na plan roczny w 2.–4. miesiącu subskrypcji, gdy takich zmian jest najwięcej. Pokazuj oszczędność planu rocznego jako miesiące gratis i dodaj korzyść niecenową, np. pierwszeństwo zapisów na wydarzenia. Instytucjom proponuj umowy roczne z fakturą. Pilnuj górnej granicy: zbyt wysoki udział planów rocznych przy spadającym ARPU może oznaczać zbyt głęboki rabat.",
      en: "Target the offer to switch to an annual plan at months 2–4 of the subscription, when such switches are most common. Present the annual saving as free months and add a non-price benefit, e.g. priority registration for events. Offer institutions annual contracts with an invoice. Watch the upper limit: too high a share of annual plans with falling ARPU may mean the discount is too deep.",
    },
    caveats: [
      {
        text: {
          pl: "Udział wśród nowych subskrypcji jest dużo niższy niż w aktywnej bazie (Mather: 14% nowych subskrypcji to plany roczne, 71% miesięczne) – raportuj oba warianty.",
          en: "The share among new subscriptions is much lower than in the active base (Mather: 14% of new subscriptions are annual plans, 71% monthly) – report both variants.",
        },
      },
      {
        text: {
          pl: "Sprzeczne punkty odniesienia dla ARPU planów rocznych: Recurly 2026 State of Subscriptions podaje, że plany roczne dają 50–60% wyższy przychód na użytkownika, Mather 2024 – ARPU niższe (7,36 vs 12,64 USD), Piano 2026 – zbliżone (6,62 vs 6,57 USD). Wynik zależy od cennika.",
          en: "Conflicting reference points for ARPU of annual plans: Recurly 2026 State of Subscriptions states that annual plans yield 50–60% higher revenue per user, Mather 2024 – lower ARPU (USD 7.36 vs 12.64), Piano 2026 – similar (USD 6.62 vs 6.57). The result depends on the price list.",
        },
      },
      {
        text: {
          pl: "Najwięcej przejść z planu miesięcznego na roczny następuje w 2.–4. miesiącu subskrypcji (ChartMogul) – wtedy kieruj ofertę upgrade'u.",
          en: "Most switches from a monthly to an annual plan happen in months 2–4 of the subscription (ChartMogul) – target the upgrade offer then.",
        },
      },
    ],
    direction: "range",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "annual_plan_share.b2c_media",
        label: {
          pl: "Media cyfrowe B2C – udział w aktywnej bazie subskrybentów (%)",
          en: "B2C digital media – share of the active subscriber base (%)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "month",
        direction: "range",
        method: {
          pl: "średnie źródeł (Piano 2026: 49%, 181 serwisów; FT Strategies: 46%, próba 4 europejskich wydawców prasowych) + heurystyka zakresu docelowego; ARPU planów rocznych vs miesięcznych – sprzeczne punkty odniesienia (Mather 2024, Piano 2026, Recurly 2026), zob. zastrzeżenia. Okres: miesięcznie.",
          en: "Source averages (Piano 2026: 49%, 181 sites; FT Strategies: 46%, a sample of 4 European newspaper publishers) + target-range heuristic; ARPU of annual vs monthly plans – conflicting reference points (Mather 2024, Piano 2026, Recurly 2026), see caveats. Period: monthly.",
        },
        sourceIds: [
          "piano_monthly_annual_2026",
          "ftstrategies_monthly_subscribers_2024",
          "mather_annual_monthly_2024",
          "recurly_state_of_subscriptions_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 15,
            basis: "E",
          },
          {
            tier: "weak",
            min: 15,
            max: 30,
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 40,
            basis: "E",
          },
          {
            tier: "good",
            min: 40,
            max: 45,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 45,
            max: 60,
            note: {
              pl: "Piano 2026: 49% aktywnych i 49% przychodu; FT Strategies: 46% (próba 4 europejskich wydawców prasowych)",
              en: "Piano 2026: 49% of active subscriptions and 49% of revenue; FT Strategies: 46% (a sample of 4 European newspaper publishers)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 60,
            max: 75,
            basis: "E",
          },
          {
            tier: "normal",
            min: 75,
            max: 100,
            note: {
              pl: "sprawdź ARPU i tempo akwizycji",
              en: "check ARPU and the pace of acquisition",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "annual_plan_share.b2b_institutions",
        label: {
          pl: "B2B – firmy i instytucje: udział ARR z planów rocznych (%)",
          en: "B2B – companies and institutions: share of ARR from annual plans (%)",
        },
        segments: ["b2b_institution"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "punkty ChartMogul Billing Report 2025: wzrost stabilizuje się powyżej 25% ARR z planów rocznych (dotyczy firm 1–10 mln USD ARR); przy ARPA ≥ 1 tys. USD 55% ARR z rocznych. Okres: kwartalnie.",
          en: "ChartMogul Billing Report 2025 points: growth stabilises above 25% of ARR from annual plans (applies to companies with USD 1–10m ARR); at ARPA ≥ USD 1k, 55% of ARR is from annual plans. Period: quarterly.",
        },
        sourceIds: ["chartmogul_billing_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 10,
            basis: "E",
          },
          {
            tier: "weak",
            min: 10,
            max: 25,
            basis: "B",
          },
          {
            tier: "normal",
            min: 25,
            max: 45,
            note: {
              pl: "powyżej 25% wzrost się stabilizuje (firmy 1–10 mln USD ARR)",
              en: "growth stabilises above 25% (companies with USD 1–10m ARR)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 45,
            max: 55,
            note: {
              pl: "szczyt 47% przy 3–8 mln USD ARR",
              en: "peak of 47% at USD 3–8m ARR",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 55,
            max: 100,
            note: {
              pl: "ARPA ≥ 1 tys. USD: 55% ARR z planów rocznych; instytucje preferują roczne umowy",
              en: "ARPA ≥ USD 1k: 55% of ARR from annual plans; institutions prefer annual contracts",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "annual_plan_share.early_stage_mix",
        label: {
          pl: "Wczesny etap, ARR < 1 mln USD, miks planów – udział ARR z planów rocznych (%)",
          en: "Early stage, ARR < USD 1m, plan mix – share of ARR from annual plans (%)",
        },
        segments: ["all"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "quarter",
        direction: "range",
        method: {
          pl: "heurystyka na podstawie ChartMogul Billing Report 2025: mediana wzrostu firm < 1 mln USD ARR opartych w 50–75% / ≥ 75% na planach rocznych spadła do 15% / 18%; zdanie 'wzrost stabilizuje się powyżej 25%' ChartMogul odnosi do firm 1–10 mln USD ARR, a w górnym kwartylu firm wczesnego etapu najszybciej rosły te z < 25% ARR z planów rocznych (zakres 25–50% to heurystyczny kompromis między retencją a tempem wzrostu); etykieta 'słaby' dla 0–10% wynika z retencji: przy ARPA < 25 USD retencja klientów 62% (roczne) vs 41% (miesięczne). Okres: kwartalnie.",
          en: "Heuristic based on the ChartMogul Billing Report 2025: median growth of companies < USD 1m ARR relying 50–75% / ≥ 75% on annual plans fell to 15% / 18%; ChartMogul applies the statement 'growth stabilises above 25%' to companies with USD 1–10m ARR, and in the top quartile of early-stage companies those with < 25% of ARR from annual plans grew fastest (the 25–50% range is a heuristic compromise between retention and growth pace); the 'weak' label for 0–10% follows from retention: at ARPA < USD 25, customer retention is 62% (annual) vs 41% (monthly). Period: quarterly.",
        },
        sourceIds: ["chartmogul_billing_2025"],
        bands: [
          {
            tier: "weak",
            min: 0,
            max: 10,
            note: {
              pl: "przy ARPA < 25 USD retencja klientów: 62% (roczne) vs 41% (miesięczne)",
              en: "at ARPA < USD 25, customer retention: 62% (annual) vs 41% (monthly)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 25,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 25,
            max: 50,
            basis: "E",
          },
          {
            tier: "normal",
            min: 50,
            max: 75,
            note: {
              pl: "mediana wzrostu takich firm: 15%",
              en: "median growth of such companies: 15%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 75,
            max: 100,
            note: {
              pl: "mediana wzrostu takich firm: 18%; w górnym kwartylu firm wczesnego etapu najszybciej rosły te z < 25% ARR z planów rocznych",
              en: "median growth of such companies: 18%; in the top quartile of early-stage companies those with < 25% of ARR from annual plans grew fastest",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "annual_plan_share.b2c_media",
      b2c_individual: "annual_plan_share.b2c_media",
      b2c_reduced: "annual_plan_share.b2c_media",
      b2b_institution: "annual_plan_share.b2b_institutions",
    },
  },
];
