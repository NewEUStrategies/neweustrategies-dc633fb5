// i18n karty „Retencja danych" (/admin/settings/privacy, I9c-X2) - PL/EN.
//
// PODSTAWY PRAWNE I STANDARDY: wyłącznie akty i wytyczne wskazane przez
// administratora danych w decyzji z 2026-10-20 (dziennik wdrożenia §21.21);
// tam, gdzie decyzja nie wskazuje standardu, tekst mówi to wprost.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej są dobrane tak, żeby żadne nie było nazwą klasy.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminDataRetention: {
    title: "Retencja danych",
    subtitle:
      "Jak długo przechowujemy dane osobowe, co dzieje się po upływie okresu i kiedy zadanie dzienne uruchomiło się ostatnio. Okresy w zakresie zatwierdzonym przez administratora danych.",
    loading: "Wczytywanie ustawień retencji…",
    readError: "Nie udało się wczytać ustawień retencji.",
    retry: "Spróbuj ponownie",
    unavailable:
      "Retencja danych nie jest jeszcze wdrożona w tej bazie (migracje 20261020161000-161400). Karta zadziała po wdrożeniu.",
    forbidden: "Ustawienia retencji zmienia wyłącznie administrator.",
    grace: {
      previewTitle: "Bezpieczny start: tryb podglądu do {{date}}",
      previewBody:
        "Do tej daty zadanie dzienne tylko liczy, co usunie albo zanonimizuje - niczego nie zmienia. Sprawdź podgląd poniżej, a potem włącz usuwanie albo przesuń termin.",
      enforcedTitle: "Usuwanie włączone",
      enforcedBody:
        "Zadanie dzienne usuwa i anonimizuje dane starsze niż okres każdej włączonej kategorii.",
      enableNow: "Włącz usuwanie teraz",
      enableNowTitle: "Włączyć usuwanie danych od razu?",
      enableNowBody:
        "Najbliższy przebieg usunie albo zanonimizuje rekordy z podglądu. Tej operacji nie da się cofnąć.",
      postpone: "Przesuń termin",
      postponeLabel: "Nowy termin włączenia usuwania",
      postponeHint: "Od jutra do {{max}} dni od dziś.",
      postponeSave: "Zapisz termin",
      postponeInvalid: "Wybierz dzień od jutra do {{max}} dni od dziś.",
      saved: "Termin włączenia usuwania zapisany.",
    },
    schedule: {
      lastRun: "Ostatni przebieg z harmonogramu: {{date}}",
      never: "Zadanie dzienne jeszcze się nie uruchomiło.",
      window:
        "Zadanie dzienne biegnie nocą (02:07-02:57 UTC) w harmonogramie zadań tła - jego kroki widać w panelu zdrowia harmonogramu.",
    },
    columns: {
      category: "Kategoria",
      period: "Okres",
      enabled: "Włączona",
      lastRun: "Ostatni przebieg",
      preview: "Najbliższy przebieg",
    },
    period: {
      months_one: "{{count}} miesiąc",
      months_few: "{{count}} miesiące",
      months_many: "{{count}} miesięcy",
      months_other: "{{count}} miesiąca",
      aria: "Okres przechowywania: {{name}}",
      defaultMark: "{{label}} (domyślnie)",
    },
    statutory: "Minimum ustawowe - tylko do odczytu",
    hint: "Podstawa prawna i standard: {{name}}",
    hintBody: "{{after}} Podstawa: {{basis}} Standard: {{standard}}",
    toggle: {
      label: "Kategoria włączona: {{name}}",
      disableTitle: "Wyłączyć retencję kategorii „{{name}}”?",
      disableBody:
        "Dane tej kategorii będą przechowywane bez końca. Zasada ograniczenia przechowywania (RODO art. 5 ust. 1 lit. e) wymaga okresu albo kryterium usunięcia - wyłączenie trzeba uzasadnić w rejestrze czynności przetwarzania.",
      disableConfirm: "Wyłącz mimo to",
      cancel: "Anuluj",
    },
    lastRun: {
      none: "Jeszcze nie było",
      preview_one: "Podgląd: {{count}} rekord",
      preview_few: "Podgląd: {{count}} rekordy",
      preview_many: "Podgląd: {{count}} rekordów",
      preview_other: "Podgląd: {{count}} rekordu",
      execute_one: "Zmieniono {{count}} rekord",
      execute_few: "Zmieniono {{count}} rekordy",
      execute_many: "Zmieniono {{count}} rekordów",
      execute_other: "Zmieniono {{count}} rekordu",
      backlog: "zostały zaległe - dokończy następny przebieg",
      error: "Błąd przebiegu ({{code}})",
      manual: "ręcznie",
    },
    preview: {
      count_one: "{{count}} rekord starszy niż {{date}}",
      count_few: "{{count}} rekordy starsze niż {{date}}",
      count_many: "{{count}} rekordów starszych niż {{date}}",
      count_other: "{{count}} rekordu starszego niż {{date}}",
      capped: "ponad {{cap}} rekordów starszych niż {{date}}",
      off: "Kategoria wyłączona - nic nie jest liczone.",
      modePreview: "tylko podgląd",
      modeExecute: "usunie",
      loading: "Liczenie…",
      error: "Nie udało się policzyć podglądu.",
    },
    saved: "Zapisano okres retencji.",
    saveError: "Nie udało się zapisać ustawienia retencji.",
    conflict:
      "Ktoś zmienił to ustawienie w innej karcie. Wczytano aktualną wersję - sprawdź ją i zapisz ponownie.",
    invalid: "Wartość spoza zakresu dozwolonego dla tej kategorii - nie została zapisana.",
    categories: {
      paywall_metering: {
        name: "Uderzenia w paywall i dziennik licznika artykułów",
        what: "Zdarzenia na poziomie konta albo przeglądarki: kto i kiedy trafił na paywall, wyniki licznika artykułów.",
        after: "Wiersz usunięty. Zostają anonimowe agregaty dzienne (lejek, pulpit monetyzacji).",
        basis:
          "RODO art. 5 ust. 1 lit. c i e (minimalizacja, ograniczenie przechowywania); pomiar zależny od zgody: dyrektywa 2002/58/WE art. 5 ust. 3, w Polsce Prawo komunikacji elektronicznej.",
        standard:
          "Wytyczne CNIL dla pomiaru odbiorców: 13 miesięcy dla identyfikatorów, 25 miesięcy dla danych; Google Analytics 4 - najwyżej 14 miesięcy.",
      },
      email_engagement: {
        name: "Otwarcia i kliknięcia maili (ścieżki i kampanie)",
        what: "Zdarzenia śledzenia maili ścieżek komunikacji i kampanii newslettera.",
        after: "Zdarzenia usunięte. Liczniki per krok ścieżki i per kampania zostają.",
        basis:
          "RODO art. 5 ust. 1 lit. c i e; piksel śledzący podlega art. 5 ust. 3 dyrektywy 2002/58/WE (wytyczne EDPB 2/2023 w sprawie zakresu technicznego art. 5 ust. 3).",
        standard: "Jak pomiar odbiorców: wytyczne CNIL, 13 i 25 miesięcy.",
      },
      email_send_log: {
        name: "Dziennik wysyłek maili",
        what: "Adres odbiorcy, szablon, status i identyfikatory wiadomości (dziennik, zdarzenia doręczeń, odbiorcy kampanii).",
        after: "Adres i identyfikatory odbiorcy usunięte; szablon, data i status zostają.",
        basis:
          "RODO art. 6 ust. 1 lit. f i art. 5 ust. 2 (rozliczalność wysyłek na podstawie zgody).",
        standard: "Dostawcy poczty przechowują logi od 30 dni do 13 miesięcy.",
      },
      crm_inactive_contacts: {
        name: "Kontakty CRM bez konta i bez transakcji",
        what: "Kontakt bez aktywności przez wybrany okres: formularz, rejestracja na wydarzenie, otwarcie lub kliknięcie maila, notatka zespołu, zmiana etapu.",
        after:
          "Anonimizacja: dane osobowe usunięte, etap, źródło i daty zostają. 30 dni wcześniej kontakt trafia na listę „do anonimizacji” - można go przedłużyć o 12 miesięcy z podaniem powodu.",
        basis: "RODO art. 6 ust. 1 lit. f (marketing B2B) albo lit. a (zgoda), art. 21 ust. 2-3.",
        standard: "Polityka wygaszania („sunset policy”): 12-24 miesiące bez zaangażowania.",
      },
      audit_log: {
        name: "Dziennik audytu panelu",
        what: "Kto, co i kiedy zmienił w panelu, z adresem IP i przeglądarką.",
        after:
          "Wpis usunięty; IP i przeglądarka usuwane po 12 miesiącach. Wpisy operacji finansowych (zwroty, ręczne płatności, ceny, nadania członkostwa, rabaty, faktury) - tak długo jak dowody księgowe.",
        basis: "RODO art. 32 i art. 5 ust. 2 (bezpieczeństwo i rozliczalność).",
        standard: "PCI DSS: 12 miesięcy; ISO/IEC 27001: zdefiniowany okres przechowywania logów.",
      },
      journey_enrollments: {
        name: "Zapisy na ścieżki i przebiegi kroków (po wyjściu)",
        what: "Historia przejścia kontaktu przez ścieżkę komunikacji po jej zakończeniu.",
        after:
          "Zapis usunięty razem z krokami, wiadomościami i zdarzeniami. Statystyki per krok zostają.",
        basis: "RODO art. 5 ust. 1 lit. e (ograniczenie przechowywania).",
        standard: "Jak zdarzenia maili: 13 miesięcy.",
      },
      cancellation_surveys: {
        name: "Ankiety rezygnacji (powiązanie z kontem)",
        what: "Powód rezygnacji z planu, komentarz i oferta utrzymania przypisane do konta.",
        after:
          "Anonimizacja: konto, subskrypcja, komentarz i kod kuponu usunięte; powód, wynik i data zostają.",
        basis: "RODO art. 6 ust. 1 lit. f (poprawa oferty).",
        standard: "Brak rynkowego standardu - okres przyjęty przez administratora danych.",
      },
      crm_customers: {
        name: "Kontakty CRM klientów (z transakcją)",
        what: "Kontakt z zamówieniem albo płatnym zgłoszeniem na wydarzenie.",
        rule: "Do późniejszej z dat: koniec przechowywania dowodów księgowych ostatniej transakcji albo przedawnienie roszczeń (6 lat, z końcem roku); nie wcześniej niż okres nieaktywności kontaktów.",
        after: "Anonimizacja jak kontaktu bez transakcji.",
        basis:
          "Ustawa o rachunkowości (art. 74), Kodeks cywilny (art. 118); spójnie z istniejącą retencją dowodów księgowych (31.12 szóstego roku po roku transakcji).",
        standard: "Minimum ustawowe - nie do skrócenia.",
      },
      consent_log: {
        name: "Dziennik zgód",
        what: "Treść, wersja i chwila udzielenia albo wycofania zgody.",
        rule: "Przez czas trwania zgody i 6 lat od jej wycofania albo wygaśnięcia (anonimizacja kontaktu kończy zgodę).",
        after: "Łańcuch zgód kontaktu usunięty.",
        basis: "RODO art. 7 ust. 1 (wykazanie zgody), Kodeks cywilny art. 118.",
        standard: "Minimum ustawowe - nie do skrócenia.",
      },
    },
    existing: {
      title: "Okresy ustalone gdzie indziej",
      subtitle:
        "Mechanizmy, które już działają w innych modułach, i dane przechowywane bezterminowo z mocy prawa - tylko do odczytu, żeby okres nie był ustawiany w dwóch miejscach.",
      schedule: {
        pg_cron: "Zadanie bazy (pg_cron)",
        pending: "Harmonogram w przygotowaniu",
        none: "Bez usuwania",
      },
      items: {
        suppression_list: {
          name: "Lista wyłączeń wysyłki",
          period:
            "Bezterminowo - wyłącznie adres i data (RODO art. 21 ust. 3: respektowanie sprzeciwu).",
        },
        domain_events: { name: "Zdarzenia domenowe (szyna)", period: "90 dni." },
        analytics_events: { name: "Zdarzenia analityki pierwszej strony", period: "12 miesięcy." },
        web_vitals: { name: "Pomiary wydajności (Web Vitals)", period: "200 dni." },
        client_errors: { name: "Błędy przeglądarki", period: "90 dni." },
        journey_inbox: {
          name: "Skrzynka zdarzeń ścieżek i błędy silnika",
          period: "30 dni po przetworzeniu; błędy silnika 90 dni.",
        },
        integration_deliveries: {
          name: "Dostawy integracji",
          period: "14 dni po doręczeniu, 30 dni nieudane.",
        },
        email_dlq: { name: "Martwe wiadomości poczty (DLQ)", period: "30 dni, bez treści." },
        sms_send_log: { name: "Dziennik SMS", period: "30 dni od ostatniej zmiany." },
        payment_webhook_events: {
          name: "Dziennik zdarzeń operatora płatności",
          period: "Pseudonimizacja po 30 dniach (zdarzenia domknięte) albo 90 dniach.",
        },
        accounting_evidence: {
          name: "Dowody księgowe (zamówienia, zakupy)",
          period:
            "Do 31.12 szóstego roku po roku transakcji (przedawnienie zobowiązania podatkowego).",
        },
      },
    },
    aggregates: {
      funnel:
        "Lejek i pulpit monetyzacji: dni przed {{date}} liczone z anonimowego agregatu dziennego.",
      journeys: "Statystyki ścieżek policzone na stałe do {{date}} włącznie.",
      none: "Agregaty jeszcze nie są potrzebne - wszystkie dane mieszczą się w okresach.",
    },
    crm: {
      title: "Kontakty do anonimizacji w ciągu {{days}} dni",
      subtitle:
        "Kontakty CRM, które najbliższe przebiegi zanonimizują. Przedłużenie przesuwa termin o {{months}} miesięcy i trafia do dziennika audytu z powodem.",
      empty: "Żaden kontakt nie zostanie zanonimizowany w ciągu {{days}} dni.",
      contact: "Kontakt",
      lastActivity: "Ostatnia aktywność",
      dueAt: "Termin",
      kind: "Rodzaj",
      customer: "Klient",
      lead: "Kontakt",
      actions: "Działania",
      extend: "Przedłuż",
      extendAria: "Przedłuż przechowywanie: {{name}}",
      extendTitle: "Przedłużyć przechowywanie kontaktu o {{months}} miesięcy?",
      extendBody: "Podaj powód - trafi do dziennika audytu razem z nowym terminem.",
      reasonLabel: "Powód przedłużenia",
      reasonHint: "Od {{min}} do {{max}} znaków.",
      reasonCount: "{{count}} z {{max}} znaków",
      reasonInvalid:
        "Powód musi mieć od {{min}} do {{max}} znaków - dłuższy nie zostanie skrócony.",
      extendSave: "Przedłuż o {{months}} miesięcy",
      extended: "Przedłużono do {{date}}.",
      extendError: "Nie udało się przedłużyć przechowywania kontaktu.",
      notFound: "Kontakt już nie istnieje albo został zanonimizowany.",
      loading: "Wczytywanie listy…",
      error: "Nie udało się wczytać listy kontaktów.",
    },
    pixel: {
      title: "Pomiar otwarć maili (piksel)",
      label: "Mierz otwarcia maili ścieżek pikselem",
      hint: "Wyłączony: nowe maile ścieżek nie mają piksela, a otwarcia nie są zapisywane. Kliknięcia i wypis działają dalej.",
      recommendation:
        "Treść zgody na newsletter w formularzach nie wspomina pomiaru otwarć i kliknięć - informuje o nim polityka komunikacji. Rekomendacja: uzupełnić treść zgody (wytyczne EDPB 2/2023 w sprawie zakresu technicznego art. 5 ust. 3 dyrektywy 2002/58/WE).",
      saved: "Zapisano ustawienie pomiaru otwarć.",
      error: "Nie udało się zapisać ustawienia pomiaru otwarć.",
    },
    run: {
      button: "Uruchom teraz",
      title: "Uruchomić przebieg retencji teraz?",
      bodyPreview:
        "Trwa tryb podglądu: przebieg tylko policzy rekordy każdej kategorii i zapisze wynik w ostatnim przebiegu.",
      bodyExecute:
        "Przebieg usunie albo zanonimizuje rekordy starsze niż okres każdej włączonej kategorii. Tej operacji nie da się cofnąć.",
      confirm: "Uruchom przebieg",
      done: "Przebieg zakończony - wyniki w kolumnie „Ostatni przebieg”.",
      busy: "Przebieg już trwa (inna karta albo zadanie dzienne) - spróbuj za chwilę.",
      error: "Nie udało się uruchomić przebiegu.",
    },
  },
};

