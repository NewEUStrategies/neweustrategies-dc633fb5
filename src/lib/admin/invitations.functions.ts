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
//   - sendInvitation(id)            - tworzy konto (auth.admin.createUser lub
//                                     inviteUserByEmail), rekordy profiles /
//                                     author_profiles / user_roles i wysyła
//                                     e-mail (dla temp_password przez
//                                     sendTransactionalEmail).
//   - resendInvitation(id)          - jak wyżej, jeśli konto istnieje pomija.
//   - revokeInvitation(id)          - miękkie oznaczenie statusu.
//   - linkTeamWidgets(pageSlug)     - dopisuje authorSlug / authorUserId do
//                                     widgetów team-member matchowanych po
//                                     e-mailu.
//
// Rejestrujemy się do istniejącej infrastruktury: sendTransactionalEmail
// (bramka Resend przez Lovable connector gateway) i supabaseAdmin ładowany
// wewnątrz .handler() (patrz reguły import-graph).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type InviteMode = Database["public"]["Enums"]["invitation_mode"];

// ---------- utils ----------------------------------------------------------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
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
  .inputValidator((input) => z.object({ pageSlug: z.string().min(1) }).parse(input))
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
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  display_name: z.string().min(1).max(200),
  role: z.enum(["admin", "editor", "author", "user"]),
  mode: z.enum(["magic_link", "temp_password"]),
  source: z.string().max(80).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ items: z.array(InviteItemSchema).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ created: number; skipped: number; ids: string[] }> => {
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
  });

interface SendResult {
  ok: boolean;
  email: string;
  error?: string;
  tempPassword?: string;
}

async function performSend(
  supabase: SupabaseClient<Database>,
  userId: string,
  invitationId: string,
): Promise<SendResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendTransactionalEmail } = await import("@/lib/server/email.server");

  const { data: inv, error: invErr } = await supabase
    .from("user_invitations")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr || !inv) return { ok: false, email: "?", error: invErr?.message ?? "not_found" };

  const meta = (inv.metadata ?? {}) as Record<string, unknown>;
  const email = inv.email;
  const displayName = inv.display_name ?? email;
  const origin = process.env.PUBLIC_APP_URL ?? "https://neweustrategies.lovable.app";

  let authUserId: string | null = inv.auth_user_id;
  let tempPassword: string | undefined;

  try {
    if (!authUserId) {
      if (inv.mode === "magic_link") {
        const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${origin}/auth/callback`,
          data: { display_name: displayName, tenant_id: inv.tenant_id },
        });
        if (error) throw error;
        authUserId = created.user?.id ?? null;
      } else {
        tempPassword = generateTempPassword();
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { display_name: displayName, tenant_id: inv.tenant_id, must_change_password: true },
        });
        if (error) throw error;
        authUserId = created.user?.id ?? null;
      }
    }

    if (!authUserId) throw new Error("no_auth_user_id");

    // Hydrate profile + author_profile + user_role. UPSERT: jeśli konto już
    // istniało (resend), tylko uzupełniamy braki bez nadpisywania edycji.
    await supabaseAdmin.from("profiles").upsert(
      {
        id: authUserId,
        tenant_id: inv.tenant_id,
        email,
        display_name: displayName,
        slug: slugify(displayName),
        avatar_url: (meta.photo as string) ?? null,
        bio_pl: (meta.bio_pl as string) ?? null,
        bio_en: (meta.bio_en as string) ?? null,
        phone: (meta.phone as string) ?? null,
        job_title: (meta.position_pl as string) ?? (meta.position_en as string) ?? null,
        linkedin_url: (meta.linkedin as string) ?? null,
        facebook_url: (meta.facebook as string) ?? null,
        instagram_url: (meta.instagram as string) ?? null,
        website_url: (meta.website as string) ?? null,
      },
      { onConflict: "id", ignoreDuplicates: false },
    );

    const orgFunctions: { pl: string; en: string }[] = [];
    if (meta.programLabel_pl || meta.programLabel_en) {
      orgFunctions.push({
        pl: (meta.programLabel_pl as string) ?? "",
        en: (meta.programLabel_en as string) ?? "",
      });
    }

    await supabaseAdmin.from("author_profiles").upsert(
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

    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: authUserId, role: inv.role, tenant_id: inv.tenant_id },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );

    // E-mail z hasłem (dla temp_password); magic_link wysyła Supabase Auth sam.
    if (inv.mode === "temp_password" && tempPassword) {
      const loginUrl = `${origin}/auth?email=${encodeURIComponent(email)}`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0F172A">
          <h1 style="color:#0F172A;font-size:22px;margin:0 0 12px">Witamy w New European Strategies</h1>
          <p>Cześć ${displayName},</p>
          <p>Zostało dla Ciebie utworzone konto na platformie. Poniżej znajdziesz dane logowania:</p>
          <div style="background:#F1F5F9;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace;font-size:14px">
            <div><strong>Login (e-mail):</strong> ${email}</div>
            <div><strong>Hasło tymczasowe:</strong> ${tempPassword}</div>
          </div>
          <p><a href="${loginUrl}" style="display:inline-block;background:#0F172A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Zaloguj się</a></p>
          <p style="color:#64748B;font-size:12px;margin-top:24px">Ze względów bezpieczeństwa zmień hasło zaraz po pierwszym logowaniu w panelu profilu.</p>
        </div>`;
      const res = await sendTransactionalEmail({
        to: email,
        subject: "Twoje konto w New European Strategies",
        html,
      });
      if (!res.ok) {
        return { ok: false, email, error: `email_failed:${res.error}`, tempPassword };
      }
    }

    await supabase
      .from("user_invitations")
      .update({
        status: "sent",
        auth_user_id: authUserId,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", invitationId);

    // Audit trail (best-effort, nie blokuje wysyłki)
    void supabase.from("audit_log").insert({
      actor_id: userId,
      action: "user_invitation_sent",
      entity_type: "user_invitation",
      entity_id: invitationId,
      tenant_id: inv.tenant_id,
      metadata: { mode: inv.mode, email, auth_user_id: authUserId } as never,
    });

    return { ok: true, email, tempPassword };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("user_invitations")
      .update({ status: "failed", last_error: msg.slice(0, 500) })
      .eq("id", invitationId);
    return { ok: false, email, error: msg };
  }
}

export const sendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SendResult> => {
    await assertAdmin(context.supabase, context.userId);
    return performSend(context.supabase, context.userId, data.id);
  });

export const sendInvitationsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(input),
  )
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

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
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
  .inputValidator((input) => z.object({ pageSlug: z.string().min(1) }).parse(input))
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

