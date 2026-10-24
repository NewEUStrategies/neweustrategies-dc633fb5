// Newsletter campaigns — admin CRUD + wysyłka paczkami przez Resend.
//
// Bezpieczeństwo:
//  - każda funkcja ma bramkę roli; odczyt - `requireStaff`, a ZAPIS i WYSYŁKA
//    są wyłącznie dla admina i editora (def. 10: autor nie wysyła kampanii) -
//    `requireAdminEditor` na zapisie, wysyłce, ticku z panelu i tworzeniu
//    kampanii kuponowej. Handler dodatkowo czyta kampanię klientem
//    UŻYTKOWNIKA (RLS `campaigns_staff_select`), więc edycja niewidocznej
//    kampanii kończy się jawną odmową, a nie cichym „zapisano";
//  - wysyłka i log wysyłek idą przez `supabaseAdmin` z pinowaniem po `tenant_id`
//    pochodzącym z profilu wywołującego (nigdy z inputu klienta),
//  - kampania nie może być wysłana ponownie po statusie `sent`; świeże
//    `sending` też jest zablokowane (wyjątek: crash recovery, patrz niżej).
//
// Kampania KUPONOWA (P04) = kampania newslettera, na którą wskazuje
// `b2b_coupon_campaigns.newsletter_campaign_id` tego najemcy. Wysyłka jest
// wtedy fail-closed: segment (lista mailingowa) musi być poprawny i znany,
// każdy odbiorca dostaje WŁASNY kod (`{{coupon_code}}`, przypisanie zapisane
// w `b2b_coupons.metadata`, wznowienie używa tego samego kodu), a za mało
// kodów zatrzymuje porcję przed pierwszym mailem. Status `sent` kampanii
// kuponowej ustawia wyłącznie ten serwer - dopiero po zakończonej wysyłce.
//
// Wysyłka:
//  - `sendCampaign` przełącza status → `sending`, materializuje odbiorców
//    (audience_filter → newsletter_subscribers), a następnie wysyła
//    paczkami po 20 e-maili (Resend limit ~1 e-mail/sek per konto — chunki
//    zmniejszają ryzyko rate-limita), logując każdą próbę w
//    `newsletter_campaign_recipients`.
//  - Każdy odbiorca dostaje stopkę „Unsubscribe" z indywidualnym tokenem.
//  - Zmienne `{{firstName}}`, `{{lastName}}`, `{{email}}` są renderowane
//    per odbiorca.
//
// Praca porcjami + dzierżawa (od 20260713170000):
//  - jedno wywołanie wysyła najwyżej MAX_EMAILS_PER_INVOCATION e-maili
//    i ODDAJE dzierżawę (lease_until=NULL) - koniec z jednym requestem
//    trzymanym przez całą listę (timeout na dużych listach). Kampania
//    w `sending` bez aktywnej dzierżawy jest natychmiast wznawialna
//    przez UI, drugiego admina albo automatyczny tick.
//  - Wznowienie jest idempotentne: odbiorcy z logu ze statusem `sent`
//    nigdy nie dostają wiadomości drugi raz; `failed`/`skipped` są ponawiani.
//
// Harmonogram:
//  - automatyczny: pg_cron + pg_net POST-uje co minutę na
//    /api/public/jobs-tick (sekret w job_runner_settings), który woła
//    `tickNewsletterCampaigns` cross-tenant - kampanie zaplanowane wysyłają
//    się BEZ udziału człowieka (SQL sam nie może: wysyłka wymaga env
//    RESEND_API_KEY, stąd wywołanie HTTP do aplikacji).
//  - zapasowy (opportunistic, docs/ARCHITECTURE.md §2.6): `processDueCampaigns`
//    przy wejściu admina na listę kampanii / overview + przycisk ręczny.
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminEditor, requireStaff } from "@/integrations/supabase/require-staff";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";
import { readPreferences } from "@/lib/newsletter/preferences";
import {
  SAMPLE_COUPON_CODE,
  esc,
  renderCampaignHtml,
} from "@/lib/newsletter/renderCampaign.server";
import { signTrackingToken, signTrackingLink } from "@/lib/newsletter/trackingToken.server";
import { newsletterUnsubscribeUrl } from "@/lib/newsletter/unsubscribeUrl";
import { parseEmailDoc, type EmailDoc } from "@/lib/newsletter/emailDoc";
import { renderEmailHtml } from "@/lib/newsletter/renderEmailHtml";
import {
  fetchEmailDocPostRows,
  postRefsForLang,
  type EmailDocDbClient,
  type EmailPostRow,
} from "@/lib/newsletter/emailDocResolve";
import { fetchSuppressedEmails } from "@/lib/email/suppression.server";
import { evaluateSendGate } from "@/lib/email/reputationGate.server";
// JEDNA droga wyjścia poczty z platformy (kampanie + dren kolejki) - patrz
// src/lib/email/provider.server.ts. Wcześniej kampanie miały własną kopię
// wywołania gatewaya, a kolejka drugą, z innym formatem błędów i bez
// identyfikatora wiadomości do korelacji webhooków.
import { sendEmail } from "@/lib/email/provider.server";

type DbClient = SupabaseClient<Database>;

// Zbiór (lower) e-maili kont o randze warstwy >= minRank w tenancie. Używany do
// przecięcia z listą subskrybentów przy segmencie członkowskim kampanii.
async function minTierEmailSet(
  admin: DbClient,
  tenantId: string,
  minRank: number,
): Promise<Set<string>> {
  const { data, error } = await admin.rpc("newsletter_min_tier_emails", {
    p_tenant: tenantId,
    p_min: minRank,
  });
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => normalizeEmail(r.email)).filter(Boolean));
}

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100; // Resend free plan ~1 msg/s
const DUE_CAMPAIGNS_PER_TICK = 3; // limit kampanii odpalanych w jednym ticku
// Górna granica e-maili wysłanych w JEDNYM wywołaniu server fn / ticku:
// ~200 * (1.1s / 20) ≈ 12 s requestu - bezpiecznie poniżej timeoutów runtime.
const MAX_EMAILS_PER_INVOCATION = 200;
// Dzierżawa aktywnego procesora: chroni przed równoległym podwójnym
// przetwarzaniem; wygasa sama, gdyby proces zginął w trakcie porcji.
const LEASE_MS = 3 * 60 * 1000;

const AudienceFilter = z.object({
  languages: z
    .array(z.enum(["pl", "en"]))
    .max(2)
    .optional(),
  statuses: z
    .array(z.enum(["subscribed", "pending"]))
    .max(2)
    .optional(),
  source: z.string().trim().max(120).optional(),
  // Personalizacja komunikacji: zawęź do subskrybentów będących kontami
  // o randze warstwy >= min_tier_rank (np. tylko członkowie). 0/undefined = bez
  // ograniczenia. Przecięcie po e-mailu (newsletter_min_tier_emails).
  min_tier_rank: z.number().int().min(0).max(1000).optional(),
  // Lista mailingowa (`id` z `newsletter_settings.popup_mailing_lists`):
  // tylko subskrybenci, którzy ją wybrali (`meta.mailing_lists`). Wcześniej
  // klucza nie było w schemacie, więc zod go po cichu odrzucał, a kampania
  // „do segmentu" szła do całej listy (P04, R-25).
  segment: z.string().trim().min(1).max(120).optional(),
});
export type AudienceFilter = z.infer<typeof AudienceFilter>;

/**
 * Filtr odbiorców odczytany z kolumny `jsonb`. Jedno miejsce dla serwera
 * i dla panelu - wcześniej każde z nich rzutowało kolumnę na własną rękę
 * (`as unknown as`), więc uszkodzony ładunek dawał w jednym miejscu wyjątek,
 * a w drugim ciche `undefined` w warunku zapytania. Nieparsowalny filtr
 * degraduje się do pustego (czyli: status `subscribed`, bez zawężeń).
 */
export function readAudienceFilter(raw: unknown): AudienceFilter {
  const parsed = AudienceFilter.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Adres do PORÓWNANIA (nie do wysyłki).
 *
 * Część lokalna adresu jest formalnie wrażliwa na wielkość litery, ale żaden
 * używany dostawca poczty tego nie stosuje, a lista subskrybentów przyjmuje
 * adresy z trzech dróg (formularz publiczny, import CSV, profil konta), z
 * których nie wszystkie normalizują wielkość. Porównanie po surowym napisie
 * powodowało DWA rozjazdy naraz: pominięcie sprawdzenia „już wysłano" przy
 * wznowieniu kampanii i podwójne liczenie tej samej osoby w mianowniku postępu.
 *
 * Jedno miejsce, bo każde porównanie adresu w tym module musi używać tej samej
 * normalizacji - rozjazd między dwoma miejscami to dokładnie ten defekt.
 */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Czy subskrybent wybrał listę mailingową `segment`. Czyta preferencje tym
 * samym normalizatorem co profil i CRM (`readPreferences`): listy leżą
 * w `meta.mailing_lists` jako napis „a,b", a stare popupy zapisywały
 * `meta.mailing_list` w liczbie pojedynczej - porównanie surowego JSON-a
 * gubiłoby tych drugich.
 */
function onMailingList(meta: unknown, segment: string): boolean {
  const bag =
    typeof meta === "object" && meta !== null && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : null;
  return readPreferences(bag).mailingLists.includes(segment);
}

/** Identyfikatory list mailingowych najemcy (`newsletter_settings.popup_mailing_lists`). */
async function tenantMailingListIds(admin: DbClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("newsletter_settings")
    .select("popup_mailing_lists")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const lists = Array.isArray(data?.popup_mailing_lists) ? data.popup_mailing_lists : [];
  const ids = new Set<string>();
  for (const entry of lists) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim() !== "") ids.add(id.trim());
    }
  }
  return ids;
}

