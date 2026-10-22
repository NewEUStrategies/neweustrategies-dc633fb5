// i18n akcji zbiorczej zadań CRM (I9, Z-S7-02 / P24) - PL/EN.
//
// „Przypisz zadania bez osoby" na liście kontaktów CRM: ten sam zapis modułu
// (`assignUnassignedCrmTasks`, server fn S4), który hub woła jako szybką
// naprawę reguły `crm.tasks_unassigned`. Własny mały słownik, bo lista CRM
// trzyma resztę napisów lokalnie, a nowy tekst ma mieć parytet PL/EN
// pilnowany typem (`en: typeof pl`).
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN czyta tylko `_one/_other`.
//
// UWAGA NA ARKUSZ CSS: pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - żadne słowo nie jest nazwą klasy narzędziowej.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminCrmTasks: {
    assignUnassigned: {
      action: "Przypisz zadania bez osoby",
      confirmTitle: "Przypisać otwarte zadania bez osoby?",
      confirmBody:
        "Każde otwarte zadanie bez osoby trafi do właściciela swojego leada. Zadań leadów bez właściciela nie ruszamy - osobę dla nich wskażesz w Diagnostyce huba „Przychód i lejek”. Przypisania nie da się cofnąć jednym ruchem.",
      confirm: "Przypisz",
      cancel: "Anuluj",
      assigned_one: "Przypisano {{count}} zadanie właścicielowi leada.",
      assigned_few: "Przypisano {{count}} zadania właścicielom leadów.",
      assigned_many: "Przypisano {{count}} zadań właścicielom leadów.",
      assigned_other: "Przypisano {{count}} zadania właścicielom leadów.",
      none: "Nie ma otwartych zadań bez osoby, które można przypisać właścicielowi leada.",
      remaining_one:
        "{{count}} zadanie zostało bez osoby (lead bez właściciela) - wskaż osobę w Diagnostyce huba.",
      remaining_few:
        "{{count}} zadania zostały bez osoby (leady bez właściciela) - wskaż osobę w Diagnostyce huba.",
      remaining_many:
        "{{count}} zadań zostało bez osoby (leady bez właściciela) - wskaż osobę w Diagnostyce huba.",
      remaining_other:
        "{{count}} zadania zostało bez osoby (leady bez właściciela) - wskaż osobę w Diagnostyce huba.",
      failed: "Nie udało się przypisać zadań. Spróbuj ponownie.",
    },
  },
};

const en: typeof pl = {
  adminCrmTasks: {
    assignUnassigned: {
      action: "Assign tasks without a person",
      confirmTitle: "Assign open tasks without a person?",
      confirmBody:
        "Every open task without a person goes to the owner of its lead. Tasks of leads without an owner stay as they are - pick a person for them in the “Revenue and funnel” hub diagnostics. The assignment cannot be undone in one step.",
      confirm: "Assign",
      cancel: "Cancel",
      assigned_one: "Assigned {{count}} task to its lead owner.",
      assigned_few: "Assigned {{count}} tasks to lead owners.",
      assigned_many: "Assigned {{count}} tasks to lead owners.",
      assigned_other: "Assigned {{count}} tasks to lead owners.",
      none: "There are no open tasks without a person that a lead owner could take.",
      remaining_one:
        "{{count}} task still has no person (lead without an owner) - pick one in the hub diagnostics.",
      remaining_few:
        "{{count}} tasks still have no person (leads without an owner) - pick one in the hub diagnostics.",
      remaining_many:
        "{{count}} tasks still have no person (leads without an owner) - pick one in the hub diagnostics.",
      remaining_other:
        "{{count}} tasks still have no person (leads without an owner) - pick one in the hub diagnostics.",
      failed: "Could not assign the tasks. Try again.",
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu ładują nakładki globem i liczą na efekt importu.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