const en = {
  adminDataRetention: {
    title: "Data retention",
    subtitle:
      "How long we keep personal data, what happens when the period ends and when the daily job last ran. Periods within the range approved by the data controller.",
    loading: "Loading retention settings…",
    readError: "Could not load the retention settings.",
    retry: "Try again",
    unavailable:
      "Data retention is not deployed in this database yet (migrations 20261020161000-161400). The card will work after deployment.",
    forbidden: "Only an administrator changes retention settings.",
    grace: {
      previewTitle: "Safe start: preview mode until {{date}}",
      previewBody:
        "Until this date the daily job only counts what it would delete or anonymise - it changes nothing. Check the preview below, then turn deletion on or move the date.",
      enforcedTitle: "Deletion on",
      enforcedBody:
        "The daily job deletes and anonymises data older than the period of each enabled category.",
      enableNow: "Turn deletion on now",
      enableNowTitle: "Turn data deletion on right away?",
      enableNowBody:
        "The next run will delete or anonymise the records from the preview. This cannot be undone.",
      postpone: "Move the date",
      postponeLabel: "New date for turning deletion on",
      postponeHint: "From tomorrow up to {{max}} days from today.",
      postponeSave: "Save the date",
      postponeInvalid: "Pick a day from tomorrow up to {{max}} days from today.",
      saved: "Deletion start date saved.",
    },
    schedule: {
      lastRun: "Last scheduled run: {{date}}",
      never: "The daily job has not run yet.",
      window:
        "The daily job runs at night (02:07-02:57 UTC) in the background job scheduler - its steps are on the scheduler health panel.",
    },
    columns: {
      category: "Category",
      period: "Period",
      enabled: "Enabled",
      lastRun: "Last run",
      preview: "Next run",
    },
    period: {
      months_one: "{{count}} month",
      months_other: "{{count}} months",
      aria: "Retention period: {{name}}",
      defaultMark: "{{label}} (default)",
    },
    statutory: "Statutory minimum - read-only",
    hint: "Legal basis and standard: {{name}}",
    hintBody: "{{after}} Basis: {{basis}} Standard: {{standard}}",
    toggle: {
      label: "Category enabled: {{name}}",
      disableTitle: "Turn off retention for “{{name}}”?",
      disableBody:
        "Data in this category will be kept indefinitely. The storage limitation principle (GDPR Art. 5(1)(e)) requires a period or a deletion criterion - turning it off must be justified in the record of processing activities.",
      disableConfirm: "Turn off anyway",
      cancel: "Cancel",
    },
    lastRun: {
      none: "Not yet",
      preview_one: "Preview: {{count}} record",
      preview_other: "Preview: {{count}} records",
      execute_one: "Changed {{count}} record",
      execute_other: "Changed {{count}} records",
      backlog: "a backlog remains - the next run will finish it",
      error: "Run error ({{code}})",
      manual: "manual",
    },
    preview: {
      count_one: "{{count}} record older than {{date}}",
      count_other: "{{count}} records older than {{date}}",
      capped: "more than {{cap}} records older than {{date}}",
      off: "Category turned off - nothing is counted.",
      modePreview: "preview only",
      modeExecute: "will delete",
      loading: "Counting…",
      error: "Could not count the preview.",
    },
    saved: "Retention period saved.",
    saveError: "Could not save the retention setting.",
    conflict:
      "Someone changed this setting in another tab. The current version is loaded - check it and save again.",
    invalid: "A value outside the range allowed for this category - it was not saved.",
    categories: {
      paywall_metering: {
        name: "Paywall hits and article meter log",
        what: "Account- or browser-level events: who hit the paywall and when, article meter outcomes.",
        after: "Row deleted. Anonymous daily aggregates stay (funnel, monetisation dashboard).",
        basis:
          "GDPR Art. 5(1)(c) and (e) (data minimisation, storage limitation); consent-dependent measurement: Directive 2002/58/EC Art. 5(3), in Poland the Electronic Communications Law.",
        standard:
          "CNIL guidance on audience measurement: 13 months for identifiers, 25 months for data; Google Analytics 4 - at most 14 months.",
      },
      email_engagement: {
        name: "Email opens and clicks (journeys and campaigns)",
        what: "Tracking events of communication journey and newsletter campaign emails.",
        after: "Events deleted. Per-step and per-campaign counters stay.",
        basis:
          "GDPR Art. 5(1)(c) and (e); a tracking pixel falls under Art. 5(3) of Directive 2002/58/EC (EDPB Guidelines 2/2023 on the technical scope of Art. 5(3)).",
        standard: "As for audience measurement: CNIL guidance, 13 and 25 months.",
      },
      email_send_log: {
        name: "Email send log",
        what: "Recipient address, template, status and message identifiers (log, delivery events, campaign recipients).",
        after: "Recipient address and identifiers removed; template, date and status stay.",
        basis: "GDPR Art. 6(1)(f) and Art. 5(2) (accountability for consent-based sending).",
        standard: "Email service providers keep logs from 30 days to 13 months.",
      },
      crm_inactive_contacts: {
        name: "CRM contacts without an account or transaction",
        what: "A contact with no activity for the chosen period: form, event registration, email open or click, team note, stage change.",
        after:
          "Anonymisation: personal data removed, stage, source and dates stay. 30 days earlier the contact appears on the “to anonymise” list - it can be extended by 12 months with a reason.",
        basis: "GDPR Art. 6(1)(f) (B2B marketing) or (a) (consent), Art. 21(2)-(3).",
        standard: "Sunset policy: 12-24 months without engagement.",
      },
      audit_log: {
        name: "Admin audit log",
        what: "Who changed what and when in the admin, with IP address and browser.",
        after:
          "Entry deleted; IP and browser removed after 12 months. Financial operation entries (refunds, manual payments, prices, membership grants, discounts, invoices) - as long as accounting records.",
        basis: "GDPR Art. 32 and Art. 5(2) (security and accountability).",
        standard: "PCI DSS: 12 months; ISO/IEC 27001: a defined log retention period.",
      },
      journey_enrollments: {
        name: "Journey enrollments and step runs (after exit)",
        what: "A contact's path through a communication journey after it ends.",
        after: "Enrollment deleted with its steps, messages and events. Per-step statistics stay.",
        basis: "GDPR Art. 5(1)(e) (storage limitation).",
        standard: "As for email events: 13 months.",
      },
      cancellation_surveys: {
        name: "Cancellation surveys (account link)",
        what: "Reason for cancelling a plan, comment and retention offer linked to the account.",
        after:
          "Anonymisation: account, subscription, comment and coupon code removed; reason, outcome and date stay.",
        basis: "GDPR Art. 6(1)(f) (improving the offer).",
        standard: "No market standard - period set by the data controller.",
      },
      crm_customers: {
        name: "CRM contacts of customers (with a transaction)",
        what: "A contact with an order or a paid event registration.",
        rule: "Until the later of: the end of keeping accounting records of the last transaction or the claims limitation period (6 years, end of the year); never earlier than the contact inactivity period.",
        after: "Anonymisation, as for a contact without a transaction.",
        basis:
          "Accounting Act (Art. 74), Civil Code (Art. 118); consistent with the existing retention of accounting records (31 December of the sixth year after the transaction year).",
        standard: "Statutory minimum - cannot be shortened.",
      },
      consent_log: {
        name: "Consent log",
        what: "Text, version and moment of giving or withdrawing consent.",
        rule: "For as long as the consent lasts and 6 years after it is withdrawn or expires (anonymising the contact ends the consent).",
        after: "The contact's consent chain is deleted.",
        basis: "GDPR Art. 7(1) (demonstrating consent), Civil Code Art. 118.",
        standard: "Statutory minimum - cannot be shortened.",
      },
    },
    existing: {
      title: "Periods set elsewhere",
      subtitle:
        "Mechanisms already running in other modules and data kept indefinitely by law - read-only, so a period is never set in two places.",
      schedule: {
        pg_cron: "Database job (pg_cron)",
        pending: "Schedule being prepared",
        none: "No deletion",
      },
      items: {
        suppression_list: {
          name: "Sending suppression list",
          period: "Indefinitely - address and date only (GDPR Art. 21(3): honouring objection).",
        },
        domain_events: { name: "Domain events (bus)", period: "90 days." },
        analytics_events: { name: "First-party analytics events", period: "12 months." },
        web_vitals: { name: "Performance measurements (Web Vitals)", period: "200 days." },
        client_errors: { name: "Browser errors", period: "90 days." },
        journey_inbox: {
          name: "Journey event inbox and engine errors",
          period: "30 days after processing; engine errors 90 days.",
        },
        integration_deliveries: {
          name: "Integration deliveries",
          period: "14 days after delivery, 30 days when failed.",
        },
        email_dlq: { name: "Email dead letters (DLQ)", period: "30 days, without content." },
        sms_send_log: { name: "SMS log", period: "30 days since the last change." },
        payment_webhook_events: {
          name: "Payment provider event log",
          period: "Pseudonymised after 30 days (closed events) or 90 days.",
        },
        accounting_evidence: {
          name: "Accounting records (orders, purchases)",
          period:
            "Until 31 December of the sixth year after the transaction year (tax limitation).",
        },
      },
    },
    aggregates: {
      funnel:
        "Funnel and monetisation dashboard: days before {{date}} counted from the anonymous daily aggregate.",
      journeys: "Journey statistics computed for good up to {{date}} inclusive.",
      none: "Aggregates are not needed yet - all data is within its periods.",
    },
    crm: {
      title: "Contacts to anonymise within {{days}} days",
      subtitle:
        "CRM contacts the next runs will anonymise. An extension moves the date by {{months}} months and goes to the audit log with the reason.",
      empty: "No contact will be anonymised within {{days}} days.",
      contact: "Contact",
      lastActivity: "Last activity",
      dueAt: "Due",
      kind: "Kind",
      customer: "Customer",
      lead: "Contact",
      actions: "Actions",
      extend: "Extend",
      extendAria: "Extend retention: {{name}}",
      extendTitle: "Extend keeping this contact by {{months}} months?",
      extendBody: "Give a reason - it goes to the audit log together with the new date.",
      reasonLabel: "Reason for the extension",
      reasonHint: "From {{min}} to {{max}} characters.",
      reasonCount: "{{count}} of {{max}} characters",
      reasonInvalid:
        "The reason must have {{min}} to {{max}} characters - a longer one is not shortened.",
      extendSave: "Extend by {{months}} months",
      extended: "Extended until {{date}}.",
      extendError: "Could not extend keeping the contact.",
      notFound: "The contact no longer exists or has been anonymised.",
      loading: "Loading the list…",
      error: "Could not load the contact list.",
    },
    pixel: {
      title: "Email open measurement (pixel)",
      label: "Measure journey email opens with a pixel",
      hint: "Off: new journey emails carry no pixel and opens are not recorded. Clicks and unsubscribe keep working.",
      recommendation:
        "The newsletter consent text in sign-up forms does not mention measuring opens and clicks - the communication policy does. Recommendation: extend the consent text (EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) of Directive 2002/58/EC).",
      saved: "Open measurement setting saved.",
      error: "Could not save the open measurement setting.",
    },
    run: {
      button: "Run now",
      title: "Run data retention now?",
      bodyPreview:
        "Preview mode is on: the run only counts records in each category and saves the result as the last run.",
      bodyExecute:
        "The run will delete or anonymise records older than the period of each enabled category. This cannot be undone.",
      confirm: "Start the run",
      done: "Run finished - results in the “Last run” column.",
      busy: "A run is already in progress (another tab or the daily job) - try again shortly.",
      error: "Could not start the run.",
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu ładują nakładki globem i liczą na efekt importu.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
