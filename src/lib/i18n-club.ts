// Supplementary i18n bundle for Discussion Club (PL/EN).
//
// Dwa prefiksy: `club` (produkt) i `adminClubs` (panel). Oba wchodza do
// GATED_PREFIXES bramki parytetu, wiec brak klucza w ktoryms jezyku oblewa CI -
// zamiast wysypywac surowy klucz na ekranie. Zadne t() w module nie polega na
// defaultValue.
//
// Wolane przez ensureClubI18n() w komponencie trasy, nie side-effectowym
// importem: side-effect w pliku trasy laduje caly bundle do grafu wejsciowego
// KAZDEJ strony, a budzety bundla sa dzis czerwone.
import i18n from "./i18n";

export const clubPl = {
  club: {
    // --- powierzchnia produktowa ---
    title: "Kluby dyskusyjne",
    subtitle:
      "Trwałe przestrzenie rozmowy między członkami - własna tożsamość, zasady i archiwum.",
    myClubs: "Moje kluby",
    discover: "Odkryj",
    invitations: "Zaproszenia",
    membersOnlyTitle: "Kluby dyskusyjne są dostępne po zalogowaniu",
    membersOnlyBody:
      "Zaloguj się lub załóż konto, aby dołączać do klubów i brać udział w dyskusjach.",
    empty: "Nie należysz jeszcze do żadnego klubu.",
    emptyDiscover: "Brak klubów dostępnych dla Ciebie w tej chwili.",
    loadError: "Nie udało się wczytać klubów.",
    retry: "Spróbuj ponownie",
    open: "Otwórz",
    join: "Dołącz",
    requestJoin: "Poproś o dostęp",
    membersCount_one: "{{count}} członek",
    membersCount_few: "{{count}} członków",
    membersCount_many: "{{count}} członków",
    membersCount_other: "{{count}} członków",
    threadsCount_one: "{{count}} temat",
    threadsCount_few: "{{count}} tematy",
    threadsCount_many: "{{count}} tematów",
    threadsCount_other: "{{count}} tematów",
    groupsCount_one: "{{count}} grupa",
    groupsCount_few: "{{count}} grupy",
    groupsCount_many: "{{count}} grup",
    groupsCount_other: "{{count}} grup",
    lastActivity: "Ostatnia aktywność",
    never: "Brak aktywności",
    rules: "Zasady klubu",
    about: "O klubie",
    members: "Członkowie",
    groups: "Grupy",

    visibility: {
      public: "Publiczny",
      members: "Dla zalogowanych",
      private: "Prywatny",
      secret: "Ukryty",
    },
    visibilityHint: {
      public: "Widoczny dla wszystkich, indeksowany przez wyszukiwarki.",
      members: "Widoczny dla zalogowanych członków społeczności.",
      private: "Karta widoczna dla zalogowanych, treść tylko dla członków.",
      secret: "Widoczny wyłącznie dla członków klubu.",
    },
    joinPolicy: {
      open: "Wejście otwarte",
      request: "Na prośbę",
      invite: "Na zaproszenie",
    },
    attribution: {
      attributed: "Wypowiedzi podpisane",
      chatham: "Reguła Chatham House",
      anonymous_allowed: "Autor decyduje",
    },
    attributionHint: {
      attributed: "Każda wypowiedź jest podpisana imieniem i nazwiskiem.",
      chatham:
        "Treść jest cytowalna, tożsamość nie. Wypowiedzi widoczne jako pseudonim w obrębie wątku.",
      anonymous_allowed: "Autor decyduje przy każdym wpisie, czy podpisać wypowiedź.",
    },
    whoCanPost: {
      members: "Temat zakłada każdy członek",
      moderators: "Temat zakłada prowadzący lub moderator",
      staff_only: "Temat zakłada wyłącznie redakcja",
    },
    moderation: {
      post: "Moderacja po publikacji",
      pre: "Premoderacja wszystkiego",
      trusted: "Premoderacja nowych kont",
    },
    role: {
      lead: "Prowadzący",
      moderator: "Moderator",
      member: "Członek",
      observer: "Obserwator",
      non_member: "Nie należy",
      banned: "Zablokowany",
    },
    memberStatus: {
      active: "Aktywny",
      pending: "Oczekuje",
      invited: "Zaproszony",
      banned: "Zablokowany",
      left: "Odszedł",
    },
    status: {
      draft: "Wersja robocza",
      active: "Aktywny",
      archived: "Zarchiwizowany",
    },
    groupStatus: {
      draft: "Wersja robocza",
      scheduled: "Zaplanowana",
      active: "Aktywna",
      frozen: "Zamrożona",
      archived: "Zarchiwizowana",
    },

    // Kody z club_capabilities().reason - zdanie MÓWIĄCE, CO ZROBIĆ.
    reason: {
      not_found: "Ten klub nie istnieje lub nie jest dla Ciebie dostępny.",
      auth_required: "Zaloguj się, aby zobaczyć ten klub.",
      not_member: "Nie należysz do tego klubu. Poproś o dostęp, aby czytać dyskusje.",
      tier_too_low: "Ten klub wymaga wyższego planu członkowskiego.",
      group_frozen: "Ta grupa jest zamrożona - można czytać, nie można pisać.",
      not_open_yet: "Ta przestrzeń jeszcze się nie otworzyła.",
      window_closed: "Okno dyskusji zostało zamknięte. Treść pozostaje do odczytu.",
      archived: "Ten klub jest zarchiwizowany.",
      banned: "Twój dostęp do tego klubu został zablokowany.",
      pre_moderation: "Twoje wpisy trafiają najpierw do zatwierdzenia przez moderatora.",
    },
    inheritedFromClub: "Dziedziczone z klubu",
  },

  adminClubs: {
    // --- panel administracyjny ---
    navLabel: "Kluby dyskusyjne",
    title: "Kluby dyskusyjne",
    subtitle: "Struktura, uprawnienia i członkostwa. Treść tworzą członkowie w nadanym zakresie.",
    newClub: "Nowy klub",
    editClub: "Edytuj klub",
    noPermissionTitle: "Brak uprawnień",
    noPermissionBody:
      "Zarządzanie klubami dyskusyjnymi jest dostępne wyłącznie dla administratorów.",
    empty: "Nie ma jeszcze żadnego klubu. Zacznij od pierwszego.",
    emptyFiltered: "Brak klubów spełniających wybrane filtry.",
    loadError: "Nie udało się wczytać klubów.",
    searchPlaceholder: "Szukaj po nazwie lub adresie...",
    filterStatus: "Status",
    filterVisibility: "Widoczność",
    filterAny: "Dowolny",
    saved: "Zapisano",
    saveFailed: "Nie udało się zapisać",
    slugTaken: "Ten adres jest już zajęty w tym tenancie.",
    requiredFields: "Nazwa i adres są wymagane.",

    columns: {
      name: "Nazwa",
      visibility: "Widoczność",
      groups: "Grupy",
      members: "Członkowie",
      threads: "Tematy",
      pending: "Oczekujący",
      leads: "Prowadzący",
      lastActivity: "Ostatnia aktywność",
      status: "Status",
      actions: "Akcje",
      role: "Rola",
      joined: "Dołączył",
      roleExpires: "Kadencja do",
      inviteSource: "Źródło",
    },

    tabs: {
      general: "Ogólne",
      access: "Dostęp",
      groups: "Grupy",
      threads: "Tematy",
      members: "Członkowie",
      invitations: "Zaproszenia",
      permissions: "Uprawnienia",
      moderation: "Moderacja",
      analytics: "Statystyki",
    },

    fields: {
      namePl: "Nazwa (PL)",
      nameEn: "Nazwa (EN)",
      slug: "Adres (slug)",
      slugHint: "Małe litery, cyfry i myślniki. Zmiana adresu psuje istniejące linki.",
      taglinePl: "Hasło (PL)",
      taglineEn: "Hasło (EN)",
      descriptionPl: "Opis (PL)",
      descriptionEn: "Opis (EN)",
      rulesPl: "Zasady (PL)",
      rulesEn: "Zasady (EN)",
      rulesHint: "Zasady są pokazywane przed wejściem do klubu, nie po.",
      icon: "Ikona",
      accentColor: "Kolor akcentu",
      coverImage: "Okładka",
      policyArea: "Obszar polityki",
      visibility: "Widoczność",
      joinPolicy: "Polityka wstępu",
      minTier: "Minimalny plan",
      minTierNone: "Bez wymagań",
      attributionMode: "Tryb atrybucji",
      whoCanPost: "Kto zakłada temat",
      moderationMode: "Tryb moderacji",
      status: "Status",
      opensAt: "Otwiera się",
      closesAt: "Zamyka się",
      sortOrder: "Kolejność",
    },

    // Żywy podgląd ustawień dostępu - jedno zdanie zamiast czterech pól
    // do samodzielnego złożenia przez administratora.
    accessPreviewTitle: "Co to znaczy dla użytkownika",
    accessPreviewTier: "Wymaga planu o randze co najmniej {{rank}}.",
    accessPreviewNoTier: "Bez wymagań planu.",
    accessWarning: {
      title: "Warto potwierdzić",
      public_open:
        "Klub publiczny z otwartym wejściem: treść widzi każdy anonim, a każde konto wchodzi bez decyzji człowieka.",
      secret_public_entry:
        "Klub ukryty z otwartym wejściem jest sprzeczny - nikt spoza klubu go nie widzi, więc otwarte wejście nie ma jak zadziałać.",
      chatham_public:
        "Reguła Chatham House w klubie publicznym oznacza anonimowość wobec czytelników, których nie da się policzyć.",
    },

    groups: {
      title: "Grupy tematyczne",
      hint: "Grupa daje osobną subskrypcję, osobne uprawnienia i osobny rytm. Klub bez grup po trzech miesiącach staje się nieużywalny.",
      newGroup: "Nowa grupa",
      editGroup: "Edytuj grupę",
      empty: "Ten klub ma tylko grupę domyślną.",
      reorderHint: "Przeciągnij, aby zmienić kolejność.",
      reordered: "Kolejność zapisana",
      inherit: "Dziedzicz z klubu",
      override: "Nadpisz",
    },

    members: {
      title: "Członkowie klubu",
      add: "Dodaj osobę",
      addHint: "Osoba musi należeć do tej samej przestrzeni roboczej.",
      added: "Dodano do klubu",
      removed: "Usunięto z klubu",
      removeConfirmTitle: "Usunąć {{name}} z klubu?",
      removeConfirmBody:
        "Usunięcie pozwala wrócić. Aby odciąć dostęp trwale, ustaw status Zablokowany.",
      roleChanged: "Rola zmieniona",
      empty: "Ten klub nie ma jeszcze członków.",
      filterStatus: "Status członkostwa",
      roleExpiresHint: "Po tej dacie rola wraca do poziomu Członek.",
      roleExpired: "Kadencja wygasła",
    },

    permissions: {
      title: "Macierz uprawnień",
      hint: "Wiersze to zdolności, kolumny to role. Ta sama funkcja liczy dostęp w bazie i tutaj.",
      previewAs: "Podgląd jako...",
      previewHint: "Pokazuje wynik club_capabilities() dla wskazanej osoby wraz z powodem odmowy.",
      previewEmpty: "Wybierz osobę, aby zobaczyć jej realne uprawnienia.",
      effectiveRole: "Rola efektywna",
      reasonLabel: "Powód",
      reasonNone: "Brak przeszkód",
      caps: {
        can_read: "Czyta klub",
        can_post_thread: "Zakłada temat",
        can_reply: "Odpowiada",
        can_react: "Reaguje",
        can_moderate: "Moderuje treść",
        can_manage: "Zarządza strukturą",
        can_invite: "Zaprasza",
        can_see_members: "Widzi członków",
        can_reveal_author: "Ujawnia autora",
      },
      roles: {
        super_admin: "Super admin",
        admin: "Administrator",
        editor: "Redaktor",
        lead: "Prowadzący",
        moderator: "Moderator",
        member: "Członek",
        observer: "Obserwator",
        non_member: "Nie-członek",
      },
      value: {
        yes: "Tak",
        no: "Nie",
        conditional: "Zależy od ustawień",
      },
    },

    stats: {
      title: "Statystyki klubu",
      members: "Członkowie",
      active30d: "Aktywni / 30 dni",
      pending: "Oczekujący",
      groups: "Grupy",
      threads: "Tematy",
      banned: "Zablokowani",
      leads: "Prowadzący",
      moderators: "Moderatorzy",
    },

    comingSoon: {
      threads: "Tematy pojawią się w kolejnym etapie wdrożenia.",
      invitations: "System zaproszeń pojawi się w kolejnym etapie wdrożenia.",
      moderation: "Kolejka moderacji pojawi się w kolejnym etapie wdrożenia.",
    },
  },
};

