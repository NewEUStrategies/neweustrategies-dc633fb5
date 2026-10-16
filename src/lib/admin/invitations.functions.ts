// System zaproszeń użytkowników.
//
// Publiczne server functions (wszystkie chronione requireSupabaseAuth +
// weryfikacja roli admin/super_admin per tenant wywołującego):
//
//   - previewTeamImport(pageSlug)   - parsuje builder_data strony i zwraca
//                                     listę osób z widgetów team-member wraz z
//                                     informacją, czy istnieje już konto o
//                                     danym e-mailu (dedup case-insensitive).
//   - createInvitations(items)      - zbiorczo tworzy rekordy user_invitations.
//   - sendInvitation(id)            - rozstrzyga adresata (`resolveInviteTarget`:
//                                     nowe konto, dowiązanie konta tego najemcy
//                                     albo odmowa), zakłada konto
//                                     (auth.admin.createUser), zapisuje profiles /
//                                     author_profiles / user_roles i wysyła
//                                     e-mail przez domenową kolejkę pocztową.
//                                     Ponowna wysyłka idzie tą samą ścieżką:
//                                     konto zastane jest dowiązywane, nie
//                                     zakładane drugi raz.
//   - sendInvitationsBulk(ids), resendInvitationsForEmails(emails),
//     sendActivationEmailForUser(userId) - ta sama ścieżka (`performSend`).
//   - revokeInvitation(id)          - miękkie oznaczenie statusu.
//   - linkTeamWidgets(pageSlug)     - dopisuje authorSlug / authorUserId do
//                                     widgetów team-member matchowanych po
//                                     e-mailu.
//
// Rejestrujemy się do istniejącej infrastruktury pocztowej projektu i
// supabaseAdmin ładowanego wewnątrz .handler() (patrz reguły import-graph).

import { invitationCopy } from "@/lib/locale/invitation";
import { replaceStrokeLetters } from "@/lib/text/strokeLetters";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  invitationIntro,
  invitationScope,
  tierRankByPriceId,
} from "@/lib/email-templates/invitationScope";
import {
  INVITABLE_ROLES,
  INVITATION_ROLE_NOT_ALLOWED,
  INVITATION_TARGET_UNAVAILABLE,
  appMetadataTenantId,
  isInvitableRole,
  resolveInviteTarget,
  type InviteAccount,
  type InviteTarget,
} from "@/lib/admin/inviteTarget";

type AppRole = Database["public"]["Enums"]["app_role"];
type InviteMode = Database["public"]["Enums"]["invitation_mode"];

/**
 * Cel `ON CONFLICT` zapisu roli. MUSI być dokładnie zbiorem kolumn indeksu
 * unikalnego `user_roles_unique_per_tenant` - `(tenant_id, user_id, role)`,
 * migracja 20260531181120, linie 49-50. Pierwotne `UNIQUE (user_id, role)`
 * z 20260531180217 zostało tam zdjęte (`DROP CONSTRAINT IF EXISTS
 * user_roles_user_id_role_key`), a Postgres odrzuca cel konfliktu, któremu nie
 * odpowiada żaden indeks unikalny, błędem 42P10 („there is no unique or
 * exclusion constraint matching the ON CONFLICT specification"). Stary cel
 * `user_id,role` wywracał więc KAŻDĄ wysyłkę zaproszenia na `role_write_failed`,
 * a w provisioningu - gdzie wyniku nikt nie czytał - zostawiał konta bez roli.
 * Test jednostkowy tego nie zobaczy (baza jest atrapą; jego asercja przez długi
 * czas UTRWALAŁA zły cel) - zgodność z indeksami z migracji sprawdza bramka
 * kontraktowa `check:on-conflict-arbiters` (`src/lib/ci/onConflictArbiters.ts`).
 * Jedna stała dla obu zapisów roli, żeby cele nie rozjechały się ponownie.
 */
const USER_ROLES_CONFLICT_TARGET = "tenant_id,user_id,role";

// ---------- utils ----------------------------------------------------------

/**
 * Slug profilu autora. `replaceStrokeLetters` MUSI iść przed `NFD`: „ł" (U+0142)
 * nie ma rozkładu kanonicznego, więc normalizacja go nie rusza i bez tego kroku
 * wpadał w `[^a-z0-9]+`, czyli zamieniał się w dywiz („Michał" -> `micha`,
 * „Łukasz" -> `ukasz`). Mapa jest współdzielona z `slugifyTaxonomy`
 * i `content.functions` - trzecia kopia rozjechałaby adresy między ekranami.
 */
