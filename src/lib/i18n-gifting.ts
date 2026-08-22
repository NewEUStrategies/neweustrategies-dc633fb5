// "Udostepnij pelny artykul" - bundle i18n (PL/EN). Ladowany raz przy imporcie
// przez komponenty gifting (GiftArticleButton / GiftBanner / molekule budzetu).
// Terminologia celowo spojna z i18n-paywall (signin/plany), zeby popover
// udostepniania i paywall czytaly sie jak JEDEN lejek subskrypcyjny. Osobny
// maly bundle - strona artykulu nie placi za slowniki profilu/admina.
import i18n from "./i18n";

const pl = {
  gifting: {
    button: "Udostępnij pełny artykuł",
    popoverTitle: "Udostępnij pełny artykuł",
    lead: "Podaruj dostęp do pełnej treści tego artykułu - bez paywalla.",
    leadFree:
      "Ten artykuł jest dostępny bez paywalla - wystarczy zwykły link do strony.",
    leadCapped_one:
      "Twój link otworzy pełną treść pierwszej osobie, która w niego kliknie - bez paywalla.",
    leadCapped_few:
      "Twój link otworzy pełną treść pierwszym {{count}} osobom, które w niego klikną - bez paywalla.",
    leadCapped_many:
      "Twój link otworzy pełną treść pierwszym {{count}} osobom, które w niego klikną - bez paywalla.",
    leadCapped_other:
      "Twój link otworzy pełną treść pierwszym {{count}} osobom, które w niego klikną - bez paywalla.",
    unlimitedNote: "Masz nieograniczoną liczbę artykułów do udostępnienia.",
    remainingNote_one: "Pozostał Ci {{count}} artykuł do udostępnienia w tym miesiącu.",
    remainingNote_few: "Pozostały Ci {{count}} artykuły do udostępnienia w tym miesiącu.",
    remainingNote_many: "Pozostało Ci {{count}} artykułów do udostępnienia w tym miesiącu.",
    remainingNote_other: "Pozostało Ci {{count}} artykułu do udostępnienia w tym miesiącu.",
    anyoneCanRead: "Każda osoba z linkiem przeczyta pełną treść - subskrypcja nie jest potrzebna.",
    firstNCanRead_one:
      "Pierwsza osoba, która kliknie w link, przeczyta pełną treść - bez subskrypcji.",
    firstNCanRead_few:
      "Pierwsze {{count}} osoby, które klikną w link, przeczytają pełną treść - bez subskrypcji.",
    firstNCanRead_many:
      "Pierwszych {{count}} osób, które klikną w link, przeczyta pełną treść - bez subskrypcji.",
    firstNCanRead_other:
      "Pierwszych {{count}} osób, które klikną w link, przeczyta pełną treść - bez subskrypcji.",
    expiresOn: "Link wygaśnie {{date}}.",
    preparing: "Przygotowywanie linku...",
    copyLink: "Skopiuj link",
    copied: "Skopiowano link!",
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
      'Dzielę się z Tobą artykułem "{{title}}" - ten link otwiera pełną treść bez subskrypcji:\n\n{{url}}',
    budget: {
      meterLabel: "Wykorzystane otwarcia linku",
      progressValue: "{{used}} z {{limit}}",
      remaining_one: "Zostało {{count}} otwarcie",
      remaining_few: "Zostały {{count}} otwarcia",
      remaining_many: "Zostało {{count}} otwarć",
      remaining_other: "Zostało {{count}} otwarcia",
      exhaustedLabel: "Wszystkie otwarcia wykorzystane",
      unlimited: "Link bez limitu otwarć.",
      spentTitle: "Limit otwarć tego linku wyczerpany",
      spentDesc:
        "Z Twojego linku skorzystało już {{limit}} osób. Nowy link do tego artykułu nie doda kolejnych otwarć w tym miesiącu.",
      resetsOn: "Limit dla tego artykułu odnowi się {{date}}.",
    },
    authTitle: "Zaloguj się, aby udostępnić",
    authDesc:
      "Udostępnianie pełnych artykułów jest dostępne dla zalogowanych czytelników. Zaloguj się lub załóż bezpłatne konto, aby kontynuować.",
    authDescSubscribers:
      "Udostępnianie pełnych artykułów jest dostępne dla zalogowanych subskrybentów. Zaloguj się lub załóż konto, aby kontynuować.",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
    subscriptionTitle: "Funkcja dla subskrybentów",
    subscriptionDesc:
      "Artykuły mogą udostępniać osoby z aktywną płatną subskrypcją. Wybierz plan, aby dzielić się pełnymi treściami z każdym.",
    seePlans: "Zobacz plany",
    limitTitle: "Wykorzystano miesięczny limit",
    limitDesc:
      "Udostępniono {{used}} z {{limit}} artykułów w tym miesiącu. Limit odnowi się z początkiem kolejnego miesiąca.",
    errors: {
      authRequired: "Zaloguj się, aby udostępnić artykuł.",
      subscriptionRequired: "Udostępnianie artykułów wymaga aktywnej subskrypcji.",
      limitReached: "Wykorzystano miesięczny limit udostępnionych artykułów.",
      disabled: "Udostępnianie pełnych artykułów jest obecnie wyłączone.",
      notFound: "Nie można udostępnić tego artykułu.",
      notGated: "Ten artykuł jest dostępny bez paywalla - wystarczy zwykły link do strony.",
      unknown: "Nie udało się przygotować linku - spróbuj ponownie.",
    },
    banner: {
      title: "Pełny artykuł udostępniony Tobie",
      desc: "Ktoś podzielił się z Tobą pełną treścią tego artykułu - czytasz bez paywalla.",
      exhaustedTitle: "Ten link został już w pełni wykorzystany",
      exhaustedDesc:
        "Limit otwarć tego linku wyczerpali wcześniejsi czytelnicy. Poproś nadawcę o nowy link albo zobacz plany.",
      expiredTitle: "Ten link wygasł",
      expiredDesc:
        "Termin ważności udostępnionego linku minął. Poproś nadawcę o nowy albo zobacz plany.",
      invalidTitle: "Link jest nieprawidłowy",
      invalidDesc:
        "Nie udało się otworzyć artykułu z tego linku. Zobacz plany, aby czytać bez ograniczeń.",
      cta: "Poznaj plany",
    },
  },
};

