// Współdzielone toasty admina - jednolite komunikaty PL/EN dla operacji CRUD.
// Używane w wielu routach /admin/* aby nie duplikować kluczy dla banalnych
// "Zapisano" / "Usunięto" / "Błąd" etc.
import i18n from "@/lib/i18n";

const pl = {
  adminToasts: {
    saved: "Zapisano",
    deleted: "Usunięto",
    sent: "Wysłano",
    added: "Dodano",
    updated: "Zaktualizowano",
    error: "Wystąpił błąd",
    nameRequired: "Nazwa wymagana",
    keyRequired: "Klucz jest wymagany",
    emptyContent: "Pusta treść",
    fileTooBig: "Plik za duży (max 5 MB)",
    imageRequired: "Wymagany plik graficzny",
    missingTenant: "Brak kontekstu tenanta",
    labelRequired: "Podaj etykietę PL lub EN",
    prewarmDone: "Pre-warm zakończony",
    settingsSaved: "Ustawienia zapisane",
    layoutSaved: "Zapisano - layout został zaktualizowany",
  },
};

const en = {
  adminToasts: {
    saved: "Saved",
    deleted: "Deleted",
    sent: "Sent",
    added: "Added",
    updated: "Updated",
    error: "An error occurred",
    nameRequired: "Name is required",
    keyRequired: "Key is required",
    emptyContent: "Content is empty",
    fileTooBig: "File too big (max 5 MB)",
    imageRequired: "Image file required",
    missingTenant: "Missing tenant context",
    labelRequired: "Provide a PL or EN label",
    prewarmDone: "Pre-warm complete",
    settingsSaved: "Settings saved",
    layoutSaved: "Saved - layout has been updated",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