function slugify(input: string): string {
  return replaceStrokeLetters(input.toLowerCase())
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Znacznik konta założonego przez ADMINISTRATORA z potwierdzonym adresem
 * (`email_confirm: true`). Takie konto ma `email_confirmed_at`, choć nikt nie
 * kliknął linku w tej skrzynce - a administrator zna (tryb hasła) albo mógł
 * znać hasło. Moduł wydarzeń uznaje potwierdzony adres konta za dowód skrzynki
 * (decyzja D1, `_event_uid_owns_email`), więc bez znacznika administrator
 * obszaru A mógł założyć konto na cudzy adres i przejąć kartotekę tej osoby
 * w obszarze B (przegląd R12, ustalenie 4). Baza czyta znacznik z
 * `auth.users.raw_app_meta_data` i nie uznaje takiego konta za właściciela
 * adresu `provisioned_email`, dopóki konto ma ten adres.
 *
 * `app_metadata`, nie `user_metadata`: tylko klucz serwisowy zmienia
 * `app_metadata`, a `user_metadata` właściciel sesji nadpisuje sam
 * (`auth.updateUser({ data })`) - znacznik dałoby się zdjąć hasłem
 * tymczasowym. Ustawiany w TYM SAMYM wywołaniu `createUser`: nie ma chwili, w
 * której konto istnieje bez znacznika.
 */
function adminProvisionedAppMetadata(email: string): {
  provisioned_by_admin: true;
  provisioned_email: string;
} {
  return { provisioned_by_admin: true, provisioned_email: email.trim().toLowerCase() };
}

/**
 * Konto z katalogu tożsamości w kształcie decyzji `resolveInviteTarget`.
 * `fallbackEmail` wyłącznie dla konta założonego przed chwilą tym adresem.
 */
function toInviteAccount(user: User, fallbackEmail?: string): InviteAccount {
  return {
    id: user.id,
    email: user.email ?? fallbackEmail ?? null,
    appTenantId: appMetadataTenantId(user.app_metadata),
  };
}

function generateTempPassword(): string {
  // 16 znaków, alfabet unikający mylących glifów (0/O/1/l/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function assertAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ tenantId: string }> {
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (pErr || !profile?.tenant_id) throw new Error("Forbidden: no tenant context");
  // Tenant-scoped: only role rows belonging to the caller's current tenant count.
  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", profile.tenant_id)
    .in("role", ["admin", "super_admin"]);
  if (rErr) throw new Error(`Forbidden: role lookup failed (${rErr.message})`);
  if (!roles || roles.length === 0) throw new Error("Forbidden: admin role required");
  return { tenantId: profile.tenant_id };
}

// ---------- widget parsing -------------------------------------------------

interface TeamMemberDraft {
  email: string;
  name: string;
  position_pl: string | null;
  position_en: string | null;
  programLabel_pl: string | null;
  programLabel_en: string | null;
  photo: string | null;
  phone: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  linkedin: string | null;
  facebook: string | null;
  instagram: string | null;
  website: string | null;
  widgetId: string | null;
}

type UnknownObj = Record<string, unknown>;
const getStr = (o: UnknownObj, k: string): string | null => {
  const v = o[k];
  return typeof v === "string" && v.trim() ? v : null;
};

function extractTeamMembers(builderData: unknown): TeamMemberDraft[] {
  const out: TeamMemberDraft[] = [];
  const seen = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (!n || typeof n !== "object") return;
    const node = n as UnknownObj;
    if (node.type === "team-member" && node.content && typeof node.content === "object") {
      const c = node.content as UnknownObj;
      const email = (getStr(c, "email") ?? "").trim().toLowerCase();
      const name = getStr(c, "name") ?? "";
      if (email && name && !seen.has(email)) {
        seen.add(email);
        out.push({
          email,
          name,
          position_pl: getStr(c, "position_pl"),
          position_en: getStr(c, "position_en"),
          programLabel_pl: getStr(c, "programLabel_pl"),
          programLabel_en: getStr(c, "programLabel_en"),
          photo: getStr(c, "photo"),
          phone: getStr(c, "phone"),
          bio_pl: getStr(c, "bio_pl"),
          bio_en: getStr(c, "bio_en"),
          linkedin: getStr(c, "linkedin"),
          facebook: getStr(c, "facebook"),
          instagram: getStr(c, "instagram"),
          website: getStr(c, "website"),
          widgetId: getStr(node, "id"),
        });
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(builderData);
  return out;
}

// ---------- server functions -----------------------------------------------

export interface TeamImportCandidate extends TeamMemberDraft {
  existingUserId: string | null;
  existingInvitationId: string | null;
}

export const previewTeamImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ pageSlug: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<{ candidates: TeamImportCandidate[] }> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { data: page, error } = await context.supabase
      .from("pages")
      .select("builder_data")
      .eq("slug", data.pageSlug)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!page) throw new Error("Page not found");
    const drafts = extractTeamMembers(page.builder_data);
    if (drafts.length === 0) return { candidates: [] };

    // Sprawdź istniejące konta po e-mailu (przez RPC admin_list_users -
    // jedyne uprawnione miejsce zwracające e-maile).
    const emails = drafts.map((d) => d.email);
    const { data: users } = await context.supabase.rpc("admin_list_users");
    const byEmail = new Map<string, string>();
    for (const u of (users ?? []) as { id: string; email: string | null }[]) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }

    const { data: invites } = await context.supabase
      .from("user_invitations")
      .select("id, email")
      .in("email", emails);
    const inviteByEmail = new Map<string, string>();
    for (const inv of invites ?? []) inviteByEmail.set(inv.email.toLowerCase(), inv.id);

    return {
      candidates: drafts.map((d) => ({
        ...d,
        existingUserId: byEmail.get(d.email) ?? null,
        existingInvitationId: inviteByEmail.get(d.email) ?? null,
      })),
    };
  });

const InviteItemSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.trim().toLowerCase()),
  display_name: z.string().min(1).max(200),
  role: z.enum(INVITABLE_ROLES),
  mode: z.enum(["magic_link", "temp_password"]),
  source: z.string().max(80).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ items: z.array(InviteItemSchema).min(1).max(200) }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ created: number; skipped: number; ids: string[] }> => {
      const { tenantId } = await assertAdmin(context.supabase, context.userId);
      const rows = data.items.map((it) => ({
        tenant_id: tenantId,
        email: it.email,
        display_name: it.display_name,
        role: it.role as AppRole,
        mode: it.mode as InviteMode,
        status: "pending" as const,
        source: it.source ?? null,
        metadata: (it.metadata ?? {}) as never,
        invited_by: context.userId,
      }));
      const { data: inserted, error } = await context.supabase
        .from("user_invitations")
        .insert(rows)
        .select("id");
      if (error) throw new Error(error.message);
      return {
        created: inserted?.length ?? 0,
        skipped: 0,
        ids: (inserted ?? []).map((r) => r.id),
      };
    },
  );

interface SendResult {
  ok: boolean;
  email: string;
  error?: string;
  tempPassword?: string;
  sendCount?: number;
  sendLimit?: number;
}

const ACTIVATION_SEND_LIMIT = 5;

