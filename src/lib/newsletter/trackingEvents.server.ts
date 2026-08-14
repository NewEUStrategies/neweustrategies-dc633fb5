// Serwerowy zapis zdarzeń zaangażowania newslettera (open/click).
//
// DWIE BRAMKI, ZANIM POWSTANIE WIERSZ:
//
//  1. ŹRÓDŁO. Producent deklaruje, kim jest (`source`), a moduł przepuszcza
//     wyłącznie to jedno źródło, które jest w tej instalacji źródłem prawdy
//     (patrz engagementSource.ts). Dwaj producenci mierzący to samo - piksel
//     własny i webhook dostawcy - dawali podwójny zapis, a więc wskaźnik
//     otwarć powyżej 100%.
//
//  2. IDEMPOTENCJA I TENANT. Zapis idzie JEDNYM wywołaniem RPC
//     `newsletter_record_campaign_event` (SECURITY DEFINER, tylko service_role).
//     To ono ustala tenanta z KAMPANII (nigdy z żądania), potwierdza, że
//     subskrybent należy do tego samego obszaru roboczego, i wstawia wiersz
//     idempotentnie w dobie UTC (`ON CONFLICT DO NOTHING` na unikalnym
//     indeksie z migracji 20260814150000). Wcześniej były to trzy rundy do
//     bazy z oknem TOCTOU pomiędzy nimi.
//
// Telemetria pozostaje best-effort: funkcja NIGDY nie rzuca, bo żaden jej błąd
// nie może zepsuć pikselowi odpowiedzi ani przekierowaniu docelowego adresu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  resolveEngagementSource,
  isEngagementWriter,
  ENGAGEMENT_SOURCE_ENV,
  type EngagementSource,
} from "./engagementSource";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rozstrzygnięcie próby zapisu - obserwowalne, bo „cisza" też jest wynikiem. */
export type RecordEventOutcome =
  | "recorded"
  | "duplicate_in_day"
  | "source_disabled"
  | "invalid_input"
  | "invalid_kind"
  | "unknown_campaign"
  | "unknown_subscriber"
  | "write_failed";

export interface RecordCampaignEventInput {
  campaignId: string;
  /** Ze ZWERYFIKOWANEGO tokenu HMAC (kampania+subskrybent) albo z korelacji webhooka. */
  subscriberId: string | null;
  kind: "open" | "click";
  url: string | null;
  source: EngagementSource;
}

export interface RecordCampaignEventResult {
  recorded: boolean;
  outcome: RecordEventOutcome;
}

/**
 * Rzutowanie na granicy niewygenerowanych typów - RPC jest nowsze niż
 * `types.ts`. Trzymane w JEDNYM miejscu, żeby publiczne API modułu pozostało
 * w pełni otypowane (precedens: `rpcClient` w src/lib/email/suppression.server.ts).
 */
type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function rpcClient(admin: SupabaseClient<Database>): RpcCallable {
  return admin as unknown as RpcCallable;
}

const OUTCOMES: readonly RecordEventOutcome[] = [
  "recorded",
  "duplicate_in_day",
  "source_disabled",
  "invalid_input",
  "invalid_kind",
  "unknown_campaign",
  "unknown_subscriber",
  "write_failed",
];

/** Czytamy odpowiedź RPC przez zawężenie, nie przez cast - kształt pochodzi z bazy. */
function readOutcome(data: unknown): RecordCampaignEventResult {
  if (typeof data !== "object" || data === null) {
    return { recorded: false, outcome: "write_failed" };
  }
  const row: Record<string, unknown> = { ...data };
  const recorded = row.recorded === true;
  const reason = typeof row.reason === "string" ? row.reason : "";
  // Powód spoza katalogu (nowsza baza niż ten kod) nie może dać sprzecznej
  // pary „zapisano + awaria": o fakcie zapisu rozstrzyga baza, a klasyfikację
  // wyprowadzamy z niego, zamiast zgadywać.
  const known = (OUTCOMES as readonly string[]).includes(reason);
  return {
    recorded,
    outcome: known ? (reason as RecordEventOutcome) : recorded ? "recorded" : "write_failed",
  };
}

/**
 * Zapisuje zdarzenie open/click. Zwraca rozstrzygnięcie zamiast `void`, żeby
 * wywołujący (i testy) widzieli RÓŻNICĘ między „policzone", „już policzone
 * dzisiaj" a „to źródło nie pisze" - trzy różne prawdy, dotąd nieodróżnialne.
 */
export async function recordCampaignEvent(
  input: RecordCampaignEventInput,
): Promise<RecordCampaignEventResult> {
  const configured = resolveEngagementSource(process.env[ENGAGEMENT_SOURCE_ENV]);
  if (!isEngagementWriter(input.source, configured)) {
    return { recorded: false, outcome: "source_disabled" };
  }
  if (!UUID_RE.test(input.campaignId)) {
    return { recorded: false, outcome: "invalid_input" };
  }
  // Zdarzenie bez subskrybenta nie da się ani przypisać, ani zdeduplikować
  // (NULL-e w indeksie unikalnym są rozłączne), więc odsiewamy je zanim
  // zapłacimy za rundę do bazy. Baza odsiewa je tak samo - to obrona w głąb.
  if (!input.subscriberId || !UUID_RE.test(input.subscriberId)) {
    return { recorded: false, outcome: "unknown_subscriber" };
  }
  if (input.kind !== "open" && input.kind !== "click") {
    return { recorded: false, outcome: "invalid_kind" };
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await rpcClient(supabaseAdmin).rpc("newsletter_record_campaign_event", {
      p_campaign: input.campaignId,
      p_subscriber: input.subscriberId,
      p_kind: input.kind,
      p_url: input.url ? input.url.slice(0, 2048) : null,
    });
    if (error) return { recorded: false, outcome: "write_failed" };
    return readOutcome(data);
  } catch {
    // Telemetria best-effort - piksel i przekierowanie odpowiadają zawsze.
    return { recorded: false, outcome: "write_failed" };
  }
}
