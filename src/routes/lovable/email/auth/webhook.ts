import * as React from "react";
import { render } from "@react-email/render";
import { parseEmailWebhookPayload } from "@lovable.dev/email-js";
import { WebhookError, verifyWebhookRequest } from "@lovable.dev/webhooks-js";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { authSubject, type AuthEmailType } from "@/lib/email-templates/copy";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";
import { resolveRecipientName } from "@/lib/email/recipient-name.server";
import { resolveAuthEmailLang } from "@/lib/email/auth-lang";
import type { SupabaseClient } from "@supabase/supabase-js";

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your email",
  invite: "You've been invited",
  magiclink: "Your login link",
  recovery: "Reset your password",
  email_change: "Confirm your new email",
  reauthentication: "Your verification code",
};

// Template mapping. Każdy szablon ma własny kształt propsów, renderowany
// z payloadu webhooka - wspólnego typu propsów tu nie ma.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

// Configuration
const SITE_NAME = "New European Strategies";
const SENDER_DOMAIN = "notify.mail.neweuropeanstrategies.com";
const ROOT_DOMAIN = "neweuropeanstrategies.com";
const FROM_DOMAIN = "neweuropeanstrategies.com";

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = email.split("@")[1];
  return domain ? domain.toLowerCase() : null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

interface AuthEventLog {
  run_id: string;
  message_id?: string | null;
  email_type: string;
  lang?: string | null;
  lang_source?: string | null;
  lang_fallback?: boolean;
  lang_raw?: string | null;
  recipient_masked?: string | null;
  recipient_domain?: string | null;
  sender?: string | null;
  sender_domain?: string | null;
  subject?: string | null;
  redirect_to?: string | null;
  action_url_host?: string | null;
  greeting_name?: string | null;
  status: "enqueued" | "rejected" | "failed";
  error_message?: string | null;
  duration_ms?: number | null;
}