async function performSend(
  supabase: SupabaseClient<Database>,
  userId: string,
  invitationId: string,
): Promise<SendResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendTxEmail } = await import("@/lib/email/transactional.server");

  const { data: inv, error: invErr } = await supabase
    .from("user_invitations")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr || !inv) return { ok: false, email: "?", error: invErr?.message ?? "not_found" };

  const meta = (inv.metadata ?? {}) as Record<string, unknown>;
  const email = inv.email;
  const displayName = inv.display_name ?? email;
  const origin = process.env.PUBLIC_APP_URL ?? "https://neweuropeanstrategies.com";
  const invitationTenantId = inv.tenant_id;
  const pinnedAccountId = inv.auth_user_id;

  // Wynik zapisu statusu jest czytany: zaproszenie, które zostaje w `pending`
  // mimo odmowy, wygląda w panelu jak „jeszcze nie wysłane", a nie jak błąd.
  async function markFailed(lastError: string, clearPin = false): Promise<void> {
    const { error } = await supabase
      .from("user_invitations")
      .update({
        status: "failed",
        last_error: lastError,
        ...(clearPin ? { auth_user_id: null } : {}),
      })
      .eq("id", invitationId);
    if (error) {
      console.error("[performSend] invitation status update failed", {
        invitationId,
        code: error.code,
      });
    }
  }

  // Ślad audytowy MUSI się wykonać: `void supabase.from(...).insert(...)` nie
  // wysyła żądania, bo postgrest-js wykonuje zapytanie dopiero w `then()`.
  // Błąd zapisu śladu logujemy i nie przerywamy nim wysyłki.
  async function writeAudit(action: string, metadata: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.from("audit_log").insert({
      actor_id: userId,
      action,
      entity_type: "user_invitation",
      entity_id: invitationId,
      tenant_id: invitationTenantId,
      metadata: metadata as never,
    });
    if (error) {
      console.error("[performSend] audit write failed", { invitationId, action, code: error.code });
    }
  }

  // Odmowa: nic w koncie nie zostało zapisane, żaden mail nie wyszedł. Jeden
  // kod dla każdej przyczyny - w odpowiedzi, w `last_error` i w śladzie - bez
  // identyfikatora konta i bez jego najemcy.
  async function refuse(code: string, clearPin = false): Promise<SendResult> {
    await markFailed(code, clearPin);
    await writeAudit("user_invitation_refused", { reason: code });
    return { ok: false, email, error: code };
  }

  // Rola przed claimem i przed katalogiem kont: `user_invitations.role` to
  // `app_role` bez ograniczenia, a administrator zapisuje ją wprost przez
  // PostgREST. Bez tej bramki zaproszenie z `super_admin` nadałoby tę rolę
  // kluczem serwisowym, z pominięciem reguły „tylko super_admin nadaje
  // super_admin".
  if (!isInvitableRole(inv.role)) {
    return refuse(INVITATION_ROLE_NOT_ALLOWED);
  }

  const { data: sendCount, error: claimError } = await supabase.rpc("admin_claim_invitation_send", {
    p_invitation_id: invitationId,
  });
  if (claimError) {
    const limitReached = claimError.message.includes("activation_send_limit_reached");
    return {
      ok: false,
      email,
      error: limitReached ? "activation_send_limit_reached" : claimError.message,
      sendCount: Number(inv.send_count ?? ACTIVATION_SEND_LIMIT),
      sendLimit: ACTIVATION_SEND_LIMIT,
    };
  }

  let tempPassword: string | undefined;

  // Konto o tym adresie mogło już powstać (wcześniejsze zaproszenie, rejestracja
  // własna). `createUser` zwraca wtedy twardy błąd "already been registered" i
  // całe zaproszenie ląduje jako `failed` - mimo że jedyne, czego brakuje, to
  // ponowny link aktywacyjny. Dlatego najpierw szukamy istniejącego konta,
  // a o tym, czy wolno je dowiązać, rozstrzyga `resolveInviteTarget`.
  //
  // DLACZEGO PĘTLA, A NIE JEDNO ZAPYTANIE. `listUsers` w tej wersji SDK
  // (@supabase/auth-js 2.106) NIE MA filtru po adresie - przyjmuje wyłącznie
  // `PageParams` (`page`, `perPage`). Wcześniej czytaliśmy stąd JEDNĄ stronę
  // (`perPage: 200`), więc od 201. konta w katalogu funkcja odpowiadała „nie ma
  // takiego konta" dla kont, które są - czyli przestawała działać dokładnie
  // wtedy, kiedy zaczynała być potrzebna, i kierowała ścieżkę prosto
  // w `createUser` i w konflikt.
  //
  // DLACZEGO NIE `nextPage` Z ODPOWIEDZI. Paginacja SDK parsuje nagłówek `link`
  // przez `.substring(0, 1)`, więc numer strony jest OBCINANY DO PIERWSZEJ
  // CYFRY (strona 10 czyta się jako 1, strona 25 jako 2). Pętla sterowana tym
  // polem zapętla się albo kończy za wcześnie, gdy katalog przekroczy dziesięć
  // stron. Liczymy więc strony sami, a kończymy na stronie krótszej niż pełna.
  const AUTH_DIRECTORY_PAGE_SIZE = 200;
  /** Twardy sufit: 200 * 100 = 20 000 kont. Po jego przekroczeniu ODMAWIAMY. */
  const AUTH_DIRECTORY_MAX_PAGES = 100;

  async function findAuthAccountByEmail(): Promise<InviteAccount | null> {
    const target = email.toLowerCase();
    for (let page = 1; page <= AUTH_DIRECTORY_MAX_PAGES; page += 1) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: AUTH_DIRECTORY_PAGE_SIZE,
      });
      // Błąd katalogu NIE MOŻE czytać się jak „konta nie ma": cicha odpowiedź
      // przecząca prowadzi wprost do `createUser`, czyli do konfliktu i do
      // zaproszenia w stanie `failed`. Wcześniej `error` było tu pomijane przy
      // destrukturyzacji.
      if (error) throw error;
      const users = data?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
      if (hit) return toInviteAccount(hit);
      // Strona krótsza niż pełna jest ostatnia - w tym miejscu wiemy, że
      // przeszliśmy CAŁY katalog i konta w nim nie ma.
      if (users.length < AUTH_DIRECTORY_PAGE_SIZE) return null;
    }
    // Sufit wyczerpany, a katalog się nie skończył: nie wiemy, czy konto
    // istnieje. „Nie wiem" musi być błędem, a nie odpowiedzią „nie ma" - ta
    // druga kazałaby wyżej założyć konto i wywrócić zaproszenie na konflikcie.
    throw new Error("auth_directory_scan_exhausted");
  }

  // `auth_user_id` z wiersza zaproszenia NIE jest dowodem tożsamości:
  // administrator najemcy zapisuje tę kolumnę wprost przez PostgREST. Konto
  // pobieramy po identyfikatorze, a `resolveInviteTarget` sprawdza, że ma adres
  // zaproszenia. Brak konta to `null` (odmowa), każdy inny błąd - błąd.
  async function getPinnedAccount(id: string): Promise<InviteAccount | null> {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
    if (error) {
      if (error.status === 404 || error.code === "user_not_found") return null;
      throw error;
    }
    return data?.user ? toInviteAccount(data.user) : null;
  }

  // Najemca domyślny wyznaczony DOKŁADNIE jak w `handle_new_user`
  // (`tenants.is_default`, potem slug `nes`) - nie przez
  // `email_default_tenant_id()`, która ma inny fallback. Indeks
  // `tenants_single_default` gwarantuje najwyżej jeden wiersz domyślny.
  async function readDefaultTenantId(): Promise<string | null> {
    const { data: byFlag, error: flagError } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();
    if (flagError) throw new Error(`default_tenant_lookup_failed:${flagError.message}`);
    if (byFlag?.id) return byFlag.id;
    const { data: bySlug, error: slugError } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", "nes")
      .maybeSingle();
    if (slugError) throw new Error(`default_tenant_lookup_failed:${slugError.message}`);
    return bySlug?.id ?? null;
  }

  // Profil czytamy kluczem SERWISOWYM, celowo: przez RLS cudzy wiersz jest
  // niewidoczny i „inny najemca" wyglądałby jak „brak profilu". Ten sam odczyt
  // niesie slug - patrz „SLUG ISTNIEJĄCEGO KONTA" niżej.
  async function decide(
    account: InviteAccount | null,
  ): Promise<{ target: InviteTarget; slug: string | null }> {
    let profileTenantId: string | null = null;
    let slug: string | null = null;
    let defaultTenantId: string | null = null;
    if (account) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("slug, tenant_id")
        .eq("id", account.id)
        .maybeSingle();
      // Awaria odczytu NIE MOŻE czytać się jak „profilu nie ma": wtedy niżej
      // zapisalibyśmy najemcę zaproszenia na konto, którego najemcy nie znamy.
      if (profileError) throw new Error(profileError.message);
      profileTenantId = profile?.tenant_id ?? null;
      slug = profile?.slug ?? null;
      // Najemcę domyślnego czytamy tylko wtedy, gdy profil stoi poza najemcą
      // zaproszenia - zwykłe ponowienie do własnego użytkownika go nie płaci.
      if (profileTenantId !== null && profileTenantId !== invitationTenantId) {
        defaultTenantId = await readDefaultTenantId();
      }
    }
    const target = resolveInviteTarget({
      invitationTenantId,
      invitationEmail: email,
      pinnedAccountId,
      account,
      profileTenantId,
      defaultTenantId,
    });
    return { target, slug };
  }

  try {
    const found = pinnedAccountId
      ? await getPinnedAccount(pinnedAccountId)
      : await findAuthAccountByEmail();
    let decision = await decide(found);

    if (decision.target.kind === "create") {
      // `app_metadata.tenant_id` jest JEDYNYM poświadczeniem, że konto narodziło
      // się z zaproszenia tego najemcy: `handle_new_user` zakłada profil
      // w najemcy DOMYŚLNYM, a gdy ta wysyłka przerwie się przed hydracją,
      // ponowienie znajdzie konto z profilem w najemcy domyślnym i bez tego
      // znacznika musiałoby odmówić. Ustawiany w TYM SAMYM wywołaniu
      // `createUser`, więc nie ma chwili, w której konto istnieje bez niego.
      // `user_metadata.tenant_id` zostaje dla UI, ale niczego nie poświadcza.
      let created: User | null;
      if (inv.mode === "magic_link") {
        // Konto zakładamy bez hasła i BEZ maila Supabase - własny e-mail
        // (niżej) niesie link aktywacyjny wygenerowany przez generateLink.
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: false,
          app_metadata: { tenant_id: invitationTenantId },
          user_metadata: { display_name: displayName, tenant_id: invitationTenantId },
        });
        if (error) throw error;
        created = data.user;
      } else {
        tempPassword = generateTempPassword();
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          // Potwierdzenie nadane przez administratora nie dowodzi skrzynki.
          app_metadata: { ...adminProvisionedAppMetadata(email), tenant_id: invitationTenantId },
          user_metadata: {
            display_name: displayName,
            tenant_id: invitationTenantId,
            must_change_password: true,
          },
        });
        if (error) throw error;
        created = data.user;
      }
      if (!created?.id) throw new Error("no_auth_user_id");
      // Ta sama decyzja co dla konta zastanego: profil, który `handle_new_user`
      // założył przed chwilą w najemcy domyślnym, przechodzi wierszem
      // „narodzone z zaproszenia tego najemcy".
      decision = await decide(toInviteAccount(created, email));
    }

    // GRANICA NAJEMCY. `findAuthAccountByEmail` przeszukuje CAŁY katalog kont
    // (nie ma w nim najemców), a hydracja niżej pisze kluczem serwisowym
    // `profiles.tenant_id`, `author_profiles` i rolę w najemcy zapraszającego.
    // Bez decyzji administrator obszaru A, który zaprosił adres osoby z obszaru
    // B, PRZENOSIŁ jej konto do A (audyt pokrycia, wydanie 12, 16.8).
    // Przeniesienie konta między obszarami jest osobną operacją, nie skutkiem
    // ubocznym wysłania zaproszenia. Przypięty identyfikator, który nie przeszedł
    // weryfikacji, schodzi z wiersza - inaczej każde ponowienie trafiałoby w to
    // samo cudze konto zamiast szukać po adresie.
    if (decision.target.kind === "refuse") {
      const { reason } = decision.target;
      return await refuse(
        INVITATION_TARGET_UNAVAILABLE,
        reason === "pinned_account_missing" || reason === "pinned_account_mismatch",
      );
    }
    if (decision.target.kind !== "attach") throw new Error("no_auth_user_id");
    const authUserId = decision.target.userId;

    // SLUG ISTNIEJĄCEGO KONTA ZOSTAJE NIETKNIĘTY.
    //
    // `upsert` niżej NADPISUJE wymienione kolumny także przy ponownym wysłaniu
    // zaproszenia - liczenie sluga z nazwy przy KAŻDYM wysłaniu zmieniałoby
    // więc publiczny adres profilu autora (`/author/<slug>`) kontu, które już
    // działa. To nie jest teoria: transliteracja „ł" (ta zmiana) przesunęłaby
    // przy najbliższym resendzie każdego „Michała" z `micha` na `michal`,
    // zrywając opublikowane i zaindeksowane linki. Gorzej: `profiles_slug_unique`
    // jest indeksem UNIKALNYM, więc kolizja z cudzym slugiem wywróciłaby CAŁY
    // resend na błędzie zapisu, a nie tylko sam adres.
    //
    // Slug liczymy zatem wyłącznie dla konta, które jeszcze go nie ma. Zmiana
    // adresu istniejącego profilu to osobna decyzja (mapowanie stary -> nowy
    // plus przekierowania), nie skutek uboczny wysłania zaproszenia. Nowe
    // konto ma już slug z `handle_new_user` - ten zostaje.
    const slug = decision.slug ?? slugify(displayName);

    // Hydrate profile + author_profile + user_role. UPSERT nadpisuje wymienione
    // kolumny danymi z zaproszenia; wyjątkiem jest `slug` (wyżej), bo ten jest
    // publicznym adresem, a nie polem formularza.
    //
    // WYNIK KAŻDEGO ZAPISU JEST SPRAWDZANY. Wcześniej trzy `upsert` niżej
    // szły bez odczytu `error`, więc odmowa bazy (RLS, kolizja sluga, brak
    // kolumny) kończyła się mailem z linkiem do konta bez profilu albo bez
    // roli - i zaproszeniem oznaczonym jako „wysłane".
    const { error: profileWriteError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: authUserId,
        tenant_id: inv.tenant_id,
        email,
        display_name: displayName,
        slug,
        avatar_url: (meta.photo as string) ?? null,
        bio_pl: (meta.bio_pl as string) ?? null,
        bio_en: (meta.bio_en as string) ?? null,
        phone: (meta.phone as string) ?? null,
        job_title:
          (meta.job_title as string) ??
          (meta.position_pl as string) ??
          (meta.position_en as string) ??
          null,
        current_company: (meta.company_name as string) ?? null,
        current_company_id: (meta.company_id as string) ?? null,
        linkedin_url: (meta.linkedin as string) ?? null,
        facebook_url: (meta.facebook as string) ?? null,
        instagram_url: (meta.instagram as string) ?? null,
        website_url: (meta.website as string) ?? null,
      },
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (profileWriteError) throw new Error(`profile_write_failed:${profileWriteError.message}`);

    const orgFunctions: { pl: string; en: string }[] = [];
    if (meta.programLabel_pl || meta.programLabel_en) {
      orgFunctions.push({
        pl: (meta.programLabel_pl as string) ?? "",
        en: (meta.programLabel_en as string) ?? "",
      });
    }

    const { error: authorWriteError } = await supabaseAdmin.from("author_profiles").upsert(
      {
        user_id: authUserId,
        tenant_id: inv.tenant_id,
        job_title: (meta.position_pl as string) ?? (meta.position_en as string) ?? null,
        full_bio_pl: (meta.bio_pl as string) ?? null,
        full_bio_en: (meta.bio_en as string) ?? null,
        contact_email: email,
        phone: (meta.phone as string) ?? null,
        linkedin_url: (meta.linkedin as string) ?? null,
        facebook_url: (meta.facebook as string) ?? null,
        instagram_url: (meta.instagram as string) ?? null,
        website_url: (meta.website as string) ?? null,
        org_functions: orgFunctions,
        is_public: true,
      },
      { onConflict: "user_id" },
    );
    if (authorWriteError) throw new Error(`author_write_failed:${authorWriteError.message}`);

    const { error: roleWriteError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: authUserId, role: inv.role, tenant_id: inv.tenant_id },
        { onConflict: USER_ROLES_CONFLICT_TARGET, ignoreDuplicates: true },
      );
    if (roleWriteError) throw new Error(`role_write_failed:${roleWriteError.message}`);

    // E-mail zaproszenia wysyłamy ZAWSZE własną ścieżką: dla trybu
    // magic_link niesie link aktywacyjny (generateLink - Supabase go tylko
    // generuje, nie wysyła), dla temp_password login + hasło tymczasowe.
    let actionLink: string | null = null;
    if (inv.mode === "magic_link") {
      const redirectTo = `${origin}/auth/callback`;
      // Adres w mailu MUSI być na naszej domenie - patrz src/routes/auth.activate.ts.
      // Dlatego bierzemy z odpowiedzi token (`hashed_token`), a nie gotowy
      // `action_link` wskazujący na domenę dostawcy tożsamości.
      const prettyLink = (props: { hashed_token?: string; verification_type?: string }) =>
        props.hashed_token
          ? `${origin}/auth/activate?token=${encodeURIComponent(props.hashed_token)}&type=${encodeURIComponent(props.verification_type ?? "invite")}`
          : null;

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo },
      });
      if (linkErr || !linkData?.properties?.action_link) {
        // Konto istnieje już wcześniej (resend) - wtedy invite nie przejdzie.
        const { data: magic, error: magicErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo },
        });
        if (magicErr || !magic?.properties?.action_link) {
          throw new Error(`link_failed:${(linkErr ?? magicErr)?.message ?? "unknown"}`);
        }
        actionLink = prettyLink(magic.properties) ?? magic.properties.action_link;
      } else {
        actionLink = prettyLink(linkData.properties) ?? linkData.properties.action_link;
      }
    }

    {
      // Mail zaproszenia idzie tym samym szablonem co pozostała poczta
      // aplikacji (App Emails -> `user_invitation`), w języku wybranym przez
      // administratora w popupie zaproszenia. Wcześniej był to ręcznie sklejony
      // HTML tylko po polsku, poza rejestrem szablonów.
      const lang: "pl" | "en" = meta.lang === "en" ? "en" : "pl";
      const copy = invitationCopy[lang];
      const loginUrl = `${origin}/auth?email=${encodeURIComponent(email)}`;

      // Zakres obietnicy w treści maila musi odpowiadać dostępowi konta:
      // redakcja i plany od PRO w górę dostają pełne brzmienie, zwykły
      // użytkownik - analizy, raporty, quizy i wydarzenia.
      const { data: subRow } = await supabaseAdmin
        .from("subscriptions")
        .select("price_id, status")
        .eq("user_id", authUserId)
        .in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const scope = invitationScope({
        role: inv.role,
        tierRank: tierRankByPriceId(subRow?.price_id ?? null),
      });
      const intro = invitationIntro(scope, lang);

      const details: { label: string; value: string }[] = [
        { label: copy.loginAddress, value: email },
        { label: copy.role, value: inv.role },
      ];
      if (meta.company_name) {
        details.push({
          label: copy.organisation,
          value: [String(meta.company_name), meta.job_title ? String(meta.job_title) : null]
            .filter(Boolean)
            .join(" - "),
        });
      }
      if (!actionLink && tempPassword) {
        details.push({
          label: copy.temporaryPassword,
          value: tempPassword,
        });
      }

      const res = await sendTxEmail({
        type: "user_invitation",
        to: email,
        lang,
        metaName: displayName,
        intro,
        details,
        ctaUrl: actionLink ?? loginUrl,
        ctaLabel: actionLink ? copy.activate : copy.signIn,
        extra: actionLink ? `${copy.copyLink} ${actionLink}` : copy.changePassword,
        idempotencyKey: `user-invitation:${invitationId}:send:${String(sendCount)}`,
        tenantId: inv.tenant_id,
      });
      if (!res.ok) {
        return { ok: false, email, error: `email_failed:${res.error}`, tempPassword };
      }
    }

    // Autoakceptacja dotyczy administracyjnego przydzielenia roli i profilu,
    // nie potwierdzenia zaproszenia przez odbiorcę. Samo wysłanie wiadomości
    // nigdy nie może oznaczać, że użytkownik kliknął link aktywacyjny.
    const autoAccept = meta.auto_accept === true;
    const nowIso = new Date().toISOString();
    const { error: sentUpdateError } = await supabase
      .from("user_invitations")
      .update({
        status: "sent",
        auth_user_id: authUserId,
        sent_at: nowIso,
        accepted_at: null,
        last_error: null,
      })
      .eq("id", invitationId);
    if (sentUpdateError) {
      // Mail już wyszedł, więc wysyłka jest sukcesem - ale stan zaproszenia
      // w panelu się z nim rozjechał i ktoś musi to zobaczyć w logu.
      console.error("[performSend] invitation status update failed", {
        invitationId,
        code: sentUpdateError.code,
      });
    }

    // Ślad audytowy (nie blokuje wysyłki, ale się WYKONUJE - `writeAudit`).
    await writeAudit("user_invitation_sent", {
      mode: inv.mode,
      email,
      auth_user_id: authUserId,
      auto_accept: autoAccept,
    });

    return {
      ok: true,
      email,
      tempPassword,
      sendCount: typeof sendCount === "number" ? sendCount : Number(inv.send_count ?? 0) + 1,
      sendLimit: ACTIVATION_SEND_LIMIT,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(msg.slice(0, 500));
    return { ok: false, email, error: msg };
  }
}