// ----------------------------------------------------------------------------
// Kampania kuponowa (P04)
// ----------------------------------------------------------------------------

/**
 * Kody błędów trybu kuponowego - komunikat = kod maszynowy, panel tłumaczy
 * go po prefiksie (`COUPON_CODES_INSUFFICIENT:<potrzeba>:<dostępne>`).
 */
export const COUPON_SEND_ERRORS = {
  /** Filtr nieparsowalny, lista nieznana albo niezgodna z kampanią kuponową. */
  segmentInvalid: "COUPON_SEGMENT_INVALID",
  /** Za mało wolnych kodów dla porcji odbiorców. */
  codesInsufficient: "COUPON_CODES_INSUFFICIENT",
  /** Treść z `{{coupon_code}}`, ale kampania nie jest podpięta pod kuponową. */
  notLinked: "COUPON_CAMPAIGN_NOT_LINKED",
  /** Pod jedną kampanię newslettera podpięto kilka kampanii kuponowych. */
  ambiguous: "COUPON_CAMPAIGN_AMBIGUOUS",
  /** Kampania kuponowa, ale wersja językowa z treścią nie ma `{{coupon_code}}`. */
  missingTag: "COUPON_TAG_MISSING",
} as const;

const COUPON_TAG = "{{coupon_code}}";

/**
 * Embed kampanii kuponowej przy odczycie kampanii newslettera (relacja
 * `b2b_coupon_campaigns.newsletter_campaign_id`). Jedno zapytanie zamiast
 * dwóch: przejęcie kampanii do wysyłki i sprawdzenie trybu kuponowego dzieją
 * się atomowo, a błąd odczytu powiązania wywraca przejęcie (fail-closed),
 * zamiast po cichu potraktować kampanię jak zwykłą.
 */
const COUPON_LINK_EMBED =
  "coupon_link:b2b_coupon_campaigns!b2b_coupon_campaigns_newsletter_campaign_id_fkey(id, tenant_id, name, status, newsletter_segment)";

interface CouponLink {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  newsletter_segment: string | null;
}

function readCouponLinks(raw: unknown): CouponLink[] {
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const links: CouponLink[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.tenant_id !== "string") continue;
    links.push({
      id: r.id,
      tenant_id: r.tenant_id,
      name: typeof r.name === "string" ? r.name : "",
      status: typeof r.status === "string" ? r.status : "",
      newsletter_segment: typeof r.newsletter_segment === "string" ? r.newsletter_segment : null,
    });
  }
  return links;
}

/**
 * Kampania kuponowa podpięta pod kampanię newslettera albo `null` (zwykła
 * kampania). Powiązanie z cudzym najemcą albo kilka powiązań to konfiguracja
 * niepoprawna - wyjątek, nigdy „zwykła kampania do całej listy".
 */
function couponLinkOf(raw: unknown, tenantId: string): CouponLink | null {
  const links = readCouponLinks(raw);
  if (links.length === 0) return null;
  if (links.some((link) => link.tenant_id !== tenantId)) {
    throw new Error(COUPON_SEND_ERRORS.segmentInvalid);
  }
  if (links.length > 1) throw new Error(COUPON_SEND_ERRORS.ambiguous);
  return links[0]!;
}

/**
 * Filtr odbiorców kampanii KUPONOWEJ - fail-closed (w przeciwieństwie do
 * `readAudienceFilter`): nieparsowalny filtr, lista spoza
 * `popup_mailing_lists` najemcy albo segment inny niż ustawiony na kampanii
 * kuponowej zatrzymują wysyłkę. Kody rabatowe wysłane do całej listy zamiast
 * do segmentu to incydent (R-25), którego nie da się cofnąć.
 */
async function couponAudienceFilter(
  admin: DbClient,
  tenantId: string,
  rawFilter: unknown,
  coupon: CouponLink,
): Promise<AudienceFilter> {
  const parsed = AudienceFilter.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new Error(COUPON_SEND_ERRORS.segmentInvalid);
  const filter = parsed.data;
  if ((coupon.newsletter_segment ?? undefined) !== filter.segment) {
    throw new Error(COUPON_SEND_ERRORS.segmentInvalid);
  }
  if (filter.segment) {
    const known = await tenantMailingListIds(admin, tenantId);
    if (!known.has(filter.segment)) throw new Error(COUPON_SEND_ERRORS.segmentInvalid);
  }
  return filter;
}

interface CouponCode {
  id: string;
  code: string;
  metadata: Record<string, unknown>;
}

function readCouponCodes(raw: unknown): CouponCode[] {
  if (!Array.isArray(raw)) return [];
  const codes: CouponCode[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.code !== "string") continue;
    const meta =
      typeof r.metadata === "object" && r.metadata !== null && !Array.isArray(r.metadata)
        ? (r.metadata as Record<string, unknown>)
        : {};
    codes.push({ id: r.id, code: r.code, metadata: meta });
  }
  return codes;
}

/** Ile identyfikatorów idzie w jednym `in.(…)` - adres zapytania ma limit długości. */
const COUPON_ASSIGNED_LOOKUP_CHUNK = 50;

/**
 * Pula kodów dla porcji odbiorców kampanii kuponowej.
 *
 * `assigned` - kody JUŻ przypisane odbiorcom tej porcji (wznowienie po
 * przerwanej wysyłce dostaje ten sam kod, a nie drugi); `free` - kody
 * aktywne, jeszcze bez odbiorcy, w kolejności generacji. Warunek z SPEC:
 * `free + assigned >= liczba odbiorców porcji`, inaczej porcja nie wysyła
 * NIC (lepiej zatrzymać kampanię niż wysłać części odbiorców maila bez kodu).
 */
async function loadCouponPool(
  admin: DbClient,
  tenantId: string,
  couponCampaignId: string,
  recipientIds: readonly string[],
): Promise<{ assigned: Map<string, CouponCode>; free: CouponCode[]; freeCount: number }> {
  const assigned = new Map<string, CouponCode>();
  for (let i = 0; i < recipientIds.length; i += COUPON_ASSIGNED_LOOKUP_CHUNK) {
    const chunk = recipientIds.slice(i, i + COUPON_ASSIGNED_LOOKUP_CHUNK);
    const { data, error } = await admin
      .from("b2b_coupons")
      .select("id, code, metadata")
      .eq("tenant_id", tenantId)
      .eq("campaign_id", couponCampaignId)
      .in("metadata->>assigned_subscriber_id", chunk);
    if (error) throw new Error(error.message);
    for (const code of readCouponCodes(data)) {
      const subscriberId = code.metadata.assigned_subscriber_id;
      if (typeof subscriberId === "string" && !assigned.has(subscriberId)) {
        assigned.set(subscriberId, code);
      }
    }
  }
  const needFree = recipientIds.filter((id) => !assigned.has(id)).length;
  if (needFree === 0) return { assigned, free: [], freeCount: 0 };
  const { data, error, count } = await admin
    .from("b2b_coupons")
    .select("id, code, metadata", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("campaign_id", couponCampaignId)
    .eq("active", true)
    .is("metadata->>assigned_subscriber_id", null)
    .order("created_at", { ascending: true })
    .limit(needFree);
  if (error) throw new Error(error.message);
  const free = readCouponCodes(data);
  return { assigned, free, freeCount: Math.max(count ?? 0, free.length) };
}

/**
 * Przypisanie wolnego kodu odbiorcy - warunkowy UPDATE („nadal wolny"),
 * więc dwa procesy nie przypiszą jednego kodu dwóm osobom. Przegrany wyścig
 * bierze kolejny kod z puli. `metadata` jest scalane, nie nadpisywane;
 * zmiana samego `metadata` nie emituje `coupon.changed.v1` (D-S1-07).
 */
async function claimCouponCode(
  admin: DbClient,
  tenantId: string,
  newsletterCampaignId: string,
  subscriberId: string,
  pool: CouponCode[],
): Promise<CouponCode | null> {
  for (let next = pool.shift(); next; next = pool.shift()) {
    const metadata = {
      ...next.metadata,
      assigned_subscriber_id: subscriberId,
      assigned_newsletter_campaign_id: newsletterCampaignId,
      assigned_at: new Date().toISOString(),
    };
    const { data, error } = await admin
      .from("b2b_coupons")
      .update({ metadata } as never)
      .eq("id", next.id)
      .eq("tenant_id", tenantId)
      .is("metadata->>assigned_subscriber_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (Array.isArray(data) && data.length > 0) return { ...next, metadata };
  }
  return null;
}

const CampaignUpsert = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  subject_pl: z.string().trim().max(300).default(""),
  subject_en: z.string().trim().max(300).default(""),
  html_pl: z.string().max(200_000).default(""),
  html_en: z.string().max(200_000).default(""),
  // Kreator treści: dyskryminator silnika + dokument bloków (EmailDoc v1).
  // Wzorzec posts/pages - obie kolumny współistnieją, autorytatywna jest ta
  // wskazana przez `editor`; przełączanie silnika niczego nie kasuje.
  editor: z.enum(["html", "doc"]).default("html"),
  content_doc: z.unknown().nullable().optional(),
  from_name: z.string().trim().max(160).nullable().optional(),
  from_email: z.string().trim().email().max(254).nullable().optional(),
  reply_to: z.string().trim().email().max(254).nullable().optional(),
  audience_filter: AudienceFilter.default({}),
  scheduled_at: z.string().datetime().nullable().optional(),
});
/**
 * Kolumny czytane przez ten kod - WYPROWADZONE z wygenerowanych typów.
 * Ręcznie przepisany kształt wiersza rozjeżdża się z bazą bez żadnego sygnału,
 * bo `as unknown as` kasuje różnicę; `Pick` po `Tables<>` zamienia zmianę
 * kolumny w migracji na błąd kompilacji dokładnie tutaj.
 */
