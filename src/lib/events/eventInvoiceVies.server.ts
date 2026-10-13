// VIES - weryfikacja numeru VAT UE nabywcy faktury wydarzenia (INV-12).
//
// PO CO. Usluga online dla firmy z innego panstwa UE (art. 28b ustawy o VAT)
// nie podlega VAT w Polsce, a faktura niesie adnotacje "odwrotne
// obciazenie". Warunkiem jest status nabywcy jako podatnika - dowodem jest
// zapytanie VIES z numerem konsultacji (`requestIdentifier`, gdy zapytujacym
// jest sprzedawca z polskim NIP-em). Dotad numer UE byl sprawdzany wylacznie
// formatem (2-16 znakow), a wystawienie z "np" nie pytalo o nic.
//
// GRANICA. Podmiot zapytania (kraj VIES, numer, zapytujacy) oddaje baza
// klientowi UZYTKOWNIKA (`admin_event_invoice_vies_subject`: bramka
// administratora, tylko szkic, tylko firma z UE). Wynik zapisuje klucz
// uslugowy (`_event_invoice_vies_record`) z najemca z tej odpowiedzi - nigdy
// z ciala zadania. Baza odrzuca wynik, jesli nabywca szkicu zmienil sie
// w trakcie zapytania (`vies_subject_changed`).
//
// NIEDOSTEPNOSC VIES (panstwo czlonkowskie offline, limit zapytan) NIE jest
// odpowiedzia "numer niewazny": nic nie zapisujemy i zwracamy
// `vies_unavailable` - organizator ponawia pozniej.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { jsonRecord, jsonText } from "@/lib/events/eventInvoiceJson";

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

export interface ViesSubject {
  tenantId: string;
  invoiceId: string;
  subject: string;
  countryCode: string;
  vatNumber: string;
  requesterCountry: string | null;
  requesterNumber: string | null;
}

export type ViesCheck =
  | { ok: true; valid: boolean; requestId: string | null; name: string; address: string }
  | { ok: false; error: string };

export function parseViesSubject(value: Json | null): ViesSubject | null {
  const row = jsonRecord(value ?? undefined);
  const subject = jsonText(row.subject);
  const countryCode = jsonText(row.country_code);
  const vatNumber = jsonText(row.vat_number);
  const tenantId = jsonText(row.tenant_id);
  const invoiceId = jsonText(row.invoice_id);
  if (subject === "" || !/^[A-Z]{2}$/.test(countryCode) || vatNumber === "" || tenantId === "") {
    return null;
  }
  const requesterCountry = jsonText(row.requester_country);
  const requesterNumber = jsonText(row.requester_number);
  return {
    tenantId,
    invoiceId,
    subject,
    countryCode,
    vatNumber,
    requesterCountry: requesterCountry === "" ? null : requesterCountry,
    requesterNumber: requesterNumber === "" ? null : requesterNumber,
  };
}

/** Odpowiedz VIES -> wynik albo `vies_unavailable` (kazdy blad techniczny). */
export function parseViesResponse(status: number, body: unknown): ViesCheck {
  const row = (body ?? {}) as {
    valid?: unknown;
    userError?: unknown;
    requestIdentifier?: unknown;
    name?: unknown;
    address?: unknown;
  };
  const userError = typeof row.userError === "string" ? row.userError : "VALID";
  if (status < 200 || status >= 300 || typeof row.valid !== "boolean") {
    return { ok: false, error: "vies_unavailable" };
  }
  // VALID/INVALID to odpowiedz o numerze; reszta (MS_UNAVAILABLE, TIMEOUT,
  // limity zapytan) - niedostepnosc uslugi, nie wynik.
  if (userError !== "VALID" && userError !== "INVALID") {
    return { ok: false, error: "vies_unavailable" };
  }
  const text = (value: unknown): string =>
    typeof value === "string" && value.trim() !== "---" ? value.trim() : "";
  const requestId = text(row.requestIdentifier);
  return {
    ok: true,
    valid: row.valid,
    requestId: requestId === "" ? null : requestId.slice(0, 64),
    name: text(row.name),
    address: text(row.address),
  };
}

export async function checkVies(
  subject: ViesSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<ViesCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(VIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        countryCode: subject.countryCode,
        vatNumber: subject.vatNumber,
        ...(subject.requesterCountry !== null && subject.requesterNumber !== null
          ? {
              requesterMemberStateCode: subject.requesterCountry,
              requesterNumber: subject.requesterNumber,
            }
          : {}),
      }),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return parseViesResponse(res.status, body);
  } catch {
    return { ok: false, error: "vies_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export type ViesVerifyResult =
  | { ok: true; valid: boolean; requestId: string | null; name: string; address: string }
  | { ok: false; error: string };

/** Pelny przebieg: podmiot z bramki -> VIES -> zapis wyniku kluczem uslugowym. */
export async function verifyInvoiceBuyerVies(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ViesVerifyResult> {
  const { data, error } = await supabase.rpc("admin_event_invoice_vies_subject", {
    p_id: invoiceId,
  });
  if (error) return { ok: false, error: error.message };
  const subject = parseViesSubject(data);
  if (subject === null) return { ok: false, error: "vies_not_applicable" };
  const check = await checkVies(subject, fetchImpl);
  if (!check.ok) return check;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: recordError } = await supabaseAdmin.rpc("_event_invoice_vies_record", {
    p_tenant: subject.tenantId,
    p_invoice: subject.invoiceId === "" ? invoiceId : subject.invoiceId,
    p_subject: subject.subject,
    p_valid: check.valid,
    p_request_id: check.requestId ?? "",
  });
  if (recordError) return { ok: false, error: recordError.message };
  return check;
}
