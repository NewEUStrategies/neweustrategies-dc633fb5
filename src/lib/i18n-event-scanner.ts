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
//   * `event_checkins.result` -> `eventScanner.outcomes.*` (sześć wartości
//     z ograniczenia CHECK, plus `repeat`, `unknown_code` i `wrong_event`,
//     które są WYNIKAMI RPC, a nie wierszami dziennika),
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
        "Kod zniknie z tego telefonu. Skany czekające w kolejce zostaną wysłane wcześniej.",
      online: "Sieć dostępna",
      offline: "Brak sieci - skany czekają w kolejce",
      memoryOnly:
        "Ta przeglądarka nie pozwala zapisać kolejki na urządzeniu. Nie zamykaj karty, dopóki kolejka nie jest pusta.",
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
      saved: "Zapisano",
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
      previousCheckin: "Poprzednia odprawa: {{when}}",
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
        "Nie udało się ich wysłać mimo wielu prób. Pokaż je organizatorowi przed odłączeniem urządzenia.",
      discard: "Usuń z kolejki",
      queuedToast: "Brak sieci - skan czeka w kolejce.",
      flushedToast_one: "Wysłano {{count}} skan z kolejki.",
      flushedToast_few: "Wysłano {{count}} skany z kolejki.",
      flushedToast_many: "Wysłano {{count}} skanów z kolejki.",
      flushedToast_other: "Wysłano {{count}} skanów z kolejki.",
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
        "The code leaves this phone. Scans waiting in the queue are sent before that happens.",
      online: "Network available",
      offline: "No network - scans are queued",
      memoryOnly:
        "This browser will not let us store the queue on the device. Keep the tab open until the queue is empty.",
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
      previousCheckin: "Previous check-in: {{when}}",
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
        "They could not be sent despite many attempts. Show them to the organiser before disconnecting the device.",
      discard: "Remove from the queue",
      queuedToast: "No network - the scan is queued.",
      flushedToast_one: "Sent {{count}} scan from the queue.",
      flushedToast_other: "Sent {{count}} scans from the queue.",
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
      offline: "No network. The scan is queued and goes out when the signal returns.",
      unknown: "Something went wrong. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", eventScannerPl, true, true);
i18n.addResourceBundle("en", "translation", eventScannerEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy landował
 * w eager-owym grafie wejściowym każdej strony.
 */
export function ensureI18n(): void {}
