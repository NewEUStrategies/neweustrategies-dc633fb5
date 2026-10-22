// i18n karty „Retencja danych" (/admin/settings/privacy, I9c-X2) - PL/EN.
//
// PODSTAWY PRAWNE I STANDARDY: wyłącznie akty i wytyczne wskazane przez
// administratora danych w decyzji z 2026-10-20 (dziennik wdrożenia §21.21);
// tam, gdzie decyzja nie wskazuje standardu, tekst mówi to wprost. Cztery
// kategorie I9d-Y1 (odczyty licznika, nieaktywni subskrybenci, uczestnicy
// wydarzeń, zgłoszenia do klubów) - decyzje właściciela z tego samego dnia
// (dziennik §21.22); tu także lista „do wygaszenia" i edytor treści prośby
// o potwierdzenie (ustawienia newslettera) - jeden słownik całego mechanizmu
// wygaszania, ładowany wyłącznie w leniwych chunkach karty i edytora.
//
// PARYTET W TYPIE: `const en: typeof pl` - brak klucza EN to błąd kompilacji,
// a nie dopiero czerwona bramka. Formy `_few`/`_many` istnieją w EN tylko
// dlatego, że wymaga ich typ (angielski używa `_one`/`_other`).
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
    categoryGrace: "Karencja: do {{date}} przebieg tylko liczy - niczego nie usuwa ani nie wysyła.",
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
      metered_views: {
        name: "Odczyty licznika artykułów",
        what: "Który artykuł i kiedy otworzyło konto albo przeglądarka gościa - podstawa limitu bezpłatnych artykułów w bieżącym okresie.",
        after:
          "Wiersz usunięty, nigdy z bieżącego okresu licznika. Wcześniej zapisywany jest anonimowy agregat dzienny (odczyty członków i gości, liczba czytających kont); w dzienniku licznika i uderzeniach w paywall starszych niż okres znika wskazanie artykułu. Lejek i pulpit monetyzacji liczą starsze dni z agregatu (konto raz na dzień).",
        basis:
          "RODO art. 5 ust. 1 lit. c i e (minimalizacja, ograniczenie przechowywania); historia czytania w serwisie think-tanku może ujawniać poglądy polityczne (art. 9), a licznik potrzebuje wyłącznie bieżącego okresu.",
        standard:
          "Brak rynkowego standardu dla historii czytania - okres przyjęty przez administratora danych; minimum 2 miesiące chroni bieżący okres licznika.",
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
      newsletter_inactive: {
        name: "Nieaktywni subskrybenci newslettera",
        what: "Subskrybent, który przez wybrany okres nie kliknął, nie otworzył maila (otwarcie przez człowieka), nie zalogował się powiązanym kontem, nie wysłał formularza ani nie potwierdził zapisu - choć dostawał kampanie.",
        after:
          "Jedna prośba o potwierdzenie (po polsku albo angielsku, wg języka subskrybenta); „Chcę dalej otrzymywać” zeruje licznik. Bez reakcji przez {{responseDays}} dni wiersz subskrybenta jest usuwany. Dziennik zgód zostaje (czas trwania zgody + 6 lat), a adres NIE trafia na listę wyłączeń - można zapisać się ponownie.",
        basis:
          "RODO art. 7 ust. 1 i art. 5 ust. 1 lit. e: subskrypcja to zgoda (art. 6 ust. 1 lit. a), a brak reakcji od miesięcy przestaje dowodzić woli odbioru; dowód zgody zostaje w dzienniku zgód.",
        standard:
          "Polityka wygaszania („sunset policy”) nadawców poczty masowej: zwykle 6-12 miesięcy bez zaangażowania i prośba o potwierdzenie przed usunięciem.",
      },
      crm_inactive_contacts: {
        name: "Kontakty CRM bez konta i bez transakcji",
        what: "Kontakt bez aktywności przez wybrany okres: formularz, rejestracja na wydarzenie, otwarcie lub kliknięcie maila, notatka zespołu, zmiana etapu.",
        after:
          "Anonimizacja: dane osobowe usunięte, etap, źródło i daty zostają. 30 dni wcześniej kontakt trafia na listę „do anonimizacji” - można go przedłużyć o 12 miesięcy z podaniem powodu.",
        basis: "RODO art. 6 ust. 1 lit. f (marketing B2B) albo lit. a (zgoda), art. 21 ust. 2-3.",
        standard: "Polityka wygaszania („sunset policy”): 12-24 miesiące bez zaangażowania.",
      },
      event_attendees: {
        name: "Uczestnicy wydarzeń bez konta",
        what: "Kartoteka uczestnika i dane w jego zgłoszeniach: dane kontaktowe, zdjęcie, opis, odpowiedzi formularza, powody decyzji i anulowania. Okres liczony od ostatniego udziału albo rejestracji.",
        after:
          "Anonimizacja: imię i nazwisko zastąpione znacznikiem, dane kontaktowe i opisowe usunięte; obecność, typ biletu, status, daty, źródło, firma i zgody (także dla partnerów i wystawców) zostają. Poza kategorią: osoba z istniejącym kontem (historia w profilu do usunięcia konta) i prelegenci; płatne zamówienie - nie wcześniej niż koniec przechowywania dowodów księgowych.",
        basis:
          "RODO art. 6 ust. 1 lit. b (udział w wydarzeniu) i lit. f (rozliczalność, statystyki wydarzeń), art. 5 ust. 1 lit. e; płatności - ustawa o rachunkowości (art. 74).",
        standard:
          "Brak rynkowego standardu - okres przyjęty przez administratora danych, liczony od ostatniego udziału albo rejestracji.",
      },
      club_applications: {
        name: "Zgłoszenia do klubów",
        what: "Formularz zgłoszenia: dane kontaktowe, firma i stanowisko, profil, teksty własne (doświadczenie, języki, motywacja, cele, wkład, dostępność, źródło polecenia) i notatka komisji.",
        after:
          "Anonimizacja: dane osobowe i teksty własne usunięte, konto zastąpione pseudonimem; klub, specjalizacja, status, daty decyzji, warstwa i pola zgrubne (branża, staż, kraj) zostają. Odrzucone - liczone od decyzji, przyjęte - od końca członkostwa, oczekujące - nigdy automatycznie. Po usunięciu konta - anonimizacja od razu.",
        basis:
          "RODO art. 6 ust. 1 lit. b (rozpatrzenie zgłoszenia, członkostwo) i lit. f (obrona roszczeń, ciągłość pracy komisji), art. 5 ust. 1 lit. e.",
        standard: "Brak rynkowego standardu - okres przyjęty przez administratora danych.",
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
      extendSave: "Przedłuż o {{months}} miesięcy",
      extended: "Przedłużono do {{date}}.",
      extendError: "Nie udało się przedłużyć przechowywania kontaktu.",
      notFound: "Kontakt już nie istnieje albo został zanonimizowany.",
      loading: "Wczytywanie listy…",
      error: "Nie udało się wczytać listy kontaktów.",
    },
    // Wspólne pole powodu (przedłużenie kontaktu CRM, wykluczenie adresu
    // z wygaszania i jego cofnięcie) - jeden limit, jeden komunikat.
    reason: {
      hint: "Od {{min}} do {{max}} znaków.",
      count: "{{count}} z {{max}} znaków",
      invalid: "Powód musi mieć od {{min}} do {{max}} znaków - dłuższy nie zostanie skrócony.",
    },
    newsletter: {
      title: "Nieaktywni subskrybenci - do wygaszenia",
      subtitle:
        "Subskrybent bez zaangażowania dłużej niż {{months}} mies. dostaje jedną prośbę o potwierdzenie; bez reakcji w ciągu {{days}} dni jego adres zostanie usunięty z listy newslettera. Najwyżej {{cap}} próśb na dobę - fala maili do dawno nieaktywnych adresów obniża reputację domeny nadawcy.",
      engagementHint: "Co liczy się jako zaangażowanie: {{name}}",
      engagementBody:
        "Kliknięcie w mailu, otwarcie przez człowieka, logowanie powiązanego konta, formularz z tym adresem, potwierdzenie zapisu i „Chcę dalej otrzymywać”. Otwarcie przez proxy obrazów Gmaila liczy się jak ludzkie - Gmail pobiera obrazy dopiero przy otwarciu. Otwarcie przez Apple Mail Privacy Protection się nie liczy: Apple pobiera piksel przy doręczeniu, więc otwarcie tuż po wysyłce (próg otwarcia maszynowego z ustawień silnika ścieżek) jest pomijane. Kandydatem jest tylko adres, do którego w tym okresie wysłano co najmniej jedną kampanię.",
      noOpens: "Zaangażowanie liczone bez otwarć",
      noOpensHint: "Dlaczego bez otwarć: {{name}}",
      noOpensBody:
        "Pomiar otwarć (piksel) jest wyłączony, więc otwarcia nie są zapisywane i nie odsuwają prośby. Liczą się kliknięcia, logowanie powiązanego konta, formularze i potwierdzenie zapisu.",
      off: "Kategoria wyłączona - nikt nie dostanie prośby ani nie zostanie usunięty.",
      grace:
        "Karencja: do {{date}} przebieg tylko liczy - prośby nie wychodzą, nikt nie jest usuwany.",
      countsLabel: "Stan wygaszania",
      counts: {
        candidates: "Prośba w najbliższym przebiegu",
        requested: "Czeka na wysyłkę prośby",
        mailed: "Prośba wysłana - biegnie czas na reakcję",
        due: "Do usunięcia w najbliższym przebiegu",
        excluded: "Wykluczone adresy",
      },
      subscriber: "Subskrybent",
      lastEngaged: "Ostatnie zaangażowanie",
      status: "Stan",
      deletion: "Usunięcie",
      actions: "Działania",
      never: "brak",
      state: {
        candidate: "Prośba w najbliższym przebiegu",
        requested: "Prośba zlecona {{date}} - czeka na okno wysyłki",
        mailed: "Prośba wysłana {{date}}",
        suppressed: "Adres na liście wyłączeń - prośba nie wyszła ({{date}})",
      },
      deleteOn: "po {{date}}",
      deleteLater: "{{days}} dni po wysłaniu prośby",
      shown: "Lista pokazuje {{shown}} z {{total}} pozycji - najbliższe terminy na górze.",
      empty: "Żaden subskrybent nie czeka na prośbę ani na usunięcie.",
      loading: "Wczytywanie listy…",
      error: "Nie udało się wczytać listy subskrybentów.",
      copyLink: "Treść prośby i podgląd maila",
      exclude: "Wyklucz",
      excludeAria: "Wyklucz z wygaszania: {{email}}",
      excludeTitle: "Wykluczyć adres z wygaszania?",
      excludeBody:
        "{{email}} nie dostanie prośby o potwierdzenie i nie zostanie usunięty z listy; prośba w toku zostanie anulowana. Podaj powód - trafi do dziennika audytu.",
      excludeReason: "Powód wykluczenia",
      excludeSave: "Wyklucz adres",
      excluded: "Adres wykluczony z wygaszania.",
      excludedCancelled: "Adres wykluczony - prośba w toku została anulowana.",
      excludedTitle: "Wykluczone adresy",
      excludedEmpty: "Żaden adres nie jest wykluczony.",
      address: "Adres",
      reasonColumn: "Powód",
      since: "Od",
      include: "Cofnij wykluczenie",
      includeAria: "Cofnij wykluczenie: {{email}}",
      includeTitle: "Cofnąć wykluczenie adresu?",
      includeBody:
        "{{email}} wróci do reguły wygaszania: przy braku zaangażowania dostanie prośbę o potwierdzenie. Podaj powód - trafi do dziennika audytu.",
      includeReason: "Powód cofnięcia",
      included: "Wykluczenie cofnięte.",
      saveError: "Nie udało się zapisać zmiany wykluczenia.",
      notFound: "Subskrybent już nie istnieje albo nie jest wykluczony.",
    },
    sunsetCopy: {
      title: "Prośba o potwierdzenie subskrypcji (wygaszanie)",
      subtitle:
        "Jedyny mail do subskrybenta nieaktywnego dłużej niż okres z karty „Retencja danych” (Ustawienia → Prywatność). Puste pole = treść domyślna; przycisk „Chcę dalej otrzymywać” i link wypisu dokłada system.",
      langLabel: "Język treści",
      fields: {
        subject: "Temat",
        preview: "Tekst podglądu w skrzynce",
        eyebrow: "Nadtytuł",
        heading: "Nagłówek",
        intro: "Wstęp",
        cta: "Przycisk",
        note: "Ramka „co dalej”",
      },
      counter: "{{count}} z {{max}} znaków",
      tooLong: "Za długie: {{count}} z {{max}} znaków - skróć, treść nie zostanie przycięta.",
      tokens: "Zmienne: {{tokens}} - imię, liczba dni na reakcję, data usunięcia.",
      reset: "Przywróć domyślne",
      save: "Zapisz treść",
      saved: "Zapisano treść prośby.",
      saveError: "Nie udało się zapisać treści prośby.",
      conflict:
        "Ktoś zapisał treść prośby w innej karcie. Twoje zmiany zostały w edytorze - sprawdź je i zapisz ponownie, aby nadpisać tamtą wersję.",
      invalid: "Pole przekracza limit znaków - treść nie została zapisana.",
      unsaved: "Niezapisane zmiany",
      previewTitle: "Podgląd maila",
      previewRefresh: "Odśwież podgląd",
      previewLoading: "Przygotowanie podglądu…",
      previewError: "Nie udało się przygotować podglądu.",
      previewFrame: "Podgląd maila z prośbą o potwierdzenie",
      previewSubject: "Temat: {{subject}}",
      previewNote: "Podgląd z przykładowym imieniem; przyciski w podglądzie są nieaktywne.",
      loading: "Wczytywanie treści prośby…",
      readError: "Nie udało się wczytać treści prośby.",
      forbidden: "Treść prośby zmienia wyłącznie administrator.",
      unavailable:
        "Wygaszanie newslettera nie jest jeszcze wdrożone w tej bazie - edycja treści zadziała po wdrożeniu.",
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

const en: typeof pl = {
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
      months_few: "{{count}} months",
      months_many: "{{count}} months",
      months_other: "{{count}} months",
      aria: "Retention period: {{name}}",
      defaultMark: "{{label}} (default)",
    },
    statutory: "Statutory minimum - read-only",
    categoryGrace:
      "Grace period: until {{date}} the run only counts - it deletes and sends nothing.",
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
      preview_few: "Preview: {{count}} records",
      preview_many: "Preview: {{count}} records",
      preview_other: "Preview: {{count}} records",
      execute_one: "Changed {{count}} record",
      execute_few: "Changed {{count}} records",
      execute_many: "Changed {{count}} records",
      execute_other: "Changed {{count}} records",
      backlog: "a backlog remains - the next run will finish it",
      error: "Run error ({{code}})",
      manual: "manual",
    },
    preview: {
      count_one: "{{count}} record older than {{date}}",
      count_few: "{{count}} records older than {{date}}",
      count_many: "{{count}} records older than {{date}}",
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
      metered_views: {
        name: "Article meter reads",
        what: "Which article an account or a guest browser opened and when - the basis of the free article limit in the current period.",
        after:
          "Row deleted, never from the current meter period. First an anonymous daily aggregate is saved (member and guest reads, the number of reading accounts); in the meter log and paywall hits older than the period the article reference is removed. The funnel and the monetisation dashboard count older days from the aggregate (an account once per day).",
        basis:
          "GDPR Art. 5(1)(c) and (e) (data minimisation, storage limitation); the reading history on a think tank site may reveal political opinions (Art. 9), and the meter needs only the current period.",
        standard:
          "No market standard for reading history - a period set by the data controller; the 2-month minimum protects the current meter period.",
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
      newsletter_inactive: {
        name: "Inactive newsletter subscribers",
        what: "A subscriber who for the chosen period has not clicked, opened an email (a human open), signed in with a linked account, sent a form or confirmed the sign-up - although campaigns kept arriving.",
        after:
          "One confirmation request (in Polish or English, by the subscriber's language); “Keep me subscribed” resets the clock. With no response for {{responseDays}} days the subscriber row is deleted. The consent log stays (consent duration + 6 years) and the address is NOT added to the suppression list - the person can subscribe again.",
        basis:
          "GDPR Art. 7(1) and Art. 5(1)(e): a subscription is consent (Art. 6(1)(a)), and months without any response no longer show a wish to receive it; the proof of consent stays in the consent log.",
        standard:
          "Sunset policy of bulk email senders: usually 6-12 months without engagement and a confirmation request before removal.",
      },
      crm_inactive_contacts: {
        name: "CRM contacts without an account or transaction",
        what: "A contact with no activity for the chosen period: form, event registration, email open or click, team note, stage change.",
        after:
          "Anonymisation: personal data removed, stage, source and dates stay. 30 days earlier the contact appears on the “to anonymise” list - it can be extended by 12 months with a reason.",
        basis: "GDPR Art. 6(1)(f) (B2B marketing) or (a) (consent), Art. 21(2)-(3).",
        standard: "Sunset policy: 12-24 months without engagement.",
      },
      event_attendees: {
        name: "Event attendees without an account",
        what: "The attendee record and the data in their registrations: contact details, photo, bio, form answers, reasons for decisions and cancellations. The period runs from the last attendance or registration.",
        after:
          "Anonymisation: first and last name replaced with a marker, contact and descriptive data removed; attendance, ticket type, status, dates, source, company and consents (also for partners and exhibitors) stay. Outside the category: a person with an existing account (history in the profile until the account is deleted) and speakers; a paid order - never before the end of keeping accounting records.",
        basis:
          "GDPR Art. 6(1)(b) (taking part in the event) and (f) (accountability, event statistics), Art. 5(1)(e); payments - Accounting Act (Art. 74).",
        standard:
          "No market standard - a period set by the data controller, counted from the last attendance or registration.",
      },
      club_applications: {
        name: "Club applications",
        what: "The application form: contact details, company and position, profile, free-text answers (experience, languages, motivation, goals, contribution, availability, referral source) and the committee note.",
        after:
          "Anonymisation: personal data and free-text answers removed, the account replaced with a pseudonym; club, specialisation, status, decision dates, tier and coarse fields (sector, seniority, country) stay. Rejected - counted from the decision, accepted - from the end of membership, pending - never automatically. After account deletion - anonymised right away.",
        basis:
          "GDPR Art. 6(1)(b) (handling the application, membership) and (f) (defence of claims, continuity of the committee's work), Art. 5(1)(e).",
        standard: "No market standard - a period set by the data controller.",
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
      extendSave: "Extend by {{months}} months",
      extended: "Extended until {{date}}.",
      extendError: "Could not extend keeping the contact.",
      notFound: "The contact no longer exists or has been anonymised.",
      loading: "Loading the list…",
      error: "Could not load the contact list.",
    },
    reason: {
      hint: "From {{min}} to {{max}} characters.",
      count: "{{count}} of {{max}} characters",
      invalid:
        "The reason must have {{min}} to {{max}} characters - a longer one is not shortened.",
    },
    newsletter: {
      title: "Inactive subscribers - due for sunset",
      subtitle:
        "A subscriber without engagement for longer than {{months}} months gets one confirmation request; with no response within {{days}} days the address is removed from the newsletter list. At most {{cap}} requests per day - a wave of emails to long-inactive addresses harms the sender domain reputation.",
      engagementHint: "What counts as engagement: {{name}}",
      engagementBody:
        "A click in an email, an open by a person, a sign-in with a linked account, a form with this address, a sign-up confirmation and “Keep me subscribed”. An open through the Gmail image proxy counts as human - Gmail fetches images only when the email is opened. An open through Apple Mail Privacy Protection does not count: Apple fetches the pixel on delivery, so an open right after sending (the machine open threshold in the journey engine settings) is skipped. Only an address that received at least one campaign in this period is a candidate.",
      noOpens: "Engagement counted without opens",
      noOpensHint: "Why without opens: {{name}}",
      noOpensBody:
        "Open measurement (pixel) is off, so opens are not recorded and do not postpone the request. Clicks, sign-ins with a linked account, forms and sign-up confirmations count.",
      off: "Category turned off - nobody gets a request or is removed.",
      grace:
        "Grace period: until {{date}} the run only counts - no requests go out and nobody is removed.",
      countsLabel: "Sunset status",
      counts: {
        candidates: "Request in the next run",
        requested: "Request waiting to be sent",
        mailed: "Request sent - response time running",
        due: "To remove in the next run",
        excluded: "Excluded addresses",
      },
      subscriber: "Subscriber",
      lastEngaged: "Last engagement",
      status: "Status",
      deletion: "Removal",
      actions: "Actions",
      never: "none",
      state: {
        candidate: "Request in the next run",
        requested: "Request queued on {{date}} - waiting for the sending window",
        mailed: "Request sent on {{date}}",
        suppressed: "Address on the suppression list - the request did not go out ({{date}})",
      },
      deleteOn: "after {{date}}",
      deleteLater: "{{days}} days after the request is sent",
      shown: "The list shows {{shown}} of {{total}} items - the nearest dates first.",
      empty: "No subscriber is waiting for a request or removal.",
      loading: "Loading the list…",
      error: "Could not load the subscriber list.",
      copyLink: "Request text and email preview",
      exclude: "Exclude",
      excludeAria: "Exclude from sunset: {{email}}",
      excludeTitle: "Exclude the address from sunset?",
      excludeBody:
        "{{email}} will not get a confirmation request and will not be removed from the list; a request in progress is cancelled. Give a reason - it goes to the audit log.",
      excludeReason: "Reason for the exclusion",
      excludeSave: "Exclude the address",
      excluded: "Address excluded from sunset.",
      excludedCancelled: "Address excluded - the request in progress was cancelled.",
      excludedTitle: "Excluded addresses",
      excludedEmpty: "No address is excluded.",
      address: "Address",
      reasonColumn: "Reason",
      since: "Since",
      include: "Undo exclusion",
      includeAria: "Undo exclusion: {{email}}",
      includeTitle: "Undo the exclusion of this address?",
      includeBody:
        "{{email}} returns to the sunset rule: without engagement it will get a confirmation request. Give a reason - it goes to the audit log.",
      includeReason: "Reason for undoing",
      included: "Exclusion undone.",
      saveError: "Could not save the exclusion change.",
      notFound: "The subscriber no longer exists or is not excluded.",
    },
    sunsetCopy: {
      title: "Subscription confirmation request (sunset)",
      subtitle:
        "The only email to a subscriber inactive for longer than the period in the “Data retention” card (Settings → Privacy). An empty field = the default text; the “Keep me subscribed” button and the unsubscribe link are added by the system.",
      langLabel: "Text language",
      fields: {
        subject: "Subject",
        preview: "Inbox preview text",
        eyebrow: "Eyebrow",
        heading: "Heading",
        intro: "Introduction",
        cta: "Button",
        note: "“What next” box",
      },
      counter: "{{count}} of {{max}} characters",
      tooLong: "Too long: {{count}} of {{max}} characters - shorten it, the text will not be cut.",
      tokens: "Variables: {{tokens}} - first name, days left to respond, removal date.",
      reset: "Restore defaults",
      save: "Save the text",
      saved: "Request text saved.",
      saveError: "Could not save the request text.",
      conflict:
        "Someone saved the request text in another tab. Your changes are still in the editor - check them and save again to replace that version.",
      invalid: "A field exceeds its character limit - the text was not saved.",
      unsaved: "Unsaved changes",
      previewTitle: "Email preview",
      previewRefresh: "Refresh preview",
      previewLoading: "Preparing the preview…",
      previewError: "Could not prepare the preview.",
      previewFrame: "Preview of the confirmation request email",
      previewSubject: "Subject: {{subject}}",
      previewNote: "Preview with a sample first name; buttons in the preview do not work.",
      loading: "Loading the request text…",
      readError: "Could not load the request text.",
      forbidden: "Only an administrator changes the request text.",
      unavailable:
        "Newsletter sunset is not deployed in this database yet - editing will work after deployment.",
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
