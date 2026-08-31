import i18n from "./i18n";

// Profile / Billing / Checkout i18n bundle - registered as overlay on top of base i18n.
// Using addResourceBundle keeps the huge base i18n.ts untouched and lets us scale modules independently.

const pl = {
  profile: {
    title: "Mój profil",
    subtitle: "Centrum zarządzania",
    // Etykiety szuflady ustawień trafiają tu, a nie do i18n-profile-extras2
    // (gdzie żyje reszta `profile.sidebar.*`), bo to chrom powłoki trasy
    // /profile - rejestruje ją ten sam moduł, który powłoka już ładuje.
    // Deep merge addResourceBundle scala oba fragmenty w jedną gałąź.
    sidebar: {
      expand: "Rozwiń ustawienia",
      collapse: "Zwiń ustawienia",
    },
    privacy: {
      title: "Prywatność i dane",
      hint: "Jedno miejsce na wszystko, co dotyczy Twojej prywatności: kto Cię widzi i kto może się z Tobą skontaktować, na co się zgadzasz oraz jak pobrać albo usunąć swoje dane. Wybory zapisują się natychmiast, są egzekwowane po stronie serwera i audytowane.",
      consentsSection: "Zgody",
      dataSection: "Twoje dane (RODO)",
      securityLink: "Bezpieczeństwo konta: hasło, e-mail, sesje i logowanie dwuskładnikowe",
      registryNote:
        "Każdą decyzję zapisujemy w niezmiennym rejestrze RODO (data, wersja treści, źródło, adres IP i przeglądarka). Zgody cookie działają też na tym urządzeniu bez logowania.",
      openBanner: "Otwórz ustawienia banera cookie",
    },
    author: {
      title: "Profil eksperta",
      intro:
        "Publiczny profil eksperta - widoczny na /author/<slug> oraz w widget BIO we wpisach. Niezależny od profilu prywatnego (dane kontaktowe mogą się różnić).",
      create: "Utwórz profil eksperta",
      noRole:
        "Profil eksperta jest dostępny tylko dla użytkowników z rolą autora lub administratora.",
      isPublic: "Widoczny publicznie",
      isPublicHint:
        "Nowy profil startuje jako ukryty. Wyłączenie ukrywa profil na stronie eksperta i w widget BIO autora we wpisach.",
      loadError: "Nie udało się wczytać profilu autora. Odśwież stronę.",
      avatarSection: "Zdjęcie eksperta",
      basicSection: "Dane zawodowe",
      contactSection: "Dane kontaktowe (niepubliczne)",
      contactPrivacyHint:
        "E-mail i telefon nie są publikowane na stronie profilu - widzisz je tylko Ty i administratorzy. Czytelnicy kontaktują się przez formularz zapytań.",
      contactEmail: "E-mail kontaktowy",
      website: "Strona WWW",
      socialSection: "Media społecznościowe",
      socialLabel: "Etykieta",
      customSocials: "Własne linki (z ikoną)",
      noCustomSocials: "Brak własnych linków. Dodaj np. Threads, Bluesky, Mastodon...",
      iconUrl: "URL ikony (opcjonalnie)",
      bioBulletsHint:
        "Bio w formie punktorów - maksymalnie 5. Kolor punktora dziedziczony z ustawień tenanta (admin › Layouty ekspertów). Edycja synchronizuje profil prywatny.",
      bioPl: "Bio - punktory (PL)",
      bioEn: "Bio - punktory (EN)",
      ogRefreshBtn: "Odśwież podgląd społecznościowy",
      ogRefreshHint:
        "Po zmianie zdjęcia lub bio odśwież podgląd społecznościowy - wymusi to nowy og:image w linkach.",
      ogRefreshOk:
        "Podgląd społecznościowy zaktualizowany. Otwórz Post Debugger, aby wymusić rescrape.",
      ogRefreshError:
        "Nie udało się odświeżyć podglądu społecznościowego. Uzupełnij slug profilu i spróbuj ponownie.",
      media: {
        heading: "Obecność w mediach, materiały zewnętrzne, podcasty",
        hint: "Dodawaj linki do wywiadów, wystąpień, op-edów i podcastów, w których się pojawiasz. Publiczne wpisy pokażą się na Twoim profilu eksperta w sekcji „W mediach”.",
        empty:
          "Nie masz jeszcze dodanych wystąpień medialnych. Kliknij „Dodaj” i wklej link do wywiadu, op-eda lub podcastu.",
        kind: "Rodzaj",
        language: "Język (opcjonalnie)",
        outlet: "Wydawca / stacja / podcast",
        title: "Tytuł materiału",
        titlePlaceholder: "np. Wywiad o polityce bezpieczeństwa UE",
        url: "Link (URL)",
        cover: "Okładka - URL obrazu (opcjonalnie)",
        publishedOn: "Data publikacji",
        isPublic: "Widoczne na profilu publicznym",
        added: "Dodano wpis medialny",
        removed: "Usunięto wpis medialny",
        saved: "Zapisano",
        validation: "Wypełnij tytuł, wydawcę i datę.",
      },
    },
    nav: {
      overview: "Przegląd",
      edit: "Edycja profilu",
      account: "Konto",
      author: "Profil autora",
      social: "Media społecznościowe",
      interests: "Zainteresowania",
      personality: "Osobowość",
      bookmarks: "Zapisane materiały",
      notifications: "Powiadomienia",
      follows: "Obserwowane",
      network: "Moja sieć",
      membership: "Członkostwo",
      organization: "Organizacja",
      billing: "Dane rozliczeniowe",
      plan: "Plan i członkostwo",
      subscription: "Subskrypcja",
      orders: "Zamówienia",
      payments: "Płatności i faktury",
      tickets: "Moje zgłoszenia",
      security: "Bezpieczeństwo konta",
      privacy: "Prywatność i dane",
      notificationSettings: "Ustawienia powiadomień",
      expertRequests: "Zapytania do ekspertów",
      events: "Moje wydarzenia",
      cart: "Mój koszyk",
    },
    navGroups: {
      identity: "Tożsamość",
      content: "Treści i personalizacja",
      // Do 06.08 jedna grupa nazywała się „Płatności i bezpieczeństwo" i mieściła
      // osiem pozycji, w tym prywatność i bezpieczeństwo konta - czyli dwie
      // rzeczy, które z płatnościami nie mają nic wspólnego. Rozdzielone.
      finance: "Płatności i plan",
      privacy: "Prywatność i bezpieczeństwo",
    },
    edit: {
      title: "Edycja profilu",
      intro: "Wszystkie dane Twojej tożsamości w jednym miejscu.",
      tabs: {
        basic: "Dane podstawowe",
        expert: "Profil eksperta",
        social: "Social i bio",
      },
    },
    overview: {
      welcome: "Witaj, {{name}}",
      memberLabel: "Członek",
      memberSince: "Z nami od {{date}}",
      planActive: "Aktywny plan",
      planNone: "Brak aktywnego członkostwa",
      seePlans: "Zobacz plany",
      manageBilling: "Zarządzaj subskrypcją",
    },
    account: {
      displayName: "Nazwa wyświetlana",
      displayNameAlt: "(nick konta)",
      firstName: "Imię",
      lastName: "Nazwisko",
      jobTitle: "Stanowisko",
      currentCompany: "Aktualna firma",
      specialization: "Specjalizacja",

      location: "Miejsce zamieszkania",
      locationPh: "Miasto, kraj",
      phone: "Telefon",
      phonePh: "+48 600 000 000",
      gender: "Płeć",
      genderHint: "Domyślnie wykrywana automatycznie z imienia. Możesz ją nadpisać.",
      genderAuto: "Wykryj automatycznie z imienia",
      genderMale: "Mężczyzna",
      genderFemale: "Kobieta",
      genderNeutral: "Neutralna / inna",
      personalSection: "Dane osobowe",
      contactSection: "Dane kontaktowe",
      mediaSection: "Awatar i tło",
      privacyHintTitle: "Prywatność i widoczność przeniosły się",
      privacyHintBody:
        "Widoczność w wyszukiwarce osób, przyjmowanie zapytań do eksperta, kto może zacząć z Tobą rozmowę i zaprosić Cię do sieci, potwierdzenia odczytu, wskaźnik pisania i status dostępności - wszystko w jednym miejscu, razem ze zgodami i prawami do danych.",
      coverPlaceholder: "Brak tła profilu",
      avatarPlaceholder: "Brak awatara",
      unnamed: "Użytkownik",
      email: "E-mail",
      emailReadonly: "Adres e-mail zmieniany przez ustawienia konta.",
      bio: "Krótki opis",
      avatar: "Awatar (URL)",
      cover: "Tło (URL)",
      uploadAvatar: "Wgraj awatar",
      uploadCover: "Wgraj tło",
      avatarHint: "Zalecane: 512×512 px, kwadrat, max 2 MB (JPG/PNG/WEBP)",
      coverHint: "Zalecane: 1500×500 px, panorama, max 5 MB (JPG/PNG/WEBP)",
      uploading: "Wgrywanie...",
      uploadProgress: "Wgrywanie: {{percent}}%",
      uploadSuccess: "Wgrano pomyślnie",
      uploadFailed: "Wgrywanie nie powiodło się",
      uploadError: "Nie udało się wgrać pliku",
      fileTooLarge: "Plik jest zbyt duży",

      save: "Zapisz zmiany",
      saved: "Zapisano",
      saveError: "Nie udało się zapisać",
      tip: {
        displayName:
          "Tak będziesz widoczny/a publicznie - przy komentarzach, wpisach i w nagłówku powitania. Nie musi to być prawdziwe imię.",
        firstName:
          "Twoje prawdziwe imię. Wykorzystywane do personalizacji powitań i (opcjonalnie) na fakturach.",
        lastName: "Twoje prawdziwe nazwisko. Wykorzystywane w komunikacji oficjalnej i fakturach.",
        jobTitle: "Stanowisko, które wyświetla się przy Twoim profilu autora.",
        currentCompany:
          "Firma, w której obecnie pracujesz - pokazywana publicznie obok stanowiska.",
        location: "Miasto i kraj. Pomaga czytelnikom rozpoznać kontekst Twoich publikacji.",
        phone: "Numer wewnętrzny, widoczny tylko dla zespołu redakcyjnego.",
        email: "Adres logowania. Aby go zmienić, użyj zakładki Bezpieczeństwo.",
        bio: "Krótki biogram (do 500 znaków) widoczny na publicznej stronie autora.",
        avatar: "Zdjęcie profilowe - wyświetlane wszędzie, gdzie widoczny jest Twój nick.",
        cover: "Panorama nad profilem autora i na stronie publicznej.",
        save: "Zapisuje wszystkie zmiany na karcie Konto.",
      },
    },
    inline: {
      viewAsGuest: "Podgląd jak gość",
      editMode: "Tryb edycji",
      adminPanel: "Panel administracyjny",
      contactSection: "Dane kontaktowe",
      activitySection: "Aktywność i obserwowane",
      bioPlaceholder:
        "Opowiedz krótko o sobie - czym się zajmujesz, jakie tematy Cię interesują...",
      addJobTitle: "Dodaj stanowisko",
      addCompany: "Dodaj firmę",
      addLocation: "Dodaj lokalizację",
      addPhone: "Dodaj telefon",
      addLinkedin: "Dodaj LinkedIn",
      addTwitter: "Dodaj X (Twitter)",
      addSpecialization: "Dodaj specjalizację",
      interestsHint: "Wybierz obserwowane tematy, kategorie i tagi.",
      shortcuts: "Skróty",
      notSet: "Nie ustawiono",
      clickToEdit: "Kliknij, aby edytować",
      saving: "Zapisywanie...",
      addAvatar: "Dodaj zdjęcie",
      changeAvatar: "Zmień",
      avatarSize: "400 × 400 px",
    },

    security: {
      privacyLink: "Prywatność i dane: widoczność, zgody, eksport i usunięcie konta",
      changePassword: "Zmień hasło",
      currentPassword: "Obecne hasło",
      newPassword: "Nowe hasło",
      confirmPassword: "Powtórz hasło",
      update: "Zaktualizuj hasło",
      updated: "Hasło zmienione. Pozostałe sesje zostały wylogowane.",
      mismatch: "Hasła nie są identyczne",
      tooShort: "Hasło musi mieć min. 8 znaków",
      wrongCurrent: "Obecne hasło jest nieprawidłowe.",
      signOut: "Wyloguj",
      sessions: "Sesje",
      lastSignIn: "Ostatnie logowanie",
      signOutOthers: "Wyloguj pozostałe sesje",
      signedOutOthers: "Wylogowano pozostałe sesje.",
      currentRequired: "Podaj obecne hasło, aby potwierdzić, że to Ty.",
      sameAsCurrent: "Nowe hasło jest takie samo jak obecne. Wpisz inne.",
      sessionExpired: "Twoja sesja wygasła. Zaloguj się ponownie i powtórz zmianę.",
      exportFailed: "Nie udało się przygotować eksportu. Spróbuj ponownie.",
      export: {
        title: "Twoje dane (RODO)",
        subtitle:
          "Pobierz kopię danych osobowych, które o Tobie przechowujemy (art. 15 i 20 RODO), jako plik JSON: profil i profil eksperta, sekcje CV oraz wzmianki medialne, sieć kontaktów i rekomendacje, czat (Twoje wiadomości i metadane rozmów), zapytania do ekspertów, kluby dyskusyjne (członkostwa i Twoje wypowiedzi), komentarze, obserwacje, zamówienia, zgody i preferencje.",
        scopeNote:
          "Plik niesie własny manifest: spis wszystkich sekcji oraz to, czego świadomie nie zawiera i dlaczego (na przykład wiadomości napisanych przez inne osoby - art. 15 ust. 4 RODO).",
        busy: "Przygotowywanie...",
        download: "Pobierz moje dane (JSON)",
      },
      email: {
        title: "Adres e-mail",
        subtitle: "Zmiana wymaga potwierdzenia linkiem wysłanym na nowy adres.",
        current: "Obecny adres",
        newEmail: "Nowy adres e-mail",
        submit: "Zmień adres e-mail",
        sent: "Wysłaliśmy link potwierdzający na nowy adres.",
        invalid: "Podaj poprawny adres e-mail.",
        needPassword: "Podaj obecne hasło, aby potwierdzić.",
        sameAsCurrent: "To jest Twój obecny adres e-mail - nie ma czego zmieniać.",
      },
      danger: {
        title: "Usuń konto",
        subtitle:
          "Trwale usuwa konto i wszystkie powiązane dane (zakładki, obserwacje, wyniki). Operacji nie można cofnąć.",
        button: "Usuń moje konto",
        confirmTitle: "Na pewno usunąć konto?",
        confirmBody:
          "Ta operacja jest nieodwracalna. Aby potwierdzić, wpisz swoje hasło. Usuwamy profil, zakładki, obserwacje i wyniki testów.",
        passwordLabel: "Potwierdź hasłem",
        cancel: "Anuluj",
        confirm: "Usuń konto na stałe",
        deleted: "Konto zostało usunięte.",
        deletedWithRetention_one:
          "Konto zostało usunięte. Zachowaliśmy 1 zanonimizowany dowód księgowy - bez Twoich danych osobowych.",
        deletedWithRetention_few:
          "Konto zostało usunięte. Zachowaliśmy {{count}} zanonimizowane dowody księgowe - bez Twoich danych osobowych.",
        deletedWithRetention_many:
          "Konto zostało usunięte. Zachowaliśmy {{count}} zanonimizowanych dowodów księgowych - bez Twoich danych osobowych.",
        deletedWithRetention_other:
          "Konto zostało usunięte. Zachowaliśmy {{count}} zanonimizowanych dowodów księgowych - bez Twoich danych osobowych.",
        failed: "Nie udało się usunąć konta.",
        retentionTitle: "Co zostaje po usunięciu konta",
        retentionBody:
          "Historia płatności (kwoty, waluty, daty, numery transakcji u operatora) oraz zapisy o wykupionym dostępie zostają jako dowód księgowy, ale tracisz z nimi związek: usuwamy identyfikator konta, adres e-mail do potwierdzeń i dane opisowe, a w ich miejsce wchodzi nieodwracalny pseudonim. Darmowe przyznania dostępu, które nic nie dowodzą, usuwamy razem z kontem.",
        retentionBasis:
          "Podstawa: art. 74 ust. 2 ustawy o rachunkowości (5 lat od końca roku obrotowego) w związku z art. 17 ust. 3 lit. b RODO. Po tym terminie zapisy usuwamy automatycznie.",
      },
      tip: {
        currentPassword: "Podaj obecne hasło, aby potwierdzić, że to Ty.",
        newPassword: "Minimum 8 znaków. Używaj kombinacji liter, cyfr i znaków specjalnych.",
        confirmPassword: "Powtórz nowe hasło, żeby uniknąć literówki.",
        update: "Zapisuje nowe hasło i wylogowuje pozostałe sesje.",
        signOut: "Wylogowuje Cię na tym urządzeniu.",
        signOutOthers: "Wylogowuje wszystkie pozostałe sesje na innych urządzeniach.",
      },
      mfa: {
        title: "Uwierzytelnianie dwuskładnikowe (TOTP)",
        subtitle:
          "Dodatkowa warstwa ochrony: przy logowaniu poprosimy o kod z aplikacji uwierzytelniającej.",
        statusLabel: "Status: ",
        statusEnabled: "Włączone",
        statusDisabled: "Wyłączone",
        statusUnknown: "Nieznany",
        loadFailed:
          "Nie udało się sprawdzić drugiego składnika. To NIE znaczy, że jest wyłączony - odśwież stronę.",
        enroll: "Skonfiguruj aplikację uwierzytelniającą",
        scanInstruction:
          "Zeskanuj ten kod QR w aplikacji uwierzytelniającej (Google Authenticator, 1Password, Authy…).",
        manualIntro: "Nie możesz zeskanować kodu? Wpisz ten klucz ręcznie:",
        codeLabel: "Kod 6-cyfrowy",
        codePlaceholder: "000000",
        activate: "Aktywuj",
        cancel: "Anuluj",
        activated: "Uwierzytelnianie dwuskładnikowe włączone.",
        invalidCode: "Wpisz 6-cyfrowy kod z aplikacji.",
        enrollError: "Nie udało się rozpocząć konfiguracji. Spróbuj ponownie.",
        verifyError: "Nieprawidłowy kod. Sprawdź go i spróbuj ponownie.",
        enrolledTitle: "Aktywne aplikacje uwierzytelniające",
        defaultFactorName: "Aplikacja uwierzytelniająca",
        addedOn: "Dodano {{date}}",
        loading: "Wczytywanie…",
        none: "Brak skonfigurowanych metod.",
        remove: "Usuń",
        removeTitle: "Usunąć tę metodę?",
        removeBody:
          "Po usunięciu logowanie nie będzie już wymagało kodu z tej aplikacji. Potwierdź hasłem.",
        removeLastBody:
          "To Twoja OSTATNIA metoda dwuskładnikowa. Po usunięciu konto będzie chronione wyłącznie hasłem. Potwierdź hasłem.",
        removePasswordLabel: "Potwierdź hasłem",
        removeConfirm: "Usuń metodę",
        removed: "Metoda została usunięta.",
        removeError: "Nie udało się usunąć metody.",
        wrongPassword: "Obecne hasło jest nieprawidłowe.",
        challenge: {
          title: "Weryfikacja dwuetapowa",
          description: "Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej, aby kontynuować.",
          codeLabel: "Kod 6-cyfrowy",
          verify: "Zweryfikuj",
          cancel: "Anuluj",
          noFactor: "Do tego konta nie przypisano aplikacji uwierzytelniającej.",
          failed: "Weryfikacja nie powiodła się. Sprawdź kod i spróbuj ponownie.",
        },
      },
    },
    billing: {
      title: "Dane rozliczeniowe",
      subtitle: "Wykorzystywane na fakturach i w procesie zakupu.",
      isCompany: "Jestem firmą",
      fullName: "Imię i nazwisko",
      company: "Nazwa firmy",
      taxId: "NIP",
      email: "E-mail na fakturę",
      phone: "Telefon",
      addressLine1: "Adres - linia 1",
      addressLine2: "Adres - linia 2 (opcjonalnie)",
      city: "Miasto",
      postalCode: "Kod pocztowy",
      region: "Województwo/region",
      country: "Kraj",
      save: "Zapisz dane",
      saved: "Dane zapisane",
      saveError: "Nie udało się zapisać danych. Spróbuj ponownie.",
      taxIdFormat: "Nieprawidłowy format NIP - wpisz 10 cyfr (możesz użyć myślników).",
      taxIdChecksum: "NIP ma błędną cyfrę kontrolną - sprawdź numer.",
      taxIdVatFormat: "Nieprawidłowy format numeru VAT.",
      tip: {
        isCompany: "Włącz, jeśli kupujesz jako firma - pojawi się pole na NIP.",
        fullName: "Pełne imię i nazwisko, jak ma być widoczne na fakturze.",
        company: "Oficjalna nazwa firmy do faktur.",
        taxId: "Numer identyfikacji podatkowej (NIP/VAT). Wymagany dla kupujących firmowych.",
        email: "Adres, na który wyślemy fakturę PDF.",
        phone: "Telefon kontaktowy do pytań związanych z zamówieniem.",
        addressLine1: 'Ulica i numer (np. „Marszałkowska 1").',
        addressLine2: "Mieszkanie, piętro, lokal - opcjonalnie.",
        city: "Miasto, w którym mieści się adres do faktury.",
        postalCode: "Kod pocztowy adresu rozliczeniowego.",
        region: "Województwo, stan lub region - jeśli dotyczy.",
        country: "Dwuliterowy kod kraju ISO (np. PL, DE, US).",
        save: "Zapisuje dane rozliczeniowe na Twoim koncie.",
      },
    },
    planPage: {
      activeTitle: "Aktywny plan",
      noPlan: "Nie masz jeszcze aktywnego planu.",
      priceLabel: "Cena",
      chooseCta: "Wybierz plan",
      details: "Szczegóły",
      switchTitle: "Zmiana planu",
      switchHint:
        "Warianty wynikają z identyfikatora ceny (lookup_key), więc odpowiadają dokładnie proracji naliczanej przez operatora płatności.",
      upgradesTitle: "Wyżej",
      downgradesTitle: "Niżej",
      upgradeNote: "dopłata proporcjonalna od razu",
      downgradeNote: "obowiązuje od kolejnego okresu",
      upgradeCta: "Przejdź wyżej",
      downgradeCta: "Przejdź niżej",
      historyTitle: "Ostatnie płatności",
      historyAll: "Wszystkie płatności",
      statusCard: {
        title: "Status członkostwa",
        status: "Status",
        renewsAt: "Kolejne odnowienie",
        endsAt: "Dostęp do",
        method: "Metoda płatności",
        noMethod: "Brak zapisanej metody płatności.",
        methodError: "Nie udało się pobrać metody płatności.",
        expires: "ważna do {{date}}",
      },
      subStatus: {
        active: "Aktywna",
        trialing: "Okres próbny",
        cancelScheduled: "W trakcie zmiany - anulowanie zaplanowane",
        pastDue: "Zaległość w płatności",
        paused: "Wstrzymana",
        canceled: "Anulowana",
        grantLifetime: "Dostęp dożywotni (nadanie)",
        grantActive: "Dostęp z nadania",
        none: "Brak członkostwa",
      },
      howPayments: {
        title: "Jak działają płatności",
        intro:
          "Wszystkie płatności na naszej platformie obsługuje Stripe - certyfikowany operator płatności. My otrzymujemy tylko potwierdzenie transakcji i dane potrzebne do rozliczenia dostępu.",
        points: {
          processor: {
            title: "Stripe jako operator płatności",
            body: "Zakup i odnowienia realizowane są w bezpiecznym formularzu Stripe, osadzonym w naszej stronie lub w portalu klienta Stripe.",
          },
          noCardData: {
            title: "Nie przechowujemy danych karty",
            body: "Numer karty, data ważności i kod CVC trafiają bezpośrednio do Stripe. Na naszych serwerach nigdy nie są zapisywane - widzimy wyłącznie markę karty i cztery ostatnie cyfry.",
          },
          security: {
            title: "Bezpieczeństwo i zgodność",
            body: "Stripe działa zgodnie z PCI DSS Level 1 i obsługuje silne uwierzytelnianie (3D Secure / SCA) tam, gdzie wymaga tego bank.",
          },
          invoices: {
            title: "Faktury i potwierdzenia",
            body: "Dokumenty do każdej płatności znajdziesz w historii powyżej, a pełne zestawienie - w portalu klienta Stripe.",
          },
          renewals: {
            title: "Odnowienia i anulowanie",
            body: "Subskrypcja odnawia się automatycznie do momentu anulowania. Plan, metodę płatności i rezygnację zmienisz w sekcji Płatności i bezpieczeństwo lub w portalu klienta.",
          },
        },
        footnote:
          "Masz pytanie do konkretnej transakcji? Skorzystaj z wyszukiwarki faktur powyżej lub napisz do nas - podaj numer transakcji, nigdy pełnego numeru karty.",
      },
      history: {
        title: "Faktury i płatności",
        pageTitle: "Historia płatności",
        pageHint:
          "Pełny rejestr zakupów, odnowień subskrypcji i wystawionych dokumentów. Możesz pobrać zestawienie jako CSV lub PDF.",
        all: "Zobacz wszystkie",
        empty: "Brak płatności - pojawią się po pierwszym zakupie.",
        colNumber: "Numer",
        colDate: "Data",
        colKind: "Rodzaj",
        colAmount: "Kwota",
        colCurrency: "Waluta",
        colStatus: "Status",
        colDiscount: "Rabat",
        colCoupon: "Kod promocyjny",
        colDocument: "Szczegóły",
        discount: "Rabat {{amount}}",
        gift: "Prezent",
        details: "Szczegóły",
        exportCsv: "Pobierz CSV",
        exportPdf: "Pobierz PDF",
        exportTitle: "Historia płatności",
        generatedAt: "Wygenerowano: {{date}}",
        popupBlocked: "Przeglądarka zablokowała okno wydruku - zezwól na wyskakujące okna.",
        kind: {
          invoice: "Faktura",
          receipt: "Paragon",
          credit_note: "Korekta",
          subscription: "Subskrypcja",
          one_time: "Zakup jednorazowy",
          grant: "Dostęp przyznany",
        },
        status: {
          paid: "Opłacone",
          open: "Otwarte",
          void: "Anulowane",
          refunded: "Zwrócone",
          pending: "Oczekujące",
          processing: "Przetwarzane",
          failed: "Nieudane",
          canceled: "Anulowane",
          granted: "Przyznane",
        },
      },
      syncCta: "Synchronizuj ze Stripe",
      syncOk: "Zsynchronizowano stan subskrypcji.",
      syncError: "Nie udało się zsynchronizować stanu subskrypcji.",
      grantTitle: "Dostęp przyznany poza planem",
      grantLifetime: "dożywotnio",
      grantExpert: "Ekspert New European Strategies",
      grantSource: {
        manual: "nadanie ręczne",
        donation: "z darowizny",
        import: "import",
        expert: "Ekspert New European Strategies",
        gift: "Prezent",
      },
    },

    subscription: {
      title: "Twoje członkostwo",
      none: "Nie masz aktywnego członkostwa.",
      paymentStatus: "Status ostatniej płatności",
      plan: "Plan",
      status: "Status",
      startedAt: "Aktywna od",
      renewsAt: "Odnowienie",
      cancelsAt: "Wygasa",
      cancel: "Anuluj subskrypcję",
      cancelConfirm: "Subskrypcja pozostanie aktywna do końca okresu rozliczeniowego.",
      canceled: "Subskrypcja anulowana",
      cancelFailed:
        "Nie udało się anulować subskrypcji. Spróbuj ponownie lub skontaktuj się z nami.",
      keep: "Zostaw subskrypcję",
      accessUntil: "Subskrypcja anulowana - dostęp pozostaje aktywny do {{date}}.",
      resume: "Wznów subskrypcję",
      resumed: "Subskrypcja wznowiona",
      resumeError: "Nie udało się wznowić subskrypcji.",
      change: "Zmień plan",
      changePlan: {
        title: "Zmiana planu",
        hint: "Różnica ceny rozliczana jest proporcjonalnie od razu: przy przejściu wyżej dopłacasz za pozostałą część okresu, przy przejściu niżej nadpłata pomniejszy kolejną fakturę.",
        cancelNote:
          "Zmiana planu anuluje zaplanowane wygaśnięcie - subskrypcja będzie się odnawiać.",
        placeholder: "Wybierz nowy plan",
        cta: "Zmień plan",
        success: "Plan zmieniony",
        error: "Nie udało się zmienić planu. Spróbuj ponownie lub skontaktuj się z nami.",
      },
      portal: {
        changeHint:
          "Przejście na wyższy plan działa od razu (dopłata proporcjonalna), niższy plan zacznie obowiązywać od kolejnego okresu.",
        upgradeNote: "Wyższy plan: dopłata proporcjonalna zostanie pobrana od razu.",
        downgradeNote: "Niższy plan: zmiana wejdzie w życie po zakończeniu opłaconego okresu.",
        downgradeScheduled: "Zmiana planu zaplanowana na koniec okresu rozliczeniowego",
        updatePayment: "Zaktualizuj metodę płatności",
        openPortal: "Faktury i dane płatnika",
        manage: "Zarządzaj w portalu płatności",
        manageHint:
          "W portalu operatora zmienisz plan i cenę, zaktualizujesz metodę płatności, pobierzesz faktury lub anulujesz subskrypcję.",
        opening: "Otwieram portal...",
        noCustomer: "Nie znaleźliśmy aktywnego profilu płatności. Wykup plan, aby otworzyć portal.",
        error: "Nie udało się otworzyć portalu płatności. Spróbuj ponownie.",
        pastDue:
          "Ostatnia płatność się nie powiodła. Zaktualizuj metodę płatności, aby zachować dostęp.",
        secureNote: "Dane karty obsługuje operator płatności - nie przechowujemy ich w serwisie.",
        status: {
          active: "Aktywna",
          trialing: "Okres próbny",
          past_due: "Zaległa płatność",
          paused: "Wstrzymana",
          canceled: "Anulowana",
        },
        paused: {
          note: "Subskrypcja jest wstrzymana - dostęp do treści premium jest zawieszony do czasu wznowienia.",
          cta: "Wznów subskrypcję",
          success: "Subskrypcja wznowiona",
        },
        preview: {
          loading: "Liczymy koszt zmiany...",
          upgrade: "Do zapłaty teraz: {{amount}}",
          downgrade: "Od {{date}} zapłacisz {{amount}}",
          unavailable: "Dokładnej kwoty nie udało się pobrać - operator policzy ją przy zmianie.",
        },
        seats: {
          title: "Liczba miejsc",
          hint: "Zwiększenie miejsc rozliczamy proporcjonalnie od razu, zmniejszenie obowiązuje od kolejnego okresu.",
          label: "Miejsca",
          cta: "Zapisz liczbę miejsc",
          success: "Liczba miejsc zaktualizowana",
          error: "Nie udało się zmienić liczby miejsc. Spróbuj ponownie.",
        },
      },
    },
    orders: {
      title: "Historia płatności",
      empty: "Brak zamówień.",
      documents: {
        title: "Dokumenty rozliczeniowe",
        hint: "Faktury i paragony z zakupów oraz każdego odnowienia subskrypcji.",
        empty: "Brak dokumentów - pojawią się po pierwszej płatności.",
        colDate: "Data",
        colNumber: "Numer",
        colKind: "Rodzaj",
        colAmount: "Kwota",
        colStatus: "Status",
        view: "Podgląd",
        pdf: "PDF",
        kind: { invoice: "Faktura", receipt: "Paragon", credit_note: "Korekta" },
        status: { paid: "Opłacony", open: "Otwarty", void: "Anulowany", refunded: "Zwrócony" },
      },
      invoiceLookup: {
        title: "Faktura po numerze transakcji",
        hint: "Numer transakcji (txn_...) znajdziesz w mailu z potwierdzeniem płatności. Link do pliku jest jednorazowy i krótkotrwały.",
        label: "Numer transakcji",
        cta: "Znajdź fakturę",
        found: "Faktura gotowa do pobrania",
        download: "Pobierz fakturę (PDF)",
        errors: {
          invalid_transaction: "Nieprawidłowy numer transakcji - powinien zaczynać się od txn_.",
          not_found: "Nie znaleziono takiej transakcji.",
          forbidden: "Ta transakcja nie należy do Twojego konta.",
          invoice_unavailable: "Nie udało się pobrać faktury. Spróbuj ponownie za chwilę.",
        },
      },
      portalEmail: {
        hint: "Wyślemy na adres Twojego konta jednorazowy link do portalu płatności - zmienisz tam metodę płatności, pobierzesz faktury lub anulujesz subskrypcję.",
        cta: "Wyślij link do portalu",
        sent: "Link wysłany na {{email}}",
        errors: {
          no_customer:
            "Brak powiązanego konta płatnika - link będzie dostępny po pierwszej płatności.",
          portal_failed: "Nie udało się utworzyć linku do portalu. Spróbuj ponownie.",
          no_recipient: "Brak adresu e-mail na koncie.",
          send_failed: "Nie udało się wysłać wiadomości. Spróbuj ponownie.",
        },
      },
      colDate: "Data",

      colItem: "Pozycja",
      colAmount: "Kwota",
      colStatus: "Status",
      colInvoice: "Faktura",
      invoice: "Pobierz",
      kindSubscription: "Subskrypcja",
      kindOneTime: "Zakup jednorazowy",
    },
    status: {
      pending: "Oczekujące",
      processing: "Przetwarzane",
      paid: "Opłacone",
      failed: "Nieudane",
      refunded: "Zwrócone",
      canceled: "Anulowane",
      active: "Aktywna",
      expired: "Wygasła",
    },
  },
  pricing: {
    title: "Cennik",
    subtitle: "Wybierz plan dopasowany do Twoich potrzeb.",
    perMonth: "/ mies.",
    perTwoWeeks: "/ 2 tyg.",
    perQuarter: "/ kwartał",
    perYear: "/ rok",
    perDay: "/ dzień",
    perWeek: "/ tydz.",
    perOnce: "jednorazowo",
    choose: "Wybierz plan",
    current: "Aktualny plan",
    // LICZEBNIKI: „1 dni za darmo" na karcie planu to błąd widoczny dokładnie
    // w chwili, gdy klient decyduje o zakupie. Zmienna nazywa się `count`, bo po
    // niej i18next wybiera formę; polski ma trzy istotne (1 / 2-4 / 5+).
    trial_one: "{{count}} dzień za darmo",
    trial_few: "{{count}} dni za darmo",
    trial_many: "{{count}} dni za darmo",
    trial_other: "{{count}} dni za darmo",
    popular: "Najpopularniejszy",
    empty: "Brak dostępnych planów.",
    intervalTwoWeeks: "Co 2 tygodnie",
    intervalMonthly: "Miesięcznie",
    intervalQuarterly: "Kwartalnie",
    intervalYearly: "Rocznie",
    compareTitle: "Porównanie planów",
    compareFeature: "Funkcja",
    trust: {
      secure: "Bezpieczne płatności online",
      cancel: "Anuluj w każdej chwili",
      instant: "Natychmiastowy dostęp po opłaceniu",
    },
    faqTitle: "Najczęstsze pytania",
    faq: [
      {
        q: "Czy mogę anulować subskrypcję?",
        a: "Tak. Subskrypcję anulujesz w każdej chwili w panelu profilu - zachowujesz dostęp do końca opłaconego okresu.",
      },
      {
        q: "Jakie metody płatności akceptujecie?",
        a: "Płatności obsługuje nasz operator płatności - karty Visa, Mastercard oraz popularne metody lokalne.",
      },
      {
        q: "Czy otrzymam fakturę?",
        a: "Tak. Fakturę wystawiamy na podstawie danych rozliczeniowych z Twojego profilu.",
      },
      {
        q: "Czy dostęp jest natychmiastowy?",
        a: "Tak - dostęp odblokowuje się automatycznie zaraz po potwierdzeniu płatności.",
      },
    ],
  },
  checkout: {
    title: "Finalizacja zamówienia",
    saveBillingContinue: "Zapisz i kontynuuj",
    continueReading: "Wróć do artykułu",
    summary: "Podsumowanie",
    item: "Pozycja",
    total: "Razem",
    billingDetails: "Dane do faktury",
    paymentMethod: "Metoda płatności",
    payNow: "Zapłać {{amount}}",
    processing: "Przetwarzanie...",
    secured: "Płatność zabezpieczona przez operatora płatności",
    terms: 'Klikając "Zapłać" akceptujesz regulamin i politykę prywatności.',
    successTitle: "Dziękujemy za zakup!",
    successBody:
      "Twoje zamówienie zostało przyjęte. Status aktualizujemy po potwierdzeniu płatności.",
    cancelTitle: "Płatność anulowana",
    cancelBody: "Nie pobraliśmy żadnych środków. Możesz spróbować ponownie.",
    backToProfile: "Przejdź do profilu",
    backToPricing: "Wróć do cennika",
    notFound: "Nie znaleziono planu.",
    loginRequired: "Zaloguj się, aby kontynuować zakup.",
    fillBilling: "Uzupełnij dane rozliczeniowe.",
    paymentsNotConfigured:
      "Bramka płatności nie jest jeszcze skonfigurowana. Skontaktuj się z administratorem.",
    trialLine: "Pierwsze {{days}} dni za darmo - pierwsza płatność po okresie próbnym.",
    promoHint: "Masz kupon? Kod rabatowy wpiszesz na bezpiecznej stronie płatności.",
    taxHint: "VAT zostanie naliczony automatycznie według Twojego adresu.",
    taxIdHint: "NIP/VAT ID do faktury podasz na stronie płatności.",
    invoiceHint: "Fakturę pobierzesz z historii płatności w swoim profilu.",
    subtotal: "Wartość",
    applyFailed: "Nie udało się zastosować kuponu.",
    headTitle: "Finalizacja zamówienia · Checkout",
    successHeadTitle: "Dziękujemy za zakup · Payment success",
    cancelHeadTitle: "Płatność anulowana · Payment canceled",
    fx: {
      freshTitle: "Aktualny kurs NBP (tabela A)",
      staleTitle: "Kurs NBP przeterminowany",
      fallbackTitle: "Kurs awaryjny (ostatnia znana kotwica)",
      rate: "1 EUR = {{rate}} PLN",
      tableA: "tabela A z {{date}}",
      fetchedAt: "Pobrano: {{when}}",
      reason: "Powód: {{reason}}",
    },
  },
  coupon: {
    title: "Kupon B2B",
    placeholder: "np. NES-B2B-10",
    apply: "Zastosuj",
    savings: "Oszczędzasz",
    discount: "Rabat",
    error: {
      emptyCode: "Wpisz kod kuponu.",
      invalidAmount: "Nieprawidłowa kwota zamówienia.",
      notFound: "Nie znaleziono takiego kodu.",
      inactive: "Ten kupon jest nieaktywny.",
      notYetValid: "Ten kupon nie jest jeszcze ważny.",
      expired: "Ten kupon wygasł.",
      limitReached: "Wykorzystano limit użyć tego kuponu.",
      planNotEligible: "Ten kupon nie obowiązuje na wybrany plan.",
      currencyMismatch: "Waluta kuponu nie pasuje do zamówienia.",
      technicalError: "Nie udało się sprawdzić kuponu - spróbuj ponownie za chwilę. To nie znaczy, że kod jest nieprawidłowy.",
    },
  },
  auth: {
    required: "Wymagane logowanie",
    requiredBody: "Aby zobaczyć tę stronę, musisz się zalogować.",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
  },
};

