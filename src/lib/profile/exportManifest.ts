// Manifest eksportu danych osobowych (RODO art. 15 i 20) - CZYSTY moduł.
//
// PO CO OSOBNY PLIK. Do 2026-08-06 zakres eksportu żył wyłącznie w ciele server
// fn, a jego kompletność była DEKLARACJĄ w komentarzu („zwraca komplet
// danych") i w podtytule na /profile/security. Deklaracja rozjechała się z
// kodem: eksport pomijał CAŁY czat (rozmowy, wiadomości, blokady, przezwiska),
// CAŁY moduł zapytań do ekspertów i KOMPLET rozszerzeń profilu (profil autora,
// doświadczenie, wykształcenie, umiejętności, wyróżnienia, zainteresowania,
// pliki CV, wzmianki medialne, rekomendacje, poparcia, wyświetlenia profilu).
// Osoba, której dane dotyczą, dostawała plik podpisany jako komplet - i nie
// miała jak zauważyć, czego w nim nie ma.
//
// Poprawka jest strukturalna, nie redakcyjna: zakres jest teraz DANYMI
// (rejestr poniżej), payload niesie własny manifest, a bramka
// `assertExportManifestMatches` porównuje deklarację z tym, co realnie
// zbudowała warstwa serwerowa. Sekcja dopisana bez wpisu w rejestrze (albo wpis
// bez sekcji) wywala test, zanim rozjazd trafi do pliku użytkownika.
//
// Wyłączenia są równie ważne jak zawartość: to, czego NIE ma, musi być
// nazwane w pliku razem z powodem - inaczej brak znowu wygląda jak komplet.

/** Wartość przenośna: eksport jest kontraktem JSON, nie zrzutem obiektów JS. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Wersja formatu. Zmiana ZAKRESU sekcji = zmiana wersji (konsument to czyta).
 *
 * v3 (2026-08-22): manifest niesie `truncated`. Do v2 paczka ucięta na sufcie
 * wierszy była w pliku NIEROZRÓŻNIALNA od kompletnej: osoba z 2500 zakładkami
 * dostawała 2000 pozycji pod podpisem „komplet danych" i nie miała jak zauważyć
 * braku. Art. 15 ust. 3 RODO mówi o kopii danych, nie o pierwszych dwóch
 * tysiącach, więc brak tej informacji był defektem kompletności - a nie
 * szczegółem implementacyjnym.
 */
export const PERSONAL_DATA_EXPORT_FORMAT = "nes.personal-data-export.v3" as const;

/** Sufit wierszy sekcji strumieniowej - eksport ma być plikiem, nie zrzutem bazy. */
export const EXPORT_ROW_LIMIT = 2000;
/** Wiadomości bywają najliczniejsze, więc mają własny, wyższy sufit. */
export const EXPORT_MESSAGE_LIMIT = 5000;
/** Lista odwiedzających profil jest zawężona mocniej - to dane o INNYCH osobach. */
export const EXPORT_PROFILE_VIEWERS_LIMIT = 200;

/**
 * Sekcje z sufitem wierszy i jego wysokość.
 *
 * PO CO TO JEST DANYMI. Sufit sam w sobie jest w porządku: eksport ma być
 * plikiem do pobrania, nie zrzutem bazy. Nie w porządku było MILCZENIE o nim -
 * a milczenie brało się stąd, że liczby siedziały wyłącznie w ciele server fn,
 * gdzie nikt ich nie zestawiał z zawartością pliku. Tutaj są rejestrem, więc
 * emiter i manifest czytają JEDNO źródło, a bramka statyczna umie sprawdzić,
 * czy rejestr zgadza się z kodem.
 */
export const EXPORT_SECTION_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  // Zapytania PostgREST z jawnym `.limit(...)`.
  consent_events: EXPORT_ROW_LIMIT,
  reading_history: EXPORT_ROW_LIMIT,
  comments: EXPORT_ROW_LIMIT,
  user_reports_filed: EXPORT_ROW_LIMIT,
  chat_conversations: EXPORT_ROW_LIMIT,
  chat_messages_sent: EXPORT_MESSAGE_LIMIT,
  notifications: EXPORT_ROW_LIMIT,
  invitations_sent: EXPORT_ROW_LIMIT,
  // Sieć kontaktów: RPC stronicujące, sklejane do tego samego sufitu.
  network_connections: EXPORT_ROW_LIMIT,
  network_invitations_sent: EXPORT_ROW_LIMIT,
  network_invitations_received: EXPORT_ROW_LIMIT,
  profile_viewers: EXPORT_PROFILE_VIEWERS_LIMIT,
  // Kluby: jedno RPC z `p_limit`, rozbite na osiem zadeklarowanych sekcji.
  club_memberships: EXPORT_ROW_LIMIT,
  club_applications: EXPORT_ROW_LIMIT,
  club_threads_authored: EXPORT_ROW_LIMIT,
  club_replies_authored: EXPORT_ROW_LIMIT,
  club_stances: EXPORT_ROW_LIMIT,
  club_reactions: EXPORT_ROW_LIMIT,
  club_thread_subscriptions: EXPORT_ROW_LIMIT,
  club_invitations_received: EXPORT_ROW_LIMIT,
});

