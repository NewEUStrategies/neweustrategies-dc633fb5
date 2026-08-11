// Eksport danych osobowych (RODO art. 15 - dostęp, art. 20 - przenoszalność).
//
// Server fn zwraca dane, które platforma przechowuje o WYWOŁUJĄCYM, jako
// ustrukturyzowany JSON do pobrania na /profile/security. Wszystkie odczyty idą
// klientem user-scoped (RLS wymusza own-row) - funkcja z definicji nie może
// wyeksportować cudzych danych, bo baza ich nie zwróci.
//
// ZAKRES jest DANYMI, nie deklaracją: lista sekcji, ich grupy dziedzinowe i
// świadome wyłączenia żyją w `./exportManifest` (czysty moduł, testowalny bez
// bazy), a payload niesie ten manifest ze sobą. Do 2026-08-06 eksport
// podpisywał się jako komplet, a pomijał CAŁY czat, CAŁY moduł zapytań do
// ekspertów i KOMPLET rozszerzeń profilu - brak nie miał jak być zauważony
// przez osobę, której dane dotyczą.
//
// Sekcje są niezależne (Promise.allSettled): pojedyncza odmowa RLS/grant nie
// psuje całego eksportu, a jej powód ląduje jawnie w sekcji `errors` ORAZ w
// `manifest.failed` - eksport nigdy nie udaje kompletności, której nie ma.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PERSONAL_DATA_EXPORT_FORMAT,
  buildExportManifest,
  diffExportManifest,
  type JsonValue,
} from "./exportManifest";

/** Sufit wierszy dla sekcji strumieniowych - eksport ma być plikiem, nie zrzutem bazy. */
const ROW_LIMIT = 2000;
/** Wiadomości bywają najliczniejsze, więc mają własny, wyższy sufit. */
const MESSAGE_LIMIT = 5000;

