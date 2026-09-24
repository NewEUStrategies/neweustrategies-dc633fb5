// Sciezki prelegenta wyprowadzane z obsady sesji programu - bez sieci.
//
// PRELEGENT JEST W SCIEZCE, BO WYSTEPUJE W JEJ SESJI. Nikt tego nie wpisuje,
// wiec regula musi dac TE SAME sciezki, ktore uczestnik widzi w programie:
// sesja odwolana i sesja bez sciezki nic nie dopisuja, a kolejnosc chipow
// jest ta sama, co przyciskow filtra (`agendaTrackOptions`).
import { describe, expect, it } from "vitest";

import {
  agendaSpeakerTracks,
  agendaTrackOptions,
  parseEventAgenda,
  type AgendaSession,
  type AgendaSpeaker,
  type AgendaTrack,
  type EventAgendaRow,
} from "@/lib/events/agendaSurface";

function track(over: Partial<AgendaTrack> = {}): AgendaTrack {
  return {
    id: "t-policy",
    key: "policy",
    namePl: "Polityka",
    nameEn: "Policy",
    accentColor: "#FA9346",
    sponsor: null,
    ...over,
  };
}

function speaker(over: Partial<AgendaSpeaker> = {}): AgendaSpeaker {
  return {
    userId: "u-anna",
    slug: "anna-nowak",
    displayName: "Anna Nowak",
    avatarUrl: null,
    headlinePl: null,
    headlineEn: null,
    role: "speaker",
    sortOrder: 0,
    ...over,
  };
}

function session(over: Partial<AgendaSession> = {}): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Sesja otwarcia",
    titleEn: "Opening session",
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: "2026-09-01T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: track(),
    room: null,
    affiliationPl: null,
    affiliationEn: null,
    sponsor: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [speaker()],
    ...over,
  };
}

const policy = track();
const energy = track({ id: "t-energy", key: "energy", namePl: "Energia", nameEn: "Energy" });
const security = track({
  id: "t-security",
  key: "security",
  namePl: "Bezpieczenstwo",
  nameEn: "Security",
  accentColor: null,
});

const anna = speaker();
const jan = speaker({ userId: "u-jan", slug: "jan-kowalski", displayName: "Jan Kowalski" });

