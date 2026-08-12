import * as React from "react";
import { render } from "@react-email/render";
import { createFileRoute } from "@tanstack/react-router";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";
import { authSubject, type AuthEmailType } from "@/lib/email-templates/copy";

// Każdy szablon ma własny kształt propsów; mapa trzyma je pod wspólnym kluczem
// i renderuje z payloadu webhooka, więc wspólny typ propsów tu nie istnieje.
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
const ROOT_DOMAIN = "neweuropeanstrategies.com";

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://neweuropeanstrategies.com";
const SAMPLE_EMAIL = "user@example.test";
// Imie w podgladzie - zeby bylo widac spersonalizowane powitanie
// ("Dzien dobry, Anno" w PL dzieki wolaczowi, "Hi Anna," w EN).
const SAMPLE_NAME = "Anna";
const SAMPLE_GENDER = "female";
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    token: "123456",
  },
};

export const Route = createFileRoute("/platform/email/auth/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;

        if (!apiKey) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Verify the caller is authorized with LOVABLE_API_KEY.
        // Porównanie w stałym czasie - ten sam standard co /api/public/jobs-tick.
        const { secretsEqual } = await import("@/lib/server/jobsTick.server");
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
        if (!(await secretsEqual(token, apiKey))) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let type: string;
        let lang: "pl" | "en" = "pl";
        try {
          const body = await request.json();
          type = body.type;
          // i18n: ?lang / body.lang / "signup:en"
          const url = new URL(request.url);
          const rawLang =
            (typeof body.lang === "string" ? body.lang : null) ??
            url.searchParams.get("lang") ??
            (typeof type === "string" && type.includes(":") ? type.split(":")[1] : null);
          if (typeof type === "string" && type.includes(":")) type = type.split(":")[0];
          if (typeof rawLang === "string" && rawLang.toLowerCase().startsWith("en")) lang = "en";
        } catch {
          return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }

        const EmailTemplate = EMAIL_TEMPLATES[type];

        if (!EmailTemplate) {
          return Response.json({ error: `Unknown email type: ${type}` }, { status: 400 });
        }

        const sampleData = {
          firstName: SAMPLE_NAME,
          gender: SAMPLE_GENDER,
          ...(SAMPLE_DATA[type] || {}),
          lang,
        };
        const html = await render(React.createElement(EmailTemplate, sampleData));
        const subject = authSubject(type as AuthEmailType, lang);

        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Email-Subject": encodeURIComponent(subject),
            "X-Email-From": `${SITE_NAME} <noreply@${ROOT_DOMAIN}>`,
            "X-Email-Lang": lang,
          },
        });
      },
    },
  },
});
