// SCIEZKI PRELEGENTA - lisc wydzielony z `speakerCard.ts`.
//
// PO CO OSOBNY PLIK. `lib/builder/speakersQuery.ts` (warstwa danych widgetu
// prelegentow buildera, w chunku startowym `index`) potrzebuje wylacznie
// parsera sciezek. Import z `speakerCard` wciagal do chunku startowego cale
// reguly karty (przycisk, zdjecie, szkic formularza w panelu) - ten plik
// zostaje maly, a `speakerCard` re-eksportuje wszystko, wiec pozostali
// importerzy nie zmieniaja sie.
//
// SCIEZKI NIE SA WPISYWANE. `tracks` przychodzi z bazy wyprowadzone z obsady
// sesji (`_event_speaker_tracks` w 20260924140000), wiec parser nie „naprawia"
// danych - odsiewa tylko wpisy, ktorych nie da sie narysowac (bez id, bez
// nazwy) i duplikaty, zeby klucz Reacta byl jednoznaczny.

/** Sciezka, w ktorej prelegent wystepuje (co najmniej jedna sesja). */
export interface SpeakerTrack {
  id: string;
  key: string | null;
  namePl: string | null;
  nameEn: string | null;
  accentColor: string | null;
  /** Liczba sesji prelegenta w tej sciezce; 0, gdy zrodlo jej nie podaje. */
  sessionsCount: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Kolor `#RRGGBB` albo `null` - to samo ograniczenie, co CHECK w bazie. */
export function hexColorOrNull(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : null;
}

/**
 * `tracks jsonb` z RPC -> lista sciezek. Wejscie jest `unknown`, bo przychodzi
 * z `jsonb` (null, obiekt zamiast tablicy, stary wpis cache sprzed kolumny).
 */
export function parseSpeakerTracks(raw: unknown): SpeakerTrack[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SpeakerTrack[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = textOrNull(row.id);
    if (id === null || seen.has(id)) continue;
    const namePl = textOrNull(row.name_pl);
    const nameEn = textOrNull(row.name_en);
    if (namePl === null && nameEn === null) continue;
    seen.add(id);
    const count =
      typeof row.sessions_count === "number" ? row.sessions_count : Number(row.sessions_count);
    out.push({
      id,
      key: textOrNull(row.key),
      namePl,
      nameEn,
      accentColor: hexColorOrNull(row.accent_color),
      sessionsCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    });
  }
  return out;
}

/** Nazwa sciezki w jezyku interfejsu, z awaryjnym drugim jezykiem. */
export function speakerTrackName(track: SpeakerTrack, lang: "pl" | "en"): string {
  const primary = lang === "en" ? track.nameEn : track.namePl;
  const secondary = lang === "en" ? track.namePl : track.nameEn;
  return primary ?? secondary ?? "";
}

/**
 * Czy lista ma choc jedna sciezke, ktora `SpeakerTrackChips` narysuje (z nazwa
 * w ktoryms jezyku). Program pyta o to, zanim pokaze „Pokaz szczegoly" - ta
 * sama regula, co w rendererze, wiec przycisk nie obiecuje pustego rzedu.
 */
export function hasNamedSpeakerTrack(tracks: readonly SpeakerTrack[], lang: "pl" | "en"): boolean {
  return tracks.some((track) => speakerTrackName(track, lang) !== "");
}
