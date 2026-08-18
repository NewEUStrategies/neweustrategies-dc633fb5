// Gifting admin i18n bundle - PL/EN. Ladowany raz przez route admin.gifting.tsx.
import i18n from "./i18n";

const pl = {
  giftingAdmin: {
    title: "Udostępnij pełny artykuł",
    subtitle:
      "Ustawienia funkcji „Udostępnij pełny artykuł” (linki otwierające treść zza paywalla) oraz audyt zdarzeń w tym tenancie.",
    tabs: {
      settings: "Ustawienia",
      links: "Linki",
      audit: "Audyt zdarzeń",
    },
    settings: {
      enabled: "Funkcja włączona",
      enabledHint:
        "Wyłącz, aby ukryć przycisk „Udostępnij pełny artykuł” we wszystkich wpisach tego tenanta.",
      monthlyLimit: "Miesięczny limit linków (per subskrybent)",
      monthlyLimitHint: "0 = bez limitu (jak NYT All Access).",
      ttl: "Ważność linku (dni)",
      ttlHint: "0 = link bezterminowy. Wygasłe linki są automatycznie rotowane.",
      eligibility: "Kto może udostępniać",
      eligibilityHint:
        "Bramka przycisku „Udostępnij pełny artykuł”. Zmiana działa natychmiast - istniejące linki pozostają ważne.",
      eligibilityOptions: {
        registered: {
          label: "Każda zarejestrowana osoba",
          hint: "Wystarczy konto w tym serwisie - domyślne ustawienie mechaniki „udostępnij pełny artykuł”.",
        },
        subscribers: {
          label: "Tylko subskrybenci",
          hint: "Aktywna płatna subskrypcja albo warstwa z dostępem premium (jak NYT All Access).",
        },
      },
      cap: "Budżet kliknięć na link",
      capHint:
        "Ilu NOWYCH odbiorców otworzy artykuł z jednego linku, zanim kod przestanie działać. Domyślnie 5. Powrót tej samej osoby nie zużywa kolejnego kliknięcia, a wartość jest zamrażana na linku w chwili utworzenia.",
      capZeroWarning:
        "0 = bez limitu kliknięć - jeden upubliczniony link odblokuje artykuł nieograniczonej liczbie osób.",
      defaultsNotice:
        "Ten tenant nie ma jeszcze zapisanych ustawień - poniżej efektywne wartości domyślne. Zapis utrwali je w bazie.",
      errors: {
        required: "Podaj wartość.",
        range: "Wartość musi być z zakresu {{min}}-{{max}}.",
      },
      save: "Zapisz ustawienia",
      saved: "Ustawienia zapisane.",
      updatedAt: "Ostatnia zmiana: {{when}}",
    },
    stats: {
      active: "Aktywne linki",
      revoked: "Cofnięte",
      expired: "Wygasłe",
      createdThisMonth: "Utworzone w tym miesiącu",
      redeemedThisMonth: "Otwarcia w tym miesiącu",
      totalCreated: "Łącznie utworzonych",
      totalRedeemed: "Łącznie otwarć",
      gifters: "Unikalni darczyńcy",
      recipients: "Unikalni odbiorcy",
      exhausted: "Wyczerpane budżety",
    },
    links: {
      filterAll: "Wszystkie",
      filterActive: "Aktywne",
      filterRevoked: "Cofnięte",
      filterExpired: "Wygasłe",
      col: {
        post: "Wpis",
        gifter: "Darczyńca",
        created: "Utworzony",
        expires: "Wygasa",
        redemptions: "Otwarcia",
        status: "Status",
        actions: "Akcje",
      },
      neverExpires: "bez wygaśnięcia",
      status: {
        active: "aktywny",
        revoked: "cofnięty",
        expired: "wygasł",
      },
      revoke: "Cofnij link",
      confirmRevoke: "Cofnąć ten link podarunkowy? Odbiorcy stracą dostęp.",
      revoked: "Link został cofnięty.",
      copyCode: "Skopiuj kod",
      capReached: "Budżet kliknięć wyczerpany - kod nie odblokuje treści kolejnym odbiorcom.",
      capNote_one:
        "Nowe linki dostają budżet {{count}} kliknięcia. Kolumna „Otwarcia” pokazuje budżet zamrożony na danym linku, więc starsze linki mogą mieć inną wartość.",
      capNote_few:
        "Nowe linki dostają budżet {{count}} kliknięć. Kolumna „Otwarcia” pokazuje budżet zamrożony na danym linku, więc starsze linki mogą mieć inną wartość.",
      capNote_many:
        "Nowe linki dostają budżet {{count}} kliknięć. Kolumna „Otwarcia” pokazuje budżet zamrożony na danym linku, więc starsze linki mogą mieć inną wartość.",
      capNote_other:
        "Nowe linki dostają budżet {{count}} kliknięć. Kolumna „Otwarcia” pokazuje budżet zamrożony na danym linku, więc starsze linki mogą mieć inną wartość.",
      capNoteUnlimited:
        "Nowe linki są bez limitu kliknięć. Kolumna „Otwarcia” pokazuje budżet zamrożony na danym linku.",
      recipients_one: "{{count}} odbiorca",
      recipients_few: "{{count}} odbiorców",
      recipients_many: "{{count}} odbiorców",
      recipients_other: "{{count}} odbiorcy",
      empty: "Brak linków spełniających kryteria.",
    },
    audit: {
      filterAll: "Wszystkie",
      filterCreated: "Utworzone",
      filterRedeemed: "Otwarte",
      filterRevoked: "Cofnięte",
      filterExhausted: "Odbicia",
      col: {
        when: "Kiedy",
        type: "Typ",
        post: "Wpis",
        actor: "Kto",
        code: "Kod",
      },
      type: {
        created: "utworzony",
        redeemed: "otwarty",
        revoked: "cofnięty",
        expired: "wygasł",
        exhausted: "odbicie (budżet wyczerpany)",
      },
      anonymous: "anonimowy odbiorca",
      empty: "Brak zdarzeń.",
    },
    common: {
      loading: "Ładowanie...",
      error: "Wystąpił błąd. Spróbuj ponownie.",
      loadMore: "Załaduj więcej",
    },
  },
};