/** Diagnostyka webhooka - nigdy nie może wywrócić wysyłki maila. */
async function logAuthEvent(client: SupabaseClient, event: AuthEventLog): Promise<void> {
  try {
    const { error } = await client.from("auth_email_events").insert(event);
    if (error) console.error("auth_email_events insert failed", { error: error.message });
  } catch (error) {
    console.error("auth_email_events insert threw", { error });
  }
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const apiKey = process.env.LOVABLE_API_KEY;

        if (!apiKey) {
          console.error("LOVABLE_API_KEY not configured");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Verify signature + timestamp, then parse payload.
        // Payload webhooka: kształt zależy od typu maila, a deklarowany typ
        // z @lovable.dev/email-js ma wszystkie pola opcjonalne - kod poniżej
        // czyta je bezpośrednio, więc zostaje `any` (świadomie, punktowo).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let payload: any;
        let run_id = "";
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          });
          payload = verified.payload;
          run_id = payload.run_id;
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case "invalid_signature":
              case "missing_timestamp":
              case "invalid_timestamp":
              case "stale_timestamp":
                console.error("Invalid webhook signature", { error: error.message });
                return Response.json({ error: "Invalid signature" }, { status: 401 });
              case "invalid_payload":
              case "invalid_json":
                console.error("Invalid webhook payload", { error: error.message });
                return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
            }
          }

          console.error("Webhook verification failed", { error });
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (!run_id) {
          console.error("Webhook payload missing run_id");
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (payload.version !== "1") {
          console.error("Unsupported payload version", { version: payload.version, run_id });
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 },
          );
        }

        // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
        // payload.type is the hook event type ("auth")
        const emailType = payload.data.action_type;
        console.log("Received auth event", {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
        });

        const EmailTemplate = EMAIL_TEMPLATES[emailType];
        if (!EmailTemplate) {
          console.error("Unknown email type", { emailType, run_id });
          return Response.json({ error: `Unknown email type: ${emailType}` }, { status: 400 });
        }

        // Język maila: jawny ?lang= -> prefiks /pl|/en -> metadane użytkownika ->
        // Accept-Language -> domyślny PL. Źródło decyzji trafia do diagnostyki.
        const langResult = resolveAuthEmailLang({
          redirectTo: payload.data.redirect_to,
          actionUrl: payload.data.url,
          userMetadata: (payload.data.user?.user_metadata ?? null) as Record<
            string,
            unknown
          > | null,
          acceptLanguage: request.headers.get("accept-language"),
        });
        const lang = langResult.lang;

        // Imię do personalizacji powitania (wołacz PL): metadane -> newsletter -> słownik imion.
        const meta = (payload.data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const firstNameRaw = meta.first_name ?? meta.firstName ?? meta.given_name ?? meta.name;
        const metaName = typeof firstNameRaw === "string" ? firstNameRaw : null;
        const genderRaw = typeof meta.gender === "string" ? meta.gender.toLowerCase() : "";
        const metaGender: "male" | "female" | "unknown" =
          genderRaw === "male" || genderRaw === "female" ? genderRaw : "unknown";

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error("Missing Supabase environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        let firstName = metaName;
        let gender = metaGender;
        let vocativePl: string | null = null;
        try {
          const resolved = await resolveRecipientName(
            supabase,
            payload.data.email,
            metaName,
            metaGender,
          );
          firstName = resolved.firstName ?? metaName;
          gender = resolved.gender;
          vocativePl = resolved.vocativePl;
        } catch (err) {
          console.error("Failed to resolve recipient name", err);
        }

        // Build template props from payload.data (HookData structure)
        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: payload.data.email,
          confirmationUrl: payload.data.url,
          token: payload.data.token,
          email: payload.data.email,
          oldEmail: payload.data.old_email,
          newEmail: payload.data.new_email,
          lang,
          firstName,
          gender,
          vocativePl,
        };

        // Render React Email to HTML and plain text
        const element = React.createElement(EmailTemplate, templateProps);
        const html = await render(element);
        const text = await render(element, { plainText: true });

        // Enqueue email for async processing by the dispatcher (process-email-queue).
        const messageId = crypto.randomUUID();

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: payload.data.email,
          status: "pending",
        });

        const fromAddress = `${SITE_NAME} <noreply@${FROM_DOMAIN}>`;
        const subject =
          authSubject(emailType as AuthEmailType, lang) ||
          EMAIL_SUBJECTS[emailType] ||
          "Notification";

        const diagnostics = {
          run_id,
          message_id: messageId,
          email_type: emailType,
          lang,
          lang_source: langResult.source,
          lang_fallback: langResult.usedFallback,
          lang_raw: langResult.rawValue,
          recipient_masked: redactEmail(payload.data.email),
          recipient_domain: emailDomain(payload.data.email),
          sender: fromAddress,
          sender_domain: SENDER_DOMAIN,
          subject,
          redirect_to: payload.data.redirect_to ?? null,
          action_url_host: hostOf(payload.data.url),
          greeting_name: vocativePl ?? firstName ?? null,
        };

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "auth_emails",
          payload: {
            run_id,
            message_id: messageId,
            to: payload.data.email,
            from: fromAddress,
            sender_domain: SENDER_DOMAIN,
            subject,
            html,
            text,
            purpose: "transactional",
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          console.error("Failed to enqueue auth email", { error: enqueueError, run_id, emailType });
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: payload.data.email,
            status: "failed",
            error_message: "Failed to enqueue email",
          });
          await logAuthEvent(supabase, {
            ...diagnostics,
            status: "failed",
            error_message: enqueueError.message ?? "Failed to enqueue email",
            duration_ms: Date.now() - startedAt,
          });
          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        await logAuthEvent(supabase, {
          ...diagnostics,
          status: "enqueued",
          duration_ms: Date.now() - startedAt,
        });

        console.log("Auth email enqueued", {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          lang,
          lang_source: langResult.source,
          sender: fromAddress,
          subject,
          redirect_to: payload.data.redirect_to ?? null,
          run_id,
        });

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