describe("agendaSpeakerTracks - sciezki z obsady sesji", () => {
  it("pusty program nie ma zadnych sciezek prelegentow", () => {
    expect(agendaSpeakerTracks([]).size).toBe(0);
  });

  it("prelegent sesji w sciezce dostaje te sciezke z liczba sesji 1", () => {
    const tracks = agendaSpeakerTracks([session()]);
    expect([...tracks.keys()]).toEqual(["u-anna"]);
    expect(tracks.get("u-anna")).toStrictEqual([
      {
        id: "t-policy",
        key: "policy",
        namePl: "Polityka",
        nameEn: "Policy",
        accentColor: "#FA9346",
        sessionsCount: 1,
      },
    ]);
  });

  it("sponsor sciezki NIE przechodzi do chipu prelegenta", () => {
    const sponsored = track({
      sponsor: { id: "sp1", name: "Partner Strategiczny", logoUrl: null, role: "partner" },
    });
    const [chip] = agendaSpeakerTracks([session({ track: sponsored })]).get("u-anna") ?? [];
    expect(chip).not.toHaveProperty("sponsor");
    expect(Object.keys(chip).sort()).toEqual(
      ["accentColor", "id", "key", "nameEn", "namePl", "sessionsCount"].sort(),
    );
  });

  it("kolejne sesje w tej samej sciezce zwiekszaja `sessionsCount`, nie dublujac chipu", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1" }),
      session({ id: "s2" }),
      session({ id: "s3" }),
    ]);
    expect(tracks.get("u-anna")).toHaveLength(1);
    expect(tracks.get("u-anna")?.[0].sessionsCount).toBe(3);
  });

  it("wystapienia w roznych sciezkach daja osobne chipy z osobnymi licznikami", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1", track: policy }),
      session({ id: "s2", track: energy }),
      session({ id: "s3", track: policy }),
    ]);
    expect(tracks.get("u-anna")?.map((chip) => [chip.id, chip.sessionsCount] as const)).toEqual([
      ["t-energy", 1],
      ["t-policy", 2],
    ]);
  });

  it("kazdy prelegent ma WLASNY licznik - wspolna sesja nie liczy sie dwa razy", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1", speakers: [anna, jan] }),
      session({ id: "s2", speakers: [anna] }),
    ]);
    expect(tracks.get("u-anna")?.[0].sessionsCount).toBe(2);
    expect(tracks.get("u-jan")?.[0].sessionsCount).toBe(1);
    expect(tracks.get("u-anna")?.[0]).not.toBe(tracks.get("u-jan")?.[0]);
  });

  it("sesja odwolana nie dopisuje sciezki - prelegent w niej nie wystapi", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1", track: policy }),
      session({ id: "s2", track: policy, status: "cancelled" }),
      session({ id: "s3", track: energy, status: "cancelled" }),
    ]);
    expect(tracks.get("u-anna")).toStrictEqual([
      expect.objectContaining({ id: "t-policy", sessionsCount: 1 }),
    ]);
  });

  it("prelegent wystepujacy WYLACZNIE w odwolanych sesjach nie ma wpisu wcale", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1", speakers: [anna] }),
      session({ id: "s2", speakers: [jan], status: "cancelled" }),
    ]);
    expect(tracks.has("u-jan")).toBe(false);
    expect([...tracks.keys()]).toEqual(["u-anna"]);
  });

  it("sesja bez sciezki nic nie dopisuje, a prelegent tylko z niej nie ma wpisu", () => {
    const tracks = agendaSpeakerTracks([
      session({ id: "s1", track: null, speakers: [anna, jan] }),
      session({ id: "s2", track: energy, speakers: [anna] }),
    ]);
    expect(tracks.get("u-anna")).toStrictEqual([
      expect.objectContaining({ id: "t-energy", sessionsCount: 1 }),
    ]);
    expect(tracks.has("u-jan")).toBe(false);
  });

  it("prelegent bez identyfikatora konta jest pomijany, reszta obsady nie", () => {
    const tracks = agendaSpeakerTracks([
      session({ speakers: [speaker({ userId: "", displayName: "Gosc" }), jan] }),
    ]);
    expect(tracks.has("")).toBe(false);
    expect([...tracks.keys()]).toEqual(["u-jan"]);
  });

  it("sesja bez obsady niczego nie dopisuje", () => {
    expect(agendaSpeakerTracks([session({ speakers: [] })]).size).toBe(0);
  });

  it("chipy stoja po kluczu technicznym, jak przyciski filtra programu", () => {
    const sessions = [
      session({ id: "s1", track: security }),
      session({ id: "s2", track: policy }),
      session({ id: "s3", track: energy }),
    ];
    const chips = agendaSpeakerTracks(sessions).get("u-anna") ?? [];
    expect(chips.map((chip) => chip.key)).toEqual(["energy", "policy", "security"]);
    expect(chips.map((chip) => chip.id)).toEqual(
      agendaTrackOptions(sessions).map((option) => option.id),
    );
  });

  it("sciezka bez klucza stoi przed kluczowanymi, a remis klucza rozstrzyga id", () => {
    const noKey = track({ id: "t-zzz", key: null, namePl: "Bez klucza" });
    const sameKeyB = track({ id: "t-b", key: "shared", namePl: "B" });
    const sameKeyA = track({ id: "t-a", key: "shared", namePl: "A" });
    const sessions = [
      session({ id: "s1", track: sameKeyB }),
      session({ id: "s2", track: policy }),
      session({ id: "s3", track: sameKeyA }),
      session({ id: "s4", track: noKey }),
    ];
    // Obie kolejnosci wejscia: sciezka bez klucza raz dochodzi ostatnia,
    // raz pierwsza - porzadek chipow ma byc ten sam.
    for (const input of [sessions, [...sessions].reverse()]) {
      const chips = agendaSpeakerTracks(input).get("u-anna") ?? [];
      expect(chips.map((chip) => chip.id)).toEqual(["t-zzz", "t-policy", "t-a", "t-b"]);
      expect(chips[0].key).toBeNull();
    }
  });

  it("wynik nie zalezy od kolejnosci sesji na wejsciu", () => {
    const sessions = [
      session({ id: "s1", track: security, speakers: [anna, jan] }),
      session({ id: "s2", track: policy, speakers: [jan] }),
      session({ id: "s3", track: energy, speakers: [anna] }),
      session({ id: "s4", track: policy, speakers: [anna, jan] }),
    ];
    const forward = agendaSpeakerTracks(sessions);
    const backward = agendaSpeakerTracks([...sessions].reverse());
    expect(backward.get("u-anna")).toStrictEqual(forward.get("u-anna"));
    expect(backward.get("u-jan")).toStrictEqual(forward.get("u-jan"));
  });

  it("nie zmienia wejsciowych sesji ani ich sciezek", () => {
    const input = [session({ id: "s1" }), session({ id: "s2" })];
    const before = structuredClone(input);
    agendaSpeakerTracks(input);
    expect(input).toStrictEqual(before);
  });

  it("dziala na tym samym modelu, ktory rysuje program (`parseEventAgenda`)", () => {
    const row = (over: Partial<EventAgendaRow>): EventAgendaRow =>
      ({
        id: "s1",
        event_id: "e1",
        title_pl: "Sesja",
        title_en: "Session",
        starts_at: "2026-09-01T08:00:00Z",
        ends_at: "2026-09-01T09:00:00Z",
        timezone: "Europe/Warsaw",
        format: "onsite",
        status: "published",
        sort_order: 1,
        access_state: "open",
        track_id: "t-policy",
        track_key: "policy",
        track_name_pl: "Polityka",
        track_name_en: "Policy",
        track_accent_color: "#FA9346",
        speakers: [{ user_id: "u-anna", display_name: "Anna Nowak", sort_order: 0 }],
        ...over,
      }) as EventAgendaRow;
    const sessions = parseEventAgenda([
      row({ id: "s1" }),
      row({ id: "s2", status: "cancelled" }),
      row({ id: "s3", track_id: "" }),
      row({ id: "s4", speakers: [{ user_id: "", display_name: "Bez konta" }] }),
    ]);
    const tracks = agendaSpeakerTracks(sessions);
    expect([...tracks.keys()]).toEqual(["u-anna"]);
    expect(tracks.get("u-anna")).toStrictEqual([
      {
        id: "t-policy",
        key: "policy",
        namePl: "Polityka",
        nameEn: "Policy",
        accentColor: "#FA9346",
        sessionsCount: 1,
      },
    ]);
  });
});
