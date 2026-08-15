// Etykiety ról systemowych dla interfejsu - jedno miejsce dla obu ekranów
// administracji użytkowników (lista i karta).
//
// SKĄD SIĘ WZIĄŁ TEN MODUŁ. Oba ekrany wołały `t(\`admin.users.roles.${r}\`)`
// z kluczem SKLEJANYM z identyfikatora roli i ratunkowym `defaultValue`
// postaci `r.charAt(0).toUpperCase() + r.slice(1)`. Skutek był podwójnie zły:
//
//   * klucza `admin.users.roles.*` nie było w ŻADNYM słowniku, więc realnie
//     renderował się zawsze `defaultValue` - angielski identyfikator z wielkiej
//     litery ("Editor", "Author") pokazywany również w polskim interfejsie;
//   * klucz sklejany jest niewidoczny dla bramki parytetu i dryfu, więc ten
//     brak nie miał jak się ujawnić inaczej niż na produkcji.
//
// Mapa poniżej jest domknięta po `AppRole`, więc dołożenie roli w
// `APP_ROLES` bez etykiety jest błędem kompilacji - dokładnie tak, jak dodanie
// roli w bazie bez kolumny w macierzy uprawnień oblewa test parytetu enumu.
import type { TFunction } from "i18next";
import type { AppRole } from "./roles";

export const ROLE_LABEL_KEYS: Readonly<Record<AppRole, string>> = {
  super_admin: "admin.users.roles.super_admin",
  admin: "admin.users.roles.admin",
  editor: "admin.users.roles.editor",
  author: "admin.users.roles.author",
  user: "admin.users.roles.user",
};

/** Przetłumaczona nazwa roli. Klucze są statyczne - patrz komentarz modułu. */
export function roleLabel(t: TFunction, role: AppRole): string {
  return t(ROLE_LABEL_KEYS[role]);
}
