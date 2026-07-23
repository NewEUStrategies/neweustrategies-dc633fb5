import i18n from "./i18n";

// Overlay dla moderacji zbiorczej komentarzy (kolejka /admin/comments). Bazowe
// klucze adminComments.* żyją w locale/pl|en; tu DOKŁADAMY podklucze zaznaczenia
// i akcji zbiorczych (deep-merge addResourceBundle), żeby zmiana pozostała
// skupiona i nie ruszała wielkich plików locale. Parytet PL/EN wymuszony przez
// `en: typeof pl` na etapie kompilacji.

const pl = {
  adminComments: {
    selection: {
      selectRow: "Zaznacz komentarz",
      selectAll: "Zaznacz widoczne",
      count: "Zaznaczono: {{count}}",
      clear: "Wyczyść",
    },
    bulk: {
      approve: "Zatwierdź zaznaczone",
      spam: "Oznacz jako spam",
      delete: "Usuń zaznaczone",
      done: "Zaktualizowano komentarze: {{count}}",
      confirmTitle: "Potwierdź akcję zbiorczą",
      confirmSpamBody: "Oznaczyć zaznaczone komentarze jako spam? Dotyczy: {{count}}.",
      confirmDeleteBody: "Usunąć zaznaczone komentarze? Dotyczy: {{count}}.",
      confirm: "Wykonaj",
      cancel: "Anuluj",
    },
  },
};

const en: typeof pl = {
  adminComments: {
    selection: {
      selectRow: "Select comment",
      selectAll: "Select visible",
      count: "Selected: {{count}}",
      clear: "Clear",
    },
    bulk: {
      approve: "Approve selected",
      spam: "Mark as spam",
      delete: "Delete selected",
      done: "Comments updated: {{count}}",
      confirmTitle: "Confirm bulk action",
      confirmSpamBody: "Mark the selected comments as spam? Affects: {{count}}.",
      confirmDeleteBody: "Delete the selected comments? Affects: {{count}}.",
      confirm: "Apply",
      cancel: "Cancel",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/** No-op wołany w komponencie, by rejestracja bundla nie została wytrzepana. */
export function ensureI18n(): void {}
