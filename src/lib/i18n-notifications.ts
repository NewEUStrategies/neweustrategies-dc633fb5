// Slownik warstwy powiadomien (PL/EN).
//
// PO CO. Cala ta powierzchnia - skrzynka, filtry, grupowanie po rozmowie,
// preferencje kanalow i panel zgod - stala na 51 wywolaniach `t(key,
// { defaultValue })` bez ani jednego wpisu w zadnym bundlu. i18next bierze
// wtedy `defaultValue` dla KAZDEGO jezyka, a defaulty sa polskie: uzytkownik
// z interfejsem EN czytal „Oznacz wszystkie", „Zachowanie domyslne" i „Digest
// e-mail z nieprzeczytanych powiadomien". Bramka `check:i18n-parity` tego nie
// widzi, bo porownuje ZADEKLAROWANE drzewa kluczy, a tu nie bylo czego
// porownywac - brak wpisu to nie rozjazd, to cisza.
//
// Defaulty w komponentach zostaja jako ostatnia linia obrony (nowy klucz
// dopisany bez wpisu tutaj nadal cos wyrenderuje), ale zrodlem prawdy jest ten
// plik: `addResourceBundle` ma priorytet nad `defaultValue`.
import i18n from "./i18n";

export const notificationsPl = {
  notifications: {
    title: "Powiadomienia",
    inboxSubtitle: "Wszystko, co wymaga Twojej uwagi - w jednym miejscu.",
    empty: "Brak powiadomień",
    noMatches: "Brak wyników dla zadanych filtrów",
    loadMore: "Załaduj więcej",
    markAllRead: "Oznacz wszystkie",
    markRead: "Oznacz jako przeczytane",
    markUnread: "Oznacz jako nieprzeczytane",
    markGroupRead: "Oznacz całą rozmowę jako przeczytaną",
    markGroupUnread: "Oznacz całą rozmowę jako nieprzeczytaną",
    deleteGroup: "Usuń całą rozmowę",
    openInbox: "Otwórz skrzynkę",
    searchPlaceholder: "Szukaj po treści, nadawcy...",
    filters: {
      all: "Wszystkie",
      unread: "Nieprzeczytane",
      allKinds: "Wszystkie typy",
      settings: "Ustawienia",
    },
    grouped: {
      messagesFrom: "Wiadomości od {{name}}",
      moreMessages: "i {{count}} więcej",
    },
    settings: {
      title: "Ustawienia powiadomień",
      subtitle: "Wybierz, jakie alerty trafiają do skrzynki.",
      subtitleLead:
        "Zdecyduj, o czym Cię powiadamiamy i którymi kanałami. Zmiany zapisują się od razu.",
      kindsHeader: "Typy powiadomień",
      behaviourHeader: "Zachowanie domyślne",
      channelsHeader: "Kanały doręczeń",
      channelsSubtitle: "Powiadomienia poza aplikacją: push w przeglądarce i zbiorczy e-mail.",
      kinds: {
        security: "Alerty bezpieczeństwa (zawsze włączone)",
      },
      push: "Powiadomienia push w tej przeglądarce",
      pushHint: "Alert pojawi się nawet przy zamkniętej karcie. Każde urządzenie włączasz osobno.",
      pushDenied: "Przeglądarka odmówiła zgody na powiadomienia.",
      pushError: "Nie udało się włączyć powiadomień push.",
      pushUnsupported: "Ta przeglądarka lub instalacja nie wspiera powiadomień push.",
      digest: "Digest e-mail z nieprzeczytanych powiadomień",
      digestHint: "Jedno zbiorcze podsumowanie zamiast pojedynczych e-maili.",
      digestOff: "Wyłączony",
      digestDaily: "Codziennie",
      digestWeekly: "Co tydzień",
      groupByConversation: "Grupuj powiadomienia o wiadomościach wg rozmowy",
      groupByConversationHint: "Zwiń wiele wiadomości z tego samego czatu w jeden wpis.",
      autoMarkOnOpen: "Automatycznie oznaczaj wiadomości jako przeczytane po otwarciu czatu",
      autoMarkOnOpenHint: "Wyłącz, żeby powiadomienia zostawały do ręcznego zamknięcia.",
      chatBell: "Ikona czatu (dzwonek) w nagłówku",
      chatBellHint:
        "Wyłącz, żeby ukryć skrót do czatu w topbarze. Rozmowy nadal działają w /messages i doku.",
      saved: "Zapisano preferencje",
      saveError: "Nie udało się zapisać preferencji",
    },
    consents: {
      title: "Zgody komunikacji",
      subtitle:
        "Zdecyduj, jakie wiadomości mogą do Ciebie trafiać. Każdą zmianę zapisujemy w niezmiennym rejestrze RODO.",
      requiredBadge: "Wymagana",
      notDecided: "Nie podjęto decyzji",
      given: "Udzielono {{date}}",
      withdrawn: "Wycofano {{date}}",
      version: "Wersja {{version}}",
      versionOutdated: "Nowa wersja tej zgody - potwierdź ponownie",
      stateGiven: "udzielono",
      stateWithdrawn: "wycofano",
      history: "Historia zmian",
      historyEmpty: "Brak zapisanych zmian.",
      saved: "Zapisano zgodę",
      saveError: "Nie udało się zapisać zgody",
    },
    page: {
      metaTitle: "Ustawienia powiadomień",
      metaDescription:
        "Wybierz, o czym Cię powiadamiamy i którymi kanałami: push w przeglądarce, digest e-mail, grupowanie rozmów.",
      relatedHeading: "Powiązane ustawienia",
      inboxLinkTitle: "Skrzynka powiadomień",
      inboxLinkBody: "Przejdź do listy powiadomień, oznaczaj przeczytane i filtruj po typie.",
      consentsLinkTitle: "Zgody komunikacji",
      consentsLinkBody: "Zgody marketingowe i rejestr RODO znajdziesz w centrum prywatności.",
    },
  },
};