export type CampaignRow = Pick<
  Tables<"newsletter_campaigns">,
  | "id"
  | "tenant_id"
  | "name"
  | "subject_pl"
  | "subject_en"
  | "html_pl"
  | "html_en"
  | "editor"
  | "content_doc"
  | "from_name"
  | "from_email"
  | "reply_to"
  | "audience_filter"
  | "status"
  | "scheduled_at"
  | "lease_until"
  | "started_at"
  | "finished_at"
  | "recipient_count"
  | "sent_count"
  | "failed_count"
  | "last_error"
  | "created_at"
  | "updated_at"
>;

/**
 * Moduł żądania TanStack Start - WYŁĄCZNIE na serwerze.
 *
 * Eksport tickNewsletterCampaigns (zwykła funkcja) trzyma ten moduł w grafie
 * klienta, a import-protection Startu odrzuca `@tanstack/react-start/server`
 * po stronie klienta: w `vite dev` (podgląd Lovable, e2e na serwerze dev)
 * natychmiast - Lovable ustawia `behavior: "error"`, a dev nie robi
 * tree-shakingu - więc ekrany newslettera, kampanii kuponowych i kroku e-mail
 * ścieżki nie ładowały się. `createServerOnlyFn` kompilator Startu wycina po
 * stronie klienta PRZED analizą importów (ta sama granica co `.handler()`
 * funkcji serwerowych), a na serwerze specyfikator zostaje literałem.
 *
 * NIGDY specyfikator przez zmienną + `@vite-ignore` (stan do 2026-10-24):
 * build SSR zostawiał wtedy `@tanstack/react-start/server` jako pakiet
 * zewnętrzny, Nitro dociągał jego DRUGĄ kopię, a jej `createStartHandler`
 * importuje `#tanstack-router-entry` - do workera trafiała druga, niepodzielona
 * kopia całej aplikacji (`_chunks/router.mjs` 9 MB + 860 chunków, 17 MB).
 * workerd kompiluje każdy moduł skryptu przy starcie izolatu, więc płacił za
 * nią każdy zimny start (pomiar: docs/performance/2026-10-24-zimny-start-workera.md).
 * Pilnuje: bramka `check:server-entry-purity` (jedna kopia aplikacji w artefakcie).
 */
const loadStartServer = createServerOnlyFn(() => import("@tanstack/react-start/server"));

async function originFromRequest(): Promise<string> {
  const envUrl = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  try {
    const { getRequest } = await loadStartServer();
    const req = getRequest();
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

async function getTenantId(context: { supabase: DbClient; userId: string }): Promise<string> {
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (error || !profile?.tenant_id) throw new Error("no_tenant");
  return profile.tenant_id;
}

/**
 * Bramka roli w handlerze (def. 10, wariant bez Z-S1-P1): odczyt kampanii
 * klientem UŻYTKOWNIKA. Polityka RLS `campaigns_staff_select` przepuszcza
 * wyłącznie admina i editora najemcy, więc autor (wpuszczony przez
 * `requireStaff`) dostaje `campaign_not_found`, zanim klient serwisowy
 * cokolwiek przejmie albo wyśle. Ta sama baza rozstrzyga o roli, która trzyma
 * zapis kampanii - bez drugiej, ręcznie utrzymywanej listy ról.
 */
async function readCampaignAsUser(
  context: { supabase: DbClient },
  campaignId: string,
  tenantId: string,
): Promise<{ status: string }> {
  const { data, error } = await context.supabase
    .from("newsletter_campaigns")
    .select("status")
    .eq("id", campaignId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("campaign_not_found");
  return data;
}

// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------
export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<CampaignRow[]> => {
    const { data, error } = await context.supabase
      .from("newsletter_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as CampaignRow[];
  });

// ----------------------------------------------------------------------------
// GET
// ----------------------------------------------------------------------------
/** Kampania kuponowa podpięta pod kampanię newslettera (podgląd w edytorze). */
export interface CampaignCouponInfo {
  couponCampaignId: string;
  name: string;
  /** Kody aktywne, jeszcze nieprzypisane odbiorcy - tyle osób można obsłużyć. */
  codesAvailable: number;
  codesTotal: number;
  /** Status kampanii kuponowej (`draft|generated|sent|archived`). */
  status: string;
}

export type CampaignWithCoupon = CampaignRow & { coupon: CampaignCouponInfo | null };

/**
 * Liczniki kodów kampanii kuponowej klientem UŻYTKOWNIKA (RLS
 * `b2b_coupons_staff_all`) - edytor pokazuje je przed wysyłką, żeby brak kodów
 * był widoczny, zanim wysyłka się zatrzyma.
 */
async function couponInfo(client: DbClient, link: CouponLink): Promise<CampaignCouponInfo> {
  const [total, free] = await Promise.all([
    client
      .from("b2b_coupons")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", link.tenant_id)
      .eq("campaign_id", link.id),
    client
      .from("b2b_coupons")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", link.tenant_id)
      .eq("campaign_id", link.id)
      .eq("active", true)
      .is("metadata->>assigned_subscriber_id", null),
  ]);
  if (total.error) throw new Error(total.error.message);
  if (free.error) throw new Error(free.error.message);
  return {
    couponCampaignId: link.id,
    name: link.name,
    codesAvailable: free.count ?? 0,
    codesTotal: total.count ?? 0,
    status: link.status,
  };
}

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignWithCoupon | null> => {
    const { data: row, error } = await context.supabase
      .from("newsletter_campaigns")
      .select(`*, ${COUPON_LINK_EMBED}`)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const { coupon_link: rawLink, ...campaign } = row as unknown as CampaignRow & {
      coupon_link?: unknown;
    };
    // Powiązanie z cudzym najemcą nie jest „kampanią kuponową tej kampanii" -
    // wysyłka i tak je odrzuci (fail-closed), edytor go nie pokazuje.
    const link = readCouponLinks(rawLink).find((l) => l.tenant_id === campaign.tenant_id) ?? null;
    return {
      ...campaign,
      coupon: link ? await couponInfo(context.supabase, link) : null,
    };
  });

// ----------------------------------------------------------------------------
// ENGAGEMENT (open/click counts for the admin editor)
// ----------------------------------------------------------------------------
/**
 * Zaangażowanie kampanii: sumy zdarzeń ORAZ zasięg unikalny.
 *
 * Dwie liczby zamiast jednej, bo mierzą co innego. `opens` to LICZBA ZDARZEŃ -
 * po migracji 20260814150000 jeden odbiorca może wnieść najwyżej jedno na dobę,
 * więc kampania czytana przez trzy dni daje trzy. `uniqueOpens` to LICZBA OSÓB,
 * i tylko ona jest uczciwym licznikiem wskaźnika otwarć: podzielona przez
 * dostarczone nie przekroczy 100%, a to właśnie „ponad 100%" unieważniało
 * dotąd cały kafelek.
 *
 * `COUNT(DISTINCT ...)` nie istnieje w Data API, więc odczyt schodzi do RPC -
 * ono też trzyma bramkę roli i tenanta (SECURITY DEFINER, `current_tenant_id()`).
 */
export interface CampaignEngagement {
  opens: number;
  clicks: number;
  uniqueOpens: number;
  uniqueClicks: number;
}

const EMPTY_ENGAGEMENT: CampaignEngagement = {
  opens: 0,
  clicks: 0,
  uniqueOpens: 0,
  uniqueClicks: 0,
};

/**
 * Rzutowanie na granicy niewygenerowanych typów - RPC jest nowsze niż
 * `types.ts` (precedens: `rpcClient` w src/lib/email/suppression.server.ts).
 */
type EngagementRpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Liczniki wracają z Postgresa jako `bigint`, czyli w JSON-ie bywają napisem. */
function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function readEngagement(data: unknown): CampaignEngagement {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return EMPTY_ENGAGEMENT;
  const fields: Record<string, unknown> = { ...row };
  return {
    opens: toCount(fields.opens),
    clicks: toCount(fields.clicks),
    uniqueOpens: toCount(fields.unique_openers),
    uniqueClicks: toCount(fields.unique_clickers),
  };
}

export const getCampaignEngagement = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignEngagement> => {
    const client = context.supabase as unknown as EngagementRpcCallable;
    const { data: rows, error } = await client.rpc("newsletter_campaign_engagement", {
      p_campaign: data.id,
    });
    // Kafelek zaangażowania nie może wywrócić edytora kampanii - brak liczb
    // czyta się jako zero, a nie jako błąd całego ekranu.
    if (error) return EMPTY_ENGAGEMENT;
    return readEngagement(rows);
  });

// ----------------------------------------------------------------------------
// UPSERT
// ----------------------------------------------------------------------------
export const upsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) => CampaignUpsert.parse(data))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const tenantId = await getTenantId(context);
    // Dokument kreatora normalizujemy parserem (złe bloki odpadają) i
    // ograniczamy rozmiar - do kolumny nigdy nie trafia niezwalidowany JSON.
    let contentDoc: EmailDoc | null = null;
    if (data.content_doc != null) {
      if (JSON.stringify(data.content_doc).length > 300_000) throw new Error("doc_too_large");
      contentDoc = parseEmailDoc(data.content_doc);
      if (!contentDoc) throw new Error("invalid_content_doc");
    }
    if (data.editor === "doc" && !contentDoc) throw new Error("invalid_content_doc");
    const payload = {
      tenant_id: tenantId,
      name: data.name,
      subject_pl: data.subject_pl,
      subject_en: data.subject_en,
      html_pl: data.html_pl,
      html_en: data.html_en,
      editor: data.editor,
      content_doc: contentDoc,
      from_name: data.from_name ?? null,
      from_email: data.from_email ?? null,
      reply_to: data.reply_to ?? null,
      audience_filter: data.audience_filter,
      scheduled_at: data.scheduled_at ?? null,
      status: data.scheduled_at ? "scheduled" : "draft",
    };
    if (data.id) {
      // RLS zapisu przepuszcza tylko admina i editora, ale UPDATE bez
      // widocznego wiersza kończy się po cichu sukcesem - autor dostawałby
      // „zapisano" bez zapisu. Odczyt klientem użytkownika zamienia to
      // w jawną odmowę (def. 10).
      await readCampaignAsUser(context, data.id, tenantId);
      const { error } = await context.supabase
        .from("newsletter_campaigns")
        // editor/content_doc są nowsze niż wygenerowane typy -> cast payloadu.
        .update(payload as never)
        .eq("id", data.id)
        .in("status", ["draft", "scheduled", "failed"]);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("newsletter_campaigns")
      .insert({ ...payload, created_by: context.userId } as never)
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "insert_failed");
    return { id: inserted.id as string };
  });

