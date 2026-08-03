// Role systemowe (`public.app_role`) - jedno źródło prawdy po stronie klienta.
//
// Kolejność listy = malejący zakres przywilejów i JEDNOCZEŚNIE kolejność kolumn
// w macierzy uprawnień. Zbiór wartości pilnuje test parytetu: musi zgadzać się z
// enumem odtworzonym z migracji (patrz src/lib/authz/__tests__), więc dodanie
// roli w bazie bez kolumny w macierzy obleje CI zamiast cicho zniknąć z audytu.

export const APP_ROLES = ["super_admin", "admin", "editor", "author", "user"] as const;

export type AppRole = (typeof APP_ROLES)[number];

const APP_ROLE_SET: ReadonlySet<string> = new Set(APP_ROLES);

export function isAppRole(value: string): value is AppRole {
  return APP_ROLE_SET.has(value);
}

/**
 * Rola `user` nie ma własnego wiersza w `user_roles` - to stan "zalogowany bez
 * roli redakcyjnej". Żadna bramka nie wymienia jej po nazwie, więc w macierzy
 * kolumna `user` pokazuje wyłącznie to, co daje warstwa członkostwa.
 */
export const IMPLICIT_ROLES: readonly AppRole[] = ["user"];

export function isImplicitRole(role: AppRole): boolean {
  return IMPLICIT_ROLES.includes(role);
}
