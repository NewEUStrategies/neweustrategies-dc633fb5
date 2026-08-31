// Wspólny harness dla testów `src/lib/content.functions.ts` (21 server fn).
//
// PO CO OSOBNY PLIK, A NIE KOPIA W KAŻDYM TEŚCIE. Sekcja treści dzieli się na
// pięć plików testowych (schematy, updatePost, pozostałe wpisy, strony,
// taksonomie), bo jeden monolit już raz kosztował to repo utratę forka i 19 pp
// pokrycia (`editorMatrix.test.tsx`, uzasadnienie w `vitest.config.ts`).
// Pięć kopii tej samej atrapy `createServerFn` i tego samego wiersza `posts`
// rozjechałoby się przy pierwszej zmianie schematu - dlatego atrapy graniczne
// i fixture wiersza stoją TUTAJ, a każdy plik testowy deklaruje własny blok
// `vi.mock` (hoisting `vi.mock` działa wyłącznie na poziomie pliku).
//
// CO JEST TU ATRAPĄ - i tylko to: granice. `createServerFn` (nie da się
// wywołać bez kontekstu żądania frameworka), klient PostgREST, RPC, rate limit
// i audyt. Warstwy domenowe, po które sięga content.functions
// (`content/workflow`, `content/sponsored`, `content/revisions`, `seo/redirects`,
// `audio/ttsCanonical`, `content/postAuthors`) biegną PRAWDZIWE - inaczej test
// dowodziłby, że atrapa działa, a nie że bramka publikacji działa.
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabaseChain";
import type { Database } from "@/integrations/supabase/types";

// ---------- atrapa createServerFn ----------

export type Validator = (input: unknown) => unknown;
export type Handler = (ctx: { data: unknown; context: unknown }) => Promise<unknown>;

export interface ServerFnSpec {
  validator?: Validator;
  handler?: Handler;
}

export interface ServerFnChain {
  middleware: (middleware: unknown) => ServerFnChain;
  validator: (validator: Validator) => ServerFnChain;
  inputValidator: (validator: Validator) => ServerFnChain;
  handler: (handler: Handler) => ServerFnSpec;
}

/**
 * `createServerFn` zastąpiony łańcuchem, który ODDAJE walidator i handler -
 * inaczej nie ma jak wywołać server fn w teście jednostkowym. Ten sam wzorzec,
 * co w `categoryColorSave.test.ts` i `revisionsFunctions.test.ts`.
 */
export function createServerFnStub(): ServerFnChain {
  const spec: ServerFnSpec = {};
  const chain: ServerFnChain = {
    middleware: () => chain,
    validator: (validator) => {
      spec.validator = validator;
      return chain;
    },
    inputValidator: (validator) => {
      spec.validator = validator;
      return chain;
    },
    handler: (handler) => {
      spec.handler = handler;
      return spec;
    },
  };
  return chain;
}

// ---------- identyfikatory (brak danych osobowych, adresy w example.com) ----------

export const POST_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_POST_ID = "1111111a-1111-4111-8111-111111111111";
export const PAGE_ID = "22222222-2222-4222-8222-222222222222";
export const PARENT_PAGE_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_PARENT_ID = "3333333a-3333-4333-8333-333333333333";
export const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
export const TAG_ID = "55555555-5555-4555-8555-555555555555";
export const TENANT = "66666666-6666-4666-8666-666666666666";
export const USER = "77777777-7777-4777-8777-777777777777";
export const OTHER_USER = "7777777a-7777-4777-8777-777777777777";
export const ORG_ID = "88888888-8888-4888-8888-888888888888";
export const TEMPLATE_ID = "99999999-9999-4999-8999-999999999999";

/** Głos z allowlisty TTS (`lib/audio/ttsCanonical.ts`) - nie wymyślony ciąg. */
export const ALLOWED_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export const BASE_TS = "2026-08-20T10:00:00.000Z";
export const NEXT_TS = "2026-08-20T11:00:00.000Z";

// ---------- fixture wierszy (kształt z typów generowanych) ----------

type PostRow = Database["public"]["Tables"]["posts"]["Row"];
type PageRow = Database["public"]["Tables"]["pages"]["Row"];