export const sendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SendResult> => {
    await assertAdmin(context.supabase, context.userId);
    return performSend(context.supabase, context.userId, data.id);
  });

/**
 * Wysyła aktywację z poziomu listy użytkowników. Dla kont bez rekordu
 * zaproszenia tworzy tenantowy rekord magic-link, a następnie korzysta z tej
 * samej ścieżki wysyłki i atomowego limitu co ekran zaproszeń.
 */
export const sendActivationEmailForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SendResult> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    // `profiles.email` nie jest czytelne dla `authenticated` (grant kolumnowy,
    // 20260703090100), więc `select("email")` klientem admina kończył się
    // 42501 przy KAŻDYM wysłaniu aktywacji (znalezisko kontraktu TS <-> SQL).
    // E-mail czytamy funkcją redakcji `admin_get_user` - ta sama bramka co
    // ekran użytkownika: najemca wołającego i rola admin, bez roli serwisowej.
    const { data: rows, error: profileError } = await context.supabase.rpc("admin_get_user", {
      _user_id: data.userId,
    });
    if (profileError) throw new Error(profileError.message);
    const profile = (Array.isArray(rows) ? rows[0] : null) ?? null;
    if (!profile?.email) throw new Error("activation_email_missing");

    const email = profile.email.trim().toLowerCase();
    const { data: existing, error: invitationError } = await context.supabase
      .from("user_invitations")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invitationError) throw new Error(invitationError.message);

    let invitationId = existing?.status === "accepted" ? null : (existing?.id ?? null);
    if (!invitationId) {
      const { data: roleRows, error: roleError } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.userId)
        .eq("tenant_id", tenantId)
        .limit(1);
      if (roleError) throw new Error(roleError.message);
      const role = roleRows?.[0]?.role ?? "user";
      const { data: created, error: createError } = await context.supabase
        .from("user_invitations")
        .insert({
          tenant_id: tenantId,
          email,
          display_name: profile.display_name ?? email,
          role,
          mode: "magic_link",
          status: "pending",
          source: "admin_user_actions",
          metadata: { activation_for_user_id: data.userId } as never,
          invited_by: context.userId,
          auth_user_id: data.userId,
        })
        .select("id")
        .single();
      if (createError || !created)
        throw new Error(createError?.message ?? "invitation_create_failed");
      invitationId = created.id;
    }

    return performSend(context.supabase, context.userId, invitationId);
  });