/**
 * Sekcje pogrupowane dziedzinowo. Grupa jest częścią kontraktu - konsument
 * (i człowiek czytający plik) widzi, że eksport ma wszystkie obszary produktu,
 * a nie tylko te, które ktoś pamiętał.
 */
export const EXPORT_SECTION_GROUPS = {
  /** Tożsamość i podstawa przetwarzania. */
  identity: ["profile", "author_profile", "roles", "badges", "consents", "consent_events"],
  /** Rozszerzenia profilu (CV, dorobek, obecność medialna). */
  profile_extensions: [
    "profile_experiences",
    "profile_education",
    "profile_skills",
    "profile_awards",
    "profile_hobbies",
    "profile_cv_files",
    "media_mentions",
    "personality_results",
  ],
  /** Aktywność czytelnicza i publiczna. */
  activity: [
    "follows",
    "policy_tracker_follows",
    "bookmarks",
    "reading_history",
    "comments",
    "user_reports_filed",
  ],
  /** Sieć kontaktów i reputacja zawodowa. */
  network: [
    "network_connections",
    "network_invitations_sent",
    "network_invitations_received",
    "network_introductions",
    "recommendations_received",
    "recommendations_written",
    "skill_endorsements_given",
    "skill_endorsements_received",
    "profile_viewers",
    "profile_view_stats",
  ],
  /** Czat: metadane rozmów, własne wiadomości, ustawienia par. */
  chat: [
    "chat_conversations",
    "chat_participation",
    "chat_messages_sent",
    "chat_nicknames_set",
    "chat_blocks",
  ],
  /** Zapytania do ekspertów - obie skrzynki. */
  expert_requests: ["expert_requests_sent", "expert_requests_received"],
  /**
   * Kluby dyskusyjne: zgłoszenia, członkostwa, własne wypowiedzi, stanowiska,
   * reakcje. Cały moduł powstał PO wprowadzeniu rejestru i do 2026-08-08 nie był
   * do niego dopięty - eksport milczał o nim także w manifeście, więc brak
   * wyglądał jak „nie korzystam", a nie jak luka w zakresie.
   *
   * `club_applications` doszło 2026-08-11 i jest tu przypadkiem szczególnym:
   * formularz zgłoszeniowy to najbogatszy zbiór danych osobowych w całym module
   * i wzorcowy przykład danych DOSTARCZONYCH przez osobę (art. 20 RODO) - opisała
   * w nim samą siebie. Warstwa serwerowa zwracała je już wcześniej, ale bez wpisu
   * w rejestrze klient ich nie wyjmował: sekcja istniała w bazie i nie istniała
   * w pliku. Notatka komisji (`admin_note`) NIE wchodzi - patrz
   * `EXPORT_EXCLUSIONS.club_admin_notes`.
   */
  clubs: [
    "club_memberships",
    "club_applications",
    "club_threads_authored",
    "club_replies_authored",
    "club_stances",
    "club_reactions",
    "club_thread_subscriptions",
    "club_invitations_received",
  ],
  /** Płatności i uprawnienia zakupowe. */
  commerce: ["orders", "subscriptions", "purchases"],
  /** Preferencje i kanały doręczeń. */
  preferences: [
    "notification_preferences",
    "notifications",
    "push_subscriptions",
    "invitations_sent",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type ExportSectionGroup = keyof typeof EXPORT_SECTION_GROUPS;
export type ExportSectionId = (typeof EXPORT_SECTION_GROUPS)[ExportSectionGroup][number];

/** Płaska lista identyfikatorów sekcji, w kolejności grup. */
export const EXPORT_SECTION_IDS: readonly ExportSectionId[] = Object.values(
  EXPORT_SECTION_GROUPS,
).flat() as ExportSectionId[];

/** Odwrotne odwzorowanie: sekcja -> grupa (konsument grupuje bez zgadywania). */
export const EXPORT_SECTION_GROUP_OF: Readonly<Record<string, ExportSectionGroup>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(EXPORT_SECTION_GROUPS) as ExportSectionGroup[]).flatMap((group) =>
      EXPORT_SECTION_GROUPS[group].map((id) => [id, group] as const),
    ),
  ),
);

