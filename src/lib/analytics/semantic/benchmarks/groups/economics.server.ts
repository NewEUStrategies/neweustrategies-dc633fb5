// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/ekonomika.json, docs/benchmarki/2026-10-18/ekonomika.overlay.json
// SHA-256 treści kanonicznej wejść: 31b25b97ed9afa57ad45741daaa2781ad46bd2e13f03fe2683847f4edbe68fd4
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „economics” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const ECONOMICS_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "ltv",
    metricId: "ltv",
    group: "economics",
    abbr: "LTV / CLV",
    name: {
      pl: "Wartość klienta w cyklu życia",
      en: "Customer Lifetime Value",
    },
    expansion: {
      pl: "LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: wartość (na marży brutto), jaką przeciętny płacący klient wnosi przez cały okres relacji",
      en: "LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: the gross-margin value an average paying customer generates over the whole relationship",
    },
    formula: {
      pl: "LTV = ARPU miesięczne (netto, po rabatach) × marża brutto % ÷ miesięczny churn klientów. Wariant B2B (Benchmarkit): (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ roczny churn). Oczekiwany czas życia ≈ 1 ÷ miesięczny churn (Lenfest).",
      en: "LTV = monthly ARPU (net, after discounts) × gross margin % ÷ monthly customer churn. B2B variant (Benchmarkit): (average ARR per account × gross margin of recurring revenue ÷ annual churn). Expected lifetime ≈ 1 ÷ monthly churn (Lenfest).",
    },
    interpretation: {
      pl: "Pokazuje, ile marży brutto przyniesie przeciętny płacący klient przez cały okres subskrypcji – to górna granica tego, ile można wydać na jego pozyskanie i utrzymanie. Licz w kohortach (miesiąc startu, kanał, plan, segment: osoby / instytucje / studenci-NGO) i zawsze na marży, nie na przychodzie. Pułapki: wzór 1/churn przy krótkiej historii i niskim, niestabilnym churnie młodego produktu daje zawyżone LTV, a promocyjne ceny pierwszego okresu zniekształcają ARPU – dlatego czytaj LTV razem z CAC (LTV/CAC).",
      en: "Shows how much gross margin an average paying customer generates over the subscription lifetime – the ceiling for what you can spend to acquire and retain them. Compute it by cohort (start month, channel, plan, segment: individuals / institutions / students-NGOs) and always on margin, not revenue. Pitfalls: the 1/churn shortcut inflates LTV when churn history is short and unstable, and introductory prices distort ARPU – so read LTV together with CAC (LTV/CAC).",
    },
    levers: {
      pl: "LTV rośnie przede wszystkim dzięki dłuższemu życiu klienta: wzmacniaj retencję pierwszych miesięcy i przenoś czytelników na plany roczne. Podnoś ARPU wartością - pakiety z raportami, wydarzeniami i dostępem eksperckim. Chroń marżę: ograniczaj prowizje pośredników i koszty płatności. Licz LTV od ARPU netto i skracaj horyzont dla młodych kohort, aby nie zawyżać wyniku.",
      en: "LTV rises above all through a longer customer lifetime: strengthen retention in the first months and move readers to annual plans. Raise ARPU through value – packages with reports, events and expert access. Protect the margin: limit intermediary commissions and payment costs. Calculate LTV from net ARPU and cap the horizon for young cohorts so as not to overstate the result.",
    },
    caveats: [
      {
        text: {
          pl: "Brak publicznych, aktualnych benchmarków LTV dla polskich wydawców cyfrowych; progi to heurystyka – krotność miesięcznej marży brutto z klienta m (8/17/33/50 × m). Kwoty w zł podano dla m ≈ 15 zł; przy innym m przelicz progi tą samą krotnością.",
          en: "There are no public, current LTV benchmarks for Polish digital publishers; the thresholds are a heuristic – a multiple of the monthly gross margin per customer m (8/17/33/50 × m). Amounts in PLN are given for m ≈ PLN 15; for a different m, convert the thresholds using the same multiple.",
        },
      },
      {
        text: {
          pl: "Punkt odniesienia (stary, USA): Lenfest Institute 2019 – wydawca z 80. percentyla (dziennik z aktywną sprzedażą subskrypcji) miał CLV ok. 217 USD na subskrybenta cyfrowego; CLV Lenfest liczone jest na PRZYCHODZIE (ARPU × czas życia), nie na marży brutto – nie porównuj go wprost z progami LTV na marży.",
          en: "Reference point (old, USA): Lenfest Institute 2019 – a publisher at the 80th percentile (a daily with active subscription sales) had a CLV of approx. USD 217 per digital subscriber; Lenfest CLV is calculated on REVENUE (ARPU × lifetime), not on gross margin – do not compare it directly with the margin-based LTV thresholds.",
        },
      },
      {
        text: {
          pl: "Dla kohort z historią <12 mies. ogranicz horyzont LTV (np. do 24–36 mies.), bo wzór 1/churn ekstrapoluje zbyt optymistycznie.",
          en: "For cohorts with a history of <12 months, cap the LTV horizon (e.g. at 24–36 months), because the 1/churn formula extrapolates too optimistically.",
        },
      },
      {
        text: {
          pl: "Segment B2B (licencje instytucjonalne) oceniaj przez LTV/CAC i CAC payback, nie przez progi w zł – wartości kontraktów są zbyt zróżnicowane.",
          en: "Assess the B2B segment (institutional licences) through LTV/CAC and CAC payback, not through PLN thresholds – contract values vary too widely.",
        },
      },
      {
        text: {
          pl: "Licz osobno dla planów miesięcznych i rocznych oraz dla taryf studenckich/NGO, inaczej średnia ukryje problem.",
          en: "Calculate separately for monthly and annual plans and for student/NGO rates; otherwise the average will hide the problem.",
        },
      },
      {
        text: {
          pl: "Licz LTV od ARPU netto (bez VAT), nie od cen brutto z cenników B2C; przy stawce 23% 20 zł brutto to ok. 16,3 zł netto (m ≈ 13,8 zł przy marży 85%) – wtedy przelicz progi krotnością m.",
          en: "Calculate LTV from net ARPU (excluding VAT), not from gross prices in B2C price lists; at a 23% rate, PLN 20 gross is approx. PLN 16.3 net (m ≈ PLN 13.8 at an 85% margin) – then convert the thresholds by the multiple of m.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "ltv.b2c_media_pl",
        label: {
          pl: "media cyfrowe B2C – indywidualna subskrypcja treści eksperckich (Polska), LTV na marży brutto w zł",
          en: "B2C digital media – individual subscription to expert content (Poland), LTV on gross margin in PLN",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "money_minor",
        currency: "PLN",
        vat: "net",
        window: "per_customer",
        direction: "higher",
        method: {
          pl: "heurystyka: progi jako krotność miesięcznej marży brutto z klienta m (krotność = oczekiwany czas życia w mies.): krytyczny <8×m (churn >12,5%/mies.), słaby 8–17×m, normalny 17–33×m, dobry 33–50×m, optymalny >50×m (churn <2%/mies.); kwoty w zł dla m ≈ 15 zł netto (założenie: ARPU netto ok. 17–18 zł, tj. ok. 20 zł brutto po odjęciu VAT, × marża ≈85%). ARPU liczone netto, bez VAT; realne ARPU może być niższe od opinii ‘15–20 zł’, bo 78% płacących w Polsce nie płaci pełnej ceny (DNR 2024). Okres: na klienta (cały cykl życia).",
          en: "Heuristic: thresholds as a multiple of the monthly gross margin per customer m (multiple = expected lifetime in months): critical <8×m (churn >12.5%/month), weak 8–17×m, normal 17–33×m, good 33–50×m, optimal >50×m (churn <2%/month); amounts in PLN for m ≈ PLN 15 net (assumption: net ARPU approx. PLN 17–18, i.e. approx. PLN 20 gross after deducting VAT, × margin ≈85%). ARPU calculated net, excluding VAT; real ARPU may be lower than the 'PLN 15–20' opinion, because 78% of payers in Poland do not pay the full price (DNR 2024). Period: per customer (entire lifecycle).",
        },
        sourceIds: ["wm_anatomia_2026", "risj_dnr2024_pay", "lenfest_2019", "stripe_pl_pricing"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 12000,
            note: {
              pl: "<8×m – churn >12,5%/mies., klient zostaje średnio <8 mies.",
              en: "<8×m – churn >12.5%/month, the customer stays <8 months on average",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 12000,
            max: 25000,
            note: {
              pl: "8–17×m – churn ~6–12,5%/mies.",
              en: "8–17×m – churn ~6–12.5%/month",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 25000,
            max: 50000,
            note: {
              pl: "17–33×m – churn ~3–6%/mies.",
              en: "17–33×m – churn ~3–6%/month",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 50000,
            max: 75000,
            note: {
              pl: "33–50×m – churn ~2–3%/mies.",
              en: "33–50×m – churn ~2–3%/month",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 75000,
            max: null,
            note: {
              pl: ">50×m – churn <2%/mies. lub wyraźnie wyższe ARPU (plany roczne/premium)",
              en: ">50×m – churn <2%/month or a clearly higher ARPU (annual/premium plans)",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "ltv.b2c_media_pl",
      b2c_individual: "ltv.b2c_media_pl",
      b2c_reduced: "ltv.b2c_media_pl",
    },
  },
  {
    key: "cac",
    metricId: "cac",
    group: "economics",
    abbr: "CAC",
    name: {
      pl: "Koszt pozyskania klienta",
      en: "Customer Acquisition Cost",
    },
    expansion: {
      pl: "CAC – Customer Acquisition Cost: średni koszt sprzedaży i marketingu poniesiony na pozyskanie jednego nowego płacącego klienta",
      en: "CAC – Customer Acquisition Cost: average sales and marketing cost incurred to win one new paying customer",
    },
    formula: {
      pl: "CAC = (koszty marketingu i sprzedaży przypisane do pozyskania w okresie: media płatne, kampanie, narzędzia, wynagrodzenia zespołu proporcjonalnie, prowizje partnerów) ÷ liczba nowych płacących klientów w tym samym okresie. Warianty: blended (wszyscy nowi płacący, także organiczni) i paid (tylko z kanałów płatnych).",
      en: "CAC = (marketing and sales costs attributed to acquisition in the period: paid media, campaigns, tools, a proportional share of team salaries, partner commissions) ÷ number of new paying customers in the same period. Variants: blended (all new payers, including organic) and paid (paid channels only).",
    },
    interpretation: {
      pl: "Mówi, ile kosztuje zdobycie jednego nowego płacącego subskrybenta lub instytucji; sam w sobie nie mówi, czy to drogo – trzeba go odnieść do ARPU i marży (CAC payback, LTV/CAC). Licz osobno per kanał (newsletter, wydarzenia, social, płatne media, partnerzy) i per segment. Pułapki: pomijanie wynagrodzeń i narzędzi (zaniża CAC), liczenie przejść z darmowego triala jako ‘organicznych’ oraz mieszanie okresów (koszty z kwartału, konwersje z miesiąca).",
      en: "Tells you how much it costs to win one new paying subscriber or institution; on its own it does not say whether that is expensive – relate it to ARPU and margin (CAC payback, LTV/CAC). Track it per channel (newsletter, events, social, paid media, partners) and per segment. Pitfalls: leaving out salaries and tools (understates CAC), counting trial conversions as ‘organic’, and mismatching periods (costs per quarter, conversions per month).",
    },
    levers: {
      pl: "Obniżaj CAC kanałami własnymi: newsletter, otwarte wydarzenia i webinary jako wejście do subskrypcji, polecenia od obecnych członków. Mierz CAC osobno dla kanałów płatnych i organicznych, a budżet przesuwaj do kanałów o najkrótszym zwrocie. Poprawiaj konwersję na paywallu i w checkoucie, zanim zwiększysz wydatki na reklamę. Księguj rabaty i okresy próbne konsekwentnie.",
      en: "Lower CAC with owned channels: the newsletter, open events and webinars as an entry point to the subscription, and referrals from current members. Measure CAC separately for paid and organic channels and shift budget to the channels with the shortest payback. Improve conversion at the paywall and checkout before increasing advertising spend. Account for discounts and trial periods consistently.",
    },
    caveats: [
      {
        text: {
          pl: "Brak wiarygodnych, publicznych benchmarków CAC dla wydawców w PLN; progi są pochodną ARPU netto i marży – przy innym ARPU przelicz je wzorem CAC = miesiące zwrotu × ARPU netto (bez VAT) × marża.",
          en: "There are no reliable public CAC benchmarks for publishers in PLN; the thresholds derive from net ARPU and margin – with a different ARPU, recalculate them using CAC = payback months × net ARPU (excluding VAT) × margin.",
        },
      },
      {
        text: {
          pl: "Dla B2B/instytucji używaj znormalizowanych miar: New CAC Ratio (koszt S&M na 1 zł nowego ARR) i CAC payback – absolutny CAC zależy od wartości kontraktu.",
          en: "For B2B/institutions use normalised measures: New CAC Ratio (S&M cost per PLN 1 of new ARR) and CAC payback – absolute CAC depends on contract value.",
        },
      },
      {
        text: {
          pl: "Często cytowany przedział CAC wydawców informacyjnych ok. 40–60 USD (INMA, 2021) nie został zweryfikowany w źródle pierwotnym (strona zwraca 403) – nie używać jako progu.",
          en: "The frequently cited CAC range for news publishers of approx. USD 40–60 (INMA, 2021) has not been verified in the primary source (the page returns 403) – do not use it as a threshold.",
        },
      },
      {
        text: {
          pl: "Koszt rabatów i darmowych okresów próbnych księguj konsekwentnie (obniżka przychodu albo koszt pozyskania) – zmiana konwencji zmienia CAC skokowo.",
          en: "Account for the cost of discounts and free trials consistently (revenue reduction or acquisition cost) – a change of convention changes CAC abruptly.",
        },
      },
      {
        text: {
          pl: "Licz od ARPU netto: przy stawce VAT 23% 20 zł brutto to ok. 16,3 zł netto (m ≈ 13,8 zł) – progi spadają proporcjonalnie.",
          en: "Calculate from net ARPU: at a 23% VAT rate, PLN 20 gross is approx. PLN 16.3 net (m ≈ PLN 13.8) – the thresholds fall proportionally.",
        },
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "cac.b2c_media_pl",
        label: {
          pl: "media cyfrowe B2C – nowy płacący subskrybent indywidualny (Polska), zł",
          en: "B2C digital media – new paying individual subscriber (Poland), PLN",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "money_minor",
        currency: "PLN",
        vat: "net",
        window: "per_customer",
        direction: "lower",
        method: {
          pl: "heurystyka: CAC = docelowy okres zwrotu (3 / 6 / 9 / 12 mies., spójnie z kontekstem B2C wskaźnika cac_payback_months) × miesięczna marża brutto z klienta m ≈ 15 zł netto (założenie: ARPU netto ok. 17–18 zł, tj. ok. 20 zł brutto po odjęciu VAT, × marża ≈85%). Okres: na nowego płacącego klienta.",
          en: "Heuristic: CAC = target payback period (3 / 6 / 9 / 12 months, consistent with the B2C context of cac_payback_months) × monthly gross margin per customer m ≈ PLN 15 net (assumption: net ARPU approx. PLN 17–18, i.e. approx. PLN 20 gross after deducting VAT, × margin ≈85%). Period: per new paying customer.",
        },
        sourceIds: ["wm_anatomia_2026", "risj_dnr2024_pay", "bvp_2021"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 4500,
            note: {
              pl: "zwrot ≤~3 mies.",
              en: "payback ≤~3 months",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 4500,
            max: 9000,
            note: {
              pl: "zwrot ~3–6 mies.",
              en: "payback ~3–6 months",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 9000,
            max: 13500,
            note: {
              pl: "zwrot ~6–9 mies.",
              en: "payback ~6–9 months",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 13500,
            max: 18000,
            note: {
              pl: "zwrot ~9–12 mies.",
              en: "payback ~9–12 months",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 18000,
            max: null,
            note: {
              pl: "zwrot >12 mies. – przy typowym churnie B2C wielu klientów odejdzie przed zwrotem",
              en: "payback >12 months – with typical B2C churn many customers will leave before payback",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cac.b2c_media_pl",
      b2c_individual: "cac.b2c_media_pl",
      b2c_reduced: "cac.b2c_media_pl",
    },
  },
  {
    key: "new_cac_ratio",
    metricId: "new_cac_ratio",
    group: "economics",
    abbr: "New CAC Ratio",
    name: {
      pl: "Wskaźnik kosztu pozyskania nowego ARR",
      en: "New Customer CAC Ratio",
    },
    expansion: {
      pl: "New CAC Ratio – stosunek wydatków na sprzedaż i marketing do nowego rocznego przychodu powtarzalnego (ARR – Annual Recurring Revenue) od nowych klientów",
      en: "New CAC Ratio – sales & marketing expense divided by new Annual Recurring Revenue (ARR) from new customers",
    },
    formula: {
      pl: "New CAC Ratio = koszty sprzedaży i marketingu w okresie ÷ nowy ARR od nowych klientów w tym okresie (Benchmarkit). Blended CAC Ratio = S&M ÷ (nowy ARR + ARR z rozszerzeń).",
      en: "New CAC Ratio = sales and marketing costs in the period ÷ new ARR from new customers in that period (Benchmarkit). Blended CAC Ratio = S&M ÷ (new ARR + expansion ARR).",
    },
    interpretation: {
      pl: "Ile złotych wydatków na sprzedaż i marketing trzeba ponieść, by pozyskać 1 zł nowego rocznego przychodu powtarzalnego od nowych klientów; normalizuje CAC do wartości kontraktu, więc pozwala porównywać segmenty o różnych cenach (np. licencje instytucjonalne vs. indywidualne). Mediana B2B SaaS w 2024 r. to 2,00 zł na 1 zł nowego ARR. Pułapki: nie dodawaj ARR z rozszerzeń u obecnych klientów (to osobny Expansion CAC Ratio, mediana 1,00) i stosuj ten sam okres dla kosztów i ARR.",
      en: "How many units of sales & marketing spend are needed to win one unit of new ARR from new customers; it normalises CAC by contract value, so segments with different prices (institutional vs individual licences) can be compared. The 2024 B2B SaaS median was $2.00 per $1.00 of new ARR. Pitfalls: do not mix in expansion ARR from existing customers (that is the separate Expansion CAC Ratio, median $1.00) and use the same period for costs and ARR.",
    },
    levers: {
      pl: "Kieruj sprzedaż instytucjonalną do organizacji, które już znają markę: uczestników wydarzeń, czytelników newslettera, partnerów raportów. Skracaj cykl sprzedaży gotowymi pakietami licencji i jasnym cennikiem dla zespołów. Mierz koszt sprzedaży i marketingu na złotówkę nowego ARR osobno dla nowych klientów i rozszerzeń. Wykorzystuj wydarzenia jako kanał pozyskania, który obniża koszt kontaktu.",
      en: "Direct institutional sales at organisations that already know the brand: event participants, newsletter readers, report partners. Shorten the sales cycle with ready-made licence packages and clear team pricing. Measure sales and marketing cost per PLN 1 of new ARR separately for new customers and expansion. Use events as an acquisition channel that lowers the cost of each contact.",
    },
    caveats: [
      {
        text: {
          pl: "Mała próba (N=73) i dane deklaratywne; wartości kwartyli odczytane z wykresu w raporcie.",
          en: "Small sample (N=73) and self-reported data; quartile values read off a chart in the report.",
        },
      },
      {
        text: {
          pl: "Silna zależność od ACV: dla ACV 1–5 tys. USD P25 0,46 / mediana 2,00 / P75 2,46; dla 5–10 tys. USD 1,50 / 1,60 / 1,80.",
          en: "Strong dependence on ACV: for ACV USD 1–5k P25 0.46 / median 2.00 / P75 2.46; for USD 5–10k 1.50 / 1.60 / 1.80.",
        },
      },
      {
        text: {
          pl: "Dla czysto konsumenckiej subskrypcji (B2C) wskaźnik ma mniejszy sens – użyj CAC payback.",
          en: "For a purely consumer subscription (B2C) the ratio makes less sense – use CAC payback.",
        },
      },
      {
        text: {
          pl: "Kwartyle dotyczą CY-2024; publicznych kwartyli New CAC Ratio za CY-2025 nie ma – strona Benchmarkit 2026 (S100) podaje jedynie Blended CAC Ratio 1,30 USD (inna definicja: S&M ÷ (nowy ARR + ARR z rozszerzeń)).",
          en: "The quartiles concern CY-2024; there are no public New CAC Ratio quartiles for CY-2025 – the Benchmarkit 2026 page (S100) gives only a Blended CAC Ratio of USD 1.30 (a different definition: S&M ÷ (new ARR + expansion ARR)).",
        },
        sourceIds: ["benchmarkit_2026"],
      },
      {
        text: {
          pl: "Progi nie są mechanicznie spójne z CAC payback: z mediany 2,00 ÷ marża 81% × 12 wychodzi ok. 30 mies., a raportowana mediana zwrotu to 18 mies. – wynika to z innych podprób (N=73 vs N=148).",
          en: "The thresholds are not mechanically consistent with CAC payback: the median of 2.00 ÷ margin of 81% × 12 gives approx. 30 months, while the reported median payback is 18 months – this stems from different subsamples (N=73 vs N=148).",
        },
      },
      {
        text: {
          pl: "Przedział słaby (2,82–3,0) jest wąski: granica krytyczna 3,0 to heurystyka dopasowana do progów CAC payback, nie kwartyl źródła.",
          en: "The weak range (2.82–3.0) is narrow: the critical boundary of 3.0 is a heuristic matched to the CAC payback thresholds, not a source quartile.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "new_cac_ratio.b2b_saas",
        label: {
          pl: "SaaS B2B / subskrypcje instytucjonalne (prywatne firmy, głównie USA)",
          en: "B2B SaaS / institutional subscriptions (private companies, mainly USA)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "multiple",
        window: "year",
        direction: "lower",
        method: {
          pl: "kwartyle źródła (CY-2024): P25 1,50 / mediana 2,00 / P75 2,82 (N=73); optymalny ≤P25, dobry P25–P50, normalny P50–P75, słaby P75–3,0; krytyczny >3,0 – heurystyka (przy marży 80% zwrot ≈45 mies.; obniżono z 4,0 ≈60 mies., bo próg krytyczny CAC payback >36 mies. odpowiada ratio ≈2,4). Publicznych kwartyli za CY-2025 brak – Benchmarkit 2026 (S100) podaje tylko Blended CAC Ratio 1,30 USD. Okres: rocznie (CY-2024).",
          en: "Source quartiles (CY-2024): P25 1.50 / median 2.00 / P75 2.82 (N=73); optimal ≤P25, good P25–P50, normal P50–P75, weak P75–3.0; critical >3.0 – heuristic (at an 80% margin, payback ≈45 months; lowered from 4.0 ≈60 months, because the critical CAC payback threshold of >36 months corresponds to a ratio of ≈2.4). There are no public quartiles for CY-2025 – Benchmarkit 2026 (S100) gives only a Blended CAC Ratio of USD 1.30. Period: annually (CY-2024).",
        },
        sourceIds: ["bm2025", "benchmarkit_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 1.5,
            basis: "B",
          },
          {
            tier: "good",
            min: 1.5,
            max: 2,
            basis: "B",
          },
          {
            tier: "normal",
            min: 2,
            max: 2.82,
            basis: "B",
          },
          {
            tier: "weak",
            min: 2.82,
            max: 3,
            basis: "E",
          },
          {
            tier: "critical",
            min: 3,
            max: null,
            note: {
              pl: "heurystyka – przy marży 80% zwrot ≈45 mies. i dłużej",
              en: "heuristic – at an 80% margin, payback ≈45 months or longer",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "new_cac_ratio.b2b_saas",
      b2b_institution: "new_cac_ratio.b2b_saas",
    },
  },
  {
    key: "ltv_cac_ratio",
    metricId: "ltv_cac_ratio",
    group: "economics",
    abbr: "LTV/CAC",
    name: {
      pl: "Relacja wartości klienta do kosztu pozyskania",
      en: "LTV to CAC Ratio",
    },
    expansion: {
      pl: "LTV/CAC (CLTV:CAC) – stosunek wartości klienta w cyklu życia (Lifetime Value) do kosztu jego pozyskania (Customer Acquisition Cost)",
      en: "LTV/CAC (CLTV:CAC) – ratio of Customer Lifetime Value to Customer Acquisition Cost",
    },
    formula: {
      pl: "LTV/CAC = LTV (na marży brutto) ÷ CAC; w Benchmarkit: (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ churn) ÷ CAC na nowego klienta",
      en: "LTV/CAC = LTV (on gross margin) ÷ CAC; in Benchmarkit: (average ARR per account × gross margin of recurring revenue ÷ churn) ÷ CAC per new customer",
    },
    interpretation: {
      pl: "Ile razy wartość klienta (na marży) przewyższa koszt jego pozyskania; poniżej 1 każdy nowy klient pogłębia stratę. Za próg minimalny uznaje się 3:1, mediana B2B SaaS w 2025 r. to 4,1x, a górny kwartyl 7,8x. Pułapki: to wskaźnik złożony – zawsze rozbijaj go na ARPU, churn, marżę i CAC; bardzo wysoki wynik (8x+) bywa sygnałem niedoinwestowania wzrostu albo zbyt krótkiej historii churnu.",
      en: "How many times the customer’s gross-margin value exceeds the cost to acquire them; below 1 every new customer deepens the loss. 3:1 is the accepted floor, the 2025 B2B SaaS median was 4.1x and the top quartile 7.8x. Pitfalls: it is a compound metric – always decompose it into ARPU, churn, margin and CAC; very high values (8x+) can signal under-investment in growth or a too-short churn history.",
    },
    levers: {
      pl: "Rozkładaj LTV/CAC na składowe i poprawiaj najsłabszą: ARPU (pakiety z wydarzeniami i raportami), churn (onboarding, plany roczne), marżę (koszty płatności i pośredników) albo CAC (kanały własne). Licz LTV ostrożnie, z ograniczonym horyzontem dla młodych kohort. Bardzo wysoki wynik traktuj jako sygnał, że można śmielej inwestować w pozyskanie.",
      en: "Break LTV/CAC down into its components and improve the weakest: ARPU (packages with events and reports), churn (onboarding, annual plans), margin (payment and intermediary costs) or CAC (owned channels). Calculate LTV conservatively, with a capped horizon for young cohorts. Treat a very high result as a signal that you can invest more boldly in acquisition.",
    },
    caveats: [
      {
        text: {
          pl: "Rozbieżność źródeł: w raporcie Benchmarkit 2025 (CY-2024) P25 wg przedziałów ARR wynosił 2,2–3,0x (np. 5–20 mln USD 3,0/4,0/6,5; 50–100 mln USD 2,5/2,9/5,0), a w edycji 2026 dolny kwartyl całej próby to ok. 1,1x – Aleph mówi o ‘bottom quartile’ bez definicji, czy to granica P25, czy średnia dolnego kwartyla, i nie podaje P25 za 2024.",
          en: "Divergence of sources: in the Benchmarkit 2025 report (CY-2024), P25 by ARR bracket was 2.2–3.0x (e.g. USD 5–20m 3.0/4.0/6.5; USD 50–100m 2.5/2.9/5.0), while in the 2026 edition the lower quartile of the whole sample is approx. 1.1x – Aleph refers to the 'bottom quartile' without defining whether it is the P25 boundary or the average of the bottom quartile, and gives no P25 for 2024.",
        },
      },
      {
        text: {
          pl: "Wczesne firmy (<1 mln USD ARR) raportują zawyżone LTV/CAC (Benchmarkit 2025: P25 3,0 / mediana 5,0 / P75 9,5) – krótka historia churnu.",
          en: "Early-stage companies (<USD 1m ARR) report overstated LTV/CAC (Benchmarkit 2025: P25 3.0 / median 5.0 / P75 9.5) – a short churn history.",
        },
      },
      {
        text: {
          pl: "Mediana 2022–2024 stała na poziomie 3,6–3,7x, w 2025 r. wzrosła do 4,1x; źródło (Aleph) nie podaje przyczyny wzrostu – nie przypisuj go ani cięciu kosztów, ani poprawie retencji.",
          en: "The median for 2022–2024 stood at 3.6–3.7x and rose to 4.1x in 2025; the source (Aleph) gives no reason for the increase – attribute it neither to cost cutting nor to improved retention.",
        },
      },
      {
        text: {
          pl: "Dla B2C brak publicznych benchmarków wydawców – kontekst B2C to heurystyka z progami jak w B2B.",
          en: "For B2C there are no public publisher benchmarks – the B2C context is a heuristic with thresholds as for B2B.",
        },
      },
      {
        text: {
          pl: "Skok (For Entrepreneurs) to heurystyka klasyczna bez daty publikacji, nie benchmark z próby.",
          en: "Skok (For Entrepreneurs) is an undated classic heuristic, not a benchmark from a sample.",
        },
      },
    ],
    direction: "range",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "ltv_cac_ratio.b2b_saas",
        label: {
          pl: "SaaS B2B / subskrypcje instytucjonalne (prywatne firmy B2B SaaS i AI, globalnie)",
          en: "B2B SaaS / institutional subscriptions (private B2B SaaS and AI companies, global)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "multiple",
        window: "year",
        direction: "range",
        method: {
          pl: "kwartyle źródła: dolny kwartyl ≈1,1x (Aleph: ‘bottom quartile’ – bez definicji, czy to granica P25, czy średnia dolnego kwartyla) / mediana 4,1x / P75 7,8x (n=146) + próg 3:1 (Skok – heurystyka klasyczna bez daty; Bessemer 2021) + granica 8x jako sygnał niedoinwestowania (Aleph). Okres: rocznie (CY-2025).",
          en: "Source quartiles: lower quartile ≈1.1x (Aleph: 'bottom quartile' – with no definition of whether this is the P25 boundary or the average of the bottom quartile) / median 4.1x / P75 7.8x (n=146) + the 3:1 threshold (Skok – an undated classic heuristic; Bessemer 2021) + an 8x boundary as a signal of underinvestment (Aleph). Period: annually (CY-2025).",
        },
        sourceIds: ["aleph_ltvcac_2026", "bm2025", "skok_saasmetrics", "bvp_2021"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "klient nie zwraca kosztu pozyskania",
              en: "the customer does not pay back the acquisition cost",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 1,
            max: 3,
            note: {
              pl: "poniżej progu 3:1; dolny kwartyl ≈1,1x (Aleph – granica kwartyla niezdefiniowana)",
              en: "below the 3:1 threshold; lower quartile ≈1.1x (Aleph – quartile boundary undefined)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 3,
            max: 4,
            note: {
              pl: "od progu 3:1 do okolic mediany 4,1x",
              en: "from the 3:1 threshold to around the 4.1x median",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 4,
            max: 5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 5,
            max: 8,
            note: {
              pl: "P75 = 7,8x; ‘7x+ best-in-class’",
              en: "P75 = 7.8x; '7x+ best-in-class'",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 8,
            max: null,
            note: {
              pl: "dobry – sprawdź niedoinwestowanie wzrostu lub zbyt krótką historię churnu (wysoka efektywność)",
              en: "good – check for underinvestment in growth or too short a churn history (high efficiency)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "ltv_cac_ratio.b2c_media_pl",
        label: {
          pl: "media cyfrowe B2C / członkostwa indywidualne (Polska)",
          en: "B2C digital media / individual memberships (Poland)",
        },
        segments: ["b2c_individual", "b2c_reduced", "membership_club"],
        measure: "level",
        unit: "multiple",
        window: "per_customer",
        direction: "range",
        method: {
          pl: "heurystyka: te same progi co B2B (3:1 jako minimum), LTV liczone konserwatywnie (horyzont ≤36 mies. dla młodych kohort). Okres: na kohortę miesięczną.",
          en: "Heuristic: the same thresholds as for B2B (3:1 as the minimum), LTV calculated conservatively (horizon ≤36 months for young cohorts). Period: per monthly cohort.",
        },
        sourceIds: ["skok_saasmetrics", "lenfest_2019"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "klient nie zwraca kosztu pozyskania",
              en: "the customer does not pay back the acquisition cost",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 3,
            note: {
              pl: "poniżej minimum 3:1",
              en: "below the 3:1 minimum",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 3,
            max: 4,
            basis: "E",
          },
          {
            tier: "good",
            min: 4,
            max: 5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 5,
            max: 8,
            basis: "E",
          },
          {
            tier: "good",
            min: 8,
            max: null,
            note: {
              pl: "dobry – sprawdź, czy LTV nie jest zawyżone przez krótką historię churnu",
              en: "good – check whether LTV is overstated by a short churn history",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "ltv_cac_ratio.b2c_media_pl",
      b2c_individual: "ltv_cac_ratio.b2c_media_pl",
      b2c_reduced: "ltv_cac_ratio.b2c_media_pl",
      b2b_institution: "ltv_cac_ratio.b2b_saas",
    },
  },
  {
    key: "cac_payback_months",
    metricId: "cac_payback_months",
    group: "economics",
    abbr: "CAC Payback",
    name: {
      pl: "Okres zwrotu kosztu pozyskania klienta",
      en: "CAC Payback Period",
    },
    expansion: {
      pl: "CAC Payback (CPP) – liczba miesięcy potrzebna, by marża brutto z nowych klientów zwróciła koszt ich pozyskania (Customer Acquisition Cost)",
      en: "CAC Payback Period (CPP) – months needed for gross margin from new customers to recover their Customer Acquisition Cost",
    },
    formula: {
      pl: "CAC payback (mies.) = CAC ÷ (ARPU miesięczne × marża brutto %). Wariant Benchmarkit: koszty S&M ÷ (ARR od nowych klientów × marża brutto subskrypcji) × 12",
      en: "CAC payback (months) = CAC ÷ (monthly ARPU × gross margin %). Benchmarkit variant: S&M costs ÷ (ARR from new customers × subscription gross margin) × 12",
    },
    interpretation: {
      pl: "Po ilu miesiącach nowy klient ‘spłaca’ koszt swojego pozyskania z marży brutto; im krócej, tym mniej kapitału zamrożonego we wzroście i mniejsze ryzyko, że klient odejdzie przed zwrotem. Mediana B2B SaaS w 2025 r. to 16 mies., ale silnie zależy od wartości kontraktu (dla ACV <5 tys. USD ok. 8–11 mies.). Pułapki: liczenie na przychodzie zamiast na marży, wliczanie ARR z rozszerzeń oraz porównywanie z firmami publicznymi, które liczą zwrot na ‘net new ARR’ (inna metodologia).",
      en: "How many months it takes a new customer to ‘repay’ their acquisition cost from gross margin; shorter means less capital tied up in growth and less risk of churn before payback. The 2025 B2B SaaS median was 16 months, but it depends heavily on contract value (about 8–11 months for ACV under $5K). Pitfalls: computing on revenue instead of margin, mixing in expansion ARR, and comparing with public companies that use ‘net new ARR’ (different methodology).",
    },
    levers: {
      pl: "Skracaj zwrot z dwóch stron: obniżaj CAC (kanały własne, wydarzenia, polecenia) i podnoś miesięczną marżę z klienta (plany roczne płatne z góry, pakiety premium). Instytucjom proponuj płatność roczną z góry, która przyspiesza zwrot. Mierz zwrot osobno dla kohort miesięcznych w B2C i dla umów w B2B. Gdy zwrot przekracza oczekiwany czas życia klienta, wstrzymaj skalowanie kanału.",
      en: "Shorten payback from both sides: lower CAC (owned channels, events, referrals) and raise the monthly margin per customer (annual plans paid upfront, premium packages). Offer institutions annual payment upfront, which speeds up payback. Measure payback separately for monthly cohorts in B2C and for contracts in B2B. When payback exceeds the expected customer lifetime, stop scaling the channel.",
    },
    caveats: [
      {
        text: {
          pl: "Kwartyle 2024 (CY-2024, N=148): P25 12 / mediana 18 / P75 24 mies.; w 2025 r. mediana spadła do 16, P25 do 10.",
          en: "2024 quartiles (CY-2024, N=148): P25 12 / median 18 / P75 24 months; in 2025 the median fell to 16 and P25 to 10.",
        },
      },
      {
        text: {
          pl: "Benchmarkit 2025 wg ACV (P25/mediana/P75): 5–10 tys. USD 13/14/18; 10–25 tys. 15/18/22; 25–50 tys. 13/22/26; 50–100 tys. 16/24/33; 100–250 tys. 20/24/37 mies. – odczyt z wykresu.",
          en: "Benchmarkit 2025 by ACV (P25/median/P75): USD 5–10k 13/14/18; 10–25k 15/18/22; 25–50k 13/22/26; 50–100k 16/24/33; 100–250k 20/24/37 months – read off a chart.",
        },
      },
      {
        text: {
          pl: "Cele Bessemer (2021, portfel VC): SMB <12, mid-market <18, enterprise <24 mies.",
          en: "Bessemer targets (2021, VC portfolio): SMB <12, mid-market <18, enterprise <24 months.",
        },
      },
      {
        text: {
          pl: "Kontekst B2C to heurystyka – brak publicznych benchmarków zwrotu CAC dla wydawców.",
          en: "The B2C context is a heuristic – there are no public CAC payback benchmarks for publishers.",
        },
      },
      {
        text: {
          pl: "Strona Aleph 2026 podaje też ‘Top-quartile companies do it in 6 months or fewer’, co przeczy P25 = 10 mies. na tej samej stronie – nie używaj ‘≤6 mies.’ jako górnego kwartyla całej próby.",
          en: "The Aleph 2026 page also states 'Top-quartile companies do it in 6 months or fewer', which contradicts P25 = 10 months on the same page – do not use '≤6 months' as the top quartile of the whole sample.",
        },
      },
      {
        text: {
          pl: "Kontekst niskiego ACV: progi oparto na medianie CY-2025 (11 mies.; CY-2024: 8 mies.), granica 14 mies. to heurystyka; cel Bessemer dla SMB (<12 mies.) mieści się w przedziale normalnym.",
          en: "Low-ACV context: the thresholds are based on the CY-2025 median (11 months; CY-2024: 8 months), and the 14-month boundary is a heuristic; the Bessemer target for SMB (<12 months) falls within the normal range.",
        },
      },
      {
        text: {
          pl: "Skok (próg 12 mies. w kontekście B2C) to heurystyka klasyczna bez daty publikacji, nie benchmark z próby.",
          en: "Skok (the 12-month threshold in the B2C context) is an undated classic heuristic, not a benchmark from a sample.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "cac_payback_months.b2b_saas_all",
        label: {
          pl: "SaaS B2B – cała próba (prywatne firmy B2B SaaS i AI)",
          en: "B2B SaaS – whole sample (private B2B SaaS and AI companies)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "months",
        window: "year",
        direction: "lower",
        method: {
          pl: "kwartyle źródła: P25 10 / mediana 16 / P75 24 mies. (n=198); optymalny ≤P25, dobry P25–P50, normalny P50–P75, słaby 24–36; krytyczny >36 – heurystyka. Okres: rocznie (CY-2025).",
          en: "Source quartiles: P25 10 / median 16 / P75 24 months (n=198); optimal ≤P25, good P25–P50, normal P50–P75, weak 24–36; critical >36 – heuristic. Period: annually (CY-2025).",
        },
        sourceIds: ["aleph_payback_2026", "bm2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 10,
            basis: "B",
          },
          {
            tier: "good",
            min: 10,
            max: 16,
            basis: "B",
          },
          {
            tier: "normal",
            min: 16,
            max: 24,
            basis: "B",
          },
          {
            tier: "weak",
            min: 24,
            max: 36,
            basis: "E",
          },
          {
            tier: "critical",
            min: 36,
            max: null,
            note: {
              pl: "heurystyka – zwrot dłuższy niż 3 lata",
              en: "heuristic – payback longer than 3 years",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "cac_payback_months.b2b_low_acv",
        label: {
          pl: "subskrypcje instytucjonalne / B2B o niskiej wartości kontraktu (ACV <5 tys. USD, ok. <20 tys. zł rocznie)",
          en: "Institutional / B2B subscriptions with low contract value (ACV <USD 5k, approx. <PLN 20k per year)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "months",
        window: "year",
        direction: "lower",
        method: {
          pl: "kwartyle Benchmarkit 2025 (CY-2024) dla ACV <1 tys. USD (5/8/10) i 1–5 tys. USD (6/8/12) + mediana CY-2025 dla ACV <5 tys. USD = 11 mies. (Aleph 2026; CY-2024: 8) + cel Bessemer dla SMB <12 mies.; optymalny ≤6 (P25 CY-2024), dobry 6–11 (do mediany CY-2025), normalny 11–14 – heurystyka (brak P75 za 2025), słaby 14–18, krytyczny >18 – heurystyka. Okres: rocznie (CY-2024/CY-2025).",
          en: "Benchmarkit 2025 quartiles (CY-2024) for ACV <USD 1k (5/8/10) and USD 1–5k (6/8/12) + the CY-2025 median for ACV <USD 5k = 11 months (Aleph 2026; CY-2024: 8) + the Bessemer target for SMB <12 months; optimal ≤6 (P25 CY-2024), good 6–11 (up to the CY-2025 median), normal 11–14 – heuristic (no P75 for 2025), weak 14–18, critical >18 – heuristic. Period: annually (CY-2024/CY-2025).",
        },
        sourceIds: ["bm2025", "aleph_payback_2026", "bvp_2021"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 6,
            basis: "B",
          },
          {
            tier: "good",
            min: 6,
            max: 11,
            note: {
              pl: "do mediany CY-2025 dla ACV <5 tys. USD",
              en: "up to the CY-2025 median for ACV <USD 5k",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 11,
            max: 14,
            note: {
              pl: "granica 14 – heurystyka (brak P75 za 2025)",
              en: "boundary of 14 – heuristic (no P75 for 2025)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 14,
            max: 18,
            basis: "E",
          },
          {
            tier: "critical",
            min: 18,
            max: null,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "cac_payback_months.b2c_media_pl",
        label: {
          pl: "media cyfrowe B2C – subskrypcja indywidualna (Polska)",
          en: "B2C digital media – individual subscription (Poland)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "months",
        window: "per_customer",
        direction: "lower",
        method: {
          pl: "heurystyka: B2C ma krótszy czas życia klienta niż SMB B2B, więc próg musi być ostrzejszy niż cel Bessemer dla SMB (<12 mies.); zwrot powinien nastąpić w pierwszej 1/3 oczekiwanego czasu życia. Okres: na kohortę miesięczną.",
          en: "Heuristic: B2C has a shorter customer lifetime than B2B SMB, so the threshold must be stricter than the Bessemer target for SMB (<12 months); payback should occur within the first 1/3 of the expected lifetime. Period: per monthly cohort.",
        },
        sourceIds: ["bvp_2021", "skok_saasmetrics"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 3,
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 6,
            basis: "E",
          },
          {
            tier: "normal",
            min: 6,
            max: 9,
            basis: "E",
          },
          {
            tier: "weak",
            min: 9,
            max: 12,
            basis: "E",
          },
          {
            tier: "critical",
            min: 12,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cac_payback_months.b2c_media_pl",
      b2c_individual: "cac_payback_months.b2c_media_pl",
      b2c_reduced: "cac_payback_months.b2c_media_pl",
      b2b_institution: "cac_payback_months.b2b_low_acv",
    },
  },
  {
    key: "subscription_gross_margin",
    metricId: "subscription_gross_margin",
    group: "economics",
    abbr: "GM",
    name: {
      pl: "Marża brutto subskrypcji cyfrowych",
      en: "Subscription Gross Margin",
    },
    expansion: {
      pl: "GM – Gross Margin: udział przychodu z subskrypcji, który zostaje po odjęciu kosztów bezpośredniego dostarczenia usługi (COGS – Cost of Goods Sold)",
      en: "GM – Gross Margin: share of subscription revenue left after direct cost of delivery (COGS – Cost of Goods Sold)",
    },
    formula: {
      pl: "Marża brutto subskrypcji = (przychody z subskrypcji netto − koszty bezpośrednie: opłaty płatnicze i billing, hosting/CDN, licencje paywall/CRM/e-mail proporcjonalnie, prowizje platform/sklepów aplikacji, obsługa klienta) ÷ przychody z subskrypcji × 100%",
      en: "Subscription gross margin = (net subscription revenue − direct costs: payment and billing fees, hosting/CDN, proportional paywall/CRM/email licences, platform/app-store commissions, customer service) ÷ subscription revenue × 100%",
    },
    interpretation: {
      pl: "Jaka część przychodu z subskrypcji zostaje po pokryciu kosztów bezpośredniego dostarczenia usługi; wysoka marża oznacza, że wzrost skali poprawia rentowność. Mediana marży oprogramowania B2B SaaS w 2025 r. to 80%, górny kwartyl 86%+. Pułapki: niespójne księgowanie kosztów redakcyjnych (w mediach zwykle koszt operacyjny, nie COGS) – trzymaj jedną definicję; stała opłata za transakcję (np. 1 zł) mocno obniża marżę tanich planów miesięcznych.",
      en: "The share of subscription revenue left after direct delivery costs; a high margin means scale improves profitability. The 2025 B2B SaaS software gross-margin median was 80%, top quartile 86%+. Pitfalls: inconsistent treatment of editorial costs (in media usually opex, not COGS) – keep one definition; fixed per-transaction fees (e.g. PLN 1) heavily erode the margin of cheap monthly plans.",
    },
    levers: {
      pl: "Ograniczaj koszty płatności: plany roczne zamiast miesięcznych zmniejszają udział stałych opłat od transakcji. Kieruj sprzedaż do własnego kanału zamiast platform pośredniczących i sklepów z aplikacjami. Przeglądaj licencje narzędzi (paywall, CRM, e-mail) pod kątem rzeczywistego wykorzystania. Trzymaj jedną definicję kosztów bezpośrednich, aby marża była porównywalna w czasie.",
      en: "Limit payment costs: annual plans instead of monthly ones reduce the share of fixed per-transaction fees. Direct sales to your own channel rather than intermediary platforms and app stores. Review tool licences (paywall, CRM, email) for actual usage. Keep one definition of direct costs so that the margin is comparable over time.",
    },
    caveats: [
      {
        text: {
          pl: "Benchmarkit 2025 (CY-2024): marża subskrypcji – cała próba P25 72% / mediana 81% / P75 86% (N=76, wykres s. 44), całkowita 77%, usługi profesjonalne 30%; wg ARR 1–5 mln USD P25 40% / mediana 77% / P75 90%; 5–20 mln USD 75/81/86%.",
          en: "Benchmarkit 2025 (CY-2024): subscription margin – whole sample P25 72% / median 81% / P75 86% (N=76, chart p. 44), total 77%, professional services 30%; by ARR USD 1–5m P25 40% / median 77% / P75 90%; USD 5–20m 75/81/86%.",
        },
      },
      {
        text: {
          pl: "Modele rozliczane wyłącznie za użycie mają medianę 62% (koszty mocy obliczeniowej/AI) – funkcje AI w produkcie mogą obniżać marżę.",
          en: "Models billed purely on usage have a median of 62% (compute/AI costs) – AI features in the product can lower the margin.",
        },
      },
      {
        text: {
          pl: "Jeśli koszty redakcyjne (autorzy, eksperci) są ujmowane w COGS, marża wydawcy będzie znacznie niższa i progi SaaS nie mają zastosowania.",
          en: "If editorial costs (authors, experts) are included in COGS, a publisher's margin will be much lower and the SaaS thresholds do not apply.",
        },
      },
      {
        text: {
          pl: "Platformy patronackie pobierają prowizję (Patronite 6,5% netto + operator płatności) – uwzględnij przy kanałach pośrednich.",
          en: "Patronage platforms charge a commission (Patronite 6.5% net + payment operator) – take it into account for indirect channels.",
        },
      },
      {
        text: {
          pl: "‘Bottom quartile: 50%’ w Aleph 2026 nie jest zdefiniowany (granica P25 czy średnia dolnego kwartyla) i mocno odstaje od P25 = 72% w Benchmarkit CY-2024 – granica krytyczny/słaby 50% jest przez to niepewna.",
          en: "The 'Bottom quartile: 50%' in Aleph 2026 is not defined (P25 boundary or average of the bottom quartile) and deviates sharply from P25 = 72% in Benchmarkit CY-2024 – the critical/weak boundary of 50% is therefore uncertain.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "subscription_gross_margin.b2b_saas",
        label: {
          pl: "SaaS B2B – marża brutto przychodów z oprogramowania/subskrypcji",
          en: "B2B SaaS – gross margin on software/subscription revenue",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "kwartyle źródła: dolny kwartyl 50% (Aleph 2026 – bez definicji granicy) / mediana 80% / górny kwartyl 86%+ (n=228–232, CY-2025); granica słaby/normalny 72% = P25 marży subskrypcji całej próby Benchmarkit CY-2024 (72/81/86%), zbieżna z medianą firm <5 mln USD ARR wg Aleph (72%); kontekst: średnia marża chmury wg Bessemer 65–70%. Okres: rocznie (CY-2025).",
          en: "Source quartiles: lower quartile 50% (Aleph 2026 – boundary not defined) / median 80% / upper quartile 86%+ (n=228–232, CY-2025); the weak/normal boundary of 72% = P25 of the subscription margin for the whole Benchmarkit CY-2024 sample (72/81/86%), consistent with the median of companies <USD 5m ARR according to Aleph (72%); context: average cloud margin according to Bessemer 65–70%. Period: annually (CY-2025).",
        },
        sourceIds: ["aleph_gm_2026", "bm2025", "bvp_2021"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 50,
            basis: "B",
          },
          {
            tier: "weak",
            min: 50,
            max: 72,
            basis: "B",
          },
          {
            tier: "normal",
            min: 72,
            max: 80,
            basis: "B",
          },
          {
            tier: "good",
            min: 80,
            max: 86,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 86,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "subscription_gross_margin.publisher_think_tank",
        label: {
          pl: "wydawca cyfrowy / think tank – subskrypcje treści (koszty redakcyjne poza COGS)",
          en: "Digital publisher / think tank – content subscriptions (editorial costs outside COGS)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "heurystyka: obciążenie opłatami Stripe PL (1,5% + 1 zł karta EEA, BLIK 1,6% + 1 zł, Billing 0,7%) to ok. 7% przy płatności 20 zł i ok. 2,7% przy 200 zł rocznie; po narzędziach i obsłudze klienta realna marża 80–90%. Okres: miesięcznie / kwartalnie.",
          en: "Heuristic: Stripe PL fees (1.5% + PLN 1 EEA card, BLIK 1.6% + PLN 1, Billing 0.7%) amount to approx. 7% on a PLN 20 payment and approx. 2.7% on PLN 200 per year; after tools and customer service, the real margin is 80–90%. Period: monthly / quarterly.",
        },
        sourceIds: ["stripe_pl_pricing", "wm_anatomia_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 70,
            note: {
              pl: "np. dominująca sprzedaż przez platformy pośredniczące lub sklepy aplikacji",
              en: "e.g. predominant sales through intermediary platforms or app stores",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 70,
            max: 80,
            basis: "E",
          },
          {
            tier: "normal",
            min: 80,
            max: 85,
            basis: "E",
          },
          {
            tier: "good",
            min: 85,
            max: 90,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 90,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "subscription_gross_margin.publisher_think_tank",
    },
  },
  {
    key: "rule_of_40",
    metricId: "rule_of_40",
    group: "economics",
    abbr: "R40",
    name: {
      pl: "Reguła 40",
      en: "Rule of 40",
    },
    expansion: {
      pl: "Rule of 40 – reguła, według której suma tempa wzrostu przychodów i marży zysku powinna wynosić co najmniej 40%",
      en: "Rule of 40 – the principle that revenue growth rate plus profit margin should be at least 40%",
    },
    formula: {
      pl: "R40 = roczna dynamika przychodów lub ARR (%) + marża EBITDA (%) [alternatywnie marża FCF – wolnych przepływów pieniężnych]",
      en: "R40 = annual growth in revenue or ARR (%) + EBITDA margin (%) [alternatively FCF margin – free cash flow]",
    },
    interpretation: {
      pl: "Mierzy równowagę między wzrostem a rentownością: szybki wzrost może usprawiedliwiać stratę, a wolny wzrost wymaga wysokiej marży. Wynik ≥40% uchodzi za wzorcowy, ale mediana prywatnych firm B2B SaaS w 2025 r. to 25%, a próg 40 przekracza ok. 15% spółek publicznych (na bazie EBITDA). Pułapki: zawsze podawaj, którą marżę użyto (EBITDA vs FCF różni medianę spółek publicznych o ok. 16 pp), a w małych organizacjach wskaźnik jest niestabilny i ma głównie charakter informacyjny.",
      en: "Measures the balance between growth and profitability: fast growth can justify losses, slow growth needs high margins. 40%+ is the reference bar, but the 2025 private B2B SaaS median was 25% and only about 15% of public SaaS companies clear 40 on an EBITDA basis. Pitfalls: always state which margin is used (EBITDA vs FCF shifts the public median by ~16 pp), and in small organisations the metric is volatile and mostly informational.",
    },
    levers: {
      pl: "Licz R40 tylko dla linii komercyjnej (subskrypcje i płatne wydarzenia) i równoważ wzrost z rentownością: rozwijaj przychody powtarzalne zamiast jednorazowych i ograniczaj koszty pozyskania o długim zwrocie. Ustal z zarządem, czy priorytetem jest tempo wzrostu, czy marża, i raportuj obie składowe osobno. W organizacji non-profit używaj marży nadwyżki operacyjnej.",
      en: "Calculate R40 only for the commercial line (subscriptions and paid events) and balance growth with profitability: develop recurring rather than one-off revenue and limit acquisition costs with long payback. Agree with the board whether growth pace or margin is the priority, and report both components separately. In a non-profit organisation, use the operating surplus margin.",
    },
    caveats: [
      {
        text: {
          pl: "Wskaźnik staje się miarodajny od ok. 15–20 mln USD ARR (Benchmarkit, Aleph); dla think tanku/wydawcy niewielkiej skali traktuj go informacyjnie i licz tylko dla komercyjnej linii (subskrypcje + wydarzenia płatne).",
          en: "The metric becomes meaningful from approx. USD 15–20m ARR (Benchmarkit, Aleph); for a small-scale think tank/publisher, treat it as informative and calculate it only for the commercial line (subscriptions + paid events).",
        },
      },
      {
        text: {
          pl: "Benchmarkit 2025 (CY-2024): cała próba P25 −4% / mediana 15% / P75 35%; firmy z EMEA −9% / 25% / 38%, z USA −19% / 9% / 35%.",
          en: "Benchmarkit 2025 (CY-2024): whole sample P25 −4% / median 15% / P75 35%; companies from EMEA −9% / 25% / 38%, from the USA −19% / 9% / 35%.",
        },
      },
      {
        text: {
          pl: "Na bazie FCF mediana spółek publicznych to 39,1%, a próg 40 przekracza 46% – nie mieszaj definicji.",
          en: "On an FCF basis, the median for public companies is 39.1%, and 46% exceed the 40 threshold – do not mix definitions.",
        },
      },
      {
        text: {
          pl: "Spółki przekraczające 40 (FCF) wyceniane są na medianę 4,8x EV/przychody wobec 2,7x pozostałych.",
          en: "Companies exceeding 40 (FCF) are valued at a median of 4.8x EV/revenue against 2.7x for the rest.",
        },
      },
      {
        text: {
          pl: "Dla organizacji non-profit zamiast EBITDA użyj marży nadwyżki operacyjnej i oznacz to w panelu.",
          en: "For non-profit organisations, use the operating surplus margin instead of EBITDA and flag this in the dashboard.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "rule_of_40.private_saas",
        label: {
          pl: "prywatne firmy B2B SaaS i AI (globalnie)",
          en: "Private B2B SaaS and AI companies (global)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "kwartyle źródła: P25 7% / mediana 25% / P75 43% (n=110); optymalny od klasycznego progu 40%; krytyczny <0% – heurystyka (wzrost nie pokrywa straty); mediana 25% i górny kwartyl 43% potwierdzone w Benchmarkit 2026 (S100). Okres: rocznie (CY-2025).",
          en: "Source quartiles: P25 7% / median 25% / P75 43% (n=110); optimal from the classic 40% threshold; critical <0% – heuristic (growth does not cover the loss); the median of 25% and the upper quartile of 43% are confirmed in Benchmarkit 2026 (S100). Period: annually (CY-2025).",
        },
        sourceIds: ["aleph_r40_2026", "bm2025", "benchmarkit_2026"],
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
            max: 7,
            basis: "B",
          },
          {
            tier: "normal",
            min: 7,
            max: 25,
            basis: "B",
          },
          {
            tier: "good",
            min: 25,
            max: 40,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 40,
            max: null,
            note: {
              pl: "P75 = 43%",
              en: "P75 = 43%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "rule_of_40.public_saas",
        label: {
          pl: "spółki publiczne SaaS – marża EBITDA",
          en: "Public SaaS companies – EBITDA margin",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "mediana źródła 22,6%, 15% spółek ≥40; słaby 0–10% – heurystyka. Okres: LTM, stan na 5.05.2026.",
          en: "Source median 22.6%, 15% of companies ≥40; weak 0–10% – heuristic. Period: LTM, as at 5.05.2026.",
        },
        sourceIds: ["aventis_r40_2026"],
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
            max: 10,
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 22.6,
            basis: "B",
          },
          {
            tier: "good",
            min: 22.6,
            max: 40,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 40,
            max: null,
            note: {
              pl: "ok. 15% spółek",
              en: "approx. 15% of companies",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "rule_of_40.private_saas",
    },
  },
];