/**
 * Angielski nie powtarza polskich form `_few`/`_many` liczebnika okresu
 * próbnego - i18next dla `en` ich nie użyje. Typ jest rozluźniony wyłącznie
 * o te dwa klucze; parytet pozostałych dalej pilnuje `Omit` i bramka
 * `check:i18n-parity`.
 */
type ProfileEn = Omit<typeof pl, "pricing"> & {
  pricing: Omit<(typeof pl)["pricing"], "trial_few" | "trial_many">;
};

const en: ProfileEn = {
  profile: {
    title: "My profile",
    subtitle: "Management centre",
    sidebar: {
      expand: "Expand settings",
      collapse: "Collapse settings",
    },
    privacy: {
      title: "Privacy & data",
      hint: "One place for everything about your privacy: who can see you and who can contact you, what you consent to, and how to download or delete your data. Choices save instantly, are enforced server-side and audited.",
      consentsSection: "Consents",
      dataSection: "Your data (GDPR)",
      securityLink: "Account security: password, e-mail, sessions and two-factor sign-in",
      registryNote:
        "Every decision is stored in an immutable GDPR audit log (date, content version, source, IP address and browser). Cookie consents also apply on this device without signing in.",
      openBanner: "Open cookie banner settings",
    },
    author: {
      title: "Expert profile",
      intro:
        "Public expert profile - shown at /author/<slug> and in the author BIO widget on posts. Independent of your private profile (contact details may differ).",
      create: "Create expert profile",
      noRole:
        "The expert profile is available only to users with the author or administrator role.",
      isPublic: "Publicly visible",
      isPublicHint:
        "A new profile starts hidden. Turning this off hides the profile on the expert page and in the author BIO widget on posts.",
      loadError: "Could not load the author profile. Refresh the page.",
      avatarSection: "Expert photo",
      basicSection: "Professional details",
      contactSection: "Contact details (not public)",
      contactPrivacyHint:
        "The e-mail and phone are never published on the profile page - only you and administrators can see them. Readers reach you via the request form.",
      contactEmail: "Contact e-mail",
      website: "Website",
      socialSection: "Social media",
      socialLabel: "Label",
      customSocials: "Custom links (with icon)",
      noCustomSocials: "No custom links yet. Add e.g. Threads, Bluesky, Mastodon...",
      iconUrl: "Icon URL (optional)",
      bioBulletsHint:
        "Bio as bullet points - up to 5. Bullet colour is inherited from the tenant settings (admin › Expert layouts). Editing syncs your private profile.",
      bioPl: "Bio - bullets (PL)",
      bioEn: "Bio - bullets (EN)",
      ogRefreshBtn: "Refresh social preview",
      ogRefreshHint:
        "After changing your photo or bio, refresh the social preview - this forces a new og:image in links.",
      ogRefreshOk: "Social preview updated. Open the Post Debugger to force a rescrape.",
      ogRefreshError:
        "Could not refresh the social preview. Fill in the profile slug and try again.",
      media: {
        heading: "Media presence, external materials, podcasts",
        hint: "Add links to interviews, appearances, op-eds and podcasts you feature in. Public entries appear on your expert profile in the In the media section.",
        empty:
          "You haven't added any media appearances yet. Click Add and paste a link to an interview, op-ed or podcast.",
        kind: "Type",
        language: "Language (optional)",
        outlet: "Publisher / station / podcast",
        title: "Material title",
        titlePlaceholder: "e.g. Interview on EU security policy",
        url: "Link (URL)",
        cover: "Cover - image URL (optional)",
        publishedOn: "Publication date",
        isPublic: "Visible on public profile",
        added: "Media entry added",
        removed: "Media entry removed",
        saved: "Saved",
        validation: "Fill in the title, publisher and date.",
      },
    },
    nav: {
      overview: "Overview",
      edit: "Edit profile",
      account: "Account",
      author: "Author profile",
      social: "Social media",
      interests: "Interests",
      personality: "Personality",
      bookmarks: "Saved items",
      notifications: "Notifications",
      follows: "Following",
      network: "My network",
      membership: "Membership",
      organization: "Organisation",
      billing: "Billing details",
      plan: "Plan & subscription",
      subscription: "Subscription",
      orders: "Orders",
      payments: "Payments & invoices",
      tickets: "My registrations",
      security: "Account security",
      privacy: "Privacy & data",
      notificationSettings: "Notification settings",
      expertRequests: "Expert requests",
      events: "My events",
      cart: "My cart",
    },
    navGroups: {
      identity: "Identity",
      content: "Content & personalization",
      finance: "Payments & plan",
      privacy: "Privacy & security",
    },
    edit: {
      title: "Edit profile",
      intro: "Everything about your identity in one place.",
      tabs: {
        basic: "Basic details",
        expert: "Expert profile",
        social: "Social & bio",
      },
    },
    overview: {
      welcome: "Welcome, {{name}}",
      memberLabel: "Member",
      memberSince: "Member since {{date}}",
      planActive: "Active plan",
      planNone: "No active subscription",
      seePlans: "View plans",
      manageBilling: "Manage subscription",
    },
    account: {
      displayName: "Display name",
      displayNameAlt: "(account nickname)",
      firstName: "First name",
      lastName: "Last name",
      jobTitle: "Job title",
      currentCompany: "Current company",
      specialization: "Specialization",

      location: "Place of residence",
      locationPh: "City, country",
      phone: "Phone",
      phonePh: "+1 555 000 0000",
      gender: "Gender",
      genderHint: "Auto-detected from your first name by default. You can override it.",
      genderAuto: "Auto-detect from first name",
      genderMale: "Male",
      genderFemale: "Female",
      genderNeutral: "Neutral / other",
      personalSection: "Personal details",
      contactSection: "Contact details",
      mediaSection: "Avatar and cover",
      privacyHintTitle: "Privacy and visibility have moved",
      privacyHintBody:
        "Visibility in the people search, accepting expert requests, who can start a conversation with you and invite you to their network, read receipts, typing indicator and online status - all in one place, together with consents and data rights.",
      coverPlaceholder: "No cover image",
      avatarPlaceholder: "No avatar",
      unnamed: "User",
      email: "Email",
      emailReadonly: "Email is changed via account settings.",
      bio: "Short bio",
      avatar: "Avatar (URL)",
      cover: "Cover (URL)",
      uploadAvatar: "Upload avatar",
      uploadCover: "Upload cover",
      avatarHint: "Recommended: 512×512 px, square, max 2 MB (JPG/PNG/WEBP)",
      coverHint: "Recommended: 1500×500 px, panorama, max 5 MB (JPG/PNG/WEBP)",
      uploading: "Uploading...",
      uploadProgress: "Uploading: {{percent}}%",
      uploadSuccess: "Uploaded successfully",
      uploadFailed: "Upload failed",
      uploadError: "Could not upload file",
      fileTooLarge: "File is too large",

      save: "Save changes",
      saved: "Saved",
      saveError: "Could not save",
      tip: {
        displayName:
          "How you appear publicly - on comments, posts and in the welcome header. Doesn't have to be your real name.",
        firstName:
          "Your real first name. Used for personalised greetings and (optionally) on invoices.",
        lastName: "Your real last name. Used in official communication and on invoices.",
        jobTitle: "Job title shown on your public author profile.",
        currentCompany: "Where you currently work - shown publicly next to your job title.",
        location: "City and country. Helps readers understand the context of what you publish.",
        phone: "Internal contact number - visible only to the editorial team.",
        email: "Your sign-in address. To change it, use the Security tab.",
        bio: "Short biography (up to 500 characters) shown on your public author page.",
        avatar: "Profile picture - shown anywhere your nickname appears.",
        cover: "Banner image at the top of your author page.",
        save: "Saves all changes on the Account tab.",
      },
    },
    inline: {
      viewAsGuest: "View as guest",
      editMode: "Edit mode",
      adminPanel: "Admin panel",
      contactSection: "Contact details",
      activitySection: "Activity & following",
      bioPlaceholder:
        "Tell readers a bit about yourself - what you do, what topics interest you...",
      addJobTitle: "Add job title",
      addCompany: "Add company",
      addLocation: "Add location",
      addPhone: "Add phone",
      addLinkedin: "Add LinkedIn",
      addTwitter: "Add X (Twitter)",
      addSpecialization: "Add specialization",
      interestsHint: "Pick topics, categories and tags you follow.",
      shortcuts: "Shortcuts",
      notSet: "Not set",
      clickToEdit: "Click to edit",
      saving: "Saving...",
      addAvatar: "Add photo",
      changeAvatar: "Change",
      avatarSize: "400 × 400 px",
    },

    security: {
      privacyLink: "Privacy & data: visibility, consents, export and account deletion",
      changePassword: "Change password",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmPassword: "Confirm password",
      update: "Update password",
      updated: "Password changed. Other sessions were signed out.",
      mismatch: "Passwords do not match",
      tooShort: "Password must be at least 8 characters",
      wrongCurrent: "Your current password is incorrect.",
      signOut: "Sign out",
      sessions: "Sessions",
      lastSignIn: "Last sign-in",
      signOutOthers: "Sign out other sessions",
      signedOutOthers: "Signed out other sessions.",
      currentRequired: "Enter your current password to confirm it is you.",
      sameAsCurrent: "The new password is the same as the current one. Choose a different one.",
      sessionExpired: "Your session has expired. Sign in again and repeat the change.",
      exportFailed: "Could not prepare the export. Please try again.",
      export: {
        title: "Your data (GDPR)",
        subtitle:
          "Download a copy of the personal data we store about you (Art. 15 and 20 GDPR) as a JSON file: profile and expert profile, CV sections and media mentions, network and recommendations, chat (your messages and conversation metadata), expert requests, discussion clubs (memberships and your own contributions), comments, follows, orders, consents and preferences.",
        scopeNote:
          "The file carries its own manifest: every section it contains, plus what is deliberately left out and why (for example messages written by other people - Art. 15(4) GDPR).",
        busy: "Preparing...",
        download: "Download my data (JSON)",
      },
      email: {
        title: "Email address",
        subtitle: "Changing it requires confirmation via a link sent to the new address.",
        current: "Current address",
        newEmail: "New email address",
        submit: "Change email",
        sent: "We've sent a confirmation link to the new address.",
        invalid: "Enter a valid email address.",
        needPassword: "Enter your current password to confirm.",
        sameAsCurrent: "That is already your email address - there is nothing to change.",
      },
      danger: {
        title: "Delete account",
        subtitle:
          "Permanently deletes your account and all related data (bookmarks, follows, results). This cannot be undone.",
        button: "Delete my account",
        confirmTitle: "Delete your account?",
        confirmBody:
          "This action is irreversible. To confirm, enter your password. We remove your profile, bookmarks, follows and test results.",
        passwordLabel: "Confirm with password",
        cancel: "Cancel",
        confirm: "Delete account permanently",
        deleted: "Your account has been deleted.",
        deletedWithRetention_one:
          "Your account has been deleted. We kept 1 anonymised accounting record - stripped of your personal data.",
        // `_few` / `_many` istnieją tylko dla parytetu kluczy z polskim (en: typeof pl).
        // Intl.PluralRules dla angielskiego zwraca wyłącznie "one" i "other",
        // więc te warianty nigdy nie zostaną wybrane - i mają brzmieć jak "other",
        // gdyby kiedyś doszedł język z bogatszą fleksją.
        deletedWithRetention_few:
          "Your account has been deleted. We kept {{count}} anonymised accounting records - stripped of your personal data.",
        deletedWithRetention_many:
          "Your account has been deleted. We kept {{count}} anonymised accounting records - stripped of your personal data.",
        deletedWithRetention_other:
          "Your account has been deleted. We kept {{count}} anonymised accounting records - stripped of your personal data.",
        failed: "Could not delete the account.",
        retentionTitle: "What stays after deletion",
        retentionBody:
          "Your payment history (amounts, currencies, dates, provider transaction ids) and the records of access you purchased stay on file as accounting evidence, but they can no longer be traced to you: we drop the account id, the receipt e-mail address and descriptive fields, and put an irreversible pseudonym in their place. Free access grants prove nothing, so they are deleted along with the account.",
        retentionBasis:
          "Legal basis: Article 74(2) of the Polish Accounting Act (5 years from the end of the financial year) read with Article 17(3)(b) GDPR. Records are purged automatically once that period lapses.",
      },
      tip: {
        currentPassword: "Enter your current password to confirm it's you.",
        newPassword: "Minimum 8 characters. Mix letters, digits and symbols for strength.",
        confirmPassword: "Repeat your new password to avoid typos.",
        update: "Saves your new password and signs out other sessions.",
        signOut: "Signs you out on this device.",
        signOutOthers: "Signs out all your other sessions on other devices.",
      },
      mfa: {
        title: "Two-factor authentication (TOTP)",
        subtitle:
          "An extra layer of protection: we'll ask for a code from your authenticator app when you sign in.",
        statusLabel: "Status: ",
        statusEnabled: "Enabled",
        statusDisabled: "Disabled",
        statusUnknown: "Unknown",
        loadFailed:
          "We could not check your second factor. This does NOT mean it is off - please refresh the page.",
        enroll: "Set up an authenticator app",
        scanInstruction:
          "Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy…).",
        manualIntro: "Can't scan the code? Enter this key manually:",
        codeLabel: "6-digit code",
        codePlaceholder: "000000",
        activate: "Activate",
        cancel: "Cancel",
        activated: "Two-factor authentication enabled.",
        invalidCode: "Enter the 6-digit code from your app.",
        enrollError: "Could not start setup. Please try again.",
        verifyError: "Invalid code. Check it and try again.",
        enrolledTitle: "Active authenticator apps",
        defaultFactorName: "Authenticator app",
        addedOn: "Added {{date}}",
        loading: "Loading…",
        none: "No methods configured.",
        remove: "Remove",
        removeTitle: "Remove this method?",
        removeBody:
          "After removal, signing in will no longer require a code from this app. Confirm with your password.",
        removeLastBody:
          "This is your LAST two-factor method. After removal the account will be protected by its password alone. Confirm with your password.",
        removePasswordLabel: "Confirm with password",
        removeConfirm: "Remove method",
        removed: "The method has been removed.",
        removeError: "Could not remove the method.",
        wrongPassword: "Your current password is incorrect.",
        challenge: {
          title: "Two-step verification",
          description: "Enter the 6-digit code from your authenticator app to continue.",
          codeLabel: "6-digit code",
          verify: "Verify",
          cancel: "Cancel",
          noFactor: "No authenticator app is configured for this account.",
          failed: "Verification failed. Check the code and try again.",
        },
      },
    },
    billing: {
      title: "Billing details",
      subtitle: "Used on invoices and at checkout.",
      isCompany: "I am a company",
      fullName: "Full name",
      company: "Company name",
      taxId: "Tax ID / VAT",
      email: "Invoice email",
      phone: "Phone",
      addressLine1: "Address line 1",
      addressLine2: "Address line 2 (optional)",
      city: "City",
      postalCode: "Postal code",
      region: "State / region",
      country: "Country",
      save: "Save details",
      saved: "Saved",
      saveError: "Could not save your details. Please try again.",
      taxIdFormat: "Invalid NIP format - enter 10 digits (dashes are fine).",
      taxIdChecksum: "The NIP check digit is wrong - please verify the number.",
      taxIdVatFormat: "Invalid VAT number format.",
      tip: {
        isCompany: "Enable if you're purchasing as a business - a VAT field will appear.",
        fullName: "Full name as it should appear on the invoice.",
        company: "Official company name for invoicing.",
        taxId: "Tax ID / VAT number. Required for business buyers.",
        email: "Where we'll send your PDF invoice.",
        phone: "Contact number for questions about your order.",
        addressLine1: 'Street and number (e.g. "5th Avenue 1").',
        addressLine2: "Apartment, floor, suite - optional.",
        city: "City for the billing address.",
        postalCode: "Postal / ZIP code of the billing address.",
        region: "State or region, if applicable.",
        country: "Two-letter ISO country code (e.g. PL, DE, US).",
        save: "Saves your billing details to your account.",
      },
    },
    planPage: {
      activeTitle: "Active plan",
      noPlan: "You have no active plan yet.",
      priceLabel: "Price",
      chooseCta: "Choose a plan",
      details: "Details",
      switchTitle: "Change plan",
      switchHint:
        "Options are derived from the price lookup key, so what you see here matches the proration applied by the payment provider.",
      upgradesTitle: "Upgrade",
      downgradesTitle: "Downgrade",
      upgradeNote: "charged immediately, prorated",
      downgradeNote: "applies from the next billing period",
      upgradeCta: "Upgrade",
      downgradeCta: "Downgrade",
      historyTitle: "Recent payments",
      historyAll: "All payments",
      statusCard: {
        title: "Subscription status",
        status: "Status",
        renewsAt: "Next renewal",
        endsAt: "Access until",
        method: "Payment method",
        noMethod: "No saved payment method.",
        methodError: "Could not load the payment method.",
        expires: "valid until {{date}}",
      },
      subStatus: {
        active: "Active",
        trialing: "Trial period",
        cancelScheduled: "Changing - cancellation scheduled",
        pastDue: "Payment overdue",
        paused: "Paused",
        canceled: "Canceled",
        grantLifetime: "Lifetime access (granted)",
        grantActive: "Granted access",
        none: "No subscription",
      },
      howPayments: {
        title: "How payments work",
        intro:
          "All payments on our platform are handled by Stripe, a certified payment processor. We only receive the transaction confirmation and the data needed to grant your access.",
        points: {
          processor: {
            title: "Stripe as the payment processor",
            body: "Purchases and renewals run inside Stripe's secure form, embedded on our site or in the Stripe customer portal.",
          },
          noCardData: {
            title: "We never store card data",
            body: "Your card number, expiry date and CVC go straight to Stripe. They are never stored on our servers - we only see the card brand and the last four digits.",
          },
          security: {
            title: "Security and compliance",
            body: "Stripe is PCI DSS Level 1 compliant and supports strong customer authentication (3D Secure / SCA) whenever your bank requires it.",
          },
          invoices: {
            title: "Invoices and receipts",
            body: "Documents for every payment are listed in the history above, and the full statement is available in the Stripe customer portal.",
          },
          renewals: {
            title: "Renewals and cancellation",
            body: "Subscriptions renew automatically until cancelled. You can change your plan, payment method or cancel in Payments and security, or in the customer portal.",
          },
        },
        footnote:
          "Question about a specific transaction? Use the invoice lookup above or contact us - share the transaction number, never your full card number.",
      },
      history: {
        title: "Invoices and payments",
        pageTitle: "Payment history",
        pageHint:
          "Full record of purchases, subscription renewals and issued documents. You can download the statement as CSV or PDF.",
        all: "See all",
        empty: "No payments yet - they appear after your first purchase.",
        colNumber: "Number",
        colDate: "Date",
        colKind: "Type",
        colAmount: "Amount",
        colCurrency: "Currency",
        colStatus: "Status",
        colDiscount: "Discount",
        colCoupon: "Promo code",
        colDocument: "Details",
        discount: "Discount {{amount}}",
        gift: "Gift",
        details: "Details",
        exportCsv: "Download CSV",
        exportPdf: "Download PDF",
        exportTitle: "Payment history",
        generatedAt: "Generated: {{date}}",
        popupBlocked: "Your browser blocked the print window - allow pop-ups.",
        kind: {
          invoice: "Invoice",
          receipt: "Receipt",
          credit_note: "Credit note",
          subscription: "Subscription",
          one_time: "One-time purchase",
          grant: "Granted access",
        },
        status: {
          paid: "Paid",
          open: "Open",
          void: "Void",
          refunded: "Refunded",
          pending: "Pending",
          processing: "Processing",
          failed: "Failed",
          canceled: "Canceled",
          granted: "Granted",
        },
      },
      syncCta: "Sync with Stripe",
      syncOk: "Subscription state synced.",
      syncError: "Could not sync the subscription state.",
      grantTitle: "Access granted outside a plan",
      grantLifetime: "lifetime",
      grantExpert: "New European Strategies expert",
      grantSource: {
        manual: "manual grant",
        donation: "from a donation",
        import: "import",
        expert: "New European Strategies expert",
        gift: "Gift",
      },
    },
    subscription: {
      title: "Your subscription",
      none: "You do not have an active subscription.",
      paymentStatus: "Latest payment status",
      plan: "Plan",
      status: "Status",
      startedAt: "Active since",
      renewsAt: "Renews",
      cancelsAt: "Expires",
      cancel: "Cancel subscription",
      cancelConfirm:
        "Your subscription remains active until the end of the current billing period.",
      canceled: "Subscription canceled",
      cancelFailed: "Could not cancel the subscription. Please try again or contact us.",
      keep: "Keep subscription",
      accessUntil: "Subscription canceled - access stays active until {{date}}.",
      resume: "Resume subscription",
      resumed: "Subscription resumed",
      resumeError: "Could not resume the subscription.",
      change: "Change plan",
      changePlan: {
        title: "Change plan",
        hint: "The price difference is prorated immediately: upgrades charge the remainder of the period now, downgrades credit your next invoice.",
        cancelNote:
          "Changing the plan clears the scheduled cancellation - the subscription will keep renewing.",
        placeholder: "Choose a new plan",
        cta: "Change plan",
        success: "Plan changed",
        error: "Could not change the plan. Please try again or contact us.",
      },
      portal: {
        changeHint:
          "Upgrades apply immediately with a prorated charge; downgrades take effect at the start of your next billing period.",
        upgradeNote: "Upgrade: the prorated difference is charged right away.",
        downgradeNote: "Downgrade: the change applies once the paid period ends.",
        downgradeScheduled: "Plan change scheduled for the end of the billing period",
        updatePayment: "Update payment method",
        openPortal: "Invoices and billing details",
        manage: "Manage in the billing portal",
        manageHint:
          "In the provider portal you can switch plan and price, update your payment method, download invoices or cancel the subscription.",
        opening: "Opening the portal...",
        noCustomer: "We could not find an active billing profile. Buy a plan to open the portal.",
        error: "Could not open the payment portal. Please try again.",
        pastDue: "Your last payment failed. Update your payment method to keep access.",
        secureNote: "Card details are handled by the payment provider - we never store them.",
        status: {
          active: "Active",
          trialing: "Trial",
          past_due: "Payment overdue",
          paused: "Paused",
          canceled: "Canceled",
        },
        paused: {
          note: "Your subscription is paused - premium access stays suspended until you resume it.",
          cta: "Resume subscription",
          success: "Subscription resumed",
        },
        preview: {
          loading: "Calculating the cost of this change...",
          upgrade: "Due now: {{amount}}",
          downgrade: "From {{date}} you will pay {{amount}}",
          unavailable:
            "We could not fetch the exact amount - the provider calculates it on change.",
        },
        seats: {
          title: "Seats",
          hint: "Adding seats is prorated and charged now; removing seats applies from the next period.",
          label: "Seats",
          cta: "Save seat count",
          success: "Seat count updated",
          error: "Could not change the seat count. Please try again.",
        },
      },
    },
    orders: {
      title: "Payment history",
      empty: "No orders yet.",
      documents: {
        title: "Billing documents",
        hint: "Invoices and receipts from purchases and every subscription renewal.",
        empty: "No documents yet - they appear after your first payment.",
        colDate: "Date",
        colNumber: "Number",
        colKind: "Type",
        colAmount: "Amount",
        colStatus: "Status",
        view: "View",
        pdf: "PDF",
        kind: { invoice: "Invoice", receipt: "Receipt", credit_note: "Credit note" },
        status: { paid: "Paid", open: "Open", void: "Void", refunded: "Refunded" },
      },
      invoiceLookup: {
        title: "Invoice by transaction ID",
        hint: "You will find the transaction ID (txn_...) in your payment confirmation email. The file link is single-use and short-lived.",
        label: "Transaction ID",
        cta: "Find invoice",
        found: "Invoice ready to download",
        download: "Download invoice (PDF)",
        errors: {
          invalid_transaction: "Invalid transaction ID - it should start with txn_.",
          not_found: "No such transaction was found.",
          forbidden: "This transaction does not belong to your account.",
          invoice_unavailable: "Could not fetch the invoice. Please try again shortly.",
        },
      },
      portalEmail: {
        hint: "We will email your account address a single-use link to the billing portal - update your payment method, download invoices or cancel your subscription there.",
        cta: "Email me the portal link",
        sent: "Link sent to {{email}}",
        errors: {
          no_customer:
            "No billing customer yet - the link becomes available after your first payment.",
          portal_failed: "Could not create the portal link. Please try again.",
          no_recipient: "No email address on the account.",
          send_failed: "Could not send the message. Please try again.",
        },
      },
      colDate: "Date",

      colItem: "Item",
      colAmount: "Amount",
      colStatus: "Status",
      colInvoice: "Invoice",
      invoice: "Download",
      kindSubscription: "Subscription",
      kindOneTime: "One-time purchase",
    },
    status: {
      pending: "Pending",
      processing: "Processing",
      paid: "Paid",
      failed: "Failed",
      refunded: "Refunded",
      canceled: "Canceled",
      active: "Active",
      expired: "Expired",
    },
  },
  pricing: {
    title: "Pricing",
    subtitle: "Choose the plan that fits your needs.",
    perMonth: "/ mo",
    perTwoWeeks: "/ 2 wks",
    perQuarter: "/ quarter",
    perYear: "/ yr",
    perDay: "/ day",
    perWeek: "/ wk",
    perOnce: "one-time",
    choose: "Choose plan",
    current: "Current plan",
    // Angielski ma dwie formy - `_few`/`_many` świadomie pominięte.
    trial_one: "{{count}}-day free trial",
    trial_other: "{{count}}-day free trial",
    popular: "Most popular",
    empty: "No plans available.",
    intervalTwoWeeks: "Every 2 weeks",
    intervalMonthly: "Monthly",
    intervalQuarterly: "Quarterly",
    intervalYearly: "Yearly",
    compareTitle: "Compare plans",
    compareFeature: "Feature",
    trust: {
      secure: "Secure payments online",
      cancel: "Cancel anytime",
      instant: "Instant access after payment",
    },
    faqTitle: "Frequently asked questions",
    faq: [
      {
        q: "Can I cancel my subscription?",
        a: "Yes. Cancel anytime from your profile - you keep access until the end of the paid period.",
      },
      {
        q: "Which payment methods do you accept?",
        a: "Payments are handled by our payment provider - Visa, Mastercard and popular local methods.",
      },
      {
        q: "Will I get an invoice?",
        a: "Yes. Invoices are issued from the billing details in your profile.",
      },
      {
        q: "Is access immediate?",
        a: "Yes - access unlocks automatically as soon as the payment is confirmed.",
      },
    ],
  },
  checkout: {
    title: "Checkout",
    saveBillingContinue: "Save and continue",
    continueReading: "Back to the article",
    summary: "Order summary",
    item: "Item",
    total: "Total",
    billingDetails: "Billing details",
    paymentMethod: "Payment method",
    payNow: "Pay {{amount}}",
    processing: "Processing...",
    secured: "Secured by our payment provider",
    terms: 'By clicking "Pay" you agree to the terms and privacy policy.',
    successTitle: "Thank you!",
    successBody: "Your order was received. We will update its status once payment is confirmed.",
    cancelTitle: "Payment canceled",
    cancelBody: "We did not charge you. Feel free to try again.",
    backToProfile: "Go to profile",
    backToPricing: "Back to pricing",
    notFound: "Plan not found.",
    loginRequired: "Please sign in to continue.",
    fillBilling: "Fill in your billing details first.",
    paymentsNotConfigured:
      "Payment gateway is not configured yet. Please contact the administrator.",
    trialLine: "First {{days}} days free - the first charge comes after the trial.",
    promoHint: "Have a coupon? Enter your promo code on the secure payment page.",
    taxHint: "VAT is calculated automatically based on your address.",
    taxIdHint: "You can provide your VAT ID for the invoice on the payment page.",
    invoiceHint: "You can download the invoice from the payment history in your profile.",
    subtotal: "Subtotal",
    applyFailed: "Could not apply the coupon.",
    headTitle: "Checkout · Finalizacja zamówienia",
    successHeadTitle: "Payment success · Dziękujemy za zakup",
    cancelHeadTitle: "Payment canceled · Płatność anulowana",
    fx: {
      freshTitle: "Live NBP rate (Table A)",
      staleTitle: "NBP rate is stale",
      fallbackTitle: "Fallback rate (last known anchor)",
      rate: "1 EUR = {{rate}} PLN",
      tableA: "Table A dated {{date}}",
      fetchedAt: "Fetched: {{when}}",
      reason: "Reason: {{reason}}",
    },
  },
  coupon: {
    title: "B2B coupon",
    placeholder: "e.g. NES-B2B-10",
    apply: "Apply",
    savings: "You save",
    discount: "Discount",
    error: {
      emptyCode: "Enter a coupon code.",
      invalidAmount: "Invalid order amount.",
      notFound: "That code was not found.",
      inactive: "This coupon is inactive.",
      notYetValid: "This coupon is not valid yet.",
      expired: "This coupon has expired.",
      limitReached: "This coupon has reached its usage limit.",
      planNotEligible: "This coupon does not apply to the selected plan.",
      currencyMismatch: "Coupon currency does not match this order.",
      technicalError: "We could not check this coupon - please try again in a moment. It does not mean the code is invalid.",
    },
  },
  auth: {
    required: "Sign-in required",
    requiredBody: "You need to sign in to view this page.",
    signIn: "Sign in",
    signUp: "Create account",
  },
};

