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
// `/auth/callback` czyta `?error=`, raz sprawdza sesję i pokazuje komunikat
// o nieważnym linku tylko wtedy, gdy jej nie ma (zalogowany użytkownik trafia
// na /welcome) - tak samo jak dla błędu zwróconego przez dostawcę.
import { createFileRoute } from "@tanstack/react-router";

/**
 * Typy weryfikacji, które wolno przepuścić - DOKŁADNIE te, które może wydać
 * jedyny nadawca tego linku (`src/lib/admin/invitations.functions.ts`:
 * `generateLink({ type: "invite" })`, a przy istniejącym koncie
 * `generateLink({ type: "magiclink" })`, typ brany z `verification_type`).
 *
 * USTALONE ZE ŹRÓDŁA Supabase Auth (github.com/supabase/auth, master ce9a8ee,
 * 2026-09-22; to samo zachowanie od v2.0.0), 2026-10-01:
 *   - `invite` zwraca zawsze "invite" (`internal/api/mail.go`: odpowiedź to
 *     `VerificationType: params.Type`, ścieżka zaproszenia go nie przepisuje);
 *   - `magiclink` zwraca "magiclink" dla KAŻDEGO istniejącego konta
 *     (potwierdzonego i nie), ale "signup", gdy Supabase konta nie znajdzie -
 *     `mail.go`: `case mail.MagicLinkVerification: params.Type =
 *     mail.SignupVerification`. U nas to rzadkie: wywołanie `invite` musi
 *     najpierw paść (np. `email_exists` dla potwierdzonego konta albo błąd
 *     przejściowy), a do chwili wywołania `magiclink` Supabase musi przestać
 *     widzieć konto. Konto wyłącznie SSO TU NIE TRAFIA - Supabase pomija
 *     wiersze `is_sso_user`, więc `invite` tworzy nowe konto i zwraca
 *     "invite". Rzadkie, ale osiągalne - dlatego "signup" ZOSTAJE na liście.
 *     Lista bez niego psułaby właśnie ten link.
 *
 * USUNIĘTE 2026-10-01: "recovery" i "email_change". Żaden nadawca ich tu nie
 * wysyła, a oba łamały kontrakt strony powrotu: link `recovery` logował
 * i kierował na /welcome, z pominięciem ustawienia nowego hasła (reset hasła
 * ma własną trasę `/reset-password`, na którą `resetPasswordForEmail` kieruje
 * bezpośrednio). Typ spoza listy dostaje tę samą odmowę co zły token.
 */
const ALLOWED_TYPES = new Set(["invite", "magiclink", "signup"]);

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
