// Słownik podmodułu SPONSORZY, PARTNERZY I WYSTAWCY w module Wydarzeń
// (/admin/events/$id/sponsors) plus etykiety publicznej sekcji sponsorów na
// stronie wydarzenia. PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-events`. Tamten słownik
// opisuje listę wydarzeń i katalog rodzajów - powierzchnie, które ładują się na
// KAŻDYM ekranie modułu. Sponsorzy to jeden ekran z czterema panelami
// (poziomy, przypięcia, kontakty, materiały) i osobnym słownictwem handlowym.
// Nakładki są niepodzielne, więc trzymanie tego razem oznaczałoby, że lista
// wydarzeń wciąga do swojego chunka teksty o stanowiskach wystawienniczych.
//
// KLUCZE ENUMÓW SĄ WSPÓŁDZIELONE Z BAZĄ. `roles.*`, `logoSizes.*`,
// `materialKinds.*`, `contactRoles.*`, `snapshotSources.*` i `driftFields.*`
// mają klucze DOKŁADNIE równe wartościom CHECK-ów z migracji
// 20260823160000_event_sponsors_companies.sql. Dzięki temu mapa
// `Record<SponsorRole, string>` indeksuje się wprost wartością z bazy, bez
// tablicy tłumaczącej, którą trzeba pamiętać przy dodaniu szóstej wartości.
//
// KOMUNIKAT MÓWI, CO SIĘ STAŁO I CO Z TYM ZROBIĆ. "Poziom Diamentowy ma
// 2 z 2 miejsc - podnieś limit albo wybierz inny poziom" zamiast "Nie można
// dodać": błąd bez wyjścia zmusza sprzedaż do zgadywania, a zgadywanie kończy
// się drugim poziomem o tej samej nazwie.
import i18n from "@/lib/i18n";

