// Supplementary i18n bundle for the connections network (PL/EN).
// Side-effect import this module wherever the feature mounts:
//   import "@/lib/i18n-network";
// The pl/en objects are exported so the parity test can verify both trees
// stay structurally identical (same rule as the chat bundle).
import i18n from "./i18n";

export const networkPl = {
  network: {
    title: "Moja sieć",
    subtitle:
      "Twoje kontakty zawodowe w społeczności - zaproszenia, połączenia i osoby, które możesz znać.",
    membersOnlyTitle: "Sieć kontaktów jest dostępna po zalogowaniu",
    membersOnlyBody:
      "Zaloguj się lub załóż konto, aby budować sieć kontaktów zawodowych i zapraszać innych członków.",
    tabs: {
      connections: "Połączenia",
      received: "Otrzymane",
      sent: "Wysłane",
      suggestions: "Sugestie",
    },
    connectionsCount_one: "{{count}} połączenie",
    connectionsCount_few: "{{count}} połączenia",
    connectionsCount_many: "{{count}} połączeń",
    connectionsCount_other: "{{count}} połączeń",
    searchPlaceholder: "Szukaj w swojej sieci...",
    emptyConnections: "Nie masz jeszcze połączeń. Znajdź osoby i wyślij pierwsze zaproszenie.",
    emptyConnectionsFiltered: "Brak wyników w Twojej sieci dla tej frazy.",
    emptyReceived: "Brak oczekujących zaproszeń.",
    emptySent: "Nie masz wysłanych zaproszeń.",
    emptySuggestions:
      "Brak sugestii na ten moment. Wróć, gdy w społeczności pojawi się więcej osób.",
    findPeople: "Znajdź osoby",
    loadError: "Nie udało się wczytać sieci kontaktów.",
    retry: "Spróbuj ponownie",
    showMore: "Pokaż więcej",
    loadingMore: "Wczytywanie...",
    connect: "Dodaj do sieci",
    connectShort: "Dodaj",
    inviteNoteLabel: "Notka do zaproszenia (opcjonalnie)",
    inviteNotePlaceholder: "Napisz, skąd się znacie lub dlaczego chcesz nawiązać kontakt...",
    inviteNoteHint: "Maksymalnie 300 znaków. Notkę zobaczy tylko zapraszana osoba.",
    sendInvite: "Wyślij zaproszenie",
    invitedToast: "Zaproszenie wysłane",
    pendingOut: "Wysłano",
    pendingOutHint: "Zaproszenie czeka na odpowiedź",
    withdraw: "Wycofaj zaproszenie",
    withdrawTitle: "Wycofać zaproszenie do {{name}}?",
    withdrawConfirm: "Osoba nie zostanie o tym powiadomiona. Będzie można zaprosić ją ponownie.",
    withdrawnToast: "Zaproszenie wycofane",
    accept: "Akceptuj",
    acceptedToast: "Macie teraz połączenie",
    decline: "Odrzuć",
    declineTitle: "Odrzucić zaproszenie od {{name}}?",
    declineConfirm:
      "Odmowa jest cicha - ta osoba nie dostanie powiadomienia i nie zobaczy Twojej decyzji.",
    declinedToast: "Zaproszenie odrzucone",
    connected: "W sieci",
    messageAction: "Napisz wiadomość",
    remove: "Usuń z sieci",
    removeTitle: "Usunąć {{name}} ze swojej sieci?",
    removeConfirm:
      "Połączenie zniknie po obu stronach bez powiadomienia. Będzie można zaprosić tę osobę ponownie.",
    removedToast: "Usunięto z sieci",
    respond: "Odpowiedz",
    mutual_one: "{{count}} wspólny kontakt",
    mutual_few: "{{count}} wspólne kontakty",
    mutual_many: "{{count}} wspólnych kontaktów",
    mutual_other: "{{count}} wspólnych kontaktów",
    requestedAt: "Wysłano {{date}}",
    connectedAt: "W sieci od {{date}}",
    viewProfile: "Zobacz profil",
    networkLink: "Moja sieć",
    pendingBadge_one: "{{count}} oczekujące zaproszenie",
    pendingBadge_few: "{{count}} oczekujące zaproszenia",
    pendingBadge_many: "{{count}} oczekujących zaproszeń",
    pendingBadge_other: "{{count}} oczekujących zaproszeń",
    startError: "Nie udało się rozpocząć rozmowy.",
    suggestionsHint:
      "Sugestie łączą wspólne kontakty i podobieństwo profilu (instytucja, specjalizacja, lokalizacja) w obrębie Twojej organizacji.",
  },
};

export const networkEn = {
  network: {
    title: "My network",
    subtitle:
      "Your professional contacts in the community - invitations, connections and people you may know.",
    membersOnlyTitle: "The network is available after signing in",
    membersOnlyBody:
      "Sign in or create an account to build your professional network and invite other members.",
    tabs: {
      connections: "Connections",
      received: "Received",
      sent: "Sent",
      suggestions: "Suggestions",
    },
    connectionsCount_one: "{{count}} connection",
    connectionsCount_other: "{{count}} connections",
    searchPlaceholder: "Search your network...",
    emptyConnections: "You have no connections yet. Find people and send your first invitation.",
    emptyConnectionsFiltered: "No results in your network for this phrase.",
    emptyReceived: "No pending invitations.",
    emptySent: "You have no sent invitations.",
    emptySuggestions: "No suggestions right now. Check back when more people join the community.",
    findPeople: "Find people",
    loadError: "Could not load your network.",
    retry: "Try again",
    showMore: "Show more",
    loadingMore: "Loading...",
    connect: "Connect",
    connectShort: "Connect",
    inviteNoteLabel: "Invitation note (optional)",
    inviteNotePlaceholder: "Mention how you know each other or why you want to connect...",
    inviteNoteHint: "Up to 300 characters. Only the invited person will see the note.",
    sendInvite: "Send invitation",
    invitedToast: "Invitation sent",
    pendingOut: "Invited",
    pendingOutHint: "Invitation awaiting a response",
    withdraw: "Withdraw invitation",
    withdrawTitle: "Withdraw the invitation to {{name}}?",
    withdrawConfirm: "They will not be notified. You will be able to invite them again.",
    withdrawnToast: "Invitation withdrawn",
    accept: "Accept",
    acceptedToast: "You are now connected",
    decline: "Decline",
    declineTitle: "Decline the invitation from {{name}}?",
    declineConfirm:
      "Declining is silent - they will not be notified and will not see your decision.",
    declinedToast: "Invitation declined",
    connected: "Connected",
    messageAction: "Send a message",
    remove: "Remove from network",
    removeTitle: "Remove {{name}} from your network?",
    removeConfirm:
      "The connection disappears on both sides without a notification. You can invite them again later.",
    removedToast: "Removed from your network",
    respond: "Respond",
    mutual_one: "{{count}} mutual connection",
    mutual_other: "{{count}} mutual connections",
    requestedAt: "Sent {{date}}",
    connectedAt: "Connected since {{date}}",
    viewProfile: "View profile",
    networkLink: "My network",
    pendingBadge_one: "{{count}} pending invitation",
    pendingBadge_other: "{{count}} pending invitations",
    startError: "Could not start the conversation.",
    suggestionsHint:
      "Suggestions combine mutual connections and profile affinity (institution, specialization, location) within your organization.",
  },
};

i18n.addResourceBundle("pl", "translation", networkPl, true, true);
i18n.addResourceBundle("en", "translation", networkEn, true, true);
