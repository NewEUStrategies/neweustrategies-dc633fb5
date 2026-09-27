// Czytniki pól JSON odpowiedzi RPC faktur - bez żadnej zależności od parsera
// dokumentu. Osobny plik, bo lekkie ścieżki (profil kupującego, opcje prośby
// o fakturę) potrzebują tylko tych kilku funkcji, a `eventInvoiceDocument`
// przychodzi tam `import()`-em w chwili pobrania dokumentu (budżet paczek).
import type { Json } from "@/integrations/supabase/types";

export type JsonObject = { [key: string]: Json | undefined };

export function jsonRecord(value: Json | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function jsonList(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

export function jsonText(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

export function jsonTextOrNull(value: Json | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function jsonNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function jsonBool(value: Json | undefined): boolean {
  return value === true;
}