export const sendInvitationsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(input))
  .handler(async ({ data, context }): Promise<{ results: SendResult[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const results: SendResult[] = [];
    for (const id of data.ids) {
      const r = await performSend(context.supabase, context.userId, id);
      results.push(r);
      // drobny throttle - Resend/Supabase auth ma niskie limity per minuta
      await new Promise((res) => setTimeout(res, 250));
    }
    return { results };
  });

// Ponowna wysyłka zaproszeń dopasowanych po adresie e-mail. Wykorzystywana
// przez akcje zbiorcze w /admin/users, gdzie zaznaczamy użytkowników (a nie
// same zaproszenia). Dla każdego adresu bierzemy NAJŚWIEŻSZE zaproszenie
// (po created_at DESC). Adresy bez zaproszenia trafiają do `missing`, żeby
// UI pokazał, dla kogo nie było co ponowić.
export const resendInvitationsForEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        emails: z
          .array(
            z
              .string()
              .email()
              .transform((v) => v.trim().toLowerCase()),
          )
          .min(1)
          .max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ results: SendResult[]; missing: string[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const uniq = Array.from(new Set(data.emails));
    const { data: rows, error } = await context.supabase
      .from("user_invitations")
      .select("id, email, created_at")
      .in("email", uniq)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const byEmail = new Map<string, string>();
    for (const r of rows ?? []) {
      if (!byEmail.has(r.email)) byEmail.set(r.email, r.id);
    }
    const missing = uniq.filter((e) => !byEmail.has(e));
    const results: SendResult[] = [];
    for (const [, id] of byEmail) {
      const r = await performSend(context.supabase, context.userId, id);
      results.push(r);
      await new Promise((res) => setTimeout(res, 250));
    }
    return { results, missing };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("user_invitations")
      .update({ status: "revoked" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- link widgets ---------------------------------------------------

interface LinkResult {
  updated: number;
  matched: number;
  unmatched: string[];
}

export const linkTeamWidgets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ pageSlug: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<LinkResult> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { data: page, error } = await context.supabase
      .from("pages")
      .select("id, builder_data")
      .eq("slug", data.pageSlug)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!page) throw new Error("Page not found");

    const drafts = extractTeamMembers(page.builder_data);
    const emails = drafts.map((d) => d.email);
    if (emails.length === 0) return { updated: 0, matched: 0, unmatched: [] };

    const { data: users } = await context.supabase.rpc("admin_list_users");
    const byEmail = new Map<string, { id: string; slug: string | null }>();
    for (const u of (users ?? []) as {
      id: string;
      email: string | null;
      slug: string | null;
    }[]) {
      if (u.email) byEmail.set(u.email.toLowerCase(), { id: u.id, slug: u.slug });
    }

    let updated = 0;
    const unmatched: string[] = [];
    // deep clone builder_data
    const doc = JSON.parse(JSON.stringify(page.builder_data ?? {})) as unknown;
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) {
        for (const v of n) walk(v);
        return;
      }
      if (!n || typeof n !== "object") return;
      const node = n as UnknownObj;
      if (node.type === "team-member" && node.content && typeof node.content === "object") {
        const c = node.content as UnknownObj;
        const email = ((c.email as string) ?? "").trim().toLowerCase();
        if (email) {
          const match = byEmail.get(email);
          if (match) {
            c.authorUserId = match.id;
            if (match.slug) c.authorSlug = match.slug;
            updated++;
          } else if (!unmatched.includes(email)) {
            unmatched.push(email);
          }
        }
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(doc);

    if (updated > 0) {
      const { error: upErr } = await context.supabase
        .from("pages")
        .update({ builder_data: doc as never })
        .eq("id", page.id);
      if (upErr) throw new Error(upErr.message);
    }

    return { updated, matched: drafts.length - unmatched.length, unmatched };
  });

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("user_invitations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { invitations: data ?? [] };
  });

