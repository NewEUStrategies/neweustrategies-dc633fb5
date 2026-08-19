// Format klucza technicznego w panelach redakcyjnych.
//
// Klucze warstw członkostwa (`membership_tiers.key`) i segmentów cennika
// (`pricing_audiences.key`) trafiają do adresów URL, do `access_plans.tier_key`
// i do `membership_tiers.audience_key`, więc dopuszczamy wyłącznie małe litery,
// cyfry, `_` i `-`, 2-32 znaki. Wielka litera albo spacja dają klucz, który
// wygląda poprawnie w panelu, a nie dopasowuje się przy odczycie.
//
// Ten sam warunek istniał w TRZECH miejscach: jako `AUDIENCE_KEY_RE` w trasie
// `/admin/pricing`, jako wyrażenie wklejone wprost w okno „nowa warstwa"
// w `/admin/membership` i jako trzecia kopia w `lib/pricing/selectors`, gdzie
// filtruje parametr `?audience=` z adresu. Trzy kopie tej samej reguły to trzy
// miejsca, w których można ją poluzować niezależnie - a rozjazd między
// walidacją zapisu i walidacją odczytu daje klucz zapisywalny i nieczytelny.
//
// Reguła jest bezdomenowa (nie `lib/admin/`, nie `lib/pricing/`), bo korzysta
// z niej i panel, i strona publiczna.

/** Dozwolony format klucza technicznego: `[a-z0-9_-]`, 2-32 znaki. */
export const SLUG_KEY_RE = /^[a-z0-9_-]{2,32}$/;

/** Klucz musi mieć poprawny format I nie kolidować z już istniejącym. */
export function slugKeyValid(key: string, existingKeys: readonly string[]): boolean {
  return SLUG_KEY_RE.test(key) && !existingKeys.includes(key);
}
