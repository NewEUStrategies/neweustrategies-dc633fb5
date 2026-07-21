// Samoobsługa organizacji B2B - funkcje serwerowe panelu właściciela.
//
// Autorytet egzekwuje BAZA (org_add_seat / org_touch_seat_invite to SECURITY
// DEFINER z jawnymi checkami owner/admin; RLS na organization_seats), więc te
// funkcje wołają RPC klientem UŻYTKOWNIKA (context.supabase) - żadnej drogi na
// service_role z parametrami od klienta. Serwerowe są dlatego, że wysyłka
// e-maila (Resend przez bramkę Lovable) wymaga sekretów niedostępnych w
// przeglądarce; e-mail jest best-effort i nie unieważnia operacji na miejscu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildOrgInviteEmail } from "@/lib/organizations/inviteEmail";

const langSchema = z.enum(["pl", "en"]).default("pl");

const inviteSeatSchema = z.object({
  org_id: z.string().uuid(),
  email: z.string().email().max(200),
  lang: langSchema,
});

function siteOrigin(): string {
  return process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL ?? "";
}

async function sendInviteEmail(input: {
  orgName: string;
  invitedEmail: string;
  inviterName: string | null;
  lang: "pl" | "en";
}): Promise<boolean> {
  const origin = siteOrigin();
  if (!origin) return false;
  const { sendTransactionalEmail } = await import("@/lib/server/email.server");
  const { subject, html } = buildOrgInviteEmail({
    orgName: input.orgName,
    invitedEmail: input.invitedEmail,
    inviterName: input.inviterName,
    lang: input.lang,
    origin,
  });
  const res = await sendTransactionalEmail({ to: input.invitedEmail, subject, html });
  if (!res.ok) {
    console.warn("[orgs] invite email failed", input.invitedEmail, res.error);
  }
  return res.ok;
}

/**
 * Zaproszenie do miejsca w organizacji: org_add_seat (limit/rola/format
 * egzekwowane w definerze) + powiadomienie e-mail. Dotąd zaproszony NIE
 * dowiadywał się o miejscu - czekało w ciszy na jego przypadkowe zalogowanie;
 * to domyka samoobsługę (właściciel zaprasza własnych ludzi bez redakcji).
 */
export const inviteOrgSeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSeatSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const email = data.email.trim().toLowerCase();

    const { data: seatId, error } = await supabase.rpc("org_add_seat", {
      p_org: data.org_id,
      p_email: email,
      p_role: "member",
    });
    if (error) {
      // Komunikaty definera ("orgs: seats limit reached" itd.) mapuje UI;
      // przekazujemy je w stabilnym, krótkim polu zamiast rzucać stack trace.
      return { ok: false as const, error: error.message.slice(0, 120) };
    }

    // Nazwa organizacji do e-maila - RLS: owner widzi swój wiersz (orgs seat
    // read), admin swój tenant. Imię zapraszającego z jego profilu.
    const [{ data: org }, { data: me }] = await Promise.all([
      supabase.from("member_organizations").select("name").eq("id", data.org_id).maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name, first_name, last_name")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    const inviterName =
      me?.display_name || [me?.first_name, me?.last_name].filter(Boolean).join(" ") || null;

    const emailSent = org?.name
      ? await sendInviteEmail({
          orgName: org.name,
          invitedEmail: email,
          inviterName,
          lang: data.lang,
        })
      : false;

    return { ok: true as const, seatId: seatId as string, emailSent };
  });

const resendSchema = z.object({
  seat_id: z.string().uuid(),
  lang: langSchema,
});

/**
 * Ponowienie zaproszenia dla NIEODEBRANEGO miejsca. org_touch_seat_invite
 * (definer) weryfikuje właściciela/admina i status miejsca oraz stempluje
 * last_invited_at; my tylko wysyłamy e-mail na zwrócony adres.
 */
export const resendOrgSeatInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: touched, error } = await supabase.rpc("org_touch_seat_invite", {
      p_seat: data.seat_id,
    });
    if (error) {
      return { ok: false as const, error: error.message.slice(0, 120) };
    }
    const row = (touched ?? [])[0];
    if (!row) {
      return { ok: false as const, error: "orgs: not found" };
    }

    const { data: me } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name")
      .eq("id", context.userId)
      .maybeSingle();
    const inviterName =
      me?.display_name || [me?.first_name, me?.last_name].filter(Boolean).join(" ") || null;

    const emailSent = await sendInviteEmail({
      orgName: row.org_name,
      invitedEmail: row.invited_email,
      inviterName,
      lang: data.lang,
    });

    return { ok: true as const, emailSent };
  });
