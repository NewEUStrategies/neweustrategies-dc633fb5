// Słownik APLIKACJI SKANERA (/scanner), PL/EN.
//
// DLACZEGO OSOBNA NAKŁADKA, A NIE `i18n-admin-event-onsite`. Tamten słownik
// opisuje PANEL organizatora: dziennik odpraw, urządzenia, szablony
// identyfikatorów, statystyki. Skaner to inna aplikacja, inny odbiorca i inny
// pakiet - wolontariusz otwiera go na telefonie przy bramce, często na słabym
// łączu, i nie ma powodu, żeby pobierał przy tym etykiety ekranów, których
// nigdy nie zobaczy. Nakładki i18n są niepodzielne, więc rozdział słownika
// jest jedynym sposobem, żeby rozdzielić pakiety.
//
// KAŻDY NAPIS MÓWI, CO ZROBIĆ TERAZ. Przy bramce nie ma czasu na diagnozę:
// „Kod z innego wydarzenia" plus nazwa tamtego wydarzenia rozwiązuje sprawę
// w dwie sekundy, „not found" nie rozwiązuje jej wcale. Ta sama zasada rządzi
// odmowami poświadczenia - każda mówi, czy czekać, czy prosić o nowy kod.
//
// KLUCZE ODPOWIADAJĄ WARTOŚCIOM Z BAZY, JEDEN DO JEDNEGO:
//   * `event_checkins.result` -> `eventScanner.outcomes.*` (osiem wartości
//     z ograniczenia CHECK, w tym `denied_already_inside` - OPS-08, oraz
//     `denied_code_superseded` z 20261012111000 - wiersz konfliktu, gdy bramka
//     offline wpuściła kod już zastąpiony; plus
//     `repeat`, `unknown_code`, `wrong_event` i `code_superseded` - OPS-04,
//     które są WYNIKAMI RPC, a nie wierszami dziennika); zgoda na PONOWNE
//     wejście (`reentry`) ma własny nagłówek `grantedReentry`,
//   * `superseded.{credential,reason}` odpowiedzi `code_superseded` ->
//     `eventScanner.superseded.<ticket|badge>.<reissued|revoked|invalidated>`,
//   * `event_checkpoints.direction_mode` -> `eventScanner.directions.*`,
//   * `event_badge_prints.reason` -> `eventScanner.badge.reasons.*`,
//   * odmowy `_event_scanner_device_auth` -> `eventScanner.errors.*`.
import i18n from "@/lib/i18n";