// ----------------------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------------------
export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("newsletter_campaigns")
      .delete()
      .eq("id", data.id)
      .in("status", ["draft", "scheduled", "failed", "cancelled"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// AUDIENCE COUNT
// ----------------------------------------------------------------------------
export const countCampaignAudience = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => AudienceFilter.parse(data))
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const statuses = data.statuses?.length ? data.statuses : ["subscribed"];

    // Segment po warstwie (min_tier_rank) i lista mailingowa (segment)
    // wymagają przecięcia po wierszach, więc zamiast szybkiego head-count
    // pobieramy e-maile (i preferencje) i liczymy część wspólną - tym samym
    // predykatem co wysyłka, inaczej podgląd „do ilu osób pójdzie" kłamałby.
    const tierRank = data.min_tier_rank && data.min_tier_rank > 0 ? data.min_tier_rank : 0;
    if (tierRank > 0 || data.segment) {
      let q = supabaseAdmin
        .from("newsletter_subscribers")
        .select(data.segment ? "email, meta" : "email")
        .eq("tenant_id", tenantId)
        .in("status", statuses);
      if (data.languages?.length) q = q.in("language", data.languages);
      if (data.source) q = q.eq("source", data.source);
      const { data: subs, error } = await q;
      if (error) throw new Error(error.message);
      let rows = (subs ?? []) as unknown as { email: string; meta?: unknown }[];
      const segment = data.segment;
      if (segment) rows = rows.filter((s) => onMailingList(s.meta, segment));
      if (tierRank > 0) {
        const tierSet = await minTierEmailSet(supabaseAdmin, tenantId, tierRank);
        rows = rows.filter((s) => tierSet.has(normalizeEmail(s.email)));
      }
      return { count: rows.length };
    }

    let q = supabaseAdmin
      .from("newsletter_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    q = q.in("status", statuses);
    if (data.languages?.length) q = q.in("language", data.languages);
    if (data.source) q = q.eq("source", data.source);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

// ----------------------------------------------------------------------------
// SEND TEST
// ----------------------------------------------------------------------------
export const sendCampaignTest = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        toEmail: z.string().trim().email().max(254),
        language: z.enum(["pl", "en"]).default("pl"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!c) throw new Error("not_found");
    const camp = c as CampaignRow;
    const subject = data.language === "pl" ? camp.subject_pl : camp.subject_en;
    let rawHtml = data.language === "pl" ? camp.html_pl : camp.html_en;
    if (camp.editor === "doc") {
      const doc = parseEmailDoc(camp.content_doc);
      if (!doc) throw new Error("invalid_content_doc");
      const origin = await originFromRequest();
      const rows = await fetchEmailDocPostRows(
        supabaseAdmin as unknown as EmailDocDbClient,
        tenantId,
        doc,
      );
      rawHtml = renderEmailHtml(doc, data.language, {
        postsByBlock: postRefsForLang(rows, origin, data.language),
      });
      // Pusty dokument w wybranym języku - nie wysyłamy pustej wiadomości
      // testowej (czytelny błąd zamiast "wysłano" z pustą treścią).
      if (!rawHtml) throw new Error("missing_content_for_language");
    }
    // Wysyłka testowa nie przypisuje prawdziwego kodu (pula kodów to
    // odbiorcy kampanii), ale tag nigdy nie wychodzi surowy - podstawiamy
    // czytelny kod przykładowy.
    const html = renderCampaignHtml(
      rawHtml,
      { email: data.toEmail, firstName: "", lastName: "", couponCode: SAMPLE_COUPON_CODE },
      data.language,
      null,
      null,
    );
    const from = buildFrom(camp);
    const send = await sendEmail({
      to: data.toEmail,
      subject: `[TEST] ${subject}`,
      html,
      from,
      replyTo: camp.reply_to,
    });
    if (!send.ok) throw new Error(send.error ?? "send_failed");
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// SEND CAMPAIGN
// ----------------------------------------------------------------------------
export const sendCampaign = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        // Świadome potwierdzenie ryzyka reputacyjnego przez operatora
        // (checkbox w dialogu wysyłki). Bez niego przekroczony próg skarg
        // twardo zatrzymuje wysyłkę.
        acknowledgeReputation: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; sent: number; failed: number; done: boolean; remaining: number }> => {
      const tenantId = await getTenantId(context);
      // Rola PRZED klientem serwisowym (def. 10): status czytany klientem
      // użytkownika - autor kampanii nie widzi (RLS), więc nie wyśle.
      const current = await readCampaignAsUser(context, data.id, tenantId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Bramka reputacji PRZED przejęciem kampanii: przekroczony próg skarg
      // oznacza, że kolejna wysyłka pogłębi problem zamiast go rozwiązać.
      // Wznowienie kampanii już w locie (`sending`) bramki NIE przechodzi:
      // przerwanie wysyłki w połowie zostawia część listy z wiadomością, a
      // część bez - gorzej niż dokończenie. Poszczególne adresy i tak chroni
      // lista wykluczeń, sprawdzana przy każdej porcji.
      if (current.status !== "sending") {
        const gate = await evaluateSendGate(supabaseAdmin, tenantId, data.acknowledgeReputation);
        if (!gate.allowed) throw new Error(gate.errorCode ?? "reputation_blocked");
      }

      const camp = await claimCampaign(supabaseAdmin, data.id, tenantId, "manual");
      if (!camp) throw new Error("campaign_not_sendable");
      const result = await runCampaignSend(supabaseAdmin, camp, tenantId, {
        maxEmails: MAX_EMAILS_PER_INVOCATION,
      });
      return { ok: true, ...result };
    },
  );

// ----------------------------------------------------------------------------
// PROCESS DUE CAMPAIGNS (opportunistic tick)
// ----------------------------------------------------------------------------
// Odpala zaległe kampanie `scheduled` z `scheduled_at <= now()` - wywoływane
// przy wejściu admina na listę kampanii / overview (fallback zamiast pg_cron,
// bo wysyłka wymaga env HTTP: RESEND_API_KEY / LOVABLE_API_KEY).
// Tick WYSYŁA pocztę, więc stoi za tą samą bramką co wysyłka (def. 10).
export const processDueCampaigns = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }): Promise<{ fired: number; continued: number; sent: number }> => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return tickNewsletterCampaigns(supabaseAdmin, { tenantId });
  });

// ----------------------------------------------------------------------------
// KAMPANIA NEWSLETTERA DLA KAMPANII KUPONOWEJ (P04)
// ----------------------------------------------------------------------------

/** Data ważności kodu w języku listu - strefa redakcji (Warszawa). */
function couponValidUntil(validUntil: string | null, lang: "pl" | "en"): string {
  if (!validUntil) {
    return lang === "pl" ? "Kod nie ma terminu ważności." : "The code does not expire.";
  }
  const date = new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
    dateStyle: "long",
    timeZone: "Europe/Warsaw",
  }).format(new Date(validUntil));
  return lang === "pl" ? `Kod jest ważny do ${date}.` : `The code is valid until ${date}.`;
}

