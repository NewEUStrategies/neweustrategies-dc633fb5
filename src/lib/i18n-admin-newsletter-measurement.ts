// i18n panelu newslettera - TREŚĆ ZGODY I POMIAR OTWARĆ I KLIKNIĘĆ (I9d-Y2,
// decyzje właściciela 2026-10-20 „tak, uzupełnij" i 2026-10-21, wariant (a)).
//
// Trzy powierzchnie, jeden słownik (ładowany WYŁĄCZNIE w leniwych chunkach
// panelu, nigdy z pliku trasy):
//   * `consent` - edycja treści zgody na newsletter PL/EN z ostrzeżeniem,
//     gdy własny tekst nie obejmuje pomiaru, i z jawnym oznaczeniem admina
//     „mój tekst obejmuje pomiar" (zamiast heurystyki słów);
//   * `request` - „Poproś o zgodę na pomiar" (podgląd liczby, potwierdzenie,
//     stan wysyłki) i wspólny przełącznik pomiaru ścieżek i kampanii
//     (Z-I9c-09);
//   * `copy` - treść jednorazowego maila z prośbą (edytor wspólny z prośbą
//     wygaszania - etykiety pól bierze z jej słownika).
//
// PARYTET W TYPIE: `const en: typeof pl` - brak klucza EN to błąd kompilacji.
// Formy `_few`/`_many` istnieją w EN tylko dlatego, że wymaga ich typ.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej są dobrane tak, żeby żadne nie było nazwą klasy (test
// `i18nNewsletterMeasurement.test.ts`).
import i18n from "@/lib/i18n";