const en: typeof pl = {
  giftingAdmin: {
    title: "Share full article",
    subtitle:
      "Manage the „Share full article” feature (links that open paywalled content) and audit sharing events in this tenant.",
    tabs: {
      settings: "Settings",
      links: "Links",
      audit: "Audit log",
    },
    settings: {
      enabled: "Feature enabled",
      enabledHint:
        "Disable to hide the „Share full article” button across every post in this tenant.",
      monthlyLimit: "Monthly link limit (per subscriber)",
      monthlyLimitHint: "0 = unlimited (like NYT All Access).",
      ttl: "Link validity (days)",
      ttlHint: "0 = never expires. Expired links are rotated automatically.",
      eligibility: "Who can share",
      eligibilityHint:
        "Gate for the „Share full article” button. Changes apply immediately - links already shared stay valid.",
      eligibilityOptions: {
        registered: {
          label: "Any registered reader",
          hint: "An account on this site is enough - the default for the share-full-article mechanic.",
        },
        subscribers: {
          label: "Subscribers only",
          hint: "An active paid subscription or a premium tier (NYT All Access style).",
        },
      },
      cap: "Per-link click budget",
      capHint:
        "How many NEW recipients can open the article from a single link before the code stops working. Default 5. A returning reader does not spend another click, and the value is frozen on the link when it is created.",
      capZeroWarning:
        "0 = no click budget - one publicly shared link unlocks the article for an unlimited audience.",
      defaultsNotice:
        "This tenant has no saved settings yet - the values below are the effective defaults. Saving will persist them.",
      errors: {
        required: "Enter a value.",
        range: "Value must be between {{min}} and {{max}}.",
      },
      save: "Save settings",
      saved: "Settings saved.",
      updatedAt: "Last change: {{when}}",
    },
    stats: {
      active: "Active links",
      revoked: "Revoked",
      expired: "Expired",
      createdThisMonth: "Created this month",
      redeemedThisMonth: "Opened this month",
      totalCreated: "Total created",
      totalRedeemed: "Total opens",
      gifters: "Unique gifters",
      recipients: "Unique recipients",
      exhausted: "Spent budgets",
    },
    links: {
      filterAll: "All",
      filterActive: "Active",
      filterRevoked: "Revoked",
      filterExpired: "Expired",
      col: {
        post: "Post",
        gifter: "Gifter",
        created: "Created",
        expires: "Expires",
        redemptions: "Opens",
        status: "Status",
        actions: "Actions",
      },
      neverExpires: "never expires",
      status: {
        active: "active",
        revoked: "revoked",
        expired: "expired",
      },
      revoke: "Revoke link",
      confirmRevoke: "Revoke this gift link? Recipients will lose access.",
      revoked: "Link revoked.",
      copyCode: "Copy code",
      capReached: "Click budget spent - the code no longer unlocks content for new recipients.",
      capNote_one:
        "New links get a budget of {{count}} click. The „Opens” column shows the budget frozen on each link, so older links may differ.",
      capNote_few:
        "New links get a budget of {{count}} clicks. The „Opens” column shows the budget frozen on each link, so older links may differ.",
      capNote_many:
        "New links get a budget of {{count}} clicks. The „Opens” column shows the budget frozen on each link, so older links may differ.",
      capNote_other:
        "New links get a budget of {{count}} clicks. The „Opens” column shows the budget frozen on each link, so older links may differ.",
      capNoteUnlimited:
        "New links have no click budget. The „Opens” column shows the budget frozen on each link.",
      recipients_one: "{{count}} recipient",
      recipients_few: "{{count}} recipients",
      recipients_many: "{{count}} recipients",
      recipients_other: "{{count}} recipients",
      empty: "No links match the filters.",
    },
    audit: {
      filterAll: "All",
      filterCreated: "Created",
      filterRedeemed: "Opened",
      filterRevoked: "Revoked",
      filterExhausted: "Bounces",
      col: {
        when: "When",
        type: "Type",
        post: "Post",
        actor: "Who",
        code: "Code",
      },
      type: {
        created: "created",
        redeemed: "opened",
        revoked: "revoked",
        expired: "expired",
        exhausted: "bounced (budget spent)",
      },
      anonymous: "anonymous recipient",
      empty: "No events.",
    },
    common: {
      loading: "Loading...",
      error: "Something went wrong. Please try again.",
      loadMore: "Load more",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
