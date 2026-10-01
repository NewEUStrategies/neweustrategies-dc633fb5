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
//
// ODMOWA LĄDUJE NA /auth/callback, NIE NA /auth. Do 2026-10-01 oba
// przekierowania błędu wskazywały `/auth?error=...`, a trasy `/auth` w tej
// aplikacji nie ma (wejście do konta to `/login`) - odbiorca uszkodzonego lub
// przyciętego przez klienta poczty linku dostawał 404 zamiast wyjaśnienia.
// `/auth/callback` czyta `?error=` i od razu pokazuje komunikat o nieważnym
// linku, tak samo jak dla błędu zwróconego przez dostawcę.
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

        // `new URL(ścieżka, origin)`, a nie sklejanie napisów: PUBLIC_APP_URL
        // z końcowym ukośnikiem dawał wcześniej `//auth/...`.
        const callback = new URL("/auth/callback", origin);
        const failure = (code: string) => {
          const target = new URL(callback);
          target.searchParams.set("error", code);
          return Response.redirect(target.toString(), 302);
        };

        if (!TOKEN_RE.test(token) || !ALLOWED_TYPES.has(type)) {
          return failure("invalid_link");
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        if (!supabaseUrl) {
          console.error("[auth-activate] SUPABASE_URL not configured");
          return failure("activation_unavailable");
        }

        const verify = new URL("/auth/v1/verify", supabaseUrl);
        verify.searchParams.set("token", token);
        verify.searchParams.set("type", type);
        verify.searchParams.set("redirect_to", callback.toString());

        return new Response(null, {
          status: 302,
          headers: { Location: verify.toString(), "Cache-Control": "no-store" },
        });
      },
    },
  },
});
