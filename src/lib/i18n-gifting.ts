// Gift Articles i18n bundle (PL/EN). Ladowany raz przy imporcie przez
// komponenty gifting (GiftArticleButton / GiftBanner). Terminologia celowo
// spojna z i18n-paywall (signin/plany), zeby popover podarunkowy i paywall
// czytaly sie jak JEDEN lejek subskrypcyjny. Osobny maly bundle - strona
// artykulu nie placi za slowniki profilu/admina.
import i18n from "./i18n";

const pl = {
  gifting: {
    button: "Udostępnij pełny artykuł",
    popoverTitle: "Podaruj artykuł",
    lead: "Podaruj dostęp do pełnej treści tego artykułu - bez paywalla.",
    unlimitedNote: "Masz nieograniczoną liczbę artykułów do podarowania.",
    remainingNote_one: "Pozostał Ci {{count}} artykuł do podarowania w tym miesiącu.",
    remainingNote_few: "Pozostały Ci {{count}} artykuły do podarowania w tym miesiącu.",
    remainingNote_many: "Pozostało Ci {{count}} artykułów do podarowania w tym miesiącu.",
    remainingNote_other: "Pozostało Ci {{count}} artykułu do podarowania w tym miesiącu.",
    anyoneCanRead: "Każda osoba z linkiem przeczyta pełną treść - subskrypcja nie jest potrzebna.",
    expiresOn: "Link wygaśnie {{date}}.",
    preparing: "Przygotowywanie linku...",
    copyLink: "Skopiuj link",
    copied: "Skopiowano link podarunkowy!",
    copyFailed: "Nie udało się skopiować - zaznacz i skopiuj link ręcznie.",
    shareVia: "Udostępnij przez",
    channels: {
      mail: "E-mail",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      whatsapp: "WhatsApp",
      telegram: "Telegram",
      x: "X",
      reddit: "Reddit",
    },
    emailSubject: "Artykuł dla Ciebie: {{title}}",
    emailBody:
      'Dzielę się z Tobą artykułem "{{title}}" - link podarunkowy otwiera pełną treść bez subskrypcji:\n\n{{url}}',
    authTitle: "Zaloguj się, aby podarować",
    authDesc:
      "Podarowanie pełnych artykułów jest dostępne dla zalogowanych subskrybentów. Zaloguj się lub załóż konto, aby kontynuować.",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
    subscriptionTitle: "Funkcja dla subskrybentów",
    subscriptionDesc:
      "Artykuły mogą podarowywać osoby z aktywną płatną subskrypcją. Wybierz plan, aby dzielić się pełnymi treściami z każdym.",
    seePlans: "Zobacz plany",
    limitTitle: "Wykorzystano miesięczny limit",
    limitDesc:
      "Podarowano {{used}} z {{limit}} artykułów w tym miesiącu. Limit odnowi się z początkiem kolejnego miesiąca.",
    errors: {
      authRequired: "Zaloguj się, aby podarować artykuł.",
      subscriptionRequired: "Podarowanie artykułów wymaga aktywnej subskrypcji.",
      limitReached: "Wykorzystano miesięczny limit podarowanych artykułów.",
      disabled: "Podarowanie artykułów jest obecnie wyłączone.",
      notFound: "Nie można podarować tego artykułu.",
      unknown: "Nie udało się przygotować linku - spróbuj ponownie.",
    },
    banner: {
      title: "Artykuł podarowany",
      desc: "Subskrybent podzielił się z Tobą pełną treścią tego artykułu.",
      invalidTitle: "Link podarunkowy jest nieprawidłowy lub wygasł",
      invalidDesc:
        "Nie udało się otworzyć artykułu z tego linku. Zobacz plany, aby czytać bez ograniczeń.",
      cta: "Poznaj plany",
    },
  },
};

const en: typeof pl = {
  gifting: {
    button: "Share full article",
    popoverTitle: "Gift this article",
    lead: "Give paywall-free access to the full text of this article.",
    unlimitedNote: "You have unlimited gift articles to share.",
    remainingNote_one: "You have {{count}} gift article left this month.",
    remainingNote_few: "You have {{count}} gift articles left this month.",
    remainingNote_many: "You have {{count}} gift articles left this month.",
    remainingNote_other: "You have {{count}} gift articles left this month.",
    anyoneCanRead: "Anyone with the link can read the full article - no subscription needed.",
    expiresOn: "The link expires on {{date}}.",
    preparing: "Preparing your link...",
    copyLink: "Copy link",
    copied: "Gift link copied!",
    copyFailed: "Could not copy - select and copy the link manually.",
    shareVia: "Share via",
    channels: {
      mail: "Email",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      whatsapp: "WhatsApp",
      telegram: "Telegram",
      x: "X",
      reddit: "Reddit",
    },
    emailSubject: "An article for you: {{title}}",
    emailBody:
      'Sharing "{{title}}" with you - this gift link opens the full article, no subscription needed:\n\n{{url}}',
    authTitle: "Sign in to gift",
    authDesc:
      "Gifting full articles is available to signed-in subscribers. Sign in or create an account to continue.",
    signIn: "Sign in",
    signUp: "Create account",
    subscriptionTitle: "A subscriber benefit",
    subscriptionDesc:
      "Gifting is available with an active paid subscription. Choose a plan to share full articles with anyone.",
    seePlans: "See plans",
    limitTitle: "Monthly limit reached",
    limitDesc:
      "You have gifted {{used}} of {{limit}} articles this month. The limit resets at the start of next month.",
    errors: {
      authRequired: "Sign in to gift this article.",
      subscriptionRequired: "Gifting articles requires an active subscription.",
      limitReached: "You have reached this month's gift article limit.",
      disabled: "Gifting articles is currently disabled.",
      notFound: "This article cannot be gifted.",
      unknown: "Could not prepare the link - please try again.",
    },
    banner: {
      title: "A gift for you",
      desc: "A subscriber shared the full text of this article with you.",
      invalidTitle: "This gift link is invalid or has expired",
      invalidDesc:
        "We could not open the article from this link. See our plans to read without limits.",
      cta: "Explore plans",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