const BASE_POST: PostRow = {
  audio_url_en: null,
  audio_url_pl: null,
  author_id: USER,
  blocks_data: null,
  builder_data: null,
  content_en: null,
  content_pl: "Treść wpisu",
  cover_image_url: null,
  created_at: "2026-08-01T09:00:00.000Z",
  custom_meta: {},
  deleted_at: null,
  editor: "blocks",
  excerpt_en: null,
  excerpt_pl: null,
  id: POST_ID,
  is_sponsored: false,
  layout_overrides: null,
  og_image_generated_url: null,
  organization_id: null,
  organization_logo_url: null,
  organization_name: null,
  organization_website: null,
  outbound_links_checked_at: null,
  parent_page_id: PARENT_PAGE_ID,
  post_format: "standard",
  publish_at: null,
  published_at: null,
  read_minutes: 4,
  related_override: null,
  search_vector: null,
  seo_canonical_url: null,
  seo_description_en: null,
  seo_description_pl: null,
  seo_noindex: false,
  seo_og_image_url: null,
  seo_title_en: null,
  seo_title_pl: null,
  sidebar_layout_id: null,
  slug: "stary-slug",
  sponsored_advertiser_name: null,
  sponsored_advertiser_url: null,
  sponsored_affiliate: false,
  sponsored_kind: null,
  sponsored_marked_at: null,
  sponsored_marked_by: null,
  sponsored_note_en: null,
  sponsored_note_pl: null,
  sponsored_order_ref: null,
  sponsored_payer_name: null,
  sponsored_political: false,
  sponsored_political_process: null,
  sponsored_sponsor_controller: null,
  status: "draft",
  takeaways_en: [],
  takeaways_pl: [],
  takeaways_variant: null,
  template_id: null,
  tenant_id: TENANT,
  title_en: "Old title",
  title_pl: "Stary tytuł",
  toc_override: null,
  tts_voice_en: null,
  tts_voice_pl: null,
  updated_at: BASE_TS,
};

const BASE_PAGE: PageRow = {
  author_id: USER,
  builder_data: null,
  content_en: null,
  content_pl: null,
  cover_image_url: null,
  created_at: "2026-08-01T09:00:00.000Z",
  deleted_at: null,
  editor: "builder",
  excerpt_en: null,
  excerpt_pl: null,
  header_override: null,
  id: PAGE_ID,
  layout_overrides: null,
  menu_order: 0,
  og_image_generated_url: null,
  parent_id: null,
  publish_at: null,
  published_at: null,
  search_vector: null,
  seo_canonical_url: null,
  seo_description_en: null,
  seo_description_pl: null,
  seo_noindex: false,
  seo_og_image_url: null,
  seo_title_en: null,
  seo_title_pl: null,
  slug: "stara-strona",
  status: "draft",
  takeaways_en: [],
  takeaways_pl: [],
  takeaways_variant: null,
  template_id: null,
  template_type: "default",
  tenant_id: TENANT,
  title_en: "Old page",
  title_pl: "Stara strona",
  toc_override: null,
  updated_at: BASE_TS,
};

export function postRow(over: Partial<PostRow> = {}): PostRow {
  return { ...BASE_POST, ...over };
}

export function pageRow(over: Partial<PageRow> = {}): PageRow {
  return { ...BASE_PAGE, ...over };
}

// ---------- klient (from + rpc) ----------

export type RpcResponder = (args: unknown) => SupabaseResult;

export interface RpcCall {
  fn: string;
  args: unknown;
}

export interface ContentClient {
  /** Atrapa PostgREST klienta wołającego (pod RLS użytkownika). */
  db: SupabaseFromStub;
  /** Obiekt wstrzykiwany jako `context.supabase`. */
  supabase: {
    from: SupabaseFromStub["from"];
    rpc: (fn: string, args?: unknown) => Promise<SupabaseResult>;
  };
  rpcCalls: RpcCall[];
  setRpc(fn: string, responder: RpcResponder | SupabaseResult): void;
}

export interface ContentClientOptions {
  tenant?: string | null;
  tenantError?: boolean;
  /** Wynik `can_publish_content` (bramka workflow). */
  canPublish?: boolean;
  /** Profile widziane przez `setPostAuthors` (filtr tenanta + `in`). */
  profileIds?: readonly string[];
}

export function contentClient(opts: ContentClientOptions = {}): ContentClient {
  const { tenant = TENANT, tenantError = false, canPublish = true, profileIds } = opts;
  const db = supabaseFromStub();
  db.setResponse("profiles", (chain) => {
    // Dwa różne zapytania do `profiles`: rozwiązanie tenanta (maybeSingle) oraz
    // sprawdzenie przynależności autorów (`in`).
    if (chain.has("maybeSingle")) {
      if (tenantError) return fail("profiles unavailable");
      return ok(tenant === null ? {} : { tenant_id: tenant });
    }
    if (!profileIds) return fail("test: brak zaplanowanych profili autorów");
    return ok(profileIds.map((id) => ({ id })));
  });

  const rpcCalls: RpcCall[] = [];
  const rpc = new Map<string, RpcResponder>();
  rpc.set("can_publish_content", () => ok(canPublish));
  rpc.set("page_full_path", () => ok(null));

  return {
    db,
    supabase: {
      from: db.from,
      rpc: async (fn: string, args?: unknown) => {
        rpcCalls.push({ fn, args });
        const responder = rpc.get(fn);
        if (!responder) return fail(`test: brak zaplanowanej odpowiedzi dla RPC "${fn}"`);
        return responder(args);
      },
    },
    rpcCalls,
    setRpc(fn, responder) {
      rpc.set(fn, typeof responder === "function" ? responder : () => responder);
    },
  };
}

