// Gifting admin i18n bundle - PL/EN. Ladowany raz przez route admin.gifting.tsx.
import i18n from "./i18n";

const pl = {
  giftingAdmin: {
    title: "Podaruj artykuł",
    subtitle:
      "Ustawienia funkcji „Podaruj artykuł” (linki podarunkowe NYT-style) oraz audyt zdarzeń w tym tenancie.",
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
      empty: "Brak linków spełniających kryteria.",
    },
    audit: {
      filterAll: "Wszystkie",
      filterCreated: "Utworzone",
      filterRedeemed: "Otwarte",
      filterRevoked: "Cofnięte",
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
    title: "Gift articles",
    subtitle:
      "Manage the „Share full article” feature (NYT-style gift links) and audit gifting events in this tenant.",
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
      empty: "No links match the filters.",
    },
    audit: {
      filterAll: "All",
      filterCreated: "Created",
      filterRedeemed: "Opened",
      filterRevoked: "Revoked",
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
