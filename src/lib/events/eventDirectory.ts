// KATALOG OSÓB I INSTYTUCJI WYDARZENIA - jedno źródło faktów dla okien profilu
// (osoba, instytucja) na zakładkach modułowych: Uczestnicy, Prelegenci,
// Partnerzy, Agenda, Dyskusje.
//
// PO CO KATALOG, A NIE PROPSY KARTY. Ta sama osoba stoi na wydarzeniu w kilku
// miejscach naraz: wiersz `event_speakers_public` (biogram, tematy, logo
// instytucji), obsada sesji `event_agenda` (godziny, sale, rola w panelu),
// katalog uczestników (zainteresowania, sieci społecznościowe). Okno otwarte
// z jednej zakładki pokazywało tylko to, co niosła jej karta - prelegent
// w agendzie nie miał biogramu, a na liście prelegentów nie miał godzin swoich
// sesji. Katalog składa te źródła PO TOŻSAMOŚCI, więc okno mówi o osobie to
// samo, z której zakładki by go nie otworzyć.
//
// INSTYTUCJA TO NAZWA, NIE IDENTYFIKATOR. Żadne z publicznych źródeł nie oddaje
// identyfikatora organizacji: prelegent ma tekst `company`, uczestnik
// `company`, partner `name`. Klucz instytucji jest więc nazwą po złożeniu
// (bez wielkości liter, znaków diakrytycznych łączących i interpunkcji) -
// „WiseEuropa" i „wiseeuropa" to jedna instytucja, a partner i prelegent z tej
// samej firmy trafiają do jednego okna. Odmiany („Centralnego Portu…" wobec
// „Centralny Port…") NIE są sklejane: zgadywanie końcówek dla kluczy łączyłoby
// różne instytucje o wspólnym rdzeniu, a to gorsze niż dwa osobne okna.
//
// TEN PLIK NIE PYTA BAZY. Dostaje to, co powierzchnia już ma (strona publiczna -
// z zapytań publicznych, podgląd studia - z RPC panelu), więc obie składają
// katalog tą samą funkcją i pokazują w oknach te same fakty.
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { AgendaSession } from "@/lib/events/agendaSurface";
import type { SocialKey } from "@/lib/events/myEventProfileApi";
import type { SpeakerSessionEntry } from "@/lib/events/participantTicketsApi";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { PublicSponsorTier, SponsorRole } from "@/lib/events/sponsorsSurface";
import { splitSpeakerRoleInstitution } from "@/lib/events/speakerCard";

export type DirectoryLang = "pl" | "en";

/** Sesja osoby albo instytucji - tylko to, czego potrzebuje wiersz w oknie. */
export interface DirectorySession {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  room: string | null;
  /** Rola w obsadzie (`moderator`, `panelist`, `host`, `speaker`) albo `null`. */
  role: string | null;
  cancelled: boolean;
}

export interface DirectoryPerson {
  /** Klucz kanoniczny - patrz `personKeyOf`. */
  key: string;
  name: string;
  avatarUrl: string | null;
  /** Stanowisko BEZ nazwy instytucji (ta sama reguła, co karta prelegenta). */
  position: string;
  orgKey: string | null;
  orgName: string;
  orgLogoUrl: string | null;
  bio: string;
  topics: string[];
  languages: string[];
  socials: Partial<Record<SocialKey, string>>;
  isSpeaker: boolean;
  isExpert: boolean;
  /** Pełny profil na platformie (`/author/<slug>`, `/people/<slug>`) albo `null`. */
  profileHref: string | null;
  sessions: DirectorySession[];
  /** Wiersz listy prelegentów - materiały i wystąpienia dociąga okno. */
  speakerRow: PublicSpeakerRow | null;
  /** Wpis katalogu uczestników - grupy, zainteresowania, akcje spotkań. */
  attendee: AttendeeEntry | null;
  /** Slug profilu członka - okno dociąga z niego stanowisko i firmę autora wątku. */
  memberSlug: string | null;
}

export interface DirectorySponsor {
  id: string;
  role: SponsorRole;
  tierName: string;
  tierAccent: string | null;
  boothLabel: string | null;
  /** Cel odnośnika ustawiony przez organizatora (`linkMode`) - liczony w raporcie. */
  href: string | null;
  isDraft: boolean;
}