/**
 * Szablon PL/EN kampanii kuponowej. `{{coupon_code}}` podstawia wysyłka - każdy
 * odbiorca dostaje własny kod; nazwa kampanii idzie przez `esc` (wpisuje ją
 * redakcja, ale trafia do HTML-a wiadomości).
 */
export function couponNewsletterTemplate(coupon: { name: string; valid_until: string | null }): {
  name: string;
  subject_pl: string;
  subject_en: string;
  html_pl: string;
  html_en: string;
} {
  const name = esc(coupon.name);
  return {
    name: `Kupony: ${coupon.name}`,
    subject_pl: `Twój kod rabatowy - ${coupon.name}`,
    subject_en: `Your discount code - ${coupon.name}`,
    html_pl:
      `<p>Dzień dobry,</p><p>w ramach akcji „${name}” mamy dla Ciebie osobisty kod rabatowy:</p>` +
      `<p style="font-size:20px;letter-spacing:2px"><strong>${COUPON_TAG}</strong></p>` +
      `<p>${couponValidUntil(coupon.valid_until, "pl")} Kod jest jednorazowy i przypisany do Ciebie.</p>`,
    html_en:
      `<p>Hello,</p><p>as part of "${name}" we have a personal discount code for you:</p>` +
      `<p style="font-size:20px;letter-spacing:2px"><strong>${COUPON_TAG}</strong></p>` +
      `<p>${couponValidUntil(coupon.valid_until, "en")} The code is single-use and assigned to you.</p>`,
  };
}

/**
 * Tworzy (albo zwraca istniejącą) kampanię newslettera dla kampanii kuponowej.
 *
 * Zastępuje zapis z przeglądarki, który tworzył kampanię newslettera i od razu
 * ustawiał kuponowej `status = 'sent'` (P04): tu kampania newslettera powstaje
 * jako SZKIC z szablonem `{{coupon_code}}` i segmentem z kampanii kuponowej,
 * a status `sent` ustawi dopiero zakończona wysyłka. Powiązanie
 * (`newsletter_campaign_id`) zapisuje klient serwisowy - kolumna nie ma
 * grantu dla `authenticated` (D-S1-06). Idempotentne: kampania już podpięta
 * zwraca tę samą kampanię newslettera, a przegrany wyścig dwóch kart sprząta
 * własny szkic i zwraca zwycięzcę.
 */
