// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/retencja.json, docs/benchmarki/2026-10-18/retencja.overlay.json
// SHA-256 treści kanonicznej wejść: 07b43f4b2aa2604e5bf417b19068c5610a0e46bbe4a39417815646bc6b07a31b
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „retention” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const RETENTION_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "logo_churn_monthly",
    metricId: "logo_churn_monthly",
    group: "retention",
    abbr: "Logo churn (M)",
    name: {
      pl: "Miesięczny churn klientów (logo churn)",
      en: "Monthly logo (customer) churn rate",
    },
    expansion: {
      pl: "Churn – odpływ, utrata klientów. 'Logo' oznacza, że liczymy klientów lub konta, a nie przychód. M – okres miesięczny.",
      en: "Churn – customer attrition. 'Logo' means it is counted in customers/accounts, not revenue. M – monthly period.",
    },
    formula: {
      pl: "Płacący klienci aktywni na początku miesiąca, którzy odeszli w tym miesiącu (anulowanie, wygaśnięcie, nieodzyskana płatność), podzieleni przez płacących klientów na początku miesiąca, × 100%. Klienci pozyskani w trakcie miesiąca nie wchodzą ani do licznika, ani do mianownika. Przeliczenie na rok: 1 − (1 − churn_M)^12.",
      en: "Paying customers active at the start of the month who left during that month (cancellation, expiry, unrecovered payment), divided by paying customers at the start of the month, × 100%. Customers acquired during the month enter neither the numerator nor the denominator. Annual conversion: 1 − (1 − churn_M)^12.",
    },
    interpretation: {
      pl: "Pokazuje, jaki odsetek płacącej bazy tracisz co miesiąc. Churn się składa: 2% miesięcznie to ok. 22% rocznie, a 4% miesięcznie to ok. 39% rocznie. Typowe pułapki: wliczanie trialistów i ofert za 1 zł zawyża wskaźnik. Średnia z całej bazy ukrywa wysoki odpływ nowych kohort. Przy planach rocznych churn jest 'schodkowy' (skupia się w miesiącach odnowień), dlatego oceniaj go na średniej kroczącej z 3–12 miesięcy i zawsze osobno dla każdego segmentu.",
      en: "Shows what share of the paying base you lose each month. Churn compounds: 2% a month is about 22% a year, and 4% a month is about 39% a year. Common pitfalls: counting trialists and 1-unit intro offers inflates the rate, and a whole-base average hides the high attrition of new cohorts. With annual plans churn comes in steps (it clusters in renewal months), so judge it on a 3–12 month rolling average and always per segment.",
    },
    levers: {
      pl: "Wzmacniaj nawyk w pierwszych tygodniach: newsletter z analizami, zaproszenia na webinary i wydarzenia, przypomnienia o raportach w abonamencie. Ograniczaj churn mimowolny: ponawianie płatności, aktualizacja kart, cykliczny BLIK, przypomnienie przed odnowieniem. Proponuj plan roczny osobom z planem miesięcznym. Rezygnację udostępniaj jasną, krótką ścieżką z opcjonalną propozycją pauzy lub tańszego planu - bez utrudnień (DSA art. 25, UOKiK).",
      en: "Build the habit in the first weeks: a newsletter with analysis, invitations to webinars and events, reminders of reports included in the subscription. Reduce involuntary churn: payment retries, card updates, recurring BLIK, a reminder before renewal. Offer an annual plan to monthly subscribers. Keep cancellation a clear, short path with an optional offer of a pause or a cheaper plan – without obstacles (DSA Art. 25, UOKiK).",
    },
    caveats: [
      {
        text: {
          pl: "Strona Recurly opisuje benchmarki jako 'annual', ale dokumentacja Recurly mówi wprost: 'Benchmarks apply only to monthly periods'. Wartości 3–5% są realistyczne tylko jako miesięczne, więc tak je traktujemy.",
          en: "The Recurly page describes the benchmarks as 'annual', but the Recurly documentation states plainly: 'Benchmarks apply only to monthly periods'. Values of 3–5% are realistic only as monthly figures, so that is how we treat them.",
        },
        sourceIds: ["recurly_churn_benchmarks_2026", "recurly_docs_churn_benchmarks"],
      },
      {
        text: {
          pl: "Raport Mather za Q1 2025 (4,62%) nie podaje okresu. Wcześniejsze raporty Mathera mierzą churn miesięczny, więc przyjęto okres miesięczny.",
          en: "The Mather report for Q1 2025 (4.62%) does not state the period. Earlier Mather reports measure monthly churn, so a monthly period has been assumed.",
        },
        sourceIds: ["mather_q1_2025"],
      },
      {
        text: {
          pl: "Dane news B2C pochodzą głównie z USA. Brak publicznego benchmarku churnu dla polskich wydawców. RASP/Onet podaje tylko, że obniżył churn 'o ponad połowę r/r', bez wartości bezwzględnych. Za newsy online płaci w Polsce 11% osób (DNR 2026, −2 pp), więc baza jest mniejsza i bardziej wrażliwa na cenę.",
          en: "News B2C data come mainly from the USA. There is no public churn benchmark for Polish publishers. RASP/Onet states only that it reduced churn 'by more than half y/y', without absolute values. In Poland 11% of people pay for online news (DNR 2026, −2 pp), so the base is smaller and more price-sensitive.",
        },
        sourceIds: ["rasp_inma_2026", "dnr_2026_poland"],
      },
      {
        text: {
          pl: "Progi dla mid-market, enterprise i członkostw to heurystyki przeliczone z wartości rocznych i rewenue'owych (GRR, churn ARR). Bezpośrednich median logo churn dla tych segmentów nie znaleziono w źródłach pierwotnych.",
          en: "The thresholds for mid-market, enterprise and memberships are heuristics converted from annual and revenue-based values (GRR, ARR churn). Direct logo-churn medians for these segments were not found in primary sources.",
        },
      },
      {
        text: {
          pl: "Wartość INMA (mediana 4,6%/mies. dla krajowych marek newsowych w 4Q 2024) jest niezweryfikowana: strona zwraca HTTP 403 (potwierdzone ponownie), liczba pochodzi tylko z wyników wyszukiwania. Jest zbieżna z Antenna (4,6%) i Mather Q1 2025 (4,62%), ale nie opiera się na niej żadna granica przedziału.",
          en: "The INMA value (a median of 4.6%/month for national news brands in 4Q 2024) is unverified: the page returns HTTP 403 (confirmed again), and the figure comes only from search results. It is consistent with Antenna (4.6%) and Mather Q1 2025 (4.62%), but no range boundary relies on it.",
        },
        sourceIds: ["inma_churn_growth_engine"],
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "logo_churn_monthly.news_b2c",
        label: {
          pl: "Cyfrowe subskrypcje news/media B2C (płatne plany miesięczne, sprzedaż web, bez trialu)",
          en: "Digital news/media B2C subscriptions (paid monthly plans, web sales, no trial)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "Mediany Mather Economics (USA, 2022–2025) i poziom 'Best-in-Class' Mathera (średnia rynków o najwyższym 'subscription success index', a nie percentyl P75), potwierdzone medianą Recurly (2026) i średnią ważoną Antenna (2025; okres niepodany na stronie). Granica słaby/krytyczny to heurystyka. Do aktualizacji po pobraniu raportu Mather Q1 2026 (V 2026). Okres: miesięcznie.",
          en: "Mather Economics medians (USA, 2022–2025) and Mather's 'Best-in-Class' level (the average of the markets with the highest 'subscription success index', not the P75 percentile), confirmed by the Recurly median (2026) and the Antenna weighted average (2025; period not stated on the page). The weak/critical boundary is a heuristic. To be updated once the Mather Q1 2026 report (May 2026) is obtained. Period: monthly.",
        },
        sourceIds: [
          "mather_sep_2022",
          "mather_q3_2023",
          "mather_q1_2025",
          "recurly_churn_benchmarks_2026",
          "recurly_docs_churn_benchmarks",
          "antenna_svod_2025",
          "digiday_monthly_annual_2023",
          "beehiiv_pressgazette_2026",
          "mather_q1_2026",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 2.7,
            note: {
              pl: "poziom 'Best-in-Class' według Mathera (2,70%/mies., 2022; średnia rynków o najwyższym 'subscription success index', nie percentyl)",
              en: "Mather's 'Best-in-Class' level (2.70%/month, 2022; the average of the markets with the highest 'subscription success index', not a percentile)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 2.7,
            max: 3.5,
            note: {
              pl: "'Leading publisher' według Mathera to 3,1%/mies. (2023)",
              en: "Mather's 'Leading publisher' is 3.1%/month (2023)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 3.5,
            max: 4.9,
            note: {
              pl: "mediany: Mather 3,53% (2022), 3,8% (2023), 4,62% (Q1 2025); Recurly digital media 4,14%; Antenna SVOD 4,6% (średnia ważona 2025; strona nie podaje okresu, miesięczny według metodologii Antenna – niepotwierdzone na stronie); INMA 4,6% niezweryfikowana (HTTP 403)",
              en: "medians: Mather 3.53% (2022), 3.8% (2023), 4.62% (Q1 2025); Recurly digital media 4.14%; Antenna SVOD 4.6% (2025 weighted average; the page does not state the period, monthly according to Antenna's methodology – not confirmed on the page); INMA 4.6% unverified (HTTP 403)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 4.9,
            max: 7,
            note: {
              pl: "powyżej median rynkowych; rocznie ok. 45–58%",
              en: "above market medians; annually approx. 45–58%",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 7,
            max: null,
            note: {
              pl: "heurystyka: powyżej 58% rocznie; poziom 'nieszczelnych' kategorii newsletterów (sport 7,76%, AI 13,33%)",
              en: "heuristic: above 58% annually; the level of 'leaky' newsletter categories (sport 7.76%, AI 13.33%)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_monthly.b2b_smb",
        label: {
          pl: "SaaS / subskrypcje B2B SMB (ARPA poniżej ok. 1 tys. USD/mies., płatność kartą, plan miesięczny)",
          en: "SaaS / B2B SMB subscriptions (ARPA below approx. USD 1k/month, card payment, monthly plan)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "Górny kwartyl i mediana Recurly (lipiec 2026), mediany ChartMogul według ARPA (dane historyczne XI 2021–I 2022) i średnia Stripe za 2024 (via Churnkey). Granica krytyczna to heurystyka. Okres: miesięcznie.",
          en: "Recurly top quartile and median (July 2026), ChartMogul medians by ARPA (historical data Nov 2021–Jan 2022) and the Stripe average for 2024 (via Churnkey). The critical boundary is a heuristic. Period: monthly.",
        },
        sourceIds: [
          "recurly_churn_benchmarks_2026",
          "recurly_docs_churn_benchmarks",
          "chartmogul_good_churn_2022",
          "churnkey_involuntary_2025",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 1.8,
            note: {
              pl: "górny kwartyl Recurly dla SaaS: 1,78% lub mniej",
              en: "Recurly top quartile for SaaS: 1.78% or less",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 1.8,
            max: 3,
            basis: "B",
          },
          {
            tier: "normal",
            min: 3,
            max: 4.5,
            note: {
              pl: "mediany Recurly: SaaS 3,04–3,22%, usługi B2B 3,21–3,44%; średnia Stripe dla B2B 3,82%",
              en: "Recurly medians: SaaS 3.04–3.22%, B2B services 3.21–3.44%; Stripe average for B2B 3.82%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 4.5,
            max: 6.5,
            note: {
              pl: "mediana ChartMogul przy ARPA < 25 USD to 6,1% (dane historyczne XI 2021–I 2022)",
              en: "ChartMogul median at ARPA < USD 25 is 6.1% (historical data Nov 2021–Jan 2022)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 6.5,
            max: null,
            note: {
              pl: "heurystyka: powyżej 55% rocznie",
              en: "heuristic: above 55% annually",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_monthly.b2b_mid_market",
        label: {
          pl: "B2B mid-market (ACV ok. 12–100 tys. USD, umowy roczne); ekwiwalent miesięczny",
          en: "B2B mid-market (ACV approx. USD 12–100k, annual contracts); monthly equivalent",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "lower",
        method: {
          pl: "Heurystyka: przeliczenie progów rocznych 6/10/15/22% na miesięczne. Progi zakotwiczone w churnie ARR 10% dla umów rocznych (KeyBanc 2024) i medianie GRR 90–91% dla ACV 12–250 tys. USD (SaaS Capital 2025). Logo churn bywa wyższy niż churn dolarowy, bo częściej odchodzą mniejsi klienci. Okres: miesięcznie (ekwiwalent; oceniaj jako średnią kroczącą 12M).",
          en: "Heuristic: conversion of the annual thresholds of 6/10/15/22% into monthly ones. Thresholds anchored in ARR churn of 10% for annual contracts (KeyBanc 2024) and the median GRR of 90–91% for ACV USD 12–250k (SaaS Capital 2025). Logo churn tends to be higher than dollar churn, because smaller customers leave more often. Period: monthly (equivalent; assess as a rolling 12-month average).",
        },
        sourceIds: ["keybanc_sapphire_2024", "saascapital_retention_2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.5,
            note: {
              pl: "poniżej ok. 6% rocznie",
              en: "below approx. 6% annually",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 0.5,
            max: 0.9,
            note: {
              pl: "ok. 6–10% rocznie",
              en: "approx. 6–10% annually",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.9,
            max: 1.3,
            note: {
              pl: "ok. 10–15% rocznie; churn ARR przy umowach rocznych to 10% (KeyBanc)",
              en: "approx. 10–15% annually; ARR churn for annual contracts is 10% (KeyBanc)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1.3,
            max: 2,
            note: {
              pl: "ok. 15–22% rocznie",
              en: "approx. 15–22% annually",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 2,
            max: null,
            note: {
              pl: "powyżej ok. 22% rocznie",
              en: "above approx. 22% annually",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_monthly.b2b_enterprise",
        label: {
          pl: "B2B enterprise (ACV powyżej 100 tys. USD, umowy wieloletnie); ekwiwalent miesięczny",
          en: "B2B enterprise (ACV above USD 100k, multi-year contracts); monthly equivalent",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "lower",
        method: {
          pl: "Heurystyka: przeliczenie progów rocznych 3/5/8/12% na miesięczne. Kotwice: GRR 95% dla ACV powyżej 250 tys. USD (SaaS Capital 2025) oraz churn ARR 6% przy umowach 2-letnich i 3% przy 3+ letnich (KeyBanc 2024). Okres: miesięcznie (ekwiwalent; oceniaj jako średnią kroczącą 12M).",
          en: "Heuristic: conversion of the annual thresholds of 3/5/8/12% into monthly ones. Anchors: GRR of 95% for ACV above USD 250k (SaaS Capital 2025) and ARR churn of 6% for 2-year contracts and 3% for 3+ year contracts (KeyBanc 2024). Period: monthly (equivalent; assess as a rolling 12-month average).",
        },
        sourceIds: ["saascapital_retention_2025", "keybanc_sapphire_2024"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.25,
            note: {
              pl: "poniżej 3% rocznie (churn ARR przy umowach 3+ letnich: 3%)",
              en: "below 3% annually (ARR churn for 3+ year contracts: 3%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 0.25,
            max: 0.43,
            note: {
              pl: "3–5% rocznie (mediana GRR powyżej 250 tys. USD ACV: 95%)",
              en: "3–5% annually (median GRR above USD 250k ACV: 95%)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.43,
            max: 0.7,
            note: {
              pl: "5–8% rocznie",
              en: "5–8% annually",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.7,
            max: 1.06,
            note: {
              pl: "8–12% rocznie",
              en: "8–12% annually",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 1.06,
            max: null,
            note: {
              pl: "powyżej 12% rocznie",
              en: "above 12% annually",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_monthly.membership",
        label: {
          pl: "Członkostwa / memberships (składka roczna); ekwiwalent miesięczny",
          en: "Memberships (annual fee); monthly equivalent",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "lower",
        method: {
          pl: "Przeliczenie progów rocznych 10/15/20/28% na miesięczne. Progi zakotwiczone w medianach odnowień MGI (2025: 84% ogółem i 74% po 1. roku; 2026: 82% i 72%). Pozostałe granice to heurystyka. Okres: miesięcznie (ekwiwalent; przy składce rocznej licz kroczące 12M).",
          en: "Conversion of the annual thresholds of 10/15/20/28% into monthly ones. Thresholds anchored in MGI renewal medians (2025: 84% overall and 74% after the 1st year; 2026: 82% and 72%). The remaining boundaries are a heuristic. Period: monthly (equivalent; with an annual fee, use a rolling 12 months).",
        },
        sourceIds: ["mgi_2025_memberjungle", "mgi_2026_i4a"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.87,
            note: {
              pl: "poniżej 10% rocznie (odnowienia 90%+ to poziom top stowarzyszeń branżowych)",
              en: "below 10% annually (renewals of 90%+ are the level of top trade associations)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 0.87,
            max: 1.35,
            note: {
              pl: "10–15% rocznie",
              en: "10–15% annually",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.35,
            max: 1.84,
            note: {
              pl: "15–20% rocznie; mediana MGI to 82–84% odnowień, czyli 16–18% churnu",
              en: "15–20% annually; the MGI median is 82–84% renewals, i.e. 16–18% churn",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 1.84,
            max: 2.7,
            note: {
              pl: "20–28% rocznie, poziom churnu członków w 1. roku (odnowienia 72–74%)",
              en: "20–28% annually, the churn level of 1st-year members (renewals 72–74%)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 2.7,
            max: null,
            note: {
              pl: "powyżej 28% rocznie",
              en: "above 28% annually",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "logo_churn_monthly.news_b2c",
      b2c_individual: "logo_churn_monthly.news_b2c",
      b2c_reduced: "logo_churn_monthly.news_b2c",
      b2b_institution: "logo_churn_monthly.b2b_smb",
      membership_club: "logo_churn_monthly.membership",
    },
  },
  {
    key: "logo_churn_annual",
    metricId: "logo_churn_annual",
    group: "retention",
    abbr: "Logo churn (12M)",
    name: {
      pl: "Roczny churn klientów (logo churn)",
      en: "Annual logo (customer) churn rate",
    },
    expansion: {
      pl: "Churn – odpływ klientów liczony w sztukach (logo). R – okres 12 miesięcy. Dla członkostw to 1 − wskaźnik odnowień (renewal rate).",
      en: "Churn – customer attrition counted in accounts (logos). R – 12-month period. For memberships it equals 1 − renewal rate.",
    },
    formula: {
      pl: "Klienci aktywni na początku 12-miesięcznego okresu, którzy nie są aktywni na jego końcu, podzieleni przez klientów aktywnych na początku okresu, × 100%. Alternatywnie: 1 − (1 − churn_M)^12. Dla członkostw: 1 − (odnowieni członkowie / członkowie, którym wygasła składka).",
      en: "Customers active at the start of a 12-month period who are not active at its end, divided by customers active at the start of the period, × 100%. Alternatively: 1 − (1 − churn_M)^12. For memberships: 1 − (renewed members / members whose fee expired).",
    },
    interpretation: {
      pl: "Odsetek klientów z początku roku, których po 12 miesiącach nie ma w bazie. To główny wskaźnik dla umów rocznych B2B i składek członkowskich, gdzie churn miesięczny jest mało czytelny. Typowe pułapki: mieszanie planów miesięcznych i rocznych, liczenie od średniej bazy zamiast od bazy początkowej oraz 'netowanie' odejść powracającymi klientami. Reaktywacje raportuj osobno (winback).",
      en: "Share of customers present at the start of the year who are gone 12 months later. It is the primary measure for annual B2B contracts and membership dues, where monthly churn is hard to read. Common pitfalls: mixing monthly and annual plans, dividing by an average instead of the opening base, and netting losses against returning customers. Report reactivations separately (winback).",
    },
    levers: {
      pl: "Przygotuj odnowienie z wyprzedzeniem: podsumowanie wartości z roku (raporty, wydarzenia, briefingi) i przypomnienie przed terminem. Kończąc długą promocję, zapowiedz pełną cenę wcześniej i zaproponuj plan roczny. Członkom pierwszego roku zapewnij wejście do społeczności: spotkanie powitalne, kontakt z ekspertami, pierwsze wydarzenie. Raportuj churn osobno dla planów miesięcznych i rocznych; rezygnacja ma pozostać prosta (DSA, UOKiK).",
      en: "Prepare renewals in advance: a summary of the year's value (reports, events, briefings) and a reminder before the due date. When a long promotion ends, announce the full price early and offer an annual plan. Give first-year members a way into the community: a welcome meeting, contact with experts, a first event. Report churn separately for monthly and annual plans; cancellation must remain simple (DSA, UOKiK).",
    },
    caveats: [
      {
        text: {
          pl: "Benchmarki MGI dotyczą głównie stowarzyszeń w USA. Członkostwo w think tanku z wydarzeniami i klubami jest bliższe towarzystwom zawodowym (typowo 75–85% odnowień według i4a).",
          en: "MGI benchmarks concern mainly associations in the USA. A think-tank membership with events and clubs is closer to professional societies (typically 75–85% renewals according to i4a).",
        },
        sourceIds: ["mgi_2025_memberjungle", "mgi_2026_i4a"],
      },
      {
        text: {
          pl: "Dane MGI 2026 (82%/72%) pochodzą ze źródła wtórnego (i4a), bo oryginalnego raportu nie udało się otworzyć.",
          en: "The MGI 2026 data (82%/72%) come from a secondary source (i4a), because the original report could not be opened.",
        },
        sourceIds: ["mgi_2026_i4a"],
      },
      {
        text: {
          pl: "Długie promocje (np. 52 tygodnie) przesuwają churn na moment powrotu do pełnej ceny. Według Mathera (Q2 2025, 86 marek) nawet najlepsza spośród promocji kohorta 52-tygodniowa ma ok. 33% aktywnych w 80. tygodniu.",
          en: "Long promotions (e.g. 52 weeks) shift churn to the moment of return to the full price. According to Mather (Q2 2025, 86 brands), even the best-performing promotional cohort, the 52-week one, has approx. 33% still active in week 80.",
        },
        sourceIds: ["mather_q2_2025_promo"],
      },
      {
        text: {
          pl: "Planów miesięcznych i rocznych nie łącz w jednej liczbie bez wagi przychodowej. Raportuj je osobno.",
          en: "Do not combine monthly and annual plans into one figure without revenue weighting. Report them separately.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "logo_churn_annual.news_b2c_all",
        label: {
          pl: "News/media cyfrowe B2C – cała baza (mieszanka planów miesięcznych i rocznych)",
          en: "Digital news/media B2C – entire base (mix of monthly and annual plans)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "lower",
        method: {
          pl: "Przeliczenie progów miesięcznych 1 − (1 − m)^12, zweryfikowane danymi o kohortach (Piano 2021, FTI 2023). Okres: rocznie (kroczące 12M).",
          en: "Conversion of the monthly thresholds 1 − (1 − m)^12, verified with cohort data (Piano 2021, FTI 2023). Period: annually (rolling 12 months).",
        },
        sourceIds: [
          "mather_sep_2022",
          "mather_q3_2023",
          "mather_q1_2025",
          "digiday_monthly_annual_2023",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 28,
            note: {
              pl: "odpowiada poniżej 2,7%/mies.",
              en: "corresponds to below 2.7%/month",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 28,
            max: 35,
            basis: "B",
          },
          {
            tier: "normal",
            min: 35,
            max: 45,
            note: {
              pl: "przeliczone mediany Mathera 3,53–4,62%/mies., czyli ok. 35–43% rocznie",
              en: "converted Mather medians of 3.53–4.62%/month, i.e. approx. 35–43% annually",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 45,
            max: 58,
            note: {
              pl: "po 1. roku zostaje 46% subskrybentów miesięcznych (Piano 2021; kohorta nowych, nie cała baza)",
              en: "after the 1st year 46% of monthly subscribers remain (Piano 2021; a cohort of new subscribers, not the entire base)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 58,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_annual.news_b2c_annual_plans",
        label: {
          pl: "News/media cyfrowe B2C – plany roczne (churn przy pierwszym odnowieniu)",
          en: "Digital news/media B2C – annual plans (churn at first renewal)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Mediana Piano (2021) i zakres FTI Consulting (2022/23). Granice słaby/krytyczny to heurystyka. Okres: rocznie (na odnowienie).",
          en: "Piano median (2021) and the FTI Consulting range (2022/23). The weak/critical boundaries are a heuristic. Period: annually (per renewal).",
        },
        sourceIds: ["digiday_monthly_annual_2023", "reporterzy_dnr2025", "piano_benchmarks_2024"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 20,
            note: {
              pl: "górny zakres FTI: 80% retencji po 52 tyg.",
              en: "upper end of the FTI range: 80% retention after 52 weeks",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 20,
            max: 26,
            note: {
              pl: "mediana Piano 2021: po roku zostaje 74% subskrybentów rocznych",
              en: "Piano 2021 median: after a year 74% of annual subscribers remain",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 26,
            max: 35,
            note: {
              pl: "FTI: 65–80%; Aftenposten: 71% nowych zostaje dłużej niż rok",
              en: "FTI: 65–80%; Aftenposten: 71% of new subscribers stay longer than a year",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 35,
            max: 50,
            basis: "B",
          },
          {
            tier: "critical",
            min: 50,
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
        id: "logo_churn_annual.b2b_smb",
        label: {
          pl: "SaaS / subskrypcje B2B SMB (plany miesięczne, karta)",
          en: "SaaS / B2B SMB subscriptions (monthly plans, card)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Przeliczenie kwartyli i median miesięcznych (Recurly 2026, ChartMogul – dane historyczne XI 2021–I 2022) oraz średnia roczna Stripe 2024. Okres: rocznie.",
          en: "Conversion of monthly quartiles and medians (Recurly 2026, ChartMogul – historical data Nov 2021–Jan 2022) and the Stripe 2024 annual average. Period: annually.",
        },
        sourceIds: [
          "recurly_churn_benchmarks_2026",
          "chartmogul_good_churn_2022",
          "churnkey_involuntary_2025",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 20,
            note: {
              pl: "odpowiada górnemu kwartylowi Recurly (≤1,78%/mies.)",
              en: "corresponds to the Recurly top quartile (≤1.78%/month)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 20,
            max: 31,
            basis: "B",
          },
          {
            tier: "normal",
            min: 31,
            max: 43,
            note: {
              pl: "mediana Recurly SaaS 3,22%/mies. to ok. 32,5% rocznie; Stripe B2B: 38%",
              en: "the Recurly SaaS median of 3.22%/month is approx. 32.5% annually; Stripe B2B: 38%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 43,
            max: 55,
            note: {
              pl: "mediana ChartMogul przy ARPA < 25 USD: 6,1%/mies. (dane historyczne XI 2021–I 2022), czyli ok. 53% rocznie",
              en: "ChartMogul median at ARPA < USD 25: 6.1%/month (historical data Nov 2021–Jan 2022), i.e. approx. 53% annually",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 55,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_annual.b2b_mid_market",
        label: {
          pl: "B2B mid-market (ACV ok. 12–100 tys. USD)",
          en: "B2B mid-market (ACV approx. USD 12–100k)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Heurystyka zakotwiczona w churnie ARR według długości umowy (KeyBanc 2024: dane churnu za 2023; mediana ARR próby 22,5 mln USD w 2022 i 26 mln USD w 2023) i medianach GRR według ACV (SaaS Capital 2025). Okres: rocznie.",
          en: "Heuristic anchored in ARR churn by contract length (KeyBanc 2024: churn data for 2023; median ARR of the sample USD 22.5m in 2022 and USD 26m in 2023) and in GRR medians by ACV (SaaS Capital 2025). Period: annually.",
        },
        sourceIds: ["keybanc_sapphire_2024", "saascapital_retention_2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 6,
            basis: "E",
          },
          {
            tier: "good",
            min: 6,
            max: 10,
            note: {
              pl: "churn ARR przy umowach rocznych: 10%; ogółem: 7% (KeyBanc 2024; dane churnu za 2023)",
              en: "ARR churn for annual contracts: 10%; overall: 7% (KeyBanc 2024; churn data for 2023)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 15,
            note: {
              pl: "mediana GRR 90–91% oznacza 9–10% utraty przychodu brutto (SaaS Capital)",
              en: "a median GRR of 90–91% means a 9–10% gross revenue loss (SaaS Capital)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 15,
            max: 22,
            basis: "E",
          },
          {
            tier: "critical",
            min: 22,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "logo_churn_annual.b2b_enterprise",
        label: {
          pl: "B2B enterprise (ACV powyżej 100 tys. USD, umowy wieloletnie)",
          en: "B2B enterprise (ACV above USD 100k, multi-year contracts)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Heurystyka zakotwiczona w KeyBanc 2024 (churn według długości kontraktu, dane za 2023) i SaaS Capital 2025 (GRR według ACV). Okres: rocznie.",
          en: "Heuristic anchored in KeyBanc 2024 (churn by contract length, 2023 data) and SaaS Capital 2025 (GRR by ACV). Period: annually.",
        },
        sourceIds: ["keybanc_sapphire_2024", "saascapital_retention_2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 3,
            note: {
              pl: "churn ARR przy umowach 3+ letnich: 3%",
              en: "ARR churn for 3+ year contracts: 3%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 5,
            note: {
              pl: "GRR 95% dla ACV powyżej 250 tys. USD",
              en: "GRR of 95% for ACV above USD 250k",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 5,
            max: 8,
            note: {
              pl: "churn ARR przy umowach 2-letnich: 6%",
              en: "ARR churn for 2-year contracts: 6%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 8,
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
      {
        id: "logo_churn_annual.membership",
        label: {
          pl: "Członkostwa / memberships (stowarzyszenia, kluby, płatne członkostwo think tanku)",
          en: "Memberships (associations, clubs, paid think-tank membership)",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Mediany MGI (2025 i 2026) jako środek przedziału 'normalny'. Pozostałe granice to heurystyka oparta na zakresach i4a. Okres: rocznie.",
          en: "MGI medians (2025 and 2026) as the midpoint of the 'normal' range. The remaining boundaries are a heuristic based on i4a ranges. Period: annually.",
        },
        sourceIds: ["mgi_2025_memberjungle", "mgi_2026_i4a"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 10,
            note: {
              pl: "odnowienia 90%+ (top stowarzyszeń branżowych według i4a)",
              en: "renewals of 90%+ (top trade associations according to i4a)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 10,
            max: 15,
            basis: "E",
          },
          {
            tier: "normal",
            min: 15,
            max: 20,
            note: {
              pl: "mediana MGI: 84% odnowień (2025) i 82% (2026)",
              en: "MGI median: 84% renewals (2025) and 82% (2026)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 20,
            max: 28,
            note: {
              pl: "poziom churnu nowych członków (odnowienia po 1. roku 72–74%)",
              en: "churn level of new members (renewals after the 1st year 72–74%)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 28,
            max: null,
            note: {
              pl: "w zakresie typowym dla non-profit (60–75% odnowień według i4a)",
              en: "within the range typical of non-profits (60–75% renewals according to i4a)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "logo_churn_annual.news_b2c_all",
      b2c_individual: "logo_churn_annual.news_b2c_all",
      b2c_reduced: "logo_churn_annual.news_b2c_all",
      b2b_institution: "logo_churn_annual.b2b_smb",
      membership_club: "logo_churn_annual.membership",
    },
  },
  {
    key: "gross_revenue_churn",
    metricId: "gross_revenue_churn",
    group: "retention",
    abbr: "GRC (gross MRR churn)",
    name: {
      pl: "Churn przychodowy brutto (revenue churn)",
      en: "Gross revenue churn (gross MRR churn)",
    },
    expansion: {
      pl: "GRC – Gross Revenue Churn: utrata przychodu powtarzalnego (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) przez rezygnacje i obniżki planów, bez uwzględniania rozszerzeń.",
      en: "GRC – Gross Revenue Churn: loss of recurring revenue (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) from cancellations and downgrades, excluding expansion.",
    },
    formula: {
      pl: "(MRR utracony przez anulacje + MRR utracony przez downgrade lub nowe rabaty) w okresie, podzielony przez MRR na początku okresu, × 100%. Dla B2B w ujęciu rocznym: GRC = 1 − GRR.",
      en: "(MRR lost through cancellations + MRR lost through downgrades or new discounts) in the period, divided by MRR at the start of the period, × 100%. For B2B on an annual basis: GRC = 1 − GRR.",
    },
    interpretation: {
      pl: "Pokazuje, jaka część powtarzalnego przychodu z istniejących klientów znika przez rezygnacje i obniżki planów, zanim zadziałają upselle. Uzupełnia logo churn: jeśli odchodzą głównie mali klienci, churn przychodowy jest niższy od logo churnu, i odwrotnie. Typowe pułapki: podwyżki cen przy odnowieniu maskują odpływ klientów. Jednorazowe przychody (wydarzenia, sponsoring, raporty na zamówienie) nie powinny trafiać do MRR.",
      en: "Shows what share of recurring revenue from existing customers is lost to cancellations and downgrades before any upsell. It complements logo churn: if mainly small customers leave, revenue churn is lower than logo churn, and vice versa. Common pitfalls: renewal price step-ups mask customer losses, and one-off revenue (events, sponsorship, commissioned reports) must not be booked as MRR.",
    },
    levers: {
      pl: "Ograniczaj utratę przychodu z odejść: odzyskuj nieudane płatności i odnawiaj umowy instytucjonalne z wyprzedzeniem. Ograniczaj kontrakcję: przy zmniejszaniu liczby licencji proponuj elastyczny zakres zamiast rezygnacji. Podwyżki przy odnowieniu wprowadzaj z uzasadnieniem wartości i obserwuj jednocześnie churn logo, bo spadek GRC może ukrywać odejścia klientów. Czytaj GRC razem z QR.",
      en: "Limit revenue lost to cancellations: recover failed payments and renew institutional contracts ahead of time. Limit contraction: when the number of licences is reduced, offer a flexible scope instead of cancellation. Introduce renewal price increases with a clear value case and watch logo churn at the same time, because a falling GRC can hide customer departures. Read GRC together with QR.",
    },
    caveats: [
      {
        text: {
          pl: "Dane ChartMogul o gross MRR churn pochodzą z 2022 r. Nowszych median dla B2C nie znaleziono.",
          en: "ChartMogul gross MRR churn data date from 2022. No newer medians for B2C were found.",
        },
      },
      {
        text: {
          pl: "Piano: podwyżka ceny przy odnowieniu o 15–20% obniżała retencję o 5–8%, a podnosiła przychód o 6–14%. Spadek GRC może więc współistnieć z rosnącym logo churnem.",
          en: "Piano: a price increase at renewal of 15–20% reduced retention by 5–8% while raising revenue by 6–14%. A falling GRC can therefore coexist with rising logo churn.",
        },
      },
      {
        text: {
          pl: "Mediany KeyBanc (n=52–55; mediana ARR próby 22,5 mln USD w 2022 i 26 mln USD w 2023) i Aleph×Benchmarkit (n=226, dużo firm AI/PLG) różnią się o 5–7 pp. Przedziały je uśredniają. W edycji 2025 KeyBanc/Sapphire mediana GRR za 2023 wynosi 86%.",
          en: "The KeyBanc medians (n=52–55; median ARR of the sample USD 22.5m in 2022 and USD 26m in 2023) and Aleph×Benchmarkit (n=226, many AI/PLG companies) differ by 5–7 pp. The ranges average them. In the KeyBanc/Sapphire 2025 edition, the median GRR for 2023 is 86%.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "gross_revenue_churn.b2b_annual",
        label: {
          pl: "B2B SaaS / subskrypcje instytucjonalne (ARR, ujęcie roczne)",
          en: "B2B SaaS / institutional subscriptions (ARR, annual basis)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "Kwartyle GRR z KeyBanc 2024 (P25 82, mediana 89–91, P75 93–95) i Aleph×Benchmarkit CY2025 (76/84/91), przeliczone jako 1 − GRR. Kontrola: mediana SaaS Capital 2025 to 91%. Nowsza kontrola: KeyBanc/Sapphire 2025 (16. edycja, 13.11.2025) – mediana GRR spadła do 86% (2023) i ma zbliżać się do 90%, co wspiera granicę normalny/dobry przy GRC 12%. Progi bez zmian. Okres: rocznie.",
          en: "GRR quartiles from KeyBanc 2024 (P25 82, median 89–91, P75 93–95) and Aleph×Benchmarkit CY2025 (76/84/91), converted as 1 − GRR. Check: the SaaS Capital 2025 median is 91%. Newer check: KeyBanc/Sapphire 2025 (16th edition, 13.11.2025) – the median GRR fell to 86% (2023) and is expected to approach 90%, which supports the normal/good boundary at a GRC of 12%. Thresholds unchanged. Period: annually.",
        },
        sourceIds: [
          "keybanc_sapphire_2024",
          "aleph_benchmarkit_grr_2026",
          "saascapital_retention_2025",
          "keybanc_sapphire_2025",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 8,
            note: {
              pl: "powyżej P75 GRR (91–95%)",
              en: "above P75 GRR (91–95%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 8,
            max: 12,
            note: {
              pl: "między P50 a P75: mediana GRR 89–91% (KeyBanc 2024E, SaaS Capital 2025); Aleph sales-led 88%",
              en: "between P50 and P75: median GRR 89–91% (KeyBanc 2024E, SaaS Capital 2025); Aleph sales-led 88%",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 12,
            max: 18,
            note: {
              pl: "między P25 a P50: Aleph×Benchmarkit 84%, KeyBanc P25 82%",
              en: "between P25 and P50: Aleph×Benchmarkit 84%, KeyBanc P25 82%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 18,
            max: 25,
            note: {
              pl: "poniżej P25 (Aleph×Benchmarkit P25 GRR: 76%)",
              en: "below P25 (Aleph×Benchmarkit P25 GRR: 76%)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 25,
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
        id: "gross_revenue_churn.b2c_monthly",
        label: {
          pl: "B2C subskrypcje cyfrowe (niskie ARPA, MRR, ujęcie miesięczne)",
          en: "B2C digital subscriptions (low ARPA, MRR, monthly basis)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "Heurystyka: mediany logo churn news (Mather) powiększone o typowy downgrade. Górna granica według mediany gross MRR churn ChartMogul (2022) dla najniższego ARPA. Okres: miesięcznie.",
          en: "Heuristic: news logo-churn medians (Mather) increased by typical downgrades. Upper boundary per the ChartMogul gross MRR churn median (2022) for the lowest ARPA. Period: monthly.",
        },
        sourceIds: [
          "chartmogul_churn_cheatsheet_2022",
          "mather_q3_2023",
          "mather_q1_2025",
          "piano_benchmarks_2024",
        ],
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
            max: 4,
            basis: "E",
          },
          {
            tier: "normal",
            min: 4,
            max: 5.5,
            note: {
              pl: "zbliżone do median logo churn news (3,5–4,6%) plus downgrade",
              en: "close to news logo-churn medians (3.5–4.6%) plus downgrades",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 5.5,
            max: 8,
            basis: "E",
          },
          {
            tier: "critical",
            min: 8,
            max: null,
            note: {
              pl: "mediana ChartMogul przy ARPA 0–10 USD to 8,9%/mies. (dane historyczne I–III 2022)",
              en: "the ChartMogul median at ARPA USD 0–10 is 8.9%/month (historical data Jan–Mar 2022)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "gross_revenue_churn.b2c_monthly",
      b2c_individual: "gross_revenue_churn.b2c_monthly",
      b2c_reduced: "gross_revenue_churn.b2c_monthly",
      b2b_institution: "gross_revenue_churn.b2b_annual",
    },
  },
  {
    key: "net_revenue_retention",
    metricId: "net_revenue_retention",
    group: "retention",
    abbr: "NRR (NDR)",
    name: {
      pl: "Retencja przychodu netto",
      en: "Net Revenue Retention (Net Dollar Retention)",
    },
    expansion: {
      pl: "NRR – Net Revenue Retention, NDR – Net Dollar Retention: dwie nazwy tego samego wskaźnika. To przychód zachowany od istniejących klientów, łącznie z rozszerzeniami i podwyżkami, po odjęciu obniżek i odejść.",
      en: "NRR – Net Revenue Retention, NDR – Net Dollar Retention: two names for the same metric. Revenue retained from existing customers including expansion and price increases, net of downgrades and churn.",
    },
    formula: {
      pl: "(ARR na początku okresu + ARR z rozszerzeń, upsellu, cross-sellu i podwyżek − ARR z downgrade − ARR utracony przez odejścia), licząc tylko klientów obecnych na początku okresu, podzielone przez ARR na początku okresu, × 100%. Standardowe okno to 12 miesięcy (np. MRR w grudniu wobec grudnia roku poprzedniego).",
      en: "(ARR at the start of the period + ARR from expansion, upsell, cross-sell and price increases − ARR from downgrades − ARR lost through departures), counting only customers present at the start of the period, divided by ARR at the start of the period, × 100%. The standard window is 12 months (e.g. MRR in December against December of the previous year).",
    },
    interpretation: {
      pl: "Mówi, ile przychodu z kohorty klientów sprzed 12 miesięcy masz dziś. Wartość powyżej 100% oznacza, że baza rośnie bez nowej sprzedaży. NRR silnie koreluje ze wzrostem: według SaaS Capital 2025 firmy z NRR 110–120% rosły o ok. 30% r/r, a z NRR 100–110% o 21%. Typowe pułapki: wskaźnik nie obejmuje nowych klientów i bywa zawyżany jednorazową podwyżką lub jednym dużym klientem. W B2C rzadko przekracza 100%, dlatego porównuj go tylko w obrębie segmentu i przy tym samym oknie.",
      en: "Tells you how much of the revenue from the customer cohort of 12 months ago you still have today. Above 100% means the base grows without new sales. NRR is strongly tied to growth: per SaaS Capital 2025, companies with 110–120% NRR grew about 30% YoY versus 21% at 100–110%. Common pitfalls: it excludes new customers and can be inflated by a one-off price rise or a single large account. In B2C it rarely exceeds 100%, so compare it only within a segment and over the same window.",
    },
    levers: {
      pl: "Rozwijaj klientów instytucjonalnych: dodatkowe licencje dla zespołów, pakiety wydarzeń i raporty w abonamencie. Planuj rozmowę odnowieniową z podsumowaniem wykorzystania i propozycją rozszerzenia. Podwyżki cen przy odnowieniu wiąż z nową wartością. Nie wliczaj jednorazowych sponsoringów do NRR - mierz je osobno.",
      en: "Develop institutional customers: additional licences for teams, event packages and reports included in the subscription. Plan a renewal conversation with a usage summary and an expansion proposal. Link price increases at renewal to new value. Do not count one-off sponsorships towards NRR – measure them separately.",
    },
    caveats: [
      {
        text: {
          pl: "Wysoka pewność dotyczy kontekstów B2B (SaaS Capital, KeyBanc, Aleph×Benchmarkit). Kontekst B2C to heurystyka o niskiej pewności.",
          en: "High confidence applies to the B2B contexts (SaaS Capital, KeyBanc, Aleph×Benchmarkit). The B2C context is a low-confidence heuristic.",
        },
      },
      {
        text: {
          pl: "Mediany różnią się metodyką: SaaS Capital liczy na MRR grudzień do grudnia, KeyBanc na ARR. Aleph×Benchmarkit pokazuje, że model cenowy usage-based ma medianę 108%, a seat-based 98%.",
          en: "The medians differ in methodology: SaaS Capital calculates on MRR December to December, KeyBanc on ARR. Aleph×Benchmarkit shows that a usage-based pricing model has a median of 108% and a seat-based one 98%.",
        },
      },
      {
        text: {
          pl: "Dla think tanku NRR B2B rośnie głównie przez dodatkowe licencje, pakiety wydarzeń i raporty w abonamencie. Jednorazowe sponsoringi nie powinny podnosić NRR.",
          en: "For a think tank, B2B NRR rises mainly through additional licences, event packages and reports included in the subscription. One-off sponsorships should not raise NRR.",
        },
      },
      {
        text: {
          pl: "ChartMogul AI Retention Report (2025) obejmuje firmy z co najmniej 250 tys. USD ARR; mediana B2C SaaS 49% to najnowszy publiczny punkt odniesienia dla B2C.",
          en: "The ChartMogul AI Retention Report (2025) covers companies with at least USD 250k ARR; the B2C SaaS median of 49% is the latest public reference point for B2C.",
        },
      },
      {
        text: {
          pl: "SaaS Capital 2025: dane według ACV i kwartyle wykluczają firmy poniżej 1 mln USD ARR; okno pomiaru to MRR XII 2023 → XII 2024 (dane za 2024, publikacja 18.09.2025).",
          en: "SaaS Capital 2025: the data by ACV and the quartiles exclude companies below USD 1m ARR; the measurement window is MRR Dec 2023 → Dec 2024 (2024 data, published 18.09.2025).",
        },
      },
    ],
    direction: "higher",
    confidence: "high",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "net_revenue_retention.b2b_all",
        label: {
          pl: "B2B SaaS / subskrypcje B2B – ogółem",
          en: "B2B SaaS / B2B subscriptions – overall",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "Kwartyle Aleph×Benchmarkit CY2025 (P25 92, P50 102, P75 108–110 – strona niespójna), zweryfikowane z KeyBanc 2024E (96/101/109) i medianą SaaS Capital 2025 (101%). Granicę 'optymalny' pozostawiono na 110 (zbieżna z KeyBanc 109 i SaaS Capital). KeyBanc/Sapphire 2025: NRR nadal 'above 100%'. Okres: rocznie (okno 12M).",
          en: "Aleph×Benchmarkit CY2025 quartiles (P25 92, P50 102, P75 108–110 – the page is inconsistent), checked against KeyBanc 2024E (96/101/109) and the SaaS Capital 2025 median (101%). The 'optimal' boundary was left at 110 (consistent with KeyBanc 109 and SaaS Capital). KeyBanc/Sapphire 2025: NRR still 'above 100%'. Period: annually (12-month window).",
        },
        sourceIds: [
          "aleph_benchmarkit_nrr_2026",
          "keybanc_sapphire_2024",
          "saascapital_retention_2025",
          "keybanc_sapphire_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 85,
            note: {
              pl: "heurystyka; firmy z NRR poniżej 90% rosły w medianie o 15% (SaaS Capital)",
              en: "heuristic; companies with NRR below 90% grew by a median of 15% (SaaS Capital)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 85,
            max: 92,
            note: {
              pl: "poniżej P25 (Aleph×Benchmarkit CY2025: 92%)",
              en: "below P25 (Aleph×Benchmarkit CY2025: 92%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 92,
            max: 102,
            note: {
              pl: "P25–P50; mediana 101–102% (SaaS Capital, KeyBanc, Aleph×Benchmarkit)",
              en: "P25–P50; median 101–102% (SaaS Capital, KeyBanc, Aleph×Benchmarkit)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 102,
            max: 110,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 110,
            max: null,
            note: {
              pl: "powyżej P75 (Aleph×Benchmarkit P75 108–110% – strona podaje raz 110%, raz 108%; KeyBanc 2024E 109%)",
              en: "above P75 (Aleph×Benchmarkit P75 108–110% – the page gives 110% once and 108% once; KeyBanc 2024E 109%)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "net_revenue_retention.b2b_smb",
        label: {
          pl: "B2B ACV poniżej 12 tys. USD (SMB; typowe abonamenty instytucjonalne think tanku)",
          en: "B2B ACV below USD 12k (SMB; typical institutional think-tank subscriptions)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "Kwartyle SaaS Capital 2025 dla ACV < 12 tys. USD (P25 90, P50 98, P75 106). Okres: rocznie (okno 12M).",
          en: "SaaS Capital 2025 quartiles for ACV < USD 12k (P25 90, P50 98, P75 106). Period: annually (12-month window).",
        },
        sourceIds: ["saascapital_retention_2025", "aleph_benchmarkit_nrr_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 85,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 85,
            max: 90,
            note: {
              pl: "poniżej P25 (90%)",
              en: "below P25 (90%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 90,
            max: 98,
            note: {
              pl: "P25–P50; mediana 98% (Aleph×Benchmarkit dla ACV < 5 tys. USD: również 98%)",
              en: "P25–P50; median 98% (Aleph×Benchmarkit for ACV < USD 5k: also 98%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 98,
            max: 106,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 106,
            max: null,
            note: {
              pl: "powyżej P75 (106%)",
              en: "above P75 (106%)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "net_revenue_retention.b2b_mid_market",
        label: {
          pl: "B2B mid-market (ACV 12–100 tys. USD)",
          en: "B2B mid-market (ACV USD 12–100k)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "Uśrednione kwartyle SaaS Capital 2025: ACV 12–25 tys. (98/103/115), 25–50 tys. (97/102/111) i 50–100 tys. USD (96/104/110). Okres: rocznie (okno 12M).",
          en: "Averaged SaaS Capital 2025 quartiles: ACV USD 12–25k (98/103/115), 25–50k (97/102/111) and 50–100k (96/104/110). Period: annually (12-month window).",
        },
        sourceIds: ["saascapital_retention_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 90,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 90,
            max: 97,
            note: {
              pl: "poniżej P25 (96–98%)",
              en: "below P25 (96–98%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 97,
            max: 103,
            note: {
              pl: "P25–P50 (mediany 102–104%)",
              en: "P25–P50 (medians 102–104%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 103,
            max: 111,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 111,
            max: null,
            note: {
              pl: "powyżej P75 (110–115%)",
              en: "above P75 (110–115%)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "net_revenue_retention.b2b_enterprise",
        label: {
          pl: "B2B enterprise (ACV powyżej 100 tys. USD)",
          en: "B2B enterprise (ACV above USD 100k)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "Kwartyle SaaS Capital 2025: ACV 100–250 tys. (94/102/109) i powyżej 250 tys. USD (102/106/110). Okres: rocznie (okno 12M).",
          en: "SaaS Capital 2025 quartiles: ACV USD 100–250k (94/102/109) and above USD 250k (102/106/110). Period: annually (12-month window).",
        },
        sourceIds: ["saascapital_retention_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 92,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 92,
            max: 98,
            note: {
              pl: "poniżej P25 (94–102%)",
              en: "below P25 (94–102%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 98,
            max: 104,
            note: {
              pl: "P25–P50 (mediany 102–106%)",
              en: "P25–P50 (medians 102–106%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 104,
            max: 110,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 110,
            max: null,
            note: {
              pl: "powyżej P75 (109–110%)",
              en: "above P75 (109–110%)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "net_revenue_retention.b2c_low_arpa",
        label: {
          pl: "B2C subskrypcje cyfrowe (niskie ARPA)",
          en: "B2C digital subscriptions (low ARPA)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "ltm",
        direction: "higher",
        method: {
          pl: "Mediana NRR B2C SaaS z ChartMogul AI Retention Report (dane 2025: 49%; dla porównania B2B SaaS 82%) i górny kwartyl ChartMogul 2023 (65,1% przy ARPA < 10 USD/mies.; tylko 2,7% takich firm przekracza 100%). Pozostałe granice to heurystyka; pewność niska. Okres: rocznie (okno 12M).",
          en: "B2C SaaS NRR median from the ChartMogul AI Retention Report (2025 data: 49%; for comparison B2B SaaS 82%) and the ChartMogul 2023 top quartile (65.1% at ARPA < USD 10/month; only 2.7% of such companies exceed 100%). The remaining boundaries are a heuristic; low confidence. Period: annually (12-month window).",
        },
        sourceIds: [
          "chartmogul_ai_retention_2025",
          "chartmogul_retention_report_2023",
          "mather_q3_2023",
          "mather_q1_2025",
          "piano_benchmarks_2024",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 40,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 40,
            max: 50,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 50,
            max: 65,
            note: {
              pl: "mediana ChartMogul 2025 dla B2C SaaS: 49% (na granicy słaby/normalny); wydawca z churnem ok. 3,8–4,6%/mies. i podwyżkami przy odnowieniu ma ok. 57–65%",
              en: "ChartMogul 2025 median for B2C SaaS: 49% (on the weak/normal boundary); a publisher with churn of approx. 3.8–4.6%/month and price increases at renewal has approx. 57–65%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 65,
            max: 80,
            note: {
              pl: "górny kwartyl ChartMogul 2023 przy ARPA < 10 USD: 65,1%",
              en: "ChartMogul 2023 top quartile at ARPA < USD 10: 65.1%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 80,
            max: null,
            note: {
              pl: "osiągalne przy podwyżkach przy odnowieniu i niskim churnie",
              en: "achievable with price increases at renewal and low churn",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "net_revenue_retention.b2c_low_arpa",
      b2c_individual: "net_revenue_retention.b2c_low_arpa",
      b2c_reduced: "net_revenue_retention.b2c_low_arpa",
      b2b_institution: "net_revenue_retention.b2b_smb",
    },
  },
  {
    key: "gross_revenue_retention",
    metricId: "gross_revenue_retention",
    group: "retention",
    abbr: "GRR (GDR)",
    name: {
      pl: "Retencja przychodu brutto",
      en: "Gross Revenue Retention (Gross Dollar Retention)",
    },
    expansion: {
      pl: "GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: przychód zachowany od istniejących klientów po odjęciu odejść i obniżek, bez rozszerzeń. Maksimum to 100%.",
      en: "GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: revenue kept from existing customers after churn and downgrades, excluding expansion. Capped at 100%.",
    },
    formula: {
      pl: "(ARR na początku okresu − ARR utracony przez odejścia − ARR utracony przez downgrade) / ARR na początku okresu × 100%. Rozszerzeń, upsellu i podwyżek nie wliczasz, więc wynik nie przekracza 100%.",
      en: "(ARR at the start of the period − ARR lost through departures − ARR lost through downgrades) / ARR at the start of the period × 100%. Expansion, upsell and price increases are not included, so the result does not exceed 100%.",
    },
    interpretation: {
      pl: "Odsetek przychodu powtarzalnego zachowanego po odjęciu odejść i obniżek, bez upselli. To miara 'szczelności' bazy i jakości produktu oraz obsługi. SaaS Capital traktuje GRR co najmniej 90% jako warunek konieczny ('table stakes') porównywalnych wyników w B2B. Typowe pułapki: wynik powyżej 100% oznacza, że liczysz NRR. W umowach wieloletnich odpływ ujawnia się skokowo przy końcu kontraktu, więc patrz na trend z kilku lat.",
      en: "Share of recurring revenue kept after churn and downgrades, ignoring upsell. It measures how 'leak-proof' the base is and reflects product and service quality. SaaS Capital treats GRR of at least 90% as table stakes for peer-level B2B performance. Common pitfalls: a result above 100% means you are computing NRR, and with multi-year contracts losses show up in steps at contract end, so read the multi-year trend.",
    },
    levers: {
      pl: "Proponuj instytucjom umowy roczne i wieloletnie zamiast miesięcznych - długość kontraktu wyraźnie wpływa na GRR. Monitoruj wykorzystanie licencji i reaguj, zanim klient zmniejszy zakres. Ograniczaj churn mimowolny sprawną windykacją i fakturami z przypomnieniem. Raportuj GRR osobno dla B2C i B2B, bo poziomy obu segmentów nie są porównywalne.",
      en: "Offer institutions annual and multi-year contracts instead of monthly ones – contract length clearly affects GRR. Monitor licence usage and act before a customer reduces scope. Limit involuntary churn with efficient dunning and invoices with reminders. Report GRR separately for B2C and B2B, because the levels of the two segments are not comparable.",
    },
    caveats: [
      {
        text: {
          pl: "Aleph×Benchmarkit (CY2025) pokazuje spadek mediany GRR z 88% do 84%, a KeyBanc (2024E) 91%. Różnica wynika z próby: Aleph×Benchmarkit ma więcej firm PLG i AI-native, KeyBanc więcej firm z dużą sprzedażą enterprise.",
          en: "Aleph×Benchmarkit (CY2025) shows the median GRR falling from 88% to 84%, and KeyBanc (2024E) 91%. The difference stems from the sample: Aleph×Benchmarkit has more PLG and AI-native companies, KeyBanc more companies with large enterprise sales.",
        },
      },
      {
        text: {
          pl: "Kontekst B2C to heurystyka (pewność niska). Mediany churnu news (3,8–4,62%/mies.) odpowiadają GRR ok. 57–63%, czyli granicy normalny/dobry.",
          en: "The B2C context is a heuristic (low confidence). News churn medians (3.8–4.62%/month) correspond to a GRR of approx. 57–63%, i.e. the normal/good boundary.",
        },
      },
      {
        text: {
          pl: "SaaS Capital: umowy wieloletnie mają GRR 94%, roczne 90%, a miesięczne 89%. Długość kontraktu w ofercie B2B think tanku istotnie wpływa na GRR.",
          en: "SaaS Capital: multi-year contracts have a GRR of 94%, annual ones 90% and monthly ones 89%. Contract length in a think tank's B2B offer has a significant effect on GRR.",
        },
      },
      {
        text: {
          pl: "KeyBanc/Sapphire 2025 (13.11.2025): mediana GRR za 2023 to 86% (wobec 89% w edycji 2024), z oczekiwanym powrotem w okolice 90%.",
          en: "KeyBanc/Sapphire 2025 (13.11.2025): the median GRR for 2023 is 86% (against 89% in the 2024 edition), with an expected return to around 90%.",
        },
      },
      {
        text: {
          pl: "SaaS Capital 2025: mediany według ACV wykluczają firmy poniżej 1 mln USD ARR; okno pomiaru to MRR XII 2023 → XII 2024 (dane za 2024).",
          en: "SaaS Capital 2025: medians by ACV exclude companies below USD 1m ARR; the measurement window is MRR Dec 2023 → Dec 2024 (2024 data).",
        },
      },
    ],
    direction: "higher",
    confidence: "high",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "gross_revenue_retention.b2b_all",
        label: {
          pl: "B2B SaaS / subskrypcje B2B – ogółem",
          en: "B2B SaaS / B2B subscriptions – overall",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Kwartyle Aleph×Benchmarkit CY2025 (76/84/91) i KeyBanc 2024E (82/91/95) oraz mediana SaaS Capital 2025 (91%). Nowsza kontrola: KeyBanc/Sapphire 2025 (16. edycja, 13.11.2025) – mediana GRR spadła do 86% (2023) i ma zbliżać się do 90%. Progi bez zmian. Okres: rocznie.",
          en: "Aleph×Benchmarkit CY2025 (76/84/91) and KeyBanc 2024E (82/91/95) quartiles and the SaaS Capital 2025 median (91%). Newer check: KeyBanc/Sapphire 2025 (16th edition, 13.11.2025) – the median GRR fell to 86% (2023) and is expected to approach 90%. Thresholds unchanged. Period: annually.",
        },
        sourceIds: [
          "aleph_benchmarkit_grr_2026",
          "keybanc_sapphire_2024",
          "saascapital_retention_2025",
          "keybanc_sapphire_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 75,
            note: {
              pl: "heurystyka; poniżej dolnego kwartyla Aleph×Benchmarkit",
              en: "heuristic; below the Aleph×Benchmarkit lower quartile",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 75,
            max: 82,
            note: {
              pl: "P25: 76% (Aleph×Benchmarkit), 82% (KeyBanc)",
              en: "lower quartile (P25): 76% (Aleph×Benchmarkit), 82% (KeyBanc)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 82,
            max: 88,
            note: {
              pl: "P25–P50: mediana 84% (Aleph×Benchmarkit CY2025), sales-led 88%",
              en: "P25–P50: median 84% (Aleph×Benchmarkit CY2025), sales-led 88%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 88,
            max: 92,
            note: {
              pl: "mediana 89–91% (KeyBanc, SaaS Capital); próg 90% 'table stakes'",
              en: "median 89–91% (KeyBanc, SaaS Capital); 90% as the minimum entry threshold",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 92,
            max: null,
            note: {
              pl: "P75: 91% (Aleph×Benchmarkit), 93–95% (KeyBanc)",
              en: "upper quartile (P75): 91% (Aleph×Benchmarkit), 93–95% (KeyBanc)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "gross_revenue_retention.b2b_smb",
        label: {
          pl: "B2B ACV poniżej 12 tys. USD (SMB, abonamenty instytucjonalne)",
          en: "B2B ACV below USD 12k (SMB, institutional subscriptions)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Mediany SaaS Capital 2025 i Aleph×Benchmarkit CY2025 dla najniższych ACV. Granice to heurystyka, bo kwartyli dla tego przedziału nie publikowano. Okres: rocznie.",
          en: "SaaS Capital 2025 and Aleph×Benchmarkit CY2025 medians for the lowest ACVs. The boundaries are a heuristic, because quartiles for this bracket were not published. Period: annually.",
        },
        sourceIds: ["saascapital_retention_2025", "aleph_benchmarkit_grr_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 72,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 72,
            max: 80,
            note: {
              pl: "mediana dla ACV < 5 tys. USD: 80% (Aleph×Benchmarkit)",
              en: "median for ACV < USD 5k: 80% (Aleph×Benchmarkit)",
            },
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
            max: 92,
            note: {
              pl: "mediana SaaS Capital dla ACV < 12 tys. USD: 90%",
              en: "SaaS Capital median for ACV < USD 12k: 90%",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 92,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "gross_revenue_retention.b2b_enterprise",
        label: {
          pl: "B2B enterprise (ACV powyżej 100 tys. USD)",
          en: "B2B enterprise (ACV above USD 100k)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Mediany SaaS Capital 2025 według ACV i górny kwartyl KeyBanc 2024. Skrajne granice to heurystyka. Okres: rocznie.",
          en: "SaaS Capital 2025 medians by ACV and the KeyBanc 2024 top quartile. The extreme boundaries are a heuristic. Period: annually.",
        },
        sourceIds: [
          "saascapital_retention_2025",
          "keybanc_sapphire_2024",
          "aleph_benchmarkit_grr_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 85,
            basis: "E",
          },
          {
            tier: "weak",
            min: 85,
            max: 90,
            basis: "B",
          },
          {
            tier: "normal",
            min: 90,
            max: 93,
            note: {
              pl: "mediana 91% (ACV 100–250 tys. USD); Aleph×Benchmarkit dla 50–100 tys. USD: 91%",
              en: "median 91% (ACV USD 100–250k); Aleph×Benchmarkit for USD 50–100k: 91%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 93,
            max: 96,
            note: {
              pl: "mediana 95% (ACV powyżej 250 tys. USD); P75 KeyBanc 93–95%",
              en: "median 95% (ACV above USD 250k); KeyBanc P75 93–95%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 96,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "gross_revenue_retention.b2c_low_arpa",
        label: {
          pl: "B2C subskrypcje cyfrowe (niskie ARPA)",
          en: "B2C digital subscriptions (low ARPA)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Górny kwartyl GRR ChartMogul 2023 dla ARPA < 50 USD/mies. (60–70%) wyznacza przedział 'dobry', a jego górna granica (70%) próg 'optymalny' (konwencja P75 = próg 'optymalny'). Mediany churnu news Mather (3,8–4,62%/mies.) przeliczone na rok dają GRR ok. 57–63%. Heurystyka, pewność niska. Okres: rocznie.",
          en: "The ChartMogul 2023 top GRR quartile for ARPA < USD 50/month (60–70%) defines the 'good' range, and its upper boundary (70%) the 'optimal' threshold (convention: P75 = 'optimal' threshold). Mather news churn medians (3.8–4.62%/month) converted to an annual figure give a GRR of approx. 57–63%. Heuristic, low confidence. Period: annually.",
        },
        sourceIds: [
          "chartmogul_retention_report_2023",
          "chartmogul_ai_retention_2025",
          "mather_q3_2023",
          "mather_q1_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 40,
            note: {
              pl: "heurystyka; ChartMogul 2025: GRR AI-native < 50 USD to 23%, 'o 20 pkt gorzej' niż SaaS B2B/B2C",
              en: "heuristic; ChartMogul 2025: GRR of AI-native products < USD 50 is 23%, '20 points worse' than B2B/B2C SaaS",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 40,
            max: 50,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 50,
            max: 60,
            note: {
              pl: "mediany churnu news (3,8–4,62%/mies.) dają GRR ok. 57–63%",
              en: "news churn medians (3.8–4.62%/month) give a GRR of approx. 57–63%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 60,
            max: 70,
            note: {
              pl: "górny kwartyl ChartMogul 2023 przy ARPA < 50 USD: 60–70%",
              en: "ChartMogul 2023 top quartile at ARPA < USD 50: 60–70%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 70,
            max: null,
            note: {
              pl: "od górnej granicy górnego kwartyla ChartMogul 2023 (70%)",
              en: "from the upper boundary of the ChartMogul 2023 top quartile (70%)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "gross_revenue_retention.b2c_low_arpa",
      b2c_individual: "gross_revenue_retention.b2c_low_arpa",
      b2c_reduced: "gross_revenue_retention.b2c_low_arpa",
      b2b_institution: "gross_revenue_retention.b2b_smb",
    },
  },
  {
    key: "involuntary_churn_share",
    metricId: "involuntary_churn_share",
    group: "retention",
    abbr: "Invol. churn %",
    name: {
      pl: "Udział churnu mimowolnego",
      en: "Involuntary churn share",
    },
    expansion: {
      pl: "Churn mimowolny (involuntary, pasywny) to utrata subskrypcji wskutek nieudanej płatności (wygasła lub zablokowana karta, brak środków, odmowa banku), a nie decyzji klienta.",
      en: "Involuntary (passive) churn is losing a subscription because a payment failed (expired or blocked card, insufficient funds, bank decline), not because the customer chose to leave.",
    },
    formula: {
      pl: "Subskrypcje zakończone z powodu nieodzyskanej płatności w okresie / wszystkie subskrypcje zakończone w okresie × 100%. Uzupełniająco: miesięczny churn mimowolny = odejścia z powodu płatności / baza płacących na początku miesiąca.",
      en: "Subscriptions ended because of an unrecovered payment in the period / all subscriptions ended in the period × 100%. Supplementary: monthly involuntary churn = departures caused by payment / paying base at the start of the month.",
    },
    interpretation: {
      pl: "Pokazuje, jaka część odejść wynika z nieudanych płatności, a nie z decyzji klienta. Wysoki udział to zwykle problem operacyjny (ponowienia, aktualizacja kart, przypomnienia), który naprawia się szybciej i taniej niż wartość produktu. Typowe pułapki: przy płatnościach bez automatycznego odnowienia (przelew, jednorazowy BLIK, faktura) churn mimowolny 'przebiera się' za brak odnowienia. Niski udział może też wynikać po prostu z bardzo wysokiego churnu dobrowolnego.",
      en: "Shows what part of churn comes from failed payments rather than customer decisions. A high share is usually an operational problem (retries, card updating, reminders) that is faster and cheaper to fix than product value. Common pitfalls: with non-recurring payment methods (bank transfer, one-off BLIK, invoices) involuntary churn masquerades as non-renewal, and a low share may simply reflect very high voluntary churn.",
    },
    levers: {
      pl: "Włącz inteligentne ponawianie płatności i automatyczną aktualizację kart. Wysyłaj przypomnienie przed odnowieniem i po nieudanej płatności, z linkiem do zmiany metody. Oferuj metody popularne w Polsce: cykliczny BLIK i fakturę z terminem dla instytucji. Mierz osobno nieopłacone faktury B2B, bo ich odzyskanie wymaga kontaktu, a nie ponowienia obciążenia karty.",
      en: "Enable smart payment retries and automatic card updates. Send a reminder before renewal and after a failed payment, with a link to change the payment method. Offer methods popular in Poland: recurring BLIK and invoices with payment terms for institutions. Measure unpaid B2B invoices separately, because recovering them requires contact rather than another card charge attempt.",
    },
    caveats: [
      {
        text: {
          pl: "Recurly (2026) szacuje udział churnu mimowolnego na 20–40% całego churnu. Rozrzut zależy od metod płatności i ceny.",
          en: "Recurly (2026) estimates the share of involuntary churn at 20–40% of all churn. The spread depends on payment methods and price.",
        },
      },
      {
        text: {
          pl: "W Polsce popularne są BLIK, przelew i faktura. Bez tokenizacji karty lub cyklicznego BLIK churn mimowolny trzeba mierzyć jako 'nieopłacone odnowienie' albo 'przeterminowana faktura'. Publicznego benchmarku PL brak.",
          en: "In Poland BLIK, bank transfer and invoices are popular. Without card tokenisation or recurring BLIK, involuntary churn has to be measured as an 'unpaid renewal' or an 'overdue invoice'. There is no public PL benchmark.",
        },
      },
      {
        text: {
          pl: "Dane WAN-IFRA (Seattle Times, Boston Globe) są z 2018 r. i mają charakter historyczny.",
          en: "The WAN-IFRA data (Seattle Times, Boston Globe) date from 2018 and are historical.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "involuntary_churn_share.news_b2c",
        label: {
          pl: "News/media cyfrowe B2C (płatności kartowe cykliczne)",
          en: "Digital news/media B2C (recurring card payments)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "Rozkład udziałów z Piano (2024 i 2026; udział pasywny wyliczony z podanego udziału churnu aktywnego), Recurly 2026 (wyliczone: mimowolny / całkowity), Stripe 2024 (via Churnkey) i przypadków wydawców (WAN-IFRA 2018). Okres: miesięcznie lub kwartalnie (udział w odejściach okresu).",
          en: "Distribution of shares from Piano (2024 and 2026; the passive share calculated from the stated share of active churn), Recurly 2026 (calculated: involuntary / total), Stripe 2024 (via Churnkey) and publisher cases (WAN-IFRA 2018). Period: monthly or quarterly (share of departures in the period).",
        },
        sourceIds: [
          "piano_benchmarks_2024",
          "piano_benchmark_update_2026",
          "recurly_churn_benchmarks_2026",
          "churnkey_involuntary_2025",
          "twipe_wanifra_2018",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 15,
            basis: "B",
          },
          {
            tier: "good",
            min: 15,
            max: 22,
            note: {
              pl: "Boston Globe obniżył udział z 50% do 20% (2018)",
              en: "the Boston Globe cut the share from 50% to 20% (2018)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 22,
            max: 32,
            note: {
              pl: "Piano 2024: 29% churnu pasywnego; Stripe: digital goods 29%, B2C 24%; Piano 2026: ok. 25% w serwisach z aktywną prewencją churnu (wyliczone: 100 − 75% churnu aktywnego)",
              en: "Piano 2024: 29% passive churn; Stripe: digital goods 29%, B2C 24%; Piano 2026: approx. 25% at sites with active churn prevention (calculated: 100 − 75% active churn)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 32,
            max: 45,
            note: {
              pl: "Recurly digital media: 1,59/4,14 ≈ 38%; Piano 2026: ok. 42% w serwisach bez aktywnej prewencji (wyliczone: 100 − 58% churnu aktywnego)",
              en: "Recurly digital media: 1.59/4.14 ≈ 38%; Piano 2026: approx. 42% at sites without active prevention (calculated: 100 − 58% active churn)",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 45,
            max: null,
            note: {
              pl: "Seattle Times: 62% churnu cyfrowego to awarie kart (2018)",
              en: "Seattle Times: 62% of digital churn was card failures (2018)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "involuntary_churn_share.b2b_card",
        label: {
          pl: "B2B SaaS / subskrypcje B2B (karta)",
          en: "B2B SaaS / B2B subscriptions (card)",
        },
        segments: ["b2b_institution"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "Średnie Stripe 2024 (via Churnkey) według modelu i AOV (średniej wartości zamówienia) oraz udziały wyliczone z median Recurly 2026. Granice to heurystyka. Okres: miesięcznie lub kwartalnie.",
          en: "Stripe 2024 averages (via Churnkey) by model and AOV (average order value) and shares calculated from Recurly 2026 medians. The boundaries are a heuristic. Period: monthly or quarterly.",
        },
        sourceIds: ["churnkey_involuntary_2025", "recurly_churn_benchmarks_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 10,
            note: {
              pl: "Recurly ARPC powyżej 250 USD: 0,18/3,07–3,54 ≈ 5–6% (strona podaje łączny churn raz 3,07%, raz 3,54%)",
              en: "Recurly ARPC above USD 250: 0.18/3.07–3.54 ≈ 5–6% (the page gives total churn once as 3.07% and once as 3.54%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 10,
            max: 16,
            note: {
              pl: "Stripe: B2B 16%, AOV (średnia wartość zamówienia) 1–10 tys. USD 15%",
              en: "Stripe: B2B 16%, AOV (average order value) USD 1–10k: 15%",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 16,
            max: 24,
            note: {
              pl: "Stripe: SaaS 22%",
              en: "Stripe: 22% for SaaS",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 24,
            max: 35,
            note: {
              pl: "Recurly SaaS: 1,06/3,22 ≈ 33%",
              en: "Recurly SaaS: 1.06/3.22 ≈ 33%",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 35,
            max: null,
            note: {
              pl: "heurystyka; Stripe: AOV (średnia wartość zamówienia) poniżej 10 USD 35%",
              en: "heuristic; Stripe: AOV (average order value) below USD 10: 35%",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "involuntary_churn_share.news_b2c",
      b2c_individual: "involuntary_churn_share.news_b2c",
      b2c_reduced: "involuntary_churn_share.news_b2c",
      b2b_institution: "involuntary_churn_share.b2b_card",
    },
  },
  {
    key: "dunning_recovery_rate",
    metricId: "dunning_recovery_rate",
    group: "retention",
    abbr: "Recovery rate",
    name: {
      pl: "Skuteczność odzyskiwania nieudanych płatności (dunning recovery rate)",
      en: "Dunning (failed-payment) recovery rate",
    },
    expansion: {
      pl: "Dunning to proces odzyskiwania nieudanych płatności cyklicznych: ponowienia obciążeń (retries), automatyczna aktualizacja kart (account updater), e-maile i SMS-y oraz komunikat w produkcie.",
      en: "Dunning is the process of recovering failed recurring payments: charge retries, card account updater, emails/SMS and in-product payment walls.",
    },
    formula: {
      pl: "Wartość (lub liczba) nieudanych płatności cyklicznych odzyskanych w oknie odzyskiwania (np. 30 dni) / wartość (lub liczba) wszystkich nieudanych płatności cyklicznych w tym okresie × 100%. Licz kohortowo po zamknięciu okna i podawaj, czy liczysz po wartości, czy po liczbie.",
      en: "Value (or number) of failed recurring payments recovered within the recovery window (e.g. 30 days) / value (or number) of all failed recurring payments in that period × 100%. Calculate by cohort after the window closes and state whether you count by value or by number.",
    },
    interpretation: {
      pl: "Odsetek nieudanych płatności cyklicznych odzyskanych przed utratą subskrypcji. Według Recurly ok. 90% odzysków następuje w pierwszych 10 dniach, więc liczy się szybkość i inteligentne terminy ponowień. Typowe pułapki: dostawcy liczą różnie (wartość lub liczba, okno 14/30/60 dni, czy wliczać 'miękkie' odmowy rozwiązane przed kontaktem z klientem). Porównuj tylko przy tej samej definicji.",
      en: "Share of failed recurring payments recovered before the subscription is lost. Per Recurly about 90% of recoveries happen in the first 10 days, so speed and smart retry timing matter. Common pitfalls: vendors define it differently (value vs count, 14/30/60-day window, whether soft declines resolved before contacting the customer count), so compare only like-for-like definitions.",
    },
    levers: {
      pl: "Łącz metody odzysku: inteligentne ponawianie, aktualizację kart, e-mail lub SMS z linkiem do płatności i komunikat po zalogowaniu. Ustal harmonogram kontaktów w oknie odzysku i zakończ go jasną informacją o zawieszeniu dostępu. Dla instytucji prowadź osobny proces faktur z przypomnieniami terminów. Licz odzysk kohortowo po zamknięciu okna - raz według wartości, raz według liczby.",
      en: "Combine recovery methods: smart retries, card updates, email or SMS with a payment link and an in-product message after login. Set a contact schedule within the recovery window and end it with clear notice that access will be suspended. For institutions, run a separate invoice process with due-date reminders. Calculate recovery by cohort after the window closes – once by value and once by number.",
    },
    caveats: [
      {
        text: {
          pl: "Prawie wszystkie liczby pochodzą od dostawców narzędzi (Stripe, Recurly, Churnkey) i są deklaracjami bez pełnej metodologii.",
          en: "Almost all figures come from tool vendors (Stripe, Recurly, Churnkey) and are declarations without a full methodology.",
        },
        sourceIds: ["stripe_billing", "recurly_failed_payment_2026", "churnkey_sor_2025"],
      },
      {
        text: {
          pl: "Churnkey (State of Retention 2025): kampanie e-mail/SMS same w sobie odzyskują średnio 42%.",
          en: "Churnkey (State of Retention 2025): email/SMS campaigns on their own recover 42% on average.",
        },
        sourceIds: ["churnkey_sor_2025"],
      },
      {
        text: {
          pl: "Dla faktur B2B (przelew) zamiast tego wskaźnika licz odsetek faktur opłaconych w ciągu 30/60 dni od terminu.",
          en: "For B2B invoices (bank transfer), instead of this rate calculate the share of invoices paid within 30/60 days of the due date.",
        },
      },
      {
        text: {
          pl: "Publicznych benchmarków dla polskich operatorów płatności (PayU, Przelewy24, cykliczny BLIK) nie znaleziono.",
          en: "No public benchmarks were found for Polish payment operators (PayU, Przelewy24, recurring BLIK).",
        },
      },
      {
        text: {
          pl: "Stripe: w 2025 r. odzyskano 8,2 mld USD nieudanych płatności (wartość bezwzględna, nie wskaźnik odzysku).",
          en: "Stripe: in 2025, USD 8.2bn of failed payments were recovered (an absolute value, not a recovery rate).",
        },
        sourceIds: ["stripe_billing"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "dunning_recovery_rate.card_subscriptions",
        label: {
          pl: "Subskrypcje kartowe B2C i B2B (wszystkie metody łącznie: retries, account updater, e-mail/SMS, komunikat w produkcie)",
          en: "B2C and B2B card subscriptions (all methods combined: retries, account updater, email/SMS, in-product message)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Średnie deklarowane przez dostawców (Stripe, Churnkey/Stripe 2024), zakresy Recurly 2026 oraz przypadki: FT (2025) i duży detalista enterprise u Recurly (71%). Granice słaby/krytyczny to heurystyka. Okres: miesięcznie (kohorta nieudanych płatności, okno 30 dni).",
          en: "Averages declared by vendors (Stripe, Churnkey/Stripe 2024), Recurly 2026 ranges and cases: FT (2025) and a large enterprise retailer at Recurly (71%). The weak/critical boundaries are a heuristic. Period: monthly (cohort of failed payments, 30-day window).",
        },
        sourceIds: [
          "stripe_billing",
          "churnkey_involuntary_2025",
          "recurly_failed_payment_2026",
          "ftstrategies_retention_2025",
          "churnkey_sor_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 30,
            note: {
              pl: "heurystyka: brak inteligentnych ponowień lub komunikacji",
              en: "heuristic: no smart retries or communication",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 45,
            note: {
              pl: "heurystyka; poniżej poziomu samych domyślnych ponowień",
              en: "heuristic; below the level of default retries alone",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 45,
            max: 60,
            note: {
              pl: "Stripe: średnio 55%; same Smart Retries 51%; punkt wyjścia 'low-to-mid 50s' (Recurly)",
              en: "Stripe: 55% on average; Smart Retries alone 51%; a starting point in the 'low-to-mid 50s' (Recurly)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 60,
            max: 70,
            note: {
              pl: "FT: 66%",
              en: "FT: 66%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 70,
            max: null,
            note: {
              pl: "Recurly: 71% po optymalizacji to jeden przypadek dużego detalisty enterprise, a nie średnia; osiągalny poziom według Recurly 'high 60s to low 70s'; Churnkey: ok. 70% przy trzech metodach",
              en: "Recurly: 71% after optimisation is a single case of a large enterprise retailer, not an average; achievable level according to Recurly 'high 60s to low 70s'; Churnkey: approx. 70% with three methods",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "dunning_recovery_rate.card_subscriptions",
    },
  },
  {
    key: "cancellation_save_rate",
    metricId: "cancellation_save_rate",
    group: "retention",
    abbr: "Save rate",
    name: {
      pl: "Wskaźnik zatrzymań w ścieżce anulowania (save rate)",
      en: "Cancellation-flow save rate",
    },
    expansion: {
      pl: "Save rate to odsetek osób, które rozpoczęły rezygnację (cancellation flow) i zostały zatrzymane ofertą: pauzą, downgrade'em, rabatem lub zmianą planu.",
      en: "Save rate is the share of people who started cancelling (cancellation flow) and were retained by an offer: pause, downgrade, discount or plan change.",
    },
    formula: {
      pl: "Sesje anulowania zakończone przyjęciem oferty, po których klient jest nadal aktywny po 30 (lub 60) dniach / wszystkie rozpoczęte sesje anulowania × 100%.",
      en: "Cancellation sessions ending with an accepted offer after which the customer is still active after 30 (or 60) days / all started cancellation sessions × 100%.",
    },
    interpretation: {
      pl: "Odsetek osób w ścieżce rezygnacji zatrzymanych ofertą. Mierzy jakość ścieżki anulowania i dopasowanie ofert do powodów odejścia. Typowe pułapki: osoby zatrzymane rabatem często odchodzą przy kolejnym odnowieniu, więc licz save rate netto (aktywni po 60–90 dniach) razem z kosztem w ARPU. Utrudnianie rezygnacji (dark patterns) podnosi wskaźnik krótkoterminowo, ale niesie ryzyko prawne i reputacyjne.",
      en: "Share of people in the cancellation flow who were retained by an offer. It measures the quality of the cancel flow and how well offers match churn reasons. Common pitfalls: discount-saved customers often leave at the next renewal, so track net save rate (still active after 60–90 days) together with its ARPU cost. Making cancellation hard (dark patterns) inflates the rate short-term but carries legal and reputational risk.",
    },
    levers: {
      pl: "W ścieżce rezygnacji zapytaj o powód i dopasuj jedną uczciwą propozycję: pauzę, tańszy plan albo zmianę zakresu - zawsze z widocznym przyciskiem rezygnacji (DSA art. 25, UOKiK). Testuj warianty propozycji, mierząc zatrzymanych aktywnych po 30-60 dniach, a nie samą akceptację. Licz koszt rabatów retencyjnych w ARPU. Wnioski z powodów rezygnacji przekazuj redakcji i zespołowi wydarzeń.",
      en: "In the cancellation flow, ask for the reason and match one fair offer: a pause, a cheaper plan or a change of scope – always with a visible cancel button (DSA Art. 25, UOKiK). Test offer variants by measuring customers still active after 30–60 days, not acceptance alone. Count the cost of retention discounts in ARPU. Pass insights from cancellation reasons on to the editorial and events teams.",
    },
    caveats: [
      {
        text: {
          pl: "Kontekst SaaS/aplikacje to heurystyka bez kotwicy w danych (pewność niska). Kontekst news opiera się na zweryfikowanych, ale pojedynczych punktach odniesienia (FT 3% → 6%, Piano 6–16%, Star Tribune 18,5%).",
          en: "The SaaS/apps context is a heuristic with no anchor in data (low confidence). The news context is based on verified but individual reference points (FT 3% → 6%, Piano 6–16%, Star Tribune 18.5%).",
        },
      },
      {
        text: {
          pl: "Churnkey: wśród przyjętych ofert dominują rabaty (53–54%; strona podaje 53,9% i 53%), pauza to ok. 19%, a zmiana planu ok. 7%. Rabaty obniżają ARPU, więc mierz też przychód netto z zatrzymanych.",
          en: "Churnkey: discounts dominate among accepted offers (53–54%; the page gives 53.9% and 53%), a pause is approx. 19% and a plan change approx. 7%. Discounts lower ARPU, so also measure net revenue from retained customers.",
        },
        sourceIds: ["churnkey_sor_2025"],
      },
      {
        text: {
          pl: "Prawo UE i PL ogranicza utrudnianie rezygnacji (zakaz dark patterns, np. art. 25 DSA dla platform; prawo konsumenckie, UOKiK). Ścieżkę anulowania warto skonsultować z prawnikiem.",
          en: "EU and PL law restricts making cancellation difficult (ban on dark patterns, e.g. Art. 25 DSA for platforms; consumer law, UOKiK). It is worth consulting a lawyer about the cancellation flow.",
        },
      },
      {
        text: {
          pl: "Według Recurly użycie pauzy wzrosło o 337% u czołowych sprzedawców (strona nie podaje okresu ani bazy porównania). Pauzę warto mierzyć osobno (odsetek powrotów po pauzie).",
          en: "According to Recurly, use of pausing rose by 337% at leading merchants (the page gives neither the period nor the comparison base). It is worth measuring pausing separately (share of returns after a pause).",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "cancellation_save_rate.news_b2c",
        label: {
          pl: "News/media cyfrowe B2C (samoobsługowe anulowanie online)",
          en: "Digital news/media B2C (self-service online cancellation)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Punkty odniesienia wydawców: FT (2025), Piano (2024) i Star Tribune (case study ProsperStack). Granice łączą te wartości. Okres: miesięcznie (kohorta sesji anulowania).",
          en: "Publisher reference points: FT (2025), Piano (2024) and Star Tribune (ProsperStack case study). The boundaries combine these values. Period: monthly (cohort of cancellation sessions).",
        },
        sourceIds: [
          "ftstrategies_retention_2025",
          "piano_benchmarks_2024",
          "prosperstack_startribune",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 3,
            note: {
              pl: "poziom FT przed przebudową ścieżki (3%); Piano: sama ankieta daje 0%",
              en: "FT level before the redesign of the flow (3%); Piano: a survey alone yields 0%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 3,
            max: 6,
            basis: "B",
          },
          {
            tier: "normal",
            min: 6,
            max: 12,
            note: {
              pl: "FT po przebudowie: 6%; Piano: oferta downgrade 6–16%",
              en: "FT after the redesign: 6%; Piano: downgrade offer 6–16%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 12,
            max: 18,
            note: {
              pl: "Piano: do 16% zatrzymanych",
              en: "Piano: up to 16% retained",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 18,
            max: null,
            note: {
              pl: "Star Tribune: 18,5% po 15 testach A/B",
              en: "Star Tribune: 18.5% after 15 A/B tests",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "cancellation_save_rate.saas_cancel_flow",
        label: {
          pl: "SaaS i aplikacje subskrypcyjne z dedykowanym narzędziem cancel flow (B2C, B2B SMB)",
          en: "SaaS and subscription apps with a dedicated cancel-flow tool (B2C, B2B SMB)",
        },
        segments: ["b2b_institution", "b2c_individual"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka (pewność niska). Brak niezależnych danych o save rate netto (aktywni po 30–60 dniach). Churnkey podaje tylko wartości łączne (ok. 3 mln sesji anulowania, 'nearly two million' uratowanych subskrypcji; ratowanie 20–40% przychodu zagrożonego churnem). Te proporcje nie są save rate w sensie definicji wskaźnika, więc nie kotwiczą progów. Okres: miesięcznie.",
          en: "Heuristic (low confidence). No independent data on net save rate (active after 30–60 days). Churnkey gives only aggregate values (approx. 3 million cancellation sessions, 'nearly two million' saved subscriptions; saving 20–40% of revenue at risk of churn). These proportions are not a save rate in the sense of the metric's definition, so they do not anchor the thresholds. Period: monthly.",
        },
        sourceIds: ["churnkey_sor_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
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
            max: 20,
            basis: "E",
          },
          {
            tier: "good",
            min: 20,
            max: 30,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 30,
            max: null,
            note: {
              pl: "heurystyka (pewność niska); brak publicznej kotwicy save rate netto",
              en: "heuristic (low confidence); no public anchor for net save rate",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cancellation_save_rate.news_b2c",
      b2c_individual: "cancellation_save_rate.news_b2c",
      b2c_reduced: "cancellation_save_rate.news_b2c",
      b2b_institution: "cancellation_save_rate.saas_cancel_flow",
    },
  },
  {
    key: "winback_rate_12m",
    metricId: "winback_rate_12m",
    group: "retention",
    abbr: "Winback rate",
    name: {
      pl: "Wskaźnik odzyskania byłych klientów (winback / reaktywacja w 12 mies.)",
      en: "Winback (reactivation) rate within 12 months",
    },
    expansion: {
      pl: "Winback to odzyskanie klienta, który odszedł. Reaktywacja to ponowny zakup płatnej subskrypcji przez byłego subskrybenta.",
      en: "Winback means recovering a churned customer. Reactivation is a former subscriber buying a paid subscription again.",
    },
    formula: {
      pl: "Byli subskrybenci z kohorty odejść w miesiącu M, którzy ponownie wykupili płatną subskrypcję w ciągu 12 miesięcy / liczba odejść w kohorcie M × 100%.",
      en: "Former subscribers from the cohort of departures in month M who bought a paid subscription again within 12 months / number of departures in cohort M × 100%.",
    },
    interpretation: {
      pl: "Pokazuje, jaki odsetek osób, które odeszły w danym miesiącu, wraca do płatnej subskrypcji w ciągu roku. Byli subskrybenci to często największa pula potencjalnych klientów: według INMA (wartość niezweryfikowana, strona zwraca HTTP 403) mediana marka newsowa straciła 1,7 raza więcej subskrypcji, niż ma aktywnych. Typowe pułapki: powroty na głęboki rabat i 'seryjni churnerzy' zawyżają wynik, więc raportuj osobno powracających, którzy płacą pełną cenę po promocji.",
      en: "Shows what share of a month's churned customers return to a paid subscription within a year. Former subscribers are often the biggest prospect pool: per INMA (unverified, the page returns HTTP 403) the median news brand has lost 1.7x more subscriptions than it has active. Common pitfalls: returns on deep discounts and serial churners inflate the rate, so report separately those who pay full price after the promo.",
    },
    levers: {
      pl: "Zbuduj ścieżkę powrotu dla byłych subskrybentów: przypomnienia o nowych raportach i wydarzeniach w pierwszych tygodniach po rezygnacji, potem rzadziej. Proponuj powrót bez kary - z zachowaną historią konta i preferencjami newslettera. Segmentuj według powodu odejścia: cena, brak czasu, wartość treści. Identyfikuj byłych klientów w CRM po adresie e-mail, aby nie liczyć powrotów jako nowych klientów.",
      en: "Build a return path for former subscribers: reminders of new reports and events in the first weeks after cancellation, then less often. Offer a return without penalty – with account history and newsletter preferences preserved. Segment by reason for leaving: price, lack of time, value of content. Identify former customers in the CRM by email address so that returns are not counted as new customers.",
    },
    caveats: [
      {
        text: {
          pl: "RevenueCat dotyczy aplikacji mobilnych i web i nie podaje okna czasowego reaktywacji. Dla wydawców news brak publicznego benchmarku winback.",
          en: "RevenueCat concerns mobile and web apps and does not state the reactivation time window. There is no public winback benchmark for news publishers.",
        },
      },
      {
        text: {
          pl: "INMA w modelowaniu użyło miesięcznej reaktywacji 4,8% zaczerpniętej z telekomunikacji, a nie z danych wydawców. Wartość niezweryfikowana (strona zwraca HTTP 403, potwierdzone ponownie).",
          en: "In its modelling INMA used a monthly reactivation of 4.8% taken from telecommunications, not from publisher data. The value is unverified (the page returns HTTP 403, confirmed again).",
        },
        sourceIds: ["inma_churn_growth_engine"],
      },
      {
        text: {
          pl: "Do deduplikacji 'byłych' klientów potrzebna jest identyfikacja osoby (e-mail, login, token karty) w CRM.",
          en: "Deduplicating 'former' customers requires identifying the person (email, login, card token) in the CRM.",
        },
      },
      {
        text: {
          pl: "Wartości INMA (1,7x, ok. 21 mies., 136 marek) są niezweryfikowane (HTTP 403); nie opiera się na nich żadna granica przedziału.",
          en: "The INMA values (1.7x, approx. 21 months, 136 brands) are unverified (HTTP 403); no range boundary relies on them.",
        },
        sourceIds: ["inma_past_subscribers_2025"],
      },
      {
        text: {
          pl: "ChartMogul (The SaaS Winbacks Report, 2026) nie definiuje okna ani mianownika winback rate, więc kontekst B2B SaaS to heurystyka o niskiej pewności.",
          en: "ChartMogul (The SaaS Winbacks Report, 2026) defines neither the window nor the denominator of the winback rate, so the B2B SaaS context is a low-confidence heuristic.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "winback_rate_12m.b2c_monthly_plans",
        label: {
          pl: "Subskrypcje cyfrowe B2C – plany miesięczne",
          en: "B2C digital subscriptions – monthly plans",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_12m",
        direction: "higher",
        method: {
          pl: "Średnia RevenueCat SOSA 2026 (20,1%) jako granica normalny/dobry, poziom drogich planów miesięcznych (28,9%) jako próg 'optymalny'. Wartość SOSA 2025 (13,7%) mieści się w przedziale 'normalny'. Granice poniżej średniej to heurystyka. Okres: kohorta odejść; okno do 12 mies.",
          en: "The RevenueCat SOSA 2026 average (20.1%) as the normal/good boundary, the level of expensive monthly plans (28.9%) as the 'optimal' threshold. The SOSA 2025 value (13.7%) falls within the 'normal' range. Boundaries below the average are a heuristic. Period: departure cohort; window up to 12 months.",
        },
        sourceIds: ["revenuecat_reactivation_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 6,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 6,
            max: 12,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 12,
            max: 20,
            note: {
              pl: "RevenueCat SOSA 2025: 13,7% (poprzedni poziom średni)",
              en: "RevenueCat SOSA 2025: 13.7% (previous average level)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 20,
            max: 28,
            note: {
              pl: "RevenueCat SOSA 2026: 20,1% (typowo 18–24%) jako granica normalny/dobry",
              en: "RevenueCat SOSA 2026: 20.1% (typically 18–24%) as the normal/good boundary",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 28,
            max: null,
            note: {
              pl: "drogie plany miesięczne: 28,9%; kategoria produktywności: 36,1%",
              en: "expensive monthly plans: 28.9%; productivity category: 36.1%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "winback_rate_12m.b2c_annual_plans",
        label: {
          pl: "Subskrypcje cyfrowe B2C – plany roczne",
          en: "B2C digital subscriptions – annual plans",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_12m",
        direction: "higher",
        method: {
          pl: "Zakres typowy RevenueCat (SOSA 2026). Pozostałe granice to heurystyka. Okres: kohorta odejść; okno do 12 mies.",
          en: "Typical RevenueCat range (SOSA 2026). The remaining boundaries are a heuristic. Period: departure cohort; window up to 12 months.",
        },
        sourceIds: ["revenuecat_reactivation_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2,
            basis: "E",
          },
          {
            tier: "weak",
            min: 2,
            max: 4,
            basis: "E",
          },
          {
            tier: "normal",
            min: 4,
            max: 6,
            note: {
              pl: "RevenueCat: typowo 4–6% dla planów rocznych",
              en: "RevenueCat: typically 4–6% for annual plans",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 6,
            max: 9,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 9,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "winback_rate_12m.b2b_saas",
        label: {
          pl: "B2B SaaS (logo; kohorta odejść)",
          en: "B2B SaaS (logo; departure cohort)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_12m",
        direction: "higher",
        method: {
          pl: "Heurystyka wokół median winback rate według ARR (ChartMogul, The SaaS Winbacks Report 2026: 7/9/11/13%). Raport nie definiuje okna ani mianownika; mediana czasu powrotu to 38 dni, 66% powracających wraca w ciągu 90 dni, ok. 10% po roku. Pewność niska. Okres: kohorta odejść; okno niezdefiniowane w źródle (porównuj z oknem do 12 mies.).",
          en: "Heuristic around the winback-rate medians by ARR (ChartMogul, The SaaS Winbacks Report 2026: 7/9/11/13%). The report defines neither the window nor the denominator; the median time to return is 38 days, 66% of returners come back within 90 days, approx. 10% after a year. Low confidence. Period: departure cohort; window undefined in the source (compare with a window of up to 12 months).",
        },
        sourceIds: ["chartmogul_saas_winbacks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 4,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 4,
            max: 7,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 7,
            max: 10,
            note: {
              pl: "mediany ChartMogul: ARR < 500 tys. USD 7%, ARR 0,5–10 mln USD 9%",
              en: "ChartMogul medians: ARR < USD 500k 7%, ARR USD 0.5–10m 9%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 10,
            max: 13,
            note: {
              pl: "mediana ChartMogul przy ARR 10–30 mln USD: 11%",
              en: "ChartMogul median at ARR USD 10–30m: 11%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 13,
            max: null,
            note: {
              pl: "mediana ChartMogul przy ARR > 30 mln USD: 13%",
              en: "ChartMogul median at ARR > USD 30m: 13%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "winback_rate_12m.b2c_monthly_plans",
      b2c_individual: "winback_rate_12m.b2c_monthly_plans",
      b2c_reduced: "winback_rate_12m.b2c_monthly_plans",
      b2b_institution: "winback_rate_12m.b2b_saas",
    },
  },
  {
    key: "returning_subscriber_share",
    metricId: "returning_subscriber_share",
    group: "retention",
    abbr: "Returning share",
    name: {
      pl: "Udział powracających w nowych subskrypcjach",
      en: "Returning subscribers' share of new sign-ups",
    },
    expansion: {
      pl: "Odsetek nowych płatnych aktywacji pochodzących od byłych subskrybentów (reaktywacje) wśród wszystkich nowych aktywacji.",
      en: "Share of new paid activations that come from former subscribers (reactivations) among all new activations.",
    },
    formula: {
      pl: "Nowe płatne aktywacje od osób, które wcześniej miały płatną subskrypcję / wszystkie nowe płatne aktywacje w okresie × 100%.",
      en: "New paid activations from people who previously had a paid subscription / all new paid activations in the period × 100%.",
    },
    interpretation: {
      pl: "Pokazuje, jaka część nowej sprzedaży pochodzi od byłych subskrybentów. Umiarkowany udział świadczy o skutecznym winbacku, a bardzo wysoki o uzależnieniu od 'seryjnych churnerów' i słabej akwizycji nowych osób. Typowe pułapki: wskaźnik wymaga deduplikacji osób między kontami, bez niej jest zaniżony. Porównuj go razem z churnem i ceną płaconą przez powracających.",
      en: "Shows how much of new sales comes from former subscribers. A moderate share signals effective winback, while a very high one signals dependence on serial churners and weak acquisition of new people. Common pitfalls: it needs cross-account identity deduplication (otherwise it is understated); read it together with churn and the price returning users pay.",
    },
    levers: {
      pl: "Utrzymuj kontakt z byłymi subskrybentami przez newsletter i zaproszenia na otwarte wydarzenia, aby pula powrotów nie wygasała. Pilnuj równowagi: przy wysokim udziale powrotów wzmacniaj akwizycję nowych czytelników. Odróżniaj powroty po promocji od powrotów po pełnej cenie, aby wykryć seryjnie rezygnujących. Powracającym proponuj plan roczny.",
      en: "Stay in touch with former subscribers through the newsletter and invitations to open events so that the pool of potential returns does not dry up. Keep the balance: with a high share of returns, strengthen acquisition of new readers. Distinguish returns after a promotion from returns at full price in order to detect serial churners. Offer returning customers an annual plan.",
    },
    caveats: [
      {
        text: {
          pl: "Recurly nie podaje rozkładu według branż na stronie publicznej. Wartość 1 na 4 dotyczy całej sieci (ok. 76 mln subskrybentów), a strona nie podaje jej okresu ani bazy.",
          en: "Recurly does not give a breakdown by industry on its public page. The 1 in 4 value concerns the whole network (approx. 76 million subscribers), and the page states neither its period nor its base.",
        },
      },
      {
        text: {
          pl: "Brak publicznych danych dla wydawców news i dla Polski.",
          en: "There are no public data for news publishers or for Poland.",
        },
      },
    ],
    direction: "range",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "returning_subscriber_share.b2c_digital",
        label: {
          pl: "Subskrypcje cyfrowe B2C (media, news, treści eksperckie)",
          en: "B2C digital subscriptions (media, news, expert content)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "month",
        direction: "range",
        method: {
          pl: "Średnia sieci Recurly (State of Subscriptions 2026, wszystkie branże) jako środek przedziału docelowego. Pozostałe granice to heurystyka. Okres: miesięcznie lub kwartalnie.",
          en: "The Recurly network average (State of Subscriptions 2026, all industries) as the midpoint of the target range. The remaining boundaries are a heuristic. Period: monthly or quarterly.",
        },
        sourceIds: ["recurly_sos_2026"],
        bands: [
          {
            tier: "weak",
            min: null,
            max: 10,
            note: {
              pl: "niewykorzystana pula byłych klientów",
              en: "untapped pool of former customers",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 18,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 18,
            max: 30,
            note: {
              pl: "Recurly 2026: ok. 1 na 4 nowe zapisy to powracający subskrybenci",
              en: "Recurly 2026: approx. 1 in 4 new sign-ups are returning subscribers",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 30,
            max: 40,
            note: {
              pl: "sprawdź, czy rośnie udział seryjnych churnerów",
              en: "check whether the share of serial churners is rising",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 40,
            max: null,
            note: {
              pl: "uzależnienie od powrotów; słaba akwizycja nowych",
              en: "dependence on returns; weak acquisition of new customers",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "returning_subscriber_share.b2c_digital",
      b2c_individual: "returning_subscriber_share.b2c_digital",
      b2c_reduced: "returning_subscriber_share.b2c_digital",
    },
  },
  {
    key: "cohort_retention_m1",
    metricId: "cohort_retention_m1",
    group: "retention",
    abbr: "M1 retention",
    name: {
      pl: "Retencja kohorty po 1 miesiącu",
      en: "Month-1 cohort retention",
    },
    expansion: {
      pl: "M1 to pierwszy miesiąc życia kohorty, czyli moment pierwszego odnowienia. Kohorta to grupa klientów, którzy zaczęli płacić w tym samym miesiącu.",
      en: "M1 is the first month of a cohort's life (the first renewal). A cohort is the group of customers who started paying in the same month.",
    },
    formula: {
      pl: "Subskrybenci z kohorty startu (miesiąc pierwszej płatnej transakcji) nadal aktywni i płacący po pierwszym odnowieniu (dzień 30–35) / liczebność kohorty × 100%. Triale i oferty wprowadzające licz jako osobne kohorty.",
      en: "Subscribers from the start cohort (month of the first paid transaction) still active and paying after the first renewal (day 30–35) / cohort size × 100%. Count trials and introductory offers as separate cohorts.",
    },
    interpretation: {
      pl: "Odsetek nowej kohorty płacących, którzy przeszli pierwsze odnowienie. To najwcześniejszy sygnał dopasowania oferty i onboardingu. Churn jest najwyższy na samym początku: według Piano 13% wszystkich wyłączeń automatycznego odnowienia przypada na pierwszy dzień, a 40% na pierwsze 60 dni. Typowe pułapki: kohortę definiuj od pierwszej płatnej transakcji, a triale i oferty za 1 zł/1 € analizuj osobno, bo ich retencja jest wielokrotnie niższa.",
      en: "Share of a new paying cohort that survives the first renewal. It is the earliest signal of offer fit and onboarding quality. Churn peaks at the very start: per Piano, 13% of all auto-renew disablements happen on day one and 40% within 60 days. Common pitfalls: define the cohort from the first paid transaction, and analyse trials and 1-unit intro offers separately because their retention is many times lower.",
    },
    levers: {
      pl: "Zaplanuj pierwsze 30 dni: powitanie, przewodnik po raportach i archiwum, zaproszenie na najbliższe wydarzenie lub webinar. Przed pierwszym odnowieniem przypomnij, co subskrybent otrzymał, i jasno podaj kwotę, jeśli kończy się oferta wprowadzająca. Mierz kohorty z ofert wprowadzających osobno. Rezygnacja w pierwszym miesiącu ma być równie prosta jak zakup.",
      en: "Plan the first 30 days: a welcome, a guide to reports and the archive, an invitation to the next event or webinar. Before the first renewal, remind subscribers what they have received and state the amount clearly if an introductory offer is ending. Measure cohorts from introductory offers separately. Cancelling in the first month must be as simple as buying.",
    },
    caveats: [
      {
        text: {
          pl: "Dane RevenueCat dotyczą aplikacji (często z ofertami wprowadzającymi) i są punktem odniesienia dolnego, nie normą dla subskrypcji web wydawcy.",
          en: "RevenueCat data concern apps (often with introductory offers) and are a lower reference point, not a norm for a publisher's web subscriptions.",
        },
      },
      {
        text: {
          pl: "Piano 2026: płatne triale to ponad 60% ofert miesięcznych (typowo 1 USD/1 € za miesiąc). Ich M1 licz do pierwszej płatności po pełnej cenie.",
          en: "Piano 2026: paid trials account for over 60% of monthly offers (typically USD 1/EUR 1 for a month). Count their M1 up to the first payment at full price.",
        },
      },
      {
        text: {
          pl: "Reuters Institute (2023): niskie oferty wprowadzające skutecznie przyciągają, ale wielu subskrybentów nie widzi wartości przy odnowieniu po pełnej cenie.",
          en: "Reuters Institute (2023): low introductory offers attract effectively, but many subscribers do not see the value at renewal at full price.",
        },
        sourceIds: ["reuters_paying_news_2023"],
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "cohort_retention_m1.news_b2c_monthly",
        label: {
          pl: "News/media cyfrowe B2C – plan miesięczny, sprzedaż web, cena pełna lub umiarkowany rabat",
          en: "Digital news/media B2C – monthly plan, web sales, full price or moderate discount",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "Heurystyka: churn steady-state 3,8–4,62%/mies. (mediany Mather 2023–2025) powiększony o typowo wyższy odpływ w pierwszych tygodniach (Piano 2024; WAN-IFRA/Die Welt 2018). Brak publicznej mediany M1 dla wydawców. Okres: kohorta miesięczna.",
          en: "Heuristic: steady-state churn of 3.8–4.62%/month (Mather medians 2023–2025) increased by the typically higher outflow in the first weeks (Piano 2024; WAN-IFRA/Die Welt 2018). No public M1 median for publishers. Period: monthly cohort.",
        },
        sourceIds: [
          "mather_q3_2023",
          "mather_q1_2025",
          "piano_benchmarks_2024",
          "twipe_wanifra_2018",
          "ftstrategies_retention_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 70,
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
            max: 88,
            basis: "E",
          },
          {
            tier: "good",
            min: 88,
            max: 93,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 93,
            max: null,
            note: {
              pl: "bliskie churnowi 'steady-state' (3–5%/mies.)",
              en: "close to 'steady-state' churn (3–5%/month)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "cohort_retention_m1.media_apps",
        label: {
          pl: "Aplikacje subskrypcyjne Media & Entertainment – plan miesięczny, pierwsze odnowienie (punkt odniesienia)",
          en: "Media & Entertainment subscription apps – monthly plan, first renewal (reference point)",
        },
        segments: ["b2c_individual"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "Kwartyle RevenueCat (SOSA 2026): P25 41%, mediana 58%, P75 72%. Granica krytyczna to heurystyka. Okres: kohorta miesięczna.",
          en: "RevenueCat quartiles (SOSA 2026): P25 41%, median 58%, P75 72%. The critical boundary is a heuristic. Period: monthly cohort.",
        },
        sourceIds: ["revenuecat_renewal_rates_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 30,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 41,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 41,
            max: 58,
            note: {
              pl: "P25–P50",
              en: "P25 to median (P50)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 58,
            max: 72,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 72,
            max: null,
            note: {
              pl: "powyżej P75",
              en: "above P75",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cohort_retention_m1.news_b2c_monthly",
      b2c_individual: "cohort_retention_m1.news_b2c_monthly",
      b2c_reduced: "cohort_retention_m1.news_b2c_monthly",
    },
  },
  {
    key: "cohort_retention_m3",
    metricId: "cohort_retention_m3",
    group: "retention",
    abbr: "M3 retention",
    name: {
      pl: "Retencja kohorty po 3 miesiącach",
      en: "Month-3 cohort retention",
    },
    expansion: {
      pl: "M3 to trzeci miesiąc życia kohorty, czyli udział klientów nadal aktywnych po 3 odnowieniach miesięcznych lub po ok. 90 dniach.",
      en: "M3 is the third month of a cohort's life: the share still active after 3 monthly renewals or about 90 days.",
    },
    formula: {
      pl: "Subskrybenci z kohorty startu nadal aktywni i płacący po 3 miesiącach (ok. 90. dzień) / liczebność kohorty × 100%.",
      en: "Subscribers from the start cohort still active and paying after 3 months (approx. day 90) / cohort size × 100%.",
    },
    interpretation: {
      pl: "Odsetek kohorty nadal aktywnej po 3 miesiącach. Po tym okresie odpływ zwykle się stabilizuje: w Die Welt ok. połowa nowych odchodziła w ciągu 3 miesięcy, potem churn spadał do 1–2% miesięcznie. Wskaźnik mierzy, czy subskrybent zbudował nawyk (newsletter, aplikacja, regularne wizyty). Typowe pułapki: porównuj kohorty z tą samą ofertą wejściową i kanałem, bo koniec 3-miesięcznej promocji tworzy sztuczny klif retencji.",
      en: "Share of a cohort still active after 3 months. Attrition usually stabilises afterwards: at Die Welt about half of new subscribers left within 3 months, after which churn fell to 1–2% a month. It measures whether the subscriber built a habit (newsletter, app, regular visits). Common pitfalls: compare cohorts with the same entry offer and channel, because the end of a 3-month promo creates an artificial retention cliff.",
    },
    levers: {
      pl: "Utrwalaj nawyk do trzeciego miesiąca: regularny newsletter z analizami, powiadomienia o nowych raportach z obszarów zainteresowań, udział w wydarzeniu lub klubie dyskusyjnym. Wykrywaj nieaktywnych subskrybentów i zapraszaj ich do konkretnych treści. Dla instytucji mierz aktywację licencji w pierwszych 90 dniach i zorganizuj krótkie szkolenie z korzystania z serwisu.",
      en: "Reinforce the habit up to the third month: a regular newsletter with analysis, notifications about new reports in areas of interest, participation in an event or a discussion club. Detect inactive subscribers and invite them to specific content. For institutions, measure licence activation in the first 90 days and run a short onboarding session on using the service.",
    },
    caveats: [
      {
        text: {
          pl: "Brak aktualnej (2024–2026) publicznej mediany M3 dla wydawców news. Dane Die Welt są z 2018 r.",
          en: "There is no current (2024–2026) public M3 median for news publishers. The Die Welt data date from 2018.",
        },
      },
      {
        text: {
          pl: "Raport ChartMogul obejmuje kohorty 2021–2022.",
          en: "The ChartMogul report covers the 2021–2022 cohorts.",
        },
      },
      {
        text: {
          pl: "Dla B2B z umowami rocznymi M3 jest mało informatywny. Lepiej mierzyć aktywację i użycie licencji w pierwszych 90 dniach.",
          en: "For B2B with annual contracts, M3 is of little informative value. It is better to measure activation and licence usage in the first 90 days.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "cohort_retention_m3.news_b2c_monthly",
        label: {
          pl: "News/media cyfrowe B2C – plan miesięczny (płatni)",
          en: "Digital news/media B2C – monthly plan (paying)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m3",
        direction: "higher",
        method: {
          pl: "Heurystyka zakotwiczona w przypadku Die Welt (WAN-IFRA 2018), churnie steady-state wydawców (Mather) i rozkładzie wyłączeń auto-odnowienia (Piano 2024). Okres: kohorta miesięczna.",
          en: "Heuristic anchored in the Die Welt case (WAN-IFRA 2018), publishers' steady-state churn (Mather) and the distribution of auto-renewal opt-outs (Piano 2024). Period: monthly cohort.",
        },
        sourceIds: ["twipe_wanifra_2018", "mather_q3_2023", "piano_benchmarks_2024"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 50,
            note: {
              pl: "Die Welt 2018: ok. połowa nowych odchodziła w 3 mies.",
              en: "Die Welt 2018: approx. half of new subscribers left within 3 months",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 50,
            max: 65,
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
        id: "cohort_retention_m3.b2b_new_logos",
        label: {
          pl: "B2B SaaS / subskrypcje B2B – nowi klienci (logo)",
          en: "B2B SaaS / B2B subscriptions – new customers (logo)",
        },
        segments: ["b2b_institution"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m3",
        direction: "higher",
        method: {
          pl: "Górny kwartyl ChartMogul 2023 jako próg 'optymalny'. Pozostałe granice to heurystyka. Okres: kohorta miesięczna.",
          en: "The ChartMogul 2023 top quartile as the 'optimal' threshold. The remaining boundaries are a heuristic. Period: monthly cohort.",
        },
        sourceIds: ["chartmogul_retention_report_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 70,
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
            max: 87,
            note: {
              pl: "ASP (średnia cena sprzedaży) < 10 USD/mies.: 87% (dla porównania)",
              en: "ASP (average selling price) < USD 10/month: 87% (for comparison)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 87,
            max: 90,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 90,
            max: null,
            note: {
              pl: "górny kwartyl ChartMogul: 90%; 93% przy ARR 15–30 mln USD; 98% przy ASP (średniej cenie sprzedaży) > 500 USD/mies.",
              en: "ChartMogul top quartile: 90%; 93% at ARR USD 15–30m; 98% at ASP (average selling price) > USD 500/month",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cohort_retention_m3.news_b2c_monthly",
      b2c_individual: "cohort_retention_m3.news_b2c_monthly",
      b2c_reduced: "cohort_retention_m3.news_b2c_monthly",
      b2b_institution: "cohort_retention_m3.b2b_new_logos",
    },
  },
  {
    key: "cohort_retention_m12",
    metricId: "cohort_retention_m12",
    group: "retention",
    abbr: "M12 retention",
    name: {
      pl: "Retencja kohorty po 12 miesiącach",
      en: "Month-12 cohort retention",
    },
    expansion: {
      pl: "M12 to dwunasty miesiąc życia kohorty, czyli udział klientów nadal aktywnych po roku. Dla planów rocznych i członkostw to wynik pierwszego odnowienia (first-year renewal).",
      en: "M12 is the twelfth month of a cohort's life: the share still active after a year. For annual plans and memberships it equals the first-year renewal rate.",
    },
    formula: {
      pl: "Subskrybenci z kohorty startu nadal aktywni i płacący po 12 miesiącach / liczebność kohorty × 100%. Dla planów rocznych i członkostw: odnowieni po 1. roku / wszyscy, którym upłynął 1. rok.",
      en: "Subscribers from the start cohort still active and paying after 12 months / cohort size × 100%. For annual plans and memberships: renewed after the 1st year / all whose 1st year has ended.",
    },
    interpretation: {
      pl: "Odsetek kohorty aktywnej po roku. To kluczowy wskaźnik dla LTV i jakości pozyskania. W news B2C plany roczne utrzymują po roku ok. 1,6 raza więcej subskrybentów niż miesięczne (Piano 2021: 74% wobec 46%). Typowe pułapki: przy planach rocznych M12 to wynik pierwszego odnowienia, więc nie porównuj go 1:1 z planami miesięcznymi. Długie promocje przesuwają klif retencji na moment powrotu do pełnej ceny.",
      en: "Share of a cohort still active after a year, a key driver of LTV and acquisition quality. In B2C news, annual plans keep about 1.6x more subscribers after a year than monthly plans (Piano 2021: 74% vs 46%). Common pitfalls: for annual plans M12 is the first renewal outcome, so do not compare it 1:1 with monthly plans, and long promos push the retention cliff to the return to full price.",
    },
    levers: {
      pl: "Prowadź subskrybenta przez cały pierwszy rok: plan treści i wydarzeń, kwartalne podsumowanie wartości, zaproszenia do klubów dyskusyjnych. Zaproponuj plan roczny osobom, które zostały z nami przez pierwsze miesiące. Członkom pierwszego roku przypisz opiekuna i zaproś ich na spotkanie członkowskie przed odnowieniem. Długie promocje oceniaj w horyzoncie dłuższym niż 12 miesięcy.",
      en: "Guide subscribers through the whole first year: a plan of content and events, a quarterly summary of value, invitations to discussion clubs. Offer an annual plan to those who have stayed through the first months. Assign first-year members a contact person and invite them to a members' meeting before renewal. Assess long promotions over a horizon longer than 12 months.",
    },
    caveats: [
      {
        text: {
          pl: "Mediana Piano pochodzi z raportu 2021. Raport 2024 potwierdza tylko jakościowo, że plany roczne po pierwszym roku mają 'prawie dwukrotnie' wyższą retencję.",
          en: "The Piano median comes from the 2021 report. The 2024 report confirms only qualitatively that annual plans have 'almost twice' the retention after the first year.",
        },
      },
      {
        text: {
          pl: "Mather (Q2 2025, 86 marek): nawet najlepsza spośród promocji kohorta z 52-tygodniową ofertą wprowadzającą ma ok. 33% aktywnych w 80. tygodniu. Długie promocje mierz w horyzoncie powyżej 12 mies.",
          en: "Mather (Q2 2025, 86 brands): even the best-performing promotional cohort, the one with a 52-week introductory offer, has approx. 33% still active in week 80. Measure long promotions over a horizon beyond 12 months.",
        },
        sourceIds: ["mather_q2_2025_promo"],
      },
      {
        text: {
          pl: "Dane z aplikacji (RevenueCat) są znacznie niższe niż dla subskrypcji web wydawców i służą tylko jako dolny punkt odniesienia.",
          en: "App data (RevenueCat) are much lower than for publishers' web subscriptions and serve only as a lower reference point.",
        },
      },
      {
        text: {
          pl: "Według INMA mediana czasu życia subskrypcji news wynosi ok. 21 mies. (wartość niezweryfikowana: strona zwraca HTTP 403). Według Beehiiv (wartość potwierdzona) średni czas życia subskrybenta płatnego newslettera newsowego to 18 mies.",
          en: "According to INMA, the median lifetime of a news subscription is approx. 21 months (unverified value: the page returns HTTP 403). According to Beehiiv (confirmed value), the average lifetime of a paid news-newsletter subscriber is 18 months.",
        },
        sourceIds: ["inma_past_subscribers_2025", "beehiiv_pressgazette_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "cohort_retention_m12.news_b2c_monthly",
        label: {
          pl: "News/media cyfrowe B2C – plan miesięczny",
          en: "Digital news/media B2C – monthly plan",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m12",
        direction: "higher",
        method: {
          pl: "Mediana Piano (2021) i zakres FTI Consulting (2022/23). Skrajne granice to heurystyka. Okres: kohorta miesięczna, pomiar po 12 mies.",
          en: "Piano median (2021) and the FTI Consulting range (2022/23). The extreme boundaries are a heuristic. Period: monthly cohort, measured after 12 months.",
        },
        sourceIds: ["digiday_monthly_annual_2023", "piano_benchmarks_2024"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 30,
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 40,
            basis: "B",
          },
          {
            tier: "normal",
            min: 40,
            max: 50,
            note: {
              pl: "mediana Piano 2021: 46%",
              en: "Piano 2021 median: 46%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 50,
            max: 60,
            note: {
              pl: "FTI: ok. 50–60%",
              en: "FTI: approx. 50–60%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 60,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "cohort_retention_m12.news_b2c_annual",
        label: {
          pl: "News/media cyfrowe B2C – plan roczny (pierwsze odnowienie)",
          en: "Digital news/media B2C – annual plan (first renewal)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m12",
        direction: "higher",
        method: {
          pl: "Mediana Piano (2021), zakres FTI Consulting i przypadek Aftenposten (DNR 2025 via Reporterzy.info). Okres: rocznie (pierwsze odnowienie).",
          en: "Piano median (2021), the FTI Consulting range and the Aftenposten case (DNR 2025 via Reporterzy.info). Period: annually (first renewal).",
        },
        sourceIds: ["digiday_monthly_annual_2023", "reporterzy_dnr2025"],
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
            basis: "B",
          },
          {
            tier: "normal",
            min: 65,
            max: 74,
            note: {
              pl: "FTI: od 65%; Aftenposten: 71%",
              en: "FTI: from 65%; Aftenposten: 71%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 74,
            max: 80,
            note: {
              pl: "mediana Piano 2021: 74%",
              en: "Piano 2021 median: 74%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 80,
            max: null,
            note: {
              pl: "górny zakres FTI: 80%",
              en: "upper end of the FTI range: 80%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "cohort_retention_m12.membership_first_year",
        label: {
          pl: "Członkostwa – odnowienie po pierwszym roku (first-year renewal)",
          en: "Memberships – renewal after the first year (first-year renewal)",
        },
        segments: ["membership_club"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Mediany MGI (2025 i 2026) jako górna granica przedziału 'normalny'. Pozostałe granice to heurystyka. Okres: rocznie.",
          en: "MGI medians (2025 and 2026) as the upper boundary of the 'normal' range. The remaining boundaries are a heuristic. Period: annually.",
        },
        sourceIds: ["mgi_2025_memberjungle", "mgi_2026_i4a"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 55,
            basis: "E",
          },
          {
            tier: "weak",
            min: 55,
            max: 65,
            basis: "E",
          },
          {
            tier: "normal",
            min: 65,
            max: 74,
            note: {
              pl: "mediany MGI: 72% (2026), 74% (2025)",
              en: "MGI medians: 72% (2026), 74% (2025)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 74,
            max: 82,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 82,
            max: null,
            note: {
              pl: "na poziomie mediany odnowień całej bazy (82–84%)",
              en: "at the level of the renewal median for the entire base (82–84%)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "cohort_retention_m12.b2b_new_logos",
        label: {
          pl: "B2B SaaS / subskrypcje B2B – nowi klienci (logo)",
          en: "B2B SaaS / B2B subscriptions – new customers (logo)",
        },
        segments: ["b2b_institution"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "cohort_m12",
        direction: "higher",
        method: {
          pl: "Górny kwartyl ChartMogul 2023 (70%) jako próg 'optymalny' (konwencja P75 = próg 'optymalny', jak w M3); 77% przy ARR 15–30 mln USD to poziom ambitny. Niższe granice to heurystyka. Okres: kohorta miesięczna, pomiar po 12 mies.",
          en: "The ChartMogul 2023 top quartile (70%) as the 'optimal' threshold (convention: P75 = 'optimal' threshold, as for M3); 77% at ARR USD 15–30m is an ambitious level. The lower boundaries are a heuristic. Period: monthly cohort, measured after 12 months.",
        },
        sourceIds: ["chartmogul_retention_report_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 45,
            basis: "E",
          },
          {
            tier: "weak",
            min: 45,
            max: 55,
            basis: "E",
          },
          {
            tier: "normal",
            min: 55,
            max: 62,
            basis: "E",
          },
          {
            tier: "good",
            min: 62,
            max: 70,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 70,
            max: null,
            note: {
              pl: "górny kwartyl ChartMogul (nowi klienci): 70%; 77% przy ARR 15–30 mln USD jako poziom ambitny",
              en: "ChartMogul top quartile (new customers): 70%; 77% at ARR USD 15–30m as an ambitious level",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "cohort_retention_m12.media_apps_annual",
        label: {
          pl: "Aplikacje Media & Entertainment – plan roczny, pierwsze odnowienie (punkt odniesienia)",
          en: "Media & Entertainment apps – annual plan, first renewal (reference point)",
        },
        segments: ["b2c_individual"],
        measure: "cohort_survival",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "Kwartyle RevenueCat SOSA 2026 (P25 20%, mediana 37%, P75 56%). Okres: rocznie.",
          en: "RevenueCat SOSA 2026 quartiles (P25 20%, median 37%, P75 56%). Period: annually.",
        },
        sourceIds: ["revenuecat_renewal_rates_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 12,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 12,
            max: 20,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 20,
            max: 37,
            note: {
              pl: "P25–P50",
              en: "P25 to median (P50)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 37,
            max: 56,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 56,
            max: null,
            note: {
              pl: "powyżej P75",
              en: "above P75",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "cohort_retention_m12.news_b2c_monthly",
      b2c_individual: "cohort_retention_m12.news_b2c_monthly",
      b2c_reduced: "cohort_retention_m12.news_b2c_monthly",
      b2b_institution: "cohort_retention_m12.b2b_new_logos",
      membership_club: "cohort_retention_m12.membership_first_year",
    },
  },
];
