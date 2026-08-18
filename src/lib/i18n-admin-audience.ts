// Słownik pulpitu „Audytorium i retencja" (/admin/audience), PL/EN.
//
// Trasa niosła lokalny bliźniak `L(pl, en)` w dwóch komponentach - 23 napisy
// istniejące wyłącznie w kodzie, więc niewidoczne dla bramki parytetu PL/EN
// i dla tłumacza.
import i18n from "./i18n";

const pl = {
  adminAudience: {
    title: "Audytorium i retencja",
    subtitle: "Lejek członka, dzienna aktywność i kohorty retencji.",
    days: "dni",
    funnel: {
      title: "Lejek członka",
      error: "Nie udało się pobrać danych lejka.",
      membersTotal: "Członkowie łącznie",
      newMembers: "Nowi członkowie",
      newInWindow: "+{{count}} w oknie",
      discoverable: "Widoczni w katalogu (opt-in)",
      newsletter: "Subskrybenci newslettera",
      paying: "Płacący",
      activeSubscriptions: "aktywne subskrypcje",
      activeInWindow: "Aktywni w oknie",
      anyActivity: "dowolna aktywność",
    },
    activity: {
      title: "Aktywność członków",
      chartDescription:
        "Dziennie aktywni członkowie (odczyty, komentarze, czat, zakładki, obserwacje) i nowe rejestracje.",
      empty: "Brak danych aktywności w tym oknie.",
      inWindow: "Aktywność w oknie",
      readers: "Czytający",
      commenters: "Komentujący",
      chatSenders: "Piszący na czacie",
      active: "Aktywni",
    },
    retention: {
      title: "Retencja kohortowa (tygodnie)",
      description:
        "Odsetek członków z danego tygodnia rejestracji aktywnych w kolejnych tygodniach.",
      empty: "Brak rejestracji w analizowanym okresie.",
      cohort: "Kohorta",
      size: "Osoby",
    },
  },
};

const en = {
  adminAudience: {
    title: "Audience & retention",
    subtitle: "Member funnel, daily activity and retention cohorts.",
    days: "days",
    funnel: {
      title: "Member funnel",
      error: "Failed to load funnel data.",
      membersTotal: "Members total",
      newMembers: "New members",
      newInWindow: "+{{count}} in window",
      discoverable: "Discoverable (opt-in)",
      newsletter: "Newsletter subscribers",
      paying: "Paying",
      activeSubscriptions: "active subscriptions",
      activeInWindow: "Active in window",
      anyActivity: "any activity",
    },
    activity: {
      title: "Member activity",
      chartDescription:
        "Daily active members (reads, comments, chat, bookmarks, follows) and new sign-ups.",
      empty: "No activity data in this window.",
      inWindow: "Activity in window",
      readers: "Readers",
      commenters: "Commenters",
      chatSenders: "Chat senders",
      active: "Active",
    },
    retention: {
      title: "Cohort retention (weeks)",
      description: "Share of members from each sign-up week active in subsequent weeks.",
      empty: "No sign-ups in the analysed period.",
      cohort: "Cohort",
      size: "Size",
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