const pl = {
  adminNewsletterMeasurement: {
    retry: "Spróbuj ponownie",
    consent: {
      title: "Treść zgody na newsletter",
      subtitle:
        "Tekst przy formularzach zapisu (formularz w treści strony, kreator formularzy, popup newslettera). Puste pole = treść domyślna w wersji {{version}}: mówi o pomiarze otwarć i kliknięć, jego celu, osobnym wyłączeniu pomiaru i wycofaniu zgody.",
      fieldPl: "Treść zgody - polski",
      fieldEn: "Treść zgody - angielski",
      hint: "Dozwolony HTML z linkami. Puste pole = treść domyślna (podpowiedź w polu).",
      reset: "Przywróć domyślną",
      save: "Zapisz treść zgody",
      saving: "Zapisywanie…",
      saved: "Zapisano treść zgody.",
      unsaved: "Niezapisane zmiany",
      previewLabel: "Tak zobaczy ją czytelnik:",
      status: {
        default: "Treść domyślna - obejmuje pomiar otwarć i kliknięć.",
        marked: "Własny tekst oznaczony jako obejmujący pomiar ({{date}}).",
        uncovered:
          "Własny tekst nie obejmuje pomiaru: osoby zapisane tym formularzem dostaną newsletter bez pomiaru otwarć i kliknięć. Przywróć treść domyślną albo uzupełnij tekst i oznacz go.",
        stale: "Tekst zmieniono po oznaczeniu - oznaczenie przestało działać.",
        draftCustom:
          "Po zapisie własny tekst nie obejmie pomiaru, dopóki administrator go nie oznaczy.",
      },
      state: {
        loading: "Sprawdzanie treści zgody…",
        readError: "Nie udało się sprawdzić, czy treść zgody obejmuje pomiar.",
        unavailable:
          "Sprawdzanie treści zgody zadziała po wdrożeniu migracji pomiaru (20261020162300-162500).",
      },
      mark: {
        label: "Mój tekst obejmuje pomiar otwarć i kliknięć",
        hint: "Oznacz tylko tekst, który mówi, że wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia, podaje cel (dopasowanie treści i częstotliwości, statystyka), że pomiar można wyłączyć osobno bez rezygnacji z newslettera i że zgodę można wycofać w każdej chwili. Oznaczenie dotyczy zapisanego tekstu - każda zmiana tekstu je unieważnia.",
        saveFirst: "Zapisz tekst, zanim go oznaczysz.",
        adminOnly: "Oznaczenie zmienia wyłącznie administrator.",
        marked: "Oznaczono tekst jako obejmujący pomiar.",
        unmarked: "Zdjęto oznaczenie tekstu.",
        error: "Nie udało się zapisać oznaczenia.",
      },
    },
    request: {
      title: "Zgoda na pomiar otwarć i kliknięć",
      subtitle:
        "Piksel i linki z identyfikatorem odbiorcy dostają wyłącznie osoby ze zgodą obejmującą pomiar. Subskrybenci zapisani przed treścią z pomiarem mogą ją wyrazić jednym kliknięciem w mailu z prośbą.",
      switchLabel: "Mierz otwarcia i kliknięcia (ścieżki i kampanie)",
      switchHint:
        "Wspólny przełącznik maili ścieżek i kampanii newslettera - ten sam w ustawieniach silnika ścieżek i w karcie „Retencja danych”. Włączony: pomiar tylko u odbiorców ze zgodą. Wyłączony: żaden mail nie ma piksela ani linków z identyfikatorem, a otwarcia i kliknięcia nie są zapisywane.",
      switchSaved: "Zapisano ustawienie pomiaru.",
      switchError: "Nie udało się zapisać ustawienia pomiaru.",
      switchConflict:
        "Ktoś zmienił ustawienia silnika w międzyczasie - wczytaliśmy aktualny stan. Spróbuj ponownie.",
      disabledNote:
        "Pomiar jest wyłączony: zgody zapiszemy, ale piksel i linki z identyfikatorem pojawią się dopiero po włączeniu przełącznika.",
      stats: {
        subscribers: "Aktywni subskrybenci",
        withConsent: "Ze zgodą na pomiar",
        candidates: "Do prośby",
        suppressed: "Na liście wyłączeń (bez prośby)",
      },
      progressTitle: "Prośby dla wersji treści {{version}}",
      progress: {
        requested: "Zlecone",
        pending: "W kolejce",
        mailed: "Wysłane",
        blocked: "Zablokowane listą wyłączeń",
        skipped: "Pominięte (zgoda innym kanałem albo wypis)",
        failed: "Nieudane",
        confirmed: "Potwierdzone",
      },
      lastRequested: "Ostatnie zlecenie: {{date}}",
      button: "Poproś o zgodę na pomiar",
      none: "Nie ma subskrybentów, do których można wysłać prośbę - wszyscy mają zgodę, dostali prośbę o tę wersję albo sami wyłączyli pomiar.",
      confirmTitle: "Wysłać prośbę o zgodę na pomiar?",
      confirmBody_one:
        "Wyślemy jednorazowy mail do {{count}} subskrybenta w jego języku - między 8:00 a 18:00 czasu polskiego, najwyżej {{cap}} maili dziennie (limit wspólny z prośbami o potwierdzenie subskrypcji). Link jest ważny {{days}} dni. Brak reakcji niczego nie zmienia: newsletter przychodzi dalej, bez pomiaru.",
      confirmBody_few:
        "Wyślemy jednorazowy mail do {{count}} subskrybentów w ich języku - między 8:00 a 18:00 czasu polskiego, najwyżej {{cap}} maili dziennie (limit wspólny z prośbami o potwierdzenie subskrypcji). Link jest ważny {{days}} dni. Brak reakcji niczego nie zmienia: newsletter przychodzi dalej, bez pomiaru.",
      confirmBody_many:
        "Wyślemy jednorazowy mail do {{count}} subskrybentów w ich języku - między 8:00 a 18:00 czasu polskiego, najwyżej {{cap}} maili dziennie (limit wspólny z prośbami o potwierdzenie subskrypcji). Link jest ważny {{days}} dni. Brak reakcji niczego nie zmienia: newsletter przychodzi dalej, bez pomiaru.",
      confirmBody_other:
        "Wyślemy jednorazowy mail do {{count}} subskrybenta w jego języku - między 8:00 a 18:00 czasu polskiego, najwyżej {{cap}} maili dziennie (limit wspólny z prośbami o potwierdzenie subskrypcji). Link jest ważny {{days}} dni. Brak reakcji niczego nie zmienia: newsletter przychodzi dalej, bez pomiaru.",
      confirm: "Wyślij prośbę",
      cancel: "Anuluj",
      started_one: "Zlecono prośbę do {{count}} subskrybenta.",
      started_few: "Zlecono prośbę do {{count}} subskrybentów.",
      started_many: "Zlecono prośbę do {{count}} subskrybentów.",
      started_other: "Zlecono prośbę do {{count}} subskrybenta.",
      startedNone: "Prośby dla tej wersji treści są już zlecone - nikt nowy nie dostanie maila.",
      conflict:
        "Liczba subskrybentów do prośby zmieniła się od podglądu - sprawdź nową liczbę i potwierdź ponownie.",
      error: "Nie udało się zlecić prośby.",
      forbidden: "Prośbę o zgodę na pomiar zleca wyłącznie administrator.",
      unavailable:
        "Prośba o zgodę na pomiar zadziała po wdrożeniu migracji pomiaru (20261020162300-162500).",
      loading: "Wczytywanie stanu zgód na pomiar…",
      readError: "Nie udało się wczytać stanu zgód na pomiar.",
      copyLink: "Edytuj treść maila z prośbą",
      sunsetNote:
        "Subskrybent bez zgody na pomiar nie generuje otwarć ani kliknięć - wygaszanie nieaktywnych obejmie go jedną prośbą o potwierdzenie subskrypcji.",
    },
    copy: {
      title: "Prośba o zgodę na pomiar otwarć i kliknięć",
      subtitle:
        "Jednorazowy mail z panelu newslettera do subskrybentów ze zgodą sprzed treści z pomiarem. Puste pole = treść domyślna; treść zgody, przycisk „Zgadzam się na pomiar” i link wypisu dokłada system.",
      tokens: "Zmienne: {{tokens}} - imię subskrybenta.",
      saved: "Zapisano treść prośby o zgodę na pomiar.",
      saveError: "Nie udało się zapisać treści prośby o zgodę na pomiar.",
      conflict:
        "Ktoś zapisał treść prośby o zgodę na pomiar w innej karcie. Twoje zmiany zostały w edytorze - sprawdź je i zapisz ponownie, aby nadpisać tamtą wersję.",
      previewFrame: "Podgląd maila z prośbą o zgodę na pomiar",
      previewNote:
        "Podgląd z przykładowym imieniem i treścią zgody, którą zapisze kliknięcie; przyciski w podglądzie są nieaktywne.",
      loading: "Wczytywanie treści prośby o zgodę na pomiar…",
      readError: "Nie udało się wczytać treści prośby o zgodę na pomiar.",
      forbidden: "Treść prośby o zgodę na pomiar zmienia wyłącznie administrator.",
      unavailable:
        "Prośba o zgodę na pomiar nie jest jeszcze wdrożona w tej bazie - edycja treści zadziała po wdrożeniu.",
    },
  },
};

