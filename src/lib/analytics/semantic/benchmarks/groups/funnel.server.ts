// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/lejek.json, docs/benchmarki/2026-10-18/lejek.overlay.json
// SHA-256 treści kanonicznej wejść: 83ced85c4a540fd21481a2cabe20565d68532e2b5527a15c0df7a43cc43d741e
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „funnel” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const FUNNEL_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "visitor_to_registration_rate",
    metricId: "visitor_to_registration_rate",
    group: "funnel",
    abbr: "V2R",
    name: {
      pl: "Konwersja odwiedzający → rejestracja",
      en: "Visitor-to-registration conversion rate",
    },
    expansion: {
      pl: "V2R – Visitor-to-Registration Rate: odsetek odwiedzających, którzy zakładają bezpłatne konto (registration wall, konto freemium, rejestracja do newslettera z kontem)",
      en: "V2R – Visitor-to-Registration Rate: share of visitors who create a free account (registration wall, freemium account)",
    },
    formula: {
      pl: "Przepływ: nowe rejestracje w okresie / unikalni odwiedzający w okresie × 100%. Wariant stanu (known users): rozpoznani/zalogowani unikalni użytkownicy w miesiącu / wszyscy unikalni użytkownicy w miesiącu × 100%. Wariant regwall: rejestracje / unikalne wyświetlenia modalu rejestracji × 100%.",
      en: "Flow: new registrations in the period / unique visitors in the period × 100%. Stock variant (known users): recognised/logged-in unique users in the month / all unique users in the month × 100%. Registration-wall variant: registrations / unique views of the registration modal × 100%.",
    },
    interpretation: {
      pl: "Pokazuje, jak skutecznie zamieniamy anonimowy ruch w rozpoznanych czytelników, z którymi da się budować relację (newsletter, CRM) i którzy wg Piano kupują 30–45 razy częściej niż anonimowi. Zawsze czytaj go z mianownikiem: udział rozpoznanych wśród wszystkich użytkowników (zwykle 1–3%) to inna wielkość niż konwersja samego modalu rejestracji (kilka procent). Pułapki: rejestracje jednorazowe (zakładanie kont na różne maile dla dostępu do jednego tekstu), boty w mianowniku oraz regwall przed paywallem, który obniża ekspozycję ofert płatnych.",
      en: "Shows how well anonymous traffic is turned into known readers who can be nurtured (newsletter, CRM) and who, per Piano, buy 30–45 times more often than anonymous users. Always read it with its denominator: the known-user share of all users (typically 1–3%) is a different quantity from the conversion of the registration modal itself (a few percent). Pitfalls: throwaway registrations, bots in the denominator, and a registration wall placed before the paywall that reduces paid-offer exposure.",
    },
    levers: {
      pl: "Pokaż korzyść z konta przed prośbą o rejestrację: zapisane artykuły, alerty tematyczne, newsletter ekspercki, dostęp do zapisu wydarzenia. Testuj miejsce i moment zaproszenia (po kilku tekstach, na końcu artykułu, przy zapisie na wydarzenie) i ogranicz formularz do adresu e-mail z logowaniem społecznościowym. Mierz V2R razem z odsetkiem trafiających na paywall, żeby rejestracja nie zabierała ekspozycji ofert płatnych; odfiltruj boty i konta jednorazowe.",
      en: "Show the benefit of an account before asking people to register: saved articles, topic alerts, an expert newsletter, access to event recordings. Test the placement and timing of the prompt (after a few articles, at the end of an article, at event sign-up) and cut the form down to an e-mail address plus social login. Track V2R together with the paywall hit rate so that registration does not take exposure away from paid offers; filter out bots and throwaway accounts.",
    },
    caveats: [
      {
        text: {
          pl: "Piano (2023): wprowadzenie registration wall przed paywallem obniżyło odsetek użytkowników widzących ofertę płatną średnio o 36% – mierz V2R razem z odsetkiem trafiających na paywall.",
          en: "Piano (2023): introducing a registration wall in front of the paywall reduced the share of users who see a paid offer by 36% on average – measure V2R together with the share of users reaching the paywall.",
        },
        sourceIds: ["piano_inma_2023"],
      },
      {
        text: {
          pl: "Kontekst registration wall opiera się na jednym studium przypadku Mather (artykuł z 10.02.2022) – przedziały mają charakter heurystyczny.",
          en: "The registration-wall context rests on a single Mather case study (article of 10.02.2022) – the ranges are heuristic.",
        },
        sourceIds: ["mather_regwall"],
      },
      {
        text: {
          pl: "Benchmarki SaaS (ChartMogul, First Page Sage) dotyczą stron produktowych, nie serwisów treściowych – stosuj je do ścieżek B2B (konto instytucjonalne, trial dla firm).",
          en: "The SaaS benchmarks (ChartMogul, First Page Sage) concern product websites, not content services – apply them to B2B paths (institutional account, trial for organisations).",
        },
      },
      {
        text: {
          pl: "Brak publicznych danych dla Polski; mediany Piano i Mather pochodzą głównie z rynków USA/globalnego.",
          en: "There are no public data for Poland; the Piano and Mather medians come mainly from the US and global markets.",
        },
      },
      {
        text: {
          pl: "Konteksty SaaS (freemium, trial opt-in, trial opt-out) mają pewność niską: wartości ChartMogul 9% / 4,5% / 3,5% to przykład ilustracyjny, nie mediana, a First Page Sage opiera się na klientach agencji (próba niereprezentatywna).",
          en: "The SaaS contexts (freemium, opt-in trial, opt-out trial) have low confidence: the ChartMogul values of 9% / 4.5% / 3.5% are an illustrative example, not a median, and First Page Sage relies on agency clients (an unrepresentative sample).",
        },
        sourceIds: ["chartmogul_2026", "fps_2025"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "visitor_to_registration_rate.publisher_known_users",
        label: {
          pl: "Wydawca cyfrowy (metered/freemium) – udział rozpoznanych (zarejestrowanych/zalogowanych) wśród miesięcznych unikalnych użytkowników",
          en: "Digital publisher (metered/freemium) – share of known (registered/logged-in) users among monthly unique users",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "mediana Piano 1,2% (dane I 2022–IX 2024, globalnie) jako granica normalny/dobry – spójnie z V2P (mediana = granica normalny/dobry); mediana Mather Q2 2022 1,5% (103 rynki, głównie prasa lokalna USA) mieści się w przedziale dobrym; best-in-class Mather 3,3% (średnia rynków wzorcowych wybranych indeksem sukcesu subskrypcyjnego, nie percentyl) jako próg optymalny; progi 0,5 i 0,8 heurystyczne. Okres: miesięcznie.",
          en: "Piano median of 1.2% (data Jan 2022–Sep 2024, global) as the normal/good boundary – consistent with V2P (median = normal/good boundary); the Mather Q2 2022 median of 1.5% (103 markets, mainly US local press) falls within the good range; Mather best-in-class 3.3% (the average of benchmark markets selected by a subscription success index, not a percentile) as the optimal threshold; the 0.5 and 0.8 thresholds are heuristic. Period: monthly.",
        },
        sourceIds: ["piano_benchmarks_2024", "mather_sep_2022", "piano_nypa_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.5,
            note: {
              pl: "praktycznie brak identyfikacji czytelników – heurystyka",
              en: "practically no reader identification – heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.5,
            max: 0.8,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.8,
            max: 1.2,
            note: {
              pl: "do mediany Piano (1,2%; dane I 2022–IX 2024)",
              en: "up to the Piano median (1.2%; data Jan 2022–Sep 2024)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 1.2,
            max: 3.3,
            note: {
              pl: "od mediany Piano do best-in-class Mather; mediana Mather Q2 2022 (1,5%) mieści się w tym przedziale",
              en: "from the Piano median to Mather best-in-class; the Mather Q2 2022 median (1.5%) falls within this range",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 3.3,
            max: null,
            note: {
              pl: "best-in-class Mather (3,3%) – średnia rynków wzorcowych wybranych indeksem sukcesu subskrypcyjnego, nie percentyl",
              en: "Mather best-in-class (3.3%) – the average of benchmark markets selected by a subscription success index, not a percentile",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "visitor_to_registration_rate.registration_wall",
        label: {
          pl: "Registration wall – unikalne wyświetlenia modalu rejestracji → rejestracja",
          en: "Registration wall – unique registration-modal views → registration",
        },
        segments: ["paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w studium przypadku Mather (3,14% średnio, mały wydawca z Ameryki Płn.); brak publicznego przekrojowego benchmarku. Okres: miesięcznie / cały okres działania regwalla.",
          en: "heuristic anchored in a Mather case study (3.14% on average, a small North American publisher); no public cross-sectional benchmark. Period: monthly / the whole period the registration wall is active.",
        },
        sourceIds: ["mather_regwall", "piano_inma_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 2,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 2,
            max: 4,
            note: {
              pl: "okolice 3,14% z case study Mather",
              en: "around the 3.14% from the Mather case study",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 4,
            max: 8,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 8,
            max: null,
            note: {
              pl: "heurystyka – typowe dla ruchu bezpośredniego/z newslettera",
              en: "heuristic – typical of direct/newsletter traffic",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "visitor_to_registration_rate.b2b_freemium",
        label: {
          pl: "SaaS B2B / konto freemium (np. bezpłatne konto instytucjonalne) – odwiedzający → założenie konta freemium",
          en: "B2B SaaS / freemium account (e.g. a free institutional account) – visitor → freemium account sign-up",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka (pewność kontekstu: niska): górna granica normalnego = przykład ilustracyjny ChartMogul 2026 dla freemium (9%; nie mediana); First Page Sage 2025: odwiedzający→freemium 13,3% organic / 15,9% paid (86 firm, klienci agencji – próba niereprezentatywna) jako próg optymalny; dolne progi heurystyczne. Okres: miesięcznie.",
          en: "heuristic (context confidence: low): the upper bound of normal = ChartMogul 2026 illustrative example for freemium (9%; not a median); First Page Sage 2025: visitor→freemium 13.3% organic / 15.9% paid (86 companies, agency clients – an unrepresentative sample) as the optimal threshold; lower thresholds heuristic. Period: monthly.",
        },
        sourceIds: ["chartmogul_2026", "fps_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 2,
            max: 5,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 5,
            max: 9,
            note: {
              pl: "heurystyka; do przykładu ilustracyjnego ChartMogul dla freemium (9%, nie mediana)",
              en: "heuristic; up to the ChartMogul illustrative example for freemium (9%, not a median)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 9,
            max: 13.3,
            note: {
              pl: "do średniej First Page Sage odwiedzający→freemium (organic 13,3%)",
              en: "up to the First Page Sage visitor→freemium average (organic 13.3%)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 13.3,
            max: null,
            note: {
              pl: "co najmniej średnia First Page Sage organic (13,3%; paid 15,9%; klienci agencji)",
              en: "at least the First Page Sage organic average (13.3%; paid 15.9%; agency clients)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "visitor_to_registration_rate.b2b_trial_opt_in",
        label: {
          pl: "SaaS B2B / trial opt-in (bez karty, np. testowy dostęp instytucjonalny) – odwiedzający → rozpoczęcie triala",
          en: "B2B SaaS / opt-in trial (no card, e.g. institutional test access) – visitor → trial start",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka (pewność kontekstu: niska): dolna granica normalnego = przykład ilustracyjny ChartMogul 2026 dla triala (4,5%; nie mediana); First Page Sage 2025: odwiedzający→trial opt-in 8,5% organic / 7,1% paid (klienci agencji) jako granica dobrego; próg krytyczny <2 przeniesiony heurystycznie z dotychczasowego zestawu SaaS; brak podstawy do progu optymalnego. Okres: miesięcznie.",
          en: "heuristic (context confidence: low): the lower bound of normal = ChartMogul 2026 illustrative example for a trial (4.5%; not a median); First Page Sage 2025: visitor→opt-in trial 8.5% organic / 7.1% paid (agency clients) as the good boundary; the critical threshold <2 carried over heuristically from the previous SaaS set; no basis for an optimal threshold. Period: monthly.",
        },
        sourceIds: ["chartmogul_2026", "fps_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 2,
            max: 4.5,
            note: {
              pl: "heurystyka; poniżej przykładu ilustracyjnego ChartMogul dla triala (4,5%)",
              en: "heuristic; below the ChartMogul illustrative example for a trial (4.5%)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 4.5,
            max: 8.5,
            note: {
              pl: "od przykładu ChartMogul (4,5%) do średniej First Page Sage organic (8,5%)",
              en: "from the ChartMogul example (4.5%) to the First Page Sage organic average (8.5%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 8.5,
            max: null,
            note: {
              pl: "co najmniej średnia First Page Sage organic (8,5%; paid 7,1%; klienci agencji)",
              en: "at least the First Page Sage organic average (8.5%; paid 7.1%; agency clients)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "visitor_to_registration_rate.b2b_trial_opt_out",
        label: {
          pl: "SaaS B2B / trial opt-out (karta wymagana z góry) – odwiedzający → rozpoczęcie triala",
          en: "B2B SaaS / opt-out trial (card required upfront) – visitor → trial start",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka (pewność kontekstu: niska): First Page Sage 2025 odwiedzający→trial opt-out 2,5% organic / 2,2% paid (klienci agencji) jako dolna granica normalnego; przykład ilustracyjny ChartMogul 2026 dla triala z kartą (3,5%; nie mediana) jako granica dobrego; brak podstawy do progów krytycznego i optymalnego. Okres: miesięcznie.",
          en: "heuristic (context confidence: low): First Page Sage 2025 visitor→opt-out trial 2.5% organic / 2.2% paid (agency clients) as the lower bound of normal; ChartMogul 2026 illustrative example for a card-required trial (3.5%; not a median) as the good boundary; no basis for critical and optimal thresholds. Period: monthly.",
        },
        sourceIds: ["chartmogul_2026", "fps_2025"],
        bands: [
          {
            tier: "weak",
            min: null,
            max: 2.5,
            note: {
              pl: "poniżej średniej First Page Sage organic (2,5%); paid 2,2% – heurystyka",
              en: "below the First Page Sage organic average (2.5%); paid 2.2% – heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 2.5,
            max: 3.5,
            note: {
              pl: "od średniej First Page Sage organic (2,5%) do przykładu ChartMogul dla triala z kartą (3,5%)",
              en: "from the First Page Sage organic average (2.5%) to the ChartMogul example for a card-required trial (3.5%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 3.5,
            max: null,
            note: {
              pl: "co najmniej przykład ChartMogul dla triala z kartą (3,5%)",
              en: "at least the ChartMogul example for a card-required trial (3.5%)",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "visitor_to_registration_rate.publisher_known_users",
      b2c_individual: "visitor_to_registration_rate.publisher_known_users",
      b2c_reduced: "visitor_to_registration_rate.publisher_known_users",
      paywall: "visitor_to_registration_rate.registration_wall",
      b2b_institution: "visitor_to_registration_rate.b2b_freemium",
    },
  },
  {
    key: "registered_to_paid_rate",
    metricId: "registered_to_paid_rate",
    group: "funnel",
    abbr: "R2P",
    name: {
      pl: "Konwersja zarejestrowany → płacący",
      en: "Registered-to-paid conversion rate",
    },
    expansion: {
      pl: "R2P – Registered-to-Paid Rate: odsetek zarejestrowanych (bezpłatnych) użytkowników, którzy kupują płatny dostęp",
      en: "R2P – Registered-to-Paid Rate: share of registered (free) users who purchase paid access",
    },
    formula: {
      pl: "Kohortowo: zarejestrowani w miesiącu M, którzy kupili płatny dostęp w ciągu 12 mies. / wszyscy zarejestrowani w miesiącu M × 100%. Wariant stanu (newsletter freemium): płacący subskrybenci / wszyscy subskrybenci newslettera × 100%.",
      en: "Cohort: users registered in month M who bought paid access within 12 months / all users registered in month M × 100%. Stock variant (freemium newsletter): paying subscribers / all newsletter subscribers × 100%.",
    },
    interpretation: {
      pl: "Mierzy, czy rejestracja jest realnym pomostem do płatności, a nie tylko zbieraniem adresów. Wg Piano zarejestrowani kupują 30–45 razy częściej niż anonimowi, ale średnio tylko ok. 3% z nich kupuje w ciągu roku, a konwersja rozkłada się w czasie (ok. 21% konwersji w 1. miesiącu, ponad 40% w miesiącach 2–12). Pułapki: mieszanie wskaźnika kohortowego ze stanem, zbyt krótkie okno pomiaru oraz traktowanie mnożnika vs anonimowi jako efektu przyczynowego (zarejestrowani są z definicji bardziej zaangażowani).",
      en: "Measures whether registration is a real bridge to payment rather than mere address collection. Per Piano, registered users buy 30–45 times more often than anonymous ones, yet on average only about 3% buy within a year, and conversions are spread over time (about 21% in month 1, over 40% in months 2–12). Pitfalls: mixing cohort and stock definitions, too short a measurement window, and reading the multiplier vs anonymous users as causal (registered users are self-selected and more engaged).",
    },
    levers: {
      pl: "Zbuduj sekwencję powitalną dla nowych kont: najlepsze analizy, zaproszenie na wydarzenie, a potem jasna oferta płatna z argumentem wartości. Pokazuj ofertę w momentach intencji (limit tekstów, raport premium, zapis na zamknięte spotkanie), a nie w przypadkowych miejscach. Segmentuj po zainteresowaniach i źródle rejestracji, a konwersję śledź w oknach czasu do zakupu, bo młode kohorty zaniżają wynik.",
      en: "Build a welcome sequence for new accounts: the best analysis, an invitation to an event, then a clear paid offer with a value argument. Show the offer at moments of intent (article limit, premium report, sign-up for a closed meeting) rather than in random places. Segment by interests and registration source, and track conversion by time-to-purchase windows, because young cohorts understate the result.",
    },
    caveats: [
      {
        text: {
          pl: "Dane kohortowe Piano pochodzą z raportu 2022 – nowszej publicznej liczby R2P w okresie 12 mies. nie znaleziono; prezentacja Piano z 2025 r. (NYPA) podaje jedynie mnożnik 30× względem anonimowych (przypisany danym Piano 2024; na stronie raportu Piano 2024 go nie ma).",
          en: "Piano's cohort data come from the 2022 report – no newer public R2P figure over 12 months was found; Piano's 2025 presentation (NYPA) gives only a multiplier of 30× versus anonymous users (attributed to Piano 2024 data; it does not appear on the Piano 2024 report page).",
        },
        sourceIds: ["piano_nypa_2025"],
      },
      {
        text: {
          pl: "W teście Piano (INMA, 2023) zarejestrowani konwertowali 12,52% vs 0,07% anonimowych na tej samej ofercie – to efekt selekcji, nie dowód, że wymuszenie rejestracji podniesie sprzedaż: ścieżka przez rejestrację przegrała w 3 z 4 testów (3× „Result: NO”, 1× „YES”).",
          en: "In Piano's test (INMA, 2023) registered users converted at 12.52% versus 0.07% of anonymous users on the same offer – this is a selection effect, not proof that forcing registration will lift sales: the registration path lost in 3 of 4 tests (3× 'Result: NO', 1× 'YES').",
        },
        sourceIds: ["piano_inma_2023"],
      },
      {
        text: {
          pl: "Benchmark beehiiv dotyczy płatnych newsletterów na platformie beehiiv (głównie anglojęzycznych), a nie think tanków; liczy stan, nie kohortę.",
          en: "The beehiiv benchmark concerns paid newsletters on the beehiiv platform (mostly English-language), not think tanks; it measures a stock, not a cohort.",
        },
        sourceIds: ["beehiiv_2026"],
      },
      {
        text: {
          pl: "Do panelu: pokazuj rozkład czasu do konwersji (0–30, 31–90, 91–365 dni), bo okno pomiaru zmienia wynik.",
          en: "For the dashboard: show the distribution of time to conversion (0–30, 31–90, 91–365 days), because the measurement window changes the result.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "registered_to_paid_rate.publisher_cohort_12m",
        label: {
          pl: "Wydawca cyfrowy – kohorta zarejestrowanych, zakup w ciągu 12 miesięcy od rejestracji",
          en: "Digital publisher – cohort of registered users, purchase within 12 months of registration",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_12m",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w średniej ok. 3% (Piano 2022 via Digiday – średnia/odsetek ogólny, nie mediana; przy prawoskośnym rozkładzie 0,5–12% mediana jest prawdopodobnie niższa) i zakresie od ok. 0,5% do ponad 12% między wydawcami (komunikat Piano 2022 nie mówi wprost, że zakres dotyczy kohorty zarejestrowanych); progi pośrednie interpolowane heurystycznie; pewność kontekstu: średnia/niska. Okres: kohorta 12-miesięczna.",
          en: "heuristic anchored in an average of approx. 3% (Piano 2022 via Digiday – an average/overall rate, not a median; with a right-skewed 0.5–12% distribution the median is probably lower) and a range from approx. 0.5% to over 12% across publishers (the 2022 Piano press release does not say explicitly that the range concerns the registered-user cohort); intermediate thresholds interpolated heuristically; context confidence: medium/low. Period: 12-month cohort.",
        },
        sourceIds: ["digiday_2022", "piano_2022_pr", "piano_nypa_2025", "piano_inma_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.5,
            note: {
              pl: "poniżej dolnego krańca zakresu Piano",
              en: "below the lower end of the Piano range",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0.5,
            max: 1.5,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.5,
            max: 3,
            note: {
              pl: "do średniej Piano (ok. 3%) – średnia, nie mediana",
              en: "up to the Piano average (approx. 3%) – an average, not a median",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 8,
            note: {
              pl: "powyżej średniej Piano (ok. 3%; średnia, nie mediana)",
              en: "above the Piano average (approx. 3%; an average, not a median)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 8,
            max: null,
            note: {
              pl: "zbliżenie do najlepszych serwisów (>12%)",
              en: "approaching the best services (>12%)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "registered_to_paid_rate.newsletter_paid_share",
        label: {
          pl: "Newsletter freemium – płacący / wszyscy subskrybenci listy (stan)",
          en: "Freemium newsletter – paying / all list subscribers (stock)",
        },
        segments: ["newsletter"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "snapshot",
        direction: "higher",
        method: {
          pl: "kwartyle beehiiv 2026: mediana 0,62%, górne 25% ok. 2–5%, górne 10% w finansach/ekonomii 18,7–30,8% (Investing 18,69%, Finance 20,00%, Economy 30,80%); wzór płacący / wszyscy subskrybenci jest dorozumiany; próg krytyczny heurystyczny. Okres: stan na koniec miesiąca.",
          en: "beehiiv 2026 quartiles: median 0.62%, top 25% approx. 2–5%, top 10% in finance/economics 18.7–30.8% (Investing 18.69%, Finance 20.00%, Economy 30.80%); the formula paying / all subscribers is implied; critical threshold heuristic. Period: stock at month end.",
        },
        sourceIds: ["beehiiv_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.2,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.2,
            max: 0.62,
            note: {
              pl: "poniżej mediany beehiiv",
              en: "below the beehiiv median",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.62,
            max: 2,
            note: {
              pl: "mediana – dolna granica P75",
              en: "median – lower bound of P75",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 2,
            max: 5,
            note: {
              pl: "zakres P75 (top 25%)",
              en: "P75 range (top 25%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 5,
            max: null,
            note: {
              pl: "powyżej P75; P90 w finansach/ekonomii 18,7–30,8%",
              en: "above P75; P90 in finance/economics 18.7–30.8%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "registered_to_paid_rate.publisher_cohort_12m",
      b2c_individual: "registered_to_paid_rate.publisher_cohort_12m",
      b2c_reduced: "registered_to_paid_rate.publisher_cohort_12m",
      newsletter: "registered_to_paid_rate.newsletter_paid_share",
    },
  },
  {
    key: "visitor_to_paid_rate",
    group: "funnel",
    abbr: "V2P",
    name: {
      pl: "Konwersja odwiedzający → płacący (paid conversion rate wydawcy)",
      en: "Visitor-to-paid conversion rate (publisher paid conversion rate)",
    },
    expansion: {
      pl: "V2P – Visitor-to-Paid Rate: relacja płacących subskrybentów do zasięgu (stan; definicje wydawców się różnią) lub nowych płatnych subskrypcji do miesięcznych użytkowników (przepływ)",
      en: "V2P – Visitor-to-Paid Rate: paying subscribers relative to reach (stock; publisher definitions vary) or new paid subscriptions relative to monthly users (flow)",
    },
    formula: {
      pl: "Stan: aktywni płacący subskrybenci cyfrowi / średni miesięczny zasięg unikalnych użytkowników × 100% (definicje wydawców się różnią). Przepływ: nowe płatne subskrypcje w miesiącu / unikalni użytkownicy w miesiącu × 100% (Mather raportuje to jako konwersje na 1 mln użytkowników).",
      en: "Stock: active paying digital subscribers / average monthly reach of unique users × 100% (publishers' definitions differ). Flow: new paid subscriptions in the month / unique users in the month × 100% (Mather reports this as conversions per 1 million users).",
    },
    interpretation: {
      pl: "Główny wskaźnik efektywności modelu reader revenue: jaka część zasięgu płaci. Stan pokazuje skumulowany efekt (akwizycja minus churn), przepływ – bieżącą skuteczność sprzedaży. Pułapki: wskaźnik rośnie także wtedy, gdy spada ruch (mniejszy mianownik), definicje się różnią (unikalni vs sesje, triale i mocno przecenione subskrypcje w liczniku), a małe, celowe zasięgi niszowych marek eksperckich dają naturalnie wyższe wartości niż media masowe.",
      en: "The core efficiency metric of a reader-revenue model: what share of reach pays. The stock view shows the cumulative effect (acquisition minus churn), the flow view shows current selling effectiveness. Pitfalls: the ratio also rises when traffic falls (smaller denominator), definitions differ (uniques vs sessions, trials and deeply discounted subs in the numerator), and small targeted audiences of niche expert brands naturally yield higher values than mass media.",
    },
    levers: {
      pl: "Rozłóż wynik na składowe: zasięg paywalla (PHR), konwersję paywalla (PSCR) i konwersję zarejestrowanych - poprawiaj najsłabsze ogniwo zamiast całego lejka naraz. Zwiększaj udział czytelników powracających (newsletter, alerty, wydarzenia), bo to oni kupują. Dopasuj ofertę do polskiego rynku: lokalne metody płatności, plan roczny, oferty ulgowe dla studentów i nauczycieli.",
      en: "Break the result down into its components: paywall hit rate (PHR), paywall conversion (PSCR) and registered-user conversion – fix the weakest link rather than the whole funnel at once. Increase the share of returning readers (newsletter, alerts, events), because they are the ones who buy. Fit the offer to the Polish market: local payment methods, an annual plan, reduced offers for students and teachers.",
    },
    caveats: [
      {
        text: {
          pl: "Sufit popytu w Polsce jest niższy: wg Reuters Institute DNR 2026 za newsy online płaci 11% Polaków (−2 pp r/r, ale wg metodologii DNR zmiana o 2 pp lub mniej nie jest istotna statystycznie) wobec 17% w tzw. pay basket 20 krajów, w których paywalle są powszechne (18% w 2025).",
          en: "The demand ceiling in Poland is lower: according to the Reuters Institute DNR 2026, 11% of Poles pay for online news (−2 pp y/y, but under the DNR methodology a change of 2 pp or less is not statistically significant) versus 17% in the so-called pay basket of 20 countries where paywalls are common (18% in 2025).",
        },
        sourceIds: ["dnr_2026_poland", "risj_dnr2026_exec"],
      },
      {
        text: {
          pl: "Najnowsza publiczna mediana INMA dotyczy końca 2022 r.; nowsze dane INMA Subscription Benchmarks są dostępne tylko dla członków.",
          en: "The latest public INMA median refers to the end of 2022; newer INMA Subscription Benchmarks data are available to members only.",
        },
        sourceIds: ["pressgazette_2024"],
      },
      {
        text: {
          pl: "Nie porównuj wariantu stanu z przepływem – różnią się o rząd wielkości.",
          en: "Do not compare the stock variant with the flow variant – they differ by an order of magnitude.",
        },
      },
      {
        text: {
          pl: "Dla think tanku z małym, eksperckim zasięgiem wartość >1,4% stanu jest osiągalna; oceniaj trend razem z liczbą unikalnych użytkowników.",
          en: "For a think tank with a small, expert reach a stock value above 1.4% is achievable; assess the trend together with the number of unique users.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "visitor_to_paid_rate.publisher_stock",
        label: {
          pl: "Wydawca cyfrowy – stan: płacący subskrybenci cyfrowi / średni miesięczny zasięg (definicje wydawców się różnią)",
          en: "Digital publisher – stock: paying digital subscribers / average monthly reach (publishers' definitions differ)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "snapshot",
        direction: "higher",
        method: {
          pl: "mediana 0,6% i górny kwartyl ≥1,4% (INMA, 166 wydawców, koniec 2022 r. – najnowsze publicznie dostępne; via Press Gazette 2024, artykuł nie podaje definicji INMA): P50–P75 = dobry, >P75 = optymalny; progi poniżej mediany heurystyczne. Okres: stan miesięczny.",
          en: "median 0.6% and upper quartile ≥1.4% (INMA, 166 publishers, end of 2022 – the latest publicly available; via Press Gazette 2024, the article does not give the INMA definition): P50–P75 = good, >P75 = optimal; thresholds below the median heuristic. Period: monthly stock.",
        },
        sourceIds: ["pressgazette_2024", "risj_dnr2026_exec", "dnr_2026_poland"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.2,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.2,
            max: 0.4,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.4,
            max: 0.6,
            note: {
              pl: "do mediany INMA",
              en: "up to the INMA median",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 0.6,
            max: 1.4,
            note: {
              pl: "mediana – górny kwartyl INMA",
              en: "median – INMA upper quartile",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 1.4,
            max: null,
            note: {
              pl: "górny kwartyl INMA; liderzy specjalistyczni w rankingu Press Gazette (subskrybenci / średnia miesięczna liczba odwiedzających wg Similarweb – inna definicja): The Athletic ok. 26%, Barron's ok. 19%",
              en: "INMA upper quartile; specialist leaders in the Press Gazette ranking (subscribers / average monthly visitors according to Similarweb – a different definition): The Athletic approx. 26%, Barron's approx. 19%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "visitor_to_paid_rate.publisher_flow",
        label: {
          pl: "Wydawca cyfrowy – przepływ: nowe płatne subskrypcje w miesiącu / miesięczni unikalni użytkownicy",
          en: "Digital publisher – flow: new paid subscriptions in the month / monthly unique users",
        },
        segments: ["b2c_individual", "b2c_reduced", "paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Mather Q2 2022: mediana 513 konwersji na 1 mln użytkowników (0,051%), best-in-class 1263 (0,126%; średnia rynków wzorcowych, nie percentyl; próba głównie prasa lokalna USA); iloczyn ekspozycji i konwersji Piano XII 2024 (16,3% × 0,20% ≈ 0,033%) jako kotwica przedziału normalnego (wyliczenie własne). Okres: miesięcznie.",
          en: "Mather Q2 2022: median 513 conversions per 1 million users (0.051%), best-in-class 1263 (0.126%; the average of benchmark markets, not a percentile; sample mainly US local press); the product of Piano Dec 2024 exposure and conversion (16.3% × 0.20% ≈ 0.033%) as the anchor of the normal range (own calculation). Period: monthly.",
        },
        sourceIds: ["mather_sep_2022", "piano_nypa_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.01,
            note: {
              pl: "poniżej 100 konwersji na 1 mln użytkowników – heurystyka",
              en: "below 100 conversions per 1 million users – heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.01,
            max: 0.03,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.03,
            max: 0.051,
            note: {
              pl: "od poziomu wynikającego z danych Piano do mediany Mather",
              en: "from the level implied by Piano data to the Mather median",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0.051,
            max: 0.126,
            note: {
              pl: "mediana – best-in-class Mather",
              en: "median – Mather best-in-class",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 0.126,
            max: null,
            note: {
              pl: "best-in-class Mather (1263 / mln; średnia rynków wzorcowych, nie percentyl)",
              en: "Mather best-in-class (1263 / million; the average of benchmark markets, not a percentile)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "visitor_to_paid_rate.publisher_stock",
      b2c_individual: "visitor_to_paid_rate.publisher_stock",
      b2c_reduced: "visitor_to_paid_rate.publisher_stock",
      paywall: "visitor_to_paid_rate.publisher_flow",
    },
    noMetricReason: {
      pl: "Licznik (płacący, strumień rozliczeń) i mianownik (unikalni odwiedzający, strumień first-party za zgodą analityczną) pochodzą z dwóch strumieni o różnych populacjach - iloraz byłby nieporównywalny. Czytaj V2P jako złożenie PHR × PSCR albo osobno V2R i R2P.",
      en: "The numerator (paying customers, billing stream) and the denominator (unique visitors, first-party stream behind analytics consent) come from two streams with different populations, so the ratio would be incomparable. Read V2P as PHR × PSCR, or V2R and R2P separately.",
    },
  },
  {
    key: "paywall_conversion_rate",
    metricId: "paywall_conversion_rate",
    group: "funnel",
    abbr: "PSCR",
    name: {
      pl: "Konwersja paywalla (trafienie na paywall → subskrypcja)",
      en: "Paywall conversion rate (paywall stop to subscription)",
    },
    expansion: {
      pl: "PSCR – Paywall Stop Conversion Rate: odsetek użytkowników zatrzymanych przez paywall lub ofertę płatną, którzy kupują subskrypcję (u Piano: paid conversion rate)",
      en: "PSCR – Paywall Stop Conversion Rate: share of users stopped by the paywall or a paid offer who buy a subscription (Piano: paid conversion rate)",
    },
    formula: {
      pl: "unikalni użytkownicy, którzy kupili subskrypcję po zobaczeniu paywalla/oferty płatnej / unikalni użytkownicy, którzy zobaczyli ≥1 paywall lub ofertę płatną × 100% (miesięcznie)",
      en: "unique users who bought a subscription after seeing the paywall/paid offer / unique users who saw ≥1 paywall or paid offer × 100% (monthly)",
    },
    interpretation: {
      pl: "Efektywność samego momentu sprzedaży: typowo ok. 0,2%, czyli ok. 2 zakupy na 1000 zatrzymanych; w badaniu Notre Dame/Georgia Tech 59,2% czytelników po trafieniu na paywall od razu opuszczało serwis. Wskaźnik spada mechanicznie, gdy zaostrzamy paywall (zatrzymujemy też mniej zaangażowanych), choć łączna sprzedaż może rosnąć – oceniaj go zawsze razem z odsetkiem trafiających na paywall i konwersją na 1 mln użytkowników. Nie mieszaj konwersji na unikalnego użytkownika z konwersją na wyświetlenie.",
      en: "Effectiveness of the selling moment itself: typically about 0.2%, i.e. roughly 2 purchases per 1,000 users stopped; in the Notre Dame/Georgia Tech study 59.2% of readers left the site immediately after hitting the paywall. The rate falls mechanically when the paywall is tightened (less engaged users get stopped too) even if total sales grow, so always read it together with paywall hit rate and conversions per million users. Do not mix per-user and per-impression conversion.",
    },
    levers: {
      pl: "Testuj szablon i treść oferty na paywallu: konkretna korzyść (analizy, raporty, wydarzenia), cena miesięczna obok rocznej i wyraźny przycisk zakupu. Skróć drogę od paywalla do płatności: zapamiętane dane, BLIK i szybkie przelewy, bez wymogu hasła. Dopasuj ofertę do źródła ruchu i tematu artykułu, a zmiany szczelności paywalla oceniaj razem z PHR, bo niższa konwersja przy większej ekspozycji może dać więcej subskrypcji.",
      en: "Test the paywall offer template and copy: a concrete benefit (analysis, reports, events), the monthly price next to the annual one and a clear purchase button. Shorten the path from paywall to payment: saved details, BLIK and fast bank transfers, no password requirement. Match the offer to the traffic source and article topic, and judge changes in paywall tightness together with PHR, because lower conversion at higher exposure can yield more subscriptions.",
    },
    caveats: [
      {
        text: {
          pl: "Piano (dane II 2025), mediana konwersji wg szablonu oferty: landing page 2,73%, hard paywall 0,11%, soft paywall 0,011%, ribbon (pasek) 0,005% – inne szablony wymagają osobnych progów.",
          en: "Piano (data Feb 2025), median conversion by offer template: landing page 2.73%, hard paywall 0.11%, soft paywall 0.011%, ribbon (banner) 0.005% – other templates need separate thresholds.",
        },
        sourceIds: ["piano_nypa_2025"],
      },
      {
        text: {
          pl: "Europa konwertuje słabiej niż USA (Piano XII 2024: 0,15% vs 0,34%) – dla polskiego wydawcy realistyczny punkt odniesienia to mediana europejska.",
          en: "Europe converts less well than the USA (Piano Dec 2024: 0.15% vs 0.34%) – for a Polish publisher the realistic reference point is the European median.",
        },
      },
      {
        text: {
          pl: "Mather (24.06.2024, 118 serwisów po zmianie paywalla w III 2023): zaostrzenie paywalla podwoiło liczbę prób sprzedaży (+100%) przy spadku konwersji o 20%, co netto dało więcej subskrypcji.",
          en: "Mather (24.06.2024, 118 sites after a paywall change in Mar 2023): tightening the paywall doubled the number of sales attempts (+100%) while conversion fell by 20%, which netted more subscriptions.",
        },
        sourceIds: ["mather_intercept_2024"],
      },
      {
        text: {
          pl: "Badanie Notre Dame/Georgia Tech: ok. 1 na 10 zatrzymanych skutecznie obchodzi paywall, z czego 81% przez nową tożsamość przeglądarki (81% to udział wśród skutecznych obejść, nie wśród wszystkich zatrzymań) – szczelność paywalla wpływa na mianownik.",
          en: "Notre Dame/Georgia Tech study: about 1 in 10 stopped users successfully circumvents the paywall, 81% of them through a new browser identity (81% is the share among successful circumventions, not among all stops) – paywall tightness affects the denominator.",
        },
        sourceIds: ["notre_dame_2026"],
      },
      {
        text: {
          pl: "Trend Piano: mediana konwersji paywalla spadła z 0,44% (początek 2021) do ok. 0,11–0,12% (I 2023), a w XII 2024 wynosiła 0,20% – porównuj wynik z medianą z tego samego okresu.",
          en: "Piano trend: the median paywall conversion fell from 0.44% (early 2021) to approx. 0.11–0.12% (Jan 2023) and stood at 0.20% in Dec 2024 – compare the result with the median from the same period.",
        },
      },
    ],
    direction: "higher",
    confidence: "high",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "paywall_conversion_rate.metered_freemium",
        label: {
          pl: "Paywall metered/freemium/hybrydowy wydawcy cyfrowego – unikalni zatrzymani → zakup",
          en: "Metered/freemium/hybrid paywall of a digital publisher – unique stopped users → purchase",
        },
        segments: ["paywall", "b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "mediany: Piano XII 2024 0,20% globalnie (Europa 0,15%, USA 0,34%), Mather Q2 2022 0,22%, best-in-class Mather 0,58% (średnia rynków wzorcowych, nie percentyl); trend: mediana Piano spadła w I 2023 do ok. 0,11–0,12% (z 0,44% na początku 2021) i odbiła do 0,20% w XII 2024; potwierdzenie: Notre Dame/Georgia Tech 2026 (~0,2% zatrzymań kończy się zakupem); próg krytyczny heurystyczny. Okres: miesięcznie.",
          en: "medians: Piano Dec 2024 0.20% globally (Europe 0.15%, USA 0.34%), Mather Q2 2022 0.22%, Mather best-in-class 0.58% (the average of benchmark markets, not a percentile); trend: the Piano median fell in Jan 2023 to approx. 0.11–0.12% (from 0.44% in early 2021) and rebounded to 0.20% in Dec 2024; confirmation: Notre Dame/Georgia Tech 2026 (~0.2% of stops end in a purchase); critical threshold heuristic. Period: monthly.",
        },
        sourceIds: ["piano_nypa_2025", "mather_sep_2022", "notre_dame_2026", "piano_inma_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.05,
            note: {
              pl: "heurystyka; najniższa wartość (Bottom) w rozkładzie Piano, I 2023: 0,02%",
              en: "heuristic; the lowest value (Bottom) in the Piano distribution, Jan 2023: 0.02%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.05,
            max: 0.15,
            note: {
              pl: "poniżej mediany europejskiej Piano",
              en: "below the Piano European median",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.15,
            max: 0.22,
            note: {
              pl: "mediana Europa – mediana Mather/Piano global",
              en: "European median – Mather/Piano global median",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0.22,
            max: 0.58,
            note: {
              pl: "powyżej mediany do best-in-class Mather",
              en: "above the median up to Mather best-in-class",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 0.58,
            max: null,
            note: {
              pl: "best-in-class Mather (0,58%); najwyższa wartość (Top) w rozkładzie Piano, I 2023: 3,95%",
              en: "Mather best-in-class (0.58%); the highest value (Top) in the Piano distribution, Jan 2023: 3.95%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "paywall_conversion_rate.metered_freemium",
      paywall: "paywall_conversion_rate.metered_freemium",
      b2c_individual: "paywall_conversion_rate.metered_freemium",
      b2c_reduced: "paywall_conversion_rate.metered_freemium",
    },
  },
  {
    key: "trial_to_paid_rate",
    metricId: "trial_to_paid_rate",
    group: "funnel",
    abbr: "T2P",
    name: {
      pl: "Konwersja okresu próbnego na płatny (trial → paid)",
      en: "Trial-to-paid conversion rate",
    },
    expansion: {
      pl: "T2P – Trial-to-Paid Rate: odsetek użytkowników okresu próbnego, którzy przechodzą na płatny plan; opt-in = trial bez karty, opt-out = karta wymagana z góry i automatyczne obciążenie po trialu",
      en: "T2P – Trial-to-Paid Rate: share of trial users who convert to a paid plan; opt-in = no card required, opt-out = card required upfront with automatic charge after the trial",
    },
    formula: {
      pl: "użytkownicy, którzy po zakończeniu trialu dokonali pierwszej płatności / użytkownicy, którzy rozpoczęli trial w kohorcie × 100% (osobno dla opt-in i opt-out)",
      en: "users who made a first payment after the trial ended / users who started a trial in the cohort × 100% (separately for opt-in and opt-out)",
    },
    interpretation: {
      pl: "Pokazuje, czy trial przekonuje do zapłaty. Trial z kartą konwertuje kilkukrotnie lepiej (ChartMogul 2026: ponad 5×), ale zbiera mniej rejestracji, więc porównuj też liczbę płacących na 1000 odwiedzających. Pułapki: opt-out liczy często jako konwersję już jedną płatność (zestawiaj z churnem 2.–3. miesiąca), a mieszanie kohort opt-in/opt-out w jednym wskaźniku daje bezużyteczną średnią.",
      en: "Shows whether the trial persuades users to pay. Card-required trials convert several times better (ChartMogul 2026: over 5x) but attract fewer sign-ups, so also compare paying customers per 1,000 visitors. Pitfalls: opt-out conversion often counts a single payment (pair it with month 2–3 churn), and blending opt-in and opt-out cohorts yields a meaningless average.",
    },
    levers: {
      pl: "Prowadź użytkownika triala do pierwszej wartości w pierwszych dniach: sekwencja e-maili z najlepszymi analizami, zaproszenie na wydarzenie, przypomnienie o raportach w pakiecie. Przed końcem triala wyślij jasne przypomnienie o odnowieniu z ceną i łatwą rezygnacją. Mierz osobno opt-in i opt-out, a dla dostępu instytucjonalnego wyznacz opiekuna, który zbiera opinie i przygotowuje ofertę.",
      en: "Guide the trial user to first value in the first days: an e-mail sequence with the best analysis, an event invitation, a reminder of the reports included in the package. Before the trial ends, send a clear renewal reminder with the price and an easy way to cancel. Measure opt-in and opt-out separately, and for institutional access assign an account manager who gathers feedback and prepares the offer.",
    },
    caveats: [
      {
        text: {
          pl: "W mediach triale to wyjątek: wg Piano (prezentacja z 2025 r.) darmowy trial oferuje tylko 8% klientów-wydawców, a subskrypcje bez triala mają lepszą retencję niż płatne triale.",
          en: "In media, trials are the exception: according to Piano (2025 presentation) only 8% of publisher clients offer a free trial, and subscriptions without a trial retain better than paid trials.",
        },
        sourceIds: ["piano_nypa_2025"],
      },
      {
        text: {
          pl: "First Page Sage liczy konwersję opt-out już po jednym płatnym miesiącu – wynik zawyżony względem trwałej konwersji.",
          en: "First Page Sage counts opt-out conversion after just one paid month – the result is inflated relative to lasting conversion.",
        },
        sourceIds: ["fps_2025"],
      },
      {
        text: {
          pl: "Europa Zachodnia (RevenueCat, aplikacje, dane za 2025): mediana trial→paid 29,7%, niżej niż Ameryka Płn. (34,2%); triale 17–32 dni: 42,5% vs ≤4 dni: 25,5%.",
          en: "Western Europe (RevenueCat, apps, 2025 data): median trial→paid 29.7%, lower than North America (34.2%); 17–32-day trials: 42.5% vs ≤4 days: 25.5%.",
        },
        sourceIds: ["revenuecat_2026"],
      },
      {
        text: {
          pl: "Karta z góry zmniejsza rejestracje (przykład ilustracyjny ChartMogul, nie mediana: 3,5% vs 4,5% odwiedzających), ale daje 10,5 vs 3,6 płacących na 1000 odwiedzających.",
          en: "Requiring a card upfront reduces sign-ups (ChartMogul illustrative example, not a median: 3.5% vs 4.5% of visitors) but yields 10.5 vs 3.6 paying customers per 1000 visitors.",
        },
        sourceIds: ["chartmogul_2026"],
      },
    ],
    direction: "higher",
    confidence: "high",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "trial_to_paid_rate.opt_in",
        label: {
          pl: "Trial opt-in (bez karty) – SaaS/B2B, w tym dostęp instytucjonalny",
          en: "Opt-in trial (no card) – SaaS/B2B, including institutional access",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_12m",
        direction: "higher",
        method: {
          pl: "ChartMogul 2026 (200 produktów, w tym 22% głównie B2C/hybrydowych; I 2026, okno 6 mies.): trial bez karty good = P50 4–6%, great = P75 10–15%; 20% produktów z trialem <2,5%; mediana 8% dotyczy wszystkich modeli łącznie z trialami z kartą i nie jest kotwicą dla opt-in; First Page Sage 2025 (18,2% organic / 17,4% paid; klienci agencji) tylko jako górna kotwica. Okres: kohorta trialu (pomiar do 6 mies. od rejestracji).",
          en: "ChartMogul 2026 (200 products, 22% of them mainly B2C/hybrid; Jan 2026, 6-month window): no-card trial good = P50 4–6%, great = P75 10–15%; 20% of trial products are below 2.5%; the 8% median covers all models including card-required trials and is not an anchor for opt-in; First Page Sage 2025 (18.2% organic / 17.4% paid; agency clients) only as an upper anchor. Period: trial cohort (measured up to 6 months from sign-up).",
        },
        sourceIds: ["chartmogul_2026", "fps_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2.5,
            note: {
              pl: "dolne 20% produktów z trialem (<2,5%, ChartMogul)",
              en: "bottom 20% of trial products (<2.5%, ChartMogul)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 2.5,
            max: 4,
            note: {
              pl: "poniżej przedziału P50 ChartMogul (good 4–6%)",
              en: "below the ChartMogul P50 range (good 4–6%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 4,
            max: 6,
            note: {
              pl: "przedział P50 ChartMogul (good 4–6%)",
              en: "ChartMogul P50 range (good 4–6%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 6,
            max: 12,
            note: {
              pl: "od P50 do P75 ChartMogul (great 10–15%)",
              en: "from ChartMogul P50 to P75 (great 10–15%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 12,
            max: null,
            note: {
              pl: "środek przedziału P75 ChartMogul (10–15%) i wyżej; First Page Sage 18,2% jako górna kotwica (klienci agencji)",
              en: "middle of the ChartMogul P75 range (10–15%) and above; First Page Sage 18.2% as the upper anchor (agency clients)",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "trial_to_paid_rate.opt_out",
        label: {
          pl: "Trial opt-out (karta wymagana z góry)",
          en: "Opt-out trial (card required upfront)",
        },
        segments: ["b2c_individual", "b2c_reduced", "b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "ChartMogul 2026: good = P50 (25–35%, mediana 30%), great = P75 (50–60%); First Page Sage 2025: 48,8% organic / 51% paid (klienci agencji; konwersja liczona po jednym płatnym miesiącu); RevenueCat (aplikacje, dane za 2025, data publikacji niepotwierdzona): 25,5–42,5% wg długości trialu. Okres: kohorta trialu.",
          en: "ChartMogul 2026: good = P50 (25–35%, median 30%), great = P75 (50–60%); First Page Sage 2025: 48.8% organic / 51% paid (agency clients; conversion counted after one paid month); RevenueCat (apps, 2025 data, publication date unconfirmed): 25.5–42.5% by trial length. Period: trial cohort.",
        },
        sourceIds: ["chartmogul_2026", "fps_2025", "revenuecat_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 15,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 15,
            max: 25,
            note: {
              pl: "poniżej progu good",
              en: "below the good threshold",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 25,
            max: 35,
            note: {
              pl: "good = P50 ChartMogul (25–35%); mediana 30%",
              en: "good = ChartMogul P50 (25–35%); median 30%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 35,
            max: 50,
            note: {
              pl: "do poziomu First Page Sage",
              en: "up to the First Page Sage level",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 50,
            max: null,
            note: {
              pl: "great = P75 ChartMogul (50–60%)",
              en: "great = ChartMogul P75 (50–60%)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "trial_to_paid_rate.opt_out",
      b2c_individual: "trial_to_paid_rate.opt_out",
      b2c_reduced: "trial_to_paid_rate.opt_out",
      b2b_institution: "trial_to_paid_rate.opt_out",
    },
  },
  {
    key: "checkout_abandonment_rate",
    metricId: "checkout_abandonment_rate",
    group: "funnel",
    abbr: "CAR",
    name: {
      pl: "Wskaźnik porzucenia checkoutu / koszyka",
      en: "Checkout / cart abandonment rate",
    },
    expansion: {
      pl: "CAR – Checkout (Cart) Abandonment Rate: odsetek rozpoczętych procesów zakupu (checkout lub koszyk), które nie kończą się płatnością",
      en: "CAR – Checkout (Cart) Abandonment Rate: share of started purchase flows (checkout or cart) that do not end in payment",
    },
    formula: {
      pl: "Checkout subskrypcji: (1 − zakończone płatności / rozpoczęte checkouty) × 100%. E-commerce/bilety (Baymard): (1 − złożone zamówienia / utworzone koszyki) × 100%.",
      en: "Subscription checkout: (1 − completed payments / started checkouts) × 100%. E-commerce/tickets (Baymard): (1 − orders placed / carts created) × 100%.",
    },
    interpretation: {
      pl: "Pokazuje, ile osób z gotową intencją zakupu gubimy w formularzu i płatności – to zwykle najtańsza do odzyskania strata w lejku. Wynik zależy krytycznie od definicji startu (klik Subskrybuj, wejście na stronę płatności, dodanie do koszyka), więc w panelu trzymaj jedną definicję. Pułapki: płatności odroczone (przelew, faktura pro forma w B2B) liczone jako porzucenia oraz wymuszanie zakładania konta/hasła w trakcie płatności.",
      en: "Shows how many people with clear purchase intent are lost in the form and payment step – usually the cheapest funnel leak to fix. The value depends heavily on how a start is defined (Subscribe click, payment page view, add-to-cart), so keep one definition in the dashboard. Pitfalls: deferred payments (bank transfer, B2B pro-forma invoice) counted as abandonments, and forcing account/password creation mid-checkout.",
    },
    levers: {
      pl: "Usuń przeszkody wskazane w danych Baymard: wymóg zakładania konta i hasła, długi formularz, ukryte koszty, brak zaufania przy podawaniu karty. Dodaj lokalne metody płatności (BLIK, szybkie przelewy) i pokaż pełną cenę z VAT przed płatnością. Popraw ścieżkę mobilną osobno od desktopowej i wyślij przypomnienie o porzuconym checkoucie, jeśli osoba zgodziła się na kontakt.",
      en: "Remove the obstacles named in the Baymard data: mandatory account creation and passwords, a long form, hidden costs, lack of trust when entering card details. Add local payment methods (BLIK, fast bank transfers) and show the full price including VAT before payment. Improve the mobile path separately from desktop and send an abandoned-checkout reminder when the person has consented to contact.",
    },
    caveats: [
      {
        text: {
          pl: "Dane INMA (ok. 2024: 18%, Q2 2026: 38% ukończeń) pochodzą z fragmentów artykułów dostępnych w wyszukiwarce; strona INMA zwraca HTTP 403 (Cloudflare), więc liczby są niezweryfikowane – potwierdź je w przeglądarce przy aktualizacji progów.",
          en: "The INMA data (approx. 2024: 18%, Q2 2026: 38% completions) come from article snippets available in search results; the INMA page returns HTTP 403 (Cloudflare), so the figures are unverified – confirm them in a browser when updating the thresholds.",
        },
        sourceIds: ["inma_checkout_2026", "inma_7reasons"],
      },
      {
        text: {
          pl: "Baymard: 18% porzuca z powodu wymogu założenia konta, 17% przez zbyt długi/skomplikowany proces, 19% przez brak zaufania do podania karty, 40% przez dodatkowe koszty; naprawa użyteczności checkoutu może podnieść konwersję o 35,26%.",
          en: "Baymard: 18% abandon because they are required to create an account, 17% because the process is too long/complicated, 19% because they do not trust the site with their card details, 40% because of extra costs; fixing checkout usability can raise conversion by 35.26%.",
        },
        sourceIds: ["baymard_2025"],
      },
      {
        text: {
          pl: "INMA (niezweryfikowane, HTTP 403): w amerykańskim badaniu z 2019 r. 85% użytkowników rezygnowało, gdy checkout prosił o hasło.",
          en: "INMA (unverified, HTTP 403): in a 2019 US study, 85% of users gave up when the checkout asked for a password.",
        },
      },
      {
        text: {
          pl: "Mobile porzuca znacznie częściej: Piano 2022 – 19,7% ukończeń na mobile vs 42,4% na desktopie.",
          en: "Mobile abandons much more often: Piano 2022 – 19.7% completions on mobile vs 42.4% on desktop.",
        },
        sourceIds: ["piano_2022_pr"],
      },
      {
        text: {
          pl: "Brak benchmarków dla polskich metod płatności (BLIK, szybkie przelewy) – heurystyka: brak lokalnych metod podnosi porzucenia.",
          en: "There are no benchmarks for Polish payment methods (BLIK, fast transfers) – heuristic: the absence of local methods increases abandonment.",
        },
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "checkout_abandonment_rate.subscription",
        label: {
          pl: "Checkout subskrypcji cyfrowej (start checkoutu → brak płatności)",
          en: "Digital subscription checkout (checkout start → no payment)",
        },
        segments: ["b2c_individual", "b2c_reduced", "b2b_institution", "paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "heurystyka do weryfikacji (pewność kontekstu: niska): odwrotność mediany INMA Q2 2026 (38% ukończeń → 62% porzuceń; 149 marek) i mediany INMA ok. 2024 (18% ukończeń → 82%) – obie niezweryfikowane (strona INMA zwraca HTTP 403, Cloudflare); jedyna zweryfikowana kotwica: Piano 2022 – 42,4% ukończeń na desktopie (57,6% porzuceń) i 19,7% na mobile (80,3% porzuceń); skrajne progi heurystyczne. Okres: miesięcznie.",
          en: "heuristic to be verified (context confidence: low): the inverse of the INMA Q2 2026 median (38% completions → 62% abandonment; 149 brands) and of the INMA approx. 2024 median (18% completions → 82%) – both unverified (the INMA page returns HTTP 403, Cloudflare); the only verified anchor: Piano 2022 – 42.4% completions on desktop (57.6% abandonment) and 19.7% on mobile (80.3% abandonment); extreme thresholds heuristic. Period: monthly.",
        },
        sourceIds: ["inma_checkout_2026", "inma_7reasons", "piano_2022_pr"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 45,
            note: {
              pl: "heurystyka – poziom dobrych checkoutów e-commerce",
              en: "heuristic – the level of good e-commerce checkouts",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 45,
            max: 62,
            note: {
              pl: "lepiej niż mediana INMA 2026 (62%, niezweryfikowana); desktop Piano 2022: 57,6%",
              en: "better than the INMA 2026 median (62%, unverified); Piano 2022 desktop: 57.6%",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 62,
            max: 75,
            note: {
              pl: "okolice mediany INMA 2026 (62%, niezweryfikowana)",
              en: "around the INMA 2026 median (62%, unverified)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 75,
            max: 85,
            note: {
              pl: "poziom mediany INMA sprzed ok. 2 lat (82%, niezweryfikowana); mobile Piano 2022: 80,3%",
              en: "the level of the INMA median from approx. 2 years earlier (82%, unverified); Piano 2022 mobile: 80.3%",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 85,
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
        id: "checkout_abandonment_rate.ecommerce",
        label: {
          pl: "E-commerce / sprzedaż biletów i publikacji – porzucenie koszyka (definicja Baymard)",
          en: "E-commerce / sale of tickets and publications – cart abandonment (Baymard definition)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "lower",
        method: {
          pl: "średnia 70,22% z 50 badań, Baymard (aktualizacja 22.09.2025); zakres 55,00% (Forrester 2010) – 84,27% (SaleCycle 2020) to rozrzut średnich z różnych badań (część sprzed ponad 10 lat), a nie percentyle sklepów; progi wokół średniej i skrajnych wartości badań. Okres: miesięcznie.",
          en: "average of 70.22% from 50 studies, Baymard (updated 22.09.2025); the 55.00% (Forrester 2010) – 84.27% (SaleCycle 2020) range is the spread of averages from different studies (some more than 10 years old), not store percentiles; thresholds around the average and the extreme study values. Period: monthly.",
        },
        sourceIds: ["baymard_2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 55,
            note: {
              pl: "poniżej najniższej średniej w zestawieniu Baymard (55,00%)",
              en: "below the lowest average in the Baymard compilation (55.00%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 55,
            max: 65,
            note: {
              pl: "lepiej niż średnia",
              en: "better than the average",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 65,
            max: 75,
            note: {
              pl: "okolice średniej 70,22%",
              en: "around the 70.22% average",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 75,
            max: 84.27,
            note: {
              pl: "do najwyższej średniej w zestawieniu (84,27%)",
              en: "up to the highest average in the compilation (84.27%)",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 84.27,
            max: null,
            note: {
              pl: "powyżej najwyższej średniej w zestawieniu (84,27%)",
              en: "above the highest average in the compilation (84.27%)",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "checkout_abandonment_rate.subscription",
      b2c_individual: "checkout_abandonment_rate.subscription",
      b2c_reduced: "checkout_abandonment_rate.subscription",
      b2b_institution: "checkout_abandonment_rate.subscription",
      paywall: "checkout_abandonment_rate.subscription",
      events: "checkout_abandonment_rate.ecommerce",
    },
  },
  {
    key: "checkout_conversion_rate",
    metricId: "checkout_conversion_rate",
    group: "funnel",
    abbr: "CCR",
    name: {
      pl: "Konwersja checkoutu",
      en: "Checkout conversion rate",
    },
    expansion: {
      pl: "CCR – Checkout Conversion Rate (u INMA: check-out flow efficiency): odsetek rozpoczętych checkoutów zakończonych płatnością",
      en: "CCR – Checkout Conversion Rate (INMA: check-out flow efficiency): share of started checkouts that end in a completed payment",
    },
    formula: {
      pl: "zakończone płatności / rozpoczęte checkouty (np. klik Subskrybuj na paywallu lub wejście na stronę płatności) × 100%",
      en: "completed payments / started checkouts (e.g. a click on Subscribe on the paywall or entry to the payment page) × 100%",
    },
    interpretation: {
      pl: "Mierzy sprawność ostatniego kroku lejka: formularza, logowania i bramki płatniczej. Wg INMA (dane niezweryfikowane – strona zwraca HTTP 403) mediana dla serwisów informacyjnych wzrosła z 18% do 38% w dwa lata, a zweryfikowane dane Piano 2022 to 42,4% ukończeń na desktopie i 19,7% na mobile, więc wynik poniżej 25% oznacza wyraźne tarcie (np. wymuszone konto, brak płatności mobilnych). Pułapki: liczenie startu od wyświetlenia strony oferty (zaniża wynik) albo od wpisania karty (zawyża) oraz brak podziału na urządzenia.",
      en: "Measures the efficiency of the last funnel step: form, login and payment gateway. Per INMA (unverified – the site returns HTTP 403) the median for news sites rose from 18% to 38% in two years, while verified Piano 2022 data show 42.4% completion on desktop and 19.7% on mobile, so a value under 25% signals clear friction (forced account, no mobile wallets). Pitfalls: counting the start from an offer page view (understates) or from card entry (overstates), and not splitting by device.",
    },
    levers: {
      pl: "Skróć checkout do niezbędnych pól i pozwól kupić bez zakładania hasła, z logowaniem przez e-mail. Udostępnij BLIK, szybkie przelewy i portfele, a instytucjom fakturę z odroczonym terminem. Pokaż na stronie płatności podsumowanie korzyści i warunki rezygnacji, a błędy płatności tłumacz zrozumiale z możliwością ponowienia. Raportuj wynik osobno dla mobile i desktopu oraz dla B2C i B2B.",
      en: "Cut the checkout down to the essential fields and allow purchase without creating a password, with e-mail sign-in. Offer BLIK, fast bank transfers and wallets, and give institutions an invoice with deferred payment terms. Show a summary of benefits and the cancellation terms on the payment page, and explain payment errors clearly with an option to retry. Report the result separately for mobile and desktop, and for B2C and B2B.",
    },
    caveats: [
      {
        text: {
          pl: "Cartylabs to źródło dostawcy bez okresu, próby i metody percentyli („aggregated 2026 medians”); wartości podane jako przedziały – pewność niska.",
          en: "Cartylabs is a vendor source with no period, sample or percentile method ('aggregated 2026 medians'); values are given as ranges – low confidence.",
        },
        sourceIds: ["cartylabs_2026"],
      },
      {
        text: {
          pl: "Dane INMA (Q2 2026: 38%; ok. 2024: 18%) pochodzą z fragmentów artykułów; strona INMA zwraca HTTP 403 (Cloudflare) – liczby niezweryfikowane, potwierdź je w przeglądarce przy aktualizacji.",
          en: "The INMA data (Q2 2026: 38%; approx. 2024: 18%) come from article snippets; the INMA page returns HTTP 403 (Cloudflare) – the figures are unverified, confirm them in a browser when updating.",
        },
        sourceIds: ["inma_checkout_2026", "inma_7reasons"],
      },
      {
        text: {
          pl: "INMA 2026 (niezweryfikowane, HTTP 403): na odcinku zatrzymanie przez paywall → zakup najlepsze 10% marek konwertuje 5× większy odsetek zatrzymanych niż najsłabsze 10%.",
          en: "INMA 2026 (unverified, HTTP 403): at the paywall stop → purchase stage, the best 10% of brands convert a 5× larger share of stopped users than the weakest 10%.",
        },
      },
      {
        text: {
          pl: "Raportuj osobno desktop/mobile oraz B2C/B2B (faktura, przelew odroczony).",
          en: "Report desktop/mobile and B2C/B2B (invoice, deferred transfer) separately.",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "checkout_conversion_rate.subscription",
        label: {
          pl: "Checkout subskrypcji cyfrowej (start checkoutu → płatność)",
          en: "Digital subscription checkout (checkout start → payment)",
        },
        segments: ["b2c_individual", "b2c_reduced", "b2b_institution", "paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka do weryfikacji (pewność kontekstu: niska): mediana INMA Q2 2026 38% (149 marek z 318) i ok. 2024 18% – niezweryfikowane (HTTP 403, Cloudflare); zweryfikowane kotwice: Piano 2022 42,4% desktop / 19,7% mobile; górne progi heurystyczne, zakotwiczone w kwartylach e-commerce Cartylabs (źródło dostawcy bez metodologii). Okres: miesięcznie.",
          en: "heuristic to be verified (context confidence: low): INMA Q2 2026 median 38% (149 of 318 brands) and approx. 2024 18% – unverified (HTTP 403, Cloudflare); verified anchors: Piano 2022 42.4% desktop / 19.7% mobile; upper thresholds heuristic, anchored in Cartylabs e-commerce quartiles (a vendor source with no methodology). Period: monthly.",
        },
        sourceIds: ["inma_checkout_2026", "inma_7reasons", "piano_2022_pr", "cartylabs_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 15,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 15,
            max: 25,
            note: {
              pl: "okolice mediany INMA z ok. 2024 (18%, niezweryfikowana) i mobile Piano 2022 (19,7%)",
              en: "around the INMA median from approx. 2024 (18%, unverified) and Piano 2022 mobile (19.7%)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 25,
            max: 38,
            note: {
              pl: "do mediany INMA Q2 2026 (38%, niezweryfikowana)",
              en: "up to the INMA Q2 2026 median (38%, unverified)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 38,
            max: 55,
            note: {
              pl: "mediana – górny kwartyl (heurystyka); desktop Piano 2022: 42,4%",
              en: "median – upper quartile (heuristic); Piano 2022 desktop: 42.4%",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 55,
            max: null,
            note: {
              pl: "poziom górnego kwartyla checkoutów e-commerce (Cartylabs 52–60%; źródło dostawcy)",
              en: "the upper-quartile level of e-commerce checkouts (Cartylabs 52–60%; vendor source)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "checkout_conversion_rate.ecommerce",
        label: {
          pl: "E-commerce (np. sklep z publikacjami, bilety) – rozpoczęcie checkoutu → zamówienie",
          en: "E-commerce (e.g. a publications shop, tickets) – checkout start → order",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "kwartyle Cartylabs V 2026 (deklarowane >5000 sklepów Shopify; źródło dostawcy bez okresu, próby i metody percentyli – „aggregated 2026 medians”): dolne 10% <28%, dolne 25% 28–38% (pasmo ok. P10–P25), mediana 38–48%, górne 25% 52–60%, top 10% 60–75%. Okres: miesięcznie.",
          en: "Cartylabs May 2026 quartiles (declared >5000 Shopify stores; a vendor source with no period, sample or percentile method – 'aggregated 2026 medians'): bottom 10% <28%, bottom 25% 28–38% (a band of approx. P10–P25), median 38–48%, top 25% 52–60%, top 10% 60–75%. Period: monthly.",
        },
        sourceIds: ["cartylabs_2026", "baymard_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 28,
            note: {
              pl: "dolne 10% (<28%)",
              en: "bottom 10% (<28%)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 28,
            max: 38,
            note: {
              pl: "pasmo „bottom 25%” (ok. P10–P25)",
              en: "the 'bottom 25%' band (approx. P10–P25)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 38,
            max: 48,
            note: {
              pl: "przedział mediany",
              en: "median range",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 48,
            max: 60,
            note: {
              pl: "do górnego kwartyla",
              en: "up to the upper quartile",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 60,
            max: null,
            note: {
              pl: "top 10%",
              en: "the top 10% of stores",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "checkout_conversion_rate.subscription",
      b2c_individual: "checkout_conversion_rate.subscription",
      b2c_reduced: "checkout_conversion_rate.subscription",
      b2b_institution: "checkout_conversion_rate.subscription",
      paywall: "checkout_conversion_rate.subscription",
      events: "checkout_conversion_rate.ecommerce",
    },
  },
  {
    key: "pricing_page_conversion_rate",
    metricId: "pricing_page_conversion_rate",
    group: "funnel",
    abbr: "PPCR",
    name: {
      pl: "Konwersja strony cennika / strony oferty",
      en: "Pricing page / offer page conversion rate",
    },
    expansion: {
      pl: "PPCR – Pricing Page Conversion Rate: odsetek odwiedzających stronę cennika lub strony oferty subskrypcji, którzy kupują (B2C) albo rozpoczynają trial/zapytanie ofertowe (B2B)",
      en: "PPCR – Pricing Page Conversion Rate: share of pricing or subscription offer page visitors who buy (B2C) or start a trial / request a quote (B2B)",
    },
    formula: {
      pl: "unikalni odwiedzający stronę cennika, którzy w tej samej sesji (lub oknie atrybucji, np. 7 dni) kupili / rozpoczęli trial / wysłali zapytanie / unikalni odwiedzający stronę cennika × 100%",
      en: "unique pricing-page visitors who, in the same session (or attribution window, e.g. 7 days), bought / started a trial / sent an enquiry / unique pricing-page visitors × 100%",
    },
    interpretation: {
      pl: "Mierzy, czy oferta, ceny i układ pakietów przekonują osoby, które już szukają zakupu. Ruch na cenniku jest silnie samoselekcyjny: wejścia z paywalla i newslettera konwertują wyżej niż z wyszukiwarki, więc porównuj wynik w podziale na źródła. Pułapki: CTA typu kontakt/zapytanie dla oferty instytucjonalnej obniża konwersję bezpośrednią, a zmiany cen bez testu A/B utrudniają ocenę.",
      en: "Measures whether the offer, prices and plan layout convince people who are already looking to buy. Pricing-page traffic is heavily self-selected: visits from the paywall and newsletter convert better than from search, so compare by source. Pitfalls: contact/quote CTAs for institutional plans lower direct conversion, and price changes without A/B tests make the result hard to interpret.",
    },
    levers: {
      pl: "Uprość stronę oferty: dwa lub trzy plany z wyraźnie wskazanym rekomendowanym, porównanie korzyści językiem odbiorcy i jeden główny przycisk. Dodaj dowody wartości (przykładowe analizy, partnerzy, opinie uczestników wydarzeń) i odpowiedzi na typowe obawy (rezygnacja, faktura, VAT). Instytucjom daj krótki formularz zapytania z szybką odpowiedzią opiekuna i mierz osobno konwersję do zapytania.",
      en: "Simplify the offer page: two or three plans with the recommended one clearly marked, a comparison of benefits in the reader's language and a single main button. Add proof of value (sample analysis, partners, testimonials from event participants) and answers to common concerns (cancellation, invoice, VAT). Give institutions a short enquiry form with a quick reply from an account manager, and measure conversion to enquiry separately.",
    },
    caveats: [
      {
        text: {
          pl: "Brak niezależnego, publicznego badania konwersji stron cennika; SaasDash nie podaje metodologii ani próby – traktuj jako heurystykę.",
          en: "There is no independent public study of pricing-page conversion; SaasDash gives neither methodology nor sample – treat it as a heuristic.",
        },
        sourceIds: ["saasdash_2026"],
      },
      {
        text: {
          pl: "Mediana Piano 2,73% dotyczy szablonu landing page w narzędziu Piano (mianownik: unikalni, którzy zobaczyli ofertę), a nie dowolnej strony cennika.",
          en: "The Piano median of 2.73% concerns the landing-page template in the Piano tool (denominator: unique users who saw the offer), not any pricing page.",
        },
        sourceIds: ["piano_nypa_2025"],
      },
      {
        text: {
          pl: "Dla oferty B2B z ceną na zapytanie mierz osobno konwersję do zapytania i zapytanie → umowa (CRM).",
          en: "For a B2B offer with price on request, measure conversion to enquiry and enquiry → contract (CRM) separately.",
        },
      },
      {
        text: {
          pl: "Mediana SaasDash zależy od typu sprzedaży – nie oceniaj oferty z ceną na zapytanie progami self-serve (mediana enterprise z samym CTA demo 1–3% wypadałaby tam jako słaba).",
          en: "The SaasDash median depends on the sales type – do not assess a price-on-request offer with self-serve thresholds (the enterprise median with a demo-only CTA of 1–3% would come out as weak there).",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "pricing_page_conversion_rate.publisher_offer_page",
        label: {
          pl: "Wydawca – strona ofertowa / landing page subskrypcji (unikalni widzący ofertę → zakup)",
          en: "Publisher – offer page / subscription landing page (unique users seeing the offer → purchase)",
        },
        segments: ["b2c_individual", "b2c_reduced", "paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "mediana Piano (dane II 2025) dla szablonu landing page: 2,73%; pozostałe progi heurystyczne (ok. 0,25×, 0,5× i ok. 2× mediany). Okres: miesięcznie.",
          en: "Piano median (data Feb 2025) for the landing-page template: 2.73%; other thresholds heuristic (approx. 0.25×, 0.5× and approx. 2× the median). Period: monthly.",
        },
        sourceIds: ["piano_nypa_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.75,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.75,
            max: 1.5,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.5,
            max: 2.73,
            note: {
              pl: "do mediany Piano",
              en: "up to the Piano median",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 2.73,
            max: 5,
            note: {
              pl: "powyżej mediany",
              en: "above the median",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 5,
            max: null,
            note: {
              pl: "heurystyka – ok. 2× mediany",
              en: "heuristic – approx. 2× the median",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "pricing_page_conversion_rate.b2b_price_on_request",
        label: {
          pl: "SaaS B2B / oferta instytucjonalna z ceną na zapytanie (CTA demo/kontakt, np. pakiety instytucjonalne NES) – strona cennika → zapytanie lub demo",
          en: "B2B SaaS / institutional offer with price on request (demo/contact CTA, e.g. NES institutional packages) – pricing page → enquiry or demo",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w SaasDash V 2026 (źródło bez źródeł i metodologii): segment enterprise z samym CTA demo – mediana 1–3%, górny kwartyl 4–6%; progi 0,5 i 6 heurystyczne; pewność kontekstu: niska. Okres: miesięcznie.",
          en: "heuristic anchored in SaasDash May 2026 (a source with no sources or methodology): enterprise segment with a demo-only CTA – median 1–3%, upper quartile 4–6%; the 0.5 and 6 thresholds heuristic; context confidence: low. Period: monthly.",
        },
        sourceIds: ["saasdash_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.5,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.5,
            max: 1,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 1,
            max: 3,
            note: {
              pl: "przedział mediany enterprise z samym CTA demo wg SaasDash (1–3%)",
              en: "the enterprise demo-only CTA median range according to SaasDash (1–3%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 3,
            max: 6,
            note: {
              pl: "do górnego kwartyla enterprise wg SaasDash (4–6%)",
              en: "up to the enterprise upper quartile according to SaasDash (4–6%)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 6,
            max: null,
            note: {
              pl: "powyżej górnego kwartyla enterprise – heurystyka",
              en: "above the enterprise upper quartile – heuristic",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "pricing_page_conversion_rate.b2b_self_serve",
        label: {
          pl: "SaaS B2B / oferta self-serve (zakup lub trial bez kontaktu z handlowcem) – strona cennika → trial, rejestracja lub zakup",
          en: "B2B SaaS / self-serve offer (purchase or trial without contacting sales) – pricing page → trial, sign-up or purchase",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka zakotwiczona w SaasDash V 2026 (źródło bez źródeł i metodologii): self-serve – mediana 4–6%, górny kwartyl 10–14%; dla porównania mid-market 3–5% / 7–10%, freemium 8–15% / 20–30%; progi krytyczny i słaby przeniesione heurystycznie z dotychczasowego zestawu; pewność kontekstu: niska. Okres: miesięcznie.",
          en: "heuristic anchored in SaasDash May 2026 (a source with no sources or methodology): self-serve – median 4–6%, upper quartile 10–14%; for comparison mid-market 3–5% / 7–10%, freemium 8–15% / 20–30%; critical and weak thresholds carried over heuristically from the previous set; context confidence: low. Period: monthly.",
        },
        sourceIds: ["saasdash_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 4,
            note: {
              pl: "poniżej przedziału mediany self-serve (4–6%) – heurystyka",
              en: "below the self-serve median range (4–6%) – heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 4,
            max: 6,
            note: {
              pl: "przedział mediany self-serve wg SaasDash (4–6%)",
              en: "the self-serve median range according to SaasDash (4–6%)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 6,
            max: 10,
            note: {
              pl: "do dolnej granicy górnego kwartyla self-serve (10–14%)",
              en: "up to the lower bound of the self-serve upper quartile (10–14%)",
            },
            basis: "E",
          },
          {
            tier: "optimal",
            min: 10,
            max: null,
            note: {
              pl: "górny kwartyl self-serve wg SaasDash (10–14%) i wyżej",
              en: "the self-serve upper quartile according to SaasDash (10–14%) and above",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "pricing_page_conversion_rate.publisher_offer_page",
      b2c_individual: "pricing_page_conversion_rate.publisher_offer_page",
      b2c_reduced: "pricing_page_conversion_rate.publisher_offer_page",
      paywall: "pricing_page_conversion_rate.publisher_offer_page",
      b2b_institution: "pricing_page_conversion_rate.b2b_price_on_request",
    },
  },
  {
    key: "signup_form_conversion_rate",
    metricId: "signup_form_conversion_rate",
    group: "funnel",
    abbr: "SFCR",
    name: {
      pl: "Konwersja popupów / modali zapisu (formularze zapisu)",
      en: "Signup form / popup conversion rate",
    },
    expansion: {
      pl: "SFCR – Signup Form Conversion Rate: odsetek wyświetleń formularza zapisu (popup, modal, flyout), które kończą się zapisem adresu e-mail",
      en: "SFCR – Signup Form Conversion Rate: share of signup form displays (popup, modal, flyout) that end in an email signup",
    },
    formula: {
      pl: "zebrane zapisy (adresy e-mail) / wyświetlenia formularza × 100% (definicja Wisepops i Omnisend: e-maile / wyświetlenia)",
      en: "sign-ups collected (e-mail addresses) / form views × 100% (Wisepops and Omnisend definition: e-mails / views)",
    },
    interpretation: {
      pl: "Pokazuje, czy obietnica wartości (newsletter, raport, zaproszenie na wydarzenie) i moment wyświetlenia trafiają w potrzebę czytelnika. Dla popupów wyświetlanych automatycznie typowe są 2–5%, dla modali otwieranych kliknięciem – kilkadziesiąt procent, więc nigdy nie uśredniaj tych typów. Pułapki: boty zawyżające wyświetlenia, podwójne opt-in (raportuj osobno zapis i potwierdzenie) oraz agresywne popupy na mobile, które psują doświadczenie i zasięg.",
      en: "Shows whether the value promise (newsletter, report, event invite) and display timing match reader needs. Auto-triggered popups typically convert 2–5%, click-triggered modals tens of percent, so never average these types together. Pitfalls: bots inflating displays, double opt-in (report signup and confirmation separately), and aggressive mobile popups hurting experience and reach.",
    },
    levers: {
      pl: "Daj konkretną zachętę opartą na treści: przegląd tygodnia, raport do pobrania, zaproszenie na wydarzenie. Testuj wyzwalacz (przewinięcie, czas, exit-intent) i częstotliwość wyświetleń, żeby nie zniechęcać stałych czytelników, oraz formularz wieloetapowy zamiast jednego długiego. Dopasuj komunikat do tematu strony, a wyniki raportuj osobno dla popupów automatycznych i otwieranych kliknięciem.",
      en: "Offer a concrete content-based incentive: a weekly briefing, a downloadable report, an event invitation. Test the trigger (scroll, time, exit-intent) and display frequency so as not to put off regular readers, and a multi-step form instead of one long form. Match the message to the page topic, and report results separately for automatic and click-triggered popups.",
    },
    caveats: [
      {
        text: {
          pl: "Dane Omnisend i Wisepops pochodzą głównie z e-commerce (zachętą bywa rabat); u wydawcy zachętą jest treść, więc wyniki mogą być niższe.",
          en: "The Omnisend and Wisepops data come mainly from e-commerce (the incentive is often a discount); for a publisher the incentive is content, so results may be lower.",
        },
      },
      {
        text: {
          pl: "Omnisend 2025: popupy wyświetlane jednocześnie na desktopie i mobile 2,2%, tylko na desktopie 1,4% (na wykresie 1,3%); koło fortuny 3,5%; Wisepops: exit-intent 3,94%, wieloetapowe 5,17% vs jednoetapowe 4,62%.",
          en: "Omnisend 2025: popups shown on desktop and mobile at the same time 2.2%, desktop only 1.4% (1.3% on the chart); wheel of fortune 3.5%; Wisepops: exit-intent 3.94%, multi-step 5.17% vs single-step 4.62%.",
        },
        sourceIds: ["omnisend_2026", "wisepops_2025"],
      },
      {
        text: {
          pl: "Top 10% Wisepops (57,7%) obejmuje popupy otwierane kliknięciem – nie porównuj z popupami automatycznymi.",
          en: "The Wisepops top 10% (57.7%) includes click-triggered popups – do not compare with automatic popups.",
        },
        sourceIds: ["wisepops_2025"],
      },
      {
        text: {
          pl: "Konteksty LinkedIn Lead Gen Forms (Kiin Labs 2026) mierzą formularz w serwisie reklamowym: otwiera się po kliknięciu reklamy i jest wypełniony danymi z profilu, a mianownikiem są otwarcia formularza, nie wyświetlenia popupu w serwisie. Porównuj je tylko z danymi z LinkedIn Campaign Manager (Leady / Otwarcia formularza), osobno dla oferty treści (mediana 10,8%) i prośby o demo (mediana 2,2%). Wysokie ukończenie przy danych z profilu nie oznacza jakości leadów – czytaj je razem z konwersją lead → MQL.",
          en: "The LinkedIn Lead Gen Forms contexts (Kiin Labs 2026) measure a form on the ad platform: it opens after a click on the ad and is pre-filled with profile data, and the denominator is form opens, not popup views on the site. Compare them only with LinkedIn Campaign Manager data (Leads / Form opens), separately for content offers (median 10.8%) and demo requests (median 2.2%). A high completion rate with pre-filled profile data does not mean lead quality – read it together with lead-to-MQL conversion.",
        },
        sourceIds: ["kiin_lgf_benchmarks_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "signup_form_conversion_rate.auto_popup",
        label: {
          pl: "Popup/modal zapisu wyświetlany automatycznie (wejście, scroll, czas, exit-intent)",
          en: "Automatically displayed sign-up popup/modal (entry, scroll, time, exit-intent)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "progi oceny Omnisend 2026 (<1,5% słabo, 1,5–3% średnio, 3–5% dobrze, ≥5% doskonale) przy średniej 2,1% z 1,24 mld wyświetleń w 2025; Wisepops średnia 4,82%; próg krytyczny heurystyczny. Okres: miesięcznie.",
          en: "Omnisend 2026 rating thresholds (<1.5% poor, 1.5–3% average, 3–5% good, ≥5% excellent) with an average of 2.1% from 1.24 billion views in 2025; Wisepops average 4.82%; critical threshold heuristic. Period: monthly.",
        },
        sourceIds: ["omnisend_2026", "wisepops_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.75,
            note: {
              pl: "heurystyka – połowa progu słabego",
              en: "heuristic – half the weak threshold",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.75,
            max: 1.5,
            note: {
              pl: "underperforming wg Omnisend",
              en: "underperforming according to Omnisend",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 1.5,
            max: 3,
            note: {
              pl: "average wg Omnisend; średnia 2,1%",
              en: "average according to Omnisend; average 2.1%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 3,
            max: 5,
            note: {
              pl: "good wg Omnisend; średnia Wisepops 4,82%",
              en: "good according to Omnisend; Wisepops average 4.82%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 5,
            max: null,
            note: {
              pl: "excellent wg Omnisend",
              en: "excellent according to Omnisend",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "signup_form_conversion_rate.click_modal",
        label: {
          pl: "Modal zapisu otwierany kliknięciem (np. przycisk Zapisz się do newslettera)",
          en: "Click-triggered sign-up modal (e.g. a 'Subscribe to the newsletter' button)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Wisepops (IX 2025): średnia CVR dla wyzwalacza click 54,42%, top 10% 63,35%; dolne progi heurystyczne. Okres: miesięcznie.",
          en: "Wisepops (Sep 2025): average CVR for the click trigger 54.42%, top 10% 63.35%; lower thresholds heuristic. Period: monthly.",
        },
        sourceIds: ["wisepops_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 15,
            note: {
              pl: "heurystyka – formularz zniechęca po kliknięciu",
              en: "heuristic – the form discourages after the click",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 15,
            max: 35,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 35,
            max: 54.42,
            note: {
              pl: "do średniej Wisepops",
              en: "up to the Wisepops average",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 54.42,
            max: 63.35,
            note: {
              pl: "średnia – top 10%",
              en: "average – top 10%",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 63.35,
            max: null,
            note: {
              pl: "top 10% Wisepops",
              en: "Wisepops top 10%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "signup_form_conversion_rate.linkedin_lgf_content",
        label: {
          pl: "LinkedIn Lead Gen Forms – formularz w feedzie z ofertą treści (raport, analiza do pobrania); ukończenie = wysłane / otwarcia formularza",
          en: "LinkedIn Lead Gen Forms – in-feed form with a content offer (report or analysis download); completion = submissions / form opens",
        },
        segments: ["newsletter", "b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (Kiin Labs 2026: 173 konta ze 100+ otwarciami formularza): P25 4,6%, P50 10,8%, P75 18,7%, P90 31,6%; poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny; próg krytyczny = połowa P25 (heurystyka). Kontekst dodany 2026-10-19 z pakietu Insider marketingowy (przedział b-lgf-content, źródło id 1196 w sources.json pakietu); P25 i liczbę kont odczytano ze strony źródła. Okres: na kampanię (mediana kont, 8 IX 2025 – 7 IX 2026).",
          en: "source quartiles (Kiin Labs 2026: 173 accounts with 100+ form opens): P25 4.6%, P50 10.8%, P75 18.7%, P90 31.6%; below P25 weak, P25–P50 normal, P50–P75 good, above P75 optimal; critical threshold = half of P25 (heuristic). Context added on 2026-10-19 from the Insider marketing knowledge pack (range b-lgf-content, source id 1196 in the pack's sources.json); P25 and the number of accounts read from the source page. Period: per campaign (account median, 8 Sep 2025 – 7 Sep 2026).",
        },
        sourceIds: ["kiin_lgf_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2.3,
            note: {
              pl: "heurystyka: połowa P25 (4,6%)",
              en: "heuristic: half of P25 (4.6%)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 2.3,
            max: 4.6,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 4.6,
            max: 10.8,
            note: {
              pl: "P25–P50 (od dolnego kwartyla do mediany)",
              en: "P25–P50 (lower quartile to median)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 10.8,
            max: 18.7,
            note: {
              pl: "P50–P75 (mediana kont 10,8%)",
              en: "P50–P75 (account median 10.8%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 18.7,
            max: null,
            note: {
              pl: "powyżej P75; P90 = 31,6%",
              en: "above P75; P90 = 31.6%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "signup_form_conversion_rate.linkedin_lgf_demo",
        label: {
          pl: "LinkedIn Lead Gen Forms – formularz w feedzie z prośbą o demo lub kontakt handlowy (np. zapytanie o ofertę instytucjonalną); ukończenie = wysłane / otwarcia formularza",
          en: "LinkedIn Lead Gen Forms – in-feed form with a demo or sales contact request (e.g. an enquiry about an institutional offer); completion = submissions / form opens",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (Kiin Labs 2026: 87 kont ze 100+ otwarciami formularza): P25 1,0%, P50 2,2%, P75 4,2%, P90 9,5%; poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny; próg krytyczny = połowa P25 (heurystyka). Kontekst dodany 2026-10-19 z pakietu Insider marketingowy (przedział b-lgf-demo, źródło id 1196 w sources.json pakietu); P25 i liczbę kont odczytano ze strony źródła. Okres: na kampanię (mediana kont, 8 IX 2025 – 7 IX 2026).",
          en: "source quartiles (Kiin Labs 2026: 87 accounts with 100+ form opens): P25 1.0%, P50 2.2%, P75 4.2%, P90 9.5%; below P25 weak, P25–P50 normal, P50–P75 good, above P75 optimal; critical threshold = half of P25 (heuristic). Context added on 2026-10-19 from the Insider marketing knowledge pack (range b-lgf-demo, source id 1196 in the pack's sources.json); P25 and the number of accounts read from the source page. Period: per campaign (account median, 8 Sep 2025 – 7 Sep 2026).",
        },
        sourceIds: ["kiin_lgf_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.5,
            note: {
              pl: "heurystyka: połowa P25 (1,0%)",
              en: "heuristic: half of P25 (1.0%)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.5,
            max: 1,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 1,
            max: 2.2,
            note: {
              pl: "P25–P50 (od dolnego kwartyla do mediany)",
              en: "P25–P50 (lower quartile to median)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 2.2,
            max: 4.2,
            note: {
              pl: "P50–P75 (mediana kont 2,2%)",
              en: "P50–P75 (account median 2.2%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 4.2,
            max: null,
            note: {
              pl: "powyżej P75; P90 = 9,5%",
              en: "above P75; P90 = 9.5%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "signup_form_conversion_rate.auto_popup",
      newsletter: "signup_form_conversion_rate.auto_popup",
    },
  },
  {
    key: "activation_rate",
    group: "funnel",
    abbr: "ACT",
    name: {
      pl: "Wskaźnik aktywacji",
      en: "Activation rate",
    },
    expansion: {
      pl: "AR – Activation Rate: odsetek nowych użytkowników (zarejestrowanych lub nowych subskrybentów), którzy w zadanym oknie osiągnęli zdefiniowany moment pierwszej wartości",
      en: "AR – Activation Rate: share of new users (registered users or new subscribers) who reach a defined first-value milestone within a set window",
    },
    formula: {
      pl: "nowi użytkownicy w kohorcie, którzy w ciągu X dni wykonali zdarzenie aktywacji (np. 3 artykuły premium + zapis do newslettera; rejestracja na wydarzenie; dołączenie do klubu) / wszyscy nowi zarejestrowani w kohorcie × 100%",
      en: "new users in the cohort who performed the activation event within X days (e.g. 3 premium articles + newsletter sign-up; event registration; joining a club) / all new registered users in the cohort × 100%",
    },
    interpretation: {
      pl: "Mówi, jaka część nowych kont dochodzi do realnej wartości, a więc ma szansę zostać i zapłacić. Najważniejsze jest dobranie zdarzenia aktywacji, które przewiduje retencję co najmniej 2× lepiej niż jego brak (Lenny's Newsletter). Pułapki: zbyt łatwe zdarzenie (samo zalogowanie) zawyża wynik, a benchmarki o innej definicji (Amplitude: powrót w 7. dniu; Userpilot: wykonanie kluczowej akcji) nie są porównywalne.",
      en: "Shows what share of new accounts reach real value and are therefore likely to stay and pay. The key is choosing an activation event that predicts retention at least 2x better than not reaching it (Lenny's Newsletter). Pitfalls: an event that is too easy (a mere login) inflates the result, and benchmarks with different definitions (Amplitude: day-7 return; Userpilot: key action completed) are not comparable.",
    },
    levers: {
      pl: "Zdefiniuj zdarzenie aktywacji osobno dla czytelnika, subskrybenta płatnego i członka klubu, a potem prowadź nowe osoby do niego krótką ścieżką: wybór tematów, pierwszy newsletter, polecany raport lub wydarzenie. Usuń kroki, które nie przybliżają do pierwszej wartości, i przypominaj e-mailem o niedokończonym kroku. Porównuj kohorty według źródła pozyskania, bo aktywacja zapowiada późniejszą retencję.",
      en: "Define the activation event separately for a reader, a paying subscriber and a club member, then guide newcomers to it along a short path: topic selection, the first newsletter, a recommended report or event. Remove steps that do not bring people closer to first value, and send an e-mail reminder about an unfinished step. Compare cohorts by acquisition source, because activation predicts later retention.",
    },
    caveats: [
      {
        text: {
          pl: "Userpilot to dane własne klientów (62 firmy B2B), Lenny – ankieta z 2022 r. (ponad 500 odpowiedzi, samodeklaracje); oba nie dotyczą wydawców.",
          en: "Userpilot is its customers' own data (62 B2B companies), Lenny a 2022 survey (over 500 responses, self-reported); neither concerns publishers.",
        },
        sourceIds: ["userpilot_2025", "lenny_2022"],
      },
      {
        text: {
          pl: "Amplitude: 69% produktów z najlepszą aktywacją D7 było też w czołówce retencji po 3 miesiącach – aktywacja jest wczesnym predyktorem retencji.",
          en: "Amplitude: 69% of the products with the best D7 activation were also among the retention leaders after 3 months – activation is an early predictor of retention.",
        },
        sourceIds: ["amplitude_2025"],
      },
      {
        text: {
          pl: "Dla think tanku zdefiniuj osobne zdarzenia aktywacji dla czytelnika zarejestrowanego, subskrybenta płatnego i członka klubu; brak publicznych benchmarków dla tych definicji.",
          en: "For a think tank, define separate activation events for a registered reader, a paying subscriber and a club member; there are no public benchmarks for these definitions.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "activation_rate.b2b_value_milestone",
        label: {
          pl: "Produkt cyfrowy / SaaS B2B – nowi użytkownicy, którzy osiągnęli kamień milowy wartości",
          en: "Digital product / B2B SaaS – new users who reached a value milestone",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "mediana Lenny 2022 dla SaaS 30% (ankieta z 2022 r., samodeklaracje; ogółem 25%) i Userpilot 2025 (mediana 37,04%, średnia 37,5%; 62 firmy B2B); górny próg = najlepsza branża Userpilot (AI&ML 54,8%); próg krytyczny heurystyczny (najsłabsze branże 5–8,3%). Okres: kohorta (okno 7–14 dni).",
          en: "Lenny 2022 median for SaaS 30% (a 2022 survey, self-reported; 25% overall) and Userpilot 2025 (median 37.04%, average 37.5%; 62 B2B companies); upper threshold = the best Userpilot industry (AI&ML 54.8%); critical threshold heuristic (the weakest industries 5–8.3%). Period: cohort (7–14-day window).",
        },
        sourceIds: ["userpilot_2025", "lenny_2022"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 10,
            note: {
              pl: "poziom najsłabszych branż Userpilot",
              en: "the level of the weakest Userpilot industries",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 10,
            max: 30,
            note: {
              pl: "poniżej mediany Lenny dla SaaS (30%)",
              en: "below the Lenny median for SaaS (30%)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 30,
            max: 37,
            note: {
              pl: "mediana Lenny dla SaaS (30%) – mediana Userpilot (37,04%)",
              en: "Lenny median for SaaS (30%) – Userpilot median (37.04%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 37,
            max: 55,
            note: {
              pl: "powyżej mediany Userpilot",
              en: "above the Userpilot median",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 55,
            max: null,
            note: {
              pl: "powyżej najlepszej branży Userpilot",
              en: "above the best Userpilot industry",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "activation_rate.d7_return",
        label: {
          pl: "Aktywacja mierzona powrotem w 7. dniu (definicja Amplitude: odsetek kohorty nowych użytkowników aktywnych w D7)",
          en: "Activation measured as a return on day 7 (Amplitude definition: the share of a new-user cohort active on D7)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "Amplitude 2025 (ponad 2600 firm): 7% = próg górnego kwartyla (P75) dla wszystkich branż – jedyny pewny próg; mediana 2,1% i top 10% 12,4% dotyczą wyłącznie produktów enterprise (inna populacja); artykuł nie podaje mediany przekrojowej ani wartości D7 dla mediów i B2B; pozostałe progi heurystyczne; pewność kontekstu: niska. Okres: kohorta D7.",
          en: "Amplitude 2025 (over 2600 companies): 7% = the upper-quartile threshold (P75) for all industries – the only firm threshold; the 2.1% median and the 12.4% top 10% concern enterprise products only (a different population); the article gives neither a cross-sectional median nor D7 values for media and B2B; other thresholds heuristic; context confidence: low. Period: D7 cohort.",
        },
        sourceIds: ["amplitude_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 1,
            max: 2.1,
            note: {
              pl: "heurystyka; poniżej mediany produktów enterprise (2,1)",
              en: "heuristic; below the median of enterprise products (2.1)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 2.1,
            max: 7,
            note: {
              pl: "od mediany produktów enterprise (2,1) do P75 wszystkich branż (7)",
              en: "from the median of enterprise products (2.1) to the all-industry P75 (7)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 7,
            max: 12.4,
            note: {
              pl: "P75 wszystkich branż (7) – jedyny pewny próg",
              en: "all-industry P75 (7) – the only firm threshold",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 12.4,
            max: null,
            note: {
              pl: "top 10% produktów enterprise (12,4) – inna populacja, heurystyka",
              en: "top 10% of enterprise products (12.4) – a different population, heuristic",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "activation_rate.d7_return",
      b2b_institution: "activation_rate.b2b_value_milestone",
    },
    noMetricReason: {
      pl: "System nie rejestruje jeszcze zdarzenia aktywacji - definicja (np. kilka artykułów premium i zapis do newslettera, rejestracja na wydarzenie, dołączenie do klubu) wymaga decyzji dla każdego segmentu (D-02). Do czasu jej przyjęcia wskaźnik ma status braku danych.",
      en: "The system does not yet record an activation event – the definition (e.g. a few premium articles plus a newsletter sign-up, an event registration, joining a club) needs a decision for each segment (D-02). Until it is adopted the indicator has a no-data status.",
    },
  },
  {
    key: "time_to_value",
    group: "funnel",
    abbr: "TTV",
    name: {
      pl: "Czas do wartości",
      en: "Time to value",
    },
    expansion: {
      pl: "TTV – Time to Value: czas od rejestracji lub zakupu do pierwszego momentu, w którym użytkownik otrzymuje obiecaną wartość",
      en: "TTV – Time to Value: time from sign-up or purchase to the first moment the user receives the promised value",
    },
    formula: {
      pl: "mediana (czas zdarzenia wartości − czas rejestracji/zakupu) w kohorcie, w godzinach; użytkownicy bez zdarzenia wartości raportowani osobno jako odsetek",
      en: "median (time of the value event − time of registration/purchase) in the cohort, in hours; users without a value event reported separately as a share",
    },
    interpretation: {
      pl: "Im szybciej nowy czytelnik lub subskrybent dostaje wartość (pełny tekst premium, pierwszy newsletter, zaproszenie na wydarzenie), tym mniejsze ryzyko wczesnej rezygnacji – wg Piano 13% wyłączeń automatycznego odnowienia następuje już pierwszego dnia, a 40% w ciągu 60 dni. Raportuj medianę, nie średnią, bo rozkład ma długi ogon. Pułapka: osoby, które nigdy nie doszły do wartości, wypadają ze średniej i sztucznie poprawiają wynik.",
      en: "The faster a new reader or subscriber gets value (full premium article, first newsletter, event invite), the lower the risk of early cancellation – per Piano, 13% of auto-renew disablements happen on day one and 40% within 60 days. Report the median, not the mean, because the distribution has a long tail. Pitfall: users who never reach value drop out of the average and artificially improve it.",
    },
    levers: {
      pl: "Pokaż wartość w pierwszej sesji: po rejestracji lub zakupie od razu otwórz pełny artykuł premium albo raport, który skłonił do decyzji. Wyślij newsletter powitalny natychmiast, a nie z najbliższym wydaniem, i zaproponuj najbliższe wydarzenie lub spotkanie klubu. Dla dostępu instytucjonalnego przygotuj krótkie wdrożenie z listą materiałów i kontaktem do opiekuna.",
      en: "Deliver value in the first session: right after registration or purchase, open the full premium article or the report that prompted the decision. Send the welcome newsletter immediately rather than with the next issue, and suggest the next event or club meeting. For institutional access, prepare a short onboarding with a list of materials and a contact to the account manager.",
    },
    caveats: [
      {
        text: {
          pl: "Userpilot nie podaje opisanej mediany ani metodologii pomiaru TTV (nieopisana wartość ok. 25,9 h może być medianą); dane z 62 firm B2B – niska porównywalność z serwisem treściowym.",
          en: "Userpilot gives neither a described median nor a TTV measurement methodology (an undescribed value of approx. 25.9 h may be the median); data from 62 B2B companies – low comparability with a content service.",
        },
        sourceIds: ["userpilot_2025"],
      },
      {
        text: {
          pl: "Kontekst wydawcy jest w całości heurystyczny – brak publicznego benchmarku TTV dla mediów i think tanków.",
          en: "The publisher context is entirely heuristic – there is no public TTV benchmark for media and think tanks.",
        },
      },
      {
        text: {
          pl: "Zdarzenie wartości musi być spójne z definicją aktywacji (activation_rate).",
          en: "The value event must be consistent with the activation definition (activation_rate).",
        },
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "time_to_value.b2b_saas",
        label: {
          pl: "SaaS B2B / dostęp instytucjonalny – rejestracja → pierwsze zdarzenie wartości",
          en: "B2B SaaS / institutional access – registration → first value event",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "hours",
        window: "cohort_m1",
        direction: "lower",
        method: {
          pl: "średnia Userpilot 2025: 1 d 12 h 23 min (ok. 36,4 h; 62 firmy B2B); najlepsza branża CRM 1 d 4 h 43 min, najsłabsza HR 3 d 18 h 59 min; granica 7 dni wg zalecenia Amplitude (wartość najlepiej w pierwszym tygodniu) – heurystyka; strona Userpilot obok średniej 36,4 h pokazuje nieopisaną wartość 1 d 1 h 54 min (ok. 25,9 h), być może medianę – po jej potwierdzeniu granicę dobry/normalny przesunąć z 36,4 h na ok. 26 h (granica optymalny/dobry 24 h bez zmian); na razie progi bez zmian. Okres: kohorta.",
          en: "Userpilot 2025 average: 1 d 12 h 23 min (approx. 36.4 h; 62 B2B companies); best industry CRM 1 d 4 h 43 min, weakest HR 3 d 18 h 59 min; the 7-day boundary follows Amplitude's recommendation (value is best delivered in the first week) – heuristic; next to the 36.4 h average the Userpilot page shows an undescribed value of 1 d 1 h 54 min (approx. 25.9 h), possibly the median – once confirmed, move the good/normal boundary from 36.4 h to approx. 26 h (the optimal/good boundary of 24 h unchanged); for now the thresholds are unchanged. Period: cohort.",
        },
        sourceIds: ["userpilot_2025", "amplitude_media_2025"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 24,
            note: {
              pl: "poniżej najlepszej branży Userpilot (ok. 28,7 h)",
              en: "below the best Userpilot industry (approx. 28.7 h)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 24,
            max: 36.4,
            note: {
              pl: "do średniej Userpilot",
              en: "up to the Userpilot average",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 36.4,
            max: 72,
            note: {
              pl: "średnia – ok. 3 dni",
              en: "average – approx. 3 days",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 72,
            max: 168,
            note: {
              pl: "3–7 dni; poziom najsłabszej branży (HR)",
              en: "3–7 days; the level of the weakest industry (HR)",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 168,
            max: null,
            note: {
              pl: "ponad tydzień",
              en: "more than a week",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "time_to_value.publisher_think_tank",
        label: {
          pl: "Wydawca / think tank – rejestracja lub zakup → pierwszy moment wartości (pełny artykuł premium, otwarty newsletter powitalny, zapis na wydarzenie)",
          en: "Publisher / think tank – registration or purchase → first moment of value (a full premium article, an opened welcome newsletter, an event sign-up)",
        },
        segments: ["b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "hours",
        window: "cohort_m1",
        direction: "lower",
        method: {
          pl: "heurystyka ekspercka; uzasadnienie: dane Piano 2024 o wczesnych rezygnacjach (13% wyłączeń auto-odnowienia 1. dnia, 40% w 60 dni). Okres: kohorta.",
          en: "expert heuristic; rationale: Piano 2024 data on early cancellations (13% of auto-renewal opt-outs on day 1, 40% within 60 days). Period: cohort.",
        },
        sourceIds: ["piano_benchmarks_2024"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 1,
            note: {
              pl: "wartość w tej samej sesji",
              en: "value in the same session",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 1,
            max: 24,
            note: {
              pl: "w ciągu doby",
              en: "within a day",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 24,
            max: 72,
            note: {
              pl: "1–3 dni",
              en: "1–3 days",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 72,
            max: 168,
            note: {
              pl: "3–7 dni",
              en: "3–7 days",
            },
            basis: "E",
          },
          {
            tier: "critical",
            min: 168,
            max: null,
            note: {
              pl: "ponad tydzień",
              en: "more than a week",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "time_to_value.publisher_think_tank",
      b2c_individual: "time_to_value.publisher_think_tank",
      b2c_reduced: "time_to_value.publisher_think_tank",
      b2b_institution: "time_to_value.b2b_saas",
    },
    noMetricReason: {
      pl: "Czas do wartości wymaga zdarzenia wartości spójnego z definicją aktywacji, którego system jeszcze nie rejestruje (D-02). Bez niego mediana czasu byłaby liczona do niezdefiniowanego punktu końcowego.",
      en: "Time to value needs a value event consistent with the activation definition, which the system does not yet record (D-02). Without it the median time would be measured to an undefined end point.",
    },
  },
  {
    key: "paywall_hit_rate",
    metricId: "paywall_hit_rate",
    group: "funnel",
    abbr: "PHR",
    name: {
      pl: "Odsetek użytkowników trafiających na paywall",
      en: "Paywall hit rate (share of users hitting the paywall)",
    },
    expansion: {
      pl: "PHR – Paywall Hit Rate (także stop rate u INMA, exposure rate u Piano): odsetek miesięcznych unikalnych użytkowników, którzy co najmniej raz zobaczyli paywall lub płatną ofertę",
      en: "PHR – Paywall Hit Rate (INMA: stop rate; Piano: exposure rate): share of monthly unique users who saw the paywall or a paid offer at least once",
    },
    formula: {
      pl: "unikalni użytkownicy, którzy w miesiącu co najmniej raz zobaczyli paywall/płatną ofertę / wszyscy unikalni użytkownicy w miesiącu × 100%",
      en: "unique users who saw the paywall/paid offer at least once in the month / all unique users in the month × 100%",
    },
    interpretation: {
      pl: "Mierzy, jak szeroko otwieramy drzwi do sprzedaży: zbyt niski oznacza brak okazji do konwersji (Mather 2022: 85% użytkowników omijało paywalle), zbyt wysoki w modelu freemium oznacza utratę zasięgu, ruchu z wyszukiwarek i przyszłych subskrybentów. To wskaźnik docelowego przedziału – optimum zależy od modelu (freemium/hybryda vs twardy paywall) i od tego, czy wzrost PHR zwiększa łączną liczbę sprzedaży. Pułapka: podnoszenie PHR obniża konwersję paywalla, więc oceniaj oba wskaźniki razem.",
      en: "Measures how widely the door to a sale is opened: too low means no conversion opportunities (Mather 2022: 85% of users eluded paywalls), too high in a freemium model means lost reach, search traffic and future subscribers. It is a target-range metric – the optimum depends on the model (freemium/hybrid vs hard wall) and on whether a higher PHR increases total sales. Pitfall: raising PHR lowers paywall conversion, so evaluate both together.",
    },
    levers: {
      pl: "Traktuj PHR jako przedział, a nie cel do maksymalizacji: zmieniaj limit darmowych tekstów i reguły paywalla małymi krokami i oceniaj je razem z PSCR i zasięgiem. Pokazuj ofertę przy treściach o najwyższej skłonności do zakupu (analizy, raporty), a materiały budujące zasięg zostaw otwarte. Sprawdzaj wycieki (tryb prywatny, nowe tożsamości przeglądarki) i pilnuj, by bramka rejestracji nie odbierała ekspozycji ofert płatnych.",
      en: "Treat PHR as a range, not a target to maximise: change the free-article limit and paywall rules in small steps and judge them together with PSCR and reach. Show the offer on content with the highest purchase propensity (analysis, reports) and keep reach-building material open. Check for leaks (private mode, new browser identities) and make sure the registration wall does not take exposure away from paid offers.",
    },
    caveats: [
      {
        text: {
          pl: "Dane INMA (31%, ≥56%, ≤25%, +67% zasięgu) pochodzą z fragmentów artykułów dostępnych w wyszukiwarce (strona INMA zwraca HTTP 403, Cloudflare) – niezweryfikowane; liczba „mniej niż 30% użytkowników mediany serwisów kiedykolwiek widzi paywall” (inma_ceiling_2026) pochodzi z zapowiedzi w serwisie X i służy wyłącznie jako kontekst, nie kotwica przedziału.",
          en: "The INMA data (31%, ≥56%, ≤25%, +67% reach) come from article snippets available in search results (the INMA page returns HTTP 403, Cloudflare) – unverified; the figure 'fewer than 30% of the users of the median site ever see a paywall' (inma_ceiling_2026) comes from a teaser on X and serves only as context, not as a range anchor.",
        },
        sourceIds: ["inma_ceiling_2026"],
      },
      {
        text: {
          pl: "INMA Q2 2026 (niezweryfikowane): serwisy freemium/hybrydowe miały o 67% wyższy zasięg (penetracja gospodarstw domowych) niż twarde paywalle.",
          en: "INMA Q2 2026 (unverified): freemium/hybrid sites had 67% higher reach (household penetration) than hard paywalls.",
        },
      },
      {
        text: {
          pl: "Mather 2024: zaostrzenie paywalla dało +100% prób sprzedaży przy −20% konwersji; obniżenie limitu z 3 do 2 darmowych artykułów dotyka więcej czytelników niż podniesienie z 3 do 4.",
          en: "Mather 2024: tightening the paywall gave +100% sales attempts at −20% conversion; lowering the limit from 3 to 2 free articles affects more readers than raising it from 3 to 4.",
        },
        sourceIds: ["mather_intercept_2024"],
      },
      {
        text: {
          pl: "Piano (I 2023): rozrzut ekspozycji między wydawcami od 0,01% (Bottom) do 87,4% (Top), mediana ok. 8,8% – mediana ma sens tylko w obrębie tego samego modelu paywalla.",
          en: "Piano (Jan 2023): exposure ranges across publishers from 0.01% (Bottom) to 87.4% (Top), median approx. 8.8% – the median makes sense only within the same paywall model.",
        },
      },
      {
        text: {
          pl: "Europa (Piano XII 2024: 20,4%) eksponuje oferty częściej niż USA (13,8%).",
          en: "Europe (Piano Dec 2024: 20.4%) exposes offers more often than the USA (13.8%).",
        },
      },
    ],
    direction: "range",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "paywall_hit_rate.metered_freemium",
        label: {
          pl: "Wydawca freemium/metered/hybrydowy (model NES)",
          en: "Freemium/metered/hybrid publisher (NES model)",
        },
        segments: ["paywall", "b2c_individual", "b2c_reduced"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "range",
        method: {
          pl: "zweryfikowane mediany: Mather VI 2025 22,8% (VI 2024: 15,1%), Piano XII 2024 16,3% (Europa 20,4%), Mather Q2 2022 14,3% (best-in-class 20,3% – średnia rynków wzorcowych, nie percentyl); pomocniczo, niezweryfikowane (INMA, HTTP 403): mediana 31% (317 marek), freemium/hybryda ≤25%, twarde ≥56%; przedział optymalny 18–30 – heurystyka zgodna ze zweryfikowanymi kotwicami; nowsze raporty Mather (Q1 2026 Ameryka Płn., miesięczne German/UK Audience Benchmarks 2026; za formularzem) do pozyskania przy aktualizacji – niemieckie są bliższe rynkowi PL. Okres: miesięcznie.",
          en: "verified medians: Mather Jun 2025 22.8% (Jun 2024: 15.1%), Piano Dec 2024 16.3% (Europe 20.4%), Mather Q2 2022 14.3% (best-in-class 20.3% – the average of benchmark markets, not a percentile); auxiliary, unverified (INMA, HTTP 403): median 31% (317 brands), freemium/hybrid ≤25%, hard ≥56%; the optimal range of 18–30 is a heuristic consistent with the verified anchors; newer Mather reports (Q1 2026 North America, the monthly German/UK Audience Benchmarks 2026; behind a form) to be obtained at the next update – the German ones are closer to the Polish market. Period: monthly.",
        },
        sourceIds: [
          "mather_q2_2025",
          "piano_nypa_2025",
          "mather_sep_2022",
          "mather_intercept_2024",
          "inma_nyt_reach",
          "inma_shadow_2026",
          "mather_q1_2026",
          "mather_de_2026_07",
          "mather_uk_2026_07",
        ],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 5,
            note: {
              pl: "paywall praktycznie niewidoczny – brak okazji do sprzedaży",
              en: "paywall practically never seen – no opportunity to sell",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 5,
            max: 12,
            note: {
              pl: "za mało ekspozycji; znacznie poniżej zweryfikowanych median Mather/Piano 2022–2025 (14,3–22,8%)",
              en: "too little exposure; well below the verified Mather/Piano 2022–2025 medians (14.3–22.8%)",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 12,
            max: 18,
            note: {
              pl: "okolice mediany Piano XII 2024 (16,3%), Mather VI 2024 (15,1%) i Q2 2022 (14,3%)",
              en: "around the Piano Dec 2024 median (16.3%), Mather Jun 2024 (15.1%) and Q2 2022 (14.3%)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 18,
            max: 30,
            note: {
              pl: "mediana Mather VI 2025 (22,8%), Piano Europa XII 2024 (20,4%), best-in-class Mather 2022 (20,3%); INMA: freemium/hybryda ≤25% (niezweryfikowane)",
              en: "Mather Jun 2025 median (22.8%), Piano Europe Dec 2024 (20.4%), Mather best-in-class 2022 (20.3%); INMA: freemium/hybrid ≤25% (unverified)",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 30,
            max: 40,
            note: {
              pl: "powyżej mediany INMA (31%, niezweryfikowana) – monitoruj utratę zasięgu",
              en: "above the INMA median (31%, unverified) – monitor the loss of reach",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 40,
            max: null,
            note: {
              pl: "zbyt szczelnie; dla freemium zbyt szczelnie – zbliżenie do twardego paywalla (INMA ≥56%, niezweryfikowane)",
              en: "too tight; too tight for freemium – approaching a hard paywall (INMA ≥56%, unverified)",
            },
            basis: "E",
          },
        ],
      },
      {
        id: "paywall_hit_rate.hard_wall",
        label: {
          pl: "Twardy paywall (hard wall)",
          en: "Hard paywall (hard wall)",
        },
        segments: ["paywall"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "heurystyka oparta wyłącznie na niezweryfikowanych danych INMA (strona zwraca HTTP 403, Cloudflare; pewność kontekstu: niska): Q2 2026 (318 marek) większość serwisów z twardym paywallem zatrzymuje ≥56% użytkowników miesięcznie; paywalle uruchomione przed 2019 r. zatrzymują ok. 50%. Okres: miesięcznie.",
          en: "heuristic based solely on unverified INMA data (the page returns HTTP 403, Cloudflare; context confidence: low): Q2 2026 (318 brands) most hard-paywall sites stop ≥56% of users monthly; paywalls launched before 2019 stop approx. 50%. Period: monthly.",
        },
        sourceIds: ["inma_shadow_2026", "inma_nyt_reach"],
        bands: [
          {
            tier: "weak",
            min: null,
            max: 30,
            note: {
              pl: "nietypowo nisko dla twardego paywalla – sprawdź reguły i wycieki",
              en: "unusually low for a hard paywall – check the rules and leaks",
            },
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 56,
            note: {
              pl: "heurystyka",
              en: "heuristic",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 56,
            max: null,
            note: {
              pl: "typowe dla twardego paywalla wg INMA (niezweryfikowane)",
              en: "typical of a hard paywall according to INMA (unverified)",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "paywall_hit_rate.metered_freemium",
      paywall: "paywall_hit_rate.metered_freemium",
      b2c_individual: "paywall_hit_rate.metered_freemium",
      b2c_reduced: "paywall_hit_rate.metered_freemium",
    },
  },
  {
    key: "engagement_rate",
    metricId: "engagement_rate",
    group: "funnel",
    abbr: "ER (GA4)",
    name: {
      pl: "Współczynnik zaangażowania (GA4)",
      en: "Engagement rate (GA4)",
    },
    expansion: {
      pl: "ER – Engagement Rate: odsetek sesji zaangażowanych (dłuższych niż 10 s, z co najmniej dwiema odsłonami albo z konwersją) we wszystkich sesjach witryny – definicja Google Analytics 4",
      en: "ER – Engagement Rate: share of engaged sessions (longer than 10 s, with at least two page views or a conversion) among all site sessions – the Google Analytics 4 definition",
    },
    formula: {
      pl: "sesje zaangażowane (GA4 engagedSessions) / wszystkie sesje (GA4 sessions) × 100% – metryka GA4 engagementRate z Data API, liczona przez Google",
      en: "engaged sessions (GA4 engagedSessions) / all sessions (GA4 sessions) × 100% – the GA4 metric engagementRate from the Data API, computed by Google",
    },
    interpretation: {
      pl: "Mówi, czy ruch, który przyciągamy, w ogóle wchodzi w treść – to pierwszy filtr lejka przed rejestracją, paywallem i zakupem. Niski wynik zwykle oznacza ruch niskiej intencji (social płatny, display, nieprzypisany) albo stronę wejścia, która nie odpowiada na obietnicę z linku; wysoki – ruch z wyszukiwarek, poleceń i newslettera. Pułapki: wynik zależy od mieszanki kanałów i urządzeń (komórki niżej niż desktop), a bez zgody analitycznej GA4 widzi tylko część sesji – porównuj okresy przy tej samej konfiguracji zgód i oceniaj kanały osobno.",
      en: "Shows whether the traffic we attract actually engages with the content – the first filter of the funnel before registration, the paywall and purchase. A low result usually means low-intent traffic (paid social, display, unassigned) or a landing page that does not deliver what the link promised; a high one – search, referral and newsletter traffic. Pitfalls: the result depends on the channel and device mix (mobile lower than desktop), and without analytics consent GA4 sees only part of the sessions – compare periods under the same consent setup and judge channels separately.",
    },
    levers: {
      pl: "Oceniaj wynik w podziale na kanały i strony wejścia: kampanie social i display o niskim zaangażowaniu kieruj na treści, które spełniają obietnicę linku, albo ogranicz ich budżet. Na stronach wejścia pokaż od razu lead, spis treści i powiązane analizy, żeby czytelnik wszedł w drugą odsłonę; skróć czas ładowania na komórkach. Porównuj okresy przy tej samej konfiguracji zgód i odfiltruj ruch wewnętrzny oraz boty, zanim uznasz zmianę za efekt treści.",
      en: "Judge the result by channel and landing page: point low-engagement social and display campaigns at content that keeps the link's promise, or cut their budget. On landing pages show the lead, an outline of sections and related analysis straight away so readers open a second page; shorten mobile load time. Compare periods under the same consent setup and filter out internal traffic and bots before treating a change as a content effect.",
    },
    caveats: [
      {
        text: {
          pl: "Źródło podaje tylko mediany (całość, branże, urządzenia, kanały) – bez kwartyli; progi krytyczny i optymalny są heurystyką.",
          en: "The source reports medians only (overall, industries, devices, channels) – no quartiles; the critical and optimal thresholds are heuristics.",
        },
        sourceIds: ["siege_ga4_engagement_2026"],
      },
      {
        text: {
          pl: "Mediany branżowe w tym samym badaniu: e-commerce 54,4%, zdrowie 51,6%, finanse 51,0%, usługi domowe 49,4%, inne (w tym media i organizacje non-profit) 48,0%, SaaS/B2B 46,6% – serwis treści eksperckich porównuj raczej z grupą „inne”.",
          en: "Industry medians in the same study: e-commerce 54.4%, health 51.6%, finance 51.0%, home services 49.4%, other (incl. media and non-profit) 48.0%, SaaS/B2B 46.6% – compare an expert content site with the 'other' group rather than e-commerce.",
        },
        sourceIds: ["siege_ga4_engagement_2026"],
      },
      {
        text: {
          pl: "Urządzenia: desktop 55,3%, tablet 51,2%, komórka 48,8% – przesunięcie ruchu na komórki obniża wynik bez zmiany jakości treści.",
          en: "Devices: desktop 55.3%, tablet 51.2%, mobile 48.8% – a shift of traffic to mobile lowers the result without any change in content quality.",
        },
        sourceIds: ["siege_ga4_engagement_2026"],
      },
      {
        text: {
          pl: "Bez zgody analitycznej GA4 nie widzi części sesji (tryb zgody), więc wynik opisuje sesje ze zgodą; porównuj okresy przy tej samej konfiguracji banera zgód.",
          en: "Without analytics consent GA4 does not see part of the sessions (consent mode), so the result describes consented sessions; compare periods under the same consent-banner setup.",
        },
      },
      {
        text: {
          pl: "Wskaźnika nie da się odtworzyć z własnych zdarzeń (brak czasu trwania sesji) – jedynym źródłem jest GA4 Data API.",
          en: "The indicator cannot be rebuilt from our own events (no session duration) – the GA4 Data API is the only source.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "engagement_rate.site_all",
        label: {
          pl: "Cała witryna – wszystkie sesje (GA4)",
          en: "Whole site – all sessions (GA4)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "Siege Media 2026 (546 usług GA4, ponad 16 mld sesji, I 2024 – VIII 2026; mediana usług, domyślna definicja GA4): mediana 51%, reguła kciuka „50% i więcej – dobrze, powyżej 55% – mocno”; pakiet Insider marketingowy (b-engr, źródło 1352): poniżej 50% słaby, 50–55% normalny, powyżej 55% dobry. Progi krytyczny (25% – połowa dolnej granicy normalnego, jak próg krytyczny kontekstów LinkedIn) i optymalny (60% – poziom median kanałów wysokiej intencji w tym samym badaniu: wyszukiwanie płatne 60,4%, asystenci AI 60,3%, wyszukiwanie organiczne 63,4%) – heurystyka; źródło nie podaje kwartyli. Okres: miesięcznie.",
          en: "Siege Media 2026 (546 GA4 properties, over 16 bn sessions, Jan 2024 – Aug 2026; property-level median, GA4 default definition): median 51%, rule of thumb '50% or more is good, above 55% is strong'; Insider marketing package (b-engr, source 1352): below 50% weak, 50–55% normal, above 55% good. Critical (25% – half of the lower bound of normal, like the critical threshold of the LinkedIn contexts) and optimal (60% – the level of high-intent channel medians in the same study: paid search 60.4%, AI assistants 60.3%, organic search 63.4%) are heuristics; the source gives no quartiles. Period: monthly.",
        },
        sourceIds: ["siege_ga4_engagement_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 25,
            note: {
              pl: "heurystyka – połowa dolnej granicy normalnego; poziom median kanałów niskiej intencji w badaniu (social płatny 20,2%, nieprzypisany 20,8%)",
              en: "heuristic – half of the lower bound of normal; the level of low-intent channel medians in the study (paid social 20.2%, unassigned 20.8%)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 25,
            max: 50,
            note: {
              pl: "poniżej 50% – poniżej mediany (51%) wg Insidera (b-engr) i Siege Media",
              en: "below 50% – below the median (51%) according to the Insider package (b-engr) and Siege Media",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 50,
            max: 55,
            note: {
              pl: "50–55% – okolice mediany 546 usług GA4 (51%)",
              en: "50–55% – around the median of 546 GA4 properties (51%)",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 55,
            max: 60,
            note: {
              pl: "powyżej 55% – „mocno” wg Siege Media",
              en: "above 55% – 'strong' according to Siege Media",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 60,
            max: null,
            note: {
              pl: "heurystyka – poziom median kanałów wysokiej intencji (60,3–63,4%)",
              en: "heuristic – the level of high-intent channel medians (60.3–63.4%)",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "engagement_rate.site_all",
    },
  },
];
