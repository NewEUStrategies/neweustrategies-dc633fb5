// Cykl zycia zgloszenia poza baza: klucz samoobslugi, tresc maila i eksport.
//
// TRZY RZECZY, KTORE WYCHODZA POZA SYSTEM. Klucz `manage_token` jedzie mailem
// i wraca adresem; tresc maila trafia do skrzynki, ktorej nie kontrolujemy;
// plik CSV laduje w arkuszu na cudzym laptopie. Kazda z nich ma tu wlasny
// przypadek, bo w kazdej blad jest widoczny dopiero u odbiorcy.
import { describe, expect, it } from "vitest";

import { isManageToken, manageLinkPath, readManageToken } from "@/lib/events/manageToken";
import { buildRegistrationNotice, formatEventMoment } from "@/lib/events/registrationNotify.server";
import {
  REGISTRATION_CSV_COLUMNS,
  registrationsCsvFileName,
  registrationsToCsv,
} from "@/lib/events/registrationsCsv";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";
import {
  directoryBlockKey,
  directoryEntryName,
  directoryEntrySubtitle,
  parseMeetingDirectory,
} from "@/lib/events/meetingDirectory";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

describe("manageToken - poswiadczenie samoobslugi", () => {
  it("przyjmuje wylacznie 32 znaki base64url", () => {
    expect(isManageToken(TOKEN)).toBe(true);
    expect(isManageToken(`${TOKEN}extra`)).toBe(false);
    expect(isManageToken("krotki")).toBe(false);
    expect(isManageToken(`${TOKEN.slice(0, 31)}+`)).toBe(false);
  });

  it("przycina biale znaki z wklejenia, ale nie naprawia zlego ksztaltu", () => {
    expect(readManageToken(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(readManageToken("kosmos")).toBeNull();
    expect(readManageToken(undefined)).toBeNull();
    expect(readManageToken(42)).toBeNull();
  });

  it("sklada adres strony zarzadzania ze slugiem i kluczem", () => {
    expect(manageLinkPath("kongres 2026", TOKEN)).toBe(
      `/events/kongres%202026/manage?token=${TOKEN}`,
    );
  });
});

describe("registrationNotify - tresc maila o zgloszeniu", () => {
  const payload = {
    registration_id: "r1",
    tenant_id: "t1",
    status: "approved",
    decision_note: "Komplet miejsc.",
    waitlist_position: 3,
    email: "uczestnik@example.test",
    first_name: "Anna",
    lang: "pl",
    event_slug: "kongres",
    event_title_pl: "Kongres",
    event_title_en: "Congress",
    event_starts_at: "2026-09-01T07:00:00Z",
    event_timezone: "Europe/Warsaw",
    event_location: "Bruksela",
    ticket_name_pl: "Wejsciowka standard",
    ticket_name_en: "Standard pass",
  };

  it("godzina liczy sie w STREFIE WYDARZENIA, nie serwera", () => {
    // 07:00 UTC to 09:00 w Warszawie i 08:00 w Londynie.
    expect(formatEventMoment("2026-09-01T07:00:00Z", "Europe/Warsaw", "pl")).toContain("09:00");
    expect(formatEventMoment("2026-09-01T07:00:00Z", "Europe/London", "en")).toContain("08:00");
    expect(formatEventMoment(null, "Europe/Warsaw", "pl")).toBe("");
  });

  it("nieznana strefa nie blokuje maila - degraduje do domyslnej", () => {
    expect(formatEventMoment("2026-09-01T07:00:00Z", "Kosmos/Ksiezyc", "pl")).toContain("09:00");
  });

  it("akceptacja niesie miejsce i rodzaj wejsciowki, odmowa - uzasadnienie", () => {
    const approved = buildRegistrationNotice("approved", payload);
    const rejected = buildRegistrationNotice("rejected", { ...payload, status: "rejected" });
    expect(approved.details.map((row) => row.value)).toContain("Bruksela");
    expect(approved.details.map((row) => row.value)).toContain("Wejsciowka standard");
    expect(rejected.details.map((row) => row.value)).toContain("Komplet miejsc.");
    expect(rejected.details.map((row) => row.value)).not.toContain("Bruksela");
  });

  it("odmowa prowadzi do KATALOGU, nie do wydarzenia bez wstepu", () => {
    expect(buildRegistrationNotice("approved", payload).ctaPath).toBe("/events/kongres");
    expect(buildRegistrationNotice("rejected", payload).ctaPath).toBe("/events");
  });

  it("awans z rezerwy pokazuje miejsce w kolejce", () => {
    const promoted = buildRegistrationNotice("promoted", payload);
    expect(promoted.details.map((row) => row.value)).toContain("3");
  });

  it("jezyk odbiorcy wybiera tytul wydarzenia, a nieznany degraduje do PL", () => {
    expect(buildRegistrationNotice("approved", { ...payload, lang: "en" }).eventTitle).toBe(
      "Congress",
    );
    expect(buildRegistrationNotice("approved", { ...payload, lang: "de" }).lang).toBe("pl");
  });
});

describe("registrationsCsv - dane, ktore opuszczaja system", () => {
  function row(over: Partial<EventRegistrationRow>): EventRegistrationRow {
    return {
      id: "r1",
      first_name: "Anna",
      last_name: "Nowak",
      email: "anna@example.test",
      phone: "",
      job_title: "Analityk",
      company_name: "",
      company_text: "Firma, z przecinkiem",
      ticket_name_pl: "Standard",
      ticket_name_en: "Standard pass",
      group_name_pl: "Uczestnicy",
      group_name_en: "Attendees",
      status: "approved",
      registration_mode: "form",
      source: "self_registration",
      waitlist_position: 0,
      created_at: "2026-08-01T10:00:00Z",
      decided_at: "2026-08-02T10:00:00Z",
      decision_source: "organizer",
      decision_note: "",
      attended_at: "",
      cancelled_at: "",
      consent_data_processing_at: "2026-08-01T10:00:00Z",
      consent_marketing_at: "",
      consent_partner_sharing_at: "",
      consent_withdrawn_at: "",
      ...over,
    } as EventRegistrationRow;
  }

  it("cytuje wartosc z przecinkiem, wiec kolumny sie nie rozjezdzaja", () => {
    const csv = registrationsToCsv([row({})], "pl");
    expect(csv.split("\n")[0]).toBe(REGISTRATION_CSV_COLUMNS.join(","));
    expect(csv).toContain('"Firma, z przecinkiem"');
  });

  it("neutralizuje formule arkusza w polu WPISANYM przez uczestnika", () => {
    const csv = registrationsToCsv([row({ company_text: '=HYPERLINK("http://zlo")' })], "pl");
    expect(csv).toContain("'=HYPERLINK");
  });

  it("firma z kartoteki wygrywa nad wpisana recznie", () => {
    const csv = registrationsToCsv([row({ company_name: "Firma SA" })], "pl");
    expect(csv).toContain("Firma SA");
    expect(csv).not.toContain("Firma, z przecinkiem");
  });

  it("nazwa biletu i grupy idzie w jezyku eksportu", () => {
    expect(registrationsToCsv([row({})], "en")).toContain("Standard pass");
    expect(registrationsToCsv([row({})], "pl")).toContain("Standard");
  });

  it("plik sam sie opisuje w katalogu Pobrane", () => {
    expect(registrationsCsvFileName("kongres", "2026-09-01T07:00:00Z")).toBe(
      "uczestnicy-kongres-2026-09-01.csv",
    );
    expect(registrationsCsvFileName("", "2026-09-01T07:00:00Z")).toBe(
      "uczestnicy-event-2026-09-01.csv",
    );
  });
});

describe("meetingDirectory - katalog uczestnikow gieldy", () => {
  it("blokada niesie wlasny klucz, a nieznana degraduje do braku blokady", () => {
    expect(parseMeetingDirectory({ blocked: "directory_hidden" }).blocked).toBe("directory_hidden");
    expect(parseMeetingDirectory({ blocked: "kosmos" }).blocked).toBeNull();
    expect(directoryBlockKey("meetings_disabled")).toBe(
      "eventMeetings.participant.directory.blocks.meetingsDisabled",
    );
  });

  it("wiersz bez identyfikatora zgloszenia wypada - nie da sie go zaprosic", () => {
    const parsed = parseMeetingDirectory({
      rows: [{ first_name: "Duch" }, { registration_id: "r2", first_name: "Anna" }],
      total_count: 2,
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].registrationId).toBe("r2");
  });

  it("stan rozmowy czyta tylko wartosci, ktore baza naprawde oddaje", () => {
    const parsed = parseMeetingDirectory({
      rows: [
        { registration_id: "a", meeting_status: "invited" },
        { registration_id: "b", meeting_status: "held" },
      ],
    });
    expect(parsed.rows[0].meetingStatus).toBe("invited");
    expect(parsed.rows[1].meetingStatus).toBeNull();
  });

  it("sklada etykiety bez pustych separatorow", () => {
    const [entry] = parseMeetingDirectory({
      rows: [{ registration_id: "r1", first_name: "Anna", last_name: "", job_title: "Analityk" }],
    }).rows;
    expect(directoryEntryName(entry)).toBe("Anna");
    expect(directoryEntrySubtitle(entry)).toBe("Analityk");
  });

  it("nieznany zakres widocznosci czyta sie jako NAJWEZSZY", () => {
    expect(parseMeetingDirectory({ scope: "kosmos" }).scope).toBe("none");
    expect(parseMeetingDirectory({ scope: "everyone" }).scope).toBe("everyone");
  });
});