export const provisionTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pageSlug: z.string().min(1),
        role: z.enum(["admin", "editor", "author", "user"]).default("author"),
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

    let created = 0;
    let skipped = 0;
    const errors: { email: string; error: string }[] = [];

    for (const d of drafts) {
      try {
        let authUserId = byEmail.get(d.email) ?? null;

        if (!authUserId) {
          const tempPassword = generateTempPassword();
          const { data: createdUser, error: createErr } =
            await supabaseAdmin.auth.admin.createUser({
              email: d.email,
              password: tempPassword,
              email_confirm: true,
              user_metadata: {
                display_name: d.name,
                tenant_id: tenantId,
                must_change_password: true,
                provisioned: true,
              },
            });
          if (createErr) throw createErr;
          authUserId = createdUser.user?.id ?? null;
          if (!authUserId) throw new Error("no_auth_user_id");
          created++;
        } else {
          skipped++;
        }

        await supabaseAdmin.from("profiles").upsert(
          {
            id: authUserId,
            tenant_id: tenantId,
            email: d.email,
            display_name: d.name,
            slug: slugify(d.name),
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

        const orgFunctions: { pl: string; en: string }[] = [];
        if (d.programLabel_pl || d.programLabel_en) {
          orgFunctions.push({
            pl: d.programLabel_pl ?? "",
            en: d.programLabel_en ?? "",
          });
        }

        await supabaseAdmin.from("author_profiles").upsert(
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

        await supabaseAdmin
          .from("user_roles")
          .upsert(
            { user_id: authUserId, role: data.role as AppRole, tenant_id: tenantId },
            { onConflict: "user_id,role", ignoreDuplicates: true },
          );

        // ślad audytowy - konto powstało w trybie provision (bez maila)
        const { data: existingInv } = await context.supabase
          .from("user_invitations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("email", d.email)
          .maybeSingle();
        if (!existingInv) {
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
    let linked = 0;
    if (data.autoLink) {
      const doc = JSON.parse(JSON.stringify(page.builder_data ?? {})) as unknown;
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email, slug")
        .in(
          "email",
          drafts.map((d) => d.email),
        );
      const mapByEmail = new Map<string, { id: string; slug: string | null }>();
      for (const p of profs ?? []) {
        if (p.email) mapByEmail.set(p.email.toLowerCase(), { id: p.id, slug: p.slug });
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
        await context.supabase
          .from("pages")
          .update({ builder_data: doc as never })
          .eq("id", page.id);
      }
    }

    return { created, skipped, linked, errors };
  });
