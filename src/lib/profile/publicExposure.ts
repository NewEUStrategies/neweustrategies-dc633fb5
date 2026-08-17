// Ekspozycja publiczna WŁASNEGO profilu - model i czysta logika.
//
// Panel prywatności obiecywał wcześniej płasko: „osoby niezalogowane i roboty
// wyszukiwarek nie mają dostępu do Twojego profilu". Obietnica była nieprawdziwa
// w OBIE strony:
//
//   * dla zwykłego członka - bo widok `profiles_public` (definer, GRANT dla
//     `anon`) serwował 22-kolumnową projekcję KAŻDEGO profilu tenanta; dziurę
//     zamyka migracja 20260806160000 (dwie warstwy widoczności w bazie);
//   * dla autora i eksperta - bo ich hub /author/$slug jest publiczny Z ZAŁOŻENIA
//     i żadna bramka tego nie zmieni.
//
// Dlatego zamiast jednego zdania „nigdy" pokazujemy STAN wraz z POWODEM. Powody
// są wprost przekładalne na działanie użytkownika (cofnąć opt-in profilu
// autorskiego, poprosić o zdjęcie odznaki), więc nota staje się sterowalna.
//
// Ten moduł jest CZYSTY (zero I/O, zero React) - odczyt z bazy mieszka w
// `usePublicExposure.ts`. Rozdział jest celowy: molekuła prezentacyjna i testy
// jednostkowe nie mogą ciągnąć za sobą klienta Supabase.

/** Stan ekspozycji własnego profilu poza platformą. */
export interface PublicExposure {
  /** Czy profil jest osiągalny dla osoby NIEZALOGOWANEJ (warstwa publiczna widoku). */
  isPublic: boolean;
  /** Opt-in do wewnętrznej wyszukiwarki osób (BEZ wpływu na warstwę publiczną). */
  discoverable: boolean;
  byEditorialRole: boolean;
  byExpertBadge: boolean;
  byAuthorProfile: boolean;
  bySpeakerProfile: boolean;
  byPublishedContent: boolean;
}

/** Powód ekspozycji - klucz i18n `profilePrivacy.exposureReason.<powód>`. */
export type ExposureReason =
  "editorialRole" | "expertBadge" | "authorProfile" | "speakerProfile" | "publishedContent";

/** Zachowawczy stan wyjściowy: nic nie jest publiczne, dopóki baza nie powie inaczej. */
export const EXPOSURE_NONE: PublicExposure = {
  isPublic: false,
  discoverable: false,
  byEditorialRole: false,
  byExpertBadge: false,
  byAuthorProfile: false,
  bySpeakerProfile: false,
  byPublishedContent: false,
};

/** Kolejność prezentacji: od powodu najtrudniejszego do cofnięcia (rola) po
 *  najbardziej „zasłużony" (opublikowane materiały). */
const REASON_ORDER: readonly ExposureReason[] = [
  "editorialRole",
  "expertBadge",
  "authorProfile",
  "speakerProfile",
  "publishedContent",
] as const;

const REASON_FLAG: Readonly<Record<ExposureReason, keyof PublicExposure>> = {
  editorialRole: "byEditorialRole",
  expertBadge: "byExpertBadge",
  authorProfile: "byAuthorProfile",
  speakerProfile: "bySpeakerProfile",
  publishedContent: "byPublishedContent",
};

/** Powody ekspozycji w stabilnej kolejności (pusta lista = brak sygnałów). */
export function exposureReasons(exposure: PublicExposure): ExposureReason[] {
  return REASON_ORDER.filter((reason) => exposure[REASON_FLAG[reason]] === true);
}

/** Wiersz RPC `get_my_public_exposure()` (snake_case, kolumny nullowalne). */
export interface RawExposureRow {
  is_public?: boolean | null;
  discoverable?: boolean | null;
  by_editorial_role?: boolean | null;
  by_expert_badge?: boolean | null;
  by_author_profile?: boolean | null;
  by_speaker_profile?: boolean | null;
  by_published_content?: boolean | null;
}

/**
 * Wiersz RPC → model widoku. Brak wiersza (konto bez profilu) i każdy `null`
 * degradują się do `false`: nota nie może OBIECYWAĆ publiczności, której nie
 * potwierdziła baza - ani odwrotnie, ogłaszać prywatności na podstawie luki.
 */
export function normalizeExposure(row: RawExposureRow | null | undefined): PublicExposure {
  if (!row) return EXPOSURE_NONE;
  return {
    isPublic: row.is_public === true,
    discoverable: row.discoverable === true,
    byEditorialRole: row.by_editorial_role === true,
    byExpertBadge: row.by_expert_badge === true,
    byAuthorProfile: row.by_author_profile === true,
    bySpeakerProfile: row.by_speaker_profile === true,
    byPublishedContent: row.by_published_content === true,
  };
}
