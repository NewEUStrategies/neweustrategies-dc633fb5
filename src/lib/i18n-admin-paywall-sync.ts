// i18n paywalla i edytorów źródłowych S1 (PL/EN): rdzeń SYNCHRONIZACJI
// (`adminPaywall.sync`, tor T2) i ekran `/admin/paywall` (reszta
// `adminPaywall.*`, tor T3).
//
// CO TU JEST. (1) Napisy, którymi UI tłumaczy błędy wspólnych mutatorów S1
// (`planQueries`, `tierMutations`, `meteringQueries`, `contentAccessQueries`,
// `useCheckoutSettings`, `retention/mutations`, `newsletter/settingsQueries`).
// Mutatory celowo NIE pokazują toastów i nie importują i18n - rzucają błąd
// z kodem `40001` (zapis nieaktualny), a ekran (paywall, cennik, członkostwo,
// newsletter, popupy) mówi to JEDNYMI słowami. Bez wspólnego słownika każdy
// ekran opisywałby ten sam konflikt inaczej i admin nie wiedziałby, że to ta
// sama sytuacja. (2) Organizmy paywalla (`components/admin/paywall/*`), które
// reużywa też hub „Przychód i lejek" (S7) - stąd jeden słownik, a nie kopia
// w słowniku huba.
//
// DLACZEGO NOWY PREFIKS, A NIE `admin.paywall.*`. Stary słownik ekranu był
// rozbity na `i18n-admin-core.ts` i `i18n-admin-extras.ts` (pliki współdzielone)
// i zostawiał w polskim UI angielskie „Metering"/„Checkout". Stare klucze
// usuwa Integrator (I9) - do tego czasu nikt ich już nie czyta.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO, więc słowo równe klasie Tailwinda (np. angielskie „ukryty",
// „stały", „widoczny", „tabela", „ramka") dokłada regułę do CSS każdej strony
// czytelnika (zapas `publicCss`: ułamek kilobajta). Napisy niżej są dobrane
// tak, żeby żadne nie było nazwą klasy narzędziowej.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW. Plik trasy nie importuje słownika efektem
// ubocznym (bramka `adminRouteDictionaryImports.gate.test.ts`): import w powłoce
// trasy zostaje w chunku wejściowym każdej strony. Komponenty wołają `ensureI18n()`.
import i18n from "@/lib/i18n";