export const createCouponNewsletterCampaign = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) => z.object({ couponCampaignId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ newsletterCampaignId: string }> => {
    const tenantId = await getTenantId(context);
    const { data: coupon, error } = await context.supabase
      .from("b2b_coupon_campaigns")
      .select("id, name, status, valid_until, newsletter_segment, newsletter_campaign_id")
      .eq("id", data.couponCampaignId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!coupon) throw new Error("campaign_not_found");
    if (coupon.newsletter_campaign_id) {
      return { newsletterCampaignId: coupon.newsletter_campaign_id };
    }
    if (coupon.status !== "generated") throw new Error("coupon_campaign_not_generated");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ten sam warunek co wysyłka (fail-closed) - lepiej odmówić teraz niż
    // utworzyć szkic, który i tak się nie wyśle.
    if (coupon.newsletter_segment) {
      const known = await tenantMailingListIds(supabaseAdmin, tenantId);
      if (!known.has(coupon.newsletter_segment)) {
        throw new Error(COUPON_SEND_ERRORS.segmentInvalid);
      }
    }

    const template = couponNewsletterTemplate(coupon);
    const { data: inserted, error: insertError } = await context.supabase
      .from("newsletter_campaigns")
      .insert({
        tenant_id: tenantId,
        ...template,
        editor: "html",
        audience_filter: coupon.newsletter_segment ? { segment: coupon.newsletter_segment } : {},
        status: "draft",
        created_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (insertError || !inserted) throw new Error(insertError?.message ?? "insert_failed");
    const newsletterCampaignId = (inserted as { id: string }).id;

    const { data: linked, error: linkError } = await supabaseAdmin
      .from("b2b_coupon_campaigns")
      .update({ newsletter_campaign_id: newsletterCampaignId })
      .eq("id", coupon.id)
      .eq("tenant_id", tenantId)
      .is("newsletter_campaign_id", null)
      .select("id");
    if (!linkError && Array.isArray(linked) && linked.length > 0) {
      return { newsletterCampaignId };
    }

    // Wyścig albo błąd powiązania: szkic bez kampanii kuponowej byłby
    // zwykłą kampanią z tagiem kuponu - sprzątamy go.
    await supabaseAdmin
      .from("newsletter_campaigns")
      .delete()
      .eq("id", newsletterCampaignId)
      .eq("tenant_id", tenantId);
    if (linkError) throw new Error(linkError.message);
    const { data: winner, error: winnerError } = await supabaseAdmin
      .from("b2b_coupon_campaigns")
      .select("newsletter_campaign_id")
      .eq("id", coupon.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (winnerError) throw new Error(winnerError.message);
    if (!winner?.newsletter_campaign_id) throw new Error("coupon_campaign_link_failed");
    return { newsletterCampaignId: winner.newsletter_campaign_id };
  });

/**
 * Wspólny tick wysyłki: (1) odpala zaległe kampanie `scheduled`,
 * (2) kontynuuje kampanie `sending` z oddaną/wygasłą dzierżawą.
 * Praca ograniczona budżetem e-maili na wywołanie; wywoływany przez
 * staff-owy `processDueCampaigns` (tenant-scoped) oraz przez
 * /api/public/jobs-tick (cross-tenant, pg_cron + pg_net).
 */
export async function tickNewsletterCampaigns(
  admin: DbClient,
  opts: { tenantId?: string; maxEmails?: number } = {},
): Promise<{ fired: number; continued: number; sent: number }> {
  const budgetTotal = Math.max(1, opts.maxEmails ?? MAX_EMAILS_PER_INVOCATION);
  let budget = budgetTotal;
  let fired = 0;
  let continued = 0;
  let sentTotal = 0;

  // (1) Zaległe kampanie zaplanowane.
  let dueQ = admin
    .from("newsletter_campaigns")
    .select("id, tenant_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(DUE_CAMPAIGNS_PER_TICK);
  if (opts.tenantId) dueQ = dueQ.eq("tenant_id", opts.tenantId);
  const { data: due, error } = await dueQ;
  if (error) throw new Error(error.message);

  // Bramka reputacji jest liczona RAZ na tenanta w ticku (cross-tenant tick
  // może dotknąć kilku) - to zapytanie agregujące, nie ma sensu powtarzać go
  // dla każdej kampanii tego samego tenanta.
  const gateByTenant = new Map<string, boolean>();
  const tenantMaySend = async (tenant: string): Promise<boolean> => {
    const cached = gateByTenant.get(tenant);
    if (cached !== undefined) return cached;
    const verdict = await evaluateSendGate(admin, tenant);
    gateByTenant.set(tenant, verdict.allowed);
    return verdict.allowed;
  };

  for (const row of due ?? []) {
    if (budget <= 0) break;
    // Kampania zaplanowana nie ma człowieka przy klawiaturze, więc przy
    // przekroczonym progu skarg NIE wysyłamy jej po cichu: zatrzymujemy ze
    // statusem `failed` i czytelnym powodem. Admin widzi to na liście i może
    // wznowić ręcznie, potwierdzając ryzyko (albo najpierw wyczyścić listę).
    if (!(await tenantMaySend(row.tenant_id))) {
      await markFailed(admin, row.id, row.tenant_id, "reputation_blocked");
      continue;
    }
    // Atomowy claim gwarantuje, że równoległy tick (druga karta admina,
    // cron) nie odpali tej samej kampanii dwa razy.
    const camp = await claimCampaign(admin, row.id, row.tenant_id, "due");
    if (!camp) continue;
    fired++;
    try {
      const r = await runCampaignSend(admin, camp, row.tenant_id, { maxEmails: budget });
      sentTotal += r.processed;
      budget -= Math.min(budget, r.processed);
    } catch {
      // runCampaignSend oznaczył już kampanię jako failed - lecimy dalej,
      // żeby jedna zepsuta kampania nie blokowała pozostałych zaległych.
    }
  }

  // (2) Kontynuacje: `sending` bez aktywnej dzierżawy (porcja się skończyła
  // albo poprzedni proces zginął). Idempotencja per odbiorca czyni wznowienie
  // bezpiecznym.
  if (budget > 0) {
    let contQ = admin
      .from("newsletter_campaigns")
      .select("id, tenant_id")
      .eq("status", "sending")
      .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
      .order("started_at", { ascending: true })
      .limit(DUE_CAMPAIGNS_PER_TICK);
    if (opts.tenantId) contQ = contQ.eq("tenant_id", opts.tenantId);
    const { data: cont, error: contErr } = await contQ;
    if (contErr) throw new Error(contErr.message);
    for (const row of cont ?? []) {
      if (budget <= 0) break;
      const camp = await claimCampaign(admin, row.id, row.tenant_id, "continue");
      if (!camp) continue;
      continued++;
      try {
        const r = await runCampaignSend(admin, camp, row.tenant_id, { maxEmails: budget });
        sentTotal += r.processed;
        budget -= Math.min(budget, r.processed);
      } catch {
        /* jw. - kampania oznaczona jako failed */
      }
    }
  }

  return { fired, continued, sent: sentTotal };
}

// ----------------------------------------------------------------------------
// Shared send pipeline (manual send + scheduled fire use the same path)
// ----------------------------------------------------------------------------

/**
 * Atomowe przejęcie kampanii (status → `sending` + świeża dzierżawa).
 *
 * - `due`: tylko `scheduled` z `scheduled_at <= now()` (tick nie może odpalić
 *   szkicu ani kampanii przełożonej w międzyczasie).
 * - `continue`: tylko `sending` z oddaną/wygasłą dzierżawą (kontynuacja
 *   porcji lub przejęcie po martwym procesie).
 * - `manual`: `draft`/`scheduled`/`failed` oraz `sending` bez aktywnej
 *   dzierżawy (przycisk "Wyślij"/"Wznów" w UI).
 *
 * Dzierżawa (lease_until) wyklucza dwa równoległe procesory; wznowienie jest
 * idempotentne per odbiorca (patrz `runCampaignSend`).
 */
async function claimCampaign(
  admin: DbClient,
  campaignId: string,
  tenantId: string,
  mode: "manual" | "due" | "continue",
): Promise<ClaimedCampaign | null> {
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + LEASE_MS).toISOString();
  // lease_until jest nowsze niż wygenerowane typy -> cast payloadu.
  let q = admin
    .from("newsletter_campaigns")
    .update({
      status: "sending",
      started_at: nowIso,
      last_error: null,
      lease_until: leaseIso,
    } as never)
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);
  if (mode === "due") {
    q = q.eq("status", "scheduled").lte("scheduled_at", nowIso);
  } else if (mode === "continue") {
    q = q.eq("status", "sending").or(`lease_until.is.null,lease_until.lt.${nowIso}`);
  } else {
    q = q.or(
      `status.in.(draft,scheduled,failed),and(status.eq.sending,lease_until.is.null),and(status.eq.sending,lease_until.lt.${nowIso})`,
    );
  }
  // Powiązanie z kampanią kuponową czytane RAZEM z przejęciem: tryb wysyłki
  // (zwykła / kuponowa) wynika z tego samego odczytu, który oddał dzierżawę.
  const { data: claimed, error } = await q.select(`*, ${COUPON_LINK_EMBED}`).maybeSingle();
  if (error) throw new Error(error.message);
  return (claimed ?? null) as unknown as ClaimedCampaign | null;
}

/** Kampania przejęta do wysyłki + surowe powiązanie z kampanią kuponową. */
type ClaimedCampaign = CampaignRow & { coupon_link?: unknown };

interface AudienceSubscriber {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  language: string;
  unsubscribe_token: string | null;
  /** Tylko przy filtrze listy mailingowej (`segment`). */
  meta?: unknown;
}

/**
 * Właściwa wysyłka zaklamowanej kampanii (wspólna dla `sendCampaign`
 * i ticku - jedna implementacja pętli paczek).
 *
 * Praca porcjami: wywołanie wysyła najwyżej `maxEmails` wiadomości, odnawia
 * dzierżawę po każdej paczce i - jeśli zostali odbiorcy - ODDAJE dzierżawę
 * (status zostaje `sending`, lease_until=NULL), zwracając done=false.
 * Kolejne wywołanie (auto-kontynuacja UI, tick crona, drugi admin) podejmuje
 * kampanię natychmiast.
 *
 * Idempotencja wznowienia: przed wysyłką czytamy log
 * `newsletter_campaign_recipients` - odbiorcy ze statusem `sent` są pomijani
 * (nigdy nie dostają wiadomości drugi raz), a `failed`/`skipped` są ponawiani.
 * Licznik `sent` startuje od liczby już wysłanych, więc statystyki po
 * wznowieniu pozostają spójne.
 *
 * Każdy błąd oznacza kampanię jako `failed` (markFailed) i jest rzucany dalej.
 */
async function runCampaignSend(
  admin: DbClient,
  camp: ClaimedCampaign,
  tenantId: string,
  opts: { maxEmails?: number } = {},
): Promise<{ sent: number; failed: number; done: boolean; remaining: number; processed: number }> {
  const maxEmails = Math.max(1, opts.maxEmails ?? MAX_EMAILS_PER_INVOCATION);
  try {
    // Tryb kuponowy (P04) rozstrzyga powiązanie odczytane razem z przejęciem.
    const coupon = couponLinkOf(camp.coupon_link, tenantId);

    // Fetch audience.
    //
    // `audience_filter` jest kolumną `jsonb`, więc jej typem jest `Json` - także
    // napis i tablica. Poprzednia wersja czytała `filter.statuses` wprost, co
    // trzymało się wyłącznie dzięki `as unknown as CampaignRow`. Zamiast
    // rzutować, PARSUJEMY tym samym schematem, który waliduje wejście z panelu
    // (`AudienceFilter`) - ładunek uszkodzony przez ręczną edycję w bazie daje
    // wtedy filtr pusty (wysyłka do statusu `subscribed`), a nie wyjątek
    // w połowie kampanii ani ciche `undefined` w warunku `in()`.
    // WYJĄTEK: kampania kuponowa jest fail-closed (`couponAudienceFilter`) -
    // filtr pusty znaczyłby kody rabatowe dla całej listy zamiast segmentu.
    const filter = coupon
      ? await couponAudienceFilter(admin, tenantId, camp.audience_filter, coupon)
      : readAudienceFilter(camp.audience_filter);
    const statuses = filter.statuses?.length ? filter.statuses : ["subscribed"];
    let q = admin
      .from("newsletter_subscribers")
      .select(
        filter.segment
          ? "id, email, first_name, last_name, language, unsubscribe_token, meta"
          : "id, email, first_name, last_name, language, unsubscribe_token",
      )
      .eq("tenant_id", tenantId)
      .in("status", statuses);
    if (filter.languages?.length) q = q.in("language", filter.languages);
    if (filter.source) q = q.eq("source", filter.source);
    const { data: subs, error: subsErr } = await q;
    if (subsErr) throw new Error(subsErr.message);
    let audience = (subs ?? []) as unknown as AudienceSubscriber[];

    // Lista mailingowa: ten sam predykat co licznik audiencji w panelu.
    const segment = filter.segment;
    if (segment) audience = audience.filter((sub) => onMailingList(sub.meta, segment));

    // Segment członkowski: zostaw tylko subskrybentów, których e-mail należy do
    // konta o randze warstwy >= min_tier_rank (personalizacja komunikacji).
    if (filter.min_tier_rank && filter.min_tier_rank > 0) {
      const tierSet = await minTierEmailSet(admin, tenantId, filter.min_tier_rank);
      audience = audience.filter((sub) => tierSet.has(normalizeEmail(sub.email)));
    }

    // Resume-idempotency: skip recipients already logged as "sent" by a
    // previous (crashed) run; retry "failed"/"skipped" ones.
    const { data: logged, error: loggedErr } = await admin
      .from("newsletter_campaign_recipients")
      .select("email, status")
      .eq("tenant_id", tenantId)
      .eq("campaign_id", camp.id);
    if (loggedErr) throw new Error(loggedErr.message);
    // Porównanie po adresie ZNORMALIZOWANYM do małych liter.
    //
    // Adres wchodzi na listę trzema drogami (formularz publiczny, import CSV,
    // profil konta) i tylko część z nich normalizuje wielkość litery. Log
    // odbiorców zapisuje adres taki, jaki był w momencie wysyłki. Poprzednia
    // wersja czytała `alreadySent` po surowym `r.email`, a `suppressed` już
    // po `.toLowerCase()` - więc gdy wiersz subskrybenta i jego wiersz w logu
    // różniły się wielkością choćby jednej litery, sprawdzenie „już wysłano"
    // NIE trafiało: wznowiona kampania (a wznawia ją każdy tick, który zabrakło
    // budżetu) wysyłała tej osobie drugą wiadomość. Ta strona porównania jest
    // dokładnie tą, po której idzie sygnał skargi na spam.
    const alreadySent = new Set(
      (logged ?? []).filter((r) => r.status === "sent").map((r) => normalizeEmail(r.email)),
    );
    const notYetSent = audience.filter((sub) => !alreadySent.has(normalizeEmail(sub.email)));

    // HIGIENA LISTY: adresy z aktywną blokadą (twarde odbicie, skarga na spam,
    // blokada ręczna) wypadają z audiencji ZANIM powstanie choćby jeden request
    // do dostawcy. Wysyłka na znany martwy/skarżący się adres to dokładnie ten
    // sygnał, po którym Google i Microsoft obniżają reputację domeny - a przy
    // wskaźniku skarg >=0,30% zaczynają filtrować całą pocztę z tej domeny.
    // Każdy pominięty odbiorca zostaje w logu ze statusem 'suppressed', więc
    // panel dostarczalności pokazuje, ILE wysyłek zaoszczędziła lista.
    const suppressed = await fetchSuppressedEmails(
      admin,
      tenantId,
      notYetSent.map((sub) => sub.email),
    );
    const allPending = notYetSent.filter((sub) => !suppressed.has(normalizeEmail(sub.email)));

    // Log pominięcia piszemy RAZ na odbiorcę: kampania na dużej liście robi
    // wiele wywołań po MAX_EMAILS_PER_INVOCATION, a upsert tych samych wierszy
    // przy każdej porcji byłby czystym marnotrawstwem zapisów.
    const alreadyLoggedSuppressed = new Set(
      (logged ?? []).filter((r) => r.status === "suppressed").map((r) => normalizeEmail(r.email)),
    );
    const blocked = notYetSent.filter(
      (sub) =>
        suppressed.has(normalizeEmail(sub.email)) &&
        !alreadyLoggedSuppressed.has(normalizeEmail(sub.email)),
    );
    if (blocked.length > 0) {
      await Promise.all(
        blocked.map((sub) => {
          const hit = suppressed.get(normalizeEmail(sub.email));
          return logRecipient(admin, {
            tenantId,
            campaignId: camp.id,
            subscriberId: sub.id,
            email: sub.email,
            language: (sub.language === "en" ? "en" : "pl") as "pl" | "en",
            status: "suppressed",
            error: `suppressed:${hit?.reason ?? "unknown"}`,
          });
        }),
      );
    }

    // Porcja tego wywołania; reszta zostaje na kolejne wywołania/tick.
    const pending = allPending.slice(0, maxEmails);
    // Mianownik postępu ("wysłano X z Y") liczy tylko adresy, na które WOLNO
    // wysłać - inaczej kampania z blokadami nigdy nie dobiłaby do 100%.
    // Mianownik liczony po adresach ZNORMALIZOWANYCH: `alreadySent` trzyma już
    // małe litery, więc surowy adres z `allPending` policzyłby tę samą osobę
    // dwa razy i postęp „wysłano X z Y" nigdy nie dobiłby do końca.
    const recipientCount = new Set([
      ...allPending.map((sub) => normalizeEmail(sub.email)),
      ...alreadySent,
    ]).size;

    let sent = alreadySent.size;
    let failed = 0;

    // KAŻDY zapis stanu kampanii w tej funkcji jest przypięty PARĄ
    // (id, tenant_id) - ten i trzy kolejne (odnowienie dzierżawy, oddanie
    // dzierżawy, status końcowy). Klient jest `service_role`, czyli RLS tu nie
    // obowiązuje, a `runCampaignSend` jest wołane również ze ścieżki
    // cross-tenant (`tickNewsletterCampaigns` z `/api/public/jobs-tick`).
    // Dopóki `camp` pochodzi z `claimCampaign` (przypiętego do tenanta), sam
    // `id` wystarcza - ale przypięcie zamienia ten warunek z własności
    // WOŁAJĄCEGO we własność TEGO zapytania, więc przyszła zmiana źródła
    // identyfikatora nie otwiera cichej drogi do cudzego wiersza.
    await admin
      .from("newsletter_campaigns")
      .update({ recipient_count: recipientCount, sent_count: sent, failed_count: 0 })
      .eq("id", camp.id)
      .eq("tenant_id", tenantId);

    const from = buildFrom(camp);
    const origin = await originFromRequest();

    // Kreator treści (editor='doc'): dokument renderuje się RAZ per język na
    // wywołanie - blok "najnowsze wpisy" jest świeży w momencie WYSYŁKI, nie
    // zapisu. Per odbiorca zostaje tylko personalizacja zmiennych + tracking
    // (renderCampaignHtml z `newsletter/renderCampaign.server`, wspólny z trybem html).
    // Absolutny origin jest wymagany dla KAZDEGO trybu (doc i html): bez niego
    // stopka "Wypisz sie" i naglowki RFC-8058 (List-Unsubscribe) nie zostana
    // doklejone (patrz nizej: unsubscribeUrl wymaga origin), wiec mail wyszedlby
    // bez mechanizmu wypisu (naruszenie prawne + ryzyko blacklisty domeny).
    // Zatrzymujemy kampanie z czytelnym bledem (markFailed w catch) zamiast
    // wysylac niezgodne maile. Wczesniej ten guard obejmowal tylko tryb doc.
    if (!origin) throw new Error("missing_site_origin");
    let docHtmlPl = camp.html_pl;
    let docHtmlEn = camp.html_en;
    if (camp.editor === "doc") {
      const doc = parseEmailDoc(camp.content_doc);
      if (!doc) throw new Error("invalid_content_doc");
      const rows = await fetchEmailDocPostRows(admin as unknown as EmailDocDbClient, tenantId, doc);
      docHtmlPl = renderEmailHtml(doc, "pl", { postsByBlock: postRefsForLang(rows, origin, "pl") });
      docHtmlEn = renderEmailHtml(doc, "en", { postsByBlock: postRefsForLang(rows, origin, "en") });
      // Pusty render w OBU językach = brak treści do wysłania (inaczej kampania
      // skończyłaby jako "sent" z zerem maili). Zatrzymujemy z jasnym błędem.
      if (!docHtmlPl && !docHtmlEn) throw new Error("empty_content_doc");
    }

    // Tag kuponu w kampanii BEZ kampanii kuponowej wyszedłby do odbiorców
    // surowy („{{coupon_code}}") - zatrzymujemy, zanim cokolwiek wyjdzie.
    if (!coupon && [docHtmlPl, docHtmlEn].some((html) => (html ?? "").includes(COUPON_TAG))) {
      throw new Error(COUPON_SEND_ERRORS.notLinked);
    }
    // I odwrotnie: kampania kuponowa, której wersja językowa z treścią nie ma
    // znacznika, przydzieliłaby odbiorcy kod, którego mail nie pokaże - kod
    // przepada, a kampania mogłaby skończyć jako `sent`. Zatrzymujemy PRZED
    // przydziałem kodów.
    if (
      coupon &&
      [docHtmlPl, docHtmlEn].some((html) => !!html?.trim() && !html.includes(COUPON_TAG))
    ) {
      throw new Error(COUPON_SEND_ERRORS.missingTag);
    }

    // Pula kodów porcji (tryb kuponowy), sprawdzana PRZED pierwszym mailem:
    // za mało kodów = porcja nie wysyła nic (mail bez kodu jest gorszy niż
    // wstrzymana kampania, a drugi mail „tym razem z kodem" - jeszcze gorszy).
    let couponPool: { assigned: Map<string, CouponCode>; free: CouponCode[] } | null = null;
    if (coupon && pending.length > 0) {
      const pool = await loadCouponPool(
        admin,
        tenantId,
        coupon.id,
        pending.map((sub) => sub.id),
      );
      const available = pool.assigned.size + pool.freeCount;
      if (available < pending.length) {
        throw new Error(`${COUPON_SEND_ERRORS.codesInsufficient}:${pending.length}:${available}`);
      }
      couponPool = pool;
    }

    // POMIAR TYLKO ZA ZGODĄ (I9d-Y2, EDPB 2/2023): piksel i linki z tokenem
    // odbiorcy wyłącznie dla adresów ze zgodą na pomiar przy włączonym
    // wspólnym przełączniku najemcy (Z-I9c-09) - stan liczy baza w chwili
    // wysyłki porcji. Pozostali dostają mail jak wysyłka testowa: bez
    // piksela, linki wprost do celu (bez identyfikatora odbiorcy).
    const [{ fetchMeasuredEmails }, { measurementOptOutUrl }] = await Promise.all([
      import("@/lib/privacy/measurementStatus.server"),
      import("@/lib/privacy/measurementToken.server"),
    ]);
    const measuredEmails = await fetchMeasuredEmails(
      admin,
      tenantId,
      pending.map((sub) => sub.email),
    );

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (sub) => {
          const lang = (sub.language === "en" ? "en" : "pl") as "pl" | "en";
          const subject = lang === "pl" ? camp.subject_pl : camp.subject_en;
          const rawHtml = lang === "pl" ? docHtmlPl : docHtmlEn;
          if (!subject || !rawHtml) {
            await logRecipient(admin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "skipped",
              error: "missing_content_for_language",
            });
            return;
          }
          // Kod odbiorcy: najpierw ten JUŻ przypisany (wznowienie wysyła ten
          // sam kod, nie drugi), potem wolny z puli - przypisany warunkowo, więc
          // przegrany wyścig bierze następny. Pusta pula w trakcie porcji (kody
          // zabrane równolegle) = odbiorca `failed`, ponawiany przy wznowieniu.
          let couponCode: string | null = null;
          if (couponPool) {
            const code =
              couponPool.assigned.get(sub.id) ??
              (await claimCouponCode(admin, tenantId, camp.id, sub.id, couponPool.free));
            if (!code) {
              failed++;
              await logRecipient(admin, {
                tenantId,
                campaignId: camp.id,
                subscriberId: sub.id,
                email: sub.email,
                language: lang,
                status: "failed",
                error: "coupon_code_unavailable",
              });
              return;
            }
            couponCode = code.code;
          }
          // Ten sam adres idzie do stopki i do nagłówka List-Unsubscribe, a
          // wskazuje ENDPOINT (handler POST), nie stronę: klient pocztowy
          // POST-uje one-click (RFC 8058) wprost na adres z nagłówka, a strona
          // SPA takiego żądania nie obsługuje. Klik w stopkę (GET z
          // przeglądarki) endpoint przekierowuje 303 na przyjazną stronę.
          const unsubscribeUrl =
            sub.unsubscribe_token && origin
              ? newsletterUnsubscribeUrl(origin, sub.unsubscribe_token)
              : null;
          const measured = measuredEmails.has(normalizeEmail(sub.email));
          // „Nie mierz moich otwarć i kliknięć" w KAŻDYM mailu kampanii (także
          // niemierzonym - link prowadzi wtedy do „pomiar jest wyłączony").
          const optOutUrl = origin
            ? measurementOptOutUrl(origin, { kind: "subscriber", subscriberId: sub.id }, lang)
            : null;
          const html = renderCampaignHtml(
            rawHtml,
            {
              email: sub.email,
              firstName: sub.first_name ?? "",
              lastName: sub.last_name ?? "",
              couponCode,
            },
            lang,
            unsubscribeUrl,
            // Token trackingu jest ODDZIELNY od tokenu wypisu: podpisany HMAC-em
            // per (kampania, subskrybent), więc jego wyciek w URL-u nie pozwala
            // wypisać odbiorcy (unsubscribe dalej wymaga unsubscribe_token).
            origin && measured
              ? {
                  origin,
                  campaignId: camp.id,
                  token: signTrackingToken(camp.id, sub.id),
                  // Podpis per-link: tylko adresy z tej wysyłki mogą być celem
                  // przekierowania /api/public/nl-click (brak open redirect).
                  signLink: (target: string) => signTrackingLink(camp.id, sub.id, target),
                }
              : null,
            optOutUrl,
          );
          const result = await sendEmail({
            to: sub.email,
            subject,
            html,
            from,
            replyTo: camp.reply_to,
            listUnsubscribeUrl: unsubscribeUrl,
            tags: { tenant: tenantId, campaign: camp.id, subscriber: sub.id },
          });
          if (result.ok) {
            sent++;
            await logRecipient(admin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "sent",
              sentAt: new Date().toISOString(),
              providerMessageId: result.messageId ?? null,
              // To, co faktycznie wyrenderowano (mianownik wskaźników panelu).
              measured: measured && Boolean(origin),
            });
          } else {
            failed++;
            await logRecipient(admin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "failed",
              error: result.error ?? `http_${result.status ?? "unknown"}`,
            });
          }
        }),
      );
      // Postęp + odnowienie dzierżawy (proces wciąż żyje).
      await admin
        .from("newsletter_campaigns")
        .update({
          sent_count: sent,
          failed_count: failed,
          lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
        } as never)
        .eq("id", camp.id)
        .eq("tenant_id", tenantId);
      if (i + BATCH_SIZE < pending.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const remaining = allPending.length - pending.length;
    if (remaining > 0) {
      // Porcja wyczerpana - kampania zostaje w `sending` z oddaną dzierżawą,
      // gotowa do natychmiastowego podjęcia przez kolejne wywołanie.
      await admin
        .from("newsletter_campaigns")
        .update({ sent_count: sent, failed_count: failed, lease_until: null } as never)
        .eq("id", camp.id)
        .eq("tenant_id", tenantId);
      return { sent, failed, done: false, remaining, processed: pending.length };
    }

    // Kampania kuponowa z nieudanymi odbiorcami zostaje `failed`, czyli do
    // podjęcia przez `claimCampaign`: nieudani dostali już przydzielony kod,
    // a status `sent` zamknąłby ponowienie na zawsze (kod by przepadł).
    const finalStatus = failed > 0 && (sent === 0 || coupon) ? "failed" : "sent";
    await admin
      .from("newsletter_campaigns")
      .update({
        status: finalStatus,
        sent_count: sent,
        failed_count: failed,
        finished_at: new Date().toISOString(),
        lease_until: null,
      } as never)
      .eq("id", camp.id)
      .eq("tenant_id", tenantId);

    // `sent` kampanii kuponowej = kody naprawdę wyszły (D-S1-06: ustawia go
    // wyłącznie ten serwer). Nie przy `failed` bez wysłanych i nie przy
    // kampanii bez ani jednego maila.
    if (coupon && finalStatus === "sent" && sent > 0) {
      await markCouponCampaignSent(admin, tenantId, camp.id);
    }

    return { sent, failed, done: true, remaining: 0, processed: pending.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(admin, camp.id, tenantId, message);
    throw err instanceof Error ? err : new Error(message);
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildFrom(c: CampaignRow): string | undefined {
  if (!c.from_email) return undefined;
  return c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email;
}

/**
 * Kampania kuponowa po zakończonej wysyłce -> `sent` (klient `service_role`,
 * kolumna bez grantu dla przeglądarki). Błąd NIE wywraca wysyłki: maile już
 * wyszły, a oznaczenie kampanii newslettera jako `failed` byłoby kłamstwem;
 * zostaje ślad w logu, a kampania kuponowa w `generated`.
 */
async function markCouponCampaignSent(
  admin: DbClient,
  tenantId: string,
  newsletterCampaignId: string,
): Promise<void> {
  const { error } = await admin
    .from("b2b_coupon_campaigns")
    .update({ status: "sent" })
    .eq("tenant_id", tenantId)
    .eq("newsletter_campaign_id", newsletterCampaignId)
    .neq("status", "archived");
  if (error) {
    console.error("[newsletter-campaigns] coupon campaign status not set to sent", {
      newsletterCampaignId,
      message: error.message,
    });
  }
}

/**
 * Oznaczenie kampanii jako nieudanej.
 *
 * `tenantId` jest w sygnaturze OBOWIĄZKOWY, mimo że sam `id` jest unikalny.
 * Powód: ten zapis idzie klientem `service_role`, czyli Z POMINIĘCIEM RLS,
 * i jest wołany ze ścieżki CROSS-TENANT (`tickNewsletterCampaigns` z
 * `/api/public/jobs-tick`, gdzie `opts.tenantId` jest pusty i pętla przechodzi
 * po kampaniach różnych najemców). Dopóki identyfikator pochodzi z zapytania
 * przypiętego do tenanta, sam `id` wystarcza - ale nic w SYGNATURZE tego nie
 * wymuszało, więc pierwszy przyszły wołający z identyfikatorem z innego źródła
 * pisałby po cudzym wierszu bez żadnego sygnału. Tenant w argumencie zamienia
 * ten warunek z konwencji w wymóg kompilatora.
 */
async function markFailed(
  admin: DbClient,
  id: string,
  tenantId: string,
  message: string,
): Promise<void> {
  await admin
    .from("newsletter_campaigns")
    .update({
      status: "failed",
      last_error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
      lease_until: null,
    } as never)
    .eq("id", id)
    .eq("tenant_id", tenantId);
}

async function logRecipient(
  admin: DbClient,
  row: {
    tenantId: string;
    campaignId: string;
    subscriberId: string;
    email: string;
    language: "pl" | "en";
    status: "sent" | "failed" | "skipped" | "suppressed";
    error?: string;
    sentAt?: string;
    /** Resend email id - klucz korelacji zdarzeń dostarczalności. */
    providerMessageId?: string | null;
    /**
     * Czy mail miał piksel i linki z tokenem (I9d-Y2). Brak = NULL, a przy
     * statusie `sent` stan liczy wyzwalacz bazy tą samą regułą.
     */
    measured?: boolean;
  },
): Promise<void> {
  // provider_message_id / delivery_state pochodzą z migracji nowszej niż
  // wygenerowane typy Supabase -> cast payloadu (precedens: lease_until).
  await admin.from("newsletter_campaign_recipients").upsert(
    {
      tenant_id: row.tenantId,
      campaign_id: row.campaignId,
      subscriber_id: row.subscriberId,
      email: row.email,
      language: row.language,
      status: row.status,
      error: row.error ?? null,
      sent_at: row.sentAt ?? null,
      provider_message_id: row.providerMessageId ?? null,
      delivery_state: row.status === "sent" ? "sent" : row.status,
      measured: row.status === "sent" ? (row.measured ?? null) : null,
    } as never,
    { onConflict: "campaign_id,email" },
  );
}

// ----------------------------------------------------------------------------
// Kreator treści: dane dla podglądu w edytorze
// ----------------------------------------------------------------------------

// Rozwiązuje bloki post-list dokumentu (jeszcze niezapisanego) na surowe
// wiersze wpisów - edytor renderuje podgląd lokalnie tym samym
// renderEmailHtml, którym wysyła serwer (podgląd = wysyłka).
export const resolveCampaignDocPosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => z.object({ doc: z.unknown() }).parse(data))
  .handler(async ({ data, context }): Promise<{ json: string }> => {
    const tenantId = await getTenantId(context);
    // Ten sam limit rozmiaru co przy zapisie (upsertCampaign) - podgląd nie
    // powinien być tańszym wektorem na ogromny payload.
    if (data.doc != null && JSON.stringify(data.doc).length > 300_000) {
      throw new Error("doc_too_large");
    }
    const doc = parseEmailDoc(data.doc);
    if (!doc) return { json: JSON.stringify({}) };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = await fetchEmailDocPostRows(
      supabaseAdmin as unknown as EmailDocDbClient,
      tenantId,
      doc,
    );
    return { json: JSON.stringify(rows) };
  });

// Wyszukiwarka opublikowanych wpisów dla ręcznego doboru w bloku post-list.
export const searchCampaignPosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) =>
    z.object({ search: z.string().trim().max(200).default("") }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ json: string }> => {
    const tenantId = await getTenantId(context);
    let q = context.supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, published_at")
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(10);
    if (data.search) {
      const s = `%${data.search.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
      q = q.or(`title_pl.ilike.${s},title_en.ilike.${s},slug.ilike.${s}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { json: JSON.stringify(rows ?? []) };
  });

export type { EmailPostRow };