// ---------- provision (bez wysyłki maili) ----------------------------------
//
// Tworzy realne konta auth.users + profiles + author_profiles + user_roles
// dla wszystkich osób z widgetów team-member na stronie, BEZ wysyłania maili.
// Dzięki temu osoby są natychmiast widoczne w /admin/users i /admin/authors.
// Rekord user_invitations dostaje status "accepted" (source: provision:*)
// jako ślad audytowy. Maile z linkiem / hasłem można wysłać później.

interface ProvisionResult {
  created: number;
  skipped: number;
  linked: number;
  errors: { email: string; error: string }[];
}

/**
 * Ile adresów idzie w JEDNYM odczycie istniejących zaproszeń provisioningu.
 *
 * `.in("email", [...])` jest filtrem w ADRESIE żądania GET, nie w jego treści,
 * a strona zespołu nie ma górnego limitu osób. Zmierzone na postgrest-js
 * 2.116 dla adresów w kształcie `imie.nazwisko123@neweuropeanstrategies.com`:
 * każdy adres dokłada do URL-a ~52 znaki (50 osób = 2,7 tys. znaków, 150 =
 * 7,8 tys., 200 = 10,4 tys.). Powyżej 8000 postgrest-js tylko dopisuje
 * ostrzeżenie do błędu, ale bramka przed PostgREST-em (nginx/Kong: domyślny
 * bufor wiersza żądania 8 KB) odpowiada wtedy 414 - a błąd tego odczytu
 * przerywa CAŁY provisioning. Jedno zapytanie „na stronę" psuło się więc
 * dokładnie na dużych zespołach, dla których ten import istnieje.
 *
 * 50 adresów to ~2,7 tys. znaków, jedna trzecia progu: zapas na adresy
 * średnio trzykrotnie dłuższe od zmierzonych, a strona ze 150 osobami to
 * nadal trzy zapytania, nie 150. Zmiana tej liczby wymaga ponownego pomiaru.
 */
