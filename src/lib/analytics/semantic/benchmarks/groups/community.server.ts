// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/spolecznosc.json, docs/benchmarki/2026-10-18/spolecznosc.overlay.json
// SHA-256 treści kanonicznej wejść: 6dce4c6284d84f8e485f80c8e45bddb986d3d02872087eb2f1a0d609b0a46ab3
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „community” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const COMMUNITY_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "dau_mau",
    metricId: "dau_mau",
    group: "community",
    abbr: "DAU/MAU",
    name: {
      pl: "Lepkość (stickiness) DAU/MAU",
      en: "Stickiness (DAU/MAU)",
    },
    expansion: {
      pl: "Daily Active Users / Monthly Active Users – dzienni aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników",
      en: "Daily Active Users / Monthly Active Users",
    },
    formula: {
      pl: "DAU/MAU = (średnia dzienna liczba unikalnych aktywnych użytkowników w miesiącu) / (liczba unikalnych aktywnych użytkowników w tym miesiącu) × 100%. Pomocniczo: DAU/MAU × 30 ≈ średnia liczba dni aktywności aktywnego użytkownika w miesiącu.",
      en: "DAU/MAU = (average daily number of unique active users in the month) / (number of unique active users in that month) × 100%. Auxiliary: DAU/MAU × 30 ≈ the average number of active days per active user in the month.",
    },
    interpretation: {
      pl: "Pokazuje, jak często aktywny użytkownik wraca: 20% oznacza średnio ok. 6 dni aktywności w miesiącu, 33% ok. 10 dni. Dla think tanku z treściami eksperckimi naturalny rytm to kilka wizyt w miesiącu, więc nie porównuj wyniku z mediami społecznościowymi ani z grami. Typowe pułapki: wynik zależy od definicji aktywności (sama odsłona, przeczytany artykuł albo logowanie). Anonimowe cookies zawyżają MAU i zaniżają wskaźnik, a sezonowość (wakacje, kalendarz wydarzeń) zmienia go z miesiąca na miesiąc.",
      en: "Shows how often an active user returns: 20% means roughly 6 active days per month, 33% roughly 10 days. For an expert-content think tank the natural rhythm is a few visits per month, so do not compare it with social or gaming apps. Pitfalls: the result depends on how 'active' is defined (pageview vs. article read vs. login), anonymous cookies inflate MAU and depress the ratio, and seasonality (holidays, event calendar) moves it month to month.",
    },
    levers: {
      pl: "Daj zalogowanym powód do częstszych powrotów: codzienny lub tygodniowy przegląd analiz, alerty o nowych tekstach w obserwowanych tematach, powiadomienia o wątkach w klubie. Ułatwiaj powrót bez tarcia (pamiętane logowanie, linki z newslettera prowadzące do pełnej treści). Dla treści o rytmie tygodniowym oceniaj równolegle WAU/MAU i rozkład dni aktywności, zamiast gonić wynik dzienny.",
      en: "Give signed-in users a reason to come back more often: a daily or weekly digest of analysis, alerts about new pieces on followed topics, notifications about club threads. Make returning frictionless (remembered sign-in, newsletter links leading to the full content). For content with a weekly rhythm, assess WAU/MAU and the distribution of active days in parallel instead of chasing a daily figure.",
    },
    caveats: [
      {
        text: {
          pl: "Średnie Mixpanel dotyczą produktów z pełną instrumentacją (często aplikacji z logowaniem), więc dla serwisu WWW z ruchem anonimowym będą zawyżone.",
          en: "The Mixpanel averages concern fully instrumented products (often apps with sign-in), so for a website with anonymous traffic they will be overstated.",
        },
        sourceIds: ["mixpanel_benchmarks_2024"],
      },
      {
        text: {
          pl: "Dane europejskie (Mixpanel 2026, rok danych i definicja niepodane): e-commerce w EMEA 21%, agencje kreatywne (Media & Entertainment) w EMEA 31%. Nie znaleziono polskich benchmarków.",
          en: "European data (Mixpanel 2026, data year and definition not given): e-commerce in EMEA 21%, creative agencies (Media & Entertainment) in EMEA 31%. No Polish benchmarks were found.",
        },
        sourceIds: ["mixpanel_digital_analytics_2026"],
      },
      {
        text: {
          pl: "Próg 50%+ ('world class' wg A. Chena) dotyczy aplikacji społecznościowych. Sam Chen zastrzega, że dla produktów używanych rzadziej DAU/MAU nie jest właściwą miarą.",
          en: "The 50%+ threshold ('world class' according to A. Chen) concerns social apps. Chen himself cautions that for products used less often DAU/MAU is not the right measure.",
        },
        sourceIds: ["andrewchen_dau_mau_2018"],
      },
      {
        text: {
          pl: "Dla treści o rytmie tygodniowym (newsletter, kluby) lepiej równolegle śledzić WAU/MAU i rozkład dni aktywności (power user curve / L30).",
          en: "For content with a weekly rhythm (newsletter, clubs), it is better to track WAU/MAU and the distribution of active days (power user curve / L30) in parallel.",
        },
      },
      {
        text: {
          pl: "DAU/MAU ma matematyczne minimum ok. 3,3% (1/30): każdy użytkownik aktywny w miesiącu był aktywny co najmniej jeden dzień, więc pasmo 'krytyczny' obejmuje faktycznie 3,3–5%. Wartość niższa oznacza niespójne definicje DAU i MAU.",
          en: "DAU/MAU has a mathematical minimum of approx. 3.3% (1/30): every user active in the month was active on at least one day, so the 'critical' band actually covers 3.3–5%. A lower value means the DAU and MAU definitions are inconsistent.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "dau_mau.expert_content",
        label: {
          pl: "Serwis treści eksperckich / media cyfrowe (zalogowani czytelnicy, subskrybenci, członkowie)",
          en: "Expert content service / digital media (signed-in readers, subscribers, members)",
        },
        segments: ["b2c_individual", "b2c_reduced", "membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka zakotwiczona w źródłach: próg 'dobry' = 20% (A. Chen), próg 'optymalny' = średnia Mixpanel dla Media & Entertainment 36% (produkty instrumentowane, głównie aplikacje). Dolne pasma wyprowadzono z rytmu użycia (10% ≈ 3 dni aktywności w miesiącu). Przedziały lewostronnie domknięte [min, max). Okres: miesięcznie (średnia z dni miesiąca kalendarzowego).",
          en: "Heuristic anchored in the sources: the 'good' threshold = 20% (A. Chen), the 'optimal' threshold = the Mixpanel average for Media & Entertainment of 36% (instrumented products, mainly apps). The lower bands were derived from the usage rhythm (10% ≈ 3 active days a month). Ranges closed on the left [min, max). Period: monthly (average over the days of the calendar month).",
        },
        sourceIds: [
          "mixpanel_benchmarks_2024",
          "andrewchen_dau_mau_2018",
          "mixpanel_digital_analytics_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 5,
            note: {
              pl: "<1,5 dnia aktywności w miesiącu na aktywnego użytkownika – ruch głównie jednorazowy; minimum matematyczne DAU/MAU ≈3,3% (1/30), więc pasmo obejmuje w praktyce 3,3–5%",
              en: "<1.5 active days a month per active user – mainly one-off traffic; the mathematical minimum of DAU/MAU is ≈3.3% (1/30), so in practice the band covers 3.3–5%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 5,
            max: 10,
            note: {
              pl: "1,5–3 dni w miesiącu",
              en: "1.5–3 days a month",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 10,
            max: 20,
            note: {
              pl: "3–6 dni w miesiącu, rytm mniej więcej tygodniowy",
              en: "3–6 days a month, a roughly weekly rhythm",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 20,
            max: 36,
            note: {
              pl: "≥20% to próg 'dobry' wg A. Chena",
              en: "≥20% is the 'good' threshold according to A. Chen",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 36,
            max: 100,
            note: {
              pl: "poziom średniej Mixpanel dla Media & Entertainment (36%, dane 2023), osiągany zwykle przez aplikacje o dziennym rytmie",
              en: "the level of the Mixpanel average for Media & Entertainment (36%, 2023 data), usually reached by apps with a daily rhythm",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "dau_mau.b2b_portal",
        label: {
          pl: "Portal/produkt B2B (panel klienta instytucjonalnego, narzędzia dla członków firmowych)",
          en: "B2B portal/product (institutional client panel, tools for corporate members)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Punkty odniesienia ze źródeł: Mixpanel 2026 – B2B w Ameryce Płn. 31% (rok danych i definicja niepodane), Mixpanel 2024 – Technology 41% (dane 2023), D. Sacks – ok. 40% jako doskonały poziom w SaaS (u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu). Dolne pasma (<20%) to heurystyka. Okres: miesięcznie.",
          en: "Reference points from the sources: Mixpanel 2026 – B2B in North America 31% (data year and definition not given), Mixpanel 2024 – Technology 41% (2023 data), D. Sacks – approx. 40% as an excellent level in SaaS (peaks of 40–45% among paying customers, approx. 8 working days a month). The lower bands (<20%) are a heuristic. Period: monthly.",
        },
        sourceIds: [
          "mixpanel_digital_analytics_2026",
          "mixpanel_benchmarks_2024",
          "sacks_saas_engagement_2020",
        ],
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
            max: 20,
            basis: "E",
          },
          {
            tier: "normal",
            min: 20,
            max: 31,
            note: {
              pl: "do poziomu Mixpanel B2B Ameryka Płn. 31% (Mixpanel, raport 2026; rok danych i definicja niepodane)",
              en: "up to the Mixpanel North America B2B level of 31% (Mixpanel, 2026 report; data year and definition not given)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 31,
            max: 40,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 40,
            max: 100,
            note: {
              pl: "~40% DAU/MAU płacących klientów = 'excellent engagement' wg D. Sacksa – u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu; Mixpanel Technology 41% (dane 2023)",
              en: "~40% DAU/MAU among paying customers = 'excellent engagement' according to D. Sacks – peaks of 40–45% among paying customers, approx. 8 working days a month; Mixpanel Technology 41% (2023 data)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "dau_mau.expert_content",
      b2c_individual: "dau_mau.expert_content",
      b2c_reduced: "dau_mau.expert_content",
      membership_club: "dau_mau.expert_content",
      b2b_institution: "dau_mau.b2b_portal",
    },
  },
  {
    key: "wau_mau",
    metricId: "wau_mau",
    group: "community",
    abbr: "WAU/MAU",
    name: {
      pl: "Tygodniowa lepkość WAU/MAU",
      en: "Weekly stickiness (WAU/MAU)",
    },
    expansion: {
      pl: "Weekly Active Users / Monthly Active Users – tygodniowi aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników",
      en: "Weekly Active Users / Monthly Active Users",
    },
    formula: {
      pl: "WAU/MAU = (średnia liczba unikalnych aktywnych użytkowników w tygodniach miesiąca lub w kroczącym oknie 7 dni) / (unikalni aktywni użytkownicy w miesiącu lub w kroczącym oknie 28–30 dni) × 100%",
      en: "WAU/MAU = (average number of unique active users in the weeks of the month or in a rolling 7-day window) / (unique active users in the month or in a rolling 28–30-day window) × 100%",
    },
    interpretation: {
      pl: "Mierzy, jaka część miesięcznej publiczności wraca co tydzień, i lepiej niż DAU/MAU pasuje do rytmu think tanku (tygodniowy newsletter, cykle debat, spotkania klubów). Matematyczny punkt odniesienia: jeśli każdy użytkownik przychodzi dokładnie raz w miesiącu, WAU/MAU ≈ 7/30 ≈ 23%, a gdy wszyscy wracają co tydzień, wskaźnik zbliża się do 100%. Pułapki: różne okna (kalendarzowe vs. kroczące 7/28 dni) dają różne wyniki, a boty i anonimowe cookies zaniżają wskaźnik.",
      en: "Measures what share of the monthly audience returns every week, and fits a think tank's rhythm (weekly newsletter, debate series, club meetings) better than DAU/MAU. Mathematical anchor: if every user visits exactly once a month, WAU/MAU ≈ 7/30 ≈ 23%; if everyone returns weekly it approaches 100%. Pitfalls: calendar vs. rolling 7/28-day windows give different values, and bots or anonymous cookies depress the ratio.",
    },
    levers: {
      pl: "Zbuduj stały tygodniowy rytm: newsletter w ten sam dzień, cotygodniowe spotkanie lub wątek w klubie, cykl wydarzeń z zapowiedzią kolejnego. Przypominaj osobom, które opuściły tydzień, o nowościach w ich tematach. Śledź wskaźnik jako trend i w kohortach, a wartości poniżej minimum matematycznego traktuj jako błąd definicji okien.",
      en: "Build a steady weekly rhythm: the newsletter on the same day, a weekly club meeting or thread, an event series that announces the next instalment. Remind people who skipped a week about what is new in their topics. Track the indicator as a trend and by cohort, and treat values below the mathematical minimum as a window-definition error.",
    },
    caveats: [
      {
        text: {
          pl: "Nie znaleziono wiarygodnego, publicznego benchmarku WAU/MAU od Mixpanel, Amplitude ani Sequoii. Blogi dostawców podają sprzeczne przedziały (20–40% i 60–80%), więc ich nie użyto.",
          en: "No reliable public WAU/MAU benchmark from Mixpanel, Amplitude or Sequoia was found. Vendor blogs give contradictory ranges (20–40% and 60–80%), so they were not used.",
        },
      },
      {
        text: {
          pl: "Wskaźnik najlepiej traktować jako trend wewnętrzny (miesiąc do miesiąca, kohorty), a nie do porównań z rynkiem.",
          en: "The indicator is best treated as an internal trend (month on month, cohorts) rather than for comparisons with the market.",
        },
      },
      {
        text: {
          pl: "Zawsze WAU/MAU ≥ DAU/MAU. Przy kroczących oknach 7-dniowych praktycznym minimum jest ok. 23% (7/30) – tyle wychodzi, gdy każdy użytkownik jest aktywny raz w miesiącu; wartości niższe wskazują błąd definicji lub okien.",
          en: "WAU/MAU is always ≥ DAU/MAU. With rolling 7-day windows the practical minimum is approx. 23% (7/30) – that is the result when every user is active once a month; lower values indicate a definition or window error.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "wau_mau.weekly_content",
        label: {
          pl: "Serwis treści eksperckich / media cyfrowe o rytmie tygodniowym (newsletter, kluby, cykle wydarzeń)",
          en: "Expert content service / digital media with a weekly rhythm (newsletter, clubs, event series)",
        },
        segments: ["b2c_individual", "b2c_reduced", "membership_club", "newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka. Minimum matematyczne: każdy aktywny w miesiącu użytkownik wpada w co najmniej 7 z 30 kroczących okien 7-dniowych, więc średnie WAU/MAU ≥ ok. 23% (7/30); wartości niższe wskazują błąd definicji lub okien. Pasmo 'krytyczny' sięga 30% (prawie wszyscy aktywni tylko w jednym tygodniu miesiąca), a ok. 2 wizyty w różnych tygodniach dają ok. 47% (14/30). Górne pasma to ocena ekspercka spójna z relacją Sacksa (DAU/WAU ≈ 60% przy doskonałym zaangażowaniu w SaaS). Okres: miesięcznie (kroczące okna 7/28 dni).",
          en: "Heuristic. Mathematical minimum: every user active in the month falls into at least 7 of 30 rolling 7-day windows, so the average WAU/MAU is ≥ approx. 23% (7/30); lower values indicate a definition or window error. The 'critical' band reaches 30% (almost everyone active in only one week of the month), and approx. 2 visits in different weeks give approx. 47% (14/30). The upper bands are an expert judgement consistent with Sacks's relationship (DAU/WAU ≈ 60% with excellent engagement in SaaS). Period: monthly (rolling 7/28-day windows).",
        },
        sourceIds: ["sacks_saas_engagement_2020", "andrewchen_dau_mau_2018"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 30,
            note: {
              pl: "prawie wszyscy aktywni tylko w jednym tygodniu miesiąca; wartości <23% wskazują błąd definicji lub okien",
              en: "almost everyone active in only one week of the month; values <23% indicate a definition or window error",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 38,
            basis: "E",
          },
          {
            tier: "normal",
            min: 38,
            max: 50,
            note: {
              pl: "ok. 2 wizyty w różnych tygodniach daje ok. 47% (14/30)",
              en: "approx. 2 visits in different weeks give approx. 47% (14/30)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 50,
            max: 65,
            note: {
              pl: "większość miesięcznej publiczności wraca co tydzień",
              en: "most of the monthly audience returns every week",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 65,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "wau_mau.b2b_workdays",
        label: {
          pl: "Portal/produkt B2B używany w dni robocze (klienci instytucjonalni)",
          en: "B2B portal/product used on working days (institutional clients)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka ekspercka z kotwicą wyprowadzoną z Sacksa: u płacących klientów SaaS DAU/MAU ok. 40% i DAU/WAU ok. 60% ('excellent engagement') dają WAU/MAU ≈ 0,40/0,60 ≈ 67% (wyliczenie własne; Sacks nie podaje WAU/MAU) – próg 'optymalny'. Produkt SaaS powinien być używany we wszystkie 5 dni roboczych. Progi poniżej 60% to heurystyka. Okres: miesięcznie.",
          en: "Expert heuristic with an anchor derived from Sacks: among paying SaaS customers, DAU/MAU of approx. 40% and DAU/WAU of approx. 60% ('excellent engagement') give WAU/MAU ≈ 0.40/0.60 ≈ 67% (own calculation; Sacks does not give WAU/MAU) – the 'optimal' threshold. A SaaS product should be used on all 5 working days. Thresholds below 60% are a heuristic. Period: monthly.",
        },
        sourceIds: ["sacks_saas_engagement_2020"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 30,
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 45,
            basis: "E",
          },
          {
            tier: "normal",
            min: 45,
            max: 60,
            basis: "E",
          },
          {
            tier: "good",
            min: 60,
            max: 67,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 67,
            max: 100,
            note: {
              pl: "WAU/MAU ≈ 67% wyprowadzone z Sacksa: DAU/MAU ~40% / DAU/WAU ~60% przy 'excellent engagement' (wyliczenie własne; Sacks nie podaje WAU/MAU)",
              en: "WAU/MAU ≈ 67% derived from Sacks: DAU/MAU ~40% / DAU/WAU ~60% with 'excellent engagement' (own calculation; Sacks does not give WAU/MAU)",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "wau_mau.weekly_content",
      b2c_individual: "wau_mau.weekly_content",
      b2c_reduced: "wau_mau.weekly_content",
      membership_club: "wau_mau.weekly_content",
      newsletter: "wau_mau.weekly_content",
      b2b_institution: "wau_mau.b2b_workdays",
    },
  },
  {
    key: "nps",
    group: "community",
    abbr: "NPS",
    name: {
      pl: "Wskaźnik rekomendacji netto",
      en: "Net Promoter Score",
    },
    expansion: {
      pl: "Net Promoter Score – odsetek promotorów (oceny 9–10) minus odsetek krytyków (oceny 0–6) w pytaniu: „Jak prawdopodobne jest, że polecisz nas znajomemu lub współpracownikowi?” (skala 0–10)",
      en: "Net Promoter Score – % promoters (9–10) minus % detractors (0–6) on the 0–10 'How likely are you to recommend us to a friend or colleague?' question",
    },
    formula: {
      pl: "NPS = % promotorów (9–10) − % krytyków (0–6). Pasywni (7–8) są tylko w mianowniku. Zakres od −100 (sami krytycy) do +100 (sami promotorzy).",
      en: "NPS = % promoters (9–10) − % detractors (0–6). Passives (7–8) appear only in the denominator. The range runs from −100 (detractors only) to +100 (promoters only).",
    },
    interpretation: {
      pl: "Mierzy skłonność do polecania marki, czyli przybliżenie lojalności i wzrostu z poleceń. To liczba punktów, nie procent: +30 to np. 50% promotorów i 20% krytyków. Pułapki: wynik silnie zależy od kanału i momentu ankiety, a przy próbie kilkudziesięciu odpowiedzi waha się o kilkanaście punktów. NPS relacyjny (cykliczny) i transakcyjny (po zdarzeniu) nie są porównywalne, więc porównuj się przede wszystkim z własnym trendem i z benchmarkiem branżowym.",
      en: "Measures willingness to recommend, a proxy for loyalty and referral-driven growth. It is a point score, not a percentage: +30 might be 50% promoters minus 20% detractors. Pitfalls: strongly dependent on channel and survey timing; with a few dozen responses it swings by 10+ points; relationship (periodic) and transactional (post-event) NPS are not comparable, so compare primarily with your own trend and an industry benchmark.",
    },
    levers: {
      pl: "Zbieraj NPS regularnie w tych samych falach i zawsze pytaj o powód oceny, a odpowiedzi krytyków kieruj do konkretnej osoby z terminem reakcji. Zamykaj pętlę: informuj respondentów, co zmieniono dzięki ich uwagom. Analizuj wynik osobno dla czytelników, subskrybentów, członków klubów i klientów instytucjonalnych, z liczbą odpowiedzi przy każdym wyniku.",
      en: "Collect NPS regularly in the same waves and always ask for the reason behind the score, and route detractors' answers to a named person with a response deadline. Close the loop: tell respondents what was changed thanks to their feedback. Analyse the result separately for readers, subscribers, club members and institutional clients, with the number of responses next to each result.",
    },
    caveats: [
      {
        text: {
          pl: "Bain (nps.bain.com) definiuje promotorów, pasywnych i krytyków, ale nie podaje progów absolutnych, tylko porównania względne z konkurencją. Pasma powszechnie stosowane cytuje HelloCustomer (2026): 'A good NPS score is anything above 0, because it means promoters outnumber detractors.' oraz 'The bands in common use run on from there: above 20 is favourable, above 50 is excellent, above 80 is world class.' Artykuł nie przypisuje tych pasm Bain.",
          en: "Bain (nps.bain.com) defines promoters, passives and detractors but gives no absolute thresholds, only relative comparisons with competitors. The bands in common use are quoted by HelloCustomer (2026): 'A good NPS score is anything above 0, because it means promoters outnumber detractors.' and 'The bands in common use run on from there: above 20 is favourable, above 50 is excellent, above 80 is world class.' The article does not attribute these bands to Bain.",
        },
        sourceIds: ["bain_nps_measuring", "hellocustomer_nps_2026"],
      },
      {
        text: {
          pl: "Benchmarki dostawców różnią się metodą, np. Software: 30 (Survicate) vs 41 (Retently), Consulting: 59 vs 68.",
          en: "Vendor benchmarks differ in method, e.g. Software: 30 (Survicate) vs 41 (Retently), Consulting: 59 vs 68.",
        },
        sourceIds: ["survicate_nps_2025", "retently_nps_2026"],
      },
      {
        text: {
          pl: "Nie znaleziono polskich ani europejskich benchmarków NPS dla mediów i think tanków.",
          en: "No Polish or European NPS benchmarks for media and think tanks were found.",
        },
      },
      {
        text: {
          pl: "Przy n < 100 odpowiedzi pokazuj NPS z liczbą odpowiedzi i nie oceniaj pasma przy bardzo małej próbie.",
          en: "With n < 100 responses, show NPS together with the number of responses and do not assess the band for a very small sample.",
        },
      },
      {
        text: {
          pl: "Kwartyle SurveyMonkey dla usług profesjonalnych (42 / 48 / 72) to w tabeli 'consultancy as proxy' – przybliżenie przez doradztwo, a nie osobna kategoria dla think tanków.",
          en: "The SurveyMonkey quartiles for professional services (42 / 48 / 72) are listed as 'consultancy as proxy' – an approximation via consulting, not a separate category for think tanks.",
        },
        sourceIds: ["surveymonkey_nps_2025"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "nps.cross_industry",
        label: {
          pl: "Międzybranżowo (wszystkie sektory, punkt odniesienia ogólny)",
          en: "Cross-industry (all sectors, a general reference point)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Kwartyle SurveyMonkey 2025 (P25 = 0, P50 = +44, P75 = +72) połączone z powszechnie stosowanymi pasmami 0/20/50/80, które dzielą dolną połowę rozkładu. Kontrola krzyżowa: Survicate 2025 (P10 = −4, mediana 42, P90 = 78). Okres: na falę badania (kwartalnie/półrocznie) lub kroczące 90 dni.",
          en: "SurveyMonkey 2025 quartiles (P25 = 0, P50 = +44, P75 = +72) combined with the commonly used bands of 0/20/50/80, which divide the lower half of the distribution. Cross-check: Survicate 2025 (P10 = −4, median 42, P90 = 78). Period: per survey wave (quarterly/half-yearly) or rolling 90 days.",
        },
        sourceIds: [
          "surveymonkey_nps_2025",
          "survicate_nps_2025",
          "hellocustomer_nps_2026",
          "bain_nps_measuring",
        ],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: 0,
            note: {
              pl: "więcej krytyków niż promotorów; dolny kwartyl SurveyMonkey (P25 = 0), ok. P10 Survicate (−4)",
              en: "more detractors than promoters; the SurveyMonkey lower quartile (P25 = 0), approx. the Survicate P10 (−4)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0,
            max: 20,
            note: {
              pl: "dodatni, ale poniżej progu 'favourable' (20) z powszechnie stosowanych pasm",
              en: "positive, but below the 'favourable' threshold (20) of the commonly used bands",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 20,
            max: 44,
            note: {
              pl: "do mediany (SurveyMonkey +44, Survicate 42)",
              en: "up to the median (SurveyMonkey +44, Survicate 42)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 44,
            max: 72,
            note: {
              pl: "mediana – górny kwartyl",
              en: "median – upper quartile",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 72,
            max: 100,
            note: {
              pl: "górny kwartyl SurveyMonkey (≥ +72); P90 Survicate = 78; 'world class' w pasmach powszechnych > 80",
              en: "SurveyMonkey upper quartile (≥ +72); Survicate P90 = 78; 'world class' in the common bands > 80",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "nps.digital_media",
        label: {
          pl: "Media cyfrowe / wydawcy treści (czytelnicy, subskrybenci indywidualni B2C)",
          en: "Digital media / content publishers (readers, individual B2C subscribers)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Mediana ±20 pkt: Survicate 2025 – Media mediana 40, B2C mediana 49; Retently 2026 – Communication & Media 39 (średnia 5-letnia 19). Okres: na falę badania (kwartalnie/półrocznie).",
          en: "Median ±20 points: Survicate 2025 – Media median 40, B2C median 49; Retently 2026 – Communication & Media 39 (5-year average 19). Period: per survey wave (quarterly/half-yearly).",
        },
        sourceIds: ["survicate_nps_2025", "retently_nps_2026"],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 20,
            note: {
              pl: "okolice 5-letniej średniej Retently dla Communication & Media (19)",
              en: "around the Retently 5-year average for Communication & Media (19)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 20,
            max: 40,
            note: {
              pl: "do mediany branży (Survicate Media 40, Retently 39)",
              en: "up to the industry median (Survicate Media 40, Retently 39)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 40,
            max: 60,
            note: {
              pl: "powyżej mediany mediów; mediana B2C ogółem 49 (Survicate)",
              en: "above the media median; overall B2C median 49 (Survicate)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 60,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "nps.b2b_professional",
        label: {
          pl: "B2B: usługi eksperckie/doradcze, klienci instytucjonalni i firmowi",
          en: "B2B: expert/advisory services, institutional and corporate clients",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "year",
        direction: "higher",
        method: {
          pl: "Kwartyle SurveyMonkey 2025 dla usług profesjonalnych (w tabeli 'consultancy as proxy': P25 = 42, P50 = 48, P75 = 72) wyznaczają granice pasm 'dobry' (48) i 'optymalny' (72). Pasmo 'normalny' 30–48 jest celowo szerokie: obejmuje medianę B2B Survicate 2025 (38) i P25 SurveyMonkey (42), a przy kilkudziesięciu odpowiedziach błąd próby przekracza kilka punktów. Kontrola krzyżowa: Survicate 2025 (B2B 38, Agency & Consulting 59, Software 30) i Retently 2026 (Consulting 68, B2B SaaS 41). Progi 0 i 30 to heurystyka. Okres: na falę badania (półrocznie/rocznie, relacyjny).",
          en: "SurveyMonkey 2025 quartiles for professional services (listed as 'consultancy as proxy': P25 = 42, P50 = 48, P75 = 72) set the boundaries of the 'good' (48) and 'optimal' (72) bands. The 'normal' band of 30–48 is deliberately wide: it covers the Survicate 2025 B2B median (38) and the SurveyMonkey P25 (42), and with a few dozen responses the sampling error exceeds several points. Cross-check: Survicate 2025 (B2B 38, Agency & Consulting 59, Software 30) and Retently 2026 (Consulting 68, B2B SaaS 41). The 0 and 30 thresholds are a heuristic. Period: per survey wave (half-yearly/annually, relational).",
        },
        sourceIds: ["surveymonkey_nps_2025", "survicate_nps_2025", "retently_nps_2026"],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: 0,
            note: {
              pl: "więcej krytyków niż promotorów",
              en: "more detractors than promoters",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 30,
            note: {
              pl: "heurystyka: dodatni, ale wyraźnie poniżej mediany B2B (Survicate 38)",
              en: "heuristic: positive, but clearly below the B2B median (Survicate 38)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 48,
            note: {
              pl: "obejmuje medianę B2B (Survicate 38) i P25 usług profesjonalnych (SurveyMonkey 42), do mediany usług profesjonalnych (48)",
              en: "covers the B2B median (Survicate 38) and the professional-services P25 (SurveyMonkey 42), up to the professional-services median (48)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 48,
            max: 72,
            note: {
              pl: "P50–P75 usług profesjonalnych (SurveyMonkey, 'consultancy as proxy'); Survicate Agency & Consulting 59",
              en: "professional services P50–P75 (SurveyMonkey, 'consultancy as proxy'); Survicate Agency & Consulting 59",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 72,
            max: 100,
            note: {
              pl: "≥ P75 usług profesjonalnych (SurveyMonkey 72); Retently Consulting 68",
              en: "≥ professional-services P75 (SurveyMonkey 72); Retently Consulting 68",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "nps.cross_industry",
      b2c_individual: "nps.digital_media",
      b2c_reduced: "nps.digital_media",
      b2b_institution: "nps.b2b_professional",
    },
    noMetricReason: {
      pl: "System nie zbiera ankiet NPS (status N) - nie ma źródła odpowiedzi w skali 0-10, więc nie da się policzyć promotorów i krytyków. Wskaźnik wymaga osobnego badania z udokumentowaną próbą.",
      en: "The system does not collect NPS surveys (status N) – there is no source of 0–10 responses, so promoters and detractors cannot be counted. The indicator needs a separate survey with a documented sample.",
    },
  },
  {
    key: "event_attendance_rate",
    metricId: "event_attendance_rate",
    group: "community",
    abbr: "EAR",
    name: {
      pl: "Wskaźnik obecności (frekwencja) na wydarzeniu",
      en: "Event attendance rate",
    },
    expansion: {
      pl: "Attendance Rate – odsetek zarejestrowanych, którzy faktycznie przyszli (check-in) lub dołączyli do transmisji",
      en: "Attendance Rate – share of registrants who actually checked in or joined the stream",
    },
    formula: {
      pl: "AR = obecni (check-in / dołączenie do transmisji na żywo) / ważne rejestracje (bez anulowanych) × 100%. Dla online raportuj osobno 'live' oraz 'live + on-demand'.",
      en: "AR = attendees (check-in / joining the live stream) / valid registrations (excluding cancellations) × 100%. For online events report 'live' and 'live + on-demand' separately.",
    },
    interpretation: {
      pl: "Pokazuje, ile rejestracji zamienia się w realny udział. Wynik zależy od intencji publiczności, ceny biletu, przypomnień i dopasowania terminu. Wydarzeń bezpłatnych, płatnych i online nie należy oceniać jedną skalą. Pułapki: różne definicje obecności (check-in vs. odbiór identyfikatora; online: tylko live czy także on-demand, np. Contrast podaje osobno obecność live 44–50% i oglądalność live lub on-demand 61%), zaproszenia VIP i bilety grupowe w mianowniku, wielokrotne rejestracje tej samej osoby.",
      en: "Shows how many registrations turn into real participation; it reflects audience intent, ticket price, reminders and timing. Free, paid and online events must not share one scale. Pitfalls: differing attendance definitions (check-in vs. badge pickup; online live-only vs. live + on-demand, e.g. Contrast reports 44–50% live attendance and 61% watching live or on-demand separately), comps/VIP and group tickets in the denominator, duplicate registrations.",
    },
    levers: {
      pl: "Wysyłaj przypomnienia z dodaniem do kalendarza tydzień, dzień i godzinę przed wydarzeniem, z konkretnym powodem, by przyjść (prelegenci, temat, networking). Przy wydarzeniach bezpłatnych proś o potwierdzenie udziału dzień wcześniej i zwalniaj miejsca z listy rezerwowej. Online wysyłaj link bez logowania i nagranie po wydarzeniu, a obecność raportuj osobno na żywo i łącznie z odtworzeniami.",
      en: "Send reminders with an add-to-calendar option a week, a day and an hour before the event, with a concrete reason to attend (speakers, topic, networking). For free events ask for confirmation of attendance the day before and release places to the waiting list. For online events send a link that needs no sign-in and the recording afterwards, and report attendance separately for live viewing and for live plus replays.",
    },
    caveats: [
      {
        text: {
          pl: "Zbiór PheedLoop to dane jednej platformy (ponad 1 070 wydarzeń), bez podziału geograficznego. Nie znaleziono polskich ani europejskich benchmarków frekwencji.",
          en: "The PheedLoop data set comes from a single platform (over 1,070 events), with no geographical breakdown. No Polish or European attendance benchmarks were found.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026"],
      },
      {
        text: {
          pl: "Według PheedLoop (raport #06) różnica między płacącymi a niepłacącymi na tym samym wydarzeniu to tylko 2–4 pkt proc., więc większość luki między wydarzeniami bezpłatnymi a płatnymi wynika z typu wydarzenia, a nie z samej opłaty.",
          en: "According to PheedLoop (report #06), the difference between paying and non-paying attendees at the same event is only 2–4 percentage points, so most of the gap between free and paid events stems from the type of event, not from the fee itself.",
        },
        sourceIds: ["pheedloop_event_data_lab_06_2026"],
      },
      {
        text: {
          pl: "Średnia Goldcast 33% może być średnią wskaźników per webinar. Iloraz sum (51/238) daje ok. 21%. Rok danych nie jest jednoznaczny – wiele liczb raport opisuje jako 2024.",
          en: "The Goldcast average of 33% may be an average of per-webinar rates. The ratio of sums (51/238) gives approx. 21%. The data year is ambiguous – the report describes many figures as 2024.",
        },
        sourceIds: ["goldcast_webinar_statistics_2025"],
      },
      {
        text: {
          pl: "Liczby ON24 (57% w raporcie 2025, 60% w raporcie 2026) są niezweryfikowane: on24.com i marketingprofs.com zwracają 403, a Voxbooster to źródło wtórne. Dotyczą platformy enterprise o wysokiej intencji odbiorców i obejmują on-demand. Nie są kotwicą pasm i nie porównuj ich z obecnością tylko live.",
          en: "The ON24 figures (57% in the 2025 report, 60% in the 2026 report) are unverified: on24.com and marketingprofs.com return 403, and Voxbooster is a secondary source. They concern an enterprise platform with high-intent audiences and include on-demand viewing. They are not a band anchor and must not be compared with live-only attendance.",
        },
        sourceIds: ["marketingprofs_on24_webinars_2025", "voxbooster_webinar_statistics_2026"],
      },
      {
        text: {
          pl: "Dane Eventbrite (2018) są anegdotyczne, bez metodologii.",
          en: "The Eventbrite data (2018) are anecdotal, with no methodology.",
        },
        sourceIds: ["eventbrite_no_shows_2018"],
      },
      {
        text: {
          pl: "Wartości Contrast 41,6% (mediana) i 46,2% (średnia) przytaczane przez Voxbooster nie występują na stronie Contrast, którą Voxbooster podaje jako źródło – usunięto je z pasm. Dane Contrast (live 44–50%, live lub on-demand 61%) pochodzą z jednej platformy (ponad 1 mln rejestrujących).",
          en: "The Contrast values of 41.6% (median) and 46.2% (average) quoted by Voxbooster do not appear on the Contrast page that Voxbooster cites as its source – they were removed from the bands. The Contrast data (live 44–50%, live or on-demand 61%) come from a single platform (over 1 million registrants).",
        },
        sourceIds: ["voxbooster_webinar_statistics_2026", "contrast_webinar_benchmarks_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "event_attendance_rate.in_person_free",
        label: {
          pl: "Wydarzenia stacjonarne bezpłatne (debaty, prezentacje raportów)",
          en: "Free in-person events (debates, report presentations)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Kwartyl i mediana PheedLoop Event Data Lab (2026): mediana no-show dla wydarzeń bezpłatnych ~28% (N = 389), najgorsze 25% ≥47%. Próg optymalny to mediana wydarzeń płatnych (83%). Eventbrite: no-show 'as high as 50%' przy bezpłatnych. Okres: na wydarzenie (agregat kwartalny jako mediana wydarzeń).",
          en: "PheedLoop Event Data Lab quartile and median (2026): the median no-show for free events ~28% (N = 389), the worst 25% ≥47%. The optimal threshold is the median of paid events (83%). Eventbrite: no-show 'as high as 50%' for free events. Period: per event (quarterly aggregate as the median of events).",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026", "eventbrite_no_shows_2018"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 53,
            note: {
              pl: "≈ najgorsze 25% wydarzeń bezpłatnych (no-show ≥47%)",
              en: "≈ the worst 25% of free events (no-show ≥47%)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 53,
            max: 62,
            basis: "E",
          },
          {
            tier: "normal",
            min: 62,
            max: 72,
            note: {
              pl: "do mediany (no-show ~28% → obecność ~72%)",
              en: "up to the median (no-show ~28% → attendance ~72%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 72,
            max: 83,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 83,
            max: 100,
            note: {
              pl: "poziom mediany wydarzeń płatnych lub lepszy",
              en: "the median level of paid events or better",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "event_attendance_rate.in_person_paid",
        label: {
          pl: "Wydarzenia stacjonarne płatne (konferencje, gale, szkolenia)",
          en: "Paid in-person events (conferences, galas, training)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Kwartyl i mediana PheedLoop (2026): mediana no-show dla płatnych ~17% (N = 683), najgorsze 25% ≥32%. Górny próg według Eventbrite (no-show płatnych nawet ~10%). Okres: na wydarzenie.",
          en: "PheedLoop quartile and median (2026): the median no-show for paid events ~17% (N = 683), the worst 25% ≥32%. The upper threshold follows Eventbrite (no-show for paid events even ~10%). Period: per event.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026", "eventbrite_no_shows_2018"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 68,
            note: {
              pl: "≈ najgorsze 25% wydarzeń płatnych (no-show ≥32%)",
              en: "≈ the worst 25% of paid events (no-show ≥32%)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 68,
            max: 75,
            basis: "E",
          },
          {
            tier: "normal",
            min: 75,
            max: 83,
            note: {
              pl: "do mediany (no-show ~17% → obecność ~83%)",
              en: "up to the median (no-show ~17% → attendance ~83%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 83,
            max: 90,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 90,
            max: 100,
            note: {
              pl: "no-show ≤10% (Eventbrite: 'as low as 10%')",
              en: "no-show rate ≤10% (Eventbrite: 'as low as 10%')",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "event_attendance_rate.small_free_meetings",
        label: {
          pl: "Małe spotkania bezpłatne (10–49 osób, np. spotkania klubów dyskusyjnych)",
          en: "Small free meetings (10–49 people, e.g. discussion club meetings)",
        },
        segments: ["events", "membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Mediana PheedLoop (2026) dla małych bezpłatnych wydarzeń: no-show ~37%, czyli obecność ~63%. Pozostałe pasma: mediana ± heurystyka. Okres: na spotkanie (agregat miesięczny).",
          en: "PheedLoop median (2026) for small free events: no-show ~37%, i.e. attendance ~63%. Other bands: median ± heuristic. Period: per meeting (monthly aggregate).",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 50,
            basis: "E",
          },
          {
            tier: "weak",
            min: 50,
            max: 58,
            basis: "E",
          },
          {
            tier: "normal",
            min: 58,
            max: 68,
            note: {
              pl: "mediana ~63% (no-show ~37%)",
              en: "median ~63% (no-show ~37%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 68,
            max: 80,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 80,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "event_attendance_rate.online_live",
        label: {
          pl: "Wydarzenia online / webinary B2B – obecność na żywo (live)",
          en: "Online events / B2B webinars – live attendance",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Contrast (dane własnej platformy, ponad 1 mln rejestrujących, aktualizacja 16.04.2026): dobra obecność live 44–50% rejestrujących – pasmo 'dobry'; start o 14:00 – 55% – próg 'optymalny'. Goldcast 2025: średnio 33% (19 tys. webinarów, dane opisane głównie jako 2024; metoda liczenia niepodana). Goldcast 2026: ok. 32% z ilorazu sum (2,2 mln / 6,8 mln, wyliczenie własne). ON24 57% / 60% niezweryfikowane (403 na on24.com i marketingprofs.com) – nie są kotwicą pasm. Progi 20 i 30 to heurystyka. Okres: na webinar (agregat kwartalny).",
          en: "Contrast (own platform data, over 1 million registrants, updated 16.04.2026): good live attendance of 44–50% of registrants – the 'good' band; a 14:00 start – 55% – the 'optimal' threshold. Goldcast 2025: 33% on average (19 thousand webinars, data described mainly as 2024; calculation method not given). Goldcast 2026: approx. 32% from the ratio of sums (2.2 million / 6.8 million, own calculation). ON24 57% / 60% unverified (403 on on24.com and marketingprofs.com) – not a band anchor. The 20 and 30 thresholds are a heuristic. Period: per webinar (quarterly aggregate).",
        },
        sourceIds: [
          "contrast_webinar_benchmarks_2026",
          "goldcast_webinar_statistics_2025",
          "goldcast_webinar_benchmark_2026",
        ],
        bands: [
          {
            tier: "critical",
            min: 0,
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
            tier: "normal",
            min: 30,
            max: 44,
            note: {
              pl: "Goldcast: średnio 33% (dane ok. 2024); Goldcast 2026: ok. 32% z ilorazu sum (wyliczenie własne)",
              en: "Goldcast: 33% on average (data approx. 2024); Goldcast 2026: approx. 32% from the ratio of sums (own calculation)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 44,
            max: 55,
            note: {
              pl: "Contrast: obecność live 44–50% rejestrujących ('a good webinar attendance rate', aktualizacja 16.04.2026)",
              en: "Contrast: live attendance of 44–50% of registrants ('a good webinar attendance rate', updated 16.04.2026)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 55,
            max: 100,
            note: {
              pl: "Contrast: webinary startujące o 14:00 – 55%; ON24 (57–60%) niezweryfikowane i obejmuje on-demand – nie jest kotwicą",
              en: "Contrast: webinars starting at 14:00 – 55%; ON24 (57–60%) unverified and includes on-demand – not an anchor",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "event_attendance_rate.online_total",
        label: {
          pl: "Wydarzenia online – obecność łączna (live + odtworzenie on-demand)",
          en: "Online events – total attendance (live + on-demand replay)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Heurystyka (pewność kontekstu niska). Granica normalny/dobry 57% pochodziła ze średniej ON24 (57% w raporcie 2025, 60% w raporcie 2026), której nie da się zweryfikować (on24.com i marketingprofs.com zwracają 403, Voxbooster to źródło wtórne). Potwierdzona kotwica: Contrast (dane własnej platformy, aktualizacja 16.04.2026) – 61% rejestrujących ogląda live lub on-demand, w paśmie 'dobry'. Pozostałe progi to heurystyka. Okres: na webinar (z oknem on-demand np. 30 dni).",
          en: "Heuristic (low context confidence). The normal/good boundary of 57% came from the ON24 average (57% in the 2025 report, 60% in the 2026 report), which cannot be verified (on24.com and marketingprofs.com return 403, Voxbooster is a secondary source). Confirmed anchor: Contrast (own platform data, updated 16.04.2026) – 61% of registrants watch live or on-demand, in the 'good' band. The other thresholds are a heuristic. Period: per webinar (with an on-demand window of e.g. 30 days).",
        },
        sourceIds: ["contrast_webinar_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 30,
            basis: "E",
          },
          {
            tier: "weak",
            min: 30,
            max: 45,
            basis: "E",
          },
          {
            tier: "normal",
            min: 45,
            max: 57,
            basis: "E",
          },
          {
            tier: "good",
            min: 57,
            max: 65,
            note: {
              pl: "Contrast: 61% rejestrujących ogląda live lub on-demand (aktualizacja 16.04.2026); ON24 57% (2024) / 60% (2025) – niezweryfikowane (403)",
              en: "Contrast: 61% of registrants watch live or on-demand (updated 16.04.2026); ON24 57% (2024) / 60% (2025) – unverified (403)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 65,
            max: 100,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "event_attendance_rate.in_person_free",
      events: "event_attendance_rate.in_person_free",
      membership_club: "event_attendance_rate.small_free_meetings",
    },
  },
  {
    key: "no_show_rate",
    metricId: "no_show_rate",
    group: "community",
    abbr: "NSR",
    name: {
      pl: "Wskaźnik nieobecności (no-show)",
      en: "No-show rate",
    },
    expansion: {
      pl: "No-Show Rate – odsetek zarejestrowanych, którzy nie pojawili się na wydarzeniu",
      en: "No-Show Rate – share of registrants who did not attend",
    },
    formula: {
      pl: "NSR = (ważne rejestracje − obecni) / ważne rejestracje × 100% = 100% − wskaźnik obecności (AR)",
      en: "NSR = (valid registrations − attendees) / valid registrations × 100% = 100% − attendance rate (AR)",
    },
    interpretation: {
      pl: "To lustrzane odbicie frekwencji, przydatne operacyjnie do planowania sali, cateringu i nadrezerwacji (overbookingu). Przy oczekiwanym no-show 28% trzeba zebrać ok. 1,4 rejestracji na każde miejsce, żeby wypełnić salę. Pułapki: nie licz anulacji zgłoszonych przed wydarzeniem jako no-show, a wydarzeń bezpłatnych, płatnych i online nie oceniaj jedną skalą.",
      en: "The mirror of attendance rate, used operationally for venue, catering and overbooking planning: with an expected 28% no-show you need about 1.4 registrations per seat. Pitfalls: do not count pre-event cancellations as no-shows; never judge free, paid and online events on a single scale.",
    },
    levers: {
      pl: "Zmniejszaj nieobecności tymi samymi działaniami co frekwencję: przypomnienia z kalendarzem, potwierdzenie udziału przed wydarzeniem, lista rezerwowa. Przy bezpłatnych wydarzeniach rozważ niewielki krok zobowiązania (wybór sesji, pytanie do prelegenta) zamiast samego kliknięcia. Analizuj nieobecnych według źródła rejestracji i typu wydarzenia i zaproś ich do nagrania lub na kolejną edycję.",
      en: "Reduce no-shows with the same actions as for attendance: calendar reminders, confirmation of attendance before the event, a waiting list. For free events consider a small commitment step (choosing a session, a question for the speaker) rather than a single click. Analyse no-shows by registration source and event type, and invite them to the recording or to the next edition.",
    },
    caveats: [
      {
        text: {
          pl: "Wskaźnik liczony jest z tych samych danych co frekwencja, więc w panelu pokazuj go jako drugą stronę tej samej miary, a nie jako osobną ocenę.",
          en: "The indicator is calculated from the same data as attendance, so show it in the dashboard as the other side of the same measure, not as a separate assessment.",
        },
      },
      {
        text: {
          pl: "Brak polskich ani europejskich danych o no-show. PheedLoop to dane jednej platformy.",
          en: "There are no Polish or European no-show data. PheedLoop is data from a single platform.",
        },
      },
      {
        text: {
          pl: "PheedLoop (raport #06): wydarzenia bezpłatne mają wyższy odsetek dokończonych rejestracji (~96% vs ~86%) i wyższy no-show. Łatwiejsza rejestracja przyciąga też mniej zdecydowanych.",
          en: "PheedLoop (report #06): free events have a higher share of completed registrations (~96% vs ~86%) and a higher no-show. Easier registration also attracts less committed people.",
        },
        sourceIds: ["pheedloop_event_data_lab_06_2026"],
      },
      {
        text: {
          pl: "PheedLoop (raport #05) według wielkości wydarzenia: 50–149 / 150–499 / 500–999 / 1 000+ uczestników – no-show ok. 23 / 19 / 18 / 19%.",
          en: "PheedLoop (report #05) by event size: 50–149 / 150–499 / 500–999 / 1,000+ attendees – no-show approx. 23 / 19 / 18 / 19%.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026"],
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "no_show_rate.in_person_free",
        label: {
          pl: "Wydarzenia stacjonarne bezpłatne",
          en: "Free in-person events",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "PheedLoop (2026): mediana ~28%, najgorsze 25% ≥47%. Eventbrite: do 50%. Okres: na wydarzenie.",
          en: "PheedLoop (2026): median ~28%, worst 25% ≥47%. Eventbrite: up to 50%. Period: per event.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026", "eventbrite_no_shows_2018"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 17,
            note: {
              pl: "poziom mediany wydarzeń płatnych lub lepszy",
              en: "the median level of paid events or better",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 17,
            max: 28,
            basis: "E",
          },
          {
            tier: "normal",
            min: 28,
            max: 38,
            note: {
              pl: "od mediany (~28%) w górę",
              en: "from the median (~28%) upwards",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 38,
            max: 47,
            basis: "E",
          },
          {
            tier: "critical",
            min: 47,
            max: 100,
            note: {
              pl: "najgorsze 25% wydarzeń bezpłatnych",
              en: "the worst 25% of free events",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "no_show_rate.in_person_paid",
        label: {
          pl: "Wydarzenia stacjonarne płatne",
          en: "Paid in-person events",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "PheedLoop (2026): mediana ~17%, najgorsze 25% ≥32%. Eventbrite: 'as low as 10%'. Okres: na wydarzenie.",
          en: "PheedLoop (2026): median ~17%, worst 25% ≥32%. Eventbrite: 'as low as 10%'. Period: per event.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026", "eventbrite_no_shows_2018"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 10,
            basis: "B",
          },
          {
            tier: "good",
            min: 10,
            max: 17,
            basis: "E",
          },
          {
            tier: "normal",
            min: 17,
            max: 25,
            note: {
              pl: "od mediany (~17%) w górę",
              en: "from the median (~17%) upwards",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 25,
            max: 32,
            basis: "E",
          },
          {
            tier: "critical",
            min: 32,
            max: 100,
            note: {
              pl: "najgorsze 25% wydarzeń płatnych",
              en: "the worst 25% of paid events",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "no_show_rate.small_free_meetings",
        label: {
          pl: "Małe spotkania bezpłatne (10–49 osób, kluby dyskusyjne)",
          en: "Small free meetings (10–49 people, discussion clubs)",
        },
        segments: ["events", "membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "PheedLoop (2026): mediana dla małych bezpłatnych wydarzeń ~37%. Pasma: mediana ± heurystyka. Okres: na spotkanie.",
          en: "PheedLoop (2026): median for small free events ~37%. Bands: median ± heuristic. Period: per meeting.",
        },
        sourceIds: ["pheedloop_event_data_lab_05_2026"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 20,
            basis: "E",
          },
          {
            tier: "good",
            min: 20,
            max: 32,
            basis: "E",
          },
          {
            tier: "normal",
            min: 32,
            max: 42,
            note: {
              pl: "mediana ~37%",
              en: "median ~37%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 42,
            max: 50,
            basis: "E",
          },
          {
            tier: "critical",
            min: 50,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "no_show_rate.online_webinar",
        label: {
          pl: "Webinary / wydarzenia online B2B (nieobecność na żywo)",
          en: "B2B webinars / online events (live no-show)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "Dopełnienie benchmarków obecności live: Contrast (dane własnej platformy, aktualizacja 16.04.2026) – obecność live 44–50%, czyli no-show 50–56%; Goldcast 2025 – obecność 33%, czyli no-show ok. 67%. Progi 70 i 80 oraz próg 'optymalny' (<45%, lustro obecności ≥55%) to heurystyka. ON24 niezweryfikowane (403) – nie jest kotwicą. Okres: na webinar.",
          en: "The complement of the live attendance benchmarks: Contrast (own platform data, updated 16.04.2026) – live attendance of 44–50%, i.e. no-show of 50–56%; Goldcast 2025 – attendance of 33%, i.e. no-show of approx. 67%. The 70 and 80 thresholds and the 'optimal' threshold (<45%, the mirror of attendance ≥55%) are a heuristic. ON24 unverified (403) – not an anchor. Period: per webinar.",
        },
        sourceIds: ["contrast_webinar_benchmarks_2026", "goldcast_webinar_statistics_2025"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 45,
            note: {
              pl: "lustro progu 'optymalny' obecności live (≥55%; Contrast: start o 14:00 – 55%)",
              en: "the mirror of the 'optimal' live attendance threshold (≥55%; Contrast: 14:00 start – 55%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 45,
            max: 56,
            note: {
              pl: "Contrast: obecność live 44–50% → no-show 50–56%",
              en: "Contrast: live attendance of 44–50% → no-show of 50–56%",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 56,
            max: 70,
            note: {
              pl: "Goldcast: średnia obecność 33% → no-show ok. 67%",
              en: "Goldcast: average attendance of 33% → no-show of approx. 67%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 70,
            max: 80,
            basis: "E",
          },
          {
            tier: "critical",
            min: 80,
            max: 100,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "no_show_rate.in_person_free",
      events: "no_show_rate.in_person_free",
      membership_club: "no_show_rate.small_free_meetings",
    },
  },
  {
    key: "event_registration_conversion",
    metricId: "event_registration_conversion",
    group: "community",
    abbr: "RCR",
    name: {
      pl: "Konwersja strony rejestracji na wydarzenie",
      en: "Event registration page conversion rate",
    },
    expansion: {
      pl: "Registration Conversion Rate – odsetek unikalnych odwiedzających stronę wydarzenia, którzy dokończyli rejestrację",
      en: "Registration Conversion Rate – share of unique visitors to the event page who completed registration",
    },
    formula: {
      pl: "RCR = zakończone rejestracje / unikalni odwiedzający stronę rejestracji (landing page wydarzenia) × 100%. Raportuj osobno według źródła ruchu.",
      en: "RCR = completed registrations / unique visitors to the registration page (event landing page) × 100%. Report separately by traffic source.",
    },
    interpretation: {
      pl: "Mierzy atrakcyjność oferty wydarzenia (temat, prelegenci, termin), jakość strony i tarcie formularza. Pułapki: wynik zależy przede wszystkim od miksu ruchu, bo ciepły ruch z newslettera konwertuje wielokrotnie lepiej niż reklamy. Wynik zniekształca też liczenie sesji zamiast unikalnych osób i mylenie rozpoczętych rejestracji z zakończonymi. Wydarzenia płatne mają niższy odsetek dokończonych rejestracji.",
      en: "Measures the appeal of the event offer (topic, speakers, date), page quality and form friction. Pitfalls: traffic mix dominates the result (warm newsletter traffic converts many times better than ads), counting sessions instead of unique people, confusing started with completed registrations; paid events have lower completion.",
    },
    levers: {
      pl: "Uprość stronę wydarzenia: na górze data, miejsce, temat i prelegenci, krótki formularz z minimum pól i jeden przycisk rejestracji. Zalogowanym członkom i subskrybentom wypełniaj dane automatycznie. Mierz konwersję osobno według źródła ruchu i testuj imienne zaproszenia do własnej bazy, które zwykle konwertują lepiej niż ruch zewnętrzny.",
      en: "Simplify the event page: date, venue, topic and speakers at the top, a short form with the minimum of fields and a single registration button. Pre-fill details for signed-in members and subscribers. Measure conversion separately by traffic source and test personal invitations to your own base, which usually convert better than external traffic.",
    },
    caveats: [
      {
        text: {
          pl: "Nie znaleziono pierwotnego benchmarku konwersji 'odwiedzający → rejestracja' dla wydarzeń (Eventbrite, Cvent, Bizzabo nie publikują go otwarcie). Wartości to konwersje landing page'y Unbounce, a kategoria Entertainment obejmuje loterie z medianą 47,5%.",
          en: "No primary 'visitor → registration' conversion benchmark for events was found (Eventbrite, Cvent and Bizzabo do not publish one openly). The values are Unbounce landing-page conversions, and the Entertainment category includes sweepstakes with a median of 47.5%.",
        },
        sourceIds: ["unbounce_entertainment_2024"],
      },
      {
        text: {
          pl: "Limit wyszukiwań w tej sesji wyczerpał się przed dalszym szukaniem danych Eventbrite, Splash i Cvent o konwersji stron wydarzeń. Warto to uzupełnić w kolejnym kroku.",
          en: "The search limit in this session ran out before further searching for Eventbrite, Splash and Cvent data on event-page conversion. This is worth completing in a later step.",
        },
      },
      {
        text: {
          pl: "Dane ON24 o landing page'ach (25%) pochodzą z omówienia MarketingProfs; marketingprofs.com i on24.com zwracają 403, więc liczba jest niezweryfikowana, a próg 'optymalny' w ruchu mieszanym to heurystyka.",
          en: "The ON24 landing-page data (25%) come from a MarketingProfs summary; marketingprofs.com and on24.com return 403, so the figure is unverified, and the 'optimal' threshold for mixed traffic is a heuristic.",
        },
        sourceIds: ["marketingprofs_on24_webinars_2025"],
      },
      {
        text: {
          pl: "Brak danych polskich i europejskich.",
          en: "There are no Polish or European data.",
        },
      },
      {
        text: {
          pl: "Unbounce przypisuje medianę ruchu e-mail w kategorii Entertainment (46,2%) głównie loteriom (sweepstakes) promowanym e-mailem. Pasma dla ruchu z własnej bazy to heurystyka.",
          en: "Unbounce attributes the median for e-mail traffic in the Entertainment category (46.2%) mainly to sweepstakes promoted by e-mail. The bands for traffic from your own base are a heuristic.",
        },
        sourceIds: ["unbounce_entertainment_2024"],
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "event_registration_conversion.mixed_traffic",
        label: {
          pl: "Ruch mieszany (social media, wyszukiwarka, reklamy, polecenia)",
          en: "Mixed traffic (social media, search, ads, referrals)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Mediany Unbounce 2024: wszystkie branże 6,6% (mediany branż 3,8–12,3%), Entertainment 12,3%, Publishing 9,8%; Unbounce nie ma kategorii wydarzeń ani webinarów. Próg 'optymalny' 25% to heurystyka: ON24 2025 (przez MarketingProfs) podaje ok. 25% dla spersonalizowanych landing page'y, ale liczby nie da się zweryfikować (403). Pozostałe pasma: mediana i odchylenia heurystyczne. Okres: na wydarzenie / kampanię.",
          en: "Unbounce 2024 medians: all industries 6.6% (industry medians 3.8–12.3%), Entertainment 12.3%, Publishing 9.8%; Unbounce has no category for events or webinars. The 'optimal' threshold of 25% is a heuristic: ON24 2025 (via MarketingProfs) gives approx. 25% for personalised landing pages, but the figure cannot be verified (403). Other bands: median and heuristic deviations. Period: per event / campaign.",
        },
        sourceIds: ["unbounce_conversion_benchmark_2024", "unbounce_entertainment_2024"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 3,
            note: {
              pl: "poniżej najniższej mediany branżowej Unbounce (3,8%)",
              en: "below the lowest Unbounce industry median (3.8%)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 3,
            max: 6.6,
            note: {
              pl: "poniżej mediany wszystkich branż (6,6%)",
              en: "below the all-industry median (6.6%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 6.6,
            max: 12,
            note: {
              pl: "Publishing 9,8%",
              en: "Publishing 9.8%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 12,
            max: 25,
            note: {
              pl: "Entertainment 12,3%",
              en: "Entertainment 12.3%",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 25,
            max: 100,
            note: {
              pl: "heurystyka; ON24 (przez MarketingProfs): spersonalizowane landing page'e webinarowe ok. 25% – liczba niezweryfikowana (403)",
              en: "heuristic; ON24 (via MarketingProfs): personalised webinar landing pages approx. 25% – figure unverified (403)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "event_registration_conversion.own_base",
        label: {
          pl: "Ruch z własnej bazy (newsletter, CRM, imienne zaproszenia do członków i klientów)",
          en: "Traffic from your own base (newsletter, CRM, personal invitations to members and clients)",
        },
        segments: ["events", "newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Heurystyka (pewność niska), bez benchmarku dla wydarzeń. Mediana Unbounce 2024 dla ruchu e-mail na stronach Entertainment (46,2%) według samego Unbounce wynika głównie z loterii (sweepstakes) promowanych do list mailingowych, więc nie jest kotwicą dla rejestracji na wydarzenia; górne progi ustawiono poniżej tej wartości (dobry 30–45, optymalny ≥45). Okres: na wysyłkę / wydarzenie.",
          en: "Heuristic (low confidence), with no benchmark for events. According to Unbounce itself, its 2024 median for e-mail traffic on Entertainment pages (46.2%) stems mainly from sweepstakes promoted to mailing lists, so it is not an anchor for event registrations; the upper thresholds were set below this value (good 30–45, optimal ≥45). Period: per send / event.",
        },
        sourceIds: ["unbounce_entertainment_2024"],
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
            max: 20,
            basis: "E",
          },
          {
            tier: "normal",
            min: 20,
            max: 30,
            basis: "E",
          },
          {
            tier: "good",
            min: 30,
            max: 45,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 45,
            max: 100,
            note: {
              pl: "heurystyka; Unbounce: mediana ruchu e-mail na stronach Entertainment 46,2%, napędzana głównie przez loterie (sweepstakes) promowane e-mailem – to nie jest kotwica dla rejestracji na wydarzenia",
              en: "heuristic; Unbounce: the median for e-mail traffic on Entertainment pages is 46.2%, driven mainly by sweepstakes promoted by e-mail – not an anchor for event registrations",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "event_registration_conversion.mixed_traffic",
      events: "event_registration_conversion.mixed_traffic",
      newsletter: "event_registration_conversion.own_base",
    },
  },
  {
    key: "event_nps",
    group: "community",
    abbr: "Event NPS",
    name: {
      pl: "NPS wydarzenia",
      en: "Event Net Promoter Score",
    },
    expansion: {
      pl: "Net Promoter Score uczestników (lub partnerów) konkretnego wydarzenia: % promotorów (9–10) − % krytyków (0–6) w pytaniu o polecenie wydarzenia",
      en: "Net Promoter Score of a specific event's attendees (or partners): % promoters (9–10) minus % detractors (0–6)",
    },
    formula: {
      pl: "Event NPS = % promotorów − % krytyków wśród respondentów ankiety po wydarzeniu (wysyłka 24–72 h po zakończeniu). Osobno dla uczestników, prelegentów i partnerów/sponsorów.",
      en: "Event NPS = % promoters − % detractors among respondents to the post-event survey (sent 24–72 h after the end). Separately for attendees, speakers and partners/sponsors.",
    },
    interpretation: {
      pl: "Mówi, czy wydarzenie generuje rekomendacje i powroty na kolejne edycje. U partnerów i sponsorów wyższy NPS koreluje ze wzrostem liczby wystawców i przychodów (UFI/Explori). Pułapki: niska stopa odpowiedzi i autoselekcja (odpowiadają najbardziej zadowoleni lub najbardziej rozczarowani), małe próby przy kameralnych debatach oraz porównywanie wydarzeń online ze stacjonarnymi.",
      en: "Indicates whether the event generates recommendations and repeat attendance; for partners/sponsors a higher NPS correlates with growth in exhibitors and revenue (UFI/Explori). Pitfalls: low response rates and self-selection, small samples at intimate debates, comparing online with in-person events.",
    },
    levers: {
      pl: "Wysyłaj krótką ankietę w ciągu doby lub dwóch po wydarzeniu, z pytaniem o powód oceny i o temat kolejnej edycji. Zbieraj osobno opinie uczestników, prelegentów i partnerów, bo każda grupa ocenia co innego. Porównuj wynik między edycjami tego samego cyklu i informuj uczestników, co zmieniono dzięki ich uwagom.",
      en: "Send a short survey within a day or two of the event, asking for the reason behind the score and for the topic of the next edition. Collect feedback from attendees, speakers and partners separately, because each group judges different things. Compare the result between editions of the same series and tell attendees what was changed thanks to their feedback.",
    },
    caveats: [
      {
        text: {
          pl: "Brak aktualnych, publicznych benchmarków NPS konferencji. Bazy Explori są dostępne tylko dla klientów, a dostępne liczby dotyczą targów (2017) i trendu (2022).",
          en: "There are no current public NPS benchmarks for conferences. Explori's databases are available to clients only, and the available figures concern trade shows (2017) and a trend (2022).",
        },
        sourceIds: ["ufi_explori_exhibitor_insights_2017", "explori_pandemic_effect_2022"],
      },
      {
        text: {
          pl: "Dane partnerów i sponsorów pochodzą sprzed pandemii (2017). Explori raportuje późniejszy wzrost średniego NPS targów o prawie 20 pkt, ale nie precyzuje, czy dotyczy on wystawców, czy odwiedzających, i nie podaje wartości absolutnych – progi mogą być dziś zaniżone, lecz ich nie przesunięto; ewentualne przesunięcie (np. o +15) byłoby heurystyką.",
          en: "The partner and sponsor data date from before the pandemic (2017). Explori reports a later rise in the average trade-show NPS of almost 20 points but does not specify whether it concerns exhibitors or visitors and gives no absolute values – the thresholds may be too low today, but they were not shifted; any shift (e.g. by +15) would be a heuristic.",
        },
        sourceIds: ["ufi_explori_exhibitor_insights_2017", "explori_pandemic_effect_2022"],
      },
      {
        text: {
          pl: "Targi branżowe to inny format niż debaty think tanku. Traktuj pasma jako orientacyjne i oceniaj głównie trend między edycjami tego samego cyklu.",
          en: "Trade shows are a different format from think-tank debates. Treat the bands as indicative and assess mainly the trend between editions of the same series.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "event_nps.in_person_attendees",
        label: {
          pl: "Uczestnicy wydarzeń stacjonarnych (konferencje, debaty, prezentacje raportów)",
          en: "Attendees of in-person events (conferences, debates, report presentations)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Heurystyka: NPS odwiedzających targi +11 / +17 (UFI/Explori 2017, zależnie od strategii nowości), wzrost średniej NPS targów o prawie 20 pkt od 2021 r. (Explori 2022 – bez wskazania grupy respondentów i wartości absolutnych, więc przesunięcie pasm to heurystyka, nie fakt), ogólna mediana NPS 42–44 (Survicate/SurveyMonkey). Okres: na wydarzenie.",
          en: "Heuristic: trade-show visitor NPS of +11 / +17 (UFI/Explori 2017, depending on the novelty strategy), a rise in the average trade-show NPS of almost 20 points since 2021 (Explori 2022 – without stating the respondent group or absolute values, so shifting the bands is a heuristic, not a fact), overall NPS median of 42–44 (Survicate/SurveyMonkey). Period: per event.",
        },
        sourceIds: [
          "ufi_explori_exhibitor_insights_2017",
          "explori_pandemic_effect_2022",
          "surveymonkey_nps_2025",
          "survicate_nps_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 15,
            note: {
              pl: "okolice przedpandemicznego NPS odwiedzających targi (+11…+17)",
              en: "around the pre-pandemic trade-show visitor NPS (+11…+17)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 15,
            max: 35,
            note: {
              pl: "heurystyka; Explori 2022: średni NPS targów wzrósł o prawie 20 pkt od 2021 r., bez wskazania, czy chodzi o wystawców, czy o odwiedzających",
              en: "heuristic; Explori 2022: the average trade-show NPS rose by almost 20 points since 2021, without stating whether this concerns exhibitors or visitors",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 35,
            max: 55,
            note: {
              pl: "okolice ogólnej mediany NPS (42–44)",
              en: "around the overall NPS median (42–44)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 55,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "event_nps.online_attendees",
        label: {
          pl: "Uczestnicy wydarzeń online (webinary, debaty transmitowane)",
          en: "Attendees of online events (webinars, streamed debates)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Heurystyka: pasma przesunięte o +5 pkt względem stacjonarnych, bo Explori raportuje, że 'advocacy is higher for virtual events than live events' (bez liczb). Odniesieniem jest ogólna mediana NPS. Okres: na wydarzenie.",
          en: "Heuristic: bands shifted by +5 points relative to in-person events, because Explori reports that 'advocacy is higher for virtual events than live events' (no figures). The reference point is the overall NPS median. Period: per event.",
        },
        sourceIds: ["explori_nps_for_events_2020", "survicate_nps_2025"],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: 0,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0,
            max: 20,
            basis: "E",
          },
          {
            tier: "normal",
            min: 20,
            max: 40,
            basis: "E",
          },
          {
            tier: "good",
            min: 40,
            max: 60,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 60,
            max: 100,
            basis: "E",
          },
        ],
      },
      {
        id: "event_nps.partners_sponsors",
        label: {
          pl: "Partnerzy, sponsorzy, wystawcy",
          en: "Partners, sponsors, exhibitors",
        },
        segments: ["events", "b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        displayUnit: "score",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "Baseline 2017 (targi, wystawcy): kwartyle UFI & Explori 2017 dla NPS wystawców – 25% wydarzeń poniżej −36, 50% poniżej −17 (mediana; w Europie również −17), 25% powyżej 0. Explori 2022 ('wzrost o prawie 20 pkt od 2021') nie wskazuje, czy chodzi o wystawców, czy o odwiedzających, i nie podaje wartości absolutnych, więc pasm nie przesunięto; ewentualne przesunięcie (np. o +15) byłoby heurystyką. Okres: na wydarzenie / edycję.",
          en: "2017 baseline (trade shows, exhibitors): UFI & Explori 2017 quartiles for exhibitor NPS – 25% of events below −36, 50% below −17 (median; also −17 in Europe), 25% above 0. Explori 2022 ('a rise of almost 20 points since 2021') does not state whether this concerns exhibitors or visitors and gives no absolute values, so the bands were not shifted; any shift (e.g. by +15) would be a heuristic. Period: per event / edition.",
        },
        sourceIds: ["ufi_explori_exhibitor_insights_2017", "explori_pandemic_effect_2022"],
        bands: [
          {
            tier: "critical",
            min: -100,
            max: -36,
            note: {
              pl: "dolny kwartyl wydarzeń (P25 ≈ −36)",
              en: "lower quartile of events (P25 ≈ −36)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: -36,
            max: -17,
            note: {
              pl: "P25–mediana (−17; 50% wydarzeń ma NPS wystawców poniżej −17)",
              en: "P25–median (−17; 50% of events have exhibitor NPS below −17)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: -17,
            max: 0,
            note: {
              pl: "mediana–P75 (25% wydarzeń ma NPS dodatni)",
              en: "median–P75 (25% of events have a positive NPS)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0,
            max: 20,
            note: {
              pl: "górny kwartyl",
              en: "upper quartile",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 20,
            max: 100,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "event_nps.in_person_attendees",
      events: "event_nps.in_person_attendees",
      b2b_institution: "event_nps.partners_sponsors",
    },
    noMetricReason: {
      pl: "Ankiety po wydarzeniach nie są jeszcze zbierane w systemie (D-02) - bez odpowiedzi w skali 0-10 od uczestników, prelegentów i partnerów nie da się policzyć NPS wydarzenia.",
      en: "Post-event surveys are not yet collected in the system (D-02) – without 0–10 responses from attendees, speakers and partners, the event NPS cannot be calculated.",
    },
  },
  {
    key: "community_active_member_rate",
    metricId: "club_active_member_rate",
    group: "community",
    abbr: "AMR",
    name: {
      pl: "Odsetek aktywnych członków społeczności (klubu)",
      en: "Active community member rate",
    },
    expansion: {
      pl: "Active Member Rate – odsetek członków z dostępem do klubu lub społeczności, którzy w okresie byli aktywni (zalogowali się, czytali wątki, wzięli udział w spotkaniu)",
      en: "Active Member Rate – share of members with access to the club/community who were active in the period (logged in, read threads, attended a meeting)",
    },
    formula: {
      pl: "AMR = unikalni aktywni członkowie w okresie (miesiąc lub 120 dni) / wszyscy członkowie z aktywnym dostępem na koniec okresu × 100%",
      en: "AMR = unique active members in the period (month or 120 days) / all members with active access at the end of the period × 100%",
    },
    interpretation: {
      pl: "Mierzy, czy członkostwo jest żywe, czy tylko opłacone lub założone. To wczesny sygnał ryzyka nieodnowienia. Pułapki: mianownik zawyżają nigdy niedezaktywowane konta (Higher Logic: 69,9 tys. kont, z czego 9,3 tys. aktywnych w 120 dni). Część członków korzysta tylko z digestu e-mail (otwarcia 44–56%), więc miara oparta na logowaniu zaniża realne zaangażowanie.",
      en: "Shows whether membership is alive or merely paid/created, and is an early non-renewal risk signal. Pitfalls: never-deactivated accounts inflate the denominator (Higher Logic: 69.9k accounts vs 9.3k active in 120 days); some members only consume the email digest (44–56% opens), so login-based measures understate engagement.",
    },
    levers: {
      pl: "Zaplanuj stały kalendarz klubu (spotkania, wątki tygodniowe, materiały przed spotkaniem) i zapraszaj członków imiennie do tematów zbieżnych z ich zainteresowaniami. Licz aktywność także na spotkaniach stacjonarnych, nie tylko na platformie. Kontaktuj się osobiście z członkami nieaktywnymi przez dłuższy czas, na długo przed odnowieniem członkostwa.",
      en: "Plan a steady club calendar (meetings, weekly threads, pre-meeting materials) and invite members by name to topics that match their interests. Count activity at in-person meetings as well, not only on the platform. Reach out personally to members who have been inactive for a longer time, well before their membership renewal.",
    },
    caveats: [
      {
        text: {
          pl: "Higher Logic obejmuje ok. 1 500 stowarzyszeń i organizacji non-profit z USA, Kanady i regionu APAC (VI 2024 – V 2025). To nie są europejskie think tanki.",
          en: "Higher Logic covers approx. 1,500 associations and non-profits from the USA, Canada and the APAC region (Jun 2024 – May 2025). These are not European think tanks.",
        },
        sourceIds: ["higherlogic_association_community_2025"],
      },
      {
        text: {
          pl: "Do aktywności klubu włącz także udział w spotkaniach stacjonarnych, których platforma online nie widzi.",
          en: "Include participation in in-person meetings, which the online platform cannot see, in club activity as well.",
        },
      },
      {
        text: {
          pl: "Brak polskich danych.",
          en: "There are no Polish data.",
        },
      },
      {
        text: {
          pl: "Raport Higher Logic jest wewnętrznie niespójny dla społeczności XL ('10% of users' wobec 1 297 unikalnych logowań przy ponad 50 tys. kont, czyli ≤2,6%). Pasma dużej społeczności to heurystyka przy mianowniku 'wszystkie konta z dostępem'; w panelu trzeba jednoznacznie wybrać jeden mianownik.",
          en: "The Higher Logic report is internally inconsistent for XL communities ('10% of users' versus 1,297 unique logins with over 50 thousand accounts, i.e. ≤2.6%). The large-community bands are a heuristic with the denominator 'all accounts with access'; the dashboard must clearly choose one denominator.",
        },
        sourceIds: ["higherlogic_association_community_2025"],
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "community_active_member_rate.large_open_community",
        label: {
          pl: "Duża, otwarta społeczność online (tysiące kont), aktywność miesięczna; mianownik: wszystkie konta z dostępem",
          en: "Large, open online community (thousands of accounts), monthly activity; denominator: all accounts with access",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka (mianownik: wszystkie konta z dostępem, zgodnie ze wzorem). Higher Logic 2025: średnio 563 unikalnych logujących miesięcznie przy medianie 12 040 kont (średnia 69 982) – rząd kilku procent; 13% kont aktywnych w 120 dniach. Deklaracja raportu 'XL: 10% użytkowników loguje się w miesiącu' jest wewnętrznie sprzeczna (1 297 unikalnych logowań przy ponad 50 tys. kont daje ≤2,6%), więc nie jest kotwicą. Przy mianowniku 'konta aktywne w ostatnich 120 dniach' (563 / 9,3 tys. ≈ 6%) obowiązywałaby inna skala – w panelu wybierz jeden mianownik. Okres: miesięcznie (pomocniczo 120 dni).",
          en: "Heuristic (denominator: all accounts with access, in line with the formula). Higher Logic 2025: on average 563 unique monthly logins with a median of 12,040 accounts (average 69,982) – of the order of a few per cent; 13% of accounts active within 120 days. The report's statement 'XL: 10% of users log in each month' is internally contradictory (1,297 unique logins with over 50 thousand accounts gives ≤2.6%), so it is not an anchor. With the denominator 'accounts active in the last 120 days' (563 / 9.3 thousand ≈ 6%) a different scale would apply – choose one denominator in the dashboard. Period: monthly (120 days as an auxiliary window).",
        },
        sourceIds: ["higherlogic_association_community_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 1,
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 3,
            basis: "E",
          },
          {
            tier: "normal",
            min: 3,
            max: 6,
            note: {
              pl: "rząd wielkości Higher Logic: średnio 563 unikalnych logujących miesięcznie przy medianie 12 040 kont (≈4,7%, wyliczenie przybliżone)",
              en: "the Higher Logic order of magnitude: on average 563 unique monthly logins with a median of 12,040 accounts (≈4.7%, approximate calculation)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 6,
            max: 10,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 10,
            max: 100,
            note: {
              pl: "heurystyka; dla porównania 13% kont aktywnych w oknie 120 dni (Higher Logic)",
              en: "heuristic; for comparison 13% of accounts active within a 120-day window (Higher Logic)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "community_active_member_rate.small_curated_club",
        label: {
          pl: "Mały, płatny lub kuratorowany klub dyskusyjny (do ok. 100 członków); aktywność = logowanie, udział w wątku lub spotkaniu",
          en: "Small, paid or curated discussion club (up to approx. 100 members); activity = login, taking part in a thread or meeting",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Heurystyka ekspercka bez bezpośredniego benchmarku. Uzasadnienie: członkostwo jest płatne i selektywne, a Higher Logic pokazuje, że mniejsze społeczności mają wyższy względny udział aktywnych. Okres: miesięcznie.",
          en: "Expert heuristic with no direct benchmark. Rationale: membership is paid and selective, and Higher Logic shows that smaller communities have a higher relative share of active members. Period: monthly.",
        },
        sourceIds: ["higherlogic_association_community_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
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
            basis: "E",
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
            max: 100,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "community_active_member_rate.small_curated_club",
      membership_club: "community_active_member_rate.small_curated_club",
    },
  },
  {
    key: "community_contributor_rate",
    metricId: "club_contributor_rate",
    group: "community",
    abbr: "CR 90-9-1",
    name: {
      pl: "Odsetek współtworzących (reguła 90-9-1)",
      en: "Contributor rate (90-9-1 rule)",
    },
    expansion: {
      pl: "Contributor Rate – odsetek aktywnych członków, którzy sami coś wnieśli (wątek, odpowiedź, komentarz, pytanie, materiał). Reguła 90-9-1: 90% obserwuje, 9% udziela się okazjonalnie, 1% tworzy większość treści.",
      en: "Contributor Rate – share of active members who contributed (thread, reply, comment, question, resource); the 90-9-1 rule: 90% lurk, 9% contribute occasionally, 1% create most content",
    },
    formula: {
      pl: "CR = unikalni współtwórcy w miesiącu (nowy wątek, odpowiedź, komentarz, wystąpienie) / unikalni aktywni (zalogowani) członkowie w miesiącu × 100%. Pomocniczo: udział top 1% autorów w liczbie wpisów.",
      en: "CR = unique contributors in the month (new thread, reply, comment, talk) / unique active (signed-in) members in the month × 100%. Auxiliary: the share of the top 1% of authors in the number of posts.",
    },
    interpretation: {
      pl: "Mierzy, czy społeczność jest rozmową, czy tylko widownią. Według reguły 90-9-1 współtworzy ok. 10% aktywnych, a dobrze zaprojektowane społeczności zbliżają się do 80-16-4 (ok. 20%). Pułapki: inny mianownik zmienia wynik dwukrotnie (Higher Logic podaje 6% wobec wszystkich logowań, a wobec unikalnych logujących wychodzi ok. 12%). Obserwatorzy też czerpią wartość, a zbyt wysoki odsetek w dużej społeczności może oznaczać spam lub sztuczne nabijanie aktywności.",
      en: "Shows whether the community is a conversation or just an audience. Under 90-9-1 about 10% of actives contribute; well-designed communities approach 80-16-4 (about 20%). Pitfalls: the denominator can halve or double the result (Higher Logic reports 6% of all logins vs about 12% of unique logins); lurkers still get value; an unusually high rate in a large community may signal spam or gamification.",
    },
    levers: {
      pl: "Obniż próg pierwszego wpisu: pytania otwierające przed spotkaniem, prośba o krótki komentarz do analizy, przedstawienie się nowych członków. Moderator powinien odpowiadać szybko i imiennie zapraszać osoby z doświadczeniem w danym temacie. Pokazuj wkład członków (cytaty w podsumowaniach, wystąpienia na spotkaniach), żeby spłaszczyć nierówność udziału.",
      en: "Lower the threshold for the first post: opening questions before a meeting, a request for a short comment on an analysis, introductions from new members. The moderator should reply quickly and invite people with experience in the topic by name. Showcase members' contributions (quotes in summaries, talks at meetings) to flatten participation inequality.",
    },
    caveats: [
      {
        text: {
          pl: "Reguła 90-9-1 to heurystyka z 2006 r., a nie prawo. Nielsen podkreśla, że nierówności udziału nie da się usunąć, można jedynie spłaszczyć krzywą, np. do 80-16-4.",
          en: "The 90-9-1 rule is a heuristic from 2006, not a law. Nielsen stresses that participation inequality cannot be removed – the curve can only be flattened, e.g. to 80-16-4.",
        },
        sourceIds: ["nngroup_participation_inequality_2006"],
      },
      {
        text: {
          pl: "Higher Logic: 'Unique Contributors… represents just 6% of the average monthly login base' (68 / 1 156 wszystkich logowań). Względem unikalnych logujących jest to ok. 12%, więc w panelu trzeba jednoznacznie zdefiniować mianownik.",
          en: "Higher Logic: 'Unique Contributors… represents just 6% of the average monthly login base' (68 / 1,156 total logins). Relative to unique logins it is approx. 12%, so the dashboard must define the denominator unambiguously.",
        },
        sourceIds: ["higherlogic_association_community_2025"],
      },
      {
        text: {
          pl: "Dane dotyczą społeczności stowarzyszeń (USA, Kanada, APAC). Społeczności czatowe i wydarzeniowe mogą mieć inny rozkład. Brak danych polskich.",
          en: "The data concern association communities (USA, Canada, APAC). Chat and event communities may have a different distribution. There are no Polish data.",
        },
      },
      {
        text: {
          pl: "Higher Logic nie definiuje jednoznacznie mianownika dla wartości według rozmiaru i wieku społeczności ('44 logins, but 36% of those are contributors'), więc mogą to być logowania, a nie unikalni logujący.",
          en: "Higher Logic does not define the denominator unambiguously for values by community size and age ('44 logins, but 36% of those are contributors'), so these may be logins rather than unique users logging in.",
        },
        sourceIds: ["higherlogic_association_community_2025"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "community_contributor_rate.large_community",
        label: {
          pl: "Społeczność online średniej lub dużej skali (powyżej ok. 1 tys. kont)",
          en: "Medium or large online community (over approx. 1,000 accounts)",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Reguła 90-9-1 (Nielsen 2006): ~10% współtworzących, cel 80-16-4 (~20%), blogi 95-5-0,1 (~5%). Higher Logic 2025: średnio 68 współtwórców na 563 unikalnych logujących (~12%, wyliczenie własne), społeczności 3–5-letnie 7–10%, społeczności M 17%. Okres: miesięcznie.",
          en: "The 90-9-1 rule (Nielsen 2006): ~10% contributors, target 80-16-4 (~20%), blogs 95-5-0.1 (~5%). Higher Logic 2025: on average 68 contributors per 563 unique logins (~12%, own calculation), communities aged 3–5 years 7–10%, M communities 17%. Period: monthly.",
        },
        sourceIds: [
          "nngroup_participation_inequality_2006",
          "higherlogic_association_community_2025",
        ],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 5,
            note: {
              pl: "poziom blogów (95-5-0,1)",
              en: "the level of blogs (95-5-0.1)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 5,
            max: 8,
            note: {
              pl: "dojrzałe społeczności 3–5 lat: 7–10%",
              en: "mature communities aged 3–5 years: 7–10%",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 8,
            max: 12,
            note: {
              pl: "reguła 90-9-1 ≈ 10%; Higher Logic średnio ~12%",
              en: "the 90-9-1 rule ≈ 10%; Higher Logic on average ~12%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 12,
            max: 20,
            note: {
              pl: "społeczności M (Higher Logic) 17%",
              en: "M communities (Higher Logic) 17%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 20,
            max: 100,
            note: {
              pl: "cel 80-16-4 (Nielsen)",
              en: "the 80-16-4 target (Nielsen)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "community_contributor_rate.small_club",
        label: {
          pl: "Mały klub dyskusyjny (do kilkuset członków)",
          en: "Small discussion club (up to a few hundred members)",
        },
        segments: ["membership_club"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Higher Logic 2025: współtwórcy jako odsetek logujących – społeczności S 36%, S/M 21%, M 17%, nowe (<2 lata) 16%. Pasma dla mniejszych klubów to ekstrapolacja heurystyczna. Okres: miesięcznie.",
          en: "Higher Logic 2025: contributors as a share of logins – S communities 36%, S/M 21%, M 17%, new (<2 years) 16%. The bands for smaller clubs are a heuristic extrapolation. Period: monthly.",
        },
        sourceIds: [
          "higherlogic_association_community_2025",
          "nngroup_participation_inequality_2006",
        ],
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
            max: 17,
            basis: "E",
          },
          {
            tier: "normal",
            min: 17,
            max: 25,
            note: {
              pl: "społeczności S/M 21%",
              en: "S/M communities 21%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 25,
            max: 36,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 36,
            max: 100,
            note: {
              pl: "społeczności S (500–1 tys. kont) 36%",
              en: "S communities (500–1,000 accounts) 36%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "community_contributor_rate.small_club",
      membership_club: "community_contributor_rate.small_club",
    },
  },
  {
    key: "lead_to_mql_rate",
    metricId: "lead_to_mql_rate",
    group: "community",
    abbr: "Lead→MQL",
    name: {
      pl: "Konwersja leadów do MQL",
      en: "Lead-to-MQL conversion rate",
    },
    expansion: {
      pl: "Lead → MQL (Marketing Qualified Lead – lead zakwalifikowany przez marketing: pasuje do profilu idealnego klienta i wykazał zainteresowanie ofertą)",
      en: "Lead to Marketing Qualified Lead (a lead that fits the ideal customer profile and showed interest)",
    },
    formula: {
      pl: "Lead→MQL = leady z kohorty miesiąca M, które uzyskały status MQL (w oknie np. 90 dni) / wszystkie nowe leady z miesiąca M × 100%",
      en: "Lead→MQL = leads from the month-M cohort that reached MQL status (within a window of e.g. 90 days) / all new leads from month M × 100%",
    },
    interpretation: {
      pl: "Pokazuje jakość pozyskiwanych kontaktów i trafność targetowania, np. ilu zapisanych na raport lub wydarzenie to decydenci z firm i instytucji pasujących do oferty. Pułapki: wynik zależy od definicji MQL, którą każda organizacja ustala sama. Zbyt wysoki odsetek może oznaczać zbyt luźne kryteria, a liczenie bez kohort miesza leady z różnych okresów.",
      en: "Shows the quality of captured contacts and targeting accuracy, e.g. how many report/event sign-ups are decision-makers from organisations that fit the offer. Pitfalls: entirely dependent on your own MQL definition; a very high rate may mean overly loose criteria; non-cohort counting mixes periods.",
    },
    levers: {
      pl: "Spisz w CRM definicję MQL (dopasowanie profilu i zachowania: pobranie raportu, udział w wydarzeniu, wizyta na stronie oferty) i stosuj ją jednakowo do wszystkich źródeł. Prowadź nowe leady sekwencją treści dopasowaną do sektora i stanowiska. Analizuj konwersję według kanału, bo wydarzenia dla kadry zarządzającej i polecenia dają inne wyniki niż webinary.",
      en: "Write down the MQL definition in the CRM (profile fit and behaviour: report download, event attendance, a visit to the offer page) and apply it equally to all sources. Nurture new leads with a content sequence matched to sector and job title. Analyse conversion by channel, because executive events and referrals produce different results from webinars.",
    },
    caveats: [
      {
        text: {
          pl: "Jedno źródło: dane klientów jednej agencji (ok. 70% B2B, głównie SEO, rynek USA). Raport ma niespójności liczby branż (30 / 15 / 29) i nie podaje okresu danych ('Our data has been built over 10 years').",
          en: "A single source: the client data of one agency (approx. 70% B2B, mainly SEO, US market). The report is inconsistent about the number of industries (30 / 15 / 29) and does not give the data period ('Our data has been built over 10 years').",
        },
        sourceIds: ["fps_lead_to_mql_2025"],
      },
      {
        text: {
          pl: "Brak polskich ani europejskich benchmarków. Wskaźnik ma sens dopiero po spisaniu definicji MQL w CRM (np. scoring dopasowania i zachowania).",
          en: "There are no Polish or European benchmarks. The indicator makes sense only once the MQL definition has been written down in the CRM (e.g. fit and behaviour scoring).",
        },
      },
      {
        text: {
          pl: "Ta sama agencja podaje dla Entertainment Lead→MQL 34% (raport Lead-to-MQL 2025, S24) i 19% (Sales Funnel Benchmarks 2026, S26), co dodatkowo uzasadnia ostrożność: pewność średnia, na granicy niskiej.",
          en: "The same agency gives an Entertainment Lead→MQL of 34% (Lead-to-MQL report 2025, S24) and 19% (Sales Funnel Benchmarks 2026, S26), which further justifies caution: medium confidence, bordering on low.",
        },
        sourceIds: ["fps_lead_to_mql_2025", "fps_sales_funnel_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "lead_to_mql_rate.b2b_general",
        label: {
          pl: "B2B ogólnie (oferta instytucjonalna, członkostwa firmowe, partnerstwa)",
          en: "B2B in general (institutional offer, corporate memberships, partnerships)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Średnia First Page Sage 31% (wszystkie branże i kanały) jako granica normalny/dobry. Branże: B2B SaaS 39%, doradztwo biznesowe 28%, usługi finansowe 29%, szkolnictwo wyższe 45%. Dolne pasma to heurystyka. Okres: miesięcznie (kohortowo).",
          en: "The First Page Sage average of 31% (all industries and channels) as the normal/good boundary. Industries: B2B SaaS 39%, business consulting 28%, financial services 29%, higher education 45%. The lower bands are a heuristic. Period: monthly (by cohort).",
        },
        sourceIds: ["fps_lead_to_mql_2025", "fps_sales_funnel_2026"],
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
            max: 20,
            basis: "E",
          },
          {
            tier: "normal",
            min: 20,
            max: 31,
            note: {
              pl: "do średniej wszystkich branż (31%); doradztwo biznesowe 28%",
              en: "up to the all-industry average (31%); business consulting 28%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 31,
            max: 45,
            note: {
              pl: "B2B SaaS 39%",
              en: "39% in B2B SaaS",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 45,
            max: 100,
            note: {
              pl: "szkolnictwo wyższe 45%",
              en: "higher education 45%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "lead_to_mql_rate.events_webinars",
        label: {
          pl: "Leady z wydarzeń i webinarów",
          en: "Leads from events and webinars",
        },
        segments: ["events", "b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Benchmarki kanałowe First Page Sage: webinar 19%, konferencje 28%, targi 24%, executive events 54%, e-mail 38%, polecenia klientów 56%. Okres: na wydarzenie / miesięcznie.",
          en: "First Page Sage channel benchmarks: webinar 19%, conferences 28%, trade shows 24%, executive events 54%, e-mail 38%, customer referrals 56%. Period: per event / monthly.",
        },
        sourceIds: ["fps_lead_to_mql_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 8,
            basis: "E",
          },
          {
            tier: "weak",
            min: 8,
            max: 14,
            basis: "E",
          },
          {
            tier: "normal",
            min: 14,
            max: 24,
            note: {
              pl: "webinary 19%, targi 24%",
              en: "webinars 19%, trade shows 24%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 24,
            max: 40,
            note: {
              pl: "konferencje 28%",
              en: "conferences 28%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 40,
            max: 100,
            note: {
              pl: "wydarzenia dla kadry zarządzającej (executive events) 54%",
              en: "executive events 54%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "lead_to_mql_rate.b2b_general",
      b2b_institution: "lead_to_mql_rate.b2b_general",
      events: "lead_to_mql_rate.events_webinars",
    },
  },
  {
    key: "mql_to_sql_rate",
    metricId: "mql_to_sql_rate",
    group: "community",
    abbr: "MQL→SQL",
    name: {
      pl: "Konwersja MQL do SQL",
      en: "MQL-to-SQL conversion rate",
    },
    expansion: {
      pl: "MQL → SQL (Sales Qualified Lead – lead przyjęty przez sprzedaż: zweryfikowany jako dopasowany, z intencją zakupu i umówionym spotkaniem)",
      en: "Marketing Qualified Lead to Sales Qualified Lead (vetted by sales as a fit, with buying intent and a booked meeting)",
    },
    formula: {
      pl: "MQL→SQL = MQL z kohorty miesiąca M zaakceptowane przez sprzedaż jako SQL / wszystkie MQL z miesiąca M × 100%",
      en: "MQL→SQL = MQLs from the month-M cohort accepted by sales as SQLs / all MQLs from month M × 100%",
    },
    interpretation: {
      pl: "Mierzy jakość MQL i zgodność marketingu ze sprzedażą: niski wynik oznacza, że marketing przekazuje kontakty, których sprzedaż nie chce, albo że sprzedaż nie podejmuje kontaktu. Pułapki: rzetelne źródła podają od 13% do 68% zależnie od definicji MQL. Porównuj się więc z benchmarkiem o tej samej definicji i śledź osobno MQL odrzucone i MQL bez kontaktu.",
      en: "Measures MQL quality and marketing–sales alignment: a low value means marketing hands over contacts sales does not want, or sales does not follow up. Pitfalls: reputable sources range from 13% to 68% depending on the MQL definition, so compare only with a same-definition benchmark and track rejected vs. never-contacted MQLs separately.",
    },
    levers: {
      pl: "Uzgodnij ze sprzedażą jedną definicję MQL i SQL oraz termin, w którym handlowiec musi zakwalifikować albo odrzucić lead z podaniem powodu. Przekazuj leady z pełnym kontekstem (pobrane materiały, wydarzenia, rozmowy), a odrzucone kieruj z powrotem do sekwencji treści. Co kwartał przeglądaj powody odrzuceń i koryguj scoring.",
      en: "Agree a single MQL and SQL definition with sales, and a deadline by which a salesperson must qualify or reject a lead, giving a reason. Hand over leads with full context (downloaded materials, events, conversations), and send rejected ones back to the content sequence. Review rejection reasons every quarter and adjust the scoring.",
    },
    caveats: [
      {
        text: {
          pl: "Ta sama agencja (First Page Sage) podaje dla B2B SaaS 13% w jednym raporcie i 38% w drugim, co dowodzi zależności od definicji. Wybierz w panelu jeden kontekst zgodny z własną definicją.",
          en: "The same agency (First Page Sage) gives 13% for B2B SaaS in one report and 38% in another, which proves the dependence on the definition. Choose one context in the dashboard that matches your own definition.",
        },
        sourceIds: ["fps_mql_to_sql_2026", "fps_sales_funnel_2026"],
      },
      {
        text: {
          pl: "Ebsta 68% pochodzi z danych firm technologicznych z dojrzałym procesem SDR. Dla think tanku z małym wolumenem leadów wynik będzie bardzo zmienny.",
          en: "Ebsta's 68% comes from data of technology companies with a mature SDR process. For a think tank with a small volume of leads, the result will be highly variable.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
      },
      {
        text: {
          pl: "Brak danych polskich.",
          en: "There are no Polish data.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "mql_to_sql_rate.broad_mql",
        label: {
          pl: "Szeroka definicja MQL (scoring zachowań: pobranie raportu, zapis, udział w webinarze + dopasowanie profilu)",
          en: "Broad MQL definition (behaviour scoring: report download, sign-up, webinar attendance + profile fit)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "First Page Sage, raport MQL→SQL 2026 (dane 2019–2025): zakres median branżowych 10–26%, B2B SaaS 13%, Entertainment 16%, Higher Education 21%. Średnia prosta 30 branż ≈ 16% (wyliczenie własne). Okres: miesięcznie (kohortowo).",
          en: "First Page Sage, MQL→SQL report 2026 (data 2019–2025): the range of industry medians 10–26%, B2B SaaS 13%, Entertainment 16%, Higher Education 21%. The simple average of 30 industries ≈ 16% (own calculation). Period: monthly (by cohort).",
        },
        sourceIds: ["fps_mql_to_sql_2026"],
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
            note: {
              pl: "poniżej najniższej mediany branżowej (10%)",
              en: "below the lowest industry median (10%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 10,
            max: 16,
            note: {
              pl: "B2B SaaS 13%, usługi finansowe 13%, średnia 30 branż ≈16%",
              en: "B2B SaaS 13%, financial services 13%, average of 30 industries ≈16%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 16,
            max: 26,
            note: {
              pl: "szkolnictwo wyższe 21%",
              en: "higher education 21%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 26,
            max: 100,
            note: {
              pl: "najwyższe mediany branżowe 26%",
              en: "the highest industry medians 26%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "mql_to_sql_rate.narrow_mql",
        label: {
          pl: "Wąska definicja MQL (deklarowana intencja: prośba o ofertę, demo, kontakt handlowy, zapytanie o partnerstwo)",
          en: "Narrow MQL definition (declared intent: request for an offer, demo, sales contact, partnership enquiry)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "First Page Sage, Sales Funnel Benchmarks 2026: zakres 32–58% (B2B SaaS 38%, Financial Services 38%, Higher Education 46%). Ebsta x Pavilion 2025: MQL→SQL 68% (dane CRM ponad 655 tys. szans). Okres: miesięcznie (kohortowo).",
          en: "First Page Sage, Sales Funnel Benchmarks 2026: range 32–58% (B2B SaaS 38%, Financial Services 38%, Higher Education 46%). Ebsta x Pavilion 2025: MQL→SQL 68% (CRM data from over 655 thousand opportunities). Period: monthly (by cohort).",
        },
        sourceIds: ["fps_sales_funnel_2026", "ebsta_pavilion_gtm_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 20,
            basis: "E",
          },
          {
            tier: "weak",
            min: 20,
            max: 32,
            note: {
              pl: "poniżej najniższej wartości w tabeli lejka (32%)",
              en: "below the lowest value in the funnel listing (32%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 32,
            max: 40,
            note: {
              pl: "B2B SaaS 38%, usługi finansowe 38%",
              en: "B2B SaaS 38%, financial services 38%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 40,
            max: 58,
            note: {
              pl: "szkolnictwo wyższe 46%",
              en: "higher education 46%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 58,
            max: 100,
            note: {
              pl: "Ebsta x Pavilion 2025: 68%",
              en: "68% according to Ebsta x Pavilion 2025",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "mql_to_sql_rate.broad_mql",
      b2b_institution: "mql_to_sql_rate.broad_mql",
    },
  },
  {
    key: "win_rate",
    metricId: "win_rate",
    group: "community",
    abbr: "Win rate",
    name: {
      pl: "Skuteczność domykania (SQL → klient)",
      en: "Win rate (SQL-to-customer)",
    },
    expansion: {
      pl: "Win Rate – odsetek szans sprzedażowych (SQL/opportunity) zakończonych wygraną (closed-won)",
      en: "Win Rate – share of sales opportunities (SQL/opportunity) that end closed-won",
    },
    formula: {
      pl: "Win rate = wygrane / (wygrane + przegrane, w tym 'brak decyzji') wśród szans zamkniętych w okresie × 100%. Wariant kohortowy: wygrane z SQL utworzonych w miesiącu M / wszystkie SQL z miesiąca M.",
      en: "Win rate = won / (won + lost, including 'no decision') among opportunities closed in the period × 100%. Cohort variant: won from SQLs created in month M / all SQLs from month M.",
    },
    interpretation: {
      pl: "Mierzy skuteczność sprzedaży i jakość kwalifikacji: ile wartościowych rozmów kończy się umową (członkostwo instytucjonalne, sponsoring, zlecenie). Pułapki: pomijanie szans 'bez decyzji' i zawieszonych zawyża wynik, a mieszanie nowych klientów z rozszerzeniami i odnowieniami (te mają ok. 2,5 razy wyższą skuteczność) zniekształca obraz. Przy kilkunastu szansach na kwartał wynik jest bardzo niestabilny.",
      en: "Measures sales effectiveness and qualification quality: how many qualified conversations end in a contract (institutional membership, sponsorship, commission). Pitfalls: dropping 'no decision'/stalled deals inflates it; mixing new logos with expansions/renewals (about 2.5× higher win rate) distorts it; with a dozen opportunities per quarter it is very noisy.",
    },
    levers: {
      pl: "Kwalifikuj szanse wcześnie (budżet, decydent, termin, potrzeba) i zamykaj te bez perspektyw, zamiast trzymać je w lejku. Przygotuj materiały pod konkretne zastrzeżenia instytucji (zamówienia publiczne, faktura, zakres licencji) i angażuj ekspertów merytorycznych w kluczowych rozmowach. Analizuj powody przegranych, w tym brak decyzji, i raportuj osobno nowych klientów oraz rozszerzenia.",
      en: "Qualify opportunities early (budget, decision-maker, timing, need) and close those without prospects rather than keeping them in the pipeline. Prepare materials for institutions' specific objections (public procurement, invoicing, licence scope) and involve subject-matter experts in key conversations. Analyse the reasons for losses, including no decision, and report new clients and expansions separately.",
    },
    caveats: [
      {
        text: {
          pl: "Ebsta to dane firm technologicznych i usługowych (transakcje w USD), a nie think tanków. Brak danych polskich i europejskich.",
          en: "Ebsta is data from technology and service companies (deals in USD), not think tanks. There are no Polish or European data.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
      },
      {
        text: {
          pl: "Raport Ebsta 2025 podaje spadek win rate o 10% rel. r/r. Inne źródła wtórne podają rozbieżne wartości dla 2024 r., więc liczby r/r traktuj ostrożnie.",
          en: "The Ebsta 2025 report gives a 10% relative y/y decline in win rate. Other secondary sources give divergent values for 2024, so treat the y/y figures with caution.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
      },
      {
        text: {
          pl: "Raporty Gong i HubSpot (ok. 21%) znane są tylko ze streszczeń wtórnych i nie zostały użyte.",
          en: "The Gong and HubSpot reports (approx. 21%) are known only from secondary summaries and were not used.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "win_rate.new_logo",
        label: {
          pl: "Nowi klienci B2B (new logo: członkostwa instytucjonalne, sponsoring, zlecenia badawcze)",
          en: "New B2B clients (new logo: institutional memberships, sponsorship, commissioned research)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Ebsta x Pavilion 2025: win rate nowych klientów 19% (na s. 22: 18%), top performerzy mają win rate wyższy o 43% rel. (≈27%, wyliczenie własne). First Page Sage 2026 dla B2B SaaS: SQL→szansa 42% × szansa→wygrana 37% ≈ 16% (wyliczenie własne). Ebsta 2023: typowe oczekiwanie 20–25% szans na zamknięcie. Dolne pasma to heurystyka. Okres: kwartalnie (kroczące 12 miesięcy przy małym wolumenie).",
          en: "Ebsta x Pavilion 2025: new-client win rate 19% (18% on p. 22), top performers have a 43% higher relative win rate (≈27%, own calculation). First Page Sage 2026 for B2B SaaS: SQL→opportunity 42% × opportunity→win 37% ≈ 16% (own calculation). Ebsta 2023: a typical expectation of a 20–25% chance of closing. The lower bands are a heuristic. Period: quarterly (rolling 12 months at low volume).",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025", "fps_sales_funnel_2026", "ebsta_b2b_sales_2023"],
        bands: [
          {
            tier: "critical",
            min: 0,
            max: 8,
            basis: "E",
          },
          {
            tier: "weak",
            min: 8,
            max: 14,
            basis: "E",
          },
          {
            tier: "normal",
            min: 14,
            max: 19,
            note: {
              pl: "FPS B2B SaaS SQL→klient ≈16% (wyliczenie)",
              en: "FPS B2B SaaS SQL→customer ≈16% (calculation)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 19,
            max: 27,
            note: {
              pl: "od średniej Ebsta 2025 (19%)",
              en: "from the Ebsta 2025 average (19%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 27,
            max: 100,
            note: {
              pl: "≈ poziom top performerów (+43% rel. względem średniej)",
              en: "≈ the level of top performers (+43% relative to the average)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "win_rate.expansions",
        label: {
          pl: "Rozszerzenia i odnowienia u obecnych klientów (upsell, cross-sell, kolejne edycje sponsoringu)",
          en: "Expansions and renewals with existing clients (upsell, cross-sell, further sponsorship editions)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "Ebsta x Pavilion 2025: win rate rozszerzeń 45% ('Selling to existing customers is 2.5x easier'). Pasma to heurystyka wokół tej wartości. Okres: kwartalnie.",
          en: "Ebsta x Pavilion 2025: expansion win rate 45% ('Selling to existing customers is 2.5x easier'). The bands are a heuristic around this value. Period: quarterly.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
        bands: [
          {
            tier: "critical",
            min: 0,
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
            max: 45,
            basis: "E",
          },
          {
            tier: "good",
            min: 45,
            max: 60,
            note: {
              pl: "od średniej Ebsta dla rozszerzeń (45%)",
              en: "from the Ebsta average for expansions (45%)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 60,
            max: 100,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "win_rate.new_logo",
      b2b_institution: "win_rate.new_logo",
    },
  },
  {
    key: "lead_response_time",
    metricId: "lead_response_time",
    group: "community",
    abbr: "STL",
    name: {
      pl: "Czas reakcji na lead (speed to lead)",
      en: "Lead response time (speed to lead)",
    },
    expansion: {
      pl: "Speed To Lead / Lead Response Time – czas od zgłoszenia leada (formularz, e-mail, telefon) do pierwszego merytorycznego kontaktu człowieka",
      en: "Speed To Lead / Lead Response Time – time from lead submission to the first meaningful human contact",
    },
    formula: {
      pl: "STL = mediana (czas pierwszego kontaktu − czas utworzenia leada) w minutach roboczych dla leadów o wysokiej intencji w okresie. Dodatkowo raportuj % leadów obsłużonych w ≤5 min, ≤60 min i odsetek bez kontaktu.",
      en: "STL = median (time of first contact − time of lead creation) in working minutes for high-intent leads in the period. Additionally report the % of leads handled in ≤5 min and ≤60 min, and the share with no contact.",
    },
    interpretation: {
      pl: "Mierzy, czy organizacja kontaktuje się z zainteresowanymi, póki temat jest gorący (zapytanie o sponsoring, ofertę instytucjonalną, partnerstwo przy wydarzeniu). Według HBR firmy kontaktujące się w ciągu godziny miały niemal 7 razy większą szansę zakwalifikować lead niż te, które czekały godzinę dłużej. Pułapki: automatyczny e-mail potwierdzający to nie kontakt. Mierz w godzinach roboczych, a leady o niskiej intencji (zapis na newsletter) obsługuj automatycznie zamiast wliczać je do wskaźnika.",
      en: "Measures whether the organisation reaches interested parties while the topic is hot (sponsorship, institutional offer, event partnership enquiries); per HBR, firms contacting within an hour were nearly 7× more likely to qualify the lead than those waiting one hour longer. Pitfalls: an auto-reply is not contact; measure in business hours; route low-intent leads (newsletter sign-ups) to automated nurture rather than this KPI.",
    },
    levers: {
      pl: "Ustal i monitoruj SLA pierwszego kontaktu dla leadów o wysokiej intencji, z dyżurem w godzinach pracy i automatycznym przydziałem opiekuna. Wysyłaj natychmiastowe potwierdzenie z propozycją terminu rozmowy, a powiadomienie o nowym leadzie kieruj do konkretnej osoby, nie na ogólną skrzynkę. Raportuj odsetek leadów obsłużonych w progach czasowych i bez kontaktu.",
      en: "Set and monitor a first-contact SLA for high-intent leads, with a rota during working hours and automatic assignment of an account manager. Send an immediate acknowledgement proposing a call slot, and route the new-lead notification to a named person rather than a shared inbox. Report the share of leads handled within the time thresholds and the share with no contact.",
    },
    caveats: [
      {
        text: {
          pl: "Kluczowe dane HBR pochodzą z 2011 r. i z rynku USA. Pełny tekst jest za paywallem, a liczby potwierdzono w streszczeniu SmartCompany (2011).",
          en: "The key HBR data date from 2011 and come from the US market. The full text is behind a paywall, and the figures were confirmed in the SmartCompany summary (2011).",
        },
        sourceIds: ["hbr_online_sales_leads_2011", "smartcompany_hbr_leads_2011"],
      },
      {
        text: {
          pl: "Reguła pięciu minut opiera się na starszych badaniach dostawców (InsideSales) i bywa kwestionowana. Dane Blazeo 2026 (74% poza oknem 5 minut; SLA 54,9% vs 29,5% w 15 min) są potwierdzone wyłącznie w omówieniu LeanData (15.04.2026) – raportu pierwotnego nie zweryfikowano.",
          en: "The five-minute rule rests on older vendor studies (InsideSales) and is sometimes questioned. The Blazeo 2026 data (74% outside the 5-minute window; SLA 54.9% vs 29.5% within 15 min) are confirmed only in a LeanData summary (15.04.2026) – the primary report was not verified.",
        },
        sourceIds: ["leandata_speed_to_lead_2026"],
      },
      {
        text: {
          pl: "Brak polskich danych. Dla klientów sektora publicznego szybki kontakt nie skraca procedur zamówień, ale nadal wpływa na kwalifikację.",
          en: "There are no Polish data. For public-sector clients, quick contact does not shorten procurement procedures, but it still affects qualification.",
        },
      },
      {
        text: {
          pl: "Analiza 1,25 mln leadów (mnożniki ≈7× i >60×) objęła 29 firm B2C i tylko 13 B2B, a wskaźnik dotyczy leadów B2B.",
          en: "The analysis of 1.25 million leads (multipliers of ≈7× and >60×) covered 29 B2C companies and only 13 B2B ones, while the indicator concerns B2B leads.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "lead_response_time.high_intent_inbound",
        label: {
          pl: "Leady przychodzące o wysokiej intencji (zapytanie ofertowe, sponsoring, subskrypcja instytucjonalna), w godzinach pracy",
          en: "High-intent inbound leads (offer enquiry, sponsorship, institutional subscription), during working hours",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        displayUnit: "minutes",
        window: "month",
        direction: "lower",
        method: {
          pl: "Progi czasowe ze źródeł. HBR 2011 (2 241 firm z USA): 37% odpowiada w ciągu godziny, 16% w 1–24 h, 24% po >24 h, 23% wcale, średnia 42 h. Kontakt w ciągu godziny daje ≈7 razy większą szansę kwalifikacji, a >60 razy większą niż po 24 h. Blazeo 2026 (573 firmy): 74% nie mieści się w 5 min, a przy SLA 54,9% odpowiada w 15 min (vs 29,5% bez SLA). Okres: miesięcznie (mediana + odsetki w progach).",
          en: "Time thresholds from the sources. HBR 2011 (2,241 US companies): 37% respond within an hour, 16% within 1–24 h, 24% after >24 h, 23% not at all, average 42 h. Contact within an hour gives a ≈7 times higher chance of qualification, and >60 times higher than after 24 h. Blazeo 2026 (573 companies): 74% miss the 5-minute window, and with an SLA 54.9% respond within 15 min (vs 29.5% without an SLA). Period: monthly (median + shares within thresholds).",
        },
        sourceIds: [
          "smartcompany_hbr_leads_2011",
          "hbr_online_sales_leads_2011",
          "leandata_speed_to_lead_2026",
        ],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 0.0833333333333,
            note: {
              pl: "standard 'pięciu minut'; 74% firm go nie spełnia (Blazeo 2026, dane z omówienia LeanData)",
              en: "the 'five-minute' standard; 74% of companies do not meet it (Blazeo 2026, data from the LeanData summary)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0.0833333333333,
            max: 1,
            note: {
              pl: "w ciągu godziny (37% firm w badaniu HBR)",
              en: "within an hour (37% of companies in the HBR study)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 1,
            max: 8,
            note: {
              pl: "ten sam dzień roboczy",
              en: "the same working day",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 8,
            max: 24,
            note: {
              pl: "kontakt następnego dnia roboczego",
              en: "contact on the next working day",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 24,
            max: null,
            note: {
              pl: ">24 h – według HBR >60 razy mniejsza szansa kwalifikacji niż przy kontakcie w ciągu godziny",
              en: ">24 h – according to HBR a >60 times lower chance of qualification than with contact within an hour",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "lead_response_time.high_intent_inbound",
      b2b_institution: "lead_response_time.high_intent_inbound",
    },
  },
  {
    key: "sales_cycle_length",
    metricId: "sales_cycle_length",
    group: "community",
    abbr: "SCL",
    name: {
      pl: "Długość cyklu sprzedaży B2B",
      en: "B2B sales cycle length",
    },
    expansion: {
      pl: "Sales Cycle Length – liczba dni od utworzenia szansy sprzedażowej (SQL/opportunity) do jej wygrania (closed-won)",
      en: "Sales Cycle Length – days from opportunity (SQL) creation to closed-won",
    },
    formula: {
      pl: "SCL = mediana (data wygranej − data utworzenia szansy) w dniach dla transakcji wygranych w okresie, osobno dla nowych klientów i rozszerzeń oraz według wielkości transakcji. Pomocniczo: % otwartych szans starszych niż 2× własna mediana cyklu (Ebsta: szanse otwarte >2× średniego cyklu mają ok. 3% szans).",
      en: "SCL = median (win date − opportunity creation date) in days for deals won in the period, separately for new clients and expansions and by deal size. Auxiliary: % of open opportunities older than 2× your own median cycle (Ebsta: opportunities open for >2× the average cycle have approx. a 3% chance).",
    },
    interpretation: {
      pl: "Pokazuje tempo zamieniania szans w przychód i pomaga planować przepływy oraz pipeline, np. sprzedaż sponsoringu z wyprzedzeniem przed wydarzeniem. Ebsta pokazuje, że szanse otwarte dłużej niż dwukrotność średniego cyklu mają ok. 3% szans na wygraną, a poślizg późnych etapów o ponad 2 miesiące drastycznie obniża skuteczność. Pułapki: średnia zamiast mediany (zawyżają ją pojedyncze długie transakcje) oraz mieszanie małych i dużych umów. Cykl skrócony rabatem może obniżyć wartość transakcji.",
      en: "Shows how fast opportunities turn into revenue and supports cash-flow and pipeline planning (e.g., selling sponsorship well ahead of an event). Ebsta shows opportunities open longer than twice the average cycle have about a 3% chance of closing, and late-stage slippage beyond 2 months sharply cuts win rates. Pitfalls: mean instead of median (skewed by a few long deals), mixing small and large deals; shortening the cycle via discounts can erode deal value.",
    },
    levers: {
      pl: "Ustal z klientem plan decyzji na pierwszym spotkaniu: osoby decyzyjne, budżet, wymagane dokumenty i terminy, w tym procedury zamówień publicznych. Przygotuj gotowe pakiety dokumentów (umowa wzorcowa, opis licencji, dane do faktury), żeby skrócić etap formalny. Monitoruj szanse otwarte dłużej niż dwukrotność własnej mediany cyklu i decyduj, czy je aktywnie domknąć, czy zamknąć jako przegrane.",
      en: "Agree a decision plan with the client at the first meeting: decision-makers, budget, required documents and deadlines, including public-procurement procedures. Prepare ready document packs (template contract, licence description, invoicing details) to shorten the formal stage. Monitor opportunities open for longer than twice your own median cycle and decide whether to push them to a close or mark them as lost.",
    },
    caveats: [
      {
        text: {
          pl: "Ebsta segmentuje transakcje według wartości w USD na rynku głównie technologicznym. Przypisanie produktów think tanku do segmentów małe, średnie i duże jest heurystyczne.",
          en: "Ebsta segments deals by USD value in a mainly technology market. Assigning think-tank products to the small, medium and large segments is heuristic.",
        },
        sourceIds: ["ebsta_b2b_sales_2023"],
      },
      {
        text: {
          pl: "Klienci z sektora publicznego (zamówienia publiczne) i budżety roczne instytucji mogą wydłużać cykl niezależnie od jakości sprzedaży. Warto mieć dla nich osobny kontekst.",
          en: "Public-sector clients (public procurement) and institutions' annual budgets can lengthen the cycle regardless of sales quality. It is worth having a separate context for them.",
        },
      },
      {
        text: {
          pl: "Brak danych polskich. Ebsta 2025 raportuje skrócenie cykli o 9% r/r i 36% transakcji z poślizgiem.",
          en: "There are no Polish data. Ebsta 2025 reports cycles 9% shorter y/y and 36% of deals slipping.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "sales_cycle_length.small_deals",
        label: {
          pl: "Małe transakcje B2B (np. subskrypcje firmowe, pojedyncze pakiety)",
          en: "Small B2B deals (e.g. corporate subscriptions, single packages)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        displayUnit: "days",
        window: "quarter",
        direction: "lower",
        method: {
          pl: "Ebsta 2023 (3,2 mln szans): 'złoty okres' zamknięcia małych transakcji to 31–60 dni (win rate wyższy o 165%) – mieści się w całości w paśmie 'optymalny'. Szanse otwarte dłużej niż 2× ŚREDNI cykl mają ok. 3% szans na zamknięcie; próg 'krytyczny' licz dynamicznie jako 2× własna mediana (120 dni to wartość domyślna). Progi 75 i 90 to heurystyka. Okres: kwartalnie (mediana transakcji wygranych).",
          en: "Ebsta 2023 (3.2 million opportunities): the 'golden period' for closing small deals is 31–60 days (a 165% higher win rate) – it falls entirely within the 'optimal' band. Opportunities open for longer than 2× the AVERAGE cycle have approx. a 3% chance of closing; calculate the 'critical' threshold dynamically as 2× your own median (120 days is the default). The 75 and 90 thresholds are a heuristic. Period: quarterly (median of deals won).",
        },
        sourceIds: ["ebsta_b2b_sales_2023"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 1440,
            note: {
              pl: "do końca 'złotego okresu' 31–60 dni (Ebsta 2023: win rate wyższy o 165%)",
              en: "up to the end of the 31–60-day 'golden period' (Ebsta 2023: a 165% higher win rate)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 1440,
            max: 1800,
            note: {
              pl: "tuż po 'złotym okresie' – heurystyka",
              en: "just after the 'golden period' – heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 1800,
            max: 2160,
            basis: "E",
          },
          {
            tier: "weak",
            min: 2160,
            max: 2880,
            basis: "E",
          },
          {
            tier: "critical",
            min: 2880,
            max: null,
            note: {
              pl: "Ebsta: szanse otwarte >2× ŚREDNIEGO cyklu mają ok. 3% szans; licz próg dynamicznie jako 2× własna mediana",
              en: "Ebsta: opportunities open for >2× the AVERAGE cycle have approx. a 3% chance; calculate the threshold dynamically as 2× your own median",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "sales_cycle_length.mid_new_logo",
        label: {
          pl: "Średnie transakcje z nowymi klientami (np. pakiety sponsorskie, członkostwa instytucjonalne)",
          en: "Medium deals with new clients (e.g. sponsorship packages, institutional memberships)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        displayUnit: "days",
        window: "quarter",
        direction: "lower",
        method: {
          pl: "Ebsta x Pavilion 2025: nowi klienci średnio 91 dni, a top performerzy mają cykl krótszy o 42% (≈53 dni, wyliczenie własne) – uzasadnienie pasma 'optymalny'. Ebsta 2023: 'złoty okres' 61–90 dni dla średnich transakcji. Okres: kwartalnie.",
          en: "Ebsta x Pavilion 2025: new clients 91 days on average, and top performers have a 42% shorter cycle (≈53 days, own calculation) – the rationale for the 'optimal' band. Ebsta 2023: a 'golden period' of 61–90 days for medium deals. Period: quarterly.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025", "ebsta_b2b_sales_2023"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 1800,
            note: {
              pl: "top performerzy Ebsta 2025: cykl krótszy o 42% od 91 dni ≈ 53 dni (wyliczenie własne)",
              en: "Ebsta 2025 top performers: a cycle 42% shorter than 91 days ≈ 53 days (own calculation)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 1800,
            max: 2184,
            note: {
              pl: "'złoty okres' 61–90 dni",
              en: "the 61–90-day 'golden period'",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 2184,
            max: 2880,
            note: {
              pl: "od średniej Ebsta 2025 dla nowych klientów (91 dni)",
              en: "from the Ebsta 2025 average for new clients (91 days)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 2880,
            max: 4320,
            basis: "E",
          },
          {
            tier: "critical",
            min: 4320,
            max: null,
            note: {
              pl: "≈2× średni cykl",
              en: "≈2× the average cycle",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "sales_cycle_length.large_deals",
        label: {
          pl: "Duże transakcje (partnerstwa strategiczne, projekty badawcze na zlecenie)",
          en: "Large deals (strategic partnerships, commissioned research projects)",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        displayUnit: "days",
        window: "year",
        direction: "lower",
        method: {
          pl: "Ebsta 2023: 'złoty okres' 150–180 dni dla dużych transakcji. Próg krytyczny to heurystyka 2× cyklu. Okres: półrocznie / rocznie.",
          en: "Ebsta 2023: a 'golden period' of 150–180 days for large deals. The critical threshold is a 2× cycle heuristic. Period: half-yearly / annually.",
        },
        sourceIds: ["ebsta_b2b_sales_2023"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 3600,
            basis: "E",
          },
          {
            tier: "good",
            min: 3600,
            max: 4320,
            note: {
              pl: "'złoty okres' 150–180 dni",
              en: "the 150–180-day 'golden period'",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 4320,
            max: 5760,
            basis: "E",
          },
          {
            tier: "weak",
            min: 5760,
            max: 8640,
            basis: "E",
          },
          {
            tier: "critical",
            min: 8640,
            max: null,
            note: {
              pl: "≈2× 'złoty okres'",
              en: "≈2× the 'golden period'",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "sales_cycle_length.expansions",
        label: {
          pl: "Rozszerzenia i odnowienia u obecnych klientów",
          en: "Expansions and renewals with existing clients",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        displayUnit: "days",
        window: "quarter",
        direction: "lower",
        method: {
          pl: "Ebsta x Pavilion 2025: rozszerzenia zamykane średnio w 52 dni (vs 91 dni dla nowych klientów). Pasma to heurystyka. Okres: kwartalnie.",
          en: "Ebsta x Pavilion 2025: expansions closed in 52 days on average (vs 91 days for new clients). The bands are a heuristic. Period: quarterly.",
        },
        sourceIds: ["ebsta_pavilion_gtm_2025"],
        bands: [
          {
            tier: "optimal",
            min: 0,
            max: 960,
            basis: "E",
          },
          {
            tier: "good",
            min: 960,
            max: 1248,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1248,
            max: 1800,
            note: {
              pl: "od średniej Ebsta (52 dni)",
              en: "from the Ebsta average (52 days)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1800,
            max: 2496,
            basis: "E",
          },
          {
            tier: "critical",
            min: 2496,
            max: null,
            note: {
              pl: "2× średni cykl rozszerzeń",
              en: "2× the average expansion cycle",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "sales_cycle_length.mid_new_logo",
      b2b_institution: "sales_cycle_length.mid_new_logo",
    },
  },
];
