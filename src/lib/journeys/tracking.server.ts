// Zapis zdarzeń maili ścieżek (otwarcie, kliknięcie, wypis) - jedyne miejsce,
// z którego publiczne trasy (`nl-open`, `nl-click`, wypis) dotykają silnika.
//
// Najemcę ustala RPC `journey_record_message_event` z WIADOMOŚCI (nigdy
// z żądania), a `message_id` przychodzi wyłącznie ze ZWERYFIKOWANEGO tokenu
// HMAC (`trackingToken.server.ts`). Telemetria (otwarcie, kliknięcie) jest
// best-effort - funkcja nigdy nie rzuca, bo piksel ma zawsze oddać obrazek,
// a przekierowanie zawsze przekierować. Wypis NIE jest best-effort: trasa
// dostaje `ok: false` i odpowiada 500, żeby klient pocztowy ponowił żądanie.
type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type JourneyEventKind = "open" | "click" | "unsubscribe";

export interface JourneyEventInput {
  messageId: string;
  kind: JourneyEventKind;
  linkIndex?: number;
  url?: string | null;
  /** Otwarcie przez znany serwer pośredniczący (proxy obrazków poczty). */
  machine?: boolean;
}

export type JourneyEventResult =
  { ok: true; recorded: boolean; known: boolean } | { ok: false; error: string };

/**
 * Serwery pobierające obrazki w imieniu odbiorcy - otwarcie z nich nie jest
 * sygnałem, że człowiek przeczytał maila (Insider: `mpp_share`, `mppinfl`).
 * Apple MPP nie ma rozpoznawalnego UA - łapie go próg czasu w SQL
 * (`machine_open_seconds`).
 */
const MAIL_PROXY_UA =
  /GoogleImageProxy|ggpht\.com|YahooMailProxy|Mimecast|Barracuda|Proofpoint|Outlook-iOS-Android/i;

export function isMailProxyUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && MAIL_PROXY_UA.test(userAgent));
}

export async function recordJourneyMessageEvent(
  input: JourneyEventInput,
): Promise<JourneyEventResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
      "journey_record_message_event",
      {
        p_message_id: input.messageId,
        p_kind: input.kind,
        p_link_index:
          input.kind === "click" ? Math.max(0, Math.min(999, input.linkIndex ?? 0)) : -1,
        p_url: input.kind === "click" ? (input.url ?? null) : null,
        p_machine: input.machine === true,
      },
    );
    if (error) return { ok: false, error: error.message };
    const row = (data ?? {}) as { recorded?: unknown; reason?: unknown };
    return { ok: true, recorded: row.recorded === true, known: row.reason !== "unknown_message" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