export const clubEn = {
  club: {
    title: "Discussion clubs",
    subtitle:
      "Lasting spaces for member-to-member conversation - own identity, rules and archive.",
    myClubs: "My clubs",
    discover: "Discover",
    invitations: "Invitations",
    membersOnlyTitle: "Discussion clubs require signing in",
    membersOnlyBody: "Sign in or create an account to join clubs and take part in discussions.",
    empty: "You do not belong to any club yet.",
    emptyDiscover: "No clubs available to you right now.",
    loadError: "Failed to load clubs.",
    retry: "Try again",
    open: "Open",
    join: "Join",
    requestJoin: "Request access",
    membersCount_one: "{{count}} member",
    membersCount_other: "{{count}} members",
    threadsCount_one: "{{count}} topic",
    threadsCount_other: "{{count}} topics",
    groupsCount_one: "{{count}} group",
    groupsCount_other: "{{count}} groups",
    lastActivity: "Last activity",
    never: "No activity",
    rules: "Club rules",
    about: "About",
    members: "Members",
    groups: "Groups",

    visibility: {
      public: "Public",
      members: "Signed-in members",
      private: "Private",
      secret: "Hidden",
    },
    visibilityHint: {
      public: "Visible to everyone and indexed by search engines.",
      members: "Visible to signed-in members of the community.",
      private: "Card visible to signed-in users, content only to members.",
      secret: "Visible exclusively to club members.",
    },
    joinPolicy: {
      open: "Open entry",
      request: "On request",
      invite: "By invitation",
    },
    attribution: {
      attributed: "Attributed posts",
      chatham: "Chatham House rule",
      anonymous_allowed: "Author decides",
    },
    attributionHint: {
      attributed: "Every post is signed with the author's name.",
      chatham:
        "Content is quotable, identity is not. Posts appear under a per-thread pseudonym.",
      anonymous_allowed: "The author decides per post whether to sign it.",
    },
    whoCanPost: {
      members: "Any member can start a topic",
      moderators: "Leads and moderators start topics",
      staff_only: "Only editorial staff start topics",
    },
    moderation: {
      post: "Moderate after publishing",
      pre: "Pre-moderate everything",
      trusted: "Pre-moderate new accounts",
    },
    role: {
      lead: "Lead",
      moderator: "Moderator",
      member: "Member",
      observer: "Observer",
      non_member: "Not a member",
      banned: "Banned",
    },
    memberStatus: {
      active: "Active",
      pending: "Pending",
      invited: "Invited",
      banned: "Banned",
      left: "Left",
    },
    status: {
      draft: "Draft",
      active: "Active",
      archived: "Archived",
    },
    groupStatus: {
      draft: "Draft",
      scheduled: "Scheduled",
      active: "Active",
      frozen: "Frozen",
      archived: "Archived",
    },

    reason: {
      not_found: "This club does not exist or is not available to you.",
      auth_required: "Sign in to view this club.",
      not_member: "You are not a member of this club. Request access to read discussions.",
      tier_too_low: "This club requires a higher membership plan.",
      group_frozen: "This group is frozen - you can read, but not post.",
      not_open_yet: "This space has not opened yet.",
      window_closed: "The discussion window has closed. The content remains readable.",
      archived: "This club is archived.",
      banned: "Your access to this club has been blocked.",
      pre_moderation: "Your posts go to a moderator for approval first.",
    },
    inheritedFromClub: "Inherited from club",
  },

  adminClubs: {
    navLabel: "Discussion clubs",
    title: "Discussion clubs",
    subtitle: "Structure, permissions and memberships. Members create content within the scope you grant.",
    newClub: "New club",
    editClub: "Edit club",
    noPermissionTitle: "No permission",
    noPermissionBody: "Managing discussion clubs is available to administrators only.",
    empty: "No clubs yet. Start with the first one.",
    emptyFiltered: "No clubs match the selected filters.",
    loadError: "Failed to load clubs.",
    searchPlaceholder: "Search by name or slug...",
    filterStatus: "Status",
    filterVisibility: "Visibility",
    filterAny: "Any",
    saved: "Saved",
    saveFailed: "Failed to save",
    slugTaken: "This slug is already taken in this tenant.",
    requiredFields: "Name and slug are required.",

    columns: {
      name: "Name",
      visibility: "Visibility",
      groups: "Groups",
      members: "Members",
      threads: "Topics",
      pending: "Pending",
      leads: "Leads",
      lastActivity: "Last activity",
      status: "Status",
      actions: "Actions",
      role: "Role",
      joined: "Joined",
      roleExpires: "Term until",
      inviteSource: "Source",
    },

    tabs: {
      general: "General",
      access: "Access",
      groups: "Groups",
      threads: "Topics",
      members: "Members",
      invitations: "Invitations",
      permissions: "Permissions",
      moderation: "Moderation",
      analytics: "Analytics",
    },

    fields: {
      namePl: "Name (PL)",
      nameEn: "Name (EN)",
      slug: "Slug",
      slugHint: "Lowercase letters, digits and hyphens. Changing it breaks existing links.",
      taglinePl: "Tagline (PL)",
      taglineEn: "Tagline (EN)",
      descriptionPl: "Description (PL)",
      descriptionEn: "Description (EN)",
      rulesPl: "Rules (PL)",
      rulesEn: "Rules (EN)",
      rulesHint: "Rules are shown before entering the club, not after.",
      icon: "Icon",
      accentColor: "Accent colour",
      coverImage: "Cover image",
      policyArea: "Policy area",
      visibility: "Visibility",
      joinPolicy: "Join policy",
      minTier: "Minimum plan",
      minTierNone: "No requirement",
      attributionMode: "Attribution mode",
      whoCanPost: "Who starts topics",
      moderationMode: "Moderation mode",
      status: "Status",
      opensAt: "Opens at",
      closesAt: "Closes at",
      sortOrder: "Order",
    },

    accessPreviewTitle: "What this means for the user",
    accessPreviewTier: "Requires a plan of rank {{rank}} or higher.",
    accessPreviewNoTier: "No plan requirement.",
    accessWarning: {
      title: "Worth confirming",
      public_open:
        "A public club with open entry: any anonymous visitor sees the content and any account joins without a human decision.",
      secret_public_entry:
        "A hidden club with open entry is contradictory - nobody outside the club can see it, so open entry cannot take effect.",
      chatham_public:
        "The Chatham House rule in a public club means anonymity towards readers who cannot be counted.",
    },

    groups: {
      title: "Topic groups",
      hint: "A group gives its own subscription, its own permissions and its own rhythm. A club without groups becomes unusable after three months.",
      newGroup: "New group",
      editGroup: "Edit group",
      empty: "This club only has the default group.",
      reorderHint: "Drag to reorder.",
      reordered: "Order saved",
      inherit: "Inherit from club",
      override: "Override",
    },

    members: {
      title: "Club members",
      add: "Add person",
      addHint: "The person must belong to the same workspace.",
      added: "Added to the club",
      removed: "Removed from the club",
      removeConfirmTitle: "Remove {{name}} from the club?",
      removeConfirmBody:
        "Removal allows them to return. To cut access permanently, set status to Banned.",
      roleChanged: "Role changed",
      empty: "This club has no members yet.",
      filterStatus: "Membership status",
      roleExpiresHint: "After this date the role reverts to Member.",
      roleExpired: "Term expired",
    },

    permissions: {
      title: "Capability matrix",
      hint: "Rows are capabilities, columns are roles. The same function computes access in the database and here.",
      previewAs: "Preview as...",
      previewHint: "Shows the result of club_capabilities() for the selected person, including the denial reason.",
      previewEmpty: "Pick a person to see their real permissions.",
      effectiveRole: "Effective role",
      reasonLabel: "Reason",
      reasonNone: "No obstacles",
      caps: {
        can_read: "Reads the club",
        can_post_thread: "Starts a topic",
        can_reply: "Replies",
        can_react: "Reacts",
        can_moderate: "Moderates content",
        can_manage: "Manages structure",
        can_invite: "Invites",
        can_see_members: "Sees members",
        can_reveal_author: "Reveals author",
      },
      roles: {
        super_admin: "Super admin",
        admin: "Administrator",
        editor: "Editor",
        lead: "Lead",
        moderator: "Moderator",
        member: "Member",
        observer: "Observer",
        non_member: "Non-member",
      },
      value: {
        yes: "Yes",
        no: "No",
        conditional: "Depends on settings",
      },
    },

    stats: {
      title: "Club statistics",
      members: "Members",
      active30d: "Active / 30 days",
      pending: "Pending",
      groups: "Groups",
      threads: "Topics",
      banned: "Banned",
      leads: "Leads",
      moderators: "Moderators",
    },

    comingSoon: {
      threads: "Topics arrive in the next implementation stage.",
      invitations: "The invitation system arrives in the next implementation stage.",
      moderation: "The moderation queue arrives in the next implementation stage.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", clubPl, true, true);
i18n.addResourceBundle("en", "translation", clubEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść bundle tłumaczeń
 * do chunka trasy - side-effectowy import w pliku trasy lądował w eager-owym
 * grafie wejściowym każdej strony, a budżety bundla są dziś czerwone.
 */
export function ensureClubI18n(): void {}