type ProfileExtras = {
  profile: {
    role: {
      badge: string;
      super_admin: string;
      admin: string;
      editor: string;
      author: string;
      user: string;
    };
    social: {
      title: string;
      subtitle: string;
      slug: string;
      slugHint: string;
      slugReset: string;
      slugPreview: string;
      slugInvalid: string;
      slugTooShort: string;
      slugTaken: string;
      slugAvailable: string;
      slugChecking: string;
      slugReserved: string;
      bioPl: string;
      bioEn: string;
      twitter: string;
      linkedin: string;
      website: string;
      facebook: string;
      instagram: string;
      spotify: string;
      email: string;
      save: string;
      saved: string;
      tip: {
        slug: string;
        bioPl: string;
        bioEn: string;
        twitter: string;
        linkedin: string;
        website: string;
        facebook: string;
        instagram: string;
        spotify: string;
        email: string;
        save: string;
      };
    };

    /** Wspólne stany list panelu konta (zakładki, obserwacje). */
    lists: {
      loading: string;
      loadFailed: string;
      retry: string;
    };

    bookmarks: {
      title: string;
      subtitle: string;
      empty: string;
      remove: string;
      open: string;
      tabPosts: string;
      tabPages: string;
      unavailable: string;
    };
    follows: {
      title: string;
      subtitle: string;
      empty: string;
      unfollow: string;
      tabAuthors: string;
      tabCategories: string;
      tabTags: string;
      tabPrograms: string;
      unavailable: string;
    };
  };
};

