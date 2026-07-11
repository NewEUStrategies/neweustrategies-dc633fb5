// Supplementary i18n bundle for the cross-module cohesion layer (PL/EN):
// presence per encja, panel powiązań (graf cross_references), badge'e
// zmaterializowanych liczników. Side-effect import this module wherever the
// feature mounts:
//   import "@/lib/i18n-cohesion";
// The pl/en objects are exported so the parity test can verify both trees
// stay structurally identical (same rule as the core locale files).
import i18n from "./i18n";

export const cohesionPl = {
  cohesion: {
    presence: {
      viewingNow_one: "{{count}} osoba przegląda teraz ten element",
      viewingNow_few: "{{count}} osoby przeglądają teraz ten element",
      viewingNow_many: "{{count}} osób przegląda teraz ten element",
      viewingNow_other: "{{count}} osób przegląda teraz ten element",
      here: "Tu teraz:",
      alsoHere: "{{name}} też tu teraz jest",
    },
    linked: {
      title: "Powiązane elementy",
      empty: "Brak powiązań z innymi modułami",
      loadError: "Nie udało się wczytać powiązań",
      open: "Otwórz",
      relation: {
        mention: "wzmianka",
        belongs_to: "należy do",
        related: "powiązane",
      },
      type: {
        post: "Artykuł",
        page: "Strona",
        comment: "Komentarz",
        crm_lead: "Lead CRM",
        crm_note: "Notatka CRM",
        profile: "Profil",
        message: "Wiadomość",
        newsletter_subscriber: "Subskrybent newslettera",
        unknown: "Element",
      },
    },
    counters: {
      notificationsUnread: "Nieprzeczytane powiadomienia",
      chatUnread: "Nieprzeczytane wiadomości",
      commentsPending: "Komentarze do moderacji",
      crmLeadsNew: "Nowe leady w CRM",
    },
  },
};

export const cohesionEn = {
  cohesion: {
    presence: {
      viewingNow_one: "{{count}} person is viewing this item right now",
      viewingNow_other: "{{count}} people are viewing this item right now",
      here: "Here now:",
      alsoHere: "{{name}} is also here right now",
    },
    linked: {
      title: "Linked items",
      empty: "No links to other modules",
      loadError: "Could not load linked items",
      open: "Open",
      relation: {
        mention: "mention",
        belongs_to: "belongs to",
        related: "related",
      },
      type: {
        post: "Article",
        page: "Page",
        comment: "Comment",
        crm_lead: "CRM lead",
        crm_note: "CRM note",
        profile: "Profile",
        message: "Message",
        newsletter_subscriber: "Newsletter subscriber",
        unknown: "Item",
      },
    },
    counters: {
      notificationsUnread: "Unread notifications",
      chatUnread: "Unread messages",
      commentsPending: "Comments awaiting moderation",
      crmLeadsNew: "New CRM leads",
    },
  },
};

i18n.addResourceBundle("pl", "translation", cohesionPl, true, true);
i18n.addResourceBundle("en", "translation", cohesionEn, true, true);
