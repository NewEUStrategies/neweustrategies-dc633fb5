// Słownik strony /careers ("Dołącz do zespołu") - PL/EN.
// Rejestracja przy ewaluacji modułu; `ensureI18n()` trzyma bundle w chunku
// trasy (ten sam wzorzec, co i18n-membership-join / i18n-pricing).
import i18n from "@/lib/i18n";

const careersPl = {
  careers: {
    eyebrow: "Kariera",
    title: "Dołącz do zespołu New European Strategies",
    lead: "Budujemy think tank, w którym analiza kończy się rekomendacją, a rekomendacja - decyzją. Szukamy analityków, ekspertów polityki publicznej, marketerów, doradców i redaktorów, którzy chcą pracować na europejskiej agendzie.",
    ctaPrimary: "Zobacz otwarte role",
    ctaSecondary: "Aplikuj spontanicznie",
    trust: "Aplikacja zajmuje 3 minuty. Odpowiadamy na każde zgłoszenie w ciągu 10 dni roboczych.",
    stats: {
      people: { value: "45", label: "osób w zespole" },
      countries: { value: "9", label: "krajów, z których pracujemy" },
      remote: { value: "100%", label: "ról z pracą zdalną lub hybrydową" },
      growth: { value: "3x", label: "wzrost zespołu w 2 lata" },
    },
    values: {
      title: "Jak pracujemy",
      subtitle: "Cztery zasady, które realnie widać w kalendarzu, a nie tylko w deklaracjach.",
      items: {
        evidence: {
          title: "Dowody przed opinią",
          body: "Każda teza ma dane, źródło i autora. Nie publikujemy tekstów, których nie umiemy obronić.",
        },
        ownership: {
          title: "Własność tematu",
          body: "Prowadzisz swój obszar od pomysłu do publikacji i rozmowy z decydentem - bez łańcucha akceptacji.",
        },
        craft: {
          title: "Rzemiosło i tempo",
          body: "Krótkie cykle, wysoka jakość redakcyjna, realne deadline'y i szacunek do czasu po pracy.",
        },
        europe: {
          title: "Perspektywa europejska",
          body: "Pracujemy w PL i EN, z partnerami w Brukseli, Berlinie i Kijowie. Twoja praca ma zasięg kontynentalny.",
        },
      },
    },
    benefits: {
      title: "Co oferujemy",
      items: {
        b1: "Umowa dopasowana do formy współpracy (UoP, B2B, zlecenie) i jawne widełki na etapie rozmowy.",
        b2: "Praca zdalna lub hybrydowa, elastyczne godziny, biura w Warszawie i Brukseli.",
        b3: "Budżet szkoleniowy i konferencyjny oraz publikacje pod własnym nazwiskiem.",
        b4: "Dostęp do sieci ekspertów, klubów dyskusyjnych i wydarzeń zamkniętych.",
      },
    },
    roles: {
      title: "Otwarte role",
      subtitle: "Filtruj po dziale. Nie widzisz swojej roli? Wyślij zgłoszenie spontaniczne.",
      all: "Wszystkie",
      empty: "W tym dziale nie prowadzimy teraz rekrutacji - napisz do nas mimo to.",
      apply: "Aplikuj na tę rolę",
      details: "Zakres obowiązków",
      selected: "Wybrana rola",
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
        },
        screening: {
          title: "Rozmowa wstępna",
          body: "30 minut o Twoim doświadczeniu, oczekiwaniach i widełkach - bez zagadek.",
        },
        task: {
          title: "Zadanie próbne",
          body: "Krótkie, płatne zadanie z realnego backlogu. Maksymalnie 4 godziny pracy.",
        },
        decision: {
          title: "Decyzja i oferta",
          body: "Rozmowa z zespołem, referencje i oferta z jasnymi warunkami współpracy.",
        },
      },
    },
    form: {
      title: "Formularz aplikacyjny",
      subtitle: "Wypełnij poniższe pola - odpowiemy w ciągu 10 dni roboczych.",
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
      required: "Uzupełnij imię, nazwisko, e-mail i wiadomość.",
      invalidEmail: "Podaj poprawny adres e-mail.",
      consentRequired: "Bez zgody na przetwarzanie danych nie możemy rozpatrzyć zgłoszenia.",
      ok: "Dziękujemy - zgłoszenie dotarło. Odezwiemy się mailem.",
      error: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.",
      selectPlaceholder: "Wybierz…",
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
    title: "Join the New European Strategies team",
    lead: "We build a think tank where analysis ends in a recommendation and a recommendation ends in a decision. We are hiring analysts, policy specialists, marketers, advisors and editors who want to work on the European agenda.",
    ctaPrimary: "See open roles",
    ctaSecondary: "Send an open application",
    trust: "Applying takes 3 minutes. We answer every application within 10 working days.",
    stats: {
      people: { value: "45", label: "people on the team" },
      countries: { value: "9", label: "countries we work from" },
      remote: { value: "100%", label: "roles remote or hybrid" },
      growth: { value: "3x", label: "team growth in 2 years" },
    },
    values: {
      title: "How we work",
      subtitle: "Four principles you can actually see in the calendar, not only in a manifesto.",
      items: {
        evidence: {
          title: "Evidence before opinion",
          body: "Every claim has data, a source and an author. We do not publish what we cannot defend.",
        },
        ownership: {
          title: "Own your topic",
          body: "You run your area from idea to publication and to the conversation with a decision maker.",
        },
        craft: {
          title: "Craft and pace",
          body: "Short cycles, high editorial quality, realistic deadlines and respect for time off.",
        },
        europe: {
          title: "A European perspective",
          body: "We work in Polish and English with partners in Brussels, Berlin and Kyiv. Your work travels.",
        },
      },
    },
    benefits: {
      title: "What we offer",
      items: {
        b1: "A contract that fits the engagement (employment, B2B, freelance) with transparent ranges from the first call.",
        b2: "Remote or hybrid work, flexible hours, offices in Warsaw and Brussels.",
        b3: "Training and conference budget, plus publications under your own name.",
        b4: "Access to our expert network, discussion clubs and closed-door events.",
      },
    },
    roles: {
      title: "Open roles",
      subtitle: "Filter by department. Cannot find your role? Send an open application.",
      all: "All",
      empty: "We are not hiring in this department right now - write to us anyway.",
      apply: "Apply for this role",
      details: "Scope of work",
      selected: "Selected role",
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
        },
        screening: {
          title: "Intro call",
          body: "30 minutes on your experience, expectations and salary range - no guessing games.",
        },
        task: {
          title: "Paid trial task",
          body: "A short, paid task from the real backlog. Four hours of work at most.",
        },
        decision: {
          title: "Decision and offer",
          body: "A conversation with the team, references and an offer with clear terms.",
        },
      },
    },
    form: {
      title: "Application form",
      subtitle: "Fill in the fields below - we reply within 10 working days.",
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
      required: "Please fill in first name, last name, email and message.",
      invalidEmail: "Please enter a valid email address.",
      consentRequired: "Without consent to data processing we cannot review your application.",
      ok: "Thank you - your application is in. We will get back to you by email.",
      error: "Could not send the application. Please try again in a moment.",
      selectPlaceholder: "Select…",
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