export interface DirectoryOrg {
  key: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  description: string;
  country: string | null;
  sponsor: DirectorySponsor | null;
  /** Klucze osób z tej instytucji - prelegenci przed uczestnikami. */
  people: string[];
  /** Sesje, które ta instytucja wspiera (sponsor sesji albo ścieżki). */
  sessionIds: string[];
}

export interface EventDirectory {
  people: ReadonlyMap<string, DirectoryPerson>;
  orgs: ReadonlyMap<string, DirectoryOrg>;
  sessions: ReadonlyMap<string, DirectorySession>;
  /** Surowy identyfikator (konto, kartoteka, wpis rejestru, zapis) -> klucz osoby. */
  aliases: ReadonlyMap<string, string>;
}

export interface EventDirectorySources {
  speakers?: readonly PublicSpeakerRow[];
  sessions?: readonly AgendaSession[];
  sponsorTiers?: readonly PublicSponsorTier[];
  attendees?: readonly AttendeeEntry[];
  /** Panele uczestnika-prelegenta (mapa `event_attendee_sessions`). */
  attendeeSessions?: (entry: AttendeeEntry) => readonly SpeakerSessionEntry[] | null;
  /** Osoby spoza list (np. autorzy wątków) - dopisywane na końcu, bez nadpisań. */
  extraPeople?: readonly DirectoryPerson[];
  /** Etykieta grupy partnerów bez poziomu - z słownika wołającego. */
  noTierLabel?: string;
}