export interface ExportExclusion {
  id: string;
  reason_pl: string;
  reason_en: string;
}

/**
 * Czego eksport ŚWIADOMIE nie zawiera - i dlaczego. Lista jedzie do pliku, więc
 * brak jest widoczny dla odbiorcy zamiast być domyślany z pustego miejsca.
 */
export const EXPORT_EXCLUSIONS: readonly ExportExclusion[] = [
  {
    id: "messages_authored_by_others",
    reason_pl:
      "Wiadomości napisane przez Twoich rozmówców. Art. 15 ust. 4 RODO - prawo do kopii nie może naruszać praw i wolności innych osób. Eksportujemy Twoje wiadomości oraz metadane rozmów, w których uczestniczysz.",
    reason_en:
      "Messages written by the people you talk to. GDPR art. 15(4) - the right to a copy must not adversely affect the rights and freedoms of others. We export your own messages plus the metadata of conversations you take part in.",
  },
  {
    id: "club_content_authored_by_others",
    reason_pl:
      "Wypowiedzi innych uczestników w klubach dyskusyjnych, w tym wpisy anonimowe i objęte regułą Chatham House. Art. 15 ust. 4 RODO - prawo do kopii nie może naruszać praw i wolności innych osób, a w klubie ochrona autorstwa jest dodatkowo warunkiem samej rozmowy. Eksportujemy Twoje członkostwa oraz Twoje wypowiedzi - także te opublikowane anonimowo, bo pozostają Twoimi danymi.",
    reason_en:
      "Contributions written by other participants in discussion clubs, including anonymous and Chatham House posts. GDPR art. 15(4) - the right to a copy must not adversely affect the rights and freedoms of others, and in a club the protection of authorship is a precondition of the conversation itself. We export your memberships and your own contributions - including those published anonymously, since they remain your data.",
  },
  {
    id: "club_admin_notes",
    reason_pl:
      "Notatki komisji naboru o kandydacie (pole admin_note w zgłoszeniu do klubu). To wewnętrzna ocena pisana przez członków komisji, a nie dana, którą dostarczyłeś o sobie; w automatycznym pliku jej nie ma, żeby eksport nie zamienił oceny w kanał komunikacji z kandydatem. Sama decyzja i jej data SĄ w eksporcie - bez nich plik nie mówiłby, co się ze zgłoszeniem stało. Notatkę udostępniamy na wniosek skierowany do inspektora ochrony danych.",
    reason_en:
      "Admissions committee notes about the candidate (the admin_note field of a club application). It is an internal assessment written by committee members rather than data you provided about yourself; keeping it out of the automated file stops the export from turning an internal assessment into a channel for talking to the candidate. The decision itself and its date ARE exported - without them the file would not say what happened to the application. The note is provided on request to the data protection officer.",
  },
  {
    id: "attachment_binaries",
    reason_pl:
      "Treść binarna załączników i plików CV. W eksporcie są metadane i ścieżki w magazynie plików - same pliki pobierzesz z rozmowy lub z profilu, w oryginalnym formacie.",
    reason_en:
      "Binary contents of attachments and CV files. The export carries their metadata and storage paths - download the files themselves from the conversation or your profile, in their original format.",
  },
  {
    id: "published_authored_content",
    reason_pl:
      "Opublikowane treści autorskie (wpisy, odcinki podcastu, materiały eksperckie). Są dostępne pod własnymi adresami publicznymi; eksport zawiera profil autora i metadane, a nie kopie publikacji.",
    reason_en:
      "Published authored content (articles, podcast episodes, expert materials). It lives under its own public URLs; the export carries the author profile and metadata rather than copies of the publications.",
  },
  {
    id: "pseudonymous_analytics",
    reason_pl:
      "Zdarzenia analityczne i pomiary wydajności zbierane bez identyfikatora konta. Nie da się ich przypisać do osoby, więc nie są danymi osobowymi w rozumieniu art. 4 pkt 1 RODO.",
    reason_en:
      "Analytics and performance events collected without an account identifier. They cannot be linked back to a person, so they are not personal data under GDPR art. 4(1).",
  },
  {
    id: "security_and_audit_logs",
    reason_pl:
      "Logi bezpieczeństwa i ślad audytowy (adresy IP żądań, wykryte nadużycia) przechowywane w celu ustalenia i obrony roszczeń - art. 17 ust. 3 lit. e RODO. Udostępniamy je na wniosek skierowany do inspektora ochrony danych.",
    reason_en:
      "Security and audit logs (request IP addresses, abuse signals) retained for the establishment and defence of legal claims - GDPR art. 17(3)(e). They are provided on request to the data protection officer.",
  },
];