export const eventScannerPl = {
  eventScanner: {
    appName: "Skaner NES",
    appDescription: "Odprawa uczestników, skan leadów i wydruk identyfikatorów.",

    // -----------------------------------------------------------------
    // Parowanie urządzenia. Token wydaje panel organizatora i pokazuje go
    // JEDEN raz - dlatego ekran mówi wprost, skąd go wziąć.
    // -----------------------------------------------------------------
    pairing: {
      title: "Podłącz urządzenie",
      subtitle:
        "Wpisz kod urządzenia z panelu organizatora. Kod otwiera jedno wydarzenie i wygasa w terminie ustalonym przy wydaniu.",
      tokenLabel: "Kod urządzenia",
      tokenPlaceholder: "Wklej kod z panelu",
      connect: "Podłącz",
      connecting: "Łączę…",
      invalidToken:
        "To nie wygląda na kod urządzenia. Sprawdź, czy nic się nie urwało przy kopiowaniu.",
      help: "Kod wydaje organizator w panelu: Wydarzenia → Na miejscu → Urządzenia.",
      offlineFirstRun: "Pierwsze podłączenie wymaga sieci. Później skaner działa też bez zasięgu.",
      legacyLink:
        "Ten link parowania ma stary format i NIE został użyty - kod urządzenia mógł trafić do historii przeglądarki. Poproś organizatora o nowy kod QR do parowania.",
      relocating: "Przenoszę skaner pod jego własny adres…",
    },

    // -----------------------------------------------------------------
    // Pasek sesji urządzenia.
    // -----------------------------------------------------------------
    session: {
      deviceLabel: "Urządzenie",
      eventLabel: "Wydarzenie",
      expiresIn_one: "Kod ważny jeszcze {{count}} godzinę",
      expiresIn_few: "Kod ważny jeszcze {{count}} godziny",
      expiresIn_many: "Kod ważny jeszcze {{count}} godzin",
      expiresIn_other: "Kod ważny jeszcze {{count}} godzin",
      expiresSoon: "Kod wygasa dziś - poproś organizatora o nowy przed końcem zmiany.",
      expired: "Kod urządzenia wygasł. Poproś organizatora o nowy.",
      disconnect: "Odłącz urządzenie",
      disconnectHint:
        "Kod, kolejka skanów, lista osób i lista do wyjaśnienia znikną z tego telefonu.",
      disconnectTitle: "Odłączyć urządzenie i usunąć dane skanera?",
      disconnectUnsent:
        "Na tym telefonie są skany, które NIE trafiły do bazy, albo lista do wyjaśnienia z organizatorem. Odłączenie usunie je razem z kodem urządzenia. Najpierw wyślij kolejkę i pobierz plik dla organizatora.",
      disconnectConfirm: "Odłącz i usuń",
      disconnectCancel: "Anuluj",
      relocation:
        "Skaner ma własny adres: {{origin}}. Ta karta najpierw wyśle zaległe skany - potem przenieś urządzenie pod nowy adres.",
      relocate: "Przejdź pod nowy adres",
      online: "Sieć dostępna",
      offline: "Brak sieci - skany czekają w kolejce",
      memoryOnly:
        "Ta przeglądarka nie pozwala zapisać kolejki na urządzeniu. Nie zamykaj karty, dopóki kolejka nie jest pusta.",
      offlineReady: "Bez sieci - decyzje z listy offline",
      staleBadge: "Sesja z pamięci",
      staleSession:
        "Pracujesz na sesji zapisanej na urządzeniu. Potwierdzę ją w bazie, gdy wróci sieć.",
      clockSkew_one:
        "Zegar tego telefonu różni się od serwera o {{count}} minutę. Czas skanów jest korygowany - włącz automatyczny czas w ustawieniach.",
      clockSkew_few:
        "Zegar tego telefonu różni się od serwera o {{count}} minuty. Czas skanów jest korygowany - włącz automatyczny czas w ustawieniach.",
      clockSkew_many:
        "Zegar tego telefonu różni się od serwera o {{count}} minut. Czas skanów jest korygowany - włącz automatyczny czas w ustawieniach.",
      clockSkew_other:
        "Zegar tego telefonu różni się od serwera o {{count}} minut. Czas skanów jest korygowany - włącz automatyczny czas w ustawieniach.",
      expiredSyncing:
        "Skany z kolejki są jeszcze wysyłane - baza przyjmuje je do 72 godzin po terminie kodu. Nie odłączaj urządzenia, dopóki kolejka nie będzie pusta.",
    },

    modes: {
      checkin: "Odprawa",
      lead: "Leady",
      badge: "Identyfikator",
    },

    // -----------------------------------------------------------------
    // Punkt kontrolny i kierunek.
    // -----------------------------------------------------------------
    checkpoint: {
      label: "Punkt kontrolny",
      pinned: "Punkt przypisany do tego urządzenia",
      choose: "Wybierz punkt kontrolny",
      none: "To wydarzenie nie ma aktywnego punktu kontrolnego.",
      occupancy: "Na miejscu: {{count}}",
      capacity: "Limit: {{count}}",
      trackMode: "Ten punkt tylko liczy wejścia - nikomu nie odmawia.",
      reentryDeny:
        "Ponowne wejście zablokowane - kto jest w środku, nie wejdzie drugi raz, dopóki nie wyjdzie.",
      dedupeWindow_one: "Powtórne piknięcie w ciągu {{count}} sekundy nie tworzy nowego wpisu.",
      dedupeWindow_few: "Powtórne piknięcie w ciągu {{count}} sekund nie tworzy nowego wpisu.",
      dedupeWindow_many: "Powtórne piknięcie w ciągu {{count}} sekund nie tworzy nowego wpisu.",
      dedupeWindow_other: "Powtórne piknięcie w ciągu {{count}} sekund nie tworzy nowego wpisu.",
    },

    directions: {
      label: "Kierunek",
      in: "Wejście",
      out: "Wyjście",
    },

    // -----------------------------------------------------------------
    // Czytnik. Aparat jest wygodą, klawiatura jest gwarancją.
    // -----------------------------------------------------------------
    camera: {
      start: "Włącz aparat",
      stop: "Wyłącz aparat",
      starting: "Uruchamiam aparat…",
      permissionDenied:
        "Przeglądarka nie dała dostępu do aparatu. Wpisz kod ręcznie albo zmień zgodę w ustawieniach strony.",
      notSupported:
        "Ta przeglądarka nie umie czytać kodów z obrazu. Użyj czytnika sprzętowego albo wpisz kod ręcznie.",
      insecureContext: "Aparat działa tylko na połączeniu szyfrowanym (https).",
      hint: "Skieruj aparat na kod z biletu.",
      torchOn: "Włącz doświetlenie",
      torchOff: "Wyłącz doświetlenie",
    },

    manual: {
      label: "Kod z biletu",
      placeholder: "Zeskanuj czytnikiem albo wpisz kod",
      submit: "Sprawdź kod",
      hint: "Czytnik sprzętowy działa bez ustawień - wystarczy, że to pole ma kursor.",
      wedgeReady: "Czytnik gotowy",
    },

    actions: {
      admit: "Wpuść i zapisz",
      recheck: "Skanuj kolejną osobę",
      resolveOnly: "Tylko sprawdź",
      working: "Zapisuję…",
      retry: "Ponów",
    },

    // -----------------------------------------------------------------
    // Wyniki skanu. Nagłówek wielkim napisem - operator patrzy z metra.
    // -----------------------------------------------------------------
    outcomes: {
      granted: "Wpuść",
      repeat: "Już odprawiony",
      unknownCode: "Nieznany kod",
      wrongEvent: "Kod z innego wydarzenia",
      deniedNotRegistered: "Brak zapisu",
      deniedRegistrationStatus: "Zapis niezatwierdzony",
      deniedDirection: "Zły kierunek",
      deniedCapacity: "Brak miejsc",
      deniedCheckpointInactive: "Punkt nieaktywny",
      deniedAlreadyInside: "Już w środku - nie wpuszczaj",
      deniedCodeSuperseded: "Kod zastąpiony przed skanem",
      codeSuperseded: "Kod zastąpiony",
      grantedReentry: "Ponowne wejście - wpuść",
      saved: "Zapisano",
      replay: "Skan już zapisany",
      printed: "Wydruk zapisany",
      unknown: "Nieznany wynik",
    },

    outcomeHints: {
      repeat: "Ta osoba przeszła już przez ten punkt. Wpis nie został zdublowany.",
      unknownCode: "Kod nie pasuje do żadnego zgłoszenia. Sprawdź osobę po nazwisku w recepcji.",
      wrongEvent: "Ten bilet należy do wydarzenia: {{event}}.",
      deniedNotRegistered: "Skieruj do recepcji - zgłoszenie trzeba dopisać.",
      deniedRegistrationStatus: "Zgłoszenie czeka na decyzję organizatora.",
      deniedDirection: "Ten punkt obsługuje inny kierunek ruchu.",
      deniedCapacity: "Punkt osiągnął limit obecności.",
      deniedCheckpointInactive: "Ten punkt został wyłączony w panelu.",
      deniedAlreadyInside:
        "Ta osoba jest już w środku, a punkt nie wpuszcza ponownie. Skieruj ją do koordynatora.",
      deniedAlreadyInsideAt:
        "Wejście zapisane {{when}}, bez wyjścia - punkt nie wpuszcza ponownie. Skieruj osobę do koordynatora.",
      deniedCodeSuperseded:
        "Bramka bez sieci wpuściła kod, który był już zastąpiony - organizator zobaczy to jako konflikt.",
      codeSuperseded: "Ten kod już nie wpuszcza. Poproś o aktualny identyfikator albo bilet.",
      grantedReentry: "Ta osoba była już w środku - punkt pozwala wejść ponownie.",
      grantedReentryAt: "Poprzednie wejście: {{when}}. Punkt pozwala wejść ponownie.",
      replay: "Ten sam skan dotarł do bazy wcześniej - nic nie zostało zdublowane.",
      previousCheckin: "Poprzednia odprawa: {{when}}",
    },

    // -----------------------------------------------------------------
    // Kod zastąpiony (OPS-04): poświadczenie × powód, z chwilą zastąpienia.
    // Każde zdanie mówi, co zrobić - poprosić o aktualny kod albo odesłać.
    // -----------------------------------------------------------------
    superseded: {
      holder: "Kod należał do: {{name}}",
      badge: {
        reissued:
          "Wydrukowano nowy identyfikator ({{when}}) - ten jest nieważny. Poproś o aktualny.",
        revoked:
          "Identyfikator unieważniony ({{when}}) po zwrocie albo anulowaniu zgłoszenia. Skieruj do recepcji.",
        invalidated:
          "Identyfikator zgłoszony jako zgubiony i unieważniony ({{when}}). Poproś o aktualny.",
      },
      ticket: {
        reissued: "Wydano nowy bilet ({{when}}) - ten jest nieważny. Poproś o aktualny.",
        revoked:
          "Bilet unieważniony ({{when}}) po zwrocie albo anulowaniu zgłoszenia. Skieruj do recepcji.",
        invalidated: "Bilet zgłoszony jako zgubiony i unieważniony ({{when}}). Poproś o aktualny.",
      },
    },

    person: {
      unnamed: "Uczestnik bez nazwy",
      ticket: "Bilet",
      group: "Grupa",
      status: "Status zgłoszenia",
      badgePrinted: "Identyfikator wydany",
      badgeNotPrinted: "Identyfikator niewydany",
      badgePrintedAt: "Wydany {{when}}",
    },

    // -----------------------------------------------------------------
    // Leady partnera. Zgodę zbiera FORMULARZ ZAPISU, nie bramka - dlatego
    // przy braku zgody nie ma tu żadnego przycisku „dopytaj".
    // -----------------------------------------------------------------
    lead: {
      title: "Skan leadu",
      saved: "Lead zapisany",
      scanCount_one: "Zeskanowany {{count}} raz",
      scanCount_few: "Zeskanowany {{count}} razy",
      scanCount_many: "Zeskanowany {{count}} razy",
      scanCount_other: "Zeskanowany {{count}} razy",
      consentYes: "Uczestnik zgodził się na przekazanie danych",
      consentNo: "Brak zgody na przekazanie danych",
      consentNoHint:
        "Skan jest policzony, ale dane kontaktowe nie zostaną Ci przekazane. Zgodę zbiera formularz zapisu, nie stoisko.",
      noteLabel: "Notatka ze spotkania",
      notePlaceholder: "O czym rozmawialiście?",
      ratingLabel: "Zainteresowanie",
      ratingValue: "{{count}} z 5",
      save: "Zapisz notatkę",
      listTitle: "Twoje leady",
      listEmpty: "Nie masz jeszcze żadnego skanu.",
      listSummary: "{{total}} skanów, w tym {{consent}} ze zgodą",
      exportCsv: "Pobierz CSV",
      loadMore: "Pokaż więcej",
    },

    // -----------------------------------------------------------------
    // Identyfikatory. Druk wymaga sieci - patrz nagłówek `scannerOutbox`.
    // -----------------------------------------------------------------
    badge: {
      title: "Wydruk identyfikatora",
      print: "Zapisz wydruk",
      printing: "Zapisuję…",
      copies: "Liczba sztuk",
      reasonLabel: "Powód",
      previousPrints_one: "Wcześniej wydrukowano {{count}} raz",
      previousPrints_few: "Wcześniej wydrukowano {{count}} razy",
      previousPrints_many: "Wcześniej wydrukowano {{count}} razy",
      previousPrints_other: "Wcześniej wydrukowano {{count}} razy",
      requiresNetwork: "Rejestr wydruków wymaga sieci - to dokument rozliczenia z drukarnią.",
      reasons: {
        first_issue: "Pierwsze wydanie",
        reprint_lost: "Ponowny wydruk - zgubiony",
        reprint_damaged: "Ponowny wydruk - uszkodzony",
        data_correction: "Poprawa danych",
        bulk_preprint: "Wydruk hurtowy",
      },
    },

    // -----------------------------------------------------------------
    // Kolejka skanów czekających na sieć.
    // -----------------------------------------------------------------
    outbox: {
      title: "Kolejka skanów",
      pending_one: "{{count}} skan czeka na wysłanie",
      pending_few: "{{count}} skany czekają na wysłanie",
      pending_many: "{{count}} skanów czeka na wysłanie",
      pending_other: "{{count}} skanów czeka na wysłanie",
      empty: "Wszystko wysłane.",
      sync: "Wyślij teraz",
      syncing: "Wysyłam…",
      stuck_one: "{{count}} skan wymaga uwagi",
      stuck_few: "{{count}} skany wymagają uwagi",
      stuck_many: "{{count}} skanów wymaga uwagi",
      stuck_other: "{{count}} skanów wymaga uwagi",
      stuckHint:
        "Baza ich nie przyjęła, a lista do wyjaśnienia nie zapisała się na tym urządzeniu. Pokaż je organizatorowi przed odłączeniem urządzenia.",
      retrying_one: "{{count}} skan czeka na ponowienie",
      retrying_few: "{{count}} skany czekają na ponowienie",
      retrying_many: "{{count}} skanów czeka na ponowienie",
      retrying_other: "{{count}} skanów czeka na ponowienie",
      retryingHint:
        "Ostatnia próba się nie udała. Skaner ponawia sam - najpóźniej co minutę i od razu po powrocie sieci. Możesz też ponowić teraz.",
      retry: "Ponów",
      retryAll: "Ponów wszystkie",
      codePrefix: "Kod zaczyna się od {{prefix}}…",
      discard: "Usuń z kolejki",
      discardTitle: "Usunąć skan z kolejki?",
      discardDescription:
        "Ten skan NIE trafi do bazy: osoba nie będzie miała zapisanej obecności, a partner nie dostanie leadu. Usuń go tylko, gdy organizator tak zdecydował.",
      discardCancel: "Anuluj",
      queuedToast: "Brak sieci - skan czeka w kolejce.",
      flushedToast_one: "Wysłano {{count}} skan z kolejki.",
      flushedToast_few: "Wysłano {{count}} skany z kolejki.",
      flushedToast_many: "Wysłano {{count}} skanów z kolejki.",
      flushedToast_other: "Wysłano {{count}} skanów z kolejki.",
    },

    // -----------------------------------------------------------------
    // Tryb offline: lista osób na urządzeniu i decyzja bez sieci. Decyzja
    // offline jest TYMCZASOWA - każdy napis to mówi, bo serwer ma ostatnie
    // słowo po powrocie sieci.
    // -----------------------------------------------------------------
    offline: {
      rosterFresh_one: "Lista offline: {{count}} osoba, stan z {{time}}",
      rosterFresh_few: "Lista offline: {{count}} osoby, stan z {{time}}",
      rosterFresh_many: "Lista offline: {{count}} osób, stan z {{time}}",
      rosterFresh_other: "Lista offline: {{count}} osób, stan z {{time}}",
      rosterStale_one: "Lista offline może być nieaktualna: {{count}} osoba, stan z {{time}}",
      rosterStale_few: "Lista offline może być nieaktualna: {{count}} osoby, stan z {{time}}",
      rosterStale_many: "Lista offline może być nieaktualna: {{count}} osób, stan z {{time}}",
      rosterStale_other: "Lista offline może być nieaktualna: {{count}} osób, stan z {{time}}",
      rosterNone:
        "Lista offline nie jest jeszcze pobrana - pobierze się, gdy urządzenie połączy się z siecią.",
      rosterSyncing: "Pobieram listę offline…",
      rosterDisabled:
        "To urządzenie nie ma listy offline - bez sieci skany tylko czekają w kolejce.",
      refresh: "Odśwież listę",
      decisionHint:
        "Decyzja z listy offline (stan z {{time}}) - serwer potwierdzi ją po powrocie sieci.",
      approximateCapacity: "Limitu miejsc nie da się sprawdzić bez sieci.",
      personFromRoster: "Dane z listy offline",
    },

    // -----------------------------------------------------------------
    // Gotowość do pracy bez sieci - cztery warunki, każdy z odpowiedzią.
    // -----------------------------------------------------------------
    readiness: {
      title: "Gotowość do pracy bez sieci",
      shellReady: "Aplikacja zapisana na urządzeniu",
      shellPartial: "Aplikacja zapisana częściowo ({{cached}} z {{total}} plików)",
      shellMissing: "Aplikacja nie jest jeszcze zapisana - otwórz skaner raz przy dobrym zasięgu",
      shellChecking: "Sprawdzam, czy aplikacja jest zapisana…",
      rosterReady: "Lista offline aktualna",
      rosterNotReady: "Brak aktualnej listy offline",
      rosterDisabled: "Lista offline wyłączona przez organizatora",
      queuePersistent: "Kolejka skanów zapisuje się na urządzeniu",
      queueMemoryOnly: "Kolejka skanów żyje tylko w tej karcie",
      storagePersisted: "Przeglądarka nie usunie danych skanera",
      storageNotPersisted: "Przeglądarka może usunąć dane skanera przy braku miejsca",
      storageUnknown: "Ta przeglądarka nie mówi, czy zachowa dane skanera",
      requestPersist: "Poproś o trwałe przechowywanie",
      persistGranted: "Dane skanera są przechowywane trwale.",
      persistDenied: "Przeglądarka odmówiła trwałego przechowywania.",
    },

    // -----------------------------------------------------------------
    // Po synchronizacji: konflikty decyzji offline i skany odrzucone.
    // -----------------------------------------------------------------
    sync: {
      title: "Do wyjaśnienia z organizatorem",
      conflicts_one: "{{count}} konflikt decyzji offline",
      conflicts_few: "{{count}} konflikty decyzji offline",
      conflicts_many: "{{count}} konfliktów decyzji offline",
      conflicts_other: "{{count}} konfliktów decyzji offline",
      rejected_one: "{{count}} skan odrzucony przez bazę",
      rejected_few: "{{count}} skany odrzucone przez bazę",
      rejected_many: "{{count}} skanów odrzuconych przez bazę",
      rejected_other: "{{count}} skanów odrzuconych przez bazę",
      kinds: {
        admittedOffline: "Wpuszczony bez sieci - serwer odmawia",
        deniedOffline: "Odmowa bez sieci - serwer by wpuścił",
      },
      hint: "Skany odrzucone NIE są w bazie. Pobierz plik i przekaż go organizatorowi, zanim wyczyścisz listę.",
      exportCsv: "Pobierz CSV",
      exportJson: "Pobierz JSON",
      clear: "Wyczyść listę",
      clearTitle: "Wyczyścić listę do wyjaśnienia?",
      clearDescription:
        "Konflikty i odrzucone skany znikną z tego urządzenia. Zrób to dopiero po przekazaniu pliku organizatorowi.",
      cancel: "Anuluj",
      flushedConflicts_one:
        "Po wysyłce: {{count}} konflikt decyzji offline - sprawdź listę do wyjaśnienia.",
      flushedConflicts_few:
        "Po wysyłce: {{count}} konflikty decyzji offline - sprawdź listę do wyjaśnienia.",
      flushedConflicts_many:
        "Po wysyłce: {{count}} konfliktów decyzji offline - sprawdź listę do wyjaśnienia.",
      flushedConflicts_other:
        "Po wysyłce: {{count}} konfliktów decyzji offline - sprawdź listę do wyjaśnienia.",
      flushedRejected_one: "{{count}} skan odrzucony przez bazę - jest na liście do wyjaśnienia.",
      flushedRejected_few: "{{count}} skany odrzucone przez bazę - są na liście do wyjaśnienia.",
      flushedRejected_many:
        "{{count}} skanów odrzuconych przez bazę - są na liście do wyjaśnienia.",
      flushedRejected_other:
        "{{count}} skanów odrzuconych przez bazę - są na liście do wyjaśnienia.",
      columns: {
        type: "Typ",
        kind: "Rodzaj",
        scannedAt: "Czas skanu",
        checkpoint: "Punkt",
        direction: "Kierunek",
        offlineOutcome: "Decyzja offline",
        serverResult: "Wynik serwera",
        person: "Osoba",
        registrationId: "Zgłoszenie",
        code: "Początek kodu",
        codeHash: "Skrót kodu (SHA-256)",
        reference: "Identyfikator",
        conflict: "konflikt",
        rejected: "odrzucony",
      },
    },

    install: {
      title: "Zainstaluj skaner",
      body: "Dodaj skaner do ekranu głównego - uruchomi się bez paska adresu i zadziała też przy słabym zasięgu.",
      action: "Zainstaluj",
      dismiss: "Nie teraz",
    },

    // -----------------------------------------------------------------
    // Odmowy. Klucz odpowiada prefiksowi wyjątku z bazy.
    // -----------------------------------------------------------------
    errors: {
      invalidDeviceToken: "Ten kod urządzenia nie jest znany. Poproś organizatora o nowy.",
      deviceRevoked: "Poświadczenie zostało unieważnione. Poproś organizatora o nowy kod.",
      deviceInactive: "Urządzenie jest wstrzymane w panelu. Poproś organizatora o odblokowanie.",
      deviceExpired: "Kod urządzenia wygasł. Poproś organizatora o nowy.",
      deviceLocked:
        "Urządzenie jest chwilowo zablokowane po serii nieznanych kodów. Odczekaj chwilę i spróbuj ponownie.",
      deviceScopeMissing: "To poświadczenie nie ma uprawnienia do tej czynności.",
      deviceCheckpointMismatch: "To urządzenie jest przypisane do innego punktu kontrolnego.",
      checkpointNotFound: "Ten punkt kontrolny nie istnieje w tym wydarzeniu.",
      invalidPayload: "Skan jest niekompletny. Zeskanuj kod jeszcze raz.",
      invalidDirection: "Nieznany kierunek ruchu.",
      personNotFound: "Nie znaleziono tej osoby w tej organizacji.",
      templateMissing: "To wydarzenie nie ma domyślnego szablonu identyfikatora.",
      templateNotInEvent: "Ten szablon identyfikatora należy do innego wydarzenia.",
      rosterDisabled: "Organizator wyłączył listę offline dla tego urządzenia.",
      rosterThrottled: "Lista offline była pobrana przed chwilą. Spróbuj ponownie za pół minuty.",
      rosterResyncRequired: "Lista offline wymaga pełnego pobrania od nowa.",
      deviceTimeOutOfRange:
        "Skan jest starszy niż tydzień - baza go nie przyjmie. Pokaż go organizatorowi.",
      outboxOverflow:
        "Kolejka na urządzeniu była pełna - ten skan nie zmieścił się w niej. Przekaż go organizatorowi.",
      deviceMismatch:
        "Skan zapisano pod innym kodem urządzenia - nie został wysłany pod bieżącym. Przekaż go organizatorowi.",
      outboxSealed:
        "Kodu z tego skanu nie da się odczytać na tym urządzeniu (zapisano go pod innym kodem urządzenia albo bez szyfrowania). Przekaż skan organizatorowi - plik ma skrót kodu.",
      rateLimited: "Baza prosi o chwilę przerwy. Skan czeka w kolejce i pojedzie sam.",
      tooManyRequests: "Baza prosi o chwilę przerwy. Skan czeka w kolejce i pojedzie sam.",
      offline: "Brak sieci. Skan czeka w kolejce i pojedzie, gdy zasięg wróci.",
      unknown: "Coś nie zadziałało. Spróbuj jeszcze raz.",
    },
  },
};

