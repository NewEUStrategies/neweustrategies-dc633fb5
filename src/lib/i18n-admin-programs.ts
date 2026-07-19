// Zasoby i18n dla /admin/programs - listy, edytor programu, dialog członków.
import i18n from "@/lib/i18n";

const pl = {
  adminPrograms: {
    title: "Programy",
    subtitle: "Programy, projekty i departamenty oraz przypisani eksperci.",
    newProgram: "Nowy program",
    empty: "Brak programów. Dodaj pierwszy.",
    members: "Członkowie",
    inactive: "nieaktywny",
    kind: { program: "Program", project: "Projekt", department: "Departament" },
    dialog: {
      editTitle: "Edytuj program",
      newTitle: "Nowy program",
      namePl: "Nazwa (PL)",
      nameEn: "Nazwa (EN)",
      kindLabel: "Rodzaj",
      order: "Kolejność",
      descPl: "Opis (PL)",
      descEn: "Opis (EN)",
      active: "Aktywny",
      cancel: "Anuluj",
      save: "Zapisz",
    },
    validation: {
      slug: "Slug: małe litery, cyfry i myślniki.",
      names: "Nazwa PL i EN są wymagane.",
    },
    remove: {
      title: "Usunąć program?",
      description: '„{{name}}" i przypisania członków zostaną usunięte.',
    },
    membersDialog: {
      title: "członkowie",
      empty: "Brak przypisanych ekspertów.",
      addExpert: "Dodaj eksperta",
      selectUser: "Wybierz użytkownika",
      rolePl: "Funkcja (PL)",
      roleEn: "Funkcja (EN)",
      assign: "Przypisz",
      close: "Zamknij",
    },
  },
};

const en = {
  adminPrograms: {
    title: "Programs",
    subtitle: "Programs, projects and departments, and their assigned experts.",
    newProgram: "New program",
    empty: "No programs yet. Add the first one.",
    members: "Members",
    inactive: "inactive",
    kind: { program: "Program", project: "Project", department: "Department" },
    dialog: {
      editTitle: "Edit program",
      newTitle: "New program",
      namePl: "Name (PL)",
      nameEn: "Name (EN)",
      kindLabel: "Kind",
      order: "Sort order",
      descPl: "Description (PL)",
      descEn: "Description (EN)",
      active: "Active",
      cancel: "Cancel",
      save: "Save",
    },
    validation: {
      slug: "Slug: lowercase, digits, dashes.",
      names: "PL and EN name required.",
    },
    remove: {
      title: "Delete program?",
      description: '"{{name}}" and member assignments will be removed.',
    },
    membersDialog: {
      title: "members",
      empty: "No experts assigned.",
      addExpert: "Add expert",
      selectUser: "Select a user",
      rolePl: "Role (PL)",
      roleEn: "Role (EN)",
      assign: "Assign",
      close: "Close",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