function textOf(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function localized(
  pl: string | null | undefined,
  en: string | null | undefined,
  lang: DirectoryLang,
) {
  const primary = textOf(lang === "en" ? en : pl);
  return primary !== "" ? primary : textOf(lang === "en" ? pl : en);
}

/**
 * Klucz instytucji z jej nazwy - albo `null` dla pustej nazwy.
 *
 * NFKD + zdjęcie znaków łączących zrównuje „Łódź" zapisaną z ogonkiem
 * złożonym i rozłożonym; reszta znaków spoza liter i cyfr to granica słów.
 * Wielkie litery nie odróżniają instytucji („WISEEUROPA" = „WiseEuropa").
 */
export function directoryOrgKey(name: string | null | undefined): string | null {
  const folded = textOf(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return folded === "" ? null : `o:${folded}`;
}

/**
 * Klucz osoby: konto wygrywa, bo to ono łączy prelegenta z uczestnikiem
 * i z obsadą sesji; bez konta - wpis rejestru prelegentów, kartoteka osoby,
 * a na końcu zapis na wydarzenie.
 */
export function personKeyOf(ids: {
  userId?: string | null;
  speakerProfileId?: string | null;
  personId?: string | null;
  registrationId?: string | null;
}): string | null {
  const userId = textOf(ids.userId);
  if (userId !== "") return `u:${userId}`;
  const speakerProfileId = textOf(ids.speakerProfileId);
  if (speakerProfileId !== "") return `s:${speakerProfileId}`;
  const personId = textOf(ids.personId);
  if (personId !== "") return `p:${personId}`;
  const registrationId = textOf(ids.registrationId);
  return registrationId === "" ? null : `r:${registrationId}`;
}

/** Osoba po surowym identyfikatorze albo kluczu kanonicznym. */
export function findDirectoryPerson(
  directory: EventDirectory,
  idOrKey: string,
): DirectoryPerson | null {
  const direct = directory.people.get(idOrKey);
  if (direct !== undefined) return direct;
  const aliased = directory.aliases.get(idOrKey);
  return aliased === undefined ? null : (directory.people.get(aliased) ?? null);
}

/** Osoby instytucji w kolejności katalogu (prelegenci najpierw). */
export function directoryOrgPeople(directory: EventDirectory, orgKey: string): DirectoryPerson[] {
  const org = directory.orgs.get(orgKey);
  if (org === undefined) return [];
  return org.people
    .map((key) => directory.people.get(key))
    .filter((person): person is DirectoryPerson => person !== undefined);
}

/** Sesje wspierane przez instytucję, chronologicznie. */
export function directoryOrgSessions(
  directory: EventDirectory,
  orgKey: string,
): DirectorySession[] {
  const org = directory.orgs.get(orgKey);
  if (org === undefined) return [];
  return sortSessions(
    org.sessionIds
      .map((id) => directory.sessions.get(id))
      .filter((session): session is DirectorySession => session !== undefined),
  );
}

function sortSessions(sessions: DirectorySession[]): DirectorySession[] {
  return [...sessions].sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
}

function emptyPerson(key: string, name: string): DirectoryPerson {
  return {
    key,
    name,
    avatarUrl: null,
    position: "",
    orgKey: null,
    orgName: "",
    orgLogoUrl: null,
    bio: "",
    topics: [],
    languages: [],
    socials: {},
    isSpeaker: false,
    isExpert: false,
    profileHref: null,
    sessions: [],
    speakerRow: null,
    attendee: null,
    memberSlug: null,
  };
}

/** Pierwsza niepusta wartość - pole już znane nie jest nadpisywane słabszym źródłem. */
function keep<T>(current: T, next: T, empty: (value: T) => boolean): T {
  return empty(current) ? next : current;
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * Składa katalog z tego, co powierzchnia ma w pamięci.
 *
 * KOLEJNOŚĆ ŹRÓDEŁ = KOLEJNOŚĆ PIERWSZEŃSTWA. Lista prelegentów jest
 * najpełniejsza (biogram, logo instytucji), obsada sesji dokłada godziny,
 * partnerzy dokładają opis i stronę instytucji, uczestnicy - zainteresowania
 * i sieci. Pole raz wypełnione nie jest nadpisywane źródłem dalszym.
 */
export function buildEventDirectory(
  sources: EventDirectorySources,
  lang: DirectoryLang,
): EventDirectory {
  const people = new Map<string, DirectoryPerson>();
  const orgs = new Map<string, DirectoryOrg>();
  const sessions = new Map<string, DirectorySession>();
  const aliases = new Map<string, string>();
  const order: string[] = [];

  const alias = (raw: string | null | undefined, key: string) => {
    const id = textOf(raw);
    if (id !== "" && !aliases.has(id)) aliases.set(id, key);
  };

  const ensureOrg = (name: string): DirectoryOrg | null => {
    const key = directoryOrgKey(name);
    if (key === null) return null;
    const existing = orgs.get(key);
    if (existing !== undefined) return existing;
    const created: DirectoryOrg = {
      key,
      name: name.trim(),
      logoUrl: null,
      website: null,
      description: "",
      country: null,
      sponsor: null,
      people: [],
      sessionIds: [],
    };
    orgs.set(key, created);
    return created;
  };

  const ensurePerson = (key: string, name: string): DirectoryPerson => {
    const existing = people.get(key);
    if (existing !== undefined) return existing;
    const created = emptyPerson(key, name);
    people.set(key, created);
    order.push(key);
    return created;
  };

  const attachOrg = (person: DirectoryPerson, orgName: string, logoUrl: string | null) => {
    if (person.orgKey !== null) {
      const key = directoryOrgKey(orgName);
      if (key !== person.orgKey) {
        // Inne źródło podaje INNĄ instytucję tej samej osoby (wiersz prelegenta
        // bierze firmę z profilu autora, wpis uczestnika - z kartoteki zapisu
        // i CRM). Osoba zostaje przy pierwszej, ale druga dostaje własne okno
        // z WŁASNYM logo - logo jednej firmy nie trafia do drugiej.
        const other = key === null ? null : ensureOrg(orgName);
        if (other !== null) other.logoUrl = keep(other.logoUrl, logoUrl, isBlank);
        return;
      }
      const org = orgs.get(person.orgKey);
      if (org !== undefined) org.logoUrl = keep(org.logoUrl, logoUrl, isBlank);
      person.orgLogoUrl = keep(person.orgLogoUrl, logoUrl, isBlank);
      return;
    }
    const org = ensureOrg(orgName);
    if (org === null) return;
    person.orgKey = org.key;
    person.orgName = org.name;
    person.orgLogoUrl = keep(logoUrl, org.logoUrl, isBlank);
    org.logoUrl = keep(org.logoUrl, logoUrl, isBlank);
  };

  // 1. Prelegenci (`event_speakers_public` albo RPC panelu w podglądzie).
  for (const row of sources.speakers ?? []) {
    const key = personKeyOf({
      userId: row.user_id,
      speakerProfileId: row.speaker_profile_id,
      personId: row.person_id,
    });
    const name = textOf(row.display_name);
    if (key === null || name === "") continue;
    const person = ensurePerson(key, name);
    alias(row.user_id, key);
    alias(row.person_id, key);
    alias(row.speaker_profile_id, key);
    const role = localized(row.headline_pl, row.headline_en, lang) || textOf(row.job_title);
    const { position, institution } = splitSpeakerRoleInstitution(role, row.company);
    person.avatarUrl = keep(person.avatarUrl, textOf(row.avatar_url) || null, isBlank);
    person.position = keep(person.position, position, (value) => value === "");
    person.bio = keep(person.bio, localized(row.bio_pl, row.bio_en, lang), (v) => v === "");
    const topics = lang === "en" ? row.topics_en : row.topics_pl;
    const topicsOther = lang === "en" ? row.topics_pl : row.topics_en;
    if (person.topics.length === 0) {
      person.topics = [...(topics?.length ? topics : (topicsOther ?? []))];
    }
    if (person.languages.length === 0) person.languages = [...(row.languages ?? [])];
    person.isSpeaker = true;
    person.isExpert = person.isExpert || row.is_expert;
    person.speakerRow = person.speakerRow ?? row;
    const slug = textOf(row.slug);
    if (person.profileHref === null && slug !== "") person.profileHref = `/author/${slug}`;
    attachOrg(person, institution, textOf(row.card_institution_logo_url) || null);
  }

  // 2. Obsada i partnerzy sesji (`event_agenda`).
  for (const session of sources.sessions ?? []) {
    const entry: DirectorySession = {
      id: session.id,
      title:
        localized(session.titlePl, session.titleEn, lang) ||
        localized(session.affiliationPl, session.affiliationEn, lang),
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timezone: session.timezone,
      room: session.room?.name ?? null,
      role: null,
      cancelled: session.status === "cancelled",
    };
    sessions.set(session.id, entry);

    for (const speaker of session.speakers) {
      const name = textOf(speaker.displayName);
      if (name === "") continue;
      const key = aliases.get(speaker.userId) ?? personKeyOf({ userId: speaker.userId });
      if (key === null) continue;
      const person = ensurePerson(key, name);
      alias(speaker.userId, key);
      person.avatarUrl = keep(person.avatarUrl, textOf(speaker.avatarUrl) || null, isBlank);
      person.position = keep(
        person.position,
        localized(speaker.headlinePl, speaker.headlineEn, lang),
        (value) => value === "",
      );
      person.isSpeaker = true;
      const slug = textOf(speaker.slug);
      if (person.profileHref === null && slug !== "") person.profileHref = `/author/${slug}`;
      if (!person.sessions.some((item) => item.id === entry.id)) {
        person.sessions.push({ ...entry, role: speaker.role });
      }
    }

    const sponsor = session.sponsor ?? session.track?.sponsor ?? null;
    const sponsorName = textOf(sponsor?.name);
    if (sponsor !== null && sponsorName !== "") {
      const org = ensureOrg(sponsorName);
      if (org !== null) {
        org.logoUrl = keep(org.logoUrl, textOf(sponsor.logoUrl) || null, isBlank);
        if (!org.sessionIds.includes(session.id)) org.sessionIds.push(session.id);
      }
    }
  }

  // 3. Partnerzy (`event_sponsors_public` albo RPC panelu).
  for (const tier of sources.sponsorTiers ?? []) {
    const tierName = localized(tier.namePl, tier.nameEn, lang) || textOf(sources.noTierLabel ?? "");
    for (const sponsor of tier.sponsors) {
      const org = ensureOrg(sponsor.name);
      if (org === null) continue;
      // Nazwa z kartoteki partnera jest wzorcowa - prelegent mógł ją wpisać
      // wersalikami albo skrótem.
      org.name = sponsor.name.trim();
      org.logoUrl = textOf(sponsor.logoUrl) || org.logoUrl;
      org.website = keep(org.website, textOf(sponsor.websiteUrl) || null, isBlank);
      org.description = keep(
        org.description,
        localized(sponsor.descriptionPl, sponsor.descriptionEn, lang),
        (value) => value === "",
      );
      org.country = keep(org.country, textOf(sponsor.country) || null, isBlank);
      org.sponsor ??= {
        id: sponsor.id,
        role: sponsor.role,
        tierName,
        tierAccent: tier.accentColor,
        boothLabel: sponsor.boothLabel,
        href: sponsor.href,
        isDraft: sponsor.isDraft === true,
      };
    }
  }

  // 4. Uczestnicy (katalog `event_attendees` albo RPC panelu).
  for (const entry of sources.attendees ?? []) {
    const name = textOf(entry.name);
    const key =
      aliases.get(entry.userId ?? "") ??
      personKeyOf({ userId: entry.userId, registrationId: entry.registrationId });
    if (key === null || name === "") continue;
    const person = ensurePerson(key, name);
    alias(entry.userId, key);
    alias(entry.registrationId, key);
    person.avatarUrl = keep(person.avatarUrl, entry.avatarUrl, isBlank);
    person.position = keep(person.position, textOf(entry.jobTitle), (value) => value === "");
    person.bio = keep(person.bio, localized(entry.bioPl, entry.bioEn, lang), (v) => v === "");
    if (Object.keys(person.socials).length === 0) {
      const socials: Partial<Record<SocialKey, string>> = {};
      for (const [socialKey, href] of Object.entries(entry.socialLinks)) {
        if (typeof href === "string" && href.trim() !== "") {
          socials[socialKey as SocialKey] = href.trim();
        }
      }
      person.socials = socials;
    }
    person.attendee = person.attendee ?? entry;
    const slug = textOf(entry.profileSlug);
    if (person.profileHref === null && slug !== "") person.profileHref = `/people/${slug}`;
    person.memberSlug = person.memberSlug ?? (slug === "" ? null : slug);
    attachOrg(person, textOf(entry.company), entry.companyLogoUrl);
    // Strona WŁASNEJ firmy wpisu (CRM), nie firmy, przy której osoba już stoi -
    // te dwie mogą się różnić (patrz `attachOrg`).
    const companyOrg = orgs.get(directoryOrgKey(entry.company) ?? "");
    if (companyOrg !== undefined) {
      companyOrg.website = keep(companyOrg.website, entry.companyWebsite, isBlank);
    }
    for (const item of sources.attendeeSessions?.(entry) ?? []) {
      if (person.sessions.some((session) => session.id === item.sessionId)) continue;
      const known = sessions.get(item.sessionId);
      person.sessions.push(
        known !== undefined
          ? { ...known, role: item.role }
          : {
              id: item.sessionId,
              // Panel bez tytułu w obu językach: identyfikator zamiast pustego
              // wiersza, który w oknie czytałby się jak awaria strony.
              title: localized(item.titlePl, item.titleEn, lang) || item.sessionId,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
              timezone: null,
              room: null,
              role: item.role,
              cancelled: false,
            },
      );
      person.isSpeaker = true;
    }
  }

  // 5. Osoby spoza list - nie nadpisują niczego, co już wiemy.
  for (const extra of sources.extraPeople ?? []) {
    if (people.has(extra.key)) continue;
    // Kopia, bo `attachOrg` dopisuje klucz instytucji - wejście wołającego
    // zostaje nietknięte (bywa stałą z pamięci zapytania).
    const person: DirectoryPerson = { ...extra, sessions: [...extra.sessions] };
    people.set(person.key, person);
    order.push(person.key);
    if (person.orgKey === null && person.orgName !== "") {
      attachOrg(person, person.orgName, person.orgLogoUrl);
    }
  }

  // Osoby instytucji: prelegenci przed uczestnikami, w kolejności źródeł.
  for (const key of order) {
    const person = people.get(key);
    if (person === undefined) continue;
    person.sessions = sortSessions(person.sessions);
    if (person.orgKey === null) continue;
    orgs.get(person.orgKey)?.people.push(key);
  }
  for (const org of orgs.values()) {
    org.people.sort((a, b) => {
      const left = people.get(a);
      const right = people.get(b);
      return Number(right?.isSpeaker ?? false) - Number(left?.isSpeaker ?? false);
    });
  }

  return { people, orgs, sessions, aliases };
}
