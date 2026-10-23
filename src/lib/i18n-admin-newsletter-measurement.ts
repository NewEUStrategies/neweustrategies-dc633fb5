// i18n panelu newslettera - TREŚĆ ZGODY I POMIAR OTWARĆ I KLIKNIĘĆ (I9d-Y2,
// decyzje właściciela 2026-10-20 „tak, uzupełnij"; I9d-Y2b, decyzje
// 2026-10-23: D1 wariant (b) - każda zgoda ma osobne pole, D2 - pomiar tylko
// dla skrzynki potwierdzonej przez jej właściciela).
//
// Trzy powierzchnie, jeden słownik (ładowany WYŁĄCZNIE w leniwych chunkach
// panelu, nigdy z pliku trasy):
//   * `consent` - edycja treści zgody na newsletter PL/EN (bez pomiaru),
//     ostrzeżenie, gdy własny tekst wspomina pomiar, i sekcja tylko do
//     odczytu z treścią i wersją OSOBNEGO pola zgody na pomiar;
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
        "Tekst pod formularzami zapisu (formularz w treści strony, kreator formularzy, popup newslettera). Treść zgody na newsletter nie dotyczy pomiaru otwarć i kliknięć - pomiar ma osobne, domyślnie niezaznaczone pole z własną treścią.",
      fieldPl: "Treść zgody - polski",
      fieldEn: "Treść zgody - angielski",
      hint: "Dozwolony HTML z linkami. Puste pole = treść domyślna (podpowiedź w polu). Nie opisuj pomiaru w treści zgody na newsletter - zgoda na pomiar ma osobne pole.",
      reset: "Przywróć domyślną",
      save: "Zapisz treść zgody",
      saving: "Zapisywanie…",
      saved: "Zapisano treść zgody.",
      unsaved: "Niezapisane zmiany",
      previewLabel: "Tak zobaczy ją czytelnik:",
      status: {
        default: "Treść domyślna (wersja {{version}}).",
        custom: "Treść własna.",
      },
      mentionsMeasurement:
        "Ten tekst wspomina pomiar otwarć i kliknięć. Opis pomiaru należy do osobnego pola zgody na pomiar: zapis z formularza nie daje zgody na pomiar, a czytelnik mógłby uznać, że ją wyraża. Usuń opis pomiaru albo przywróć treść domyślną.",
      state: {
        loading: "Wczytywanie treści zgody…",
        loadError: "Nie udało się wczytać treści zgody.",
      },
      measurement: {
        title: "Zgoda na pomiar otwarć i kliknięć - osobne pole",
        version: "Wersja treści: {{version}}",
        note: "Pole pojawia się automatycznie pod zgodą na newsletter we wszystkich formularzach, domyślnie niezaznaczone. Pomiar działa dopiero, gdy właściciel adresu potwierdzi zgodę przyciskiem na stronie z linku w e-mailu.",
        fixedNote:
          "Treść pola jest stała i wersjonowana - nie edytuje się jej w panelu, bo dowód zgody musi wskazywać jedną treść.",
        previewLabel: "Treść pola, którą widzi czytelnik:",
        langPl: "Polski",
        langEn: "Angielski",
      },
    },
    request: {
      title: "Zgoda na pomiar otwarć i kliknięć",
      subtitle:
        "Subskrybenci bez zgody na pomiar (np. zapisani przed osobnym polem). Prośba dotyczy osobnej zgody na pomiar; brak odpowiedzi niczego nie zmienia. Piksel i linki z identyfikatorem dostają wyłącznie aktywni subskrybenci, którzy sami potwierdzili tę zgodę.",
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
      progressTitle: "Prośby z panelu dla wersji treści {{version}}",
      progress: {
        requested: "Zlecone",
        pending: "W kolejce",
        mailed: "Wysłane",
        blocked: "Zablokowane listą wyłączeń",
        skipped: "Pominięte (zgoda innym kanałem, odmowa albo wypis)",
        failed: "Nieudane",
        confirmed: "Potwierdzone",
      },
      lastRequested: "Ostatnie zlecenie: {{date}}",
      button: "Poproś o zgodę na pomiar",
      none: "Nie ma subskrybentów, do których można wysłać prośbę - wszyscy mają zgodę na pomiar, dostali już prośbę o nią albo sami odmówili pomiaru.",
      originNote:
        "Prośby wysyłane automatycznie po zapisie z zaznaczonym polem pomiaru (bez double opt-in) nie są tu liczone - mają własny dzienny limit i stałą treść.",
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
        "Treść jednorazowej prośby do subskrybentów bez zgody na pomiar. Puste pole = treść domyślna; treść zgody na pomiar, przycisk i link wypisu dokłada system. Prośba wysyłana po zapisie z zaznaczonym polem pomiaru ma stałą treść - ta edycja jej nie dotyczy.",
      tokens: "Zmienne: {{tokens}} - imię subskrybenta.",
      saved: "Zapisano treść prośby o zgodę na pomiar.",
      saveError: "Nie udało się zapisać treści prośby o zgodę na pomiar.",
      conflict:
        "Ktoś zapisał treść prośby o zgodę na pomiar w innej karcie. Twoje zmiany zostały w edytorze - sprawdź je i zapisz ponownie, aby nadpisać tamtą wersję.",
      previewFrame: "Podgląd maila z prośbą o zgodę na pomiar",
      previewNote:
        "Pod przyciskiem mail pokazuje treść zgody na pomiar, którą zapisze kliknięcie. Podgląd z przykładowym imieniem; przyciski w podglądzie są nieaktywne.",
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
        "The wording under sign-up forms (the form in page content, the form builder, the newsletter popup). The newsletter consent wording does not cover measuring opens and clicks - measurement has its own unticked box with its own text.",
      fieldPl: "Consent wording - Polish",
      fieldEn: "Consent wording - English",
      hint: "HTML with links is allowed. An empty field uses the default wording (shown as the field hint). Do not describe measurement in the newsletter consent wording - consent to measurement has its own box.",
      reset: "Restore default",
      save: "Save consent wording",
      saving: "Saving…",
      saved: "Consent wording saved.",
      unsaved: "Unsaved changes",
      previewLabel: "What the reader will see:",
      status: {
        default: "Default wording (version {{version}}).",
        custom: "Own wording.",
      },
      mentionsMeasurement:
        "This wording mentions measuring opens and clicks. A description of measurement belongs to the separate consent to measurement box: signing up with the form does not give consent to measurement, yet a reader could think it does. Remove the description of measurement or restore the default wording.",
      state: {
        loading: "Loading the consent wording…",
        loadError: "Could not load the consent wording.",
      },
      measurement: {
        title: "Consent to measuring opens and clicks - its own box",
        version: "Wording version: {{version}}",
        note: "The box appears automatically under the newsletter consent in every form, unticked by default. Measurement works only once the owner of the address confirms the consent with the button on the page opened from a link in an email.",
        fixedNote:
          "The box wording is set in code and versioned - it is not edited in the panel, because proof of consent must point to one wording.",
        previewLabel: "The box wording the reader sees:",
        langPl: "Polish",
        langEn: "English",
      },
    },
    request: {
      title: "Consent to measuring opens and clicks",
      subtitle:
        "Subscribers without consent to measurement (for example, signed up before the separate box). The request is about the separate consent to measurement; not answering changes nothing. Only active subscribers who confirmed this consent themselves get the pixel and links with an identifier.",
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
      progressTitle: "Panel requests for wording version {{version}}",
      progress: {
        requested: "Requested",
        pending: "Queued",
        mailed: "Sent",
        blocked: "Stopped by the suppression list",
        skipped: "Skipped (consent through another channel, declined or unsubscribed)",
        failed: "Failed",
        confirmed: "Confirmed",
      },
      lastRequested: "Last request: {{date}}",
      button: "Ask for measurement consent",
      none: "There is nobody to ask - every subscriber has consented to measurement, has already been asked for it or declined measurement themselves.",
      originNote:
        "Requests sent automatically after a sign-up with the measurement box ticked (without double opt-in) are not counted here - they have their own daily limit and unchangeable wording.",
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
        "The wording of the one-off request to subscribers without consent to measurement. An empty field uses the default text; the system adds the measurement consent wording, the button and the unsubscribe link. The request sent after a sign-up with the measurement box ticked has unchangeable wording - this editor does not affect it.",
      tokens: "Variables: {{tokens}} - the subscriber's first name.",
      saved: "Measurement consent request text saved.",
      saveError: "Could not save the measurement consent request text.",
      conflict:
        "Someone saved the measurement consent request text in another tab. Your changes stayed in the editor - check them and save again to overwrite that version.",
      previewFrame: "Preview of the measurement consent request email",
      previewNote:
        "Under the button the email shows the measurement consent wording a click will record. Preview with a sample first name; buttons in the preview do nothing.",
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
