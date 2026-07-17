// Eksport danych osobowych (RODO art. 15 - dostęp, art. 20 - przenoszalność).
//
// Server fn zwraca komplet danych, które platforma przechowuje o WYWOŁUJĄCYM,
// jako ustrukturyzowany JSON do pobrania na /profile/security. Wszystkie
// odczyty idą klientem user-scoped (RLS wymusza own-row) - funkcja z definicji
// nie może wyeksportować cudzych danych, bo baza ich nie zwróci.
//
// Sekcje są niezależne (Promise.allSettled): pojedyncza odmowa RLS/grant nie
// psuje całego eksportu, a jej powód ląduje jawnie w sekcji `errors` -
// eksport nigdy nie udaje kompletności, której nie ma.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Wynik jest transportowany do klienta - jawny typ JSON zamiast `unknown`,
 *  żeby walidator serializacji server fn miał dowód przenośności. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;

    // Sieć kontaktów jest RPC-only (user_connections nie ma grantów SELECT),
    // więc eksport idzie przez te same SECURITY DEFINER RPC co UI. RPC stronicuje
    // po 50 - eksport skleja strony do rozsądnego sufitu, jawnie mapując pola
    // (stabilny kontrakt jak niżej).
    const fetchNetworkPages = async <Row>(
      fetchPage: (offset: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
      mapRow: (row: Row) => JsonValue,
    ): Promise<{ data: JsonValue; error: { message: string } | null }> => {
      const rows: JsonValue[] = [];
      for (let offset = 0; offset < 2000; offset += 50) {
        const { data, error } = await fetchPage(offset);
        if (error) return { data: null, error: { message: String(error) } };
        rows.push(...(data ?? []).map(mapRow));
        if (!data || data.length < 50) break;
      }
      return { data: rows, error: null };
    };

    // Kolumny jawnie, bez "*": eksport ma być stabilnym kontraktem, nie
    // przypadkowym zrzutem schematu (i nie może się wywrócić na kolumnie
    // odciętej grantem).
    const sections: Record<
      string,
      PromiseLike<{ data: unknown; error: { message: string } | null }>
    > = {
      profile: supabase.rpc("get_own_profile").then((r) => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      })),
      roles: supabase
        .from("user_roles")
        .select("role, tenant_id, created_at")
        .eq("user_id", userId),
      follows: supabase
        .from("user_follows")
        .select("target_type, target_id, created_at")
        .eq("user_id", userId),
      policy_tracker_follows: supabase
        .from("eu_policy_follows")
        .select("item_id, created_at")
        .eq("user_id", userId),
      bookmarks: supabase
        .from("user_bookmarks")
        .select("entity_type, entity_id, created_at")
        .eq("user_id", userId),
      reading_history: supabase
        .from("user_read_history")
        .select("post_id, read_at")
        .eq("user_id", userId)
        .order("read_at", { ascending: false })
        .limit(2000),
      comments: supabase
        .from("comments")
        .select("id, post_id, parent_id, body, status, created_at, edited_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(2000),
      orders: supabase
        .from("payment_orders")
        .select("id, kind, status, amount_cents, currency, created_at, paid_at")
        .eq("user_id", userId),
      subscriptions: supabase
        .from("user_subscriptions")
        .select("id, plan_id, status, current_period_end, canceled_at, created_at")
        .eq("user_id", userId),
      purchases: supabase
        .from("user_purchases")
        .select("entity_type, entity_id, status, amount_cents, currency, purchased_at")
        .eq("user_id", userId),
      notification_preferences: supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId),
      push_subscriptions: supabase
        .from("push_subscriptions")
        .select("endpoint, created_at")
        .eq("user_id", userId),
      personality_results: supabase
        .from("personality_results")
        .select(
          "openness, conscientiousness, extraversion, agreeableness, neuroticism, taken_at, created_at",
        )
        .eq("user_id", userId),
      badges: supabase
        .from("profile_badges")
        .select("badge, note, created_at")
        .eq("user_id", userId),
      network_connections: fetchNetworkPages(
        (offset) => supabase.rpc("my_connections", { p_query: "", p_limit: 50, p_offset: offset }),
        (row) => ({
          user_id: row.user_id,
          display_name: row.display_name,
          connected_at: row.connected_at,
        }),
      ),
      network_invitations_sent: fetchNetworkPages(
        (offset) =>
          supabase.rpc("my_connection_requests", {
            p_direction: "out",
            p_limit: 50,
            p_offset: offset,
          }),
        (row) => ({
          user_id: row.user_id,
          display_name: row.display_name,
          message: row.message,
          requested_at: row.requested_at,
        }),
      ),
      network_invitations_received: fetchNetworkPages(
        (offset) =>
          supabase.rpc("my_connection_requests", {
            p_direction: "in",
            p_limit: 50,
            p_offset: offset,
          }),
        (row) => ({
          user_id: row.user_id,
          display_name: row.display_name,
          message: row.message,
          requested_at: row.requested_at,
        }),
      ),
    };

    const keys = Object.keys(sections);
    const settled = await Promise.allSettled(keys.map((k) => sections[k]));

    const out: Record<string, JsonValue> = {};
    const errors: Record<string, string> = {};
    settled.forEach((result, i) => {
      const key = keys[i];
      if (result.status === "fulfilled") {
        if (result.value.error) {
          errors[key] = result.value.error.message;
        } else {
          // Wiersze pochodzą z PostgREST (czysty JSON) - rzut jest bezpieczny.
          out[key] = (result.value.data ?? null) as JsonValue;
        }
      } else {
        errors[key] = String(result.reason);
      }
    });

    return {
      format: "nes.personal-data-export.v1",
      exported_at: new Date().toISOString(),
      user_id: userId,
      email: (claims.email as string | undefined) ?? null,
      sections: out,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };
  });
