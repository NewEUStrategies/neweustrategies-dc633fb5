// Macierz zdolności Discussion Club jako DANE, nie jako komentarz.
//
// V2 §2.4 opisuje macierz w tabeli markdown. Tabela w dokumencie rozjeżdża się
// z kodem przy pierwszej zmianie, więc macierz żyje tutaj i jest źródłem dla:
//   1. zakładki "Uprawnienia" w panelu (render wiersz po wierszu),
//   2. bloku `club` w macierzy /admin/permissions,
//   3. testu kontraktowego, który porównuje ją z zachowaniem club_capabilities().
//
// UWAGA CO DO STATUSU TEGO PLIKU: to jest DOKUMENTACJA zachowania bazy, a nie
// jego źródło. Autoryzację rozstrzyga wyłącznie public.club_capabilities().
// Gdyby te dwa źródła się rozjechały, prawdą jest baza - dlatego zakładka
// "Podgląd jako..." pyta bazę, a nie tę tablicę.

import type { ClubCapabilities } from "./types";

/** Kolumny macierzy: role platformy + role klubowe + brak członkostwa. */
export const CAPABILITY_ROLES = [
  "super_admin",
  "admin",
  "editor",
  "lead",
  "moderator",
  "member",
  "observer",
  "non_member",
] as const;
export type CapabilityRole = (typeof CAPABILITY_ROLES)[number];

/** Wiersze macierzy: klucze pól zwracanych przez club_capabilities(). */
export const CAPABILITY_KEYS = [
  "can_read",
  "can_post_thread",
  "can_reply",
  "can_react",
  "can_moderate",
  "can_manage",
  "can_invite",
  "can_see_members",
  "can_reveal_author",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/**
 * `yes`  - zawsze wolno
 * `no`   - nigdy nie wolno
 * `cond` - zależy od ustawienia klubu lub grupy (who_can_post, harmonogram,
 *          próg planu). W panelu renderowane jako klikalna komórka.
 */
export type CapabilityValue = "yes" | "no" | "cond";

type MatrixRow = Record<CapabilityRole, CapabilityValue>;

/**
 * Macierz odwzorowuje gałęzie z migracji 20260808090000 (funkcja
 * club_capabilities). Każde `cond` ma tam odpowiadającą gałąź warunkową.
 */
export const CLUB_CAPABILITY_MATRIX: Record<CapabilityKey, MatrixRow> = {
  // Czytanie: staff zawsze; członek zawsze; nie-członek zależnie od
  // widoczności (public/members tak, private/secret nie).
  can_read: {
    super_admin: "yes",
    admin: "yes",
    editor: "cond",
    lead: "yes",
    moderator: "yes",
    member: "yes",
    observer: "yes",
    non_member: "cond",
  },
  // Zakładanie tematu: lead i moderator zawsze; member i editor zależnie od
  // who_can_post; observer nigdy (jest z definicji cichy).
  can_post_thread: {
    super_admin: "yes",
    admin: "yes",
    editor: "cond",
    lead: "yes",
    moderator: "yes",
    member: "cond",
    observer: "no",
    non_member: "no",
  },
  can_reply: {
    super_admin: "yes",
    admin: "yes",
    editor: "cond",
    lead: "yes",
    moderator: "yes",
    member: "yes",
    observer: "no",
    non_member: "no",
  },
  can_react: {
    super_admin: "yes",
    admin: "yes",
    editor: "cond",
    lead: "yes",
    moderator: "yes",
    member: "yes",
    observer: "no",
    non_member: "no",
  },
  // Moderacja: editor NIE moderuje - to praca redakcyjna, nie moderatorska.
  can_moderate: {
    super_admin: "yes",
    admin: "yes",
    editor: "no",
    lead: "yes",
    moderator: "yes",
    member: "no",
    observer: "no",
    non_member: "no",
  },
  // Struktura należy WYŁĄCZNIE do staffu (V2 §0). Lead prowadzi klub,
  // ale nie zmienia jego widoczności ani nie zakłada grup.
  can_manage: {
    super_admin: "yes",
    admin: "yes",
    editor: "no",
    lead: "no",
    moderator: "no",
    member: "no",
    observer: "no",
    non_member: "no",
  },
  can_invite: {
    super_admin: "yes",
    admin: "yes",
    editor: "no",
    lead: "yes",
    moderator: "no",
    member: "no",
    observer: "no",
    non_member: "no",
  },
  can_see_members: {
    super_admin: "yes",
    admin: "yes",
    editor: "cond",
    lead: "yes",
    moderator: "yes",
    member: "yes",
    observer: "yes",
    non_member: "cond",
  },
  // Ujawnienie autora anonimowej wypowiedzi: WYŁĄCZNIE staff. Lead jest stroną
  // dyskusji, więc dostęp do tożsamości byłby konfliktem interesu (V2 §2.4).
  can_reveal_author: {
    super_admin: "yes",
    admin: "yes",
    editor: "no",
    lead: "no",
    moderator: "no",
    member: "no",
    observer: "no",
    non_member: "no",
  },
};

/**
 * Inwariant, którego nie wolno złamać: super_admin przechodzi każdą bramkę,
 * którą przechodzi admin (V2 §2.3, lekcja z profiles_guard_verification).
 * Wystawione jako funkcja, bo sprawdza to zarówno test jednostkowy, jak
 * i bramka parytetu uprawnień.
 */
export function superAdminCoversAdmin(): boolean {
  return CAPABILITY_KEYS.every((key) => {
    const row = CLUB_CAPABILITY_MATRIX[key];
    if (row.admin === "yes") return row.super_admin === "yes";
    if (row.admin === "cond") return row.super_admin === "yes" || row.super_admin === "cond";
    return true;
  });
}

/** Odczyt pojedynczej komórki - używany przez render zakładki. */
export function capabilityValue(key: CapabilityKey, role: CapabilityRole): CapabilityValue {
  return CLUB_CAPABILITY_MATRIX[key][role];
}

/** Mapowanie klucza macierzy na pole znormalizowanych zdolności z RPC. */
const CAPABILITY_FIELD: Record<CapabilityKey, keyof ClubCapabilities> = {
  can_read: "canRead",
  can_post_thread: "canPostThread",
  can_reply: "canReply",
  can_react: "canReact",
  can_moderate: "canModerate",
  can_manage: "canManage",
  can_invite: "canInvite",
  can_see_members: "canSeeMembers",
  can_reveal_author: "canRevealAuthor",
};

/**
 * Odczytuje pojedynczą zdolność z wyniku RPC po kluczu macierzy. Pozwala
 * zakładce "Podgląd jako..." renderować te same wiersze co macierz, ale
 * z realnymi wartościami z bazy.
 */
export function readCapability(caps: ClubCapabilities, key: CapabilityKey): boolean {
  const field = CAPABILITY_FIELD[key];
  const value = caps[field];
  return value === true;
}