export const adminEventSponsorsPl = {
  adminEventSponsors: {
    nav: {
      sectionTitle: "Sponsorzy i partnerzy",
      sponsors: "Firmy",
      tiers: "Poziomy",
      materials: "Materiały",
    },

    // Cztery role przypięcia - wartości CHECK-a `event_sponsors_role_values`.
    roles: {
      sponsor: "Sponsor",
      partner: "Partner",
      media_partner: "Patron medialny",
      exhibitor: "Wystawca",
    },
    roleHints: {
      sponsor: "Firma z pakietem sponsorskim. Do publikacji wymaga poziomu.",
      partner: "Partner merytoryczny albo instytucjonalny bez pakietu.",
      media_partner: "Patronat medialny, zwykle w wymianie barterowej.",
      exhibitor: "Wystawca ze stanowiskiem. Ta sama kartoteka firm, nie osobny rejestr.",
    },
    rolesAll: "Wszystkie role",

    // Rozmiar logotypu sprzedany razem z pakietem - CHECK
    // `event_sponsor_tiers_logo_size_values`.
    logoSizes: {
      sm: "Mały",
      md: "Średni",
      lg: "Duży",
    },

    // Pochodzenie migawki - CHECK `event_sponsors_snapshot_source_values`.
    snapshotSources: {
      crm: "Kopia z kartoteki",
      manual: "Nadpisana ręcznie",
    },
    snapshotSourceHints: {
      crm: "Migawka jest kopią kartoteki. Różnica oznacza, że kartoteka poszła dalej.",
      manual:
        "Prezentację ustawił redaktor. Różnica wobec kartoteki jest zamierzona i nie jest błędem.",
    },

    // Rodzaje materiałów - CHECK `event_sponsor_materials_kind_values`.
    materialKinds: {
      document: "Dokument",
      presentation: "Prezentacja",
      video: "Nagranie",
      link: "Odnośnik",
      logo_pack: "Pakiet logotypów",
    },

    // Role osób kontaktowych - CHECK `event_sponsor_contacts_role_values`.
    contactRoles: {
      primary: "Osoba decyzyjna",
      marketing: "Marketing",
      billing: "Rozliczenia",
      onsite: "Obsługa na miejscu",
    },

    // Pola porównywane z kartoteką w `crm_drift_fields`.
    driftFields: {
      name: "nazwa",
      logo_url: "logotyp",
      website: "adres strony",
      country: "kraj",
    },

    publication: {
      all: "Wszystkie",
      published: "Opublikowane",
      draft: "Przygotowywane",
    },

    tiers: {
      title: "Poziomy sponsorskie",
      subtitle:
        "Cennik tego wydarzenia. Poziom decyduje o kolejności grup logotypów na stronie, o rozmiarze logotypu i o liczbie miejsc do sprzedania.",
      addAction: "Nowy poziom",
      loading: "Wczytywanie poziomów…",
      empty:
        "Nie ma jeszcze żadnego poziomu. Dodaj pierwszy, żeby móc opublikować sponsora z pakietem.",
      staffOnly: "Poziomy sponsorskie są dostępne dla administratora i redaktora organizacji.",
      inactiveBadge: "wyłączony",
      inactiveHint:
        "Wyłączony poziom znika z wyboru przy przypięciu, ale grupa logotypów już opublikowana zostaje na stronie.",
      rankLabel: "Ranga: {{rank}}",
      rankHint:
        "Wyższa ranga to wyższy poziom. Dwa poziomy mogą mieć równą rangę - wtedy rozstrzyga kolejność.",
      companiesCount: "Firmy: {{count}}",
      publishedCount: "Na stronie: {{count}}",
      slotsLeft: "Wolne miejsca: {{count}}",
      slotsUnlimited: "Bez limitu miejsc",
      slotsFull: "Wszystkie miejsca sprzedane",
      benefitsCount: "Świadczenia: {{count}}",
      benefitsEmpty: "Bez wypisanych świadczeń",
      editLabel: "Edytuj poziom {{name}}",
      deleteLabel: "Usuń poziom {{name}}",
      moveUpLabel: "Przenieś poziom {{name}} wyżej",
      moveDownLabel: "Przenieś poziom {{name}} niżej",
      deleteBlockedInUse:
        "Najpierw przepnij {{count}} firm na inny poziom - poziom w użyciu nie kasuje się razem z logotypami.",
      deleteConfirmTitle: "Usunąć poziom {{name}}?",
      deleteConfirmBody:
        "Świadczenia poziomu zostaną usunięte razem z nim. Firmy przypięte do wydarzenia zostają nietknięte.",

      dialog: {
        createTitle: "Nowy poziom sponsorski",
        editTitle: "Poziom sponsorski",
        description:
          "Nazwa jest wymagana w obu językach. Klucz jest niezmienny po zapisie, bo trafia do kotwicy na stronie i do materiałów handlowych.",
        sectionIdentity: "Nazwa i klucz",
        sectionOffer: "Oferta",
        sectionDisplay: "Wygląd na stronie",
        keyLabel: "Klucz techniczny (a-z, 0-9, _)",
        keyHint: "Klucz jest niezmienny po zapisie - używa go kotwica /sponsorzy#klucz.",
        namePlLabel: "Nazwa PL",
        nameEnLabel: "Nazwa EN",
        descriptionPlLabel: "Opis PL",
        descriptionEnLabel: "Opis EN",
        descriptionHint: "Opis widzi gość na stronie „Zostań sponsorem”, obok listy świadczeń.",
        rankLabel: "Ranga poziomu",
        rankHint: "Od 0 do 1000. Wyższa liczba stawia grupę wyżej na stronie wydarzenia.",
        accentColorLabel: "Kolor akcentu (#rrggbb)",
        accentColorHint: "Pusty = poziom dziedziczy kolor marki wydarzenia.",
        logoSizeLabel: "Rozmiar logotypu",
        logoSizeHint: "Rozmiar jest częścią pakietu, nie decyzją o wyglądzie pojedynczej strony.",
        maxCompaniesLabel: "Maksymalna liczba firm",
        maxCompaniesHint:
          "Pusty = bez limitu. Limit liczy wszystkie przypięcia, także te przygotowywane - miejsce jest sprzedane w chwili przypięcia.",
        sortOrderLabel: "Kolejność",
        isActiveLabel: "Oferowany na tym wydarzeniu",
        benefitsLabel: "Świadczenia poziomu",
        benefitsHint:
          "Pozycja bez tekstu w obu językach jest pomijana przy zapisie. Kolejność ustawiasz przeciąganiem.",
        benefitPlPlaceholder: "Świadczenie PL",
        benefitEnPlaceholder: "Świadczenie EN",
        benefitAddAction: "Dodaj świadczenie",
        benefitRemoveLabel: "Usuń świadczenie {{label}}",
        saveAction: "Zapisz poziom",
        cancelAction: "Anuluj",
      },

      errors: {
        names: "Nazwa jest wymagana w obu językach (od 2 do 80 znaków).",
        descriptionTooLong: "Opis poziomu może mieć najwyżej 1000 znaków.",
        key: "Klucz musi zaczynać się literą i zawierać wyłącznie a-z, 0-9 i _.",
        duplicateKey: "Poziom z tym kluczem już istnieje na tym wydarzeniu.",
        rank: "Ranga musi być liczbą od 0 do 1000.",
        accentColor: "Kolor akcentu zapisz jako #rrggbb.",
        logoSize: "Rozmiar logotypu musi być mały, średni albo duży.",
        maxCompanies: "Maksymalna liczba firm musi być liczbą większą od zera.",
        overCapacity:
          "Na tym poziomie jest już {{used}} firm, a limit {{limit}} jest niższy. Odepnij firmy albo podnieś limit.",
        benefitLabel: "Świadczenie wymaga tekstu w obu językach (najwyżej 200 znaków).",
        inUse: "Poziom jest używany przez {{count}} firm - najpierw je przepnij.",
        notFound: "Poziom nie istnieje na tym wydarzeniu.",
      },

      toasts: {
        saved: "Poziom sponsorski zapisany",
        deleted: "Poziom sponsorski usunięty",
        reordered: "Kolejność poziomów zmieniona",
      },
    },

    list: {
      title: "Firmy przy wydarzeniu",
      subtitle:
        "Sponsorzy, partnerzy, patroni medialni i wystawcy - wszyscy z kartoteki firm. Nazwa, logotyp i opis pokazywane na stronie to migawka zapisana przy przypięciu.",
      addAction: "Przypnij firmę",
      searchPlaceholder: "Szukaj po nazwie firmy albo numerze stanowiska",
      loading: "Wczytywanie firm…",
      empty:
        "Do tego wydarzenia nie jest przypięta jeszcze żadna firma. Wybierz pierwszą z kartoteki.",
      emptyFiltered: "Żadna firma nie pasuje do tych filtrów.",
      staffOnly: "Lista sponsorów jest dostępna dla administratora i redaktora organizacji.",
      clearFilters: "Wyczyść filtry",
      range: "{{from}}-{{to}} z {{total}}",
      prevPage: "Poprzednia strona",
      nextPage: "Następna strona",

      filters: {
        tierLabel: "Poziom",
        tierAll: "Wszystkie poziomy",
        tierNone: "Bez poziomu",
        roleLabel: "Rola",
        publicationLabel: "Publikacja",
      },

      row: {
        noTier: "Bez poziomu",
        boothLabel: "Stanowisko {{booth}}",
        noBooth: "Bez stanowiska",
        contacts: "Osoby kontaktowe: {{count}}",
        noContacts: "Bez osoby kontaktowej",
        materials: "Materiały: {{count}} ({{published}} na stronie)",
        noMaterials: "Bez materiałów",
        publishedBadge: "Na stronie",
        draftBadge: "Przygotowywane",
        driftBadge: "Rozjazd z kartoteką",
        editAction: "Edytuj przypięcie firmy {{name}}",
        deleteAction: "Odepnij firmę {{name}}",
        openCrmAction: "Otwórz kartotekę firmy {{name}}",
        moveUpLabel: "Przenieś firmę {{name}} wyżej",
        moveDownLabel: "Przenieś firmę {{name}} niżej",
        noLogo: "Bez logotypu",
      },

      bulk: {
        selectedCount: "Wybrano: {{count}}",
        publishAction: "Opublikuj wybrane",
        unpublishAction: "Wycofaj wybrane",
        refreshAction: "Odśwież migawki wybranych",
        clearSelection: "Odznacz wszystko",
      },

      deleteConfirmTitle: "Odpiąć firmę {{name}} od wydarzenia?",
      deleteConfirmBody:
        "Osoby kontaktowe i materiały tego przypięcia zostaną usunięte. Firma w kartotece zostaje nietknięta.",

      toasts: {
        saved: "Przypięcie zapisane",
        deleted: "Firma odpięta od wydarzenia",
        reordered: "Kolejność firm zmieniona",
        published: "Opublikowano firm: {{count}}",
        unpublished: "Wycofano firm: {{count}}",
      },
    },

    picker: {
      title: "Przypnij firmę z kartoteki",
      description:
        "Wystawcy i sponsorzy nie są osobnym rejestrem - to firmy z kartoteki. Wybierz firmę, a nazwa, logotyp, adres strony i kraj zostaną zapisane jako migawka tego wydarzenia.",
      searchPlaceholder: "Szukaj po nazwie, domenie albo mieście",
      searchHint: "Wpisz co najmniej dwa znaki. Lista pokazuje najwyżej 50 firm.",
      loading: "Szukanie firm…",
      empty: "Kartoteka nie ma firmy pasującej do tego zapytania.",
      emptyRegistry:
        "Kartoteka firm tej organizacji jest pusta. Dodaj firmę w kartotece, zanim przypniesz ją do wydarzenia.",
      pinnedBadge: "Już przypięta",
      pinnedHint: "Ta firma jest już przypięta do tego wydarzenia - otwórz istniejące przypięcie.",
      openPinnedAction: "Otwórz przypięcie",
      eventsCount: "Wydarzenia: {{count}}",
      eventsCountNone: "Pierwszy raz u nas",
      noLogoHint: "Firma nie ma logotypu w kartotece - wgraj go w polu migawki.",
      selectAction: "Przypnij",
      cancelAction: "Anuluj",
    },

    form: {
      createTitle: "Nowe przypięcie firmy",
      editTitle: "Przypięcie firmy",
      description:
        "Rola i poziom decydują o tym, gdzie firma stanie na stronie. Migawka decyduje o tym, jak będzie wyglądać - także za dwa lata.",
      sectionPlacement: "Miejsce na stronie",
      sectionSnapshot: "Migawka prezentacji",
      sectionInternal: "Notatki wewnętrzne",
      companyLabel: "Firma z kartoteki",
      companyHint: "Firma jest niezmienna po zapisie. Zmiana firmy to nowe przypięcie.",
      roleLabel: "Rola",
      tierLabel: "Poziom sponsorski",
      tierHint: "Sponsor wymaga poziomu do publikacji. Partner, patron i wystawca nie wymagają.",
      tierNone: "Bez poziomu",
      boothLabel: "Numer albo nazwa stanowiska",
      boothHint: "Najwyżej 40 znaków, np. „B14” albo „Foyer / stolik 3”.",
      sortOrderLabel: "Kolejność w grupie",
      isPublishedLabel: "Pokaż na stronie wydarzenia",
      snapshotNameLabel: "Nazwa na stronie",
      snapshotLogoLabel: "Adres logotypu",
      snapshotLogoHint: "Adres https albo ścieżka pliku w naszym magazynie.",
      snapshotDescriptionPlLabel: "Opis PL",
      snapshotDescriptionEnLabel: "Opis EN",
      snapshotDescriptionHint:
        "Opis jest redakcyjny i nie ma odpowiednika w kartotece - odświeżenie migawki nigdy go nie nadpisuje.",
      snapshotWebsiteLabel: "Adres strony firmy",
      snapshotWebsiteHint: "Adres bez schematu zostanie domknięty do https.",
      snapshotCountryLabel: "Kraj",
      internalNoteLabel: "Notatka wewnętrzna",
      internalNoteHint:
        "Ustalenia, numer umowy, kontekst rozmowy. Nie wychodzi na stronę i nie wychodzi żadnym publicznym odczytem.",
      saveAction: "Zapisz przypięcie",
      cancelAction: "Anuluj",

      errors: {
        company: "Wybierz firmę z kartoteki.",
        companyNotFound: "Ta firma nie istnieje w kartotece tej organizacji.",
        companyDuplicate: "Ta firma jest już przypięta do tego wydarzenia.",
        event: "Przypięcie musi wskazywać wydarzenie.",
        eventNotFound: "To wydarzenie nie istnieje w tej organizacji.",
        role: "Wybierz rolę firmy na wydarzeniu.",
        tierRequired:
          "Sponsor musi mieć poziom, żeby stanąć na stronie. Wybierz poziom albo zmień rolę na partnera.",
        tierNotFound: "Ten poziom nie należy do tego wydarzenia.",
        tierFull:
          "Poziom ma {{limit}} miejsc, a zajętych jest {{used}}. Podnieś limit albo wybierz inny poziom.",
        snapshotName: "Nazwa na stronie jest wymagana (najwyżej 200 znaków).",
        snapshotLogo: "Adres logotypu musi zaczynać się od https:// albo od /.",
        snapshotWebsite: "Adres strony musi zaczynać się od http:// albo https://.",
        snapshotDescriptionTooLong: "Opis może mieć najwyżej 2000 znaków.",
        snapshotCountry: "Kraj musi mieć od 2 do 120 znaków.",
        booth: "Nazwa stanowiska może mieć najwyżej 40 znaków.",
        internalNote: "Notatka wewnętrzna może mieć najwyżej 2000 znaków.",
        notFound: "To przypięcie nie istnieje w tej organizacji.",
      },
    },

    snapshot: {
      panelTitle: "Migawka i kartoteka",
      panelDescription:
        "Strona wydarzenia pokazuje migawkę zapisaną przy przypięciu, a nie bieżącą kartotekę. Dzięki temu archiwum sprzed dwóch lat wygląda tak, jak wyglądało wtedy.",
      takenAt: "Migawka z {{date}}",
      inSyncBadge: "Zgodna z kartoteką",
      driftTitle: "Kartoteka poszła dalej",
      driftFieldsLabel: "Różnią się: {{fields}}",
      driftRowSnapshot: "Na stronie",
      driftRowCrm: "W kartotece",
      manualTitle: "Prezentacja nadpisana ręcznie",
      manualDescription:
        "Ta migawka nie jest kopią kartoteki, więc różnica jest zamierzona. Odświeżenie pominie ten wiersz, chyba że wybierzesz „nadpisz także ręczne”.",
      refreshOneAction: "Odśwież migawkę z kartoteki",
      refreshAllAction: "Odśwież wszystkie rozjechane",
      includeManualLabel: "Nadpisz także migawki ustawione ręcznie",
      refreshConfirmTitle: "Odświeżyć migawkę z kartoteki?",
      refreshConfirmBody:
        "Nazwa, logotyp, adres strony i kraj zostaną przepisane z kartoteki. Opis PL i EN zostaną nietknięte, bo kartoteka nie ma opisu.",
      whyManualTitle: "Dlaczego to nie dzieje się samo",
      whyManualBody:
        "Kartotekę edytuje sprzedaż, a stronę wydarzenia podpisuje organizator. Automat przepisałby dziesiątki stron archiwalnych przy jednym zapisie w kartotece - bez recenzji i bez cofnięcia.",

      toasts: {
        refreshedOne: "Migawka odświeżona",
        refreshedMany: "Odświeżono migawek: {{count}}",
        refreshedNone: "Wszystkie migawki są już zgodne z kartoteką",
      },
    },

    contacts: {
      title: "Osoby kontaktowe",
      subtitle:
        "Osoby z kartoteki obsługujące to przypięcie. Dane są czytane na żywo z kartoteki, więc zmiana numeru telefonu widać tu od razu.",
      addAction: "Dodaj osobę",
      searchPlaceholder: "Szukaj osoby w kartotece",
      loading: "Wczytywanie osób…",
      empty: "Do tego przypięcia nie jest przypisana żadna osoba.",
      privacyNote:
        "Dane kontaktowe nie wychodzą na stronę wydarzenia żadną ścieżką - widzi je wyłącznie zespół organizatora.",
      roleLabel: "Rola",
      companyMismatch: "Osoba z firmy {{company}}",
      companyMismatchHint:
        "Osoba z innej firmy niż przypięta jest w porządku - tak wygląda sponsor obsługiwany przez agencję.",
      noCompany: "Bez firmy w kartotece",
      noPhone: "Bez telefonu",
      noEmail: "Bez adresu e-mail",
      removeLabel: "Odepnij osobę {{name}}",
      saveAction: "Zapisz osoby kontaktowe",
      cancelAction: "Anuluj",

      errors: {
        lead: "Wybierz osobę z kartoteki.",
        leadNotFound: "Ta osoba nie istnieje w kartotece tej organizacji.",
        role: "Rola musi być jedną z: osoba decyzyjna, marketing, rozliczenia, obsługa na miejscu.",
        sponsor: "Osoby kontaktowe wymagają zapisanego przypięcia.",
        duplicate: "Ta osoba jest już przypisana do tego przypięcia.",
      },

      toasts: {
        saved: "Osoby kontaktowe zapisane ({{count}})",
        cleared: "Wszystkie osoby kontaktowe odpięte",
      },
    },

    materials: {
      title: "Materiały sponsora",
      subtitle:
        "Zasilają zakładkę „Materiały” na stronie wydarzenia. Pozycja wychodzi na stronę tylko wtedy, gdy jest opublikowana i gdy firma jest pokazana na stronie.",
      addAction: "Dodaj materiał",
      loading: "Wczytywanie materiałów…",
      empty: "Ten sponsor nie ma jeszcze żadnego materiału.",
      kindLabel: "Rodzaj",
      titlePlLabel: "Tytuł PL",
      titleEnLabel: "Tytuł EN",
      urlLabel: "Adres pliku albo odnośnika",
      urlHint: "Adres https albo ścieżka pliku w naszym magazynie. Najwyżej 1000 znaków.",
      sortOrderLabel: "Kolejność",
      isPublishedLabel: "Pokaż na stronie wydarzenia",
      publishedBadge: "Na stronie",
      draftBadge: "Przygotowywane",
      hiddenBySponsorBadge: "Ukryte razem z firmą",
      hiddenBySponsorHint:
        "Materiał jest opublikowany, ale firma nie jest pokazana na stronie - dlatego pozycji tam nie ma.",
      editLabel: "Edytuj materiał {{title}}",
      deleteLabel: "Usuń materiał {{title}}",
      moveUpLabel: "Przenieś materiał {{title}} wyżej",
      moveDownLabel: "Przenieś materiał {{title}} niżej",
      deleteConfirmTitle: "Usunąć materiał {{title}}?",
      deleteConfirmBody: "Plik w magazynie zostaje - usuwamy tylko pozycję na liście materiałów.",
      saveAction: "Zapisz materiał",
      cancelAction: "Anuluj",

      errors: {
        titles: "Tytuł jest wymagany w obu językach (od 2 do 160 znaków).",
        url: "Adres jest wymagany i musi zaczynać się od https:// albo od /.",
        urlTooLong: "Adres może mieć najwyżej 1000 znaków.",
        kind: "Wybierz rodzaj materiału.",
        sponsor: "Materiał wymaga zapisanego przypięcia firmy.",
        notFound: "Ten materiał nie istnieje w tej organizacji.",
      },

      toasts: {
        saved: "Materiał zapisany",
        deleted: "Materiał usunięty",
        reordered: "Kolejność materiałów zmieniona",
      },
    },

    publicPage: {
      sectionTitle: "Sponsorzy i partnerzy",
      sectionSubtitle: "Wydarzenie powstaje razem z firmami, które je współtworzą.",
      untieredGroupTitle: "Partnerzy wydarzenia",
      benefitsTitle: "W pakiecie",
      boothLabel: "Stanowisko {{booth}}",
      visitWebsite: "Strona firmy {{name}}",
      materialsSectionTitle: "Materiały",
      materialsSectionSubtitle: "Prezentacje, katalogi i nagrania udostępnione przez partnerów.",
      materialsEmpty: "Partnerzy nie udostępnili jeszcze żadnych materiałów.",
      empty: "Lista partnerów tego wydarzenia jest w przygotowaniu.",
    },

    errors: {
      forbidden: "Ta operacja jest dostępna dla administratora i redaktora organizacji.",
      payload: "Żądanie ma nieprawidłowy kształt - odśwież stronę i spróbuj ponownie.",
      companyInUse:
        "Tej firmy nie da się usunąć z kartoteki, bo była sponsorem wydarzenia. Przypięcie jest dokumentem sponsoringu.",
      unknown: "Nie udało się zapisać zmiany. Spróbuj ponownie.",
    },
  },
};

