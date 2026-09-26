// Moje miejsce na sali - odczyt uczestnika (panel "Moje" i strona biletu).
//
// DWIE DROGI, TEN SAM KSZTALT. Zalogowany uczestnik pyta `event_my_seats`
// (tozsamosc z sesji), strona biletu - `event_ticket_seats` z kodem
// z FRAGMENTU adresu (klucz samoobslugi `m` albo kod QR `t`). Obie funkcje
// oddaja WYLACZNIE plany opublikowane, WYLACZNIE miejsca wolajacego i geometrie
// jego sekcji bez cudzych danych - karta jest wiec bezpieczna do narysowania
// wprost.
//
// KOD BILETU JEDZIE W CIELE ZADANIA POST, NIGDY W ADRESIE ANI W KLUCZU CACHE.
// Baza porownuje go ze skrotem SHA-256 i nie rozroznia przyczyny odmowy
// (zly kod = zly slug = brak miejsca = pusta lista).
//
// MODUL PUBLICZNY: tylko klient Supabase i czytniki JSON - zadnej warstwy
// panelu, zeby strona biletu i zakladka "Moje" nie ciagnely jej do chunka.
import { supabase } from "@/integrations/supabase/client";
import { bag, flag, list, num, text, type JsonBag } from "@/lib/events/seatingJson";
import type { TicketFragment } from "@/lib/events/manageToken";

export interface MySeatPoint {
  x: number;
  y: number;
  mine: boolean;
}

export interface MySeatGeometry {
  width: number;
  height: number;
  stage: { x: number; y: number; w: number; h: number } | null;
  section: {
    kind: "rows" | "table";
    tableShape: "round" | "rect" | null;
    originX: number;
    originY: number;
    rotationDeg: number;
    seatPitch: number;
    rowPitch: number;
  };
  seats: MySeatPoint[];
}

export interface MySeatCard {
  mapId: string;
  mapName: string;
  roomName: string | null;
  roomFloor: string | null;
  roomNote: string | null;
  sessionTitlePl: string | null;
  sessionTitleEn: string | null;
  sectionLabel: string;
  sectionKind: "rows" | "table";
  rowLabel: string | null;
  seatNumber: number;
  isAccessible: boolean;
  category: { namePl: string; nameEn: string; color: string } | null;
  geometry: MySeatGeometry;
}

function kindOf(value: string | null): "rows" | "table" {
  return value === "table" ? "table" : "rows";
}

function stageOf(value: unknown): MySeatGeometry["stage"] {
  const raw = bag(value);
  if (raw === null) return null;
  const x = num(raw, "x");
  const y = num(raw, "y");
  const w = num(raw, "w");
  const h = num(raw, "h");
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

function geometryOf(value: unknown): MySeatGeometry {
  const raw: JsonBag = bag(value) ?? {};
  const section: JsonBag = bag(raw.section) ?? {};
  const shape = text(section, "table_shape");
  const seats: MySeatPoint[] = [];
  for (const entry of list(raw.seats)) {
    const point = bag(entry);
    const x = point === null ? null : num(point, "x");
    const y = point === null ? null : num(point, "y");
    if (point === null || x === null || y === null) continue;
    seats.push({ x, y, mine: flag(point, "mine", false) });
  }
  return {
    width: num(raw, "width") ?? 1200,
    height: num(raw, "height") ?? 800,
    stage: stageOf(raw.stage),
    section: {
      kind: kindOf(text(section, "kind")),
      tableShape: shape === "round" || shape === "rect" ? shape : null,
      originX: num(section, "origin_x") ?? 0,
      originY: num(section, "origin_y") ?? 0,
      rotationDeg: num(section, "rotation_deg") ?? 0,
      seatPitch: num(section, "seat_pitch") ?? 50,
      rowPitch: num(section, "row_pitch") ?? 60,
    },
    seats,
  };
}

function cardOf(value: unknown): MySeatCard | null {
  const raw = bag(value);
  const mapId = raw === null ? null : text(raw, "map_id");
  const seatNumber = raw === null ? null : num(raw, "seat_number");
  if (raw === null || mapId === null || seatNumber === null) return null;
  const category = bag(raw.category);
  return {
    mapId,
    mapName: text(raw, "map_name") ?? "",
    roomName: text(raw, "room_name"),
    roomFloor: text(raw, "room_floor"),
    roomNote: text(raw, "room_note"),
    sessionTitlePl: text(raw, "session_title_pl"),
    sessionTitleEn: text(raw, "session_title_en"),
    sectionLabel: text(raw, "section_label") ?? "",
    sectionKind: kindOf(text(raw, "section_kind")),
    rowLabel: text(raw, "row_label"),
    seatNumber,
    isAccessible: flag(raw, "is_accessible", false),
    category:
      category === null
        ? null
        : {
            namePl: text(category, "name_pl") ?? "",
            nameEn: text(category, "name_en") ?? "",
            color: text(category, "color") ?? "#6b7280",
          },
    geometry: geometryOf(raw.geometry),
  };
}

/** `{ seats: [...] }` -> karty; wiersz bez planu albo numeru jest pomijany. */
export function parseMySeatCards(value: unknown): MySeatCard[] {
  const out: MySeatCard[] = [];
  for (const entry of list(bag(value)?.seats)) {
    const card = cardOf(entry);
    if (card !== null) out.push(card);
  }
  return out;
}

export async function fetchMySeats(slug: string): Promise<MySeatCard[]> {
  const { data, error } = await supabase.rpc("event_my_seats", { p_payload: { slug } });
  if (error) throw new Error(error.message);
  return parseMySeatCards(data);
}

export async function fetchTicketSeats(
  slug: string,
  fragment: TicketFragment,
): Promise<MySeatCard[]> {
  const { data, error } = await supabase.rpc("event_ticket_seats", {
    p_payload: {
      slug,
      qr_token: fragment.qrToken,
      ...(fragment.manageToken === null ? {} : { manage_token: fragment.manageToken }),
    },
  });
  if (error) throw new Error(error.message);
  return parseMySeatCards(data);
}
