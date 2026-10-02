// Role modułu "Wprowadzenia" - CZYSTY moduł (bez Reacta i bez klienta
// przeglądarkowego), bo czyta go także server fn eksportu RODO.
//
// Lista jest JEDYNYM źródłem ról po stronie klienta i odpowiada 1:1 gałęziom
// `CASE p_role` w `my_introduction_requests` (20261002100000). Generator typów
// Supabase typuje `p_role` jako `string` (parametr TEXT), więc wywołanie
// `{ p_role: "all" }` się kompilowało, a baza odpowiadała pustą listą
// (`ELSE FALSE`) - tak eksport RODO przez cały czas istnienia sekcji
// `network_introductions` oddawał `[]`. `types.ts` jest regenerowany, więc
// zawężenie mieszka tutaj, nie tam.

export const INTRODUCTION_ROLES = ["requester", "bridge", "target"] as const;

/** Rola z perspektywy zalogowanego użytkownika. Bez "all" - patrz useIntroductions.ts. */
export type IntroductionRole = (typeof INTRODUCTION_ROLES)[number];