const en: typeof pl = {
  adminNewsletterMeasurement: {
    retry: "Try again",
    consent: {
      title: "Newsletter consent wording",
      subtitle:
        "The wording next to sign-up forms (the form in page content, the form builder, the newsletter popup). An empty field uses the default wording, version {{version}}: it covers measuring opens and clicks, its purpose, switching off the measurement separately and withdrawing consent.",
      fieldPl: "Consent wording - Polish",
      fieldEn: "Consent wording - English",
      hint: "HTML with links is allowed. An empty field uses the default wording (shown as the field hint).",
      reset: "Restore default",
      save: "Save consent wording",
      saving: "Saving…",
      saved: "Consent wording saved.",
      unsaved: "Unsaved changes",
      previewLabel: "What the reader will see:",
      status: {
        default: "Default wording - covers measuring opens and clicks.",
        marked: "Own wording marked as covering the measurement ({{date}}).",
        uncovered:
          "Own wording does not cover the measurement: people who sign up with this form will get the newsletter without measuring opens and clicks. Restore the default wording, or extend your text and mark it.",
        stale: "The wording changed after it was marked - the mark no longer applies.",
        draftCustom:
          "Once saved, your own wording will not cover the measurement until an administrator marks it.",
      },
      state: {
        loading: "Checking the consent wording…",
        readError: "Could not check whether the consent wording covers the measurement.",
        unavailable:
          "Checking the consent wording will work once the measurement migrations (20261020162300-162500) are deployed.",
      },
      mark: {
        label: "My wording covers measuring opens and clicks",
        hint: "Mark only wording that says emails may contain elements that measure opens and clicks, states the purpose (tailoring content and frequency, statistics), that the measurement can be switched off separately without unsubscribing, and that consent can be withdrawn at any time. The mark applies to the saved wording - any change to the text cancels it.",
        saveFirst: "Save the wording before marking it.",
        adminOnly: "Only an administrator changes the mark.",
        marked: "Wording marked as covering the measurement.",
        unmarked: "Mark removed.",
        error: "Could not save the mark.",
      },
    },
    request: {
      title: "Consent to measuring opens and clicks",
      subtitle:
        "Only people whose consent covers the measurement get the pixel and links with a recipient identifier. Subscribers who signed up before the wording with measurement can give it with one click in a request email.",
      switchLabel: "Measure opens and clicks (journeys and campaigns)",
      switchHint:
        "One switch for journey emails and newsletter campaigns - the same one as in the journey engine settings and on the “Data retention” card. On: measurement only for recipients who consented. Off: no email carries the pixel or links with an identifier, and opens and clicks are not recorded.",
      switchSaved: "Measurement setting saved.",
      switchError: "Could not save the measurement setting.",
      switchConflict:
        "Someone changed the engine settings in the meantime - we loaded the current state. Please try again.",
      disabledNote:
        "Measurement is off: consents will be recorded, but the pixel and links with an identifier appear only once the switch is on.",
      stats: {
        subscribers: "Active subscribers",
        withConsent: "With measurement consent",
        candidates: "To be asked",
        suppressed: "On the suppression list (not asked)",
      },
      progressTitle: "Requests for wording version {{version}}",
      progress: {
        requested: "Requested",
        pending: "Queued",
        mailed: "Sent",
        blocked: "Stopped by the suppression list",
        skipped: "Skipped (consent through another channel or unsubscribed)",
        failed: "Failed",
        confirmed: "Confirmed",
      },
      lastRequested: "Last request: {{date}}",
      button: "Ask for measurement consent",
      none: "There is nobody to ask - every subscriber has consented, has already been asked about this version or switched the measurement off.",
      confirmTitle: "Send the measurement consent request?",
      confirmBody_one:
        "We will send a one-off email to {{count}} subscriber in their language - between 8:00 and 18:00 Polish time, at most {{cap}} emails a day (a limit shared with subscription confirmation requests). The link is valid for {{days}} days. No reply changes nothing: the newsletter keeps coming, without measurement.",
      confirmBody_few:
        "We will send a one-off email to {{count}} subscribers in their language - between 8:00 and 18:00 Polish time, at most {{cap}} emails a day (a limit shared with subscription confirmation requests). The link is valid for {{days}} days. No reply changes nothing: the newsletter keeps coming, without measurement.",
      confirmBody_many:
        "We will send a one-off email to {{count}} subscribers in their language - between 8:00 and 18:00 Polish time, at most {{cap}} emails a day (a limit shared with subscription confirmation requests). The link is valid for {{days}} days. No reply changes nothing: the newsletter keeps coming, without measurement.",
      confirmBody_other:
        "We will send a one-off email to {{count}} subscribers in their language - between 8:00 and 18:00 Polish time, at most {{cap}} emails a day (a limit shared with subscription confirmation requests). The link is valid for {{days}} days. No reply changes nothing: the newsletter keeps coming, without measurement.",
      confirm: "Send the request",
      cancel: "Cancel",
      started_one: "Request queued for {{count}} subscriber.",
      started_few: "Request queued for {{count}} subscribers.",
      started_many: "Request queued for {{count}} subscribers.",
      started_other: "Request queued for {{count}} subscribers.",
      startedNone:
        "Requests for this wording version are already queued - nobody new will get an email.",
      conflict:
        "The number of subscribers to ask changed since the preview - check the new number and confirm again.",
      error: "Could not queue the request.",
      forbidden: "Only an administrator can send the measurement consent request.",
      unavailable:
        "The measurement consent request will work once the measurement migrations (20261020162300-162500) are deployed.",
      loading: "Loading measurement consent status…",
      readError: "Could not load the measurement consent status.",
      copyLink: "Edit the request email",
      sunsetNote:
        "A subscriber without measurement consent produces no opens or clicks - the inactive subscriber sunset will reach them with a single subscription confirmation request.",
    },
    copy: {
      title: "Request for consent to measuring opens and clicks",
      subtitle:
        "A one-off email from the newsletter panel to subscribers whose consent predates the wording with measurement. An empty field uses the default text; the system adds the consent wording, the “I agree to the measurement” button and the unsubscribe link.",
      tokens: "Variables: {{tokens}} - the subscriber's first name.",
      saved: "Measurement consent request text saved.",
      saveError: "Could not save the measurement consent request text.",
      conflict:
        "Someone saved the measurement consent request text in another tab. Your changes stayed in the editor - check them and save again to overwrite that version.",
      previewFrame: "Preview of the measurement consent request email",
      previewNote:
        "Preview with a sample first name and the consent wording a click will record; buttons in the preview do nothing.",
      loading: "Loading the measurement consent request text…",
      readError: "Could not load the measurement consent request text.",
      forbidden: "Only an administrator changes the measurement consent request text.",
      unavailable:
        "The measurement consent request is not deployed in this database yet - editing will work after deployment.",
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i rozjazdu ładują nakładki globem i liczą na efekt importu.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