const pl = {
  adminPaywall: {
    sync: {
      staleWrite: "Ktoś zmienił te ustawienia w innym miejscu, zanim zapisałeś swoje.",
      staleWriteHint:
        "Twój szkic został zachowany. Wczytaj aktualną wersję, porównaj ją ze swoimi zmianami i zapisz ponownie.",
      reload: "Wczytaj aktualne",
      keepDraft: "Zostaw mój szkic",
      merged: "Zapisano. Równoległe zmiany innych pól z drugiej karty zostały zachowane.",
      serverMissing:
        "Brak zapisanej konfiguracji - serwer traktuje tę funkcję jako wyłączoną, dopóki jej nie zapiszesz.",
      reloaded:
        "Wczytano aktualną wersję. Twoje zmiany zostały nałożone na nią - sprawdź je i zapisz ponownie.",
    },
    page: {
      title: "Paywall i plany",
      subtitle:
        "Plany subskrypcji i ich sprzedaż, darmowy licznik artykułów, wyjątki dla pojedynczych treści oraz ustawienia kasy. Tryb dostępu treści ustawiasz w edytorze wpisu lub strony.",
    },
    tabs: {
      plans: "Plany",
      metering: "Licznik artykułów",
      overrides: "Wyjątki",
      checkout: "Kasa",
    },
    readOnly: {
      hint: "Tylko podgląd - zmiany wprowadza redakcja w panelu Paywall.",
    },
    kpi: {
      plans: "Plany",
      active: "Aktywne",
      forSale: "W sprzedaży",
      currencies: "Waluty",
      metering: "Licznik artykułów",
      meteringOn: "Włączony · {{limit}}/mies.",
      meteringOff: "Wyłączony",
      meteringMissing: "Brak konfiguracji",
      meteringUnknown: "Nie udało się sprawdzić",
    },
    interval: {
      two_weeks: "Co 2 tygodnie",
      month: "Miesięcznie",
      quarter: "Kwartalnie",
      year: "Rocznie",
      one_time: "Jednorazowo",
    },
    plans: {
      title: "Katalog planów",
      description:
        "Ceny, cykle i sprzedaż planów subskrypcji. Otwórz plan, aby zmienić szczegóły - zapis zmienia wyłącznie pola tego ekranu.",
      add: "Nowy plan",
      caption: "Plany subskrypcji z ceną, cyklem, stanem i sprzedażą",
      colName: "Nazwa",
      colPrice: "Cena",
      colInterval: "Cykl",
      colStatus: "Stan",
      colSale: "Sprzedaż",
      colActions: "Akcje",
      empty: "Brak planów - dodaj pierwszy plan.",
      readError: "Nie udało się wczytać planów. Spróbuj ponownie.",
      retry: "Spróbuj ponownie",
      highlighted: "Wyróżniony",
      active: "Aktywny",
      inactive: "Nieaktywny",
      forSale: "W sprzedaży",
      withdrawn: "Wycofany",
      eurApprox: "EN: {{amount}}",
      noCatalogPair: "Brak pary w katalogu kasy",
      noCatalogPairHint:
        "Kasa nie znajdzie ceny dla pary warstwa + cykl tego planu, więc zakup skończy się błędem. Przypnij warstwę w Członkostwie albo zmień cykl.",
      edit: "Edytuj",
      editLabel: "Edytuj plan {{name}}",
      deleteLabel: "Usuń plan {{name}}",
      deleteAdminOnly:
        "Plany usuwa tylko administrator. Plan, którego nie chcesz sprzedawać, wycofaj ze sprzedaży w edytorze.",
      deleteTitle: "Usunąć plan „{{name}}”?",
      deleteDescription:
        "Plan nie ma żadnych subskrypcji. Usunięcia nie da się cofnąć - plan zniknie z kasy, cennika i raportów.",
      deleteConfirm: "Usuń plan",
      deleteBlockedTitle: "Planu „{{name}}” nie można usunąć",
      deleteBlockedDescription_one:
        "Plan ma {{count}} subskrypcję. Usunięcie skasowałoby ją razem z historią klienta. Zamiast tego wycofaj plan ze sprzedaży - obecny subskrybent odnawia się bez zmian.",
      deleteBlockedDescription_few:
        "Plan ma {{count}} subskrypcje. Usunięcie skasowałoby je razem z historią klientów. Zamiast tego wycofaj plan ze sprzedaży - obecni subskrybenci odnawiają się bez zmian.",
      deleteBlockedDescription_many:
        "Plan ma {{count}} subskrypcji. Usunięcie skasowałoby je razem z historią klientów. Zamiast tego wycofaj plan ze sprzedaży - obecni subskrybenci odnawiają się bez zmian.",
      deleteBlockedDescription_other:
        "Plan ma {{count}} subskrypcji. Usunięcie skasowałoby je razem z historią klientów. Zamiast tego wycofaj plan ze sprzedaży - obecni subskrybenci odnawiają się bez zmian.",
      withdraw: "Wycofaj ze sprzedaży",
      alreadyWithdrawn: "Plan jest już wycofany ze sprzedaży.",
      withdrawnToast: "Plan wycofany ze sprzedaży",
      deleted: "Plan usunięty",
      countError: "Nie udało się policzyć subskrypcji planu - usunięcie wstrzymane.",
    },
    editor: {
      titleNew: "Nowy plan",
      titleEdit: "Plan: {{name}}",
      description:
        "Treści dwujęzyczne (PL/EN), cena w jednostkach głównych waluty i zasady sprzedaży. Warstwę członkostwa planu ustawiasz w Członkostwie.",
      notFound: "Tego planu nie ma już w katalogu - mógł zostać usunięty w innej karcie.",
      groupNaming: "Nazewnictwo",
      groupPricing: "Cena i rozliczenie",
      groupSale: "Sprzedaż i wyróżnienie",
      groupFeatures: "Lista funkcji",
      namePl: "Nazwa PL",
      nameEn: "Nazwa EN",
      descPl: "Opis PL",
      descEn: "Opis EN",
      price: "Cena",
      priceHint: "W jednostkach głównych waluty, np. 49,00.",
      priceInvalid: "Podaj kwotę z najwyżej dwoma miejscami po przecinku, np. 49,00.",
      currency: "Waluta",
      interval: "Cykl rozliczenia",
      trialDays: "Dni okresu próbnego",
      sort: "Kolejność",
      tierSource: "Członkostwo → mapowanie planów",
      tierHint:
        "Warstwa decyduje, co plan otwiera. Przypięcie zmieniasz w Członkostwie - tutaj jest tylko do odczytu.",
      active: "Aktywny",
      activeHint:
        "Wyłączenie odcina także obecnych subskrybentów: ich odnowienia przestają trafiać na ten plan.",
      activeOffTitle: "Wyłączyć plan z subskrypcjami?",
      activeOffDescription_one:
        "Plan ma {{count}} subskrypcję. Wyłączenie odetnie tego klienta - odnowienie przestanie trafiać na plan. Jeśli chcesz tylko zatrzymać nową sprzedaż, wyłącz „W sprzedaży”.",
      activeOffDescription_few:
        "Plan ma {{count}} subskrypcje. Wyłączenie odetnie tych klientów - odnowienia przestaną trafiać na plan. Jeśli chcesz tylko zatrzymać nową sprzedaż, wyłącz „W sprzedaży”.",
      activeOffDescription_many:
        "Plan ma {{count}} subskrypcji. Wyłączenie odetnie tych klientów - odnowienia przestaną trafiać na plan. Jeśli chcesz tylko zatrzymać nową sprzedaż, wyłącz „W sprzedaży”.",
      activeOffDescription_other:
        "Plan ma {{count}} subskrypcji. Wyłączenie odetnie tych klientów - odnowienia przestaną trafiać na plan. Jeśli chcesz tylko zatrzymać nową sprzedaż, wyłącz „W sprzedaży”.",
      activeOffConfirm: "Wyłącz mimo to",
      activeCountError:
        "Nie udało się policzyć subskrypcji planu - plan zostaje aktywny, dopóki liczba nie będzie znana.",
      forSale: "W sprzedaży",
      forSaleHint:
        "Plan przyjmuje nowe zakupy w kasie i przy zmianie planu. Wyłączenie wycofuje go ze sprzedaży - obecni subskrybenci odnawiają się bez zmian (w przeciwieństwie do »Aktywny«)",
      forSaleHelp: "Co znaczy „W sprzedaży”?",
      highlighted: "Wyróżniony",
      badgePl: "Plakietka PL",
      badgeEn: "Plakietka EN",
      featuresPl: "Funkcje PL (jedna w linii)",
      featuresEn: "Funkcje EN (jedna w linii)",
      save: "Zapisz plan",
      create: "Dodaj plan",
      cancel: "Anuluj",
      saved: "Zapisano plan",
      created: "Dodano plan",
    },
    metering: {
      title: "Licznik artykułów - darmowy limit miesięczny",
      subtitle:
        "Lejek: gość → rejestracja (limit konta bezpłatnego) → subskrypcja. Licznik liczy serwer; udział pojedynczej treści zmienisz w jej edytorze (sekcja Dostęp) albo w zakładce Wyjątki.",
      readError: "Nie udało się wczytać ustawień licznika. Spróbuj ponownie.",
      retry: "Spróbuj ponownie",
      missingTitle: "Wyłączony - brak konfiguracji",
      missingDescription:
        "Serwer nie ma zapisanych ustawień licznika, więc niczego nie liczy - treści z paywallem wymagają subskrypcji od razu.",
      defaultsPreview:
        "Wartości domyślne: {{member}} artykułów na miesiąc dla zalogowanych, {{anon}} dla gości.",
      enableDefaults: "Włącz z wartościami domyślnymi",
      enabled: "Licznik włączony",
      memberLimit: "Limit dla zalogowanych (artykuły / mies.)",
      anonLimit: "Limit dla gości (0 = wymagaj rejestracji)",
      meterPaid: "Licz artykuły płatne",
      meterMembers: "Licz artykuły „tylko dla zalogowanych”",
      showCounter: "Pokazuj licznik „X z N” nad artykułem",
      save: "Zapisz ustawienia",
      saved: "Zapisano ustawienia licznika",
      saveError: "Nie udało się zapisać ustawień licznika.",
      impact: {
        title: "Podgląd wpływu na bieżący miesiąc",
        disabled:
          "Licznik wyłączony - treści z paywallem wymagają subskrypcji od razu, bez darmowego limitu.",
        error: "Nie udało się policzyć podglądu wpływu.",
        empty:
          "W tym miesiącu nie ma jeszcze odblokowań na licznik - podgląd pojawi się po pierwszych odsłonach.",
        blocked: "Kont zablokowanych",
        warning: "Kont blisko limitu",
        safe: "Kont w limicie",
        avg: "Średnie użycie",
        summary:
          "{{members}} zalogowanych i {{anon}} gości ({{views}} odsłon), maks. użycie {{max}} - z limitem {{limit}}/mies.",
      },
    },
    overrides: {
      title: "Wyjątki dla pojedynczych treści",
      subtitle:
        "Reguły z polityką licznika inną niż „dziedzicz”. To ta sama reguła, którą widzisz w edytorze wpisu i strony - zapis tutaj i tam idzie jedną drogą z kontrolą wersji.",
      search: "Szukaj po tytule",
      searchPlaceholder: "Tytuł albo adres treści",
      empty: "Brak wyjątków - wszystkie treści dziedziczą ustawienia globalne.",
      noMatches: "Żaden wyjątek nie pasuje do frazy „{{query}}”.",
      readError: "Nie udało się wczytać wyjątków. Spróbuj ponownie.",
      retry: "Spróbuj ponownie",
      caption: "Wyjątki licznika artykułów dla pojedynczych treści",
      colEntity: "Treść",
      colMode: "Tryb dostępu",
      colPolicy: "Polityka licznika",
      policyLabel: "Polityka licznika: {{title}}",
      saved: "Zapisano politykę",
      entity: {
        post: "Wpis",
        page: "Strona",
        media: "Plik",
      },
      mode: {
        public: "Publiczny",
        members: "Dla zalogowanych",
        paid: "Płatny",
        password: "Hasło",
      },
      policy: {
        inherit: "Dziedzicz",
        metered: "Zawsze licz",
        exempt: "Wyłącz z limitu",
      },
      pageInfo_one: "Strona {{page}} z {{pages}} · {{count}} wyjątek",
      pageInfo_few: "Strona {{page}} z {{pages}} · {{count}} wyjątki",
      pageInfo_many: "Strona {{page}} z {{pages}} · {{count}} wyjątków",
      pageInfo_other: "Strona {{page}} z {{pages}} · {{count}} wyjątku",
      prev: "Poprzednia strona",
      next: "Następna strona",
    },
    checkout: {
      title: "Kasa - kody rabatowe, podatki, faktury",
      subtitle:
        "Ustawienia sesji płatności Stripe. Kody promocyjne tworzysz w panelu Stripe (Produkty → Kupony); okres próbny ustawiasz w planie.",
      readError: "Nie udało się wczytać ustawień kasy. Spróbuj ponownie.",
      retry: "Spróbuj ponownie",
      allowPromo: "Pole „kod promocyjny” w kasie Stripe",
      allowPromoHint: "Kupujący wpisze kod rabatowy bezpośrednio na stronie płatności.",
      automaticTax: "Stripe Tax - automatyczny VAT",
      automaticTaxHint:
        "Wymaga aktywacji Stripe Tax na koncie Stripe. Wymusza pobranie adresu rozliczeniowego i PRZEJMUJE rozliczenie podatku od Stripe jako operatora (MoR) - włączaj tylko, jeśli rozliczasz VAT samodzielnie.",
      taxIdCollection: "Zbieraj NIP / VAT ID (trafia na fakturę)",
      taxIdCollectionHint: "Kupujący firmowy poda NIP w kasie; Stripe umieści go na fakturze.",
      addressCollection: "Adres rozliczeniowy",
      addressAuto: "Automatycznie (gdy wymagany)",
      addressRequired: "Zawsze wymagany",
      invoiceCreation: "Faktura Stripe dla płatności jednorazowych",
      invoiceCreationHint:
        "Subskrypcje mają faktury zawsze; ta opcja włącza je też dla zakupów jednorazowych. Link „Pobierz fakturę” pojawi się w Zamówieniach klienta. W trybie operatora rozliczeniowego (MoR) fakturę wystawia Stripe i parametr nie jest wysyłany.",
      save: "Zapisz ustawienia kasy",
      saved: "Zapisano ustawienia kasy",
      saveError: "Nie udało się zapisać ustawień kasy.",
      plane: {
        title: "Płaszczyzna rozliczeniowa sesji",
        managed:
          "Stripe jako operator rozliczeniowy (MoR): to Stripe nalicza podatek i wystawia fakturę. Do sesji jadą kupony, NIP i adres rozliczeniowy.",
        merchant:
          "Sprzedawca rozlicza podatek samodzielnie (Stripe Tax na Twoim koncie): do sesji jedzie automatyczny VAT, wymagany adres oraz - dla płatności jednorazowych - faktura Stripe.",
        params: "Parametry sesji: {{params}}",
      },
    },
  },
};