export const adminEventSponsorsEn = {
  adminEventSponsors: {
    nav: {
      sectionTitle: "Sponsors and partners",
      sponsors: "Companies",
      tiers: "Tiers",
      materials: "Materials",
    },

    roles: {
      sponsor: "Sponsor",
      partner: "Partner",
      media_partner: "Media partner",
      exhibitor: "Exhibitor",
    },
    roleHints: {
      sponsor: "A company with a sponsorship package. Publishing requires a tier.",
      partner: "A knowledge or institutional partner without a package.",
      media_partner: "Media patronage, usually a barter exchange.",
      exhibitor: "An exhibitor with a booth. The same company register, not a separate one.",
    },
    rolesAll: "All roles",

    logoSizes: {
      sm: "Small",
      md: "Medium",
      lg: "Large",
    },

    snapshotSources: {
      crm: "Copied from the register",
      manual: "Overridden by hand",
    },
    snapshotSourceHints: {
      crm: "The snapshot is a copy of the register. A difference means the register moved on.",
      manual:
        "An editor set this presentation. The difference against the register is deliberate, not a defect.",
    },

    materialKinds: {
      document: "Document",
      presentation: "Presentation",
      video: "Recording",
      link: "Link",
      logo_pack: "Logo pack",
    },

    contactRoles: {
      primary: "Decision maker",
      marketing: "Marketing",
      billing: "Billing",
      onsite: "On-site staff",
    },

    driftFields: {
      name: "name",
      logo_url: "logo",
      website: "website",
      country: "country",
    },

    publication: {
      all: "All",
      published: "Published",
      draft: "In preparation",
    },

    tiers: {
      title: "Sponsorship tiers",
      subtitle:
        "The rate card of this event. A tier decides the order of logo groups on the page, the logo size and how many seats there are to sell.",
      addAction: "New tier",
      loading: "Loading tiers…",
      empty: "There is no tier yet. Add the first one so you can publish a sponsor with a package.",
      staffOnly: "Sponsorship tiers are available to the organisation's admin and editor.",
      inactiveBadge: "disabled",
      inactiveHint:
        "A disabled tier disappears from the pin form, but a logo group already published stays on the page.",
      rankLabel: "Rank: {{rank}}",
      rankHint:
        "A higher rank is a higher tier. Two tiers may share a rank - the sort order then decides.",
      companiesCount: "Companies: {{count}}",
      publishedCount: "On the page: {{count}}",
      slotsLeft: "Seats left: {{count}}",
      slotsUnlimited: "No seat limit",
      slotsFull: "All seats sold",
      benefitsCount: "Benefits: {{count}}",
      benefitsEmpty: "No benefits listed",
      editLabel: "Edit tier {{name}}",
      deleteLabel: "Delete tier {{name}}",
      moveUpLabel: "Move tier {{name}} up",
      moveDownLabel: "Move tier {{name}} down",
      deleteBlockedInUse:
        "Move {{count}} companies to another tier first - a tier in use is not deleted together with its logos.",
      deleteConfirmTitle: "Delete tier {{name}}?",
      deleteConfirmBody:
        "The tier's benefits will be deleted with it. Companies pinned to the event stay untouched.",

      dialog: {
        createTitle: "New sponsorship tier",
        editTitle: "Sponsorship tier",
        description:
          "The name is required in both languages. The key cannot change after saving, because it goes into the page anchor and into sales materials.",
        sectionIdentity: "Name and key",
        sectionOffer: "Offer",
        sectionDisplay: "Appearance on the page",
        keyLabel: "Technical key (a-z, 0-9, _)",
        keyHint: "The key cannot change after saving - the /sponsors#key anchor uses it.",
        namePlLabel: "Name PL",
        nameEnLabel: "Name EN",
        descriptionPlLabel: "Description PL",
        descriptionEnLabel: "Description EN",
        descriptionHint:
          "The description is shown to visitors on the “Become a sponsor” page, next to the benefits.",
        rankLabel: "Tier rank",
        rankHint: "From 0 to 1000. A higher number puts the group higher on the event page.",
        accentColorLabel: "Accent colour (#rrggbb)",
        accentColorHint: "Empty = the tier inherits the event's brand colour.",
        logoSizeLabel: "Logo size",
        logoSizeHint:
          "The size is part of the package, not a styling decision made per single page.",
        maxCompaniesLabel: "Maximum number of companies",
        maxCompaniesHint:
          "Empty = no limit. The limit counts every pin, including those in preparation - a seat is sold the moment it is pinned.",
        sortOrderLabel: "Sort order",
        isActiveLabel: "Offered on this event",
        benefitsLabel: "Tier benefits",
        benefitsHint:
          "An entry without text in both languages is skipped on save. Set the order by dragging.",
        benefitPlPlaceholder: "Benefit PL",
        benefitEnPlaceholder: "Benefit EN",
        benefitAddAction: "Add benefit",
        benefitRemoveLabel: "Remove benefit {{label}}",
        saveAction: "Save tier",
        cancelAction: "Cancel",
      },

      errors: {
        names: "The name is required in both languages (2 to 80 characters).",
        descriptionTooLong: "The tier description can be at most 1000 characters.",
        key: "The key must start with a letter and contain only a-z, 0-9 and _.",
        duplicateKey: "A tier with this key already exists on this event.",
        rank: "The rank must be a number between 0 and 1000.",
        accentColor: "Write the accent colour as #rrggbb.",
        logoSize: "The logo size must be small, medium or large.",
        maxCompanies: "The maximum number of companies must be greater than zero.",
        overCapacity:
          "This tier already holds {{used}} companies and the limit {{limit}} is lower. Unpin companies or raise the limit.",
        benefitLabel: "A benefit needs text in both languages (at most 200 characters).",
        inUse: "The tier is used by {{count}} companies - move them first.",
        notFound: "The tier does not exist on this event.",
      },

      toasts: {
        saved: "Sponsorship tier saved",
        deleted: "Sponsorship tier deleted",
        reordered: "Tier order changed",
      },
    },

    list: {
      title: "Companies at this event",
      subtitle:
        "Sponsors, partners, media partners and exhibitors - all of them from the company register. The name, logo and description shown on the page are a snapshot saved when pinning.",
      addAction: "Pin a company",
      searchPlaceholder: "Search by company name or booth",
      loading: "Loading companies…",
      empty: "No company is pinned to this event yet. Pick the first one from the register.",
      emptyFiltered: "No company matches these filters.",
      staffOnly: "The sponsor list is available to the organisation's admin and editor.",
      clearFilters: "Clear filters",
      range: "{{from}}-{{to}} of {{total}}",
      prevPage: "Previous page",
      nextPage: "Next page",

      filters: {
        tierLabel: "Tier",
        tierAll: "All tiers",
        tierNone: "No tier",
        roleLabel: "Role",
        publicationLabel: "Publication",
      },

      row: {
        noTier: "No tier",
        boothLabel: "Booth {{booth}}",
        noBooth: "No booth",
        contacts: "Contacts: {{count}}",
        noContacts: "No contact person",
        materials: "Materials: {{count}} ({{published}} on the page)",
        noMaterials: "No materials",
        publishedBadge: "On the page",
        draftBadge: "In preparation",
        driftBadge: "Differs from the register",
        editAction: "Edit the pin for {{name}}",
        deleteAction: "Unpin {{name}}",
        openCrmAction: "Open the register entry for {{name}}",
        moveUpLabel: "Move {{name}} up",
        moveDownLabel: "Move {{name}} down",
        noLogo: "No logo",
      },

      bulk: {
        selectedCount: "Selected: {{count}}",
        publishAction: "Publish selected",
        unpublishAction: "Unpublish selected",
        refreshAction: "Refresh snapshots of selected",
        clearSelection: "Clear selection",
      },

      deleteConfirmTitle: "Unpin {{name}} from this event?",
      deleteConfirmBody:
        "The contacts and materials of this pin will be deleted. The company in the register stays untouched.",

      toasts: {
        saved: "Pin saved",
        deleted: "Company unpinned from the event",
        reordered: "Company order changed",
        published: "Published companies: {{count}}",
        unpublished: "Unpublished companies: {{count}}",
      },
    },

    picker: {
      title: "Pin a company from the register",
      description:
        "Exhibitors and sponsors are not a separate register - they are companies from the register. Pick a company and its name, logo, website and country will be saved as this event's snapshot.",
      searchPlaceholder: "Search by name, domain or city",
      searchHint: "Type at least two characters. The list shows at most 50 companies.",
      loading: "Searching companies…",
      empty: "The register has no company matching this query.",
      emptyRegistry:
        "This organisation's company register is empty. Add a company there before pinning it to an event.",
      pinnedBadge: "Already pinned",
      pinnedHint: "This company is already pinned to this event - open the existing pin.",
      openPinnedAction: "Open the pin",
      eventsCount: "Events: {{count}}",
      eventsCountNone: "First time with us",
      noLogoHint: "The company has no logo in the register - upload one in the snapshot field.",
      selectAction: "Pin",
      cancelAction: "Cancel",
    },

    form: {
      createTitle: "New company pin",
      editTitle: "Company pin",
      description:
        "The role and the tier decide where the company stands on the page. The snapshot decides how it will look - in two years as well.",
      sectionPlacement: "Place on the page",
      sectionSnapshot: "Presentation snapshot",
      sectionInternal: "Internal notes",
      companyLabel: "Company from the register",
      companyHint: "The company cannot change after saving. A different company is a new pin.",
      roleLabel: "Role",
      tierLabel: "Sponsorship tier",
      tierHint:
        "A sponsor needs a tier to be published. A partner, a media partner and an exhibitor do not.",
      tierNone: "No tier",
      boothLabel: "Booth number or name",
      boothHint: "At most 40 characters, e.g. “B14” or “Foyer / table 3”.",
      sortOrderLabel: "Order within the group",
      isPublishedLabel: "Show on the event page",
      snapshotNameLabel: "Name on the page",
      snapshotLogoLabel: "Logo address",
      snapshotLogoHint: "An https address or a file path in our storage.",
      snapshotDescriptionPlLabel: "Description PL",
      snapshotDescriptionEnLabel: "Description EN",
      snapshotDescriptionHint:
        "The description is editorial and has no counterpart in the register - refreshing the snapshot never overwrites it.",
      snapshotWebsiteLabel: "Company website",
      snapshotWebsiteHint: "An address without a scheme will be completed to https.",
      snapshotCountryLabel: "Country",
      internalNoteLabel: "Internal note",
      internalNoteHint:
        "Agreements, contract number, context of the conversation. It never reaches the page and never leaves through a public read.",
      saveAction: "Save pin",
      cancelAction: "Cancel",

      errors: {
        company: "Pick a company from the register.",
        companyNotFound: "This company does not exist in this organisation's register.",
        companyDuplicate: "This company is already pinned to this event.",
        event: "A pin must point at an event.",
        eventNotFound: "This event does not exist in this organisation.",
        role: "Pick the company's role at the event.",
        tierRequired:
          "A sponsor needs a tier to stand on the page. Pick a tier or change the role to partner.",
        tierNotFound: "This tier does not belong to this event.",
        tierFull:
          "The tier has {{limit}} seats and {{used}} are taken. Raise the limit or pick another tier.",
        snapshotName: "The name on the page is required (at most 200 characters).",
        snapshotLogo: "The logo address must start with https:// or with /.",
        snapshotWebsite: "The website must start with http:// or https://.",
        snapshotDescriptionTooLong: "The description can be at most 2000 characters.",
        snapshotCountry: "The country must be 2 to 120 characters.",
        booth: "The booth name can be at most 40 characters.",
        internalNote: "The internal note can be at most 2000 characters.",
        notFound: "This pin does not exist in this organisation.",
      },
    },

    snapshot: {
      panelTitle: "Snapshot and register",
      panelDescription:
        "The event page shows the snapshot saved when pinning, not the current register. That is why an archive from two years ago looks the way it looked then.",
      takenAt: "Snapshot from {{date}}",
      inSyncBadge: "Matches the register",
      driftTitle: "The register moved on",
      driftFieldsLabel: "Differences: {{fields}}",
      driftRowSnapshot: "On the page",
      driftRowCrm: "In the register",
      manualTitle: "Presentation overridden by hand",
      manualDescription:
        "This snapshot is not a copy of the register, so the difference is deliberate. A refresh skips this row unless you choose “also overwrite manual ones”.",
      refreshOneAction: "Refresh the snapshot from the register",
      refreshAllAction: "Refresh everything that differs",
      includeManualLabel: "Also overwrite snapshots set by hand",
      refreshConfirmTitle: "Refresh the snapshot from the register?",
      refreshConfirmBody:
        "The name, logo, website and country will be copied from the register. Descriptions PL and EN stay untouched, because the register has no description.",
      whyManualTitle: "Why this does not happen on its own",
      whyManualBody:
        "Sales edits the register, the organiser signs off the event page. An automation would rewrite dozens of archived pages on a single register save - with no review and no undo.",

      toasts: {
        refreshedOne: "Snapshot refreshed",
        refreshedMany: "Snapshots refreshed: {{count}}",
        refreshedNone: "Every snapshot already matches the register",
      },
    },

    contacts: {
      title: "Contact people",
      subtitle:
        "People from the register who handle this pin. Their details are read live from the register, so a new phone number shows up here immediately.",
      addAction: "Add a person",
      searchPlaceholder: "Search for a person in the register",
      loading: "Loading people…",
      empty: "No person is assigned to this pin.",
      privacyNote:
        "Contact details never reach the event page by any path - only the organiser's team sees them.",
      roleLabel: "Role",
      companyMismatch: "Works at {{company}}",
      companyMismatchHint:
        "A person from a different company than the pinned one is fine - that is how a sponsor handled by an agency looks.",
      noCompany: "No company in the register",
      noPhone: "No phone number",
      noEmail: "No email address",
      removeLabel: "Remove {{name}}",
      saveAction: "Save contact people",
      cancelAction: "Cancel",

      errors: {
        lead: "Pick a person from the register.",
        leadNotFound: "This person does not exist in this organisation's register.",
        role: "The role must be one of: decision maker, marketing, billing, on-site staff.",
        sponsor: "Contact people require a saved pin.",
        duplicate: "This person is already assigned to this pin.",
      },

      toasts: {
        saved: "Contact people saved ({{count}})",
        cleared: "All contact people removed",
      },
    },

    materials: {
      title: "Sponsor materials",
      subtitle:
        "They feed the “Materials” tab on the event page. An entry reaches the page only when it is published and the company is shown on the page.",
      addAction: "Add a material",
      loading: "Loading materials…",
      empty: "This sponsor has no material yet.",
      kindLabel: "Kind",
      titlePlLabel: "Title PL",
      titleEnLabel: "Title EN",
      urlLabel: "File or link address",
      urlHint: "An https address or a file path in our storage. At most 1000 characters.",
      sortOrderLabel: "Sort order",
      isPublishedLabel: "Show on the event page",
      publishedBadge: "On the page",
      draftBadge: "In preparation",
      hiddenBySponsorBadge: "Hidden with the company",
      hiddenBySponsorHint:
        "The material is published, but the company is not shown on the page - that is why the entry is not there.",
      editLabel: "Edit material {{title}}",
      deleteLabel: "Delete material {{title}}",
      moveUpLabel: "Move material {{title}} up",
      moveDownLabel: "Move material {{title}} down",
      deleteConfirmTitle: "Delete material {{title}}?",
      deleteConfirmBody:
        "The file in storage stays - we only remove the entry from the materials list.",
      saveAction: "Save material",
      cancelAction: "Cancel",

      errors: {
        titles: "The title is required in both languages (2 to 160 characters).",
        url: "The address is required and must start with https:// or with /.",
        urlTooLong: "The address can be at most 1000 characters.",
        kind: "Pick the kind of material.",
        sponsor: "A material requires a saved company pin.",
        notFound: "This material does not exist in this organisation.",
      },

      toasts: {
        saved: "Material saved",
        deleted: "Material deleted",
        reordered: "Material order changed",
      },
    },

    publicPage: {
      sectionTitle: "Sponsors and partners",
      sectionSubtitle: "This event is built together with the companies behind it.",
      untieredGroupTitle: "Event partners",
      benefitsTitle: "Included in the package",
      boothLabel: "Booth {{booth}}",
      visitWebsite: "Website of {{name}}",
      materialsSectionTitle: "Materials",
      materialsSectionSubtitle: "Presentations, catalogues and recordings shared by our partners.",
      materialsEmpty: "Our partners have not shared any materials yet.",
      empty: "The partner list for this event is being prepared.",
    },

    errors: {
      forbidden: "This operation is available to the organisation's admin and editor.",
      payload: "The request has an invalid shape - reload the page and try again.",
      companyInUse:
        "This company cannot be deleted from the register, because it sponsored an event. The pin is the document of that sponsorship.",
      unknown: "The change could not be saved. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventSponsorsPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventSponsorsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu.
 * Nazwane wiazanie pozwala splitterowi TanStacka przeniesc caly bundle
 * tlumaczen do chunka trasy - side-effectowy import w pliku trasy landowal
 * w eager-owym grafie wejsciowym kazdej strony. Rejestracja dzieje sie przy
 * ewaluacji modulu (przed renderem komponentu), dokladnie jak wczesniej.
 */
export function ensureI18n(): void {}