const extrasPl: ProfileExtras = {
  profile: {
    role: {
      badge: "Rola",
      super_admin: "Super admin",
      admin: "Administrator",
      editor: "Redaktor",
      author: "Autor",
      user: "Czytelnik",
    },
    social: {
      title: "Media społecznościowe i profil publiczny",
      subtitle: "Te dane pojawią się na Twojej publicznej stronie autora.",
      slug: "Nick (unikalny identyfikator)",
      slugHint:
        "Wybierz swój unikalny nick. Adres profilu: /author/{slug}. Małe litery, cyfry, myślniki.",
      slugReset: "Zaproponuj z imienia i nazwiska",
      slugPreview: "Podgląd adresu",
      slugInvalid:
        "Dozwolone tylko małe litery, cyfry i myślnik (-). Bez polskich znaków i spacji.",
      slugTooShort: "Minimum 3 znaki.",
      slugTaken: "Ten nick jest już zajęty.",
      slugAvailable: "Nick jest dostępny.",
      slugChecking: "Sprawdzam dostępność...",
      slugReserved: "Ten nick jest zarezerwowany.",

      bioPl: "Biogram (PL)",
      bioEn: "Biogram (EN)",
      twitter: "X / Twitter (URL)",
      linkedin: "LinkedIn (URL)",
      website: "Strona WWW (URL)",
      facebook: "Facebook (URL)",
      instagram: "Instagram (URL)",
      spotify: "Spotify (URL)",
      email: "E-mail kontaktowy",
      save: "Zapisz",
      saved: "Zapisano",
      tip: {
        slug: "Twój unikalny nick - tworzy adres /author/{nick} i pojawia się przy publikacjach.",
        bioPl: "Krótki biogram po polsku (do 1000 znaków).",
        bioEn: "Krótki biogram po angielsku (do 1000 znaków).",
        twitter: "Pełny link do Twojego profilu X / Twitter (https://x.com/...).",
        linkedin: "Pełny link do Twojego profilu LinkedIn (https://linkedin.com/in/...).",
        website: "Twoja strona WWW - dowolny adres zaczynający się od https://.",
        facebook: "Pełny link do Twojego profilu lub strony na Facebooku.",
        instagram: "Pełny link do Twojego konta na Instagramie.",
        spotify: "Pełny link do profilu artysty lub podcastu na Spotify.",
        email: "Publiczny adres kontaktowy - widoczny na Twojej stronie autora.",
        save: "Zapisuje sekcję mediów społecznościowych i profil publiczny.",
      },
    },
    lists: {
      loading: "Wczytywanie…",
      loadFailed:
        "Nie udało się wczytać szczegółów tych pozycji. To NIE znaczy, że ich nie masz - licznik obok nazwy zakładki pokazuje, ile ich jest. Spróbuj ponownie.",
      retry: "Spróbuj ponownie",
    },
    bookmarks: {
      title: "Zapisane materiały",
      subtitle: "Wpisy i strony, które dodałeś do listy do przeczytania później.",
      empty: "Nie masz jeszcze żadnych zapisanych materiałów.",
      remove: "Usuń",
      open: "Otwórz",
      tabPosts: "Wpisy",
      tabPages: "Strony",
      unavailable: "Materiał niedostępny (usunięty lub wycofany z publikacji)",
    },
    follows: {
      title: "Obserwowane",
      subtitle: "Twoi obserwowani autorzy, kategorie i tagi.",
      empty: "Niczego jeszcze nie obserwujesz.",
      unfollow: "Przestań obserwować",
      unavailable: "Pozycja niedostępna lub ukryta",
      tabAuthors: "Autorzy",
      tabCategories: "Kategorie",
      tabTags: "Tagi",
      tabPrograms: "Programy",
    },
  },
};