export const eventScannerEn = {
  eventScanner: {
    appName: "NES Scanner",
    appDescription: "Attendee check-in, lead capture and badge printing.",

    pairing: {
      title: "Connect this device",
      subtitle:
        "Enter the device code from the organiser panel. The code opens one event and expires on the date set when it was issued.",
      tokenLabel: "Device code",
      tokenPlaceholder: "Paste the code from the panel",
      connect: "Connect",
      connecting: "Connecting…",
      invalidToken: "That does not look like a device code. Check whether the copy was cut short.",
      help: "The organiser issues the code in the panel: Events → On-site → Devices.",
      offlineFirstRun:
        "The first connection needs a network. After that the scanner works offline too.",
      legacyLink:
        "This pairing link uses the old format and was NOT used - the device code may have reached the browser history. Ask the organiser for a new pairing QR code.",
      relocating: "Moving the scanner to its own address…",
    },

    session: {
      deviceLabel: "Device",
      eventLabel: "Event",
      expiresIn_one: "Code valid for {{count}} more hour",
      expiresIn_other: "Code valid for {{count}} more hours",
      expiresSoon:
        "The code expires today - ask the organiser for a new one before your shift ends.",
      expired: "The device code has expired. Ask the organiser for a new one.",
      disconnect: "Disconnect device",
      disconnectHint:
        "The code, the scan queue, the people list and the list to clear up leave this phone.",
      disconnectTitle: "Disconnect the device and delete scanner data?",
      disconnectUnsent:
        "This phone holds scans that did NOT reach the server, or a list to clear up with the organiser. Disconnecting deletes them together with the device code. Send the queue and download the file for the organiser first.",
      disconnectConfirm: "Disconnect and delete",
      disconnectCancel: "Cancel",
      relocation:
        "The scanner has its own address: {{origin}}. This tab sends the queued scans first - then move the device to the new address.",
      relocate: "Go to the new address",
      online: "Network available",
      offline: "No network - scans are queued",
      memoryOnly:
        "This browser will not let us store the queue on the device. Keep the tab open until the queue is empty.",
      offlineReady: "Offline - decisions from the offline list",
      staleBadge: "Stored session",
      staleSession:
        "You are working on the session stored on this device. It will be confirmed with the server when the network returns.",
      clockSkew_one:
        "This phone's clock differs from the server by {{count}} minute. Scan times are corrected - turn on automatic time in the settings.",
      clockSkew_other:
        "This phone's clock differs from the server by {{count}} minutes. Scan times are corrected - turn on automatic time in the settings.",
      expiredSyncing:
        "Queued scans are still being sent - the server accepts them for up to 72 hours after the code expired. Do not disconnect the device until the queue is empty.",
    },

    modes: {
      checkin: "Check-in",
      lead: "Leads",
      badge: "Badge",
    },

    checkpoint: {
      label: "Checkpoint",
      pinned: "Checkpoint pinned to this device",
      choose: "Choose a checkpoint",
      none: "This event has no active checkpoint.",
      occupancy: "On site: {{count}}",
      capacity: "Capacity: {{count}}",
      trackMode: "This checkpoint only counts entries - it never refuses anyone.",
      reentryDeny: "Re-entry blocked - anyone inside cannot enter again until they leave.",
      dedupeWindow_one: "A repeat scan within {{count}} second does not create a new entry.",
      dedupeWindow_other: "A repeat scan within {{count}} seconds does not create a new entry.",
    },

    directions: {
      label: "Direction",
      in: "Entry",
      out: "Exit",
    },

    camera: {
      start: "Start camera",
      stop: "Stop camera",
      starting: "Starting the camera…",
      permissionDenied:
        "The browser refused camera access. Type the code manually or change the permission in site settings.",
      notSupported:
        "This browser cannot read codes from the camera. Use a hardware scanner or type the code manually.",
      insecureContext: "The camera only works over an encrypted connection (https).",
      hint: "Point the camera at the code on the ticket.",
      torchOn: "Turn on the light",
      torchOff: "Turn off the light",
    },

    manual: {
      label: "Ticket code",
      placeholder: "Scan with a reader or type the code",
      submit: "Check the code",
      hint: "A hardware reader needs no setup - this field only has to hold the cursor.",
      wedgeReady: "Reader ready",
    },

    actions: {
      admit: "Admit and record",
      recheck: "Scan the next person",
      resolveOnly: "Check only",
      working: "Saving…",
      retry: "Retry",
    },

    outcomes: {
      granted: "Admit",
      repeat: "Already checked in",
      unknownCode: "Unknown code",
      wrongEvent: "Code from another event",
      deniedNotRegistered: "No registration",
      deniedRegistrationStatus: "Registration not approved",
      deniedDirection: "Wrong direction",
      deniedCapacity: "At capacity",
      deniedCheckpointInactive: "Checkpoint inactive",
      deniedAlreadyInside: "Already inside - do not admit",
      deniedCodeSuperseded: "Code replaced before the scan",
      codeSuperseded: "Code replaced",
      grantedReentry: "Re-entry - admit",
      replay: "Scan already recorded",
      saved: "Saved",
      printed: "Print recorded",
      unknown: "Unknown result",
    },

    outcomeHints: {
      repeat: "This person already passed this checkpoint. The entry was not duplicated.",
      unknownCode: "The code matches no registration. Look the person up by name at the desk.",
      wrongEvent: "This ticket belongs to: {{event}}.",
      deniedNotRegistered: "Send them to the desk - the registration has to be added.",
      deniedRegistrationStatus: "The registration is waiting for the organiser's decision.",
      deniedDirection: "This checkpoint handles the other direction of travel.",
      deniedCapacity: "The checkpoint reached its occupancy limit.",
      deniedCheckpointInactive: "This checkpoint was switched off in the panel.",
      deniedAlreadyInside:
        "This person is already inside and the checkpoint does not allow re-entry. Refer them to the coordinator.",
      deniedAlreadyInsideAt:
        "Entry recorded {{when}} with no exit - the checkpoint does not allow re-entry. Refer the person to the coordinator.",
      deniedCodeSuperseded:
        "The offline gate admitted a code that had already been replaced - the organiser sees it as a conflict.",
      codeSuperseded: "This code no longer admits. Ask for the current badge or ticket.",
      grantedReentry: "This person was already inside - the checkpoint allows re-entry.",
      grantedReentryAt: "Previous entry: {{when}}. The checkpoint allows re-entry.",
      replay: "The same scan reached the server earlier - nothing was duplicated.",
      previousCheckin: "Previous check-in: {{when}}",
    },

    superseded: {
      holder: "Code belonged to: {{name}}",
      badge: {
        reissued: "A new badge was printed ({{when}}) - this one is void. Ask for the current one.",
        revoked:
          "Badge revoked ({{when}}) after a refund or a cancelled registration. Send them to the desk.",
        invalidated: "Badge reported lost and revoked ({{when}}). Ask for the current one.",
      },
      ticket: {
        reissued: "A new ticket was issued ({{when}}) - this one is void. Ask for the current one.",
        revoked:
          "Ticket revoked ({{when}}) after a refund or a cancelled registration. Send them to the desk.",
        invalidated: "Ticket reported lost and revoked ({{when}}). Ask for the current one.",
      },
    },

    person: {
      unnamed: "Attendee without a name",
      ticket: "Ticket",
      group: "Group",
      status: "Registration status",
      badgePrinted: "Badge issued",
      badgeNotPrinted: "Badge not issued",
      badgePrintedAt: "Issued {{when}}",
    },

    lead: {
      title: "Lead scan",
      saved: "Lead saved",
      scanCount_one: "Scanned {{count}} time",
      scanCount_other: "Scanned {{count}} times",
      consentYes: "The attendee agreed to share their details",
      consentNo: "No consent to share details",
      consentNoHint:
        "The scan is counted, but the contact details will not reach you. Consent is collected by the registration form, not at the booth.",
      noteLabel: "Meeting note",
      notePlaceholder: "What did you talk about?",
      ratingLabel: "Interest",
      ratingValue: "{{count}} of 5",
      save: "Save the note",
      listTitle: "Your leads",
      listEmpty: "You have no scans yet.",
      listSummary: "{{total}} scans, {{consent}} of them with consent",
      exportCsv: "Download CSV",
      loadMore: "Show more",
    },

    badge: {
      title: "Badge print",
      print: "Record the print",
      printing: "Saving…",
      copies: "Copies",
      reasonLabel: "Reason",
      previousPrints_one: "Printed {{count}} time before",
      previousPrints_other: "Printed {{count}} times before",
      requiresNetwork:
        "The print register needs a network - it is the settlement document with the print shop.",
      reasons: {
        first_issue: "First issue",
        reprint_lost: "Reprint - lost",
        reprint_damaged: "Reprint - damaged",
        data_correction: "Data correction",
        bulk_preprint: "Bulk pre-print",
      },
    },

    outbox: {
      title: "Scan queue",
      pending_one: "{{count}} scan waiting to be sent",
      pending_other: "{{count}} scans waiting to be sent",
      empty: "Everything is sent.",
      sync: "Send now",
      syncing: "Sending…",
      stuck_one: "{{count}} scan needs attention",
      stuck_other: "{{count}} scans need attention",
      stuckHint:
        "The server rejected them and the list to clear up could not be stored on this device. Show them to the organiser before disconnecting the device.",
      retrying_one: "{{count}} scan waiting to be retried",
      retrying_other: "{{count}} scans waiting to be retried",
      retryingHint:
        "The last attempt failed. The scanner retries on its own - at least once a minute and right after the network returns. You can also retry now.",
      retry: "Retry",
      retryAll: "Retry all",
      codePrefix: "Code starts with {{prefix}}…",
      discard: "Remove from the queue",
      discardTitle: "Remove the scan from the queue?",
      discardDescription:
        "This scan will NOT reach the server: the person will have no recorded attendance and the partner will not get the lead. Only remove it when the organiser has decided so.",
      discardCancel: "Cancel",
      queuedToast: "No network - the scan is queued.",
      flushedToast_one: "Sent {{count}} scan from the queue.",
      flushedToast_other: "Sent {{count}} scans from the queue.",
    },

    offline: {
      rosterFresh_one: "Offline list: {{count}} person, as of {{time}}",
      rosterFresh_other: "Offline list: {{count}} people, as of {{time}}",
      rosterStale_one: "The offline list may be out of date: {{count}} person, as of {{time}}",
      rosterStale_other: "The offline list may be out of date: {{count}} people, as of {{time}}",
      rosterNone:
        "The offline list has not been downloaded yet - it will download when the device is online.",
      rosterSyncing: "Downloading the offline list…",
      rosterDisabled:
        "This device has no offline list - without a network scans only wait in the queue.",
      refresh: "Refresh the list",
      decisionHint:
        "Decision from the offline list (as of {{time}}) - the server confirms it when the network returns.",
      approximateCapacity: "Capacity cannot be checked without a network.",
      personFromRoster: "Details from the offline list",
    },

    readiness: {
      title: "Ready to work offline",
      shellReady: "The app is stored on the device",
      shellPartial: "The app is partly stored ({{cached}} of {{total}} files)",
      shellMissing: "The app is not stored yet - open the scanner once with a good signal",
      shellChecking: "Checking whether the app is stored…",
      rosterReady: "Offline list up to date",
      rosterNotReady: "No up-to-date offline list",
      rosterDisabled: "Offline list turned off by the organiser",
      queuePersistent: "The scan queue is stored on the device",
      queueMemoryOnly: "The scan queue lives only in this tab",
      storagePersisted: "The browser will not delete scanner data",
      storageNotPersisted: "The browser may delete scanner data when space runs low",
      storageUnknown: "This browser does not say whether it keeps scanner data",
      requestPersist: "Ask for persistent storage",
      persistGranted: "Scanner data is stored persistently.",
      persistDenied: "The browser refused persistent storage.",
    },

    sync: {
      title: "To clear up with the organiser",
      conflicts_one: "{{count}} offline decision conflict",
      conflicts_other: "{{count}} offline decision conflicts",
      rejected_one: "{{count}} scan rejected by the server",
      rejected_other: "{{count}} scans rejected by the server",
      kinds: {
        admittedOffline: "Admitted offline - the server refuses",
        deniedOffline: "Refused offline - the server would admit",
      },
      hint: "Rejected scans are NOT in the database. Download the file and hand it to the organiser before clearing the list.",
      exportCsv: "Download CSV",
      exportJson: "Download JSON",
      clear: "Clear the list",
      clearTitle: "Clear the list to clear up?",
      clearDescription:
        "Conflicts and rejected scans disappear from this device. Only do this after handing the file to the organiser.",
      cancel: "Cancel",
      flushedConflicts_one:
        "After sending: {{count}} offline decision conflict - check the list to clear up.",
      flushedConflicts_other:
        "After sending: {{count}} offline decision conflicts - check the list to clear up.",
      flushedRejected_one: "{{count}} scan rejected by the server - it is on the list to clear up.",
      flushedRejected_other:
        "{{count}} scans rejected by the server - they are on the list to clear up.",
      columns: {
        type: "Type",
        kind: "Kind",
        scannedAt: "Scan time",
        checkpoint: "Checkpoint",
        direction: "Direction",
        offlineOutcome: "Offline decision",
        serverResult: "Server result",
        person: "Person",
        registrationId: "Registration",
        code: "Code prefix",
        codeHash: "Code hash (SHA-256)",
        reference: "Reference",
        conflict: "conflict",
        rejected: "rejected",
      },
    },

    install: {
      title: "Install the scanner",
      body: "Add the scanner to your home screen - it starts without the address bar and works on a weak signal too.",
      action: "Install",
      dismiss: "Not now",
    },

    errors: {
      invalidDeviceToken: "This device code is not known. Ask the organiser for a new one.",
      deviceRevoked: "The credential was revoked. Ask the organiser for a new code.",
      deviceInactive: "The device is paused in the panel. Ask the organiser to resume it.",
      deviceExpired: "The device code has expired. Ask the organiser for a new one.",
      deviceLocked:
        "The device is temporarily locked after a run of unknown codes. Wait a moment and try again.",
      deviceScopeMissing: "This credential is not allowed to do that.",
      deviceCheckpointMismatch: "This device is pinned to another checkpoint.",
      checkpointNotFound: "This checkpoint does not exist in this event.",
      invalidPayload: "The scan is incomplete. Scan the code again.",
      invalidDirection: "Unknown direction of travel.",
      personNotFound: "This person does not exist in this organisation.",
      templateMissing: "This event has no default badge template.",
      templateNotInEvent: "This badge template belongs to another event.",
      rosterDisabled: "The organiser turned off the offline list for this device.",
      rosterThrottled: "The offline list was downloaded a moment ago. Try again in half a minute.",
      rosterResyncRequired: "The offline list needs a full download from scratch.",
      deviceTimeOutOfRange:
        "The scan is older than a week - the server will not accept it. Show it to the organiser.",
      outboxOverflow:
        "The queue on this device was full - this scan did not fit. Pass it on to the organiser.",
      deviceMismatch:
        "The scan was saved under another device code - it was not sent under the current one. Pass it on to the organiser.",
      outboxSealed:
        "The code of this scan cannot be read on this device (it was saved under another device code or without encryption). Pass the scan on to the organiser - the file carries the code hash.",
      rateLimited: "The server asks for a short break. The scan is queued and goes out on its own.",
      tooManyRequests:
        "The server asks for a short break. The scan is queued and goes out on its own.",
      offline: "No network. The scan is queued and goes out when the signal returns.",
      unknown: "Something went wrong. Please try again.",
    },
  },
};

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventScannerPl, true, true);
  i18n.addResourceBundle("en", "translation", eventScannerEn, true, true);
}
ensureI18n();