const en: typeof pl = {
  adminPaywall: {
    sync: {
      staleWrite: "Someone changed these settings elsewhere before you saved yours.",
      staleWriteHint:
        "Your draft is kept. Load the current version, compare it with your changes and save again.",
      reload: "Load current",
      keepDraft: "Keep my draft",
      merged: "Saved. Parallel changes to other fields from another tab were kept.",
      serverMissing:
        "No saved configuration - the server treats this feature as switched off until you save it.",
      reloaded:
        "The current version is loaded. Your changes were applied on top of it - review them and save again.",
    },
    page: {
      title: "Paywall and plans",
      subtitle:
        "Subscription plans and their sale, the free article quota, per-content exceptions and checkout settings. Set the access mode of a piece of content in its post or page editor.",
    },
    tabs: {
      plans: "Plans",
      metering: "Article quota",
      overrides: "Exceptions",
      checkout: "Checkout",
    },
    readOnly: {
      hint: "Preview only - the editorial team makes changes in the Paywall panel.",
    },
    kpi: {
      plans: "Plans",
      active: "Active",
      forSale: "On sale",
      currencies: "Currencies",
      metering: "Article quota",
      meteringOn: "On · {{limit}}/mo",
      meteringOff: "Off",
      meteringMissing: "Not configured",
      meteringUnknown: "Could not check",
    },
    interval: {
      two_weeks: "Every 2 weeks",
      month: "Monthly",
      quarter: "Quarterly",
      year: "Yearly",
      one_time: "One-time",
    },
    plans: {
      title: "Plan catalogue",
      description:
        "Prices, billing cycles and sale status of the subscription plans. Open a plan to change its details - saving touches only the fields of this screen.",
      add: "New plan",
      caption: "Subscription plans with price, cycle, status and sale",
      colName: "Name",
      colPrice: "Price",
      colInterval: "Cycle",
      colStatus: "Status",
      colSale: "Sale",
      colActions: "Actions",
      empty: "No plans yet - add the first one.",
      readError: "Could not load the plans. Please try again.",
      retry: "Try again",
      highlighted: "Highlighted",
      active: "Active",
      inactive: "Inactive",
      forSale: "On sale",
      withdrawn: "Withdrawn",
      eurApprox: "EN: {{amount}}",
      noCatalogPair: "No checkout catalogue pair",
      noCatalogPairHint:
        "Checkout will not find a price for this plan's tier + cycle pair, so the purchase will fail. Map a tier in Membership or change the cycle.",
      edit: "Edit",
      editLabel: "Edit plan {{name}}",
      deleteLabel: "Delete plan {{name}}",
      deleteAdminOnly:
        "Only an administrator deletes plans. Withdraw a plan you no longer want to sell in its editor instead.",
      deleteTitle: "Delete the “{{name}}” plan?",
      deleteDescription:
        "The plan has no subscriptions. Deleting cannot be undone - the plan leaves checkout, pricing and reports.",
      deleteConfirm: "Delete plan",
      deleteBlockedTitle: "The “{{name}}” plan cannot be deleted",
      deleteBlockedDescription_one:
        "The plan has {{count}} subscription. Deleting would erase it together with the customer history. Withdraw the plan from sale instead - the current subscriber renews unchanged.",
      deleteBlockedDescription_few:
        "The plan has {{count}} subscriptions. Deleting would erase them together with the customer history. Withdraw the plan from sale instead - current subscribers renew unchanged.",
      deleteBlockedDescription_many:
        "The plan has {{count}} subscriptions. Deleting would erase them together with the customer history. Withdraw the plan from sale instead - current subscribers renew unchanged.",
      deleteBlockedDescription_other:
        "The plan has {{count}} subscriptions. Deleting would erase them together with the customer history. Withdraw the plan from sale instead - current subscribers renew unchanged.",
      withdraw: "Withdraw from sale",
      alreadyWithdrawn: "The plan is already withdrawn from sale.",
      withdrawnToast: "Plan withdrawn from sale",
      deleted: "Plan deleted",
      countError: "Could not count the plan's subscriptions - deletion is on hold.",
    },
    editor: {
      titleNew: "New plan",
      titleEdit: "Plan: {{name}}",
      description:
        "Bilingual copy (PL/EN), the price in the main currency unit and sale rules. Set the plan's membership tier in Membership.",
      notFound:
        "This plan is no longer in the catalogue - it may have been deleted in another tab.",
      groupNaming: "Naming",
      groupPricing: "Price and billing",
      groupSale: "Sale and highlight",
      groupFeatures: "Feature list",
      namePl: "Name PL",
      nameEn: "Name EN",
      descPl: "Description PL",
      descEn: "Description EN",
      price: "Price",
      priceHint: "In the main currency unit, e.g. 49.00.",
      priceInvalid: "Enter an amount with at most two decimal places, e.g. 49.00.",
      currency: "Currency",
      interval: "Billing cycle",
      trialDays: "Trial days",
      sort: "Sort order",
      tierSource: "Membership → plan mapping",
      tierHint:
        "The tier decides what the plan unlocks. Change the mapping in Membership - here it is read-only.",
      active: "Active",
      activeHint:
        "Switching it off also cuts off current subscribers: their renewals stop matching this plan.",
      activeOffTitle: "Switch off a plan with subscriptions?",
      activeOffDescription_one:
        "The plan has {{count}} subscription. Switching it off cuts this customer off - the renewal stops matching the plan. To stop new sales only, switch off “On sale”.",
      activeOffDescription_few:
        "The plan has {{count}} subscriptions. Switching it off cuts these customers off - renewals stop matching the plan. To stop new sales only, switch off “On sale”.",
      activeOffDescription_many:
        "The plan has {{count}} subscriptions. Switching it off cuts these customers off - renewals stop matching the plan. To stop new sales only, switch off “On sale”.",
      activeOffDescription_other:
        "The plan has {{count}} subscriptions. Switching it off cuts these customers off - renewals stop matching the plan. To stop new sales only, switch off “On sale”.",
      activeOffConfirm: "Switch off anyway",
      activeCountError:
        "Could not count the plan's subscriptions - the plan stays active until the number is known.",
      forSale: "On sale",
      forSaleHint:
        "The plan accepts new purchases in checkout and on plan change. Switching it off withdraws it from sale - current subscribers renew unchanged (unlike »Active«)",
      forSaleHelp: "What does “On sale” mean?",
      highlighted: "Highlighted",
      badgePl: "Badge PL",
      badgeEn: "Badge EN",
      featuresPl: "Features PL (one per line)",
      featuresEn: "Features EN (one per line)",
      save: "Save plan",
      create: "Add plan",
      cancel: "Cancel",
      saved: "Plan saved",
      created: "Plan added",
    },
    metering: {
      title: "Article quota - free monthly limit",
      subtitle:
        "Funnel: guest → registration (free-account quota) → subscription. The server keeps count; change a single piece of content in its editor (Access section) or in the Exceptions tab.",
      readError: "Could not load the quota settings. Please try again.",
      retry: "Try again",
      missingTitle: "Off - not configured",
      missingDescription:
        "The server has no saved quota settings, so it counts nothing - paywalled content requires a subscription right away.",
      defaultsPreview:
        "Default values: {{member}} articles a month for signed-in readers, {{anon}} for guests.",
      enableDefaults: "Switch on with default values",
      enabled: "Quota on",
      memberLimit: "Quota for signed-in readers (articles / month)",
      anonLimit: "Quota for guests (0 = require registration)",
      meterPaid: "Count paid articles",
      meterMembers: "Count members-only articles",
      showCounter: "Show the “X of N” counter above articles",
      save: "Save settings",
      saved: "Quota settings saved",
      saveError: "Could not save the quota settings.",
      impact: {
        title: "Impact preview for the current month",
        disabled:
          "The quota is off - paywalled content requires a subscription right away, with no free limit.",
        error: "Could not compute the impact preview.",
        empty:
          "No quota unlocks yet this month - the preview shows up once readers start opening articles.",
        blocked: "Readers blocked",
        warning: "Readers near limit",
        safe: "Readers under limit",
        avg: "Average usage",
        summary:
          "{{members}} signed-in and {{anon}} guests ({{views}} views), max usage {{max}} - with a {{limit}}/mo quota.",
      },
    },
    overrides: {
      title: "Per-content exceptions",
      subtitle:
        "Rules whose quota policy is not “inherit”. This is the same rule you see in the post and page editors - saving here and there goes one versioned way.",
      search: "Search by title",
      searchPlaceholder: "Content title or address",
      empty: "No exceptions - all content inherits the global settings.",
      noMatches: "No exception matches “{{query}}”.",
      readError: "Could not load the exceptions. Please try again.",
      retry: "Try again",
      caption: "Article quota exceptions for single pieces of content",
      colEntity: "Content",
      colMode: "Access mode",
      colPolicy: "Quota policy",
      policyLabel: "Quota policy: {{title}}",
      saved: "Policy saved",
      entity: {
        post: "Post",
        page: "Page",
        media: "File",
      },
      mode: {
        public: "Public",
        members: "Signed-in readers",
        paid: "Paid",
        password: "Password",
      },
      policy: {
        inherit: "Inherit",
        metered: "Always count",
        exempt: "Exclude from quota",
      },
      pageInfo_one: "Page {{page}} of {{pages}} · {{count}} exception",
      pageInfo_few: "Page {{page}} of {{pages}} · {{count}} exceptions",
      pageInfo_many: "Page {{page}} of {{pages}} · {{count}} exceptions",
      pageInfo_other: "Page {{page}} of {{pages}} · {{count}} exceptions",
      prev: "Previous page",
      next: "Next page",
    },
    checkout: {
      title: "Checkout - promotion codes, taxes, invoices",
      subtitle:
        "Stripe payment session settings. Create promotion codes in the Stripe dashboard (Products → Coupons); set a trial in the plan.",
      readError: "Could not load the checkout settings. Please try again.",
      retry: "Try again",
      allowPromo: "Promotion code field in Stripe Checkout",
      allowPromoHint: "Buyers enter discount codes directly on the payment page.",
      automaticTax: "Stripe Tax - automatic VAT",
      automaticTaxHint:
        "Requires Stripe Tax to be activated on your Stripe account. Forces billing address collection and TAKES OVER tax handling from Stripe as merchant of record (MoR) - enable it only if you settle VAT yourself.",
      taxIdCollection: "Collect Tax ID / VAT number (appears on the invoice)",
      taxIdCollectionHint:
        "Business buyers provide their VAT ID in Checkout; Stripe places it on the invoice.",
      addressCollection: "Billing address",
      addressAuto: "Automatic (when required)",
      addressRequired: "Always required",
      invoiceCreation: "Stripe invoice for one-time payments",
      invoiceCreationHint:
        "Subscriptions always get invoices; this enables them for one-time purchases too. A “Download invoice” link appears in the customer's Orders. Under merchant-of-record (MoR) mode Stripe issues the invoice itself and the parameter is not sent.",
      save: "Save checkout settings",
      saved: "Checkout settings saved",
      saveError: "Could not save the checkout settings.",
      plane: {
        title: "Session billing plane",
        managed:
          "Stripe as merchant of record (MoR): Stripe calculates tax and issues the invoice. Coupons, tax ID and billing address still go into the session.",
        merchant:
          "You settle tax yourself (Stripe Tax on your account): the session carries automatic VAT, a required address and - for one-time payments - a Stripe invoice.",
        params: "Session parameters: {{params}}",
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy każdym
// renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
