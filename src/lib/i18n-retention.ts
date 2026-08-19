// Zasoby i18n przepływu retencji (dialog przy anulowaniu subskrypcji):
// ankieta powodu, kontrofertka rabatowa i ekran z kodem kuponu.
import i18n from "@/lib/i18n";

const retentionPl = {
  retention: {
    title: "Zanim odejdziesz...",
    subtitle: "Powiedz nam, dlaczego rezygnujesz - to zajmie chwilę i pomoże nam ulepszać serwis.",
    reasonHeading: "Powód rezygnacji",
    otherReason: "Inny powód",
    commentLabel: "Chcesz dodać coś od siebie? (opcjonalnie)",
    commentPlaceholder: "Co moglibyśmy zrobić lepiej?",
    continue: "Dalej",
    keep: "Zostaję jednak",
    offer: {
      title: "Mamy dla Ciebie propozycję",
      // LICZEBNIKI. Polski ma trzy formy mnogie, więc „na kolejne 1 płatności"
      // to błąd widoczny dla klienta w chwili, gdy próbujemy go zatrzymać.
      // Zmienna nazywa się `count`, bo po niej i18next wybiera formę.
      body_one: "Zostań z nami: {{pct}}% rabatu na kolejną {{count}} płatność.",
      body_few: "Zostań z nami: {{pct}}% rabatu na kolejne {{count}} płatności.",
      body_many: "Zostań z nami: {{pct}}% rabatu na kolejne {{count}} płatności.",
      body_other: "Zostań z nami: {{pct}}% rabatu na kolejne {{count}} płatności.",
      hint_one:
        "Kod działa w checkoutcie przez {{count}} dzień - przy odnowieniu, zmianie planu, także przy przejściu na plan roczny.",
      hint_few:
        "Kod działa w checkoutcie przez {{count}} dni - przy odnowieniu, zmianie planu, także przy przejściu na plan roczny.",
      hint_many:
        "Kod działa w checkoutcie przez {{count}} dni - przy odnowieniu, zmianie planu, także przy przejściu na plan roczny.",
      hint_other:
        "Kod działa w checkoutcie przez {{count}} dni - przy odnowieniu, zmianie planu, także przy przejściu na plan roczny.",
      accept: "Zostaję z rabatem -{{pct}}%",
      declineAndCancel: "Anuluj subskrypcję mimo to",
      downgradeHint: "Wolisz po prostu niższy plan?",
      downgradeCta: "Zobacz plany",
      alreadyRedeemed:
        "Kontrofertka była już niedawno wykorzystana na Twoim koncie - możemy ją zaproponować ponownie za jakiś czas.",
    },
    accepted: {
      title: "Świetnie, że zostajesz!",
      body_one: "Twój personalny kod rabatowy -{{pct}}% (ważny do {{date}}, do {{count}} użycia):",
      body_few: "Twój personalny kod rabatowy -{{pct}}% (ważny do {{date}}, do {{count}} użyć):",
      body_many: "Twój personalny kod rabatowy -{{pct}}% (ważny do {{date}}, do {{count}} użyć):",
      body_other: "Twój personalny kod rabatowy -{{pct}}% (ważny do {{date}}, do {{count}} użyć):",
      copy: "Kopiuj kod",
      copied: "Skopiowano kod",
      where: "Kod wpiszesz w polu kuponu podczas płatności w checkoutcie.",
      close: "Zamknij",
    },
    errors: {
      submit: "Nie udało się zapisać. Spróbuj ponownie.",
      offer: "Nie udało się przygotować oferty. Spróbuj ponownie.",
      // Anulowanie NIE przeszło u operatora. Komunikat musi być jednoznaczny:
      // subskrypcja DALEJ jest aktywna, a więc dalej będzie obciążana.
      cancel:
        "Nie udało się anulować subskrypcji - jest nadal aktywna. Spróbuj ponownie albo napisz do nas.",
    },
  },
};

/**
 * Angielski nie powtarza polskich form `_few`/`_many` - i18next dla `en` ich nie
 * użyje, więc typ jest tu ROZLUŹNIONY o same klucze liczebnikowe. Parytet
 * pozostałych kluczy dalej pilnuje typ (`Omit`) i bramka `check:i18n-parity`.
 */
type RetentionEn = {
  retention: Omit<(typeof retentionPl)["retention"], "offer" | "accepted"> & {
    offer: Omit<
      (typeof retentionPl)["retention"]["offer"],
      "body_few" | "body_many" | "hint_few" | "hint_many"
    >;
    accepted: Omit<(typeof retentionPl)["retention"]["accepted"], "body_few" | "body_many">;
  };
};

const retentionEn: RetentionEn = {
  retention: {
    title: "Before you go...",
    subtitle: "Tell us why you are leaving - it takes a moment and helps us improve.",
    reasonHeading: "Reason for cancelling",
    otherReason: "Another reason",
    commentLabel: "Anything you would like to add? (optional)",
    commentPlaceholder: "What could we do better?",
    continue: "Continue",
    keep: "I will stay after all",
    offer: {
      title: "We have an offer for you",
      // Angielski ma DWIE formy, więc nie powtarzamy `_few`/`_many` -
      // i18next ich dla `en` nie użyje (ta sama konwencja co w modułach
      // społeczności, patrz i18n-admin-community-events).
      body_one: "Stay with us: {{pct}}% off your next {{count}} payment.",
      body_other: "Stay with us: {{pct}}% off your next {{count}} payments.",
      hint_one:
        "The code works at checkout for {{count}} day - on renewal, on a plan change, including switching to annual.",
      hint_other:
        "The code works at checkout for {{count}} days - on renewal, on a plan change, including switching to annual.",
      accept: "Stay with -{{pct}}% off",
      declineAndCancel: "Cancel the subscription anyway",
      downgradeHint: "Would a lower plan suit you better?",
      downgradeCta: "See the plans",
      alreadyRedeemed:
        "A retention offer was already used on your account recently - we can offer it again after a while.",
    },
    accepted: {
      title: "Great to have you stay!",
      body_one: "Your personal -{{pct}}% code (valid until {{date}}, up to {{count}} use):",
      body_other: "Your personal -{{pct}}% code (valid until {{date}}, up to {{count}} uses):",
      copy: "Copy code",
      copied: "Code copied",
      where: "Enter the code in the coupon field during checkout.",
      close: "Close",
    },
    errors: {
      submit: "Saving failed. Please try again.",
      offer: "We could not prepare the offer. Please try again.",
      cancel:
        "We could not cancel the subscription - it is still active, so it will still be billed. Please try again or contact us.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", retentionPl, true, true);
i18n.addResourceBundle("en", "translation", retentionEn, true, true);

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu -
 * rejestracja słowników przy ewaluacji chunka, jak w pozostałych lib/i18n-*.
 */
export function ensureI18n(): void {}