type SectionResult = { data: unknown; error: { message: string } | null };

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
    ): Promise<SectionResult> => {
      const rows: JsonValue[] = [];
      for (let offset = 0; offset < ROW_LIMIT; offset += 50) {
        const { data, error } = await fetchPage(offset);
        if (error) return { data: null, error: { message: String(error) } };
        rows.push(...(data ?? []).map(mapRow));
        if (!data || data.length < 50) break;
      }
      return { data: rows, error: null };
    };

    // Kluby dyskusyjne są RLS deny-all z odebranym grantem SELECT dla roli
    // `authenticated` (powierzchnia modułu jest RPC-only), więc `.from("club_*")`
    // zwróciłoby tu pustkę wyglądającą jak „nie korzystam" zamiast błędu grantu.
    // Cały moduł jedzie jednym SECURITY DEFINER RPC, rozbitym niżej na
    // zadeklarowane sekcje - jedno wywołanie, osiem pozycji w manifeście.
    //
    // `Promise.resolve` jest tu istotne: builder PostgREST to *thenable*, które
    // wykonuje żądanie przy KAŻDYM `.then()`. Bez opakowania osiem sekcji
    // znaczyłoby osiem zapytań o ten sam payload.
    const clubExport = Promise.resolve(supabase.rpc("club_export_my_data", { p_limit: ROW_LIMIT }));
    const clubSection = (key: string): PromiseLike<SectionResult> =>
      clubExport.then((result) => {
        if (result.error) return { data: null, error: result.error };
        const payload = result.data;
        // Zawężenie zamiast rzutu: payload jest kontraktem jsonb, a brak klucza
        // ma dać pustą listę, nie `undefined` w pliku użytkownika.
        const rows =
          payload !== null && typeof payload === "object" && !Array.isArray(payload)
            ? (payload[key] ?? [])
            : [];
        return { data: rows, error: null };
      });

    // Kolumny jawnie, bez "*": eksport ma być stabilnym kontraktem, nie
    // przypadkowym zrzutem schematu (i nie może się wywrócić na kolumnie
    // odciętej grantem).
    const sections: Record<string, PromiseLike<SectionResult>> = {
      // ── Tożsamość i podstawa przetwarzania ────────────────────────────────
      profile: supabase.rpc("get_own_profile").then((r) => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      })),
      // Profil eksperta zawiera PII odcięte grantem kolumnowym (telefon, kontakt
      // medialny), więc idzie przez SECURITY DEFINER RPC właściciela - inaczej
      // eksport oddawałby użytkownikowi mniej, niż o nim trzymamy.
      author_profile: supabase.rpc("get_own_author_profile").then((r) => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      })),
      roles: supabase
        .from("user_roles")
        .select("role, tenant_id, created_at")
        .eq("user_id", userId),
      badges: supabase.from("profile_badges").select("badge, created_at").eq("user_id", userId),
      // Rejestr zgód RODO - do 2026-08-03 eksport go NIE zawierał, choć art. 15
      // ust. 1 nakazuje ujawnić także podstawę przetwarzania, a art. 7 ust. 1
      // każe móc WYKAZAĆ zgodę. `gpc` mówi, czy w momencie decyzji przeglądarka
      // wysyłała sygnał opt-outu.
      consents: supabase
        .from("user_consents")
        .select("consent_key, given, version, lang, gpc, given_at, withdrawn_at, updated_at")
        .eq("user_id", userId),
      consent_events: supabase
        .from("user_consent_events")
        .select("consent_key, given, version, lang, source, gpc, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),

      // ── Rozszerzenia profilu (CV, dorobek, obecność medialna) ─────────────
      profile_experiences: supabase
        .from("profile_experiences")
        .select(
          "id, role_title, company, location, start_date, end_date, is_current, description, sort_order, created_at, updated_at",
        )
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      profile_education: supabase
        .from("profile_education")
        .select(
          "id, school, degree, field, start_date, end_date, description, sort_order, created_at, updated_at",
        )
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      profile_skills: supabase
        .from("profile_skills")
        .select("id, label, level, category, sort_order, created_at, updated_at")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      profile_awards: supabase
        .from("profile_awards")
        .select(
          "id, title, issuer, awarded_at, description, kind, url, sort_order, created_at, updated_at",
        )
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      profile_hobbies: supabase
        .from("profile_hobbies")
        .select("id, label, icon, sort_order, created_at, updated_at")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      // Metadane plików CV (sam plik: patrz manifest.excluded.attachment_binaries).
      profile_cv_files: supabase
        .from("profile_cv_files")
        .select(
          "id, file_name, file_url, mime_type, size_bytes, version, is_current, uploaded_at, created_at",
        )
        .eq("user_id", userId)
        .order("uploaded_at", { ascending: false }),
      media_mentions: supabase
        .from("media_mentions")
        .select(
          "id, title, outlet, url, kind, language, published_on, is_public, created_at, updated_at",
        )
        .eq("user_id", userId)
        .order("published_on", { ascending: false }),
      personality_results: supabase
        .from("personality_results")
        .select(
          "openness, conscientiousness, extraversion, agreeableness, neuroticism, taken_at, created_at",
        )
        .eq("user_id", userId),

      // ── Aktywność czytelnicza i publiczna ────────────────────────────────
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
        .limit(ROW_LIMIT),
      comments: supabase
        .from("comments")
        .select("id, post_id, parent_id, body, status, created_at, edited_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
      user_reports_filed: supabase
        .from("user_reports")
        .select("id, reported_id, reason, details, status, created_at, resolved_at")
        .eq("reporter_id", userId)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),

      // ── Sieć kontaktów i reputacja zawodowa ──────────────────────────────
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
      network_introductions: supabase.rpc("my_introduction_requests", { p_role: "all" }),
      recommendations_received: supabase.rpc("list_recommendations", { p_recipient: userId }),
      recommendations_written: supabase
        .from("profile_recommendations")
        .select("id, recipient_id, relationship, body, status, created_at, updated_at")
        .eq("author_id", userId)
        .order("created_at", { ascending: false }),
      skill_endorsements_given: supabase
        .from("profile_skill_endorsements")
        .select("id, recipient_id, skill_id, created_at")
        .eq("endorser_id", userId),
      skill_endorsements_received: supabase
        .from("profile_skill_endorsements")
        .select("id, endorser_id, skill_id, created_at")
        .eq("recipient_id", userId),
      // Kto oglądał profil - RPC honoruje tryb prywatności KAŻDEGO viewera, więc
      // eksport nie odsłania osób ukrytych (art. 15 ust. 4 RODO).
      profile_viewers: supabase.rpc("my_profile_viewers", { p_limit: 200 }),
      profile_view_stats: supabase.rpc("profile_view_stats").then((r) => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      })),

      // ── Czat ─────────────────────────────────────────────────────────────
      // Metadane rozmów, w których uczestniczę (RLS: member_conversation_ids()).
      chat_conversations: supabase
        .from("conversations")
        .select(
          "id, kind, title, description, created_by, created_at, last_message_at, message_ttl_seconds",
        )
        .order("last_message_at", { ascending: false })
        .limit(ROW_LIMIT),
      // Mój wiersz uczestnictwa: stan przeczytania, archiwum, wyciszenie, przypięcie.
      chat_participation: supabase
        .from("conversation_participants")
        .select(
          "conversation_id, role, unread_count, last_read_at, last_delivered_at, muted_until, pinned_at, archived_at, cleared_before, created_at",
        )
        .eq("user_id", userId),
      // WYŁĄCZNIE moje wiadomości - cudze są wyłączeniem zadeklarowanym w manifeście.
      chat_messages_sent: supabase
        .from("messages")
        .select(
          "id, conversation_id, kind, body, reply_to_id, forwarded, attachment_name, attachment_mime, attachment_size, attachment_path, attachment_duration, created_at, edited_at, deleted_at, expires_at",
        )
        .eq("sender_id", userId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_LIMIT),
      // Przezwiska, które JA nadałem (nadane mnie przez innych to ich dane).
      chat_nicknames_set: supabase
        .from("conversation_nicknames")
        .select("conversation_id, user_id, nickname, created_at, updated_at")
        .eq("set_by", userId),
      chat_blocks: supabase
        .from("user_blocks")
        .select("blocked_id, created_at")
        .eq("blocker_id", userId),

      // ── Zapytania do ekspertów ───────────────────────────────────────────
      expert_requests_sent: supabase.rpc("list_my_inmails", { p_box: "sent" }),
      expert_requests_received: supabase.rpc("list_my_inmails", { p_box: "received" }),

      // ── Kluby dyskusyjne ─────────────────────────────────────────────────
      // Własne wpisy anonimowe SĄ tutaj: `is_anonymous` to funkcja projekcji
      // przy odczycie publicznym, a nie brak autorstwa. Cudze wypowiedzi -
      // patrz manifest.excluded.club_content_authored_by_others.
      club_memberships: clubSection("club_memberships"),
      // Zgłoszenie do klubu: dane zawodowe, motywacja, cele i wkład, które osoba
      // sama o sobie napisała - art. 20 RODO w najczystszej postaci. Klucz jedzie
      // z tego samego payloadu co reszta modułu; bez tej linii RPC oddawał go, a
      // eksport go NIE wyjmował, bo klient czyta wyłącznie zadeklarowane sekcje.
      // Notatka komisji zostaje po stronie bazy (manifest.excluded.club_admin_notes).
      club_applications: clubSection("club_applications"),
      club_threads_authored: clubSection("club_threads_authored"),
      club_replies_authored: clubSection("club_replies_authored"),
      club_stances: clubSection("club_stances"),
      club_reactions: clubSection("club_reactions"),
      club_thread_subscriptions: clubSection("club_thread_subscriptions"),
      club_invitations_received: clubSection("club_invitations_received"),

      // ── Płatności i uprawnienia zakupowe ─────────────────────────────────
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

      // ── Preferencje i kanały doręczeń ────────────────────────────────────
      notification_preferences: supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId),
      notifications: supabase
        .from("notifications")
        .select("id, kind, title_pl, title_en, body_pl, body_en, href, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
      push_subscriptions: supabase
        .from("push_subscriptions")
        .select("endpoint, created_at")
        .eq("user_id", userId),
      invitations_sent: supabase
        .from("user_invitations")
        .select("id, email, display_name, role, mode, status, sent_at, accepted_at, created_at")
        .eq("invited_by", userId)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
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

    // Rozjazd deklaracja ⇄ implementacja nie może przejść w ciszy: trafia do
    // pliku (nie tylko do logu), bo to plik jest dowodem wykonania art. 15.
    const drift = diffExportManifest(keys);
    const manifest = buildExportManifest(Object.keys(errors));

    return {
      format: PERSONAL_DATA_EXPORT_FORMAT,
      exported_at: new Date().toISOString(),
      user_id: userId,
      email: (claims.email as string | undefined) ?? null,
      manifest:
        drift.missing.length === 0 && drift.undeclared.length === 0
          ? manifest
          : { ...manifest, drift },
      sections: out,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };
  });
