// Bundle i18n dla przycisku "Direct Message" na profilach eksperckich i
// zwykłych użytkowników. Trzymamy jako osobny plik, żeby nie kolidować
// z parity-testem `i18n-chat` (który sprawdza równość drzew PL/EN dla czatu).
import i18n from "./i18n";

export const directMessagePl = {
  directMessage: {
    button: "Napisz wiadomość",
    opening: "Otwieram rozmowę…",
    ariaLabel: "Napisz wiadomość do {{name}}",
    ariaBusy: "Otwieranie rozmowy z {{name}}",
    tooltipEnabled: "Rozpocznij bezpośrednią rozmowę",
    tooltipLocked: "Wymaga wyższego planu subskrypcji",
    tooltipBusy: "Otwieram rozmowę…",
    signInRequired: "Zaloguj się, aby napisać do tej osoby.",
    startError: "Nie udało się otworzyć rozmowy. Spróbuj ponownie.",

    upgrade: {
      title: "Odblokuj bezpośrednie wiadomości",
      description:
        "Twój plan Essential nie obejmuje wysyłania wiadomości do innych członków sieci. Przejdź na Plus, aby napisać do {{name}} i korzystać z dodatkowych benefitów.",
      benefitsHeading: "Co zyskujesz w planie Plus:",
      benefit1: "Bezpośrednie wiadomości do innych członków sieci eksperckiej",
      benefit2: "Pełny dostęp do wszystkich pogłębionych materiałów analitycznych",
      benefit3: "Interakcje z ekspertami: komentarze, dyskusje, obserwowanie profili",
      cta: "Zobacz plany subskrypcji",
      cancel: "Może później",
    },
  },
};

export const directMessageEn = {
  directMessage: {
    button: "Direct Message",
    opening: "Opening chat…",
    ariaLabel: "Send a message to {{name}}",
    ariaBusy: "Opening chat with {{name}}",
    tooltipEnabled: "Start a direct conversation",
    tooltipLocked: "Requires a higher subscription plan",
    tooltipBusy: "Opening chat…",
    signInRequired: "Sign in to message this person.",
    startError: "Could not open the conversation. Please try again.",

    upgrade: {
      title: "Unlock direct messages",
      description:
        "Your Essential plan does not include messaging other network members. Upgrade to Plus to reach {{name}} and unlock additional benefits.",
      benefitsHeading: "What you get with Plus:",
      benefit1: "Direct messages to other expert-network members",
      benefit2: "Full access to every in-depth analytical piece",
      benefit3: "Interactions with experts: comments, discussions, following profiles",
      cta: "See subscription plans",
      cancel: "Maybe later",
    },
  },
};

i18n.addResourceBundle("pl", "translation", directMessagePl, true, true);
i18n.addResourceBundle("en", "translation", directMessageEn, true, true);

export function ensureDirectMessageI18n(): void {}