const INVITATION_LOOKUP_CHUNK_SIZE = 50;

export const provisionTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        pageSlug: z.string().min(1),
        role: z.enum(INVITABLE_ROLES).default("author"),
        autoLink: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ProvisionResult> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: page, error: pageErr } = await context.supabase
      .from("pages")
      .select("id, builder_data")
      .eq("slug", data.pageSlug)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (pageErr) throw new Error(pageErr.message);
    if (!page) throw new Error("Page not found");

    const drafts = extractTeamMembers(page.builder_data);
    if (drafts.length === 0) return { created: 0, skipped: 0, linked: 0, errors: [] };

    const { data: users } = await context.supabase.rpc("admin_list_users");
    const byEmail = new Map<string, string>();
    for (const u of (users ?? []) as { id: string; email: string | null }[]) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }

    // ISTNIEJĄCE ZAPROSZENIA: odczyt PORCJAMI przed pętlą, nie jeden na osobę.
    //
    // Wcześniej pętla pytała `user_invitations` osobno o KAŻDĄ osobę (N+1:
    // strona z 40 widgetami to 40 zapytań). Teraz zapytania zawężone do
    // najemcy i adresów ze strony, po `INVITATION_LOOKUP_CHUNK_SIZE` adresów
    // (dlaczego porcje, a nie jedno zapytanie na stronę - przy stałej).
    // Porównanie zostaje DOKŁADNE, jak przy dawnym `eq("email", d.email)`:
    // kolumna jest `text`, `in` też porównuje dosłownie, a adresy ze strony
    // `extractTeamMembers` sprowadził już do małych liter (i odsiał duplikaty,
    // więc żaden adres nie trafia do dwóch porcji). Przy okazji znika cichy
    // dubel: `maybeSingle()` na dwóch starych rekordach oddawał błąd i `data:
    // null`, co czytało się jak „brak zaproszenia" i dopisywało kolejny.
    //
    // Awaria odczytu KTÓREJKOLWIEK porcji PRZERYWA całe wywołanie, ZANIM
    // powstanie jakiekolwiek konto - wszystkie porcje idą przed pętlą osób.
    // Dawny kod czytał tylko `data`, więc błąd bazy wyglądał jak „nie ma
    // zaproszenia" i każda osoba dostawała drugi rekord audytowy. Odmowa
    // całości jest bezpieczniejsza: nic się nie zmieniło i można ponowić, a
    // fałszywego śladu po założeniu kont nikt już nie odkręci. Ten sam powód
    // wyklucza „pomiń porcję, która padła": jej osoby dostałyby dubel śladu.
    const draftEmails = drafts.map((d) => d.email);
    const invitedEmails = new Set<string>();
    for (let from = 0; from < draftEmails.length; from += INVITATION_LOOKUP_CHUNK_SIZE) {
      const { data: existingInvites, error: existingInvitesErr } = await context.supabase
        .from("user_invitations")
        .select("email")
        .eq("tenant_id", tenantId)
        .in("email", draftEmails.slice(from, from + INVITATION_LOOKUP_CHUNK_SIZE));
      if (existingInvitesErr) throw new Error(existingInvitesErr.message);
      for (const inv of existingInvites ?? []) invitedEmails.add(inv.email);
    }

    // `created` / `skipped` opisują KONTO w warstwie auth (założone teraz albo
    // zastane), a nie powodzenie hydracji. Konto założone przez `createUser`
    // istnieje nieodwracalnie także wtedy, gdy zapis profilu czy roli niżej
    // padnie - ta osoba trafia wtedy DODATKOWO do `errors`.
    let created = 0;
    let skipped = 0;
    const errors: { email: string; error: string }[] = [];

    for (const d of drafts) {
      try {
        let authUserId = byEmail.get(d.email) ?? null;

        if (!authUserId) {
          const tempPassword = generateTempPassword();
          const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser(
            {
              email: d.email,
              password: tempPassword,
              email_confirm: true,
              // Jak w `performSend`: potwierdzenie z importu zespołu to nie
              // dowód skrzynki (`adminProvisionedAppMetadata`), a
              // `tenant_id` poświadcza, że konto narodziło się dla TEGO
              // najemcy (`resolveInviteTarget`, wiersz najemcy domyślnego).
              app_metadata: { ...adminProvisionedAppMetadata(d.email), tenant_id: tenantId },
              user_metadata: {
                display_name: d.name,
                tenant_id: tenantId,
                must_change_password: true,
                provisioned: true,
              },
            },
          );
          if (createErr) throw createErr;
          authUserId = createdUser.user?.id ?? null;
          if (!authUserId) throw new Error("no_auth_user_id");
          created++;
        } else {
          skipped++;
        }

        // WYNIK KAŻDEGO ZAPISU JEST SPRAWDZANY - tak samo jak w `performSend`,
        // z tymi samymi przedrostkami. Wcześniej trzy `upsert` niżej szły bez
        // odczytu `error`, więc 42P10 z celu konfliktu roli (patrz
        // `USER_ROLES_CONFLICT_TARGET`) był tu niewidoczny: provisioning
        // raportował powodzenie, a konta zostawały bez roli. Rzut ląduje we
        // wpisie TEJ osoby w `errors`, jej dalszych zapisów (ani śladu
        // `accepted`) nie próbujemy, a pozostałe osoby idą dalej. Zapisy
        // zostają sekwencyjne: wyzwalacze na tych tabelach zależą od kolejności.
        //
        // BEZ `slug` W ŁADUNKU - celowo, i to jest cała ochrona adresu autora.
        // Dawniej szło tu `slug: slugify(d.name)` przy KAŻDYM przebiegu, a
        // `profiles_slug_unique` jest indeksem GLOBALNYM (ponad najemcami).
        // Skutki: (1) imiennik z dowolnego obszaru, który już ma `jan-kowalski`,
        // dawał deterministyczne `profile_write_failed` - ponowienie nie
        // pomagało nigdy; (2) ponowny provisioning po zmianie nazwy w widgetcie
        // przepisywał opublikowany `/author/<slug>` istniejącego konta.
        // `performSend` broni się odczytem sluga; tutaj wystarcza pominięcie,
        // bo supabase-js wysyła upsert JEDNEGO obiektu z dokładnie jego
        // kluczami, a PostgREST buduje z nich i listę kolumn INSERT-u, i `DO
        // UPDATE SET` - kolumny spoza ładunku nie są ruszane. Sprawdzone na
        // bazie z migracji (rola `service_role`, zapytanie w kształcie
        // PostgREST-u, w transakcji wycofanej):
        //   - nowe konto: `handle_new_user` zakłada profil ze slugiem z
        //     `display_name` (unikalnym - przy imienniku z sufiksem
        //     `-NNNN`), a ścieżka UPDATE tego upsertu go nie dotyka;
        //   - konto istniejące o zmienionej nazwie: slug bez zmian;
        //   - konto osierocone (auth bez profilu): ścieżka INSERT idzie z
        //     `slug` NULL, więc `profiles_0_ensure_slug_trg` nadaje unikalny
        //     slug z imienia i nazwiska (migracja 20261002110000).
        // Ta sama migracja uzupełniła puste slugi, więc pominięcie nie zostawi
        // profilu bez adresu. Zmiana adresu istniejącego profilu to osobna
        // decyzja (przekierowania), nie skutek uboczny importu zespołu.
        const { error: profileWriteError } = await supabaseAdmin.from("profiles").upsert(
          {
            id: authUserId,
            tenant_id: tenantId,
            email: d.email,
            display_name: d.name,
            avatar_url: d.photo,
            bio_pl: d.bio_pl,
            bio_en: d.bio_en,
            phone: d.phone,
            job_title: d.position_pl ?? d.position_en,
            linkedin_url: d.linkedin,
            facebook_url: d.facebook,
            instagram_url: d.instagram,
            website_url: d.website,
          },
          { onConflict: "id", ignoreDuplicates: false },
        );
        if (profileWriteError) throw new Error(`profile_write_failed:${profileWriteError.message}`);

        const orgFunctions: { pl: string; en: string }[] = [];
        if (d.programLabel_pl || d.programLabel_en) {
          orgFunctions.push({
            pl: d.programLabel_pl ?? "",
            en: d.programLabel_en ?? "",
          });
        }

        const { error: authorWriteError } = await supabaseAdmin.from("author_profiles").upsert(
          {
            user_id: authUserId,
            tenant_id: tenantId,
            job_title: d.position_pl ?? d.position_en,
            full_bio_pl: d.bio_pl,
            full_bio_en: d.bio_en,
            contact_email: d.email,
            phone: d.phone,
            linkedin_url: d.linkedin,
            facebook_url: d.facebook,
            instagram_url: d.instagram,
            website_url: d.website,
            org_functions: orgFunctions,
            is_public: true,
          },
          { onConflict: "user_id" },
        );
        if (authorWriteError) throw new Error(`author_write_failed:${authorWriteError.message}`);

        const { error: roleWriteError } = await supabaseAdmin
          .from("user_roles")
          .upsert(
            { user_id: authUserId, role: data.role as AppRole, tenant_id: tenantId },
            { onConflict: USER_ROLES_CONFLICT_TARGET, ignoreDuplicates: true },
          );
        if (roleWriteError) throw new Error(`role_write_failed:${roleWriteError.message}`);

        // ślad audytowy - konto powstało w trybie provision (bez maila)
        if (!invitedEmails.has(d.email)) {
          await context.supabase.from("user_invitations").insert({
            tenant_id: tenantId,
            email: d.email,
            display_name: d.name,
            role: data.role as AppRole,
            mode: "temp_password" as InviteMode,
            status: "accepted",
            source: `provision:${data.pageSlug}`,
            metadata: { widgetId: d.widgetId, provisioned: true } as never,
            invited_by: context.userId,
            auth_user_id: authUserId,
            sent_at: new Date().toISOString(),
            accepted_at: new Date().toISOString(),
          });
          // Adres wchodzi do zbioru od razu - jak dawniej, gdy kolejne zapytanie
          // widziało już wstawiony wiersz: drugi widget z tym samym adresem nie
          // dostanie drugiego rekordu, nawet gdyby dedup w `extractTeamMembers`
          // kiedyś zniknął.
          invitedEmails.add(d.email);
        }

        byEmail.set(d.email, authUserId);
      } catch (err) {
        errors.push({
          email: d.email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Powiązanie widgetów team-member z nowo utworzonymi profilami.
    //
    // Odczyt profili idzie tymi samymi PORCJAMI co odczyt zaproszeń wyżej i z tego
    // samego powodu: `.in("email", …)` siedzi w adresie GET. Wcześniej był to
    // jeden odczyt na całą stronę bez sprawdzenia `error` - strona dość duża,
    // żeby bramka odpowiedziała 414, dostawała więc wszystkie konta, a potem
    // `linked: 0` i `errors: []`, bez słowa o tym, że widgety nie są dowiązane.
    // Awaria odczytu (i zapisu strony niżej) jest teraz JAWNYM błędem wywołania.
    // Konta już istnieją, ale ponowienie jest bezpieczne: zastane konta idą do
    // `skipped`, ślad audytowy nie dubluje się (`invitedEmails`), a dowiązanie
    // liczy się od nowa.
    let linked = 0;
    if (data.autoLink) {
      const doc = JSON.parse(JSON.stringify(page.builder_data ?? {})) as unknown;
      const mapByEmail = new Map<string, { id: string; slug: string | null }>();
      for (let from = 0; from < draftEmails.length; from += INVITATION_LOOKUP_CHUNK_SIZE) {
        const { data: profs, error: profsErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, slug")
          .in("email", draftEmails.slice(from, from + INVITATION_LOOKUP_CHUNK_SIZE));
        if (profsErr) throw new Error(`link_lookup_failed:${profsErr.message}`);
        for (const p of profs ?? []) {
          if (p.email) mapByEmail.set(p.email.toLowerCase(), { id: p.id, slug: p.slug });
        }
      }
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) {
          for (const v of n) walk(v);
          return;
        }
        if (!n || typeof n !== "object") return;
        const node = n as UnknownObj;
        if (node.type === "team-member" && node.content && typeof node.content === "object") {
          const c = node.content as UnknownObj;
          const email = ((c.email as string) ?? "").trim().toLowerCase();
          const match = email ? mapByEmail.get(email) : undefined;
          if (match) {
            c.authorUserId = match.id;
            if (match.slug) c.authorSlug = match.slug;
            linked++;
          }
        }
        for (const v of Object.values(node)) walk(v);
      };
      walk(doc);
      if (linked > 0) {
        const { error: pageWriteErr } = await context.supabase
          .from("pages")
          .update({ builder_data: doc as never })
          .eq("id", page.id);
        if (pageWriteErr) throw new Error(`link_write_failed:${pageWriteErr.message}`);
      }
    }

    return { created, skipped, linked, errors };
  });

// ---------- CRM: organizacje dla zaproszeń --------------------------------

export interface CrmCompanyOption {
  id: string;
  name: string;
}

/** Podpowiedzi organizacji z CRM (tenant wywołującego, admin-only). */
export const searchCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ q: z.string().max(120).optional() }).parse(input))
  .handler(async ({ data, context }): Promise<{ companies: CrmCompanyOption[] }> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("crm_companies")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name")
      .limit(20);
    const q = data.q?.trim();
    if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { companies: rows ?? [] };
  });

/** Tworzy organizację w CRM, jeśli jeszcze jej nie ma (dedup po nazwie). */
export const createCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ name: z.string().min(2).max(200) }).parse(input))
  .handler(async ({ data, context }): Promise<CrmCompanyOption> => {
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const name = data.name.trim();
    const { data: existing } = await context.supabase
      .from("crm_companies")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .ilike("name", name)
      .maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await context.supabase
      .from("crm_companies")
      .insert({ tenant_id: tenantId, name, created_by: context.userId })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });
