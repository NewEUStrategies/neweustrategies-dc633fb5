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
      body: "Zostań z nami: {{pct}}% rabatu na kolejne {{periods}} płatności.",
      hint: "Kod działa w checkoutcie przez {{days}} dni - przy odnowieniu, zmianie planu, także przy przejściu na plan roczny.",
      accept: "Zostaję z rabatem -{{pct}}%",
      declineAndCancel: "Anuluj subskrypcję mimo to",
      downgradeHint: "Wolisz po prostu niższy plan?",
      downgradeCta: "Zobacz plany",
      alreadyRedeemed:
        "Kontrofertka była już niedawno wykorzystana na Twoim koncie - możemy ją zaproponować ponownie za jakiś czas.",
    },
    accepted: {
      title: "Świetnie, że zostajesz!",
      body: "Twój personalny kod rabatowy -{{pct}}% (ważny do {{date}}, do {{periods}} użyć):",
      copy: "Kopiuj kod",
      copied: "Skopiowano kod",
      where: "Kod wpiszesz w polu kuponu podczas płatności w checkoutcie.",
      close: "Zamknij",
    },
    errors: {
      submit: "Nie udało się zapisać. Spróbuj ponownie.",
      offer: "Nie udało się przygotować oferty. Spróbuj ponownie.",
    },
  },
};

const retentionEn: typeof retentionPl = {
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
      body: "Stay with us: {{pct}}% off your next {{periods}} payments.",
      hint: "The code works at checkout for {{days}} days - on renewal, on a plan change, including switching to annual.",
      accept: "Stay with -{{pct}}% off",
      declineAndCancel: "Cancel the subscription anyway",
      downgradeHint: "Would a lower plan suit you better?",
      downgradeCta: "See the plans",
      alreadyRedeemed:
        "A retention offer was already used on your account recently - we can offer it again after a while.",
    },
    accepted: {
      title: "Great to have you stay!",
      body: "Your personal -{{pct}}% code (valid until {{date}}, up to {{periods}} uses):",
      copy: "Copy code",
      copied: "Code copied",
      where: "Enter the code in the coupon field during checkout.",
      close: "Close",
    },
    errors: {
      submit: "Saving failed. Please try again.",
      offer: "We could not prepare the offer. Please try again.",
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
