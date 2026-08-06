// Przekazanie żądania ze ścieżki zgodności `/lovable/*` na kanoniczną
// `/platform/*` (PR #168 - odmarkowanie powierzchni platformowych).
//
// Dlaczego przekazanie, a nie przekierowanie: oba webhooki weryfikują podpis
// HMAC liczony nad SUROWYM ciałem i nagłówkiem czasu. Odpowiedź 301/302
// przerzuca odpowiedzialność na klienta dostawcy, który nie musi powtórzyć
// POST-a z tym samym ciałem - podpis by się rozjechał albo żądanie w ogóle by
// nie doszło. Kopiujemy więc metodę, nagłówki i bajty ciała, i oddajemy
// odpowiedź kanonicznej trasy bez zmian (status, treść, nagłówki), żeby
// dostawca widział dokładnie ten sam kontrakt na obu adresach.
//
// Server-only (`*.server.ts`): trasa importuje to wyłącznie w handlerze.

/** Ścieżki, na które wolno przekazać - zamknięta lista, nie parametr z żądania. */
export type PlatformCompatTarget =
  | "/platform/email/auth/webhook"
  | "/platform/email/auth/preview"
  | "/platform/email/transactional/preview"
  | "/platform/email/suppression"
  | "/platform/email/queue/process";

export async function forwardToPlatformRoute(
  request: Request,
  target: PlatformCompatTarget,
): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = target;

  // Ciało czytamy jako bajty: żadnego parsowania i re-serializacji, inaczej
  // podpis nad ciałem przestałby się zgadzać.
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  const headers = new Headers(request.headers);
  // Host docelowy jest ten sam (self-subrequest), ale `content-length` musi
  // odpowiadać przekazanym bajtom - runtime ustawi je sam.
  headers.delete("content-length");
  headers.set("x-lovable-compat-forward", "1");

  try {
    return await fetch(url.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (error) {
    console.error("[platform-compat] forward failed", { target, error });
    return Response.json({ error: "Upstream unavailable" }, { status: 502 });
  }
}
