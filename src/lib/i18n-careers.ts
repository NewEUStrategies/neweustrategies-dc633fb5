// Słownik strony /careers ("Dołącz do zespołu") - PL/EN.
// Rejestracja przy ewaluacji modułu; `ensureI18n()` trzyma bundle w chunku
// trasy (ten sam wzorzec, co i18n-membership-join / i18n-pricing).
import i18n from "@/lib/i18n";

const careersPl = {
  careers: {
    eyebrow: "Kariera",
    lead: "Budujemy think tank, w którym analiza kończy się rekomendacją, a rekomendacja - decyzją. Szukamy analityków, ekspertów polityki publicznej, marketerów, doradców i redaktorów, którzy chcą pracować na europejskiej agendzie.",
    ctaPrimary: "Zobacz otwarte role",
    ctaSecondary: "Aplikuj spontanicznie",
    trust: "Aplikacja zajmuje 3 minuty. Odpowiadamy na każde zgłoszenie w ciągu 10 dni roboczych.",
    hero: {
      badge: "Otwarte role: {{value}}",
      titleTop: "Dołącz do zespołu",
      titleAccent: "New European Strategies",
      rotatePrefix: "Szukamy teraz:",
      rotating: {
        research: "analityków bezpieczeństwa i gospodarki",
        policy: "specjalistów od legislacji UE",
        marketing: "marketerów wzrostu i treści",
        advisory: "doradców strategicznych zarządów",
        editorial: "redaktorów pracujących w PL i EN",
      },
    },
    stats: {
      people: { value: "45", label: "osób w zespole" },
      countries: { value: "9", label: "krajów, z których pracujemy" },
      remote: { value: "100%", label: "ról z pracą zdalną lub hybrydową" },
      growth: { value: "3x", label: "wzrost zespołu w 2 lata" },
    },
    values: {
      title: "Jak pracujemy",
      subtitle: "Cztery zasady, które realnie widać w kalendarzu, a nie tylko w deklaracjach.",
      hint: "Wybierz zasadę, żeby zobaczyć, jak wygląda na co dzień.",
      proofLabel: "W praktyce",
      items: {
        evidence: {
          title: "Dowody przed opinią",
          body: "Każda teza ma dane, źródło i autora. Nie publikujemy tekstów, których nie umiemy obronić.",
          proof:
            "Każda analiza przechodzi recenzję drugiego analityka i redakcję, zanim trafi do czytelników.",
        },
        ownership: {
          title: "Własność tematu",
          body: "Prowadzisz swój obszar od pomysłu do publikacji i rozmowy z decydentem - bez łańcucha akceptacji.",
          proof:
            "Publikujesz pod własnym nazwiskiem i sam odpowiadasz na pytania mediów o swój temat.",
        },
        craft: {
          title: "Rzemiosło i tempo",
          body: "Krótkie cykle, wysoka jakość redakcyjna, realne deadline'y i szacunek do czasu po pracy.",
          proof:
            "Zadanie rekrutacyjne jest płatne i ograniczone do 4 godzin - tak samo traktujemy czas w pracy.",
        },
        europe: {
          title: "Perspektywa europejska",
          body: "Pracujemy w PL i EN, z partnerami w Brukseli, Berlinie i Kijowie. Twoja praca ma zasięg kontynentalny.",
          proof:
            "Na co dzień pracujesz w dwóch językach, a wyniki trafiają do instytucji w kilku stolicach.",
        },
      },
    },
    benefits: {
      title: "Co oferujemy",
      subtitle: "Konkrety, nie owocowe czwartki.",
      items: {
        flexible: {
          title: "Elastyczna współpraca",
          body: "Wybór formy: umowa o pracę, B2B, zlecenie lub staż. Dopasowujemy wymiar i tryb do Twojej sytuacji.",
        },
        remote: {
          title: "Zdalnie lub hybrydowo",
          body: "Każdą rolę można pełnić zdalnie albo hybrydowo. Godziny ustalasz z zespołem, nie z regulaminem.",
        },
        warsaw: {
          title: "Biuro w Warszawie",
          body: "Przestrzeń do spotkań i głębokiej pracy w centrum Warszawy, kiedy chcesz z niej skorzystać.",
        },
        impact: {
          title: "Realny wpływ na temat",
          body: "Prowadzisz własne dossier od pomysłu do publikacji. Twoje nazwisko pod każdym tekstem.",
        },
        byline: {
          title: "Publikacje pod nazwiskiem",
          body: "Podpisujemy autorów, nie „zespół”. Twoje analizy budują Twoje nazwisko.",
        },
        network: {
          title: "Sieć i wydarzenia",
          body: "Dostęp do sieci ekspertów, klubów dyskusyjnych i wydarzeń zamkniętych - od pierwszego dnia.",
        },
      },
    },
    roles: {
      title: "Otwarte role",
      subtitle: "Filtruj po dziale. Nie widzisz swojej roli? Wyślij zgłoszenie spontaniczne.",
      all: "Wszystkie",
      showing: "Pokazujemy {{value}} z {{total}} ról",
      empty: "W tym dziale nie prowadzimy teraz rekrutacji - napisz do nas mimo to.",
      apply: "Aplikuj na tę rolę",
      details: "Pełna oferta",
      selected: "Wybrana rola",
      dialog: {
        overview: "O roli",
        responsibilities: "Zakres obowiązków",
        requirements: "Wymagania",
        close: "Zamknij",
        meta: "Szczegóły oferty",
      },
      senior_analyst_security: {
        title: "Starszy analityk - bezpieczeństwo i obronność",
        summary:
          "Prowadzisz linię badawczą o bezpieczeństwie europejskim: analizy, policy papers i komentarze dla mediów.",
        bullets: {
          b1: "Projektowanie i realizacja analiz o zdolnościach obronnych i przemyśle zbrojeniowym.",
          b2: "Publikacje pod własnym nazwiskiem oraz briefy dla instytucji i biznesu.",
          b3: "Reprezentowanie think tanku w mediach i na panelach.",
          b4: "Współprowadzenie klubu dyskusyjnego w swojej specjalizacji.",
        },
        requirements: {
          q1: "5+ lat doświadczenia w analizie bezpieczeństwa, obronności lub stosunków międzynarodowych.",
          q2: "Udokumentowany dorobek publikacyjny (analizy, policy papers, komentarze).",
          q3: "Biegły polski i angielski - w mowie i piśmie, także przed kamerą.",
          q4: "Znajomość instytucji NATO/UE i realiów przemysłu zbrojeniowego.",
        },
      },
      analyst_economy: {
        title: "Analityk - gospodarka i energetyka",
        summary:
          "Łączysz dane makro z regulacją UE i tłumaczysz, co z tego wynika dla firm i administracji.",
        bullets: {
          b1: "Analizy rynkowe i regulacyjne z jasną rekomendacją.",
          b2: "Praca z danymi Eurostatu, ENTSO-E i źródeł krajowych.",
          b3: "Współpraca z redakcją przy wizualizacjach i wykresach.",
        },
        requirements: {
          q1: "3+ lata pracy analitycznej w gospodarce, energetyce lub regulacji UE.",
          q2: "Swoboda w pracy z danymi ilościowymi (Excel/Python/R) i źródłami statystycznymi.",
          q3: "Umiejętność pisania zwięzłych rekomendacji dla decydentów.",
        },
      },
      data_analyst: {
        title: "Analityk danych (współpraca projektowa)",
        summary:
          "Budujesz warstwę danych pod nasze raporty: modele, zestawy wskaźników i powtarzalne pipeline'y.",
        bullets: {
          b1: "Przygotowanie i kontrola jakości zbiorów danych do raportów.",
          b2: "Automatyzacja aktualizacji wskaźników i wykresów.",
          b3: "Dokumentacja metodologii dla czytelników i recenzentów.",
        },
        requirements: {
          q1: "Praktyczna znajomość Pythona lub R oraz SQL.",
          q2: "Doświadczenie w budowie powtarzalnych pipeline'ów i kontroli jakości danych.",
          q3: "Dbałość o dokumentację metodologii i powtarzalność wyników.",
        },
      },
      eu_policy_officer: {
        title: "Specjalista ds. polityki UE",
        summary:
          "Monitorujesz proces legislacyjny w Brukseli i przekładasz go na stanowiska oraz konsultacje.",
        bullets: {
          b1: "Śledzenie prac Komisji, Rady i Parlamentu w wyznaczonych dossier.",
          b2: "Przygotowanie stanowisk konsultacyjnych i notatek decyzyjnych.",
          b3: "Kontakty z instytucjami, stowarzyszeniami i partnerami.",
          b4: "Wsparcie zespołu analitycznego w interpretacji przepisów.",
        },
        requirements: {
          q1: "Doświadczenie w pracy z procesem legislacyjnym UE (instytucje, izby, kancelarie).",
          q2: "Umiejętność szybkiego streszczania dokumentów prawnych w język decyzji.",
          q3: "Angielski na poziomie roboczym C1, mile widziany francuski.",
          q4: "Gotowość do pracy w Brukseli i udziału w spotkaniach instytucjonalnych.",
        },
      },
      policy_intern: {
        title: "Staż - polityka publiczna",
        summary:
          "Sześciomiesięczny płatny staż z realnym zakresem: research, notatki, wsparcie publikacji.",
        bullets: {
          b1: "Research desk-owy i przeglądy literatury.",
          b2: "Notatki z posiedzeń i wydarzeń branżowych.",
          b3: "Wsparcie przy redakcji i korekcie materiałów.",
        },
        requirements: {
          q1: "Student ostatnich lat lub absolwent kierunków społecznych, prawnych albo ekonomicznych.",
          q2: "Rzetelność w researchu i umiejętność pracy ze źródłami pierwotnymi.",
          q3: "Angielski umożliwiający swobodną lekturę dokumentów UE.",
        },
      },
      growth_marketing_lead: {
        title: "Lead marketingu i wzrostu",
        summary:
          "Odpowiadasz za wzrost czytelnictwa i członkostw: newsletter, kampanie, lejek subskrypcyjny.",
        bullets: {
          b1: "Strategia pozyskania i utrzymania członków (SEO, newsletter, kampanie płatne).",
          b2: "Praca na danych: kohorty, retencja, konwersja planów.",
          b3: "Zarządzanie budżetem i współpraca z podwykonawcami.",
          b4: "Rozwój marki think tanku w PL i EN.",
        },
        requirements: {
          q1: "4+ lata w marketingu wzrostowym, najlepiej w mediach lub subskrypcjach.",
          q2: "Twarde doświadczenie z analityką: kohorty, retencja, atrybucja kampanii.",
          q3: "Praktyka w prowadzeniu newslettera i lejka subskrypcyjnego.",
          q4: "Umiejętność zarządzania budżetem i podwykonawcami.",
        },
      },
      content_marketing_specialist: {
        title: "Specjalista ds. treści (część etatu)",
        summary:
          "Przekładasz analizy na formaty społecznościowe, newsletterowe i wideo - bez utraty precyzji.",
        bullets: {
          b1: "Prowadzenie kanałów LinkedIn i X w PL/EN.",
          b2: "Redakcja newslettera i zapowiedzi raportów.",
          b3: "Współpraca z autorami przy dystrybucji publikacji.",
        },
        requirements: {
          q1: "2+ lata w prowadzeniu kanałów społecznościowych marki eksperckiej.",
          q2: "Lekkie pióro w PL i EN oraz wyczucie tematów publicznych.",
          q3: "Podstawy pracy z grafiką i wideo w formatach społecznościowych.",
        },
      },
      strategic_advisor: {
        title: "Doradca strategiczny (współpraca ekspercka)",
        summary:
          "Wspierasz klientów instytucjonalnych w decyzjach o wysokiej stawce - regulacja, ryzyko, geopolityka.",
        bullets: {
          b1: "Warsztaty scenariuszowe i doradztwo dla zarządów.",
          b2: "Recenzja merytoryczna raportów i stanowisk.",
          b3: "Udział w projektach doradczych w formule projektowej.",
        },
        requirements: {
          q1: "Doświadczenie doradcze na poziomie zarządów lub administracji centralnej.",
          q2: "Ekspercka specjalizacja w regulacji, ryzyku lub geopolityce.",
          q3: "Umiejętność prowadzenia warsztatów scenariuszowych.",
        },
      },
      managing_editor: {
        title: "Redaktor prowadzący",
        summary:
          "Pilnujesz jakości, kalendarza i języka wszystkich publikacji - w dwóch wersjach językowych.",
        bullets: {
          b1: "Planowanie kalendarza wydawniczego i egzekwowanie deadline'ów.",
          b2: "Redakcja merytoryczna i językowa analiz w PL i EN.",
          b3: "Standardy cytowania, przypisów i weryfikacji faktów.",
          b4: "Współpraca z zespołem wizualnym przy layoutach raportów.",
        },
        requirements: {
          q1: "5+ lat w redakcji tekstów analitycznych lub dziennikarskich.",
          q2: "Wzorowa polszczyzna i angielski na poziomie redakcyjnym.",
          q3: "Znajomość standardów cytowania, przypisów i weryfikacji faktów.",
          q4: "Umiejętność egzekwowania kalendarza wydawniczego bez konfliktów.",
        },
      },
      events_coordinator: {
        title: "Koordynator wydarzeń i klubów",
        summary:
          "Prowadzisz kalendarz debat, klubów dyskusyjnych i konferencji - od zaproszeń po podsumowania.",
        bullets: {
          b1: "Organizacja spotkań offline i online (do 300 osób).",
          b2: "Kontakt z prelegentami, partnerami i lokalizacjami.",
          b3: "Podsumowania i raportowanie efektów wydarzeń.",
        },
        requirements: {
          q1: "2+ lata w organizacji wydarzeń (konferencje, debaty, spotkania zamknięte).",
          q2: "Sprawna koordynacja prelegentów, partnerów i dostawców.",
          q3: "Angielski w kontakcie z gośćmi zagranicznymi.",
        },
      },
    },
    departments: {
      all: "Wszystkie działy",
      analysis: "Analizy i badania",
      policy: "Polityka publiczna",
      marketing: "Marketing i wzrost",
      advisory: "Doradztwo",
      editorial: "Redakcja",
      operations: "Operacje i wydarzenia",
    },
    engagement: {
      full_time: "Pełny etat",
      part_time: "Część etatu",
      contract: "Współpraca B2B",
      internship: "Staż",
    },
    seniority: {
      junior: "Junior",
      mid: "Regular",
      senior: "Senior",
      lead: "Lead",
    },
    location: {
      remote: "Zdalnie",
      hybrid: "Hybrydowo",
      warsaw: "Warszawa",
      brussels: "Bruksela",
    },
    process: {
      title: "Proces rekrutacji",
      subtitle: "Cztery kroki, maksymalnie trzy tygodnie. Feedback dostajesz na każdym etapie.",
      items: {
        apply: {
          title: "Aplikacja",
          body: "Formularz poniżej. Zamiast CV wystarczy profil i kilka zdań o tym, co chcesz robić.",
          duration: "3 minuty",
        },
        screening: {
          title: "Rozmowa wstępna",
          body: "30 minut o Twoim doświadczeniu, oczekiwaniach i widełkach - bez zagadek.",
          duration: "30 minut",
        },
        task: {
          title: "Zadanie próbne",
          body: "Krótkie, płatne zadanie z realnego backlogu. Maksymalnie 4 godziny pracy.",
          duration: "do 4 godzin, płatne",
        },
        decision: {
          title: "Decyzja i oferta",
          body: "Rozmowa z zespołem, referencje i oferta z jasnymi warunkami współpracy.",
          duration: "do 3 tygodni od zgłoszenia",
        },
      },
    },
    form: {
      title: "Formularz aplikacyjny",
      subtitle: "Trzy krótkie kroki - całość zajmuje około 3 minut.",
      steps: {
        about: { title: "O Tobie", hint: "Kontakt i profil" },
        fit: { title: "Dopasowanie", hint: "Dział, rola, dostępność" },
        message: { title: "Wiadomość", hint: "Kilka zdań zamiast CV" },
      },
      stepLabel: "Krok {{current}} z {{total}}",
      back: "Wstecz",
      next: "Dalej",
      fitOptional:
        "Wszystkie pola w tym kroku są opcjonalne - pomagają nam skierować zgłoszenie do właściwej osoby.",
      firstName: "Imię",
      lastName: "Nazwisko",
      email: "Adres e-mail",
      phone: "Telefon (opcjonalnie)",
      linkedin: "Profil LinkedIn lub portfolio",
      department: "Dział",
      role: "Interesująca Cię rola",
      roleOpen: "Zgłoszenie spontaniczne",
      seniority: "Poziom doświadczenia",
      start: "Możliwy start",
      startOptions: {
        immediately: "Od zaraz",
        month: "W ciągu miesiąca",
        quarter: "W ciągu kwartału",
        later: "Później / do ustalenia",
      },
      message: "Dlaczego Ty i co chcesz u nas robić?",
      messagePlaceholder:
        "Napisz kilka zdań o swoim doświadczeniu i o tym, jaki temat chcesz prowadzić.",
      consent:
        "Zgadzam się na przetwarzanie moich danych w celu prowadzenia rekrutacji przez New European Strategies.",
      submit: "Wyślij zgłoszenie",
      sending: "Wysyłanie...",
      requiredAbout: "Uzupełnij imię, nazwisko i adres e-mail.",
      requiredMessage: "Napisz kilka zdań o sobie - to pole zastępuje CV.",
      invalidEmail: "Podaj poprawny adres e-mail.",
      consentRequired: "Bez zgody na przetwarzanie danych nie możemy rozpatrzyć zgłoszenia.",
      error: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.",
      selectPlaceholder: "Wybierz…",
      success: {
        title: "Zgłoszenie dotarło",
        body: "Potwierdzenie i dalsze kroki wyślemy na {{email}}.",
        points: {
          review: "Każde zgłoszenie czyta człowiek - nie filtrujemy automatem.",
          reply: "Odpowiadamy w ciągu 10 dni roboczych, również gdy odpowiedź brzmi „jeszcze nie”.",
          call: "Jeśli jest dopasowanie, zaprosimy Cię na 30-minutową rozmowę wstępną.",
        },
        again: "Wyślij kolejne zgłoszenie",
      },
    },
    closing: {
      title: "Nie widzisz swojej roli?",
      body: "Napisz i tak. Najlepsze osoby w zespole trafiły do nas ze zgłoszeń spontanicznych.",
      cta: "Aplikuj spontanicznie",
      secondary: "Napisz do nas",
    },
    seo: {
      title: "Kariera - dołącz do zespołu New European Strategies",
      description:
        "Otwarte role w New European Strategies: analizy, polityka publiczna, marketing, doradztwo, redakcja i operacje. Aplikuj online w 3 minuty.",
    },
  },
};

