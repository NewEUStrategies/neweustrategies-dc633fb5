// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/email.json, docs/benchmarki/2026-10-18/email.overlay.json
// SHA-256 treści kanonicznej wejść: 05cd9c757633ccb560fec3411e0a93a816afc81324bcd9d084e56aa827f54e3b
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Treść grupy „email” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją
// zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba
// języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).
import type { GeneratedBenchmark } from "../adapter";

export const EMAIL_BENCHMARKS: readonly GeneratedBenchmark[] = [
  {
    key: "open_rate",
    metricId: "email_open_rate",
    group: "email",
    abbr: "OR",
    name: {
      pl: "Wskaźnik otwarć",
      en: "Open Rate",
    },
    expansion: {
      pl: "Open Rate: odsetek dostarczonych wiadomości, które zarejestrowano jako otwarte (unikalne otwarcia)",
      en: "Open Rate: share of delivered emails registered as opened (unique opens)",
    },
    formula: {
      pl: "unikalne otwarcia / (wysłane − odbicia) × 100%",
      en: "unique opens / (sent − bounces) × 100%",
    },
    interpretation: {
      pl: "Mówi, jaka część dostarczonych e-maili została zarejestrowana jako otwarta. Mierzy więc rozpoznawalność nadawcy, siłę tematu i pośrednio dostarczalność. Od iOS 15 Apple Mail Privacy Protection (MPP) z góry pobiera piksel śledzący, przez co otwarcia są zawyżone. Według Litmus Apple Mail to ok. 77% śledzonych otwarć (IX 2026), a według badań cytowanych przez Litmus MPP dotyczy ok. 55–60% otwarć. OR czytaj więc jako trend wewnętrzny i sygnał ostrzegawczy dostarczalności, a decyzje opieraj na CTR/CTOR i konwersji. Pułapki: różne mianowniki (wysłane vs dostarczone), różne filtrowanie botów u dostawców usług e-mail (ESP) i skok OR bez wzrostu kliknięć, który zwykle wynika z MPP lub skanerów, a nie z realnego zainteresowania.",
      en: "Shows what share of delivered emails registered an open: a proxy for sender recognition, subject-line strength and, indirectly, deliverability. Since iOS 15, Apple Mail Privacy Protection (MPP) preloads tracking pixels and inflates opens (Litmus: Apple Mail ~77% of tracked opens in Sep 2026; according to studies cited by Litmus, MPP affects ~55–60% of opens), so treat OR as an internal trend and deliverability warning signal and base decisions on CTR/CTOR and conversions. Pitfalls: different denominators (sent vs delivered), different bot filtering across ESPs, and OR spikes without click growth, which usually come from MPP or scanners rather than real interest.",
    },
    levers: {
      pl: "Popraw dostarczalność, zanim zaczniesz testować treść: uwierzytelnienie domeny (SPF, DKIM, DMARC), regularne czyszczenie nieaktywnych adresów i stały rytm wysyłek. Testuj temat i nadawcę (osoba z zespołu analityków zamiast nazwy organizacji) oraz porę wysyłki dla segmentów. Licz równolegle wskaźnik bez otwarć Apple MPP i oceniaj zaangażowanie głównie po kliknięciach.",
      en: "Improve deliverability before you start testing content: domain authentication (SPF, DKIM, DMARC), regular removal of inactive addresses and a steady sending rhythm. Test the subject line and sender name (a person from the analyst team rather than the organisation's name) and the send time by segment. Calculate a parallel rate excluding Apple MPP opens and judge engagement mainly by clicks.",
    },
    caveats: [
      {
        text: {
          pl: "Apple MPP zawyża otwarcia (Litmus: Apple Mail 76,56% udziału w otwarciach, IX 2026). Przy liście z dużym udziałem iPhone'ów OR może rosnąć bez zmiany zachowań czytelników.",
          en: "Apple MPP inflates opens (Litmus: Apple Mail 76.56% share of opens, Sep 2026). With a list containing many iPhones, OR can rise without any change in readers' behaviour.",
        },
        sourceIds: ["src_litmus_market_share_2026"],
      },
      {
        text: {
          pl: "Benchmarki ESP (MailerLite, GetResponse, Mailchimp) nie są korygowane o MPP (MailerLite sam zaznacza, że „real open rates are lower”). Omnisend i Klaviyo raportują wyraźnie niższe OR (ok. 30–31%), co najpewniej wynika z innej metodologii. Porównuj tylko w obrębie tej samej metodologii.",
          en: "ESP benchmarks (MailerLite, GetResponse, Mailchimp) are not corrected for MPP (MailerLite itself notes that 'real open rates are lower'). Omnisend and Klaviyo report clearly lower OR (approx. 30–31%), most likely because of a different methodology. Compare only within the same methodology.",
        },
        sourceIds: ["src_mailerlite_2025"],
      },
      {
        text: {
          pl: "GetResponse publikuje edycję „Updated for 2024” z danymi z 2023 r. Nowszej edycji nie znaleziono.",
          en: "GetResponse publishes an edition 'Updated for 2024' with data from 2023. No newer edition was found.",
        },
        sourceIds: ["src_getresponse_2024"],
      },
      {
        text: {
          pl: "W panelu warto liczyć równolegle OR z wyłączeniem otwarć oznaczonych jako Apple MPP, jeśli ESP to umożliwia.",
          en: "In the dashboard it is worth calculating, in parallel, OR excluding opens flagged as Apple MPP, if the ESP allows it.",
        },
      },
      {
        text: {
          pl: "Mailchimp (dane do XII 2023) to najstarsze źródło w grupie i ma najniższą wagę względem MailerLite 2025 i Omeda 2026; jego FAQ przeczy tabeli (ogółem 34,23% wobec 35,63%).",
          en: "Mailchimp (data up to Dec 2023) is the oldest source in the group and carries the lowest weight relative to MailerLite 2025 and Omeda 2026; its FAQ contradicts its own benchmark listing (34.23% overall versus 35.63%).",
        },
        sourceIds: ["src_mailchimp_2023"],
      },
      {
        text: {
          pl: "Omeda nie podaje, czy wyklucza otwarcia MPP i botów („privacy features and automated inbox activity load images and register opens”), i wskazuje, że „Click-to-open and click rate are the most reliable comparison points”.",
          en: "Omeda does not state whether it excludes MPP and bot opens ('privacy features and automated inbox activity load images and register opens') and points out that 'Click-to-open and click rate are the most reliable comparison points'.",
        },
        sourceIds: ["src_omeda_h1_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "open_rate.media_publishers",
        label: {
          pl: "Newslettery wydawców mediowych (B2B + B2C); Omeda nie podaje, czy wyklucza otwarcia MPP i botów",
          en: "Newsletters of media publishers (B2B + B2C); Omeda does not state whether it excludes MPP and bot opens",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (P25 24,6%, P50 31,6%, P75 38,5%); próg krytyczny = P25 − (P50 − P25) (heurystyka). Okres: na wysyłkę (mediana wydawcy, H1 2026).",
          en: "source quartiles (P25 24.6%, P50 31.6%, P75 38.5%); critical threshold = P25 − (P50 − P25) (heuristic). Period: per send (publisher median, H1 2026).",
        },
        sourceIds: ["src_omeda_h1_2026", "src_litmus_market_share_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 17.6,
            note: {
              pl: "poniżej P25 − (P50−P25)",
              en: "below P25 − (P50−P25)",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 17.6,
            max: 24.6,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 24.6,
            max: 31.6,
            note: {
              pl: "P25–P50; mediana B2B media 30,9%",
              en: "P25–P50; B2B media median 30.9%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 31.6,
            max: 38.5,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 38.5,
            max: null,
            note: {
              pl: "powyżej P75; mediana B2C/enthusiast 40,2%",
              en: "above P75; B2C/enthusiast median 40.2%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "open_rate.poland_all",
        label: {
          pl: "Polska, wszystkie branże (dane ESP)",
          en: "Poland, all industries (ESP data)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "mediana ± heurystyka: mediana PL 36,05% (MailerLite, XII 2024–XI 2025), średnia PL 38,07% (GetResponse, dane 2023); próg optymalny ≈ mediana Europy 45,08%. Okres: na kampanię.",
          en: "median ± heuristic: PL median 36.05% (MailerLite, Dec 2024–Nov 2025), PL average 38.07% (GetResponse, 2023 data); optimal threshold ≈ the European median of 45.08%. Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_getresponse_2024"],
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
            max: 30,
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 38,
            note: {
              pl: "obejmuje medianę PL",
              en: "includes the PL median",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 38,
            max: 45,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 45,
            max: null,
            note: {
              pl: "od ≈ mediany Europy 45,08%",
              en: "from ≈ the European median of 45.08%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "open_rate.nonprofit_think_tank",
        label: {
          pl: "Non-profit / think tank / NGO",
          en: "Non-profits, think tanks and NGOs",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "heurystyka: zakres median/średnich źródeł (Mailchimp 40,04% [dane do XII 2023; najstarsze źródło, najniższa waga], MailerLite 52,38% [mediana 2025], GetResponse 54,54% [średnia, dane 2023]); mediana MailerLite 52,38% wypada w przedziale „dobry”, a nie na granicy normalny/dobry jak w kontekstach kwartylowych (Omeda, GlueLetter). Okres: na kampanię.",
          en: "heuristic: the range of source medians/averages (Mailchimp 40.04% [data up to Dec 2023; the oldest source, lowest weight], MailerLite 52.38% [2025 median], GetResponse 54.54% [average, 2023 data]); the MailerLite median of 52.38% falls in the 'good' range rather than on the normal/good boundary as in the quartile contexts (Omeda, GlueLetter). Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_getresponse_2024", "src_mailchimp_2023"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 25,
            basis: "E",
          },
          {
            tier: "weak",
            min: 25,
            max: 35,
            basis: "E",
          },
          {
            tier: "normal",
            min: 35,
            max: 48,
            basis: "E",
          },
          {
            tier: "good",
            min: 48,
            max: 55,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 55,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "open_rate.b2b_education_finance",
        label: {
          pl: "B2B, edukacja wyższa, doradztwo, biznes i finanse",
          en: "B2B, higher education, consulting, business and finance",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "heurystyka: MailerLite 2025 (mediany: biznes i finanse 43,34%, konsulting 45,96%, szkolnictwo wyższe 43,98%); GetResponse (edukacja 41,33%, dane 2023); Mailchimp (biznes+finanse 31,35%, edukacja 35,64%; dane do XII 2023 – najstarsze źródło, najniższa waga); mediany MailerLite (43–46%) wypadają w przedziale „dobry”, a nie na granicy normalny/dobry jak w kontekstach kwartylowych. Okres: na kampanię.",
          en: "heuristic: MailerLite 2025 (medians: business and finance 43.34%, consulting 45.96%, higher education 43.98%); GetResponse (education 41.33%, 2023 data); Mailchimp (business+finance 31.35%, education 35.64%; data up to Dec 2023 – the oldest source, lowest weight); the MailerLite medians (43–46%) fall in the 'good' range rather than on the normal/good boundary as in the quartile contexts. Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_getresponse_2024", "src_mailchimp_2023"],
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
            max: 47,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 47,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "open_rate.content_creators",
        label: {
          pl: "Newslettery treściowe (kreatorzy, niezależni wydawcy; próba GlueLetter, bez filtrowania MPP)",
          en: "Content newsletters (creators, independent publishers; GlueLetter sample, no MPP filtering)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (P25 37,40%, P50 49,3%, P75 61,50%, P90 68,96%; tekst strony podaje środkowe 50% jako 38,9–60,2% – niespójność niewyjaśniona przez źródło, przyjęto tabelę); próg krytyczny = P25 − (P50 − P25) (heurystyka). Okres: na wysyłkę (Q1 2025).",
          en: "source quartiles (P25 37.40%, P50 49.3%, P75 61.50%, P90 68.96%; the page text gives the middle 50% as 38.9–60.2% – an inconsistency the source does not explain, the tabulated figures were adopted); critical threshold = P25 − (P50 − P25) (heuristic). Period: per send (Q1 2025).",
        },
        sourceIds: ["src_glueletter_open_q1_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 25.5,
            basis: "E",
          },
          {
            tier: "weak",
            min: 25.5,
            max: 37.4,
            basis: "B",
          },
          {
            tier: "normal",
            min: 37.4,
            max: 49.3,
            basis: "B",
          },
          {
            tier: "good",
            min: 49.3,
            max: 61.5,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 61.5,
            max: null,
            note: {
              pl: "P90 = 68,96%",
              en: "P90 = 68.96%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "open_rate.poland_all",
      newsletter: "open_rate.media_publishers",
      b2b_institution: "open_rate.b2b_education_finance",
    },
  },
  {
    key: "click_through_rate",
    metricId: "email_ctr_delivered",
    group: "email",
    abbr: "CTR",
    name: {
      pl: "Współczynnik kliknięć",
      en: "Click-Through Rate",
    },
    expansion: {
      pl: "Click-Through Rate: odsetek dostarczonych wiadomości, w których odbiorca kliknął co najmniej jeden link",
      en: "Click-Through Rate: share of delivered emails in which the recipient clicked at least one link",
    },
    formula: {
      pl: "unikalne kliknięcia / dostarczone × 100%",
      en: "unique clicks / delivered × 100%",
    },
    interpretation: {
      pl: "Po wprowadzeniu MPP to podstawowa i najbardziej wiarygodna miara realnego zaangażowania: pokazuje, ilu odbiorców przeszło do treści, oferty lub rejestracji. Czytaj go razem z CTOR (czy problemem jest zasięg otwarć, czy treść) i z konwersją. Pułapki: automatyczne kliknięcia skanerów bezpieczeństwa (częste w skrzynkach firmowych B2B i instytucjach), wliczanie kliknięć w link wypisu oraz mylenie CTR liczonego od dostarczonych z „click rate” liczonym od otwarć (to CTOR).",
      en: "After MPP, this is the primary and most reliable measure of real engagement: how many recipients went through to content, an offer or a registration. Read it together with CTOR (reach of opens vs content quality) and conversion. Pitfalls: automated clicks by security scanners (common in B2B/institutional inboxes), counting unsubscribe-link clicks, and confusing CTR on delivered with 'click rate' on opens (that is CTOR).",
    },
    levers: {
      pl: "Daj w każdym wydaniu jedno główne wezwanie do działania i umieść je wysoko, z opisowym linkiem zamiast ogólnego „czytaj więcej”. Dopasuj treść do zainteresowań segmentów (tematy, typ odbiorcy: instytucja, czytelnik indywidualny). Testuj układ: krótsze zajawki z linkiem do pełnej analizy zamiast całych tekstów w e-mailu, a w listach B2B filtruj kliknięcia botów.",
      en: "Give each issue one main call to action and place it high, with a descriptive link instead of a generic 'read more'. Match the content to segment interests (topics, audience type: institution, individual reader). Test the layout: shorter teasers linking to the full analysis instead of whole articles in the e-mail, and filter out bot clicks on B2B lists.",
    },
    caveats: [
      {
        text: {
          pl: "GetResponse (dane 2023) podaje dla Polski CTR 5,38%, a MailerLite (2025) 1,46%. Rozbieżność wynika z innej próby i metodologii, dlatego jako bazę przyjęto medianę MailerLite.",
          en: "GetResponse (2023 data) gives a CTR of 5.38% for Poland, while MailerLite (2025) gives 1.46%. The discrepancy stems from a different sample and methodology, so the MailerLite median was taken as the baseline.",
        },
        sourceIds: ["src_getresponse_2024", "src_mailerlite_2025"],
      },
      {
        text: {
          pl: "W listach instytucjonalnych i B2B włącz filtrowanie kliknięć botów (np. kliknięcia w ciągu kilku sekund od doręczenia).",
          en: "For institutional and B2B lists, enable bot-click filtering (e.g. clicks within a few seconds of delivery).",
        },
      },
      {
        text: {
          pl: "Kontekst „apele zbiórkowe” dotyczy wysyłek z prośbą o wpłatę lub zakup. Nie porównuj go z CTR newslettera treściowego.",
          en: "The 'fundraising appeals' context concerns sends asking for a donation or a purchase. Do not compare it with the CTR of a content newsletter.",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "click_through_rate.media_publishers",
        label: {
          pl: "Newslettery wydawców mediowych (B2B + B2C)",
          en: "Newsletters of media publishers (B2B + B2C)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (P25 0,6%, P50 1,16%, P75 2,0%); próg krytyczny = połowa P25 (heurystyka). Okres: na wysyłkę (mediana wydawcy, H1 2026).",
          en: "source quartiles (P25 0.6%, P50 1.16%, P75 2.0%); critical threshold = half of P25 (heuristic). Period: per send (publisher median, H1 2026).",
        },
        sourceIds: ["src_omeda_h1_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.3,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.3,
            max: 0.6,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.6,
            max: 1.16,
            note: {
              pl: "P25–P50; mediana B2B media 1,01%",
              en: "P25–P50; B2B media median 1.01%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 1.16,
            max: 2,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 2,
            max: null,
            note: {
              pl: "powyżej P75; mediana B2C 2,86%",
              en: "above P75; B2C median 2.86%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "click_through_rate.poland_all",
        label: {
          pl: "Polska, wszystkie branże (dane ESP)",
          en: "Poland, all industries (ESP data)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "mediana ± heurystyka: mediana PL 1,46% i globalna 2,09% (MailerLite 2025); GetResponse PL 5,38% (dane 2023, inna próba) jako górny punkt odniesienia. Okres: na kampanię.",
          en: "median ± heuristic: PL median 1.46% and global 2.09% (MailerLite 2025); GetResponse PL 5.38% (2023 data, a different sample) as an upper reference point. Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_getresponse_2024"],
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
            max: 2,
            note: {
              pl: "obejmuje medianę PL",
              en: "includes the PL median",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 2,
            max: 3.5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 3.5,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "click_through_rate.nonprofit_think_tank",
        label: {
          pl: "Non-profit / think tank: newslettery i komunikacja ogólna",
          en: "Non-profit / think tank: newsletters and general communication",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "zakres źródeł: MailerLite non-profit 2,90% (2025), Mailchimp 3,27% (dane do XII 2023; najstarsze źródło, najniższa waga), GetResponse 6,70% (dane 2023) + heurystyka. Okres: na kampanię.",
          en: "range of sources: MailerLite non-profit 2.90% (2025), Mailchimp 3.27% (data up to Dec 2023; the oldest source, lowest weight), GetResponse 6.70% (2023 data) + heuristic. Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_mailchimp_2023", "src_getresponse_2024"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.8,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.8,
            max: 1.5,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.5,
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
        id: "click_through_rate.b2b_education_finance",
        label: {
          pl: "B2B, edukacja wyższa, doradztwo, biznes i finanse",
          en: "B2B, higher education, consulting, business and finance",
        },
        segments: ["b2b_institution"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "mediana ± heurystyka: MailerLite 2025 (biznes i finanse 2,37%, konsulting 2,41%, szkolnictwo wyższe 2,15%); Mailchimp (biznes+finanse 2,78%, edukacja 3,02%; dane do XII 2023 – najstarsze źródło, najniższa waga); GetResponse (edukacja 3,17%). Okres: na kampanię.",
          en: "median ± heuristic: MailerLite 2025 (business and finance 2.37%, consulting 2.41%, higher education 2.15%); Mailchimp (business+finance 2.78%, education 3.02%; data up to Dec 2023 – the oldest source, lowest weight); GetResponse (education 3.17%). Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_mailchimp_2023", "src_getresponse_2024"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.7,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.7,
            max: 1.3,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1.3,
            max: 2.4,
            basis: "E",
          },
          {
            tier: "good",
            min: 2.4,
            max: 3.5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 3.5,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "click_through_rate.fundraising_appeals",
        label: {
          pl: "Apele zbiórkowe / sprzedażowe w non-profit (fundraising)",
          en: "Fundraising / sales appeals in non-profits",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "wartość typowa M+R (metodologia M+R: mediany per wskaźnik; CTR fundraising 0,59%, advocacy 2,3%) ± heurystyka. Okres: na wysyłkę (wartość typowa M+R za 2025).",
          en: "M+R typical value (M+R methodology: medians per indicator; fundraising CTR 0.59%, advocacy 2.3%) ± heuristic. Period: per send (M+R typical value for 2025).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.2,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.2,
            max: 0.4,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.4,
            max: 0.75,
            note: {
              pl: "obejmuje wartość typową 0,59%",
              en: "includes the typical value of 0.59%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 0.75,
            max: 1.2,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 1.2,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "click_through_rate.poland_all",
      newsletter: "click_through_rate.media_publishers",
      b2b_institution: "click_through_rate.b2b_education_finance",
    },
  },
  {
    key: "click_to_open_rate",
    metricId: "email_ctr",
    group: "email",
    abbr: "CTOR",
    name: {
      pl: "Współczynnik kliknięć do otwarć",
      en: "Click-to-Open Rate",
    },
    expansion: {
      pl: "Click-to-Open Rate: odsetek otwierających, którzy kliknęli co najmniej jeden link",
      en: "Click-to-Open Rate: share of openers who clicked at least one link",
    },
    formula: {
      pl: "unikalne kliknięcia / unikalne otwarcia × 100%",
      en: "unique clicks / unique opens × 100%",
    },
    interpretation: {
      pl: "Ocenia jakość treści i wezwań do działania wśród tych, którzy e-mail otworzyli, niezależnie od tematu i dostarczalności. Niski CTOR przy dobrym OR oznacza, że temat „obiecał” więcej niż treść dowiozła albo linki są słabo wyeksponowane. Pułapki: MPP zawyża mianownik (otwarcia), więc CTOR jest zaniżony i spada wraz ze wzrostem udziału Apple Mail. Niektóre narzędzia (np. GlueLetter) nazywają CTOR „click rate”.",
      en: "Evaluates content and call-to-action quality among those who opened, independent of subject line and deliverability. Low CTOR with a good OR means the subject over-promised or links are poorly placed. Pitfalls: MPP inflates the denominator (opens), so CTOR is understated and falls as Apple Mail share grows; some tools (e.g., GlueLetter) call CTOR 'click rate'.",
    },
    levers: {
      pl: "Spełniaj obietnicę tematu w pierwszym akapicie i prowadź do jednego, wyraźnego linku. Ogranicz liczbę równorzędnych linków, testuj przyciski zamiast linków w tekście i sprawdzaj czytelność na telefonie. Oceniaj zmiany przy podobnym udziale klientów pocztowych, bo rosnący udział Apple Mail obniża wynik bez zmiany zachowań.",
      en: "Deliver on the subject line's promise in the first paragraph and lead to a single, clear link. Limit the number of equally weighted links, test buttons instead of in-text links and check readability on a phone. Assess changes at a similar mail-client mix, because a rising Apple Mail share lowers the result without any change in behaviour.",
    },
    caveats: [
      {
        text: {
          pl: "Przy rosnącym udziale Apple Mail CTOR spada mechanicznie. Porównuj okresy tylko przy podobnym udziale klientów pocztowych.",
          en: "As the share of Apple Mail rises, CTOR falls mechanically. Compare periods only when the share of mail clients is similar.",
        },
        sourceIds: ["src_litmus_market_share_2026"],
      },
      {
        text: {
          pl: "Mediany Omeda dla mediów (3,8%) są wyraźnie niższe od median ESP (6–13%). Hipoteza (żadne źródło jej nie podaje): to efekt innej próby (duzi wydawcy, częste wysyłki), a nie błąd.",
          en: "The Omeda medians for media (3.8%) are clearly lower than the ESP medians (6–13%). Hypothesis (no source states it): this is the effect of a different sample (large publishers, frequent sends), not an error.",
        },
        sourceIds: ["src_omeda_h1_2026"],
      },
      {
        text: {
          pl: "MailerLite: przez MPP realny CTOR jest wyższy od raportowanego, bo zawyżone otwarcia trafiają do mianownika.",
          en: "MailerLite: because of MPP the real CTOR is higher than reported, since inflated opens enter the denominator.",
        },
        sourceIds: ["src_mailerlite_2025"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "click_to_open_rate.media_publishers",
        label: {
          pl: "Newslettery wydawców mediowych (B2B + B2C)",
          en: "Newsletters of media publishers (B2B + B2C)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (P25 2,3%, P50 3,8%, P75 5,8%); próg krytyczny = połowa P25 (heurystyka). Okres: na wysyłkę (mediana wydawcy, H1 2026).",
          en: "source quartiles (P25 2.3%, P50 3.8%, P75 5.8%); critical threshold = half of P25 (heuristic). Period: per send (publisher median, H1 2026).",
        },
        sourceIds: ["src_omeda_h1_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 1.15,
            basis: "E",
          },
          {
            tier: "weak",
            min: 1.15,
            max: 2.3,
            basis: "B",
          },
          {
            tier: "normal",
            min: 2.3,
            max: 3.8,
            note: {
              pl: "mediana B2B media 3,4%",
              en: "B2B media median 3.4%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 3.8,
            max: 5.8,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 5.8,
            max: null,
            note: {
              pl: "mediana B2C 7,6%",
              en: "B2C median 7.6%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "click_to_open_rate.content_creators",
        label: {
          pl: "Newslettery treściowe (kreatorzy, niezależni wydawcy; GlueLetter: kliknięcia/otwierający, boty wykluczone)",
          en: "Content newsletters (creators, independent publishers; GlueLetter: clicks/openers, bots excluded)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "kwartyle źródła (P25 4,45%, P50 7,65%, P75 12,67%, P90 19,60%); próg krytyczny = połowa P25. Okres: na wysyłkę (Q1 2025).",
          en: "source quartiles (P25 4.45%, P50 7.65%, P75 12.67%, P90 19.60%); critical threshold = half of P25. Period: per send (Q1 2025).",
        },
        sourceIds: ["src_glueletter_click_q1_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2.2,
            basis: "E",
          },
          {
            tier: "weak",
            min: 2.2,
            max: 4.45,
            basis: "B",
          },
          {
            tier: "normal",
            min: 4.45,
            max: 7.65,
            basis: "B",
          },
          {
            tier: "good",
            min: 7.65,
            max: 12.67,
            basis: "B",
          },
          {
            tier: "optimal",
            min: 12.67,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "click_to_open_rate.poland_general",
        label: {
          pl: "Polska i rynek ogólny (non-profit, edukacja, B2B, wydawnictwa)",
          en: "Poland and the general market (non-profit, education, B2B, publishing)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "mediana ± heurystyka: MailerLite 2025 (ogółem 6,81%, PL 6,63%, media 12,92%, wydawnictwa 9,12%, non-profit 8,24%, szkolnictwo wyższe 9,15%, biznes i finanse 7,96%); GetResponse (ogółem 8,62%, PL 14,12%, publishing 14,43%; dane 2023). Okres: na kampanię.",
          en: "median ± heuristic: MailerLite 2025 (overall 6.81%, PL 6.63%, media 12.92%, publishing 9.12%, non-profit 8.24%, higher education 9.15%, business and finance 7.96%); GetResponse (overall 8.62%, PL 14.12%, publishing 14.43%; 2023 data). Period: per campaign.",
        },
        sourceIds: ["src_mailerlite_2025", "src_getresponse_2024"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 2.5,
            basis: "E",
          },
          {
            tier: "weak",
            min: 2.5,
            max: 4.5,
            basis: "E",
          },
          {
            tier: "normal",
            min: 4.5,
            max: 8,
            note: {
              pl: "obejmuje mediany PL i ogólną",
              en: "includes the PL and overall medians",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 8,
            max: 12,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 12,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "click_to_open_rate.poland_general",
      newsletter: "click_to_open_rate.media_publishers",
    },
  },
  {
    key: "unsubscribe_rate",
    metricId: "email_unsubscribe_rate",
    group: "email",
    abbr: "UR",
    name: {
      pl: "Wskaźnik wypisań",
      en: "Unsubscribe Rate",
    },
    expansion: {
      pl: "Unsubscribe Rate: odsetek dostarczonych wiadomości, po których odbiorca wypisał się z listy",
      en: "Unsubscribe Rate: share of delivered emails that led the recipient to unsubscribe",
    },
    formula: {
      pl: "wypisania / dostarczone × 100% (na wysyłkę); wariant roczny: wypisani w roku / lista na początku roku × 100%",
      en: "unsubscribes / delivered × 100% (per send); annual variant: unsubscribed in the year / list at the start of the year × 100%",
    },
    interpretation: {
      pl: "Mierzy dopasowanie częstotliwości i treści do oczekiwań odbiorców. Niewielka liczba wypisań jest zdrowa, bo oczyszcza listę z nieaktywnych. Kłopotem jest trend wzrostowy lub skok po konkretnej wysyłce. Pułapki: bardzo niski wskaźnik może znaczyć, że wypisanie jest trudne i ludzie klikają „spam”, co jest dużo groźniejsze (patrz spam_complaint_rate). Od 2024 r. Gmail i Yahoo wymagają jednoklikowego wypisania; ułatwienie wypisu prawdopodobnie podniosło wypisania (MailerLite: „likely”), ale chroni reputację nadawcy.",
      en: "Measures fit of cadence and content to subscriber expectations; a small number of unsubscribes is healthy list hygiene, a rising trend or a spike after a specific send is the problem. Pitfalls: a very low rate may mean opting out is hard and people hit 'spam' instead, which is far worse (see spam_complaint_rate); since 2024 Gmail/Yahoo have required one-click unsubscribe; easier opt-out has likely raised unsubscribe rates (MailerLite: 'likely') but protects sender reputation.",
    },
    levers: {
      pl: "Daj wybór zamiast wypisu: centrum preferencji z tematami i częstotliwością (np. przegląd tygodnia zamiast każdego wydania). Dotrzymuj obietnicy złożonej przy zapisie co do treści i rytmu, a nowe osoby wprowadzaj sekwencją powitalną. Wypis zawsze jednym kliknięciem i realizowany od razu; wypisy z automatyzacji raportuj osobno od kampanii.",
      en: "Offer a choice instead of an unsubscribe: a preference centre with topics and frequency (e.g. a weekly digest instead of every issue). Keep the promise made at sign-up about content and rhythm, and introduce newcomers with a welcome sequence. Always make unsubscribing one click and immediate; report automation unsubscribes separately from campaigns.",
    },
    caveats: [
      {
        text: {
          pl: "MailerLite odnotował wzrost mediany wypisań z 0,08% (2024) do 0,22% (2025) i wiąże go prawdopodobnie („likely”) ze zmianami w Gmailu ułatwiającymi wypis z poziomu skrzynki. Nie traktuj tego jako pogorszenia jakości treści.",
          en: "MailerLite recorded a rise in the median unsubscribe rate from 0.08% (2024) to 0.22% (2025) and links it, probably ('likely'), to Gmail changes that make unsubscribing from the inbox easier. Do not treat this as a decline in content quality.",
        },
        sourceIds: ["src_mailerlite_2025"],
      },
      {
        text: {
          pl: "Wypisy z e-maili automatycznych są naturalnie wyższe niż z kampanii, dlatego raportuj je osobno.",
          en: "Unsubscribes from automated e-mails are naturally higher than from campaigns, so report them separately.",
        },
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "unsubscribe_rate.media_publishers",
        label: {
          pl: "Newslettery wydawców mediowych (B2B + B2C)",
          en: "Newsletters of media publishers (B2B + B2C)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "kwartyle źródła (P25 0,05%, P50 0,09%, P75 0,13%); próg krytyczny ≈ 2× mediana (0,18%), zaokrąglone do 0,2% (heurystyka). Okres: na wysyłkę (mediana wydawcy, H1 2026).",
          en: "source quartiles (P25 0.05%, P50 0.09%, P75 0.13%); critical threshold ≈ 2× the median (0.18%), rounded to 0.2% (heuristic). Period: per send (publisher median, H1 2026).",
        },
        sourceIds: ["src_omeda_h1_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.05,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0.05,
            max: 0.09,
            note: {
              pl: "P25–P50",
              en: "P25 to median (P50)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.09,
            max: 0.13,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0.13,
            max: 0.2,
            note: {
              pl: "powyżej P75",
              en: "above P75",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 0.2,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "unsubscribe_rate.poland_campaigns",
        label: {
          pl: "Polska i rynek ogólny, kampanie (newsletter, non-profit, B2B, edukacja)",
          en: "Poland and the general market, campaigns (newsletter, non-profit, B2B, education)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "mediana ± heurystyka: MailerLite 2025 (ogółem 0,22%, PL 0,17%, media 0,10%, wydawnictwa 0,20%, non-profit 0,19%); GetResponse (ogółem 0,15%, PL 0,16%, newsletter 0,12%; dane 2023); Mailchimp 0,22% (dane do XII 2023; najstarsze źródło, najniższa waga); Validity: 0,3% to poziom, z którym nadawcy „bywają komfortowi”, choć eroduje listę. Okres: na kampanię.",
          en: "median ± heuristic: MailerLite 2025 (overall 0.22%, PL 0.17%, media 0.10%, publishing 0.20%, non-profit 0.19%); GetResponse (overall 0.15%, PL 0.16%, newsletter 0.12%; 2023 data); Mailchimp 0.22% (data up to Dec 2023; the oldest source, lowest weight); Validity: 0.3% is a level senders 'tend to be comfortable' with, although it erodes the list. Period: per campaign.",
        },
        sourceIds: [
          "src_mailerlite_2025",
          "src_getresponse_2024",
          "src_mailchimp_2023",
          "src_validity_2026",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.1,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.1,
            max: 0.17,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.17,
            max: 0.25,
            note: {
              pl: "obejmuje mediany PL i globalną",
              en: "includes the PL and global medians",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.25,
            max: 0.4,
            basis: "E",
          },
          {
            tier: "critical",
            min: 0.4,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "unsubscribe_rate.automated",
        label: {
          pl: "E-maile automatyczne (powitalne, porzucony koszyk, autorespondery)",
          en: "Automated e-mails (welcome, abandoned cart, autoresponders)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "średnie źródeł ± heurystyka: GetResponse powitalne 0,94%, autoresponder 0,37% (dane 2023); Omnisend automatyzacje 0,59%, powitalne 0,87%, porzucony koszyk 0,45% (dane 2025). Okres: na wysyłkę.",
          en: "source averages ± heuristic: GetResponse welcome 0.94%, autoresponder 0.37% (2023 data); Omnisend automations 0.59%, welcome 0.87%, abandoned cart 0.45% (2025 data). Period: per send.",
        },
        sourceIds: ["src_getresponse_2024", "src_omnisend_benchmarks_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.35,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.35,
            max: 0.6,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.6,
            max: 0.95,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.95,
            max: 1.5,
            basis: "E",
          },
          {
            tier: "critical",
            min: 1.5,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "unsubscribe_rate.nonprofit_annual",
        label: {
          pl: "Non-profit / think tank, odpływ roczny przez wypisania",
          en: "Non-profit / think tank, annual list attrition through unsubscribes",
        },
        segments: ["newsletter"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "wartość typowa M+R 12% (2025; metodologia: mediany per wskaźnik), sektor z najwyższym odpływem 21% (Disaster/International Aid) ± heurystyka. Okres: rocznie (% listy z początku roku).",
          en: "M+R typical value of 12% (2025; methodology: medians per indicator), the sector with the highest attrition 21% (Disaster/International Aid) ± heuristic. Period: annually (% of the list at the start of the year).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
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
            max: 9,
            basis: "E",
          },
          {
            tier: "normal",
            min: 9,
            max: 13,
            note: {
              pl: "obejmuje wartość typową 12%",
              en: "includes the typical value of 12%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 13,
            max: 20,
            basis: "E",
          },
          {
            tier: "critical",
            min: 20,
            max: null,
            note: {
              pl: "poziom sektora pomocy humanitarnej, który jako jedyny notował spadek listy",
              en: "the level of the humanitarian aid sector, the only one that recorded a decline in its list",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "unsubscribe_rate.poland_campaigns",
      newsletter: "unsubscribe_rate.media_publishers",
    },
  },
  {
    key: "hard_bounce_rate",
    metricId: "email_hard_bounce_rate",
    group: "email",
    abbr: "HBR",
    name: {
      pl: "Wskaźnik twardych odbić",
      en: "Hard Bounce Rate",
    },
    expansion: {
      pl: "Hard Bounce Rate: odsetek wiadomości trwale odrzuconych (adres nie istnieje, domena nieprawidłowa)",
      en: "Hard Bounce Rate: share of emails permanently rejected (address does not exist, invalid domain)",
    },
    formula: {
      pl: "twarde odbicia / wysłane × 100%",
      en: "hard bounces / sent × 100%",
    },
    interpretation: {
      pl: "Pokazuje jakość bazy adresowej i procesu zapisu. Dostawcy skrzynek traktują wysyłkę na nieistniejące adresy jako sygnał złych praktyk, co obniża reputację i trafianie do skrzynki odbiorczej. Każdy twardy bounce trzeba natychmiast wyciszyć (suppress). Pułapki: skoki po imporcie starych kontaktów z CRM lub z wydarzeń. Konta nieaktywne są zamykane (Yahoo po 12, Gmail po 24 miesiącach), więc listy uśpione „gniją” szybciej.",
      en: "Reflects address-data quality and the sign-up process; mailbox providers treat sending to non-existent addresses as a bad-practice signal that lowers reputation and inbox placement. Every hard bounce must be suppressed immediately. Pitfalls: spikes after importing old CRM/event contacts; inactive accounts get closed (Yahoo after 12, Gmail after 24 months), so dormant lists decay faster.",
    },
    levers: {
      pl: "Zbieraj adresy wyłącznie z podwójnym potwierdzeniem i walidacją składni oraz domeny w formularzu. Usuwaj twarde odbicia od razu po pierwszym zdarzeniu i nie importuj starych list bez weryfikacji. Przed wysyłką do kontaktów długo nieaktywnych sprawdź adresy narzędziem walidującym albo wyślij kampanię reaktywacyjną do małej próby.",
      en: "Collect addresses only with double confirmation and with syntax and domain validation in the form. Remove hard bounces immediately after the first event and never import old lists without verification. Before sending to long-inactive contacts, check the addresses with a validation tool or send a re-engagement campaign to a small sample.",
    },
    caveats: [
      {
        text: {
          pl: "GetResponse podaje bounce bez definicji (nie wiadomo, czy obejmuje miękkie odbicia): średnio 2,33%, dla Polski 1,13% (dane 2023). Nie porównuj go 1:1 z twardymi odbiciami.",
          en: "GetResponse gives a bounce rate without a definition (it is unclear whether it includes soft bounces): 2.33% on average, 1.13% for Poland (2023 data). Do not compare it 1:1 with hard bounces.",
        },
        sourceIds: ["src_getresponse_2024"],
      },
      {
        text: {
          pl: "ZeroBounce: co najmniej 23% adresów na liście degraduje się w ciągu roku (dane 2025; FAQ tej samej strony podaje 25,74%). Przed wysyłką do kontaktów nieaktywnych dłużej niż 12 miesięcy zweryfikuj adresy.",
          en: "ZeroBounce: at least 23% of the addresses on a list decay within a year (2025 data; the FAQ on the same page gives 25.74%). Before sending to contacts inactive for more than 12 months, verify the addresses.",
        },
        sourceIds: ["src_zerobounce_decay_2026"],
      },
    ],
    direction: "lower",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "hard_bounce_rate.opt_in_sends",
        label: {
          pl: "Każda wysyłka marketingowa do listy z opt-in (newsletter, kampanie)",
          en: "Any marketing send to an opt-in list (newsletter, campaigns)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "progi dostawcy + średnia rynkowa + heurystyka: AWS SES zaleca <2%, ≥5% = przegląd konta, ≥10% = możliwe wstrzymanie wysyłki (AWS wlicza do bounce rate tylko twarde odbicia do niezweryfikowanych domen, z okna „representative volume”); średni odsetek nieistniejących adresów (unknown users) w 2025 r. wg Validity 1,46%; Validity: 0,1% twardych odbić to poziom „komfortowy”; DeBounce (2026-02-04, bez źródła danych): „Hard bounces should stay under 0.5-1%”, co wspiera granicę dobry/normalny przy 0,5%. Okres: na wysyłkę.",
          en: "provider thresholds + market average + heuristic: AWS SES recommends <2%, ≥5% = account review, ≥10% = sending may be paused (AWS counts only hard bounces to unverified domains in the bounce rate, over a 'representative volume' window); the average share of non-existent addresses (unknown users) in 2025 according to Validity 1.46%; Validity: 0.1% hard bounces is a 'comfortable' level; DeBounce (2026-02-04, no data source): 'Hard bounces should stay under 0.5-1%', which supports the good/normal boundary at 0.5%. Period: per send.",
        },
        sourceIds: [
          "src_aws_ses_enforcement",
          "src_validity_2026",
          "src_debounce_bounce",
          "src_getresponse_2024",
          "src_zerobounce_decay_2026",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.2,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.2,
            max: 0.5,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.5,
            max: 1.5,
            note: {
              pl: "obejmuje średnią Validity 1,46%",
              en: "includes the Validity average of 1.46%",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 1.5,
            max: 2,
            basis: "E",
          },
          {
            tier: "critical",
            min: 2,
            max: null,
            note: {
              pl: "≥5% = przegląd konta w AWS SES, ≥10% = wstrzymanie",
              en: "≥5% = account review in AWS SES, ≥10% = pause",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "hard_bounce_rate.nonprofit_annual",
        label: {
          pl: "Non-profit / think tank, roczny odpływ przez odbicia",
          en: "Non-profit / think tank, annual attrition through bounces",
        },
        segments: ["newsletter"],
        measure: "share_of_base",
        unit: "percent_pt",
        window: "year",
        direction: "lower",
        method: {
          pl: "wartość typowa M+R 4% (2025; metodologia: mediany per wskaźnik), sektor z najwyższym odpływem 6% (Disaster/International Aid) ± heurystyka. Okres: rocznie (% listy z początku roku).",
          en: "M+R typical value of 4% (2025; methodology: medians per indicator), the sector with the highest attrition 6% (Disaster/International Aid) ± heuristic. Period: annually (% of the list at the start of the year).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 2,
            basis: "E",
          },
          {
            tier: "good",
            min: 2,
            max: 3,
            basis: "E",
          },
          {
            tier: "normal",
            min: 3,
            max: 5,
            note: {
              pl: "obejmuje wartość typową 4%",
              en: "includes the typical value of 4%",
            },
            basis: "E",
          },
          {
            tier: "weak",
            min: 5,
            max: 7,
            basis: "E",
          },
          {
            tier: "critical",
            min: 7,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "hard_bounce_rate.opt_in_sends",
      newsletter: "hard_bounce_rate.opt_in_sends",
    },
  },
  {
    key: "soft_bounce_rate",
    metricId: "email_soft_bounce_rate",
    group: "email",
    abbr: "SBR",
    name: {
      pl: "Wskaźnik miękkich odbić",
      en: "Soft Bounce Rate",
    },
    expansion: {
      pl: "Soft Bounce Rate: odsetek wiadomości czasowo niedoręczonych (pełna skrzynka, chwilowa blokada, ograniczanie przepustowości przez dostawcę)",
      en: "Soft Bounce Rate: share of emails temporarily undelivered (full mailbox, temporary block, provider throttling)",
    },
    formula: {
      pl: "miękkie odbicia / wysłane × 100%",
      en: "soft bounces / sent × 100%",
    },
    interpretation: {
      pl: "Sygnalizuje przejściowe problemy z doręczeniem: pełne skrzynki, przerwy serwerów, a najczęściej ograniczanie przepustowości lub czasowe blokady przy słabnącej reputacji. Pojedyncze miękkie odbicia są normalne. Groźny jest skok skupiony u jednego dostawcy (np. Outlook, WP, Onet, Interia), który zwykle oznacza problem reputacyjny, a nie jakość listy. Pułapka: adres odbijający miękko w 3–5 kolejnych wysyłkach warto traktować jak twardy bounce i wyciszyć (reguła praktyków – heurystyka bez źródła).",
      en: "Signals transient delivery issues: full mailboxes, server outages and, most often, throttling or temporary blocks as reputation weakens. Isolated soft bounces are normal; a spike concentrated at one provider (e.g., Outlook, WP, Onet, Interia) usually means a reputation problem, not list quality. Pitfall: an address soft-bouncing across 3–5 consecutive sends is worth treating as a hard bounce and suppressing (practitioner rule of thumb – a heuristic with no source).",
    },
    levers: {
      pl: "Monitoruj miękkie odbicia osobno dla każdej domeny odbiorcy, zwłaszcza polskich dostawców poczty, i reaguj na nagłe skoki. Rozkładaj duże wysyłki w czasie, żeby nie przekraczać limitów serwerów odbiorczych, i dbaj o reputację domeny nadawcy. Adresy z powtarzającymi się miękkimi odbiciami wstrzymuj po kilku kolejnych próbach.",
      en: "Monitor soft bounces separately for each recipient domain, especially Polish mailbox providers, and react to sudden spikes. Spread large sends over time so as not to exceed receiving-server limits, and look after the sender domain's reputation. Suppress addresses with repeated soft bounces after several consecutive attempts.",
    },
    caveats: [
      {
        text: {
          pl: "Brak wiarygodnych, aktualnych benchmarków pierwotnych dla miękkich odbić. Przedziały są heurystyką ekspercką. Źródło Bounceless (miękkie <2%) usunięto – martwy link (HTTP 410).",
          en: "There are no reliable, current primary benchmarks for soft bounces. The ranges are an expert heuristic. The Bounceless source (soft <2%) was removed – dead link (HTTP 410).",
        },
      },
      {
        text: {
          pl: "Analizuj soft bounce osobno dla każdej domeny odbiorcy. Polscy dostawcy (WP, Onet, Interia, o2) nie należą do grupy MAGY (Microsoft, Apple, Gmail, Yahoo). Według Validity regionalni dostawcy w Europie mają średni IPR 79,7%, czyli ok. 11,4 p.p. mniej niż MAGY; 10–25 p.p. to rozpiętość globalna dla wszystkich regionów.",
          en: "Analyse soft bounces separately for each recipient domain. Polish providers (WP, Onet, Interia, o2) do not belong to the MAGY group (Microsoft, Apple, Gmail, Yahoo). According to Validity, regional providers in Europe have an average IPR of 79.7%, i.e. approx. 11.4 pp less than MAGY; 10–25 pp is the global spread across all regions.",
        },
        sourceIds: ["src_validity_2026"],
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "soft_bounce_rate.all_sends",
        label: {
          pl: "Każda wysyłka marketingowa (rynek ogólny)",
          en: "Any marketing send (general market)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "heurystyka; DeBounce (2026-02-04, bez metodologii): soft bounce 1–3% „without immediate concern”; cel <2% i próg słaby 2–3% są ostrzejsze od DeBounce, to heurystyka ekspercka; bounce GetResponse 2,33% (dane 2023) bez definicji – nie wiadomo, czy obejmuje miękkie odbicia; brak publicznego, aktualnego benchmarku pierwotnego. Okres: na wysyłkę.",
          en: "heuristic; DeBounce (2026-02-04, no methodology): soft bounces of 1–3% are 'without immediate concern'; the <2% target and the 2–3% weak threshold are stricter than DeBounce – an expert heuristic; the GetResponse bounce rate of 2.33% (2023 data) has no definition – it is unclear whether it includes soft bounces; no public, current primary benchmark. Period: per send.",
        },
        sourceIds: ["src_debounce_bounce", "src_getresponse_2024", "src_validity_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.5,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.5,
            max: 1,
            basis: "E",
          },
          {
            tier: "normal",
            min: 1,
            max: 2,
            basis: "E",
          },
          {
            tier: "weak",
            min: 2,
            max: 3,
            basis: "E",
          },
          {
            tier: "critical",
            min: 3,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "soft_bounce_rate.all_sends",
    },
  },
  {
    key: "spam_complaint_rate",
    metricId: "email_spam_complaint_rate",
    group: "email",
    abbr: "SCR",
    name: {
      pl: "Wskaźnik zgłoszeń spamu",
      en: "Spam Complaint Rate",
    },
    expansion: {
      pl: "Spam Complaint Rate: odsetek wiadomości oznaczonych przez odbiorców przyciskiem „to spam” / „zgłoś jako spam”",
      en: "Spam Complaint Rate: share of emails that recipients marked as spam / junk",
    },
    formula: {
      pl: "zgłoszenia spamu / wiadomości dostarczone do skrzynki odbiorczej × 100% (definicja Google Postmaster Tools / Yahoo Sender Hub); w ESP: zgłoszenia z pętli zwrotnych (FBL) / dostarczone",
      en: "spam complaints / messages delivered to the inbox × 100% (Google Postmaster Tools / Yahoo Sender Hub definition); in an ESP: complaints from feedback loops (FBL) / delivered",
    },
    interpretation: {
      pl: "To najsilniejszy sygnał reputacyjny dla Gmaila, Yahoo i Microsoftu, który bezpośrednio decyduje o trafianiu do skrzynki odbiorczej lub do spamu. Od 1 lutego 2024 r. Google wymaga utrzymania wskaźnika poniżej 0,3% i zaleca poniżej 0,10%, a Yahoo wymaga poniżej 0,3%. Pułapki: panel ESP zaniża wskaźnik, bo Gmail nie przekazuje zgłoszeń per odbiorca, więc rzeczywisty poziom sprawdzaj w Google Postmaster Tools. Zgłoszenia rosną na początku roku i przy nagłych skokach wolumenu.",
      en: "The strongest reputation signal for Gmail, Yahoo and Microsoft, directly deciding inbox vs spam placement. Since 1 Feb 2024 Google requires staying below 0.3% and recommends below 0.10%; Yahoo requires below 0.3%. Pitfalls: ESP dashboards understate it because Gmail does not pass per-recipient complaints, so check the real level in Google Postmaster Tools; complaints rise at the start of the year and on sudden volume spikes.",
    },
    levers: {
      pl: "Wysyłaj tylko do osób z wyraźną zgodą i przypominaj na początku wiadomości, skąd odbiorca jest na liście. Uwierzytelnij domenę (SPF, DKIM, DMARC), dodaj wypis jednym kliknięciem i realizuj go od razu. Ogranicz wysyłki do dawno nieaktywnych kontaktów, a skargi czytaj osobno w raporcie ESP i w Google Postmaster Tools.",
      en: "Send only to people with explicit consent and remind them at the top of the message why they are on the list. Authenticate the domain (SPF, DKIM, DMARC), add one-click unsubscribe and honour it immediately. Limit sends to long-inactive contacts, and read complaints separately in the ESP report and in Google Postmaster Tools.",
    },
    caveats: [
      {
        text: {
          pl: "Validity (dane 2024): tylko 25% ankietowanych nadawców utrzymywało zgłoszenia poniżej 0,1%. Validity (2026): dawniej mówiono o 0,2–0,3%, dziś oczekiwaniem jest poniżej 0,1%.",
          en: "Validity (2024 data): only 25% of surveyed senders kept complaints below 0.1%. Validity (2026): people used to talk about 0.2–0.3%, today the expectation is below 0.1%.",
        },
        sourceIds: ["src_validity_2025", "src_validity_2026"],
      },
      {
        text: {
          pl: "Nadawcy wysyłający ponad 5000 wiadomości dziennie do Gmaila muszą mieć SPF, DKIM, DMARC i jednoklikowe wypisanie (List-Unsubscribe-Post). Yahoo wymaga realizacji wypisu w ciągu 2 dni.",
          en: "Senders sending more than 5000 messages a day to Gmail must have SPF, DKIM, DMARC and one-click unsubscribe (List-Unsubscribe-Post). Yahoo requires unsubscribes to be honoured within 2 days.",
        },
        sourceIds: ["src_google_sender_guidelines", "src_yahoo_sender_hub"],
      },
      {
        text: {
          pl: "Wartości z ESP i z Postmaster Tools różnią się o rząd wielkości. W panelu pokazuj je jako osobne wskaźniki.",
          en: "Values from an ESP and from Postmaster Tools differ by an order of magnitude. Show them as separate indicators in the dashboard.",
        },
      },
    ],
    direction: "lower",
    confidence: "high",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "spam_complaint_rate.mailbox_provider",
        label: {
          pl: "Pomiar dostawcy skrzynek (Google Postmaster Tools / Yahoo Sender Hub), wszyscy nadawcy",
          en: "Mailbox-provider measurement (Google Postmaster Tools / Yahoo Sender Hub), all senders",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "snapshot",
        direction: "lower",
        method: {
          pl: "progi regulacyjne Google i Yahoo (0,10% zalecane, 0,30% limit) + średnia rynkowa Validity 0,06% (2025; raport nie podaje, że pochodzi z Postmaster Tools) + heurystyka dla dolnych przedziałów; AWS SES: ≥0,1% = przegląd konta, ≥0,5% = wstrzymanie (AWS liczy skargi tylko z domen z pętlą FBL, a więc bez Gmaila). Okres: dziennie / kroczący 7–30 dni.",
          en: "Google and Yahoo regulatory thresholds (0.10% recommended, 0.30% limit) + Validity market average of 0.06% (2025; the report does not say it comes from Postmaster Tools) + heuristic for the lower ranges; AWS SES: ≥0.1% = account review, ≥0.5% = pause (AWS counts complaints only from domains with an FBL loop, i.e. without Gmail). Period: daily / rolling 7–30 days.",
        },
        sourceIds: [
          "src_google_sender_guidelines",
          "src_yahoo_sender_hub",
          "src_validity_2026",
          "src_aws_ses_enforcement",
          "src_validity_2025",
        ],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.02,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.02,
            max: 0.05,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.05,
            max: 0.1,
            note: {
              pl: "obejmuje średnią Validity 0,06% (źródło pomiaru niepodane)",
              en: "includes the Validity average of 0.06% (measurement source not stated)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0.1,
            max: 0.3,
            note: {
              pl: "powyżej zalecenia Google; przegląd w AWS SES",
              en: "above the Google recommendation; review in AWS SES",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 0.3,
            max: null,
            note: {
              pl: "twardy limit Google/Yahoo; ryzyko blokad",
              en: "the hard Google/Yahoo limit; risk of blocking",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "spam_complaint_rate.esp_fbl_newsletters",
        label: {
          pl: "Raport ESP z pętli FBL: newslettery wydawców mediowych",
          en: "ESP report from FBL loops: newsletters of media publishers",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "kwartyle źródła (P25 0,001%, P50 0,002%, P75 0,004%); próg krytyczny 0,01% = wartość GetResponse dla newslettera, Publishing, Non-profits, Polski i Europy (ogółem <0,01%) (heurystyka). Okres: na wysyłkę (mediana wydawcy, H1 2026).",
          en: "source quartiles (P25 0.001%, P50 0.002%, P75 0.004%); critical threshold 0.01% = the GetResponse value for newsletters, Publishing, Non-profits, Poland and Europe (overall <0.01%) (heuristic). Period: per send (publisher median, H1 2026).",
        },
        sourceIds: ["src_omeda_h1_2026", "src_getresponse_2024"],
        bands: [
          {
            tier: "optimal",
            min: null,
            max: 0.001,
            note: {
              pl: "poniżej P25",
              en: "below P25",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 0.001,
            max: 0.002,
            note: {
              pl: "P25–P50",
              en: "P25 to median (P50)",
            },
            basis: "B",
          },
          {
            tier: "normal",
            min: 0.002,
            max: 0.004,
            note: {
              pl: "P50–P75",
              en: "median (P50) to P75",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0.004,
            max: 0.01,
            note: {
              pl: "powyżej P75",
              en: "above P75",
            },
            basis: "B",
          },
          {
            tier: "critical",
            min: 0.01,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "spam_complaint_rate.esp_fbl_newsletters",
      newsletter: "spam_complaint_rate.esp_fbl_newsletters",
    },
  },
  {
    key: "list_growth_rate",
    metricId: "newsletter_list_growth_rate",
    group: "email",
    abbr: "LGR",
    name: {
      pl: "Tempo wzrostu listy (netto)",
      en: "List Growth Rate (net)",
    },
    expansion: {
      pl: "List Growth Rate: procentowa zmiana liczby aktywnych, potwierdzonych subskrybentów w okresie po odjęciu odpływu",
      en: "List Growth Rate: percentage change in active, confirmed subscribers over a period after subtracting attrition",
    },
    formula: {
      pl: "(nowe potwierdzone zapisy − wypisy − adresy usunięte po odbiciach i skargach) / aktywni subskrybenci na początku okresu × 100%",
      en: "(new confirmed sign-ups − unsubscribes − addresses removed after bounces and complaints) / active subscribers at the start of the period × 100%",
    },
    interpretation: {
      pl: "Pokazuje, czy pozyskiwanie subskrybentów nadąża za naturalnym odpływem. Organizacje non-profit tracą rocznie ok. 16% listy (12% wypisów i 4% odbić, M+R), a ZeroBounce szacuje degradację adresów na co najmniej 23% rocznie (FAQ tej samej strony: 25,74%). Czytaj go razem z jakością nowych zapisów (CTR kohort, potwierdzenia DOI). Pułapki: liczenie zapisów brutto bez odpływu, doliczanie kontaktów importowanych bez zgody marketingowej oraz porównywanie młodej listy, która rośnie naturalnie szybko, z dojrzałymi organizacjami.",
      en: "Shows whether acquisition keeps pace with natural attrition: nonprofits lose ~16% of the list per year (12% unsubscribes + 4% bounces, M+R) and ZeroBounce estimates address decay at ≥23% per year (the same page's FAQ: 25.74%). Read together with the quality of new sign-ups (cohort CTR, DOI confirmations). Pitfalls: counting gross sign-ups without attrition, adding imported contacts without marketing consent, and comparing a young (naturally fast-growing) list with mature organisations.",
    },
    levers: {
      pl: "Dodaj formularze zapisu w miejscach intencji: pod analizami, przy raportach do pobrania, przy rejestracji na wydarzenia i w profilu konta. Promuj newsletter na wydarzeniach i we współpracach partnerskich, z jasną obietnicą treści i rytmu. Równolegle ograniczaj odpływ: higiena listy, wypis z wyborem częstotliwości, kampanie reaktywacyjne; licz wyłącznie kontakty z ważną zgodą.",
      en: "Add sign-up forms at points of intent: below analysis, next to downloadable reports, at event registration and in the account profile. Promote the newsletter at events and in partnerships, with a clear promise of content and rhythm. At the same time limit attrition: list hygiene, unsubscribe with a frequency choice, re-engagement campaigns; count only contacts with valid consent.",
    },
    caveats: [
      {
        text: {
          pl: "Dane M+R dotyczą amerykańskich organizacji non-profit. Brak publicznych polskich benchmarków wzrostu listy.",
          en: "The M+R data concern US non-profit organisations. There are no public Polish list-growth benchmarks.",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
      },
      {
        text: {
          pl: "Kontekst młodej listy to heurystyka bez benchmarku platform newsletterowych.",
          en: "The young-list context is a heuristic with no newsletter-platform benchmark.",
        },
      },
      {
        text: {
          pl: "Do wzrostu wliczaj wyłącznie kontakty z ważną zgodą marketingową (RODO, prawo komunikacji elektronicznej).",
          en: "Count only contacts with valid marketing consent towards growth (GDPR, the Electronic Communications Law).",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "list_growth_rate.mature_nonprofit_annual",
        label: {
          pl: "Dojrzałe organizacje non-profit / think tanki (dane USA)",
          en: "Mature non-profits / think tanks (US data)",
        },
        segments: ["newsletter"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "wartość typowa M+R (mediana lub średnia) ± heurystyka: wzrost netto 5% w 2025 r. (4% i 9% w dwóch poprzednich latach; M+R nie przypisuje lat); media publiczne 12% jako próg optymalny. Okres: rocznie.",
          en: "M+R typical value (median or average) ± heuristic: net growth of 5% in 2025 (4% and 9% in the two previous years; M+R does not assign the years); public media 12% as the optimal threshold. Period: annually.",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            note: {
              pl: "lista się kurczy",
              en: "the list is contracting",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 0,
            max: 3,
            basis: "E",
          },
          {
            tier: "normal",
            min: 3,
            max: 7,
            note: {
              pl: "obejmuje wartość typową 5%",
              en: "includes the typical value of 5%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 7,
            max: 12,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 12,
            max: null,
            note: {
              pl: "poziom mediów publicznych",
              en: "the level of public media",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "list_growth_rate.mature_nonprofit_monthly",
        label: {
          pl: "Dojrzałe organizacje non-profit / think tanki, ujęcie miesięczne",
          en: "Mature non-profits / think tanks, monthly view",
        },
        segments: ["newsletter"],
        measure: "change_mom_cmgr",
        unit: "percent_pt",
        window: "month",
        direction: "higher",
        method: {
          pl: "przeliczenie geometryczne progów rocznych ((1+r)^(1/12) − 1): 3% → 0,25%, 7% → 0,57%, 12% → 0,95%. Okres: miesięcznie.",
          en: "geometric conversion of the annual thresholds ((1+r)^(1/12) − 1): 3% → 0.25%, 7% → 0.57%, 12% → 0.95%. Period: monthly.",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0,
            basis: "B",
          },
          {
            tier: "weak",
            min: 0,
            max: 0.25,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.25,
            max: 0.57,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.57,
            max: 0.95,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 0.95,
            max: null,
            basis: "B",
          },
        ],
      },
      {
        id: "list_growth_rate.young_list",
        label: {
          pl: "Młoda lista w fazie budowy (pierwsze 24 miesiące)",
          en: "Young list in the build-up phase (first 24 months)",
        },
        segments: ["newsletter"],
        measure: "change_yoy",
        unit: "percent_pt",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka: pozyskanie musi wyraźnie przewyższać naturalny odpływ (M+R ok. 16% rocznie, ZeroBounce ≥23% degradacji adresów rocznie). Okres: rocznie.",
          en: "heuristic: acquisition must clearly exceed natural attrition (M+R approx. 16% a year, ZeroBounce ≥23% of addresses decaying per year). Period: annually.",
        },
        sourceIds: ["src_mr_benchmarks_2026", "src_zerobounce_decay_2026"],
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
            max: 25,
            basis: "E",
          },
          {
            tier: "good",
            min: 25,
            max: 50,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 50,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "list_growth_rate.mature_nonprofit_monthly",
      newsletter: "list_growth_rate.mature_nonprofit_monthly",
    },
  },
  {
    key: "double_opt_in_confirmation_rate",
    metricId: "doi_confirmation_rate",
    group: "email",
    abbr: "DOI CR",
    name: {
      pl: "Wskaźnik potwierdzeń podwójnej zgody",
      en: "Double Opt-In Confirmation Rate",
    },
    expansion: {
      pl: "Double Opt-In Confirmation Rate: odsetek zapisów potwierdzonych kliknięciem w link aktywacyjny (podwójna zgoda)",
      en: "Double Opt-In Confirmation Rate: share of sign-ups confirmed by clicking the activation link",
    },
    formula: {
      pl: "potwierdzone zapisy (w oknie 7 dni) / wszystkie zapisy wymagające potwierdzenia × 100%",
      en: "confirmed sign-ups (within a 7-day window) / all sign-ups requiring confirmation × 100%",
    },
    interpretation: {
      pl: "Pokazuje, ile zapisów z formularzy staje się realnymi subskrybentami. Niski poziom zwykle oznacza, że e-mail potwierdzający trafia do spamu lub zakładki „Oferty”, przychodzi z opóźnieniem albo ma niejasny komunikat. Podwójna zgoda obniża konwersję formularza, ale podnosi jakość listy: w danych GetResponse listy DOI miały OR 35,72% wobec 27,36% i CTR 4,19% wobec 2,36%. Ułatwia też wykazanie zgody (art. 7 ust. 1 RODO). Validity tłumaczy najwyższy w raporcie IPR Niemiec (97,5%) m.in. „widespread use of double opt-in”. Pułapki: skanery linków w skrzynkach firmowych potrafią automatycznie „potwierdzić” zapis, co zawyża wskaźnik, dlatego stosuj ochronę przed kliknięciami botów.",
      en: "Shows how many form sign-ups become real subscribers. A low level usually means the confirmation email lands in spam/promotions, arrives late or is unclear. DOI lowers form conversion but raises list quality (GetResponse data: DOI lists 35.72% OR vs 27.36% and CTR 4.19% vs 2.36%) and helps demonstrate consent (GDPR Art. 7(1)); Validity attributes Germany's top inbox placement (97.5%) partly to the 'widespread use of double opt-in'. Pitfalls: corporate link scanners can auto-'confirm' sign-ups and inflate the rate, so use bot-click protection.",
    },
    levers: {
      pl: "Wysyłaj e-mail potwierdzający natychmiast, z jasnym tematem i jednym przyciskiem, od rozpoznawalnego nadawcy. Na stronie po zapisie powiedz wprost, że trzeba potwierdzić adres, i pokaż, gdzie szukać wiadomości (zakładki, spam). Wyślij jedno przypomnienie osobom bez potwierdzenia i sprawdzaj, czy e-mail potwierdzający nie trafia do spamu u głównych dostawców poczty.",
      en: "Send the confirmation e-mail immediately, with a clear subject line and a single button, from a recognisable sender. On the post-sign-up page say plainly that the address must be confirmed and show where to look for the message (tabs, spam). Send one reminder to people who have not confirmed, and check that the confirmation e-mail does not land in spam at the main mailbox providers.",
    },
    caveats: [
      {
        text: {
          pl: "Zakresy pochodzą od dostawców narzędzi (vendor blogs), dlatego zaufanie do nich jest niskie. Własna mediana kohort po 3 miesiącach będzie lepszym punktem odniesienia.",
          en: "The ranges come from tool vendors (vendor blogs), so confidence in them is low. Your own cohort median after 3 months will be a better reference point.",
        },
        sourceIds: ["src_truelist_doi_2025"],
      },
      {
        text: {
          pl: "GetResponse (2022): konwersja odwiedzający→subskrybent 0,33% dla DOI vs 1,28% dla SOI (pojedyncza zgoda), czyli koszt DOI w wolumenie bywa duży.",
          en: "GetResponse (2022): visitor→subscriber conversion of 0.33% for DOI vs 1.28% for SOI (single opt-in), so the volume cost of DOI can be large.",
        },
        sourceIds: ["src_getresponse_doi_2024"],
      },
      {
        text: {
          pl: "AWS SES rekomenduje podwójną zgodę jako sposób ograniczania odbić i skarg.",
          en: "AWS SES recommends double opt-in as a way of reducing bounces and complaints.",
        },
        sourceIds: ["src_aws_ses_enforcement"],
      },
      {
        text: {
          pl: "Brak niezależnego badania odsetka potwierdzeń DOI.",
          en: "There is no independent study of the DOI confirmation share.",
        },
      },
      {
        text: {
          pl: "GetResponse zaznacza, że skargi na spam przy DOI były w wielu przypadkach wyższe niż przy SOI (bez liczb).",
          en: "GetResponse notes that spam complaints with DOI were in many cases higher than with SOI (no figures).",
        },
        sourceIds: ["src_getresponse_doi_2024"],
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "double_opt_in_confirmation_rate.signup_forms",
        label: {
          pl: "Formularze zapisu na newsletter (B2C + B2B)",
          en: "Newsletter sign-up forms (B2C + B2B)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "cohort_m1",
        direction: "higher",
        method: {
          pl: "heurystyka oparta na zakresach dostawców: 65–90% (Truelist z powołaniem na Nutshell), 70–90% jako „solidny” i odpływ 10–35% (Truelist, bez podanego źródła); przedział „normalny” zaczyna się od dolnej granicy typowego zakresu 65%; brak niezależnych benchmarków pierwotnych. Okres: na kohortę zapisów (okno 7 dni).",
          en: "heuristic based on vendor ranges: 65–90% (Truelist citing Nutshell), 70–90% as 'solid' and a 10–35% drop-off (Truelist, no source given); the 'normal' range starts at the lower bound of the typical 65% range; no independent primary benchmarks. Period: per sign-up cohort (7-day window).",
        },
        sourceIds: [
          "src_truelist_doi_2025",
          "src_getresponse_doi_2024",
          "src_aws_ses_enforcement",
          "src_validity_2026",
        ],
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
            basis: "E",
          },
          {
            tier: "normal",
            min: 65,
            max: 75,
            note: {
              pl: "od dolnej granicy typowego zakresu 65–90%",
              en: "from the lower bound of the typical 65–90% range",
            },
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
    ],
    defaultContextBySegment: {
      all: "double_opt_in_confirmation_rate.signup_forms",
      newsletter: "double_opt_in_confirmation_rate.signup_forms",
    },
  },
  {
    key: "welcome_email_open_rate",
    metricId: "journey_open_rate",
    group: "email",
    abbr: "Welcome OR",
    name: {
      pl: "Wskaźnik otwarć e-maila powitalnego",
      en: "Welcome Email Open Rate",
    },
    expansion: {
      pl: "Welcome Open Rate: odsetek dostarczonych e-maili powitalnych (pierwszy e-mail po zapisie), które zarejestrowano jako otwarte",
      en: "Welcome Open Rate: share of delivered welcome emails (first email after sign-up) registered as opened",
    },
    formula: {
      pl: "unikalne otwarcia e-maila powitalnego / dostarczone e-maile powitalne × 100%",
      en: "unique opens of the welcome e-mail / delivered welcome e-mails × 100%",
    },
    interpretation: {
      pl: "E-mail powitalny trafia do osoby w szczycie zainteresowania, więc powinien mieć wyraźnie wyższy OR niż zwykły newsletter: GetResponse 83,63% wobec 40,08% (średnie z danych 2023, nie mediany), Omnisend 35,53% wobec 30,41%. Niski OR powitalnego to najczęściej problem dostarczalności (spam lub zakładka „Oferty”) albo zbyt późna wysyłka. Pułapki: MPP najsilniej zawyża właśnie powitalne, bo proxy Apple pobiera piksel tuż po zapisie. Stripo pokazuje, że raportowane wartości wahają się od ok. 35% do 84% zależnie od źródła, i zaleca oceniać powitalne po CTOR, konwersji i przychodzie na odbiorcę (RPR).",
      en: "The welcome email reaches people at peak interest, so its OR should clearly exceed a regular newsletter (GetResponse 83.63% vs 40.08% – averages from 2023 data, not medians; Omnisend 35.53% vs 30.41%). A low welcome OR usually signals deliverability issues (spam/promotions tab) or a delayed send. Pitfalls: MPP inflates welcome opens the most because Apple's proxy prefetches right after sign-up; Stripo shows reported values range from ~35% to 84% depending on the source and recommends judging welcome emails by CTOR, conversion and revenue per recipient (RPR).",
    },
    levers: {
      pl: "Wysyłaj wiadomość powitalną natychmiast po zapisie lub potwierdzeniu, od tego samego nadawcy, którego odbiorca zobaczy w kolejnych wydaniach. W temacie zapowiedz konkretną wartość (obiecany raport, najlepsze analizy, najbliższe wydarzenie). Porównuj wynik z otwarciami newslettera na tym samym koncie: niski stosunek wskazuje na problem z dostarczalnością pierwszej wiadomości.",
      en: "Send the welcome message immediately after sign-up or confirmation, from the same sender the recipient will see in later issues. Announce a concrete value in the subject line (the promised report, the best analysis, the next event). Compare the result with newsletter opens on the same account: a low ratio points to a deliverability problem with the first message.",
    },
    caveats: [
      {
        text: {
          pl: "Dodatkowo monitoruj relację OR powitalnego do OR newslettera na tym samym koncie. Stosunek poniżej ok. 1,2× sugeruje problem z dostarczalnością pierwszej wiadomości (wyprowadzone ze źródeł: Omnisend 1,17×, GetResponse 2,09×).",
          en: "Also monitor the ratio of welcome OR to newsletter OR on the same account. A ratio below approx. 1.2× suggests a problem with the deliverability of the first message (derived from the sources: Omnisend 1.17×, GetResponse 2.09×).",
        },
      },
      {
        text: {
          pl: "Wysyłaj powitalny natychmiast po zapisie (lub po potwierdzeniu DOI).",
          en: "Send the welcome e-mail immediately after sign-up (or after DOI confirmation).",
        },
      },
    ],
    direction: "higher",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "welcome_email_open_rate.esp_no_mpp_correction",
        label: {
          pl: "ESP bez korekty MPP (np. GetResponse, MailerLite): listy treściowe i newsletterowe",
          en: "ESPs without MPP correction (e.g. GetResponse, MailerLite): content and newsletter lists",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia GetResponse 83,63% (dane 2023; średnia, nie mediana) ± heurystyka; średnia umieszczona w przedziale „normalny”. Okres: na wysyłkę.",
          en: "GetResponse average of 83.63% (2023 data; an average, not a median) ± heuristic; the average placed in the 'normal' range. Period: per send.",
        },
        sourceIds: [
          "src_getresponse_2024",
          "src_stripo_welcome_2026",
          "src_litmus_market_share_2026",
        ],
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
            max: 70,
            basis: "E",
          },
          {
            tier: "normal",
            min: 70,
            max: 85,
            note: {
              pl: "obejmuje średnią 83,63%",
              en: "includes the average of 83.63%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 85,
            max: 92,
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
        id: "welcome_email_open_rate.other_open_methodology",
        label: {
          pl: "Platformy z inną metodologią otwarć (Omnisend, Klaviyo; e-commerce)",
          en: "Platforms with a different open methodology (Omnisend, Klaviyo; e-commerce)",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia Omnisend 35,53% (2025) ± heurystyka; Klaviyo: „dobry” OR flowów 32,2%, top 10% 45,8%. Okres: na wysyłkę.",
          en: "Omnisend average of 35.53% (2025) ± heuristic; Klaviyo: 'good' flow OR 32.2%, top 10% 45.8%. Period: per send.",
        },
        sourceIds: ["src_omnisend_benchmarks_2026", "src_klaviyo_benchmarks_2026"],
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
            max: 28,
            basis: "E",
          },
          {
            tier: "normal",
            min: 28,
            max: 36,
            note: {
              pl: "obejmuje średnią Omnisend",
              en: "includes the Omnisend average",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 36,
            max: 45,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 45,
            max: null,
            note: {
              pl: "top 10% flowów Klaviyo",
              en: "Klaviyo flows top 10%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "welcome_email_open_rate.esp_no_mpp_correction",
      newsletter: "welcome_email_open_rate.esp_no_mpp_correction",
    },
  },
  {
    key: "welcome_email_click_rate",
    metricId: "journey_click_rate",
    group: "email",
    abbr: "Welcome CTR",
    name: {
      pl: "Współczynnik kliknięć e-maila powitalnego",
      en: "Welcome Email Click-Through Rate",
    },
    expansion: {
      pl: "Welcome Click-Through Rate: odsetek dostarczonych e-maili powitalnych z co najmniej jednym kliknięciem",
      en: "Welcome Click-Through Rate: share of delivered welcome emails with at least one click",
    },
    formula: {
      pl: "unikalne kliknięcia w e-mailu powitalnym / dostarczone e-maile powitalne × 100%",
      en: "unique clicks in the welcome e-mail / delivered welcome e-mails × 100%",
    },
    interpretation: {
      pl: "To wiarygodniejsza od OR miara skuteczności powitania: pokazuje, czy nowy subskrybent podjął pierwszy krok, np. przeczytał flagowy raport, ustawił preferencje albo zarejestrował się na wydarzenie. Pułapki: kliknięcia skanerów w skrzynkach instytucjonalnych i jeden dominujący link (np. „potwierdź”), który zawyża CTR bez wartości biznesowej.",
      en: "A more reliable measure than OR of how well onboarding works: did the new subscriber take a first step (e.g., read a flagship report, set preferences, register for an event)? Pitfalls: scanner clicks in institutional inboxes and one dominant link (e.g., 'confirm') that inflates CTR without business value.",
    },
    levers: {
      pl: "Umieść w e-mailu powitalnym jeden główny link do obiecanego materiału i drugi do najważniejszego pierwszego kroku (wybór tematów, najbliższe wydarzenie). Pokaż, czego odbiorca może się spodziewać i jak często, oraz zaproponuj ustawienie preferencji. Testuj krótką sekwencję kilku wiadomości zamiast jednego długiego e-maila.",
      en: "Put one main link to the promised material in the welcome e-mail and a second one to the most important first step (topic selection, the next event). Show what the recipient can expect and how often, and offer to set preferences. Test a short sequence of a few messages instead of one long e-mail.",
    },
    caveats: [
      {
        text: {
          pl: "Benchmarki pochodzą głównie z e-commerce. W wydawnictwie eksperckim CTR powitalnego może być wyższy, jeśli e-mail zawiera link do obiecanego materiału (lead magnet).",
          en: "The benchmarks come mainly from e-commerce. For an expert publisher, the welcome CTR may be higher if the e-mail contains a link to the promised material (lead magnet).",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "welcome_email_click_rate.general_platforms",
        label: {
          pl: "E-maile powitalne (rynek ogólny, dane platform e-mail)",
          en: "Welcome e-mails (general market, e-mail platform data)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia i top 10% Klaviyo (6,5% / 13,3%, 2026) + Omnisend 3,94% (2025) + GetResponse 16,60% (dane 2023) ± heurystyka. Okres: na wysyłkę.",
          en: "Klaviyo average and top 10% (6.5% / 13.3%, 2026) + Omnisend 3.94% (2025) + GetResponse 16.60% (2023 data) ± heuristic. Period: per send.",
        },
        sourceIds: [
          "src_klaviyo_abandoned_cart_2026",
          "src_omnisend_benchmarks_2026",
          "src_getresponse_2024",
        ],
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
            max: 7,
            note: {
              pl: "obejmuje średnią Klaviyo 6,5%",
              en: "includes the Klaviyo average of 6.5%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 7,
            max: 13,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 13,
            max: null,
            note: {
              pl: "top 10% Klaviyo 13,3%",
              en: "Klaviyo top 10% 13.3%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "welcome_email_click_rate.general_platforms",
      newsletter: "welcome_email_click_rate.general_platforms",
    },
  },
  {
    key: "automation_vs_campaign_rpr_ratio",
    group: "email",
    abbr: "RPR A/C",
    name: {
      pl: "Mnożnik przychodu na odbiorcę: automatyzacje vs kampanie",
      en: "Automation vs Campaign Revenue-per-Recipient Ratio",
    },
    expansion: {
      pl: "RPR (Revenue per Recipient): przychód przypisany do e-maila na jednego odbiorcę; wskaźnik porównuje RPR automatyzacji (flowów) z RPR kampanii masowych",
      en: "RPR (Revenue per Recipient): email-attributed revenue per recipient; the ratio compares automation (flow) RPR to bulk campaign RPR",
    },
    formula: {
      pl: "(przychód automatyzacji / odbiorcy automatyzacji) ÷ (przychód kampanii / odbiorcy kampanii)",
      en: "(automation revenue / automation recipients) ÷ (campaign revenue / campaign recipients)",
    },
    interpretation: {
      pl: "Mówi, ile razy więcej przychodu na odbiorcę generują wiadomości wyzwalane zachowaniem (powitanie, porzucony checkout, wygasająca subskrypcja) niż wysyłki masowe. W e-commerce to ok. 16–22× (Omnisend, liczone na wysłany e-mail, a nie ściśle na odbiorcę) i prawie 18× (Klaviyo, RPR). Niski mnożnik oznacza słabe lub źle wyzwalane automatyzacje albo braki w śledzeniu atrybucji. Pułapki: automatyzacje trafiają do osób o najwyższej intencji, więc mnożnik nie jest przyczynowy (mierz przyrost grupą kontrolną). Różne okna atrybucji, np. domyślne 5 dni dla e-maili i SMS w Klaviyo (Klaviyo Help Center: dla nowych klientów po 10/9/2024), zawyżają wartości bezwzględne.",
      en: "Says how many times more revenue per recipient behaviour-triggered messages (welcome, abandoned checkout, expiring subscription) generate than bulk sends; in e-commerce ~16–22x (Omnisend, computed per sent email rather than strictly per recipient) and nearly 18x (Klaviyo, RPR). A low multiple means weak or poorly triggered automations or attribution tracking gaps. Pitfalls: automations target the highest-intent people, so the multiple is not causal (measure lift with a holdout); different attribution windows (e.g., Klaviyo's 5-day default for email and SMS for new customers after 10/9/2024, per Klaviyo Help Center) inflate absolute values.",
    },
    levers: {
      pl: "Zacznij od automatyzacji o największej intencji zakupu: powitanie nowych kont, porzucony checkout, przypomnienie przed końcem triala i przed wydarzeniem. Pisz je jak treść, nie jak reklamę, i aktualizuj co kwartał. Zanim porównasz mnożnik, ustal jedno okno i model atrybucji dla kampanii i automatyzacji.",
      en: "Start with the automations with the highest purchase intent: welcoming new accounts, abandoned checkout, a reminder before the trial ends and before an event. Write them as content, not as advertising, and update them every quarter. Before comparing the multiplier, set one attribution window and model for both campaigns and automations.",
    },
    caveats: [
      {
        text: {
          pl: "Klaviyo: flowy to 5,3% wysyłek i prawie 41% przychodu e-mail. Omnisend: automatyzacje to 2% wysyłek i 30% przychodu (dane 2025).",
          en: "Klaviyo: flows are 5.3% of sends and almost 41% of e-mail revenue. Omnisend: automations are 2% of sends and 30% of revenue (2025 data).",
        },
        sourceIds: ["src_klaviyo_benchmarks_2026", "src_omnisend_report_2026"],
      },
      {
        text: {
          pl: "Porównuj wyłącznie przy tym samym oknie i modelu atrybucji.",
          en: "Compare only with the same attribution window and model.",
        },
        sourceIds: ["src_klaviyo_attribution_2026"],
      },
      {
        text: {
          pl: "Kontekst wydawcy i think tanku jest heurystyką (niska pewność).",
          en: "The publisher and think-tank context is a heuristic (low confidence).",
        },
      },
      {
        text: {
          pl: "Wartości Omnisend (16× i 22×) liczone są na wysłany e-mail, a nie ściśle na odbiorcę (RPR).",
          en: "The Omnisend values (16× and 22×) are calculated per e-mail sent, not strictly per recipient (RPR).",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "automation_vs_campaign_rpr_ratio.ecommerce",
        label: {
          pl: "E-commerce / sprzedaż online (dane Klaviyo i Omnisend)",
          en: "E-commerce / online sales (Klaviyo and Omnisend data)",
        },
        segments: ["events"],
        measure: "level",
        unit: "multiple",
        window: "year",
        direction: "higher",
        method: {
          pl: "średnie źródeł ± heurystyka: Omnisend 16× (2,87 vs 0,18 USD na wysłany e-mail, raport 2026) i ok. 22× (3,41 vs 0,155 USD na wysłany e-mail, benchmarki 2026) – Omnisend liczy na wysłany e-mail, a nie ściśle na odbiorcę; Klaviyo „prawie 18×” (RPR); wartości źródłowe 16–18× umieszczono w przedziale „normalny”, a 22× w „dobry”, spójnie z resztą słownika. Okres: rocznie / kwartalnie.",
          en: "source averages ± heuristic: Omnisend 16× (2.87 vs 0.18 USD per e-mail sent, 2026 report) and approx. 22× (3.41 vs 0.155 USD per e-mail sent, 2026 benchmarks) – Omnisend calculates per e-mail sent, not strictly per recipient; Klaviyo 'almost 18×' (RPR); the source values of 16–18× were placed in the 'normal' range and 22× in 'good', consistently with the rest of the dictionary. Period: annually / quarterly.",
        },
        sourceIds: [
          "src_omnisend_report_2026",
          "src_omnisend_benchmarks_2026",
          "src_klaviyo_benchmarks_2026",
          "src_klaviyo_attribution_2026",
        ],
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
            max: 12,
            basis: "E",
          },
          {
            tier: "normal",
            min: 12,
            max: 20,
            note: {
              pl: "obejmuje 16–18× ze źródeł",
              en: "includes 16–18× from the sources",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 20,
            max: 28,
            note: {
              pl: "obejmuje ok. 22× (Omnisend, benchmarki 2026)",
              en: "includes approx. 22× (Omnisend, 2026 benchmarks)",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 28,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "automation_vs_campaign_rpr_ratio.publisher_think_tank",
        label: {
          pl: "Wydawca subskrypcyjny / think tank (subskrypcje, bilety na wydarzenia, członkostwo)",
          en: "Subscription publisher / think tank (subscriptions, event tickets, membership)",
        },
        segments: ["all"],
        measure: "level",
        unit: "multiple",
        window: "year",
        direction: "higher",
        method: {
          pl: "heurystyka: brak publicznych benchmarków dla wydawców; przyjęto ok. 2/3 progów e-commerce (5/12/20/28× → 3/8/13/19×) ze względu na mniejszą liczbę wyzwalaczy zakupowych i rzadsze transakcje. Okres: rocznie / kwartalnie.",
          en: "heuristic: no public benchmarks for publishers; approx. 2/3 of the e-commerce thresholds were adopted (5/12/20/28× → 3/8/13/19×) because of fewer purchase triggers and less frequent transactions. Period: annually / quarterly.",
        },
        sourceIds: ["src_klaviyo_benchmarks_2026", "src_omnisend_report_2026"],
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
            max: 8,
            basis: "E",
          },
          {
            tier: "normal",
            min: 8,
            max: 13,
            basis: "E",
          },
          {
            tier: "good",
            min: 13,
            max: 19,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 19,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "automation_vs_campaign_rpr_ratio.publisher_think_tank",
      events: "automation_vs_campaign_rpr_ratio.ecommerce",
    },
    noMetricReason: {
      pl: "Wymaga przypisania przychodu do wysyłek (okno i model atrybucji), którego system nie prowadzi - przychód z subskrypcji i biletów nie jest łączony z kampaniami ani automatyzacjami. Bez atrybucji mnożnik byłby szacunkiem, a rejestr nie podstawia szacunków.",
      en: "It requires attributing revenue to sends (an attribution window and model), which the system does not do – subscription and ticket revenue is not linked to campaigns or automations. Without attribution the multiplier would be an estimate, and the registry does not substitute estimates.",
    },
  },
  {
    key: "email_conversion_rate",
    metricId: "journey_goal_rate",
    group: "email",
    abbr: "CVR (e-mail)",
    name: {
      pl: "Współczynnik konwersji z e-maila (na odbiorcę)",
      en: "Email Conversion Rate (per recipient)",
    },
    expansion: {
      pl: "Conversion Rate: odsetek odbiorców, którzy po e-mailu wykonali cel (zakup, subskrypcja, darowizna, rejestracja)",
      en: "Conversion Rate: share of recipients who completed the goal after the email (purchase, subscription, donation, registration)",
    },
    formula: {
      pl: "konwersje przypisane do wysyłki / dostarczone × 100% (osobno dla kampanii i automatyzacji)",
      en: "conversions attributed to the send / delivered × 100% (separately for campaigns and automations)",
    },
    interpretation: {
      pl: "Łączy jakość listy, treści i ścieżki zakupu w jedną liczbę biznesową. Automatyzacje konwertują rząd wielkości lepiej niż kampanie: według Omnisend 1,49% wobec 0,08%. Pułapki: różne definicje celu (płatny vs bezpłatny), różne okna atrybucji i liczenie od kliknięć zamiast od dostarczonych (to click-to-conversion, np. 39,46% dla porzuconego koszyka według bloga Omnisend o porzuconych koszykach z II 2026, a nie raportu benchmarków).",
      en: "Combines list, content and checkout quality into one business number; automations convert an order of magnitude better than campaigns (Omnisend: 1.49% vs 0.08%). Pitfalls: different goal definitions (paid vs free), different attribution windows, and computing from clicks instead of delivered (that is click-to-conversion, e.g., 39.46% for abandoned cart per Omnisend's cart-abandonment blog post of Feb 2026, not its benchmark report).",
    },
    levers: {
      pl: "Łącz każdą wysyłkę z jednym celem i stroną docelową, która go realizuje (zakup planu, rejestracja na wydarzenie, pobranie raportu) bez zbędnych kroków. Dopasuj ofertę do etapu odbiorcy: nowy czytelnik, aktywny subskrybent, uczestnik wydarzeń. Mierz konwersję osobno dla kampanii i automatyzacji, w jednym oknie atrybucji, i porównuj warianty wezwania do działania.",
      en: "Tie every send to one goal and a landing page that fulfils it (plan purchase, event registration, report download) without unnecessary steps. Match the offer to the recipient's stage: new reader, active subscriber, event participant. Measure conversion separately for campaigns and automations, in one attribution window, and compare call-to-action variants.",
    },
    caveats: [
      {
        text: {
          pl: "Dane dotyczą USA lub rynków globalnych (e-commerce, non-profit). Dla sprzedaży subskrypcji eksperckich w Polsce brak publicznych benchmarków.",
          en: "The data concern the USA or global markets (e-commerce, non-profit). There are no public benchmarks for selling expert subscriptions in Poland.",
        },
      },
      {
        text: {
          pl: "M+R (wartości typowe, 2025): 54 USD przychodu na 1000 e-maili fundraisingowych i 2,40 USD na subskrybenta rocznie (wcześniej 1,87 USD).",
          en: "M+R (typical values, 2025): USD 54 of revenue per 1000 fundraising e-mails and USD 2.40 per subscriber per year (previously USD 1.87).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
      },
      {
        text: {
          pl: "Strona benchmarków Omnisend jest wewnętrznie niespójna: sekcja branżowa podaje dla kampanii OR 30,22% i CTR 0,88% (wobec 30,41% i 0,74% w zestawieniu głównym); konwersję kampanii 0,08% przyjęto z zestawienia głównego.",
          en: "The Omnisend benchmark page is internally inconsistent: the industry section gives campaign OR of 30.22% and CTR of 0.88% (versus 30.41% and 0.74% in the main summary); the campaign conversion of 0.08% was taken from the main summary.",
        },
        sourceIds: ["src_omnisend_benchmarks_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "email_conversion_rate.mass_campaigns_paid",
        label: {
          pl: "Kampanie masowe: sprzedaż płatna (dane e-commerce)",
          en: "Mass campaigns: paid sales (e-commerce data)",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia Omnisend 0,08% (2025) ± heurystyka. Okres: na kampanię.",
          en: "Omnisend average of 0.08% (2025) ± heuristic. Period: per campaign.",
        },
        sourceIds: ["src_omnisend_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.02,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.02,
            max: 0.05,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.05,
            max: 0.1,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.1,
            max: 0.2,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 0.2,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "email_conversion_rate.automations_paid",
        label: {
          pl: "Automatyzacje ogółem: sprzedaż płatna (dane e-commerce)",
          en: "Automations overall: paid sales (e-commerce data)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnie Omnisend (automatyzacje 1,49%, powitalne 2,11%, porzucony koszyk 1,72%; 2025) ± heurystyka. Okres: na wysyłkę.",
          en: "Omnisend averages (automations 1.49%, welcome 2.11%, abandoned cart 1.72%; 2025) ± heuristic. Period: per send.",
        },
        sourceIds: ["src_omnisend_benchmarks_2026", "src_omnisend_cart_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.4,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.4,
            max: 0.9,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.9,
            max: 1.5,
            basis: "E",
          },
          {
            tier: "good",
            min: 1.5,
            max: 2.5,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 2.5,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "email_conversion_rate.nonprofit_donation_appeals",
        label: {
          pl: "Non-profit: apele o darowiznę",
          en: "Non-profit: donation appeals",
        },
        segments: ["newsletter"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "wartość typowa M+R (metodologia M+R: mediany per wskaźnik; response rate fundraising 0,05%) ± heurystyka. Okres: na wysyłkę (wartość typowa M+R za 2025).",
          en: "M+R typical value (M+R methodology: medians per indicator; fundraising response rate 0.05%) ± heuristic. Period: per send (M+R typical value for 2025).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.02,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.02,
            max: 0.04,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.04,
            max: 0.07,
            basis: "E",
          },
          {
            tier: "good",
            min: 0.07,
            max: 0.12,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 0.12,
            max: null,
            basis: "E",
          },
        ],
      },
      {
        id: "email_conversion_rate.free_actions",
        label: {
          pl: "Działania bezpłatne (petycje, rejestracje na bezpłatne wydarzenia online; analog M+R „advocacy”)",
          en: "Free actions (petitions, registrations for free online events; analogous to M+R 'advocacy')",
        },
        segments: ["events"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "wartość typowa M+R (metodologia M+R: mediany per wskaźnik; response rate advocacy 1,4%) ± heurystyka; analogia do bezpłatnych rejestracji to założenie eksperckie. Okres: na wysyłkę (wartość typowa M+R za 2025).",
          en: "M+R typical value (M+R methodology: medians per indicator; advocacy response rate 1.4%) ± heuristic; the analogy to free registrations is an expert assumption. Period: per send (M+R typical value for 2025).",
        },
        sourceIds: ["src_mr_benchmarks_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 0.4,
            basis: "E",
          },
          {
            tier: "weak",
            min: 0.4,
            max: 0.9,
            basis: "E",
          },
          {
            tier: "normal",
            min: 0.9,
            max: 1.8,
            basis: "E",
          },
          {
            tier: "good",
            min: 1.8,
            max: 3,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 3,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "email_conversion_rate.automations_paid",
      newsletter: "email_conversion_rate.mass_campaigns_paid",
      events: "email_conversion_rate.free_actions",
    },
  },
  {
    key: "abandoned_cart_email_open_rate",
    metricId: "journey_open_rate",
    group: "email",
    abbr: "AC OR",
    name: {
      pl: "Wskaźnik otwarć e-maili o porzuconym koszyku",
      en: "Abandoned Cart Email Open Rate",
    },
    expansion: {
      pl: "Abandoned Cart Open Rate: odsetek dostarczonych e-maili z sekwencji porzuconego koszyka lub checkoutu, które otwarto",
      en: "Abandoned Cart Open Rate: share of delivered abandoned cart/checkout sequence emails that were opened",
    },
    formula: {
      pl: "unikalne otwarcia e-maili sekwencji / dostarczone e-maile sekwencji × 100%",
      en: "unique opens of the sequence e-mails / delivered sequence e-mails × 100%",
    },
    interpretation: {
      pl: "W NES dotyczy porzuconego zakupu subskrypcji, biletu na wydarzenie lub członkostwa w klubie. Średnio ok. 70% koszyków jest porzucanych (Baymard), więc sekwencja to jedna z najbardziej dochodowych automatyzacji. OR wyraźnie niższy niż w newsletterze sugeruje problem z dostarczalnością lub tematem. Pułapki: MPP, zawyżanie przez wielokrotne wysyłki do tej samej osoby oraz brak wyjścia z sekwencji po zakupie.",
      en: "At NES this covers abandoned purchases of subscriptions, event tickets or club memberships. About 70% of carts are abandoned (Baymard), so this sequence is one of the highest-earning automations. An OR clearly below newsletter level suggests deliverability or subject issues. Pitfalls: MPP, inflation from multiple sends to the same person, and missing exit-on-purchase logic.",
    },
    levers: {
      pl: "Wyślij pierwszą wiadomość wkrótce po przerwaniu płatności, z tematem przypominającym konkretny plan lub wydarzenie. Nadawca i podgląd treści powinny jasno wskazywać, że chodzi o niedokończony zakup, a nie reklamę. Wysyłaj tylko osobom ze zgodą na kontakt, a progi przeskaluj względem własnych otwarć newslettera.",
      en: "Send the first message soon after the payment was interrupted, with a subject line recalling the specific plan or event. The sender and preview text should make it clear that this is about an unfinished purchase, not an advertisement. Send only to people who have consented to contact, and rescale the thresholds against your own newsletter opens.",
    },
    caveats: [
      {
        text: {
          pl: "W ESP bez korekty MPP (GetResponse, MailerLite) wartości mogą być wyższe o ok. 10–20 p.p. To heurystyka z porównania GetResponse z Omnisend: newsletter 40,08% wobec kampanii 30,41% (+10 p.p.), triggered 45,38% wobec automatyzacji 30,21% (+15 p.p.); żadne źródło nie podaje tej wartości wprost. Przeskaluj progi względem własnego OR newslettera.",
          en: "In ESPs without MPP correction (GetResponse, MailerLite), values may be approx. 10–20 pp higher. This is a heuristic from comparing GetResponse with Omnisend: newsletter 40.08% versus campaigns 30.41% (+10 pp), triggered 45.38% versus automations 30.21% (+15 pp); no source states this value directly. Rescale the thresholds against your own newsletter OR.",
        },
      },
      {
        text: {
          pl: "Brak benchmarków dla porzuconego checkoutu subskrypcji wydawców. Przyjęto dane e-commerce.",
          en: "There are no benchmarks for abandoned subscription checkouts at publishers. E-commerce data were adopted.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "abandoned_cart_email_open_rate.ecommerce_sequences",
        label: {
          pl: "Sekwencje porzuconego koszyka (dane e-commerce, Omnisend/Klaviyo)",
          en: "Abandoned-cart sequences (e-commerce data, Omnisend/Klaviyo)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnie Omnisend (37,12% benchmarki 2026; 35,75% blog II 2026; dane 2025) ± heurystyka; próg optymalny ≈ top 10% open rate flowów Klaviyo (45,8%). Okres: na wysyłkę.",
          en: "Omnisend averages (37.12% 2026 benchmarks; 35.75% blog Feb 2026; 2025 data) ± heuristic; optimal threshold ≈ the top 10% open rate of Klaviyo flows (45.8%). Period: per send.",
        },
        sourceIds: [
          "src_omnisend_benchmarks_2026",
          "src_omnisend_cart_2026",
          "src_klaviyo_benchmarks_2026",
          "baymard_2025",
        ],
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
            max: 30,
            basis: "E",
          },
          {
            tier: "normal",
            min: 30,
            max: 40,
            note: {
              pl: "obejmuje średnie Omnisend",
              en: "includes the Omnisend averages",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 40,
            max: 46,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 46,
            max: null,
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "abandoned_cart_email_open_rate.ecommerce_sequences",
    },
  },
  {
    key: "abandoned_cart_email_click_rate",
    metricId: "journey_click_rate",
    group: "email",
    abbr: "AC CTR",
    name: {
      pl: "Współczynnik kliknięć e-maili o porzuconym koszyku",
      en: "Abandoned Cart Email Click Rate",
    },
    expansion: {
      pl: "Abandoned Cart Click-Through Rate: odsetek dostarczonych e-maili sekwencji porzuconego koszyka z co najmniej jednym kliknięciem",
      en: "Abandoned Cart Click-Through Rate: share of delivered abandoned cart sequence emails with at least one click",
    },
    formula: {
      pl: "unikalne kliknięcia / dostarczone e-maile sekwencji × 100%",
      en: "unique clicks / delivered sequence e-mails × 100%",
    },
    interpretation: {
      pl: "Mierzy, ilu odbiorców wraca do porzuconego zakupu. Klaviyo podaje średnio 6,0%, a górne 10% marek 11,3%. Niski CTR przy normalnym OR oznacza słabe przypomnienie (brak podglądu produktu, ceny, korzyści) albo zepsuty link do odtworzenia koszyka. Pułapki: CTR liczony od otwarć (to CTOR, ok. 11% według Omnisend) i kliknięcia botów.",
      en: "Measures how many recipients come back to the abandoned purchase (Klaviyo average 6.0%, top 10% 11.3%). Low CTR with normal OR means a weak reminder (no product preview, price or benefits) or a broken cart-restore link. Pitfalls: CTR computed on opens (that is CTOR, ~11% per Omnisend) and bot clicks.",
    },
    levers: {
      pl: "Daj jeden wyraźny przycisk prowadzący prosto do wznowienia płatności z zachowanym wyborem planu lub biletu. Przypomnij korzyść i odpowiedz na typową przeszkodę (cena z VAT, faktura, metody płatności). Raportuj kliknięcia dla każdej pozycji w sekwencji i skróć ją, jeśli kolejne wiadomości nie wnoszą kliknięć.",
      en: "Give one clear button leading straight back to the payment with the plan or ticket choice preserved. Recall the benefit and address a typical obstacle (price including VAT, invoice, payment methods). Report clicks for each position in the sequence and shorten it if later messages add no clicks.",
    },
    caveats: [
      {
        text: {
          pl: "Klaviyo podaje przykład („a common sequence might involve 3 messages”), a nie zalecenie 3 e-maili: e-mail po 2–4 h, SMS z rabatem po 24 h i ostatnia wiadomość po 48 h. Omnisend w tekście podaje 30–60 min, 24 h i 72 h, ale diagram pokazuje trzecią wiadomość po 48 h (źródło niespójne). Raportuj CTR per pozycja w sekwencji.",
          en: "Klaviyo gives an example ('a common sequence might involve 3 messages'), not a recommendation of 3 e-mails: an e-mail after 2–4 h, an SMS with a discount after 24 h and a final message after 48 h. Omnisend's text gives 30–60 min, 24 h and 72 h, but its diagram shows the third message after 48 h (the source is inconsistent). Report CTR per position in the sequence.",
        },
        sourceIds: ["src_klaviyo_abandoned_cart_2026", "src_omnisend_cart_2026"],
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "abandoned_cart_email_click_rate.ecommerce_sequences",
        label: {
          pl: "Sekwencje porzuconego koszyka (dane e-commerce)",
          en: "Abandoned-cart sequences (e-commerce data)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnia i top 10% Klaviyo (6,0% / 11,3%, X 2026) + Omnisend CTR 4,13% (dane 2025) ± heurystyka. Okres: na wysyłkę.",
          en: "Klaviyo average and top 10% (6.0% / 11.3%, Oct 2026) + Omnisend CTR 4.13% (2025 data) ± heuristic. Period: per send.",
        },
        sourceIds: [
          "src_klaviyo_abandoned_cart_2026",
          "src_omnisend_benchmarks_2026",
          "src_omnisend_cart_2026",
        ],
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
              pl: "Omnisend 4,13%",
              en: "Omnisend 4.13%",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 6,
            max: 11.3,
            note: {
              pl: "od średniej Klaviyo",
              en: "from the Klaviyo average",
            },
            basis: "B",
          },
          {
            tier: "optimal",
            min: 11.3,
            max: null,
            note: {
              pl: "top 10% Klaviyo",
              en: "Klaviyo top 10%",
            },
            basis: "B",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "abandoned_cart_email_click_rate.ecommerce_sequences",
    },
  },
  {
    key: "abandoned_cart_email_conversion_rate",
    metricId: "journey_goal_rate",
    group: "email",
    abbr: "AC CVR",
    name: {
      pl: "Konwersja sekwencji porzuconego koszyka",
      en: "Abandoned Cart Email Conversion Rate",
    },
    expansion: {
      pl: "Abandoned Cart Conversion Rate (placed order rate): odsetek odbiorców sekwencji, którzy sfinalizowali zakup przypisany do e-maila",
      en: "Abandoned Cart Conversion Rate (placed order rate): share of sequence recipients who completed an email-attributed purchase",
    },
    formula: {
      pl: "zamówienia przypisane do sekwencji / odbiorcy (dostarczone) sekwencji × 100%",
      en: "orders attributed to the sequence / sequence recipients (delivered) × 100%",
    },
    interpretation: {
      pl: "To bezpośredni miernik odzyskanego przychodu. Omnisend podaje średnio 1,72% na wysyłkę i click-to-conversion ok. 39,5%, a Klaviyo średni przychód na odbiorcę 6,77 USD (top 10%: 13,70 USD). Niska konwersja przy dobrym CTR to zwykle problem strony płatności: koszty dodatkowe, wymóg konta, brak metody płatności. Według Baymard dodatkowe koszty to 40% powodów porzuceń. Pułapki: atrybucja zakupów, które i tak by nastąpiły, oraz brak grupy kontrolnej.",
      en: "Direct measure of recovered revenue (Omnisend: 1.72% per send average, click-to-conversion ~39.5%; Klaviyo: average RPR $6.77, top 10% $13.70). Low conversion with good CTR usually points to the checkout page (extra costs, forced account creation, missing payment methods; Baymard: extra costs are 40% of abandonment reasons). Pitfalls: attributing purchases that would have happened anyway and no holdout group.",
    },
    levers: {
      pl: "Skróć drogę z e-maila do zakończonej płatności: link otwiera checkout z zapamiętanym planem, a nie stronę główną. Daj instytucjom alternatywę (faktura, kontakt z opiekunem) i przypisuj takie konwersje także w CRM. Unikaj automatycznych rabatów w pierwszej wiadomości, żeby nie uczyć odbiorców porzucania koszyka.",
      en: "Shorten the path from the e-mail to a completed payment: the link opens the checkout with the plan remembered, not the home page. Give institutions an alternative (invoice, contact with an account manager) and attribute such conversions in the CRM as well. Avoid automatic discounts in the first message, so as not to teach recipients to abandon the cart.",
    },
    caveats: [
      {
        text: {
          pl: "Baymard: średni wskaźnik porzucenia koszyka to 70,22% (50 badań, aktualizacja IX 2025). To punkt odniesienia dla lejka checkoutu, a nie wskaźnik e-mailowy.",
          en: "Baymard: the average cart abandonment rate is 70.22% (50 studies, updated Sep 2025). This is a reference point for the checkout funnel, not an e-mail indicator.",
        },
        sourceIds: ["baymard_2025"],
      },
      {
        text: {
          pl: "Dla subskrypcji B2B i faktur pro forma konwersja może następować poza e-mailem (np. przez opiekuna w CRM). Uwzględnij to w atrybucji.",
          en: "For B2B subscriptions and pro forma invoices, conversion may happen outside e-mail (e.g. through an account manager in the CRM). Take this into account in attribution.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "abandoned_cart_email_conversion_rate.ecommerce_sequences",
        label: {
          pl: "Sekwencje porzuconego koszyka (dane e-commerce)",
          en: "Abandoned-cart sequences (e-commerce data)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "higher",
        method: {
          pl: "średnie Omnisend (1,72% benchmarki 2026; 1,51% blog II 2026; dane 2025) ± heurystyka. Okres: na wysyłkę.",
          en: "Omnisend averages (1.72% 2026 benchmarks; 1.51% blog Feb 2026; 2025 data) ± heuristic. Period: per send.",
        },
        sourceIds: [
          "src_omnisend_benchmarks_2026",
          "src_omnisend_cart_2026",
          "src_klaviyo_abandoned_cart_2026",
          "baymard_2025",
        ],
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
            max: 2,
            note: {
              pl: "obejmuje średnie Omnisend",
              en: "includes the Omnisend averages",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 2,
            max: 3,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 3,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "abandoned_cart_email_conversion_rate.ecommerce_sequences",
    },
  },
  {
    key: "inbox_placement_rate",
    group: "email",
    abbr: "IPR",
    name: {
      pl: "Wskaźnik trafiania do skrzynki odbiorczej",
      en: "Inbox Placement Rate",
    },
    expansion: {
      pl: "Inbox Placement Rate: odsetek wysłanych wiadomości, które trafiły do folderu odbiorczego (nie do spamu i nie zaginęły)",
      en: "Inbox Placement Rate: share of sent emails that reached the inbox (not spam folder, not missing)",
    },
    formula: {
      pl: "wiadomości w folderze odbiorczym / wysłane (pomiar na adresach testowych seed lub na panelu) × 100% = 100% − spam% − brakujące%",
      en: "messages in the inbox folder / sent (measured on seed test addresses or a panel) × 100% = 100% − spam% − missing%",
    },
    interpretation: {
      pl: "To realna dostarczalność. Wskaźnik „delivered” w ESP to tylko „wysłane minus odbite” i nie mówi, czy wiadomość trafiła do spamu. Spadek IPR poprzedza spadek OR, CTR i przychodu, więc to wskaźnik wyprzedzający dla całego programu e-mail. Pułapki: mierzy się go na próbie adresów testowych (seed), więc wynik zależy od składu dostawców. Validity nie raportuje Polski (z krajów europejskich podaje tylko Francję, Niemcy i UK), a polscy dostawcy (WP, Onet, Interia) filtrują inaczej niż Gmail czy Microsoft.",
      en: "This is real deliverability: an ESP's 'delivered' is just 'sent minus bounced' and does not say whether mail went to spam. A drop in IPR precedes drops in OR, CTR and revenue, so it is a leading indicator for the whole email programme. Pitfalls: measured on seed samples, so results depend on provider mix; Validity does not report Poland (of European countries it covers only France, Germany and the UK), and Polish providers (WP, Onet, Interia) filter differently than Gmail/Microsoft.",
    },
    levers: {
      pl: "Uwierzytelnij domenę nadawcy (SPF, DKIM, DMARC) i wysyłaj z jednej, rozgrzanej domeny lub subdomeny, w stałym rytmie. Usuwaj nieaktywnych odbiorców i odbicia, bo zaangażowanie listy wpływa na filtry dostawców poczty. Śledź reputację w Google Postmaster Tools i Microsoft SNDS, a po dużych zmianach wykonaj test na adresach kontrolnych.",
      en: "Authenticate the sender domain (SPF, DKIM, DMARC) and send from one warmed-up domain or subdomain, at a steady rhythm. Remove inactive recipients and bounces, because list engagement affects mailbox-provider filters. Track reputation in Google Postmaster Tools and Microsoft SNDS, and run a seed-address test after major changes.",
    },
    caveats: [
      {
        text: {
          pl: "Validity 2025 według dostawców: Gmail 89,8%, Microsoft 77,4% (najtrudniejszy), Yahoo 87,3%, Apple 82,0%. Według sektorów: Media & Internet 88,1%, organizacje 87,7%, edukacja 87,6%, administracja publiczna 91,4%.",
          en: "Validity 2025 by mailbox provider: Gmail 89.8%, Microsoft 77.4% (the hardest), Yahoo 87.3%, Apple 82.0%. By sector: Media & Internet 88.1%, organisations 87.7%, education 87.6%, public administration 91.4%.",
        },
        sourceIds: ["src_validity_2026"],
      },
      {
        text: {
          pl: "Bez narzędzia do testów seed (Validity, GlockApps itp.) używaj wskaźników zastępczych: Google Postmaster Tools (reputacja domeny, spam rate), Microsoft SNDS oraz soft bounce per domena.",
          en: "Without a seed-testing tool (Validity, GlockApps, etc.), use proxy indicators: Google Postmaster Tools (domain reputation, spam rate), Microsoft SNDS and soft bounces per domain.",
        },
      },
    ],
    direction: "higher",
    confidence: "medium",
    asOf: "2026-10-18",
    reviewBy: "2027-10-18",
    contexts: [
      {
        id: "inbox_placement_rate.europe",
        label: {
          pl: "Nadawcy wysyłający do odbiorców w Europie",
          en: "Senders sending to recipients in Europe",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "średnie Validity 2025 ± heurystyka: Europa 91,1%, Niemcy 97,5%, Francja 94,0%, UK 91,5% (z krajów europejskich raport podaje tylko te trzy; Polska nieraportowana); regionalni dostawcy w Europie 79,7% (−11,4 p.p. względem MAGY); dane z adresów testowych (seed) klientów Validity, z wyłączeniem nadawców, którzy nie zgodzili się na agregację. Okres: kwartalnie / miesięcznie (test seed).",
          en: "Validity 2025 averages ± heuristic: Europe 91.1%, Germany 97.5%, France 94.0%, UK 91.5% (of the European countries the report gives only these three; Poland not reported); regional providers in Europe 79.7% (−11.4 pp relative to MAGY); data from the seed test addresses of Validity clients, excluding senders who did not consent to aggregation. Period: quarterly / monthly (seed test).",
        },
        sourceIds: ["src_validity_2026"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 80,
            note: {
              pl: "poziom regionalnych dostawców (79,7%; −11,4 p.p. względem MAGY w Europie)",
              en: "the level of regional providers (79.7%; −11.4 pp relative to MAGY in Europe)",
            },
            basis: "B",
          },
          {
            tier: "weak",
            min: 80,
            max: 87,
            basis: "E",
          },
          {
            tier: "normal",
            min: 87,
            max: 91,
            note: {
              pl: "do średniej Europy 91,1%",
              en: "up to the European average of 91.1%",
            },
            basis: "B",
          },
          {
            tier: "good",
            min: 91,
            max: 95,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 95,
            max: null,
            note: {
              pl: "Niemcy 97,5%",
              en: "Germany 97.5%",
            },
            basis: "B",
          },
        ],
      },
      {
        id: "inbox_placement_rate.global_mixed",
        label: {
          pl: "Lista mieszana globalnie (różne kraje i dostawcy)",
          en: "Globally mixed list (various countries and providers)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "quarter",
        direction: "higher",
        method: {
          pl: "średnia globalna Validity 87,2% (2025; 83,5% w 2024) i rozkład sektorów 80,1–97,2% ± heurystyka; dane z adresów testowych (seed) klientów Validity, z wyłączeniem nadawców, którzy nie zgodzili się na agregację. Okres: kwartalnie / miesięcznie (test seed).",
          en: "Validity global average of 87.2% (2025; 83.5% in 2024) and the sector distribution of 80.1–97.2% ± heuristic; data from the seed test addresses of Validity clients, excluding senders who did not consent to aggregation. Period: quarterly / monthly (seed test).",
        },
        sourceIds: ["src_validity_2026", "src_validity_2025"],
        bands: [
          {
            tier: "critical",
            min: null,
            max: 75,
            basis: "E",
          },
          {
            tier: "weak",
            min: 75,
            max: 83,
            basis: "E",
          },
          {
            tier: "normal",
            min: 83,
            max: 89,
            note: {
              pl: "obejmuje średnią 87,2%",
              en: "includes the 87.2% average",
            },
            basis: "E",
          },
          {
            tier: "good",
            min: 89,
            max: 94,
            basis: "E",
          },
          {
            tier: "optimal",
            min: 94,
            max: null,
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "inbox_placement_rate.europe",
    },
    noMetricReason: {
      pl: "Odsetek trafień do skrzynki mierzy się testami na adresach kontrolnych (seed) albo panelem odbiorców - system nie ma takiego narzędzia ani integracji. Do czasu jej dodania korzystaj ze wskaźników zastępczych: miękkich odbić dla każdej domeny i zgłoszeń spamu.",
      en: "Inbox placement is measured with tests on seed addresses or a recipient panel – the system has neither such a tool nor an integration. Until one is added, use proxy indicators: soft bounces per domain and spam complaints.",
    },
  },
  {
    key: "disaffection_rate",
    metricId: "email_disaffection_rate",
    group: "email",
    abbr: "DR",
    name: {
      pl: "Wskaźnik zniechęcenia listy",
      en: "Disaffection Rate",
    },
    expansion: {
      pl: "Disaffection Rate: stosunek sygnałów utraty subskrybentów (wypisy, skargi, odbicia) do pozytywnych reakcji (kliknięć)",
      en: "Disaffection Rate: ratio of subscriber-loss signals (unsubscribes, complaints, bounces) to positive responses (clicks)",
    },
    formula: {
      pl: "(wypisy + skargi na spam + odbicia) / kliknięcia × 100%",
      en: "(unsubscribes + spam complaints + bounces) / clicks × 100%",
    },
    interpretation: {
      pl: "Wskaźnik promowany przez Validity na 2026 r. W jednej liczbie pokazuje, czy wysyłki budują listę, czy ją erodują. Przy 0,3% wypisów, 0,1% skarg, 0,1% twardych odbić i CTR 1% wynosi 50%, czyli na każde dwa kliknięcia tracisz jednego subskrybenta; Validity zauważa, że przy 2 wysyłkach tygodniowo oznacza to utratę połowy listy w niecały rok. Mianem sytuacji kryzysowej („crisis situation”) Validity określa stan, w którym zniechęcenie przewyższa kliknięcia („disaffection rate is larger than its click rate”). Pułapki: kliknięcia botów zawyżają mianownik, więc wskaźnik wychodzi zbyt optymistycznie.",
      en: "A KPI promoted by Validity for 2026 that shows in one number whether sends build or erode the list. With 0.3% unsubscribes, 0.1% complaints, 0.1% hard bounces and 1% CTR it equals 50%: one subscriber lost for every two clicks, which at 2 sends a week Validity says means losing half the list in under a year; Validity reserves 'crisis situation' for when the disaffection rate is larger than the click rate. Pitfalls: bot clicks can inflate the denominator and make the metric look too optimistic.",
    },
    levers: {
      pl: "Traktuj DR jako sygnał zmęczenia listy: przy wzroście ogranicz częstotliwość dla mniej zaangażowanych odbiorców i daj im wybór tematów. Usuwaj odbicia i dawno nieaktywne adresy przed wysyłką, a treść dopasuj tak, by każde wydanie dawało powód do kliknięcia. Analizuj wynik dla każdego segmentu i typu wysyłki.",
      en: "Treat DR as a signal of list fatigue: when it rises, reduce frequency for less engaged recipients and let them choose topics. Remove bounces and long-inactive addresses before sending, and shape the content so that every issue gives a reason to click. Analyse the result per segment and per send type.",
    },
    caveats: [
      {
        text: {
          pl: "Validity wiąże „crisis situation” z sytuacją, gdy zniechęcenie przewyższa kliknięcia (DR ≥100%), a przykład 50% opisuje jako utratę 1 subskrybenta na 2 kliknięcia i połowy listy w niecały rok przy 2 wysyłkach tygodniowo. Próg krytyczny 50% to ostrożna heurystyka, a nie próg ze źródła.",
          en: "Validity links a 'crisis situation' to disaffection exceeding clicks (DR ≥100%) and describes the 50% example as losing 1 subscriber for every 2 clicks and half the list in under a year at 2 sends a week. The 50% critical threshold is a cautious heuristic, not a threshold from the source.",
        },
        sourceIds: ["src_validity_2026"],
      },
      {
        text: {
          pl: "Przedziały poniżej 50% to heurystyka (brak rozkładu w źródle).",
          en: "The ranges below 50% are a heuristic (the source gives no distribution).",
        },
      },
    ],
    direction: "lower",
    confidence: "low",
    asOf: "2026-10-18",
    reviewBy: "2027-04-18",
    contexts: [
      {
        id: "disaffection_rate.all_sends",
        label: {
          pl: "Każda wysyłka marketingowa (newsletter, kampanie)",
          en: "Any marketing send (newsletter, campaigns)",
        },
        segments: ["all"],
        measure: "level",
        unit: "percent_pt",
        window: "per_campaign",
        direction: "lower",
        method: {
          pl: "heurystyka: ostrożny próg 50% z przykładu Validity (0,3% wypisów + 0,1% skarg + 0,1% odbić przy CTR 1% = 50%, czyli 1 utracony subskrybent na 2 kliknięcia); Validity nazywa kryzysem sytuację, gdy zniechęcenie przewyższa kliknięcia (DR ≥100%); niższe przedziały to heurystyka (brak rozkładu w źródle). Okres: na wysyłkę / miesięcznie.",
          en: "heuristic: a cautious 50% threshold from the Validity example (0.3% unsubscribes + 0.1% complaints + 0.1% bounces at a 1% CTR = 50%, i.e. 1 lost subscriber for every 2 clicks); Validity calls it a crisis when disaffection exceeds clicks (DR ≥100%); the lower ranges are a heuristic (the source gives no distribution). Period: per send / monthly.",
        },
        sourceIds: ["src_validity_2026"],
        bands: [
          {
            tier: "optimal",
            min: null,
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
            tier: "normal",
            min: 20,
            max: 35,
            basis: "E",
          },
          {
            tier: "weak",
            min: 35,
            max: 50,
            basis: "E",
          },
          {
            tier: "critical",
            min: 50,
            max: null,
            note: {
              pl: "≥50%: przykład Validity (1 utracony na 2 kliknięcia); ≥100% = utraty przewyższają kliknięcia, Validity: kryzys",
              en: "≥50%: the Validity example (1 lost for every 2 clicks); ≥100% = losses exceed clicks, Validity: crisis",
            },
            basis: "E",
          },
        ],
      },
    ],
    defaultContextBySegment: {
      all: "disaffection_rate.all_sends",
    },
  },
];