const en: typeof pl = {
  gifting: {
    button: "Share full article",
    popoverTitle: "Share full article",
    lead: "Give paywall-free access to the full text of this article.",
    leadCapped_one: "Your link opens the full article for the first person who clicks it.",
    leadCapped_few: "Your link opens the full article for the first {{count}} people who click it.",
    leadCapped_many:
      "Your link opens the full article for the first {{count}} people who click it.",
    leadCapped_other:
      "Your link opens the full article for the first {{count}} people who click it.",
    unlimitedNote: "You have unlimited articles to share.",
    remainingNote_one: "You have {{count}} shared article left this month.",
    remainingNote_few: "You have {{count}} shared articles left this month.",
    remainingNote_many: "You have {{count}} shared articles left this month.",
    remainingNote_other: "You have {{count}} shared articles left this month.",
    anyoneCanRead: "Anyone with the link can read the full article - no subscription needed.",
    firstNCanRead_one:
      "The first person to click the link reads the full article - no subscription.",
    firstNCanRead_few:
      "The first {{count}} people to click the link read the full article - no subscription.",
    firstNCanRead_many:
      "The first {{count}} people to click the link read the full article - no subscription.",
    firstNCanRead_other:
      "The first {{count}} people to click the link read the full article - no subscription.",
    expiresOn: "The link expires on {{date}}.",
    preparing: "Preparing your link...",
    copyLink: "Copy link",
    copied: "Link copied!",
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
      'Sharing "{{title}}" with you - this link opens the full article, no subscription needed:\n\n{{url}}',
    budget: {
      meterLabel: "Link opens used",
      progressValue: "{{used}} of {{limit}}",
      remaining_one: "{{count}} open left",
      remaining_few: "{{count}} opens left",
      remaining_many: "{{count}} opens left",
      remaining_other: "{{count}} opens left",
      exhaustedLabel: "All opens used",
      unlimited: "This link has no open limit.",
      spentTitle: "This link has reached its limit",
      spentDesc:
        "{{limit}} people have already opened your link. A new link for this article will not add more opens this month.",
      resetsOn: "The limit for this article resets on {{date}}.",
    },
    authTitle: "Sign in to share",
    authDesc:
      "Sharing full articles is available to signed-in readers. Sign in or create a free account to continue.",
    authDescSubscribers:
      "Sharing full articles is available to signed-in subscribers. Sign in or create an account to continue.",
    signIn: "Sign in",
    signUp: "Create account",
    subscriptionTitle: "A subscriber benefit",
    subscriptionDesc:
      "Sharing is available with an active paid subscription. Choose a plan to share full articles with anyone.",
    seePlans: "See plans",
    limitTitle: "Monthly limit reached",
    limitDesc:
      "You have shared {{used}} of {{limit}} articles this month. The limit resets at the start of next month.",
    errors: {
      authRequired: "Sign in to share this article.",
      subscriptionRequired: "Sharing articles requires an active subscription.",
      limitReached: "You have reached this month's shared article limit.",
      disabled: "Sharing full articles is currently disabled.",
      notFound: "This article cannot be shared.",
      notGated: "This article is already paywall-free - a plain page link is enough.",
      unknown: "Could not prepare the link - please try again.",
    },
    banner: {
      title: "The full article, shared with you",
      desc: "Someone shared the full text of this article with you - you are reading past the paywall.",
      exhaustedTitle: "This link has been fully used",
      exhaustedDesc:
        "Earlier readers used up this link's opens. Ask the sender for a new link, or see our plans.",
      expiredTitle: "This link has expired",
      expiredDesc:
        "The shared link is past its expiry date. Ask the sender for a new one, or see our plans.",
      invalidTitle: "This link is not valid",
      invalidDesc:
        "We could not open the article from this link. See our plans to read without limits.",
      cta: "Explore plans",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