const careersEn = {
  careers: {
    eyebrow: "Careers",
    lead: "We build a think tank where analysis ends in a recommendation and a recommendation ends in a decision. We are hiring analysts, policy specialists, marketers, advisors and editors who want to work on the European agenda.",
    ctaPrimary: "See open roles",
    ctaSecondary: "Send an open application",
    trust: "Applying takes 3 minutes. We answer every application within 10 working days.",
    hero: {
      badge: "Open roles: {{value}}",
      titleTop: "Join the team at",
      titleAccent: "New European Strategies",
      rotatePrefix: "Right now we are hiring:",
      rotating: {
        research: "security and economy analysts",
        policy: "EU legislation specialists",
        marketing: "growth and content marketers",
        advisory: "board-level strategic advisors",
        editorial: "editors working in Polish and English",
      },
    },
    stats: {
      people: { value: "45", label: "people on the team" },
      countries: { value: "9", label: "countries we work from" },
      remote: { value: "100%", label: "roles remote or hybrid" },
      growth: { value: "3x", label: "team growth in 2 years" },
    },
    values: {
      title: "How we work",
      subtitle: "Four principles you can actually see in the calendar, not only in a manifesto.",
      hint: "Pick a principle to see what it looks like day to day.",
      proofLabel: "In practice",
      items: {
        evidence: {
          title: "Evidence before opinion",
          body: "Every claim has data, a source and an author. We do not publish what we cannot defend.",
          proof:
            "Every analysis is reviewed by a second analyst and edited before it reaches readers.",
        },
        ownership: {
          title: "Own your topic",
          body: "You run your area from idea to publication and to the conversation with a decision maker.",
          proof:
            "You publish under your own name and answer media questions about your topic yourself.",
        },
        craft: {
          title: "Craft and pace",
          body: "Short cycles, high editorial quality, realistic deadlines and respect for time off.",
          proof:
            "The recruitment task is paid and capped at 4 hours - we treat working time the same way.",
        },
        europe: {
          title: "A European perspective",
          body: "We work in Polish and English with partners in Brussels, Berlin and Kyiv. Your work travels.",
          proof:
            "You work in two languages daily, and the results land with institutions in several capitals.",
        },
      },
    },
    benefits: {
      title: "What we offer",
      subtitle: "Specifics, not perks-page filler.",
      items: {
        flexible: {
          title: "Flexible collaboration",
          body: "Choose the contract: employment, B2B, freelance or internship. We adapt the workload and mode to your situation.",
        },
        remote: {
          title: "Remote or hybrid",
          body: "Every role can be done remotely or hybrid. You set your hours with the team, not with a rulebook.",
        },
        warsaw: {
          title: "Warsaw office",
          body: "A space for meetings and deep work in central Warsaw, available when you need it.",
        },
        impact: {
          title: "Real impact on your topic",
          body: "You own your dossier from idea to publication. Your name is on every piece.",
        },
        byline: {
          title: "Your name on your work",
          body: "We credit authors, not “the team”. Your analyses build your byline.",
        },
        network: {
          title: "Network and events",
          body: "Access to our expert network, discussion clubs and closed-door events - from day one.",
        },
      },
    },
    roles: {
      title: "Open roles",
      subtitle: "Filter by department. Cannot find your role? Send an open application.",
      all: "All",
      showing: "Showing {{value}} of {{total}} roles",
      empty: "We are not hiring in this department right now - write to us anyway.",
      apply: "Apply for this role",
      details: "Full job offer",
      selected: "Selected role",
      dialog: {
        overview: "About the role",
        responsibilities: "Scope of work",
        requirements: "Requirements",
        close: "Close",
        meta: "Offer details",
      },
      senior_analyst_security: {
        title: "Senior analyst - security and defence",
        summary:
          "You run our European security research line: analyses, policy papers and media commentary.",
        bullets: {
          b1: "Designing and delivering analyses on defence capabilities and the defence industry.",
          b2: "Publishing under your own name and writing briefs for institutions and business.",
          b3: "Representing the think tank in the media and on panels.",
          b4: "Co-hosting a discussion club in your specialisation.",
        },
        requirements: {
          q1: "5+ years in security, defence or international relations analysis.",
          q2: "A documented publication record (analyses, policy papers, commentary).",
          q3: "Fluent Polish and English - written, spoken and on camera.",
          q4: "Familiarity with NATO/EU institutions and the defence industry.",
        },
      },
      analyst_economy: {
        title: "Analyst - economy and energy",
        summary:
          "You connect macro data with EU regulation and explain what it means for companies and public bodies.",
        bullets: {
          b1: "Market and regulatory analyses with a clear recommendation.",
          b2: "Working with Eurostat, ENTSO-E and national data sources.",
          b3: "Cooperating with the newsroom on charts and visualisations.",
        },
        requirements: {
          q1: "3+ years of analytical work in economy, energy or EU regulation.",
          q2: "Comfort with quantitative data (Excel/Python/R) and statistical sources.",
          q3: "Ability to write concise recommendations for decision-makers.",
        },
      },
      data_analyst: {
        title: "Data analyst (project engagement)",
        summary:
          "You build the data layer behind our reports: models, indicator sets and repeatable pipelines.",
        bullets: {
          b1: "Preparing and quality-checking datasets for reports.",
          b2: "Automating indicator and chart updates.",
          b3: "Documenting methodology for readers and reviewers.",
        },
        requirements: {
          q1: "Working knowledge of Python or R plus SQL.",
          q2: "Experience building repeatable pipelines and running data quality checks.",
          q3: "Discipline around methodology documentation and reproducibility.",
        },
      },
      eu_policy_officer: {
        title: "EU policy officer",
        summary:
          "You monitor the Brussels legislative process and turn it into positions and consultations.",
        bullets: {
          b1: "Following Commission, Council and Parliament work on assigned dossiers.",
          b2: "Preparing consultation responses and decision memos.",
          b3: "Maintaining contact with institutions, associations and partners.",
          b4: "Supporting the research team with legal interpretation.",
        },
        requirements: {
          q1: "Experience with the EU legislative process (institutions, chambers, law firms).",
          q2: "Ability to summarise legal documents into decision-ready language.",
          q3: "English at C1 working level; French is a plus.",
          q4: "Readiness to work in Brussels and attend institutional meetings.",
        },
      },
      policy_intern: {
        title: "Internship - public policy",
        summary:
          "A six-month paid internship with real scope: research, notes and publication support.",
        bullets: {
          b1: "Desk research and literature reviews.",
          b2: "Notes from sittings and industry events.",
          b3: "Support with editing and proofreading materials.",
        },
        requirements: {
          q1: "Final-year student or graduate in social sciences, law or economics.",
          q2: "Rigorous research skills and comfort with primary sources.",
          q3: "English sufficient to read EU documentation fluently.",
        },
      },
      growth_marketing_lead: {
        title: "Growth and marketing lead",
        summary:
          "You own readership and membership growth: newsletter, campaigns and the subscription funnel.",
        bullets: {
          b1: "Acquisition and retention strategy (SEO, newsletter, paid campaigns).",
          b2: "Working on data: cohorts, retention, plan conversion.",
          b3: "Managing budget and external contractors.",
          b4: "Growing the think tank brand in Polish and English.",
        },
        requirements: {
          q1: "4+ years in growth marketing, ideally in media or subscriptions.",
          q2: "Hands-on analytics experience: cohorts, retention, campaign attribution.",
          q3: "Practical newsletter and subscription funnel ownership.",
          q4: "Ability to manage budget and external contractors.",
        },
      },
      content_marketing_specialist: {
        title: "Content specialist (part-time)",
        summary:
          "You turn analyses into social, newsletter and video formats without losing precision.",
        bullets: {
          b1: "Running LinkedIn and X channels in Polish and English.",
          b2: "Editing the newsletter and report announcements.",
          b3: "Working with authors on publication distribution.",
        },
        requirements: {
          q1: "2+ years running social channels for an expert brand.",
          q2: "A light touch in Polish and English plus a feel for public affairs.",
          q3: "Basic graphic and video skills for social formats.",
        },
      },
      strategic_advisor: {
        title: "Strategic advisor (expert engagement)",
        summary:
          "You support institutional clients on high-stakes decisions: regulation, risk and geopolitics.",
        bullets: {
          b1: "Scenario workshops and board-level advisory.",
          b2: "Substantive review of reports and positions.",
          b3: "Taking part in advisory projects on a project basis.",
        },
        requirements: {
          q1: "Advisory experience at board or central administration level.",
          q2: "Expert specialisation in regulation, risk or geopolitics.",
          q3: "Ability to run scenario workshops.",
        },
      },
      managing_editor: {
        title: "Managing editor",
        summary:
          "You guard quality, calendar and language across every publication, in both language versions.",
        bullets: {
          b1: "Planning the editorial calendar and enforcing deadlines.",
          b2: "Substantive and language editing in Polish and English.",
          b3: "Citation, footnote and fact-checking standards.",
          b4: "Working with the design team on report layouts.",
        },
        requirements: {
          q1: "5+ years editing analytical or journalistic texts.",
          q2: "Impeccable Polish and editorial-level English.",
          q3: "Knowledge of citation, footnote and fact-checking standards.",
          q4: "Ability to enforce the publishing calendar without friction.",
        },
      },
      events_coordinator: {
        title: "Events and clubs coordinator",
        summary:
          "You run the calendar of debates, discussion clubs and conferences, from invitations to wrap-ups.",
        bullets: {
          b1: "Organising offline and online events for up to 300 people.",
          b2: "Managing speakers, partners and venues.",
          b3: "Reporting on event outcomes.",
        },
        requirements: {
          q1: "2+ years organising events (conferences, debates, closed-door meetings).",
          q2: "Smooth coordination of speakers, partners and vendors.",
          q3: "English for working with international guests.",
        },
      },
    },
    departments: {
      all: "All departments",
      analysis: "Research and analysis",
      policy: "Public policy",
      marketing: "Marketing and growth",
      advisory: "Advisory",
      editorial: "Editorial",
      operations: "Operations and events",
    },
    engagement: {
      full_time: "Full time",
      part_time: "Part time",
      contract: "Contract",
      internship: "Internship",
    },
    seniority: {
      junior: "Junior",
      mid: "Mid",
      senior: "Senior",
      lead: "Lead",
    },
    location: {
      remote: "Remote",
      hybrid: "Hybrid",
      warsaw: "Warsaw",
      brussels: "Brussels",
    },
    process: {
      title: "Hiring process",
      subtitle: "Four steps, three weeks at most. You get feedback at every stage.",
      items: {
        apply: {
          title: "Application",
          body: "The form below. Instead of a CV, a profile and a few sentences are enough.",
          duration: "3 minutes",
        },
        screening: {
          title: "Intro call",
          body: "30 minutes on your experience, expectations and salary range - no guessing games.",
          duration: "30 minutes",
        },
        task: {
          title: "Paid trial task",
          body: "A short, paid task from the real backlog. Four hours of work at most.",
          duration: "up to 4 hours, paid",
        },
        decision: {
          title: "Decision and offer",
          body: "A conversation with the team, references and an offer with clear terms.",
          duration: "within 3 weeks of applying",
        },
      },
    },
    form: {
      title: "Application form",
      subtitle: "Three short steps - about 3 minutes in total.",
      steps: {
        about: { title: "About you", hint: "Contact and profile" },
        fit: { title: "Your fit", hint: "Department, role, availability" },
        message: { title: "Your message", hint: "A few sentences instead of a CV" },
      },
      stepLabel: "Step {{current}} of {{total}}",
      back: "Back",
      next: "Next",
      fitOptional:
        "Every field in this step is optional - it helps us route your application to the right person.",
      firstName: "First name",
      lastName: "Last name",
      email: "Email address",
      phone: "Phone (optional)",
      linkedin: "LinkedIn profile or portfolio",
      department: "Department",
      role: "Role you are interested in",
      roleOpen: "Open application",
      seniority: "Experience level",
      start: "Possible start",
      startOptions: {
        immediately: "Immediately",
        month: "Within a month",
        quarter: "Within a quarter",
        later: "Later / to be agreed",
      },
      message: "Why you, and what do you want to work on?",
      messagePlaceholder:
        "Write a few sentences about your experience and the topic you want to own.",
      consent:
        "I agree to the processing of my data for the purposes of recruitment by New European Strategies.",
      submit: "Send application",
      sending: "Sending...",
      requiredAbout: "Please fill in your first name, last name and email.",
      requiredMessage: "Write a few sentences about yourself - this field replaces a CV.",
      invalidEmail: "Please enter a valid email address.",
      consentRequired: "Without consent to data processing we cannot review your application.",
      error: "Could not send the application. Please try again in a moment.",
      selectPlaceholder: "Select…",
      success: {
        title: "Application received",
        body: "We will send confirmation and next steps to {{email}}.",
        points: {
          review: "A human reads every application - no automated screening.",
          reply: "We reply within 10 working days - also when the answer is “not yet”.",
          call: "If there is a fit, we will invite you to a 30-minute intro call.",
        },
        again: "Send another application",
      },
    },
    closing: {
      title: "Cannot find your role?",
      body: "Write anyway. Some of the best people on the team came from open applications.",
      cta: "Send an open application",
      secondary: "Contact us",
    },
    seo: {
      title: "Careers - join the New European Strategies team",
      description:
        "Open roles at New European Strategies: research, public policy, marketing, advisory, editorial and operations. Apply online in 3 minutes.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", careersPl, true, true);
i18n.addResourceBundle("en", "translation", careersEn, true, true);

/** No-op utrzymujący rejestrację słownika w chunku trasy. */
export function ensureI18n(): void {}

/** Kształt słownika - wykorzystywany przez testy parzystości PL/EN. */
export const careersResources = { pl: careersPl, en: careersEn };
