// Ładny link aktywacyjny: GET /auth/activate?token=...&type=invite
//
// PRZYCZYNA. Mail zaproszenia pokazywał surowy adres weryfikacji dostawcy
// tożsamości (`https://<ref>.supabase.co/auth/v1/verify?...`). Dla odbiorcy
// wygląda to jak link phishingowy - inna domena niż marka, długi ciąg znaków w
// treści wiadomości. Ta trasa jest adresem NA NASZEJ domenie: przyjmuje token
// jednorazowy i przekazuje (302) do weryfikacji dostawcy.
//
// Nie ma tu żadnego sekretu ani decyzji dostępowej: token nadal weryfikuje
// dostawca, a my jedynie nie pokazujemy jego adresu w treści maila.
import { createFileRoute } from "@tanstack/react-router";

/** Typy weryfikacji, które wolno przepuścić - lista zamknięta. */
const ALLOWED_TYPES = new Set(["invite", "magiclink", "signup", "recovery", "email_change"]);

/** Token dostawcy to bezpieczny alfabet URL - odrzucamy wszystko inne. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;

const APP_URL = "https://neweuropeanstrategies.com";

export const Route = createFileRoute("/auth/activate")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const type = url.searchParams.get("type") ?? "invite";
        const origin = process.env.PUBLIC_APP_URL ?? APP_URL;

        if (!TOKEN_RE.test(token) || !ALLOWED_TYPES.has(type)) {
          return Response.redirect(`${origin}/auth?error=invalid_link`, 302);
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        if (!supabaseUrl) {
          console.error("[auth-activate] SUPABASE_URL not configured");
          return Response.redirect(`${origin}/auth?error=activation_unavailable`, 302);
        }

        const verify = new URL("/auth/v1/verify", supabaseUrl);
        verify.searchParams.set("token", token);
        verify.searchParams.set("type", type);
        verify.searchParams.set("redirect_to", `${origin}/auth/callback`);

        return new Response(null, {
          status: 302,
          headers: { Location: verify.toString(), "Cache-Control": "no-store" },
        });
      },
    },
  },
});