/** Sekcja, która mogła zostać UCIĘTA na sufcie wierszy. */
export interface ExportTruncation {
  id: string;
  /** Sufit obowiązujący dla tej sekcji. */
  limit: number;
  /** Ile wierszy realnie znalazło się w pliku. */
  returned: number;
}

export interface ExportManifest {
  format: typeof PERSONAL_DATA_EXPORT_FORMAT;
  /** Sekcje, które eksport ZADEKLAROWAŁ - w kolejności grup. */
  sections: readonly string[];
  /** Grupa dziedzinowa każdej sekcji. */
  groups: Readonly<Record<string, string>>;
  /** Sekcje, które w tym przebiegu skończyły się błędem (odmowa RLS, grant). */
  failed: readonly string[];
  /**
   * Sekcje, w których wierszy było CO NAJMNIEJ tyle, ile pozwala sufit - czyli
   * takie, w których część danych mogła nie trafić do pliku. Pusta lista znaczy
   * „nic nie zostało ucięte", a nie „nie sprawdzaliśmy".
   */
  truncated: readonly ExportTruncation[];
  /** Świadome wyłączenia zakresu wraz z uzasadnieniem. */
  excluded: readonly ExportExclusion[];
}

/**
 * Które sekcje mogły zostać ucięte - liczone z ZAWARTOŚCI pliku, nie z intencji.
 *
 * Warunek jest `>=`, nie `===`: liczba wierszy równa sufitowi znaczy „tyle,
 * ile wolno było wziąć", więc nie da się z niej odczytać, czy w bazie było
 * dokładnie tyle, czy więcej. Zgłaszamy więc podejrzenie ucięcia - fałszywy
 * alarm przy dokładnie 2000 wierszach jest nieporównanie tańszy niż milczenie
 * przy 2500.
 */
export function detectTruncatedSections(
  sections: Readonly<Record<string, JsonValue>>,
): ExportTruncation[] {
  const out: ExportTruncation[] = [];
  for (const id of EXPORT_SECTION_IDS) {
    const limit = EXPORT_SECTION_LIMITS[id];
    if (limit === undefined) continue;
    const rows = sections[id];
    if (!Array.isArray(rows)) continue;
    if (rows.length >= limit) out.push({ id, limit, returned: rows.length });
  }
  return out;
}

/** Manifest dołączany do payloadu - „co miało być, co się nie udało, czego nie ma". */
export function buildExportManifest(
  failedSectionIds: readonly string[],
  truncatedSections: readonly ExportTruncation[] = [],
): ExportManifest {
  const failed = EXPORT_SECTION_IDS.filter((id) => failedSectionIds.includes(id));
  const declared = new Set<string>(EXPORT_SECTION_IDS);
  return {
    format: PERSONAL_DATA_EXPORT_FORMAT,
    sections: EXPORT_SECTION_IDS,
    groups: EXPORT_SECTION_GROUP_OF,
    failed,
    // Kolejność rejestru, nie kolejność wykrycia - plik ma być powtarzalny.
    truncated: EXPORT_SECTION_IDS.map((id) =>
      truncatedSections.find((entry) => entry.id === id),
    ).filter((entry): entry is ExportTruncation => entry !== undefined && declared.has(entry.id)),
    excluded: EXPORT_EXCLUSIONS,
  };
}

export interface ExportManifestMismatch {
  /** Zadeklarowane w rejestrze, nieobecne w zbudowanym eksporcie. */
  missing: readonly string[];
  /** Zbudowane przez warstwę serwerową, nieobecne w rejestrze. */
  undeclared: readonly string[];
}

/**
 * Bramka rozjazdu deklaracja ⇄ implementacja. Wywoływana w teście oraz w samej
 * server fn - rozjazd nie może przecieknąć do pliku użytkownika w ciszy.
 */
export function diffExportManifest(builtSectionIds: readonly string[]): ExportManifestMismatch {
  const declared = new Set<string>(EXPORT_SECTION_IDS);
  const built = new Set(builtSectionIds);
  return {
    missing: EXPORT_SECTION_IDS.filter((id) => !built.has(id)),
    undeclared: builtSectionIds.filter((id) => !declared.has(id)),
  };
}

export function exportManifestMatches(builtSectionIds: readonly string[]): boolean {
  const diff = diffExportManifest(builtSectionIds);
  return diff.missing.length === 0 && diff.undeclared.length === 0;
}