const extrasEn: ProfileExtras = {
  profile: {
    role: {
      badge: "Role",
      super_admin: "Super admin",
      admin: "Administrator",
      editor: "Editor",
      author: "Author",
      user: "Reader",
    },
    social: {
      title: "Social media and public profile",
      subtitle: "These details appear on your public author page.",
      slug: "Nickname (unique handle)",
      slugHint:
        "Pick your unique nickname. Profile URL: /author/{slug}. Lowercase letters, digits, dashes.",
      slugReset: "Suggest from first and last name",
      slugPreview: "URL preview",
      slugInvalid:
        "Only lowercase letters, digits and dashes (-) allowed. No spaces or special characters.",
      slugTooShort: "Minimum 3 characters.",
      slugTaken: "This nickname is already taken.",
      slugAvailable: "Nickname is available.",
      slugChecking: "Checking availability...",
      slugReserved: "This nickname is reserved.",

      bioPl: "Biography (PL)",
      bioEn: "Biography (EN)",
      twitter: "X / Twitter (URL)",
      linkedin: "LinkedIn (URL)",
      website: "Website (URL)",
      facebook: "Facebook (URL)",
      instagram: "Instagram (URL)",
      spotify: "Spotify (URL)",
      email: "Contact e-mail",
      save: "Save",
      saved: "Saved",
      tip: {
        slug: "Your unique handle - it builds the /author/{handle} URL and shows next to your posts.",
        bioPl: "Short Polish biography (up to 1000 characters).",
        bioEn: "Short English biography (up to 1000 characters).",
        twitter: "Full URL of your X / Twitter profile (https://x.com/...).",
        linkedin: "Full URL of your LinkedIn profile (https://linkedin.com/in/...).",
        website: "Your website - any address starting with https://.",
        facebook: "Full URL of your Facebook profile or page.",
        instagram: "Full URL of your Instagram account.",
        spotify: "Full URL of your artist or podcast profile on Spotify.",
        email: "Public contact email shown on your author page.",
        save: "Saves the social media & public profile section.",
      },
    },
    lists: {
      loading: "Loading…",
      loadFailed:
        "We could not load the details of these items. This does NOT mean you have none - the number next to the tab name shows how many there are. Please try again.",
      retry: "Try again",
    },
    bookmarks: {
      title: "Saved items",
      subtitle: "Posts and pages you saved for later.",
      empty: "You have no saved items yet.",
      remove: "Remove",
      open: "Open",
      tabPosts: "Posts",
      tabPages: "Pages",
      unavailable: "Item unavailable (deleted or unpublished)",
    },
    follows: {
      title: "Following",
      subtitle: "Authors, categories and tags you follow.",
      empty: "You are not following anything yet.",
      unfollow: "Unfollow",
      unavailable: "Item unavailable or hidden",
      tabAuthors: "Authors",
      tabCategories: "Categories",
      tabTags: "Tags",
      tabPrograms: "Programs",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
i18n.addResourceBundle("pl", "translation", extrasPl, true, true);
i18n.addResourceBundle("en", "translation", extrasEn, true, true);

export {};

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
