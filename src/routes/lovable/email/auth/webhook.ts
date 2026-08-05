// Alias zgodności: POST /lovable/email/auth/webhook -> /platform/email/auth/webhook.
//
// PRZYCZYNA. PR #168 przeniósł powierzchnie platformowe z `/lovable/*` na
// `/platform/*` (odmarkowanie). Adres hooka „Send Email" po stronie dostawcy to
// konfiguracja ZEWNĘTRZNA wobec repozytorium - w oknie przepięcia dostawca woła
// jeszcze starą ścieżkę. Brak trasy = 404 = brak maili rejestracyjnych i resetu
// hasła.
//
// Przekazujemy żądanie 1:1 (metoda, nagłówki, surowe ciało) zamiast redirectu:
// weryfikacja HMAC liczy podpis nad bajtami ciała i nagłówkiem czasu, więc
// 301/302 gubiłoby podpis u klientów, które nie powtarzają POST-a. Po
// potwierdzeniu, że dostawca woła wyłącznie `/platform/*`, plik można usunąć.
import { createFileRoute } from "@tanstack/react-router";

import { forwardToPlatformRoute } from "@/lib/email/platformCompat.server";

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => forwardToPlatformRoute(request, "/platform/email/auth/webhook"),
    },
  },
});