export const notificationsEn = {
  notifications: {
    title: "Notifications",
    inboxSubtitle: "Everything that needs your attention - in one place.",
    empty: "No notifications",
    noMatches: "No results for the selected filters",
    loadMore: "Load more",
    markAllRead: "Mark all",
    markRead: "Mark as read",
    markUnread: "Mark as unread",
    markGroupRead: "Mark the whole conversation as read",
    markGroupUnread: "Mark the whole conversation as unread",
    deleteGroup: "Delete the whole conversation",
    openInbox: "Open inbox",
    searchPlaceholder: "Search by content, sender...",
    filters: {
      all: "All",
      unread: "Unread",
      allKinds: "All types",
      settings: "Settings",
    },
    grouped: {
      messagesFrom: "Messages from {{name}}",
      moreMessages: "and {{count}} more",
    },
    settings: {
      title: "Notification settings",
      subtitle: "Choose which alerts reach your inbox.",
      subtitleLead:
        "Decide what we notify you about and through which channels. Changes save immediately.",
      kindsHeader: "Notification types",
      behaviourHeader: "Default behaviour",
      channelsHeader: "Delivery channels",
      channelsSubtitle: "Notifications outside the app: browser push and a batched email.",
      kinds: {
        security: "Security alerts (always on)",
      },
      push: "Push notifications in this browser",
      pushHint: "The alert shows even when the tab is closed. Enable it separately on each device.",
      pushDenied: "The browser denied permission for notifications.",
      pushError: "Could not enable push notifications.",
      pushUnsupported: "This browser or installation does not support push notifications.",
      digest: "Email digest of unread notifications",
      digestHint: "One batched summary instead of individual emails.",
      digestOff: "Off",
      digestDaily: "Daily",
      digestWeekly: "Weekly",
      groupByConversation: "Group message notifications by conversation",
      groupByConversationHint: "Collapse multiple messages from the same chat into one entry.",
      autoMarkOnOpen: "Automatically mark messages as read when the chat opens",
      autoMarkOnOpenHint: "Turn off to keep notifications until you dismiss them yourself.",
      chatBell: "Chat icon (bell) in the header",
      chatBellHint:
        "Turn off to hide the chat shortcut in the topbar. Conversations still work in /messages and the dock.",
      saved: "Preferences saved",
      saveError: "Could not save preferences",
    },
    consents: {
      title: "Communication consents",
      subtitle:
        "Decide which messages may reach you. Every change is recorded in an immutable GDPR register.",
      requiredBadge: "Required",
      notDecided: "No decision yet",
      given: "Given {{date}}",
      withdrawn: "Withdrawn {{date}}",
      version: "Version {{version}}",
      versionOutdated: "New version of this consent - please confirm again",
      stateGiven: "given",
      stateWithdrawn: "withdrawn",
      history: "Change history",
      historyEmpty: "No recorded changes.",
      saved: "Consent saved",
      saveError: "Could not save the consent",
    },
    page: {
      metaTitle: "Notification settings",
      metaDescription:
        "Choose what we notify you about and through which channels: browser push, email digest, conversation grouping.",
      relatedHeading: "Related settings",
      inboxLinkTitle: "Notification inbox",
      inboxLinkBody: "Go to the notification list, mark items read and filter by type.",
      consentsLinkTitle: "Communication consents",
      consentsLinkBody: "Marketing consents and the GDPR register live in the privacy centre.",
    },
  },
};

export const notificationsResources = { pl: notificationsPl, en: notificationsEn };

i18n.addResourceBundle("pl", "translation", notificationsPl, true, true);
i18n.addResourceBundle("en", "translation", notificationsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu -
 * ta sama konwencja co w i18n-network/i18n-chat. Nazwane wiazanie pozwala
 * splitterowi trzymac slownik w chunku trasy, a nie w grafie wejsciowym
 * kazdej strony; rejestracja dzieje sie przy ewaluacji modulu.
 */
export function ensureI18n(): void {}
