import * as React from "react";
import { render } from "@react-email/render";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { TEMPLATES } from "@/lib/email-templates/registry";

// Configuration baked in at scaffold time
const SITE_NAME = "New European Strategies";
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to the mail provider's nameservers. NEVER use the root domain.
const SENDER_DOMAIN = "notify.mail.neweuropeanstrategies.com";
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// Can be the root domain when display_from_root is enabled — this is cosmetic only.
const FROM_DOMAIN = "mail.neweuropeanstrategies.com";

/** Pierwsza niepusta wartość tekstowa spośród aliasów pola (camelCase/snake_case). */
function readString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const Route = createFileRoute("/platform/email/transactional/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error("Missing required environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Verify the caller has a valid Supabase auth token.
        // In TanStack, there is no Supabase gateway — we validate the JWT ourselves.
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.slice("Bearer ".length).trim();
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser(token);

        if (authError || !user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Parse request body. Ciało żądania jest danymi z zewnątrz, więc
        // czytamy je przez `unknown` i zawężamy jawnie - `any` wpuściłoby
        // dowolny kształt aż do renderowania szablonu.
        let templateName: string;
        let recipientEmail: string;
        let idempotencyKey: string;
        let messageId: string;
        let templateData: Record<string, unknown> = {};
        try {
          const parsed: unknown = await request.json();
          const body: Record<string, unknown> =
            typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {};
          templateName = readString(body, "templateName", "template_name");
          recipientEmail = readString(body, "recipientEmail", "recipient_email");
          messageId = crypto.randomUUID();
          idempotencyKey = readString(body, "idempotencyKey", "idempotency_key") || messageId;
          const data = body.templateData;
          if (typeof data === "object" && data !== null && !Array.isArray(data)) {
            templateData = data as Record<string, unknown>;
          }
        } catch {
          return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }

        if (!templateName) {
          return Response.json({ error: "templateName is required" }, { status: 400 });
        }

        // 1. Look up template from registry (early — needed to resolve recipient)
        const template = TEMPLATES[templateName];

        if (!template) {
          console.error("Template not found in registry", { templateName });
          return Response.json(
            {
              error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(", ")}`,
            },
            { status: 404 },
          );
        }

        // Resolve effective recipient: template-level `to` takes precedence over
        // the caller-provided recipientEmail. This allows notification templates
        // to always send to a fixed address (e.g., site owner from env var).
        const effectiveRecipient = template.to || recipientEmail;

        if (!effectiveRecipient) {
          return Response.json(
            {
              error: "recipientEmail is required (unless the template defines a fixed recipient)",
            },
            { status: 400 },
          );
        }

        // 1b. AUTORYZACJA (nie tylko uwierzytelnienie).
        //
        // Sam ważny token = dowolne konto czytelnika. Bez dodatkowego checku
        // każdy zalogowany mógłby wysłać z zweryfikowanej domeny nadawczej mail
        // o dowolnej treści (subject/CTA/details) na dowolny adres - klasyczny
        // open relay / wektor phishingu. Reguła:
        //   * staff (admin/editor/author/super_admin) - dowolny odbiorca,
        //   * pozostali - wyłącznie własny adres albo szablon z ustalonym `to`.
        const STAFF_ROLES = ["admin", "editor", "author", "super_admin"];
        const { data: callerRoles, error: rolesError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (rolesError) {
          console.error("Role lookup failed for transactional send", { userId: user.id });
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        const isStaff = (callerRoles ?? []).some((r: { role: string }) =>
          STAFF_ROLES.includes(r.role),
        );
        const isSelfSend =
          !!template.to ||
          (!!user.email && user.email.toLowerCase() === effectiveRecipient.toLowerCase());

        if (!isStaff && !isSelfSend) {
          console.warn("Blocked transactional send to third-party recipient", {
            userId: user.id,
            templateName,
            recipient_redacted: redactEmail(effectiveRecipient),
          });
          return Response.json(
            { error: "Forbidden: only staff may send to another recipient" },
            { status: 403 },
          );
        }

        // 1c. Każdy link renderowany w mailu musi wskazywać na naszą domenę -
        // inaczej treść od nas firmuje obcy adres docelowy.
        const ALLOWED_LINK_HOSTS = ["neweuropeanstrategies.com", "www.neweuropeanstrategies.com"];
        const urlFields = ["ctaUrl", "siteUrl", "url", "link"];
        for (const field of urlFields) {
          const value = templateData[field];
          if (typeof value !== "string" || value.length === 0) continue;
          let host: string;
          try {
            host = new URL(value).host.toLowerCase();
          } catch {
            return Response.json(
              { error: `Invalid URL in templateData.${field}` },
              { status: 400 },
            );
          }
          if (!ALLOWED_LINK_HOSTS.includes(host)) {
            return Response.json(
              { error: `templateData.${field} must point to an allowed domain` },
              { status: 400 },
            );
          }
        }

        // 2. KANONICZNA lista wykluczeń (public.email_suppressions).
        //
        // Wcześniej ten kod pytał zaszłą tabelę `suppressed_emails`, do której nie
        // pisał webhook dostarczalności Resend - adres po twardym odbiciu albo po
        // skardze przechodził tę bramkę bez przeszkód. Teraz decyduje macierz
        // POWÓD x KATEGORIA: skarga i twarde odbicie zatrzymują wszystko, wypis z
        // newslettera zatrzymuje tylko wysyłkę za zgodą.
        const [{ checkSendAllowed }, { emailCategoryForLabel, suppressionSkipReason }] =
          await Promise.all([
            import("@/lib/email/suppression.server"),
            import("@/lib/email/suppressionPolicy"),
          ]);

        const gate = await checkSendAllowed(supabase, {
          email: effectiveRecipient,
          category: emailCategoryForLabel(templateName),
        });

        if (!gate.allowed) {
          const reason = gate.hit ? suppressionSkipReason(gate.hit.reason) : "suppressed";
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: "suppressed",
            error_message: reason,
          });

          console.log("Email suppressed", {
            templateName,
            reason,
            recipient_redacted: redactEmail(effectiveRecipient),
          });
          return Response.json({ success: false, reason: "email_suppressed" });
        }

        // 3. Get or create unsubscribe token (one token per email address)
        const normalizedEmail = effectiveRecipient.toLowerCase();
        let unsubscribeToken: string;

        // Check for existing token for this email
        const { data: existingToken, error: tokenLookupError } = await supabase
          .from("email_unsubscribe_tokens")
          .select("token, used_at")
          .eq("email", normalizedEmail)
          .maybeSingle();

        if (tokenLookupError) {
          console.error("Token lookup failed", {
            error: tokenLookupError,
            email_redacted: redactEmail(normalizedEmail),
          });
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: "failed",
            error_message: "Failed to look up unsubscribe token",
          });
          return Response.json({ error: "Failed to prepare email" }, { status: 500 });
        }

        if (existingToken && !existingToken.used_at) {
          // Reuse existing unused token
          unsubscribeToken = existingToken.token;
        } else if (!existingToken) {
          // Create new token — upsert handles concurrent inserts gracefully
          unsubscribeToken = generateToken();
          const { error: tokenError } = await supabase
            .from("email_unsubscribe_tokens")
            .upsert(
              { token: unsubscribeToken, email: normalizedEmail },
              { onConflict: "email", ignoreDuplicates: true },
            );

          if (tokenError) {
            console.error("Failed to create unsubscribe token", {
              error: tokenError,
            });
            await supabase.from("email_send_log").insert({
              message_id: messageId,
              template_name: templateName,
              recipient_email: effectiveRecipient,
              status: "failed",
              error_message: "Failed to create unsubscribe token",
            });
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }

          // If another request raced us, our upsert was silently ignored.
          // Re-read to get the actual stored token.
          const { data: storedToken, error: reReadError } = await supabase
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", normalizedEmail)
            .maybeSingle();

          if (reReadError || !storedToken) {
            console.error("Failed to read back unsubscribe token after upsert", {
              error: reReadError,
              email_redacted: redactEmail(normalizedEmail),
            });
            await supabase.from("email_send_log").insert({
              message_id: messageId,
              template_name: templateName,
              recipient_email: effectiveRecipient,
              status: "failed",
              error_message: "Failed to confirm unsubscribe token storage",
            });
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }
          unsubscribeToken = storedToken.token;
        } else {
          // Token istnieje i został ZUŻYTY (odbiorca kiedyś się wypisał).
          //
          // Wcześniej ta gałąź traktowała zużyty token jak dowód wykluczenia i
          // odmawiała wysyłki. Po ujednoliceniu listy to już nie jest prawda:
          // o wysyłce decyduje bramka wyżej, a ona świadomie przepuszcza pocztę
          // transakcyjną na adres, który wycofał zgodę MARKETINGOWĄ (wypis nie
          // jest oświadczeniem „nie chcę potwierdzeń płatności"). Odmowa w tym
          // miejscu cofałaby tę decyzję i gubiła maile o pieniądzach i dostępie.
          //
          // Wystawiamy świeży token, żeby wiadomość wyszła z DZIAŁAJĄCYM linkiem
          // wypisu (wymóg RFC 8058 i wytycznych dla nadawców masowych), a nie z
          // linkiem, który już nic nie robi.
          unsubscribeToken = generateToken();
          const { error: rotateError } = await supabase
            .from("email_unsubscribe_tokens")
            .update({ token: unsubscribeToken, used_at: null })
            .eq("email", normalizedEmail);

          if (rotateError) {
            console.error("Failed to rotate used unsubscribe token", {
              error: rotateError,
              email_redacted: redactEmail(normalizedEmail),
            });
            await supabase.from("email_send_log").insert({
              message_id: messageId,
              template_name: templateName,
              recipient_email: effectiveRecipient,
              status: "failed",
              error_message: "Failed to rotate unsubscribe token",
            });
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }
        }

        // 4. Render React Email template to HTML and plain text
        const element = React.createElement(template.component, templateData);
        const html = await render(element);
        const plainText = await render(element, { plainText: true });

        // Resolve subject — supports static string or dynamic function
        const resolvedSubject =
          typeof template.subject === "function"
            ? template.subject(templateData)
            : template.subject;

        // 5. Enqueue the pre-rendered email for async processing by the dispatcher.
        // The dispatcher (process-email-queue) handles sending, retries, and rate-limit backoff.

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: "pending",
        });

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: effectiveRecipient,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: resolvedSubject,
            html,
            text: plainText,
            purpose: "transactional",
            label: templateName,
            idempotency_key: idempotencyKey,
            unsubscribe_token: unsubscribeToken,
            // Tenant rozwiązany przy bramce: dren sprawdza listę wykluczeń
            // PONOWNIE w chwili wysyłki i mając tenanta robi to bez dodatkowego
            // zapytania rozwiązującego.
            tenant_id: gate.tenantId,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          console.error("Failed to enqueue email", {
            error: enqueueError,
            templateName,
            recipient_redacted: redactEmail(effectiveRecipient),
          });

          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: "failed",
            error_message: "Failed to enqueue email",
          });

          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        console.log("Transactional email enqueued", {
          templateName,
          recipient_redacted: redactEmail(effectiveRecipient),
        });

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