// ---------- responders wielokrotnego użytku ----------

export interface EntityTableOptions {
  /** Czy dany kandydat slug jest zajęty (sonda `uniqueSlug`). */
  slugTaken?: (candidate: string) => boolean;
  /** Wynik głównego UPDATE-a (`.select("id, updated_at")`). */
  updated?: SupabaseResult;
  /** Wynik wymuszonego "touch" przy zapisie samych taksonomii. */
  touched?: SupabaseResult;
  /** Odczyt rozróżniający konflikt optimistic-lock od odmowy RLS. */
  stillVisible?: SupabaseResult;
  /** Wynik DELETE / bulk DELETE. */
  deleted?: SupabaseResult;
  /** Wynik INSERT-u (createPost / createPage / duplicatePost). */
  inserted?: SupabaseResult;
  /** Wiersze zwrócone przez pierwszy UPDATE ścieżki `published` (published_at IS NULL). */
  bulkStamped?: SupabaseResult;
  /** Wiersze zwrócone przez drugi UPDATE ścieżki `published`. */
  bulkKept?: SupabaseResult;
  /** Wynik pojedynczego UPDATE-a ścieżki nie-`published` w applyBulkStatus. */
  bulkPlain?: SupabaseResult;
  /** Odczyt metadanych (`select(...).maybeSingle()`) - duplicatePost, setPostAuthors. */
  meta?: SupabaseResult;
}

/**
 * Jeden responder dla tabeli `posts`/`pages`, rozpoznający ogniwa łańcucha.
 *
 * Produkcyjny kod uderza w TĘ SAMĄ tabelę kilkoma różnymi zapytaniami w jednym
 * przebiegu (sonda slugu, UPDATE, odczyt „czy wiersz nadal widoczny", touch
 * taksonomii, dwa UPDATE-y ścieżki hurtowej). Atrapa `supabaseFromStub`
 * odpowiada per TABELA, więc rozróżnienie musi pochodzić z zapisanego łańcucha -
 * i to jest zaleta, nie obejście: test widzi dokładnie te ogniwa, które kod
 * naprawdę wywołał.
 */
export function entityTable(cfg: EntityTableOptions = {}): TableResponder {
  return (chain: RecordedChain): SupabaseResult => {
    if (chain.has("delete")) return cfg.deleted ?? ok([]);
    if (chain.has("insert")) return cfg.inserted ?? fail("test: nie zaplanowano INSERT-u");
    if (chain.has("update")) {
      // Ścieżka hurtowa `published` rozbija się na dwa filtrowane UPDATE-y.
      if (chain.has("is")) return cfg.bulkStamped ?? ok([]);
      if (chain.has("not")) return cfg.bulkKept ?? ok([]);
      if (chain.has("in")) return cfg.bulkPlain ?? cfg.deleted ?? ok([]);
      const patch = chain.argsOf("update")?.[0];
      const onlyTouch =
        typeof patch === "object" &&
        patch !== null &&
        Object.keys(patch as Record<string, unknown>).length === 1 &&
        "updated_at" in (patch as Record<string, unknown>);
      if (onlyTouch) return cfg.touched ?? ok([{ id: POST_ID, updated_at: NEXT_TS }]);
      return cfg.updated ?? ok([{ id: POST_ID, updated_at: NEXT_TS }]);
    }
    // Sonda unikalności slugu: select + eq(tenant_id) + eq(slug) + limit(1).
    if (chain.has("limit")) {
      const candidate = chain.calls.filter((c) => c.method === "eq").at(-1)?.args[1];
      const taken = cfg.slugTaken?.(String(candidate)) ?? false;
      return taken ? ok([{ id: OTHER_POST_ID }]) : ok([]);
    }
    if (chain.has("maybeSingle")) {
      return cfg.meta ?? cfg.stillVisible ?? ok(null);
    }
    return ok([]);
  };
}

/** Tabele relacji taksonomii - DELETE i INSERT zawsze przechodzą. */
export function taxonomyTables(db: SupabaseFromStub, rows: readonly unknown[] = []): void {
  for (const table of [
    "post_categories",
    "post_tags",
    "post_programs",
    "post_regions",
    "post_authors",
  ]) {
    db.setResponse(table, ok(rows));
  }
}

export { fail, ok };
