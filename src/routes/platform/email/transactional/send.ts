import * as React from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Tables } from "@/integrations/supabase/types";
import { deterministicMessageId } from "@/lib/email/messageId";

// F04 (2026-09-20): `@react-email/render` i rejestr szablonów (ciągnie
// `app-transactional-templates` -> `@react-email/components`) schodzą ze
// statycznego importu do `await import(...)` w handlerze. Moduł trasy jest
// ewaluowany przy budowie drzewa tras, czyli PRZY STARCIE IZOLATU Workera,
// a ten kod wykonuje się wyłącznie przy realnej wysyłce maila.

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

// ---------------------------------------------------------------------------
// IDEMPOTENCJA
//
// PRZYCZYNA ŹRÓDŁOWA (audyt modułu 11). Trasa przyjmowała `idempotencyKey`, ale
// nigdzie go nie sprawdzała: `message_id` był losowy per żądanie, a klucz jechał
// tylko w ładunku kolejki. Każda warstwa, która umie odsiać duplikat - dren
// (`alreadySent` + `idx_email_send_log_message_sent_unique`), raport poczty,
// pętla zwrotna dostawcy - patrzy na `message_id`, więc ponowienie z TYM SAMYM
// kluczem było dla nich nową wiadomością i odbiorca dostawał drugi mail.
//
// Teraz klucz jest tożsamością wiadomości:
//   * `message_id` = deterministyczny UUID z (przestrzeń trasy, wywołujący,
//     klucz) - ten sam kształt co w `sendTxEmail`, więc dren odsiewa duplikat
//     tym samym mechanizmem, co dla poczty wewnętrznej,
//   * przed jakąkolwiek pracą (bramka, token wypisu, render) szukamy wiersza,
//     który już zajął ten klucz; powtórzenie dostaje JEGO `message_id` i nie
//     dotyka kolejki,
//   * ten sam klucz z INNĄ treścią (szablon, odbiorca, `templateData`) to 422,
//     nie ciche „już wysłane" - konwencja nagłówka Idempotency-Key (IETF
//     httpapi) i dostawców płatności,
//   * wyścig dwóch równoległych żądań rozstrzyga baza: wiersz 'pending' z
//     kluczem jest unikalny per `message_id`
//     (`email_send_log_idempotent_pending_uidx`), przegrany dostaje 23505 i
//     odpowiada tak samo jak powtórzenie (albo 409, gdy zwycięzca zdążył
//     polec na kolejce i zwolnić klucz),
//   * porażka po drodze klucza NIE zajmuje - ponowienie ma wysłać.
// ---------------------------------------------------------------------------

/**
 * Przestrzeń nazw klucza. Klucz wybiera KLIENT API, więc dwa konta mogą użyć
 * tego samego napisu (`order-1`) - bez zakresu wywołującego drugie konto
 * dostałoby cudzy `message_id`, a jego mail przepadłby jako „duplikat".
 * Przestrzeń trasy oddziela te identyfikatory od kluczy `sendTxEmail`, które
 * liczą `message_id` tą samą funkcją.
 */
const IDEMPOTENCY_SCOPE = "platform.email.transactional.send";

/** Górna granica długości klucza (ta sama, co u dostawców płatności i poczty). */
const IDEMPOTENCY_KEY_MAX = 255;

/** Kod Postgresa dla naruszenia unikalności - przegrana w wyścigu o klucz. */
const UNIQUE_VIOLATION = "23505";

// Goły `SupabaseClient` = dokładnie to, co zwraca `createClient(url, key)` bez
// typu bazy niżej. `ReturnType<typeof createClient>` rozwija generyki do
// `unknown`/`never` i nie przyjmuje takiego klienta.
type ServiceClient = SupabaseClient;

/**
 * Wiersz, który zajął klucz (wpis 'pending' tej trasy). Odcisk `templateData`
 * czytamy z `metadata` aliasem PostgREST-a, więc nie jest kolumną tabeli -
 * `null`, gdy wiersz go nie niesie.
 */
type IdempotencyClaim = Pick<Tables<"email_send_log">, "template_name" | "recipient_email"> & {
  template_data_sha256: string | null;
};

/** To, po czym rozpoznajemy „to samo żądanie" przy powtórzeniu klucza. */
interface RequestIdentity {
  templateName: string;
  recipient: string;
  /** SHA-256 kanonicznej postaci `templateData` (`templateDataFingerprint`). */
  fingerprint: string;
}

/**
 * Postać kanoniczna JSON-a: klucze obiektów posortowane rekurencyjnie. Ta sama
 * treść wysłana z inną kolejnością pól (inny serializator, inna wersja
 * klienta) to TO SAMO żądanie - porównanie surowego tekstu odrzuciłoby
 * uczciwe ponowienie jako „inną treść".
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Odcisk treści żądania. Dziennik nie przechowuje `templateData` (kwoty,
 * linki, dane osobowe), więc bez odcisku ten sam klucz z inną kwotą albo innym
 * linkiem dostałby „już wysłane" i drugi mail przepadłby bez śladu. Skrót, nie
 * kopia: do porównania wystarcza, a w dzienniku nie zostaje nic do wycieku.
 */
async function templateDataFingerprint(data: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(data)),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Wiersz dziennika, który zajął klucz, albo `null`, gdy klucz jest wolny.
 *
 * Zajęciem jest WYŁĄCZNIE wpis 'pending' tej trasy - ta sama populacja, której
 * pilnuje `email_send_log_idempotent_pending_uidx`, więc odczyt i rozstrzygnięcie
 * wyścigu mają jedną definicję „klucz zajęty". Wystarcza, bo dren dziennik
 * DOPISUJE ('sent', 'failed', 'dlq' to nowe wiersze), więc wpis zajęcia trwa
 * przez całe życie wiadomości; znika z populacji tylko wtedy, gdy trasa sama go
 * zwolni po porażce kolejki. 'sent' drenu nie niesie `metadata`, a więc ani
 * klucza, ani odcisku treści - porównanie żądań byłoby na nim ślepe.
 * 'suppressed' i 'failed' nie zamykają sprawy (ta sama reguła co
 * `alreadyHandled` w `transactional.server.ts`): ponowienie po odmowie bramki
 * albo po awarii ma zostać obsłużone od nowa.
 */
async function findIdempotencyClaim(
  supabase: ServiceClient,
  messageId: string,
): Promise<{ claim: IdempotencyClaim | null; error: boolean }> {
  const { data, error } = await supabase
    .from("email_send_log")
    .select("template_name, recipient_email, template_data_sha256:metadata->>template_data_sha256")
    .eq("message_id", messageId)
    .eq("status", "pending")
    .limit(1);
  if (error) return { claim: null, error: true };
  const claim: IdempotencyClaim | undefined = Array.isArray(data) ? data[0] : undefined;
  return { claim: claim ?? null, error: false };
}

/**
 * Czy zajęty klucz opisuje TO SAMO żądanie. Ten sam klucz z innym szablonem,
 * innym odbiorcą albo inną treścią to błąd klienta (klucz użyty ponownie dla
 * innej wiadomości) - cicha odpowiedź „już wysłane" zgubiłaby drugi mail bez
 * śladu. Wiersz bez odcisku (zapisany poza tą wersją trasy) porównujemy po
 * samym szablonie i odbiorcy - nie ma czym wykazać różnicy treści, a odrzucenie
 * uczciwego ponowienia jest gorsze niż przepuszczenie go jako powtórzenia.
 */
function isSameRequest(claim: IdempotencyClaim, request: RequestIdentity): boolean {
  return (
    claim.template_name === request.templateName &&
    claim.recipient_email.toLowerCase() === request.recipient.toLowerCase() &&
    (!claim.template_data_sha256 || claim.template_data_sha256 === request.fingerprint)
  );
}

/** Odpowiedź na powtórzenie: kształt sukcesu + `replayed`, bez ponownej wysyłki. */
function replayResponse(
  claim: IdempotencyClaim,
  messageId: string,
  request: RequestIdentity,
): Response {
  if (!isSameRequest(claim, request)) {
    return Response.json(
      { error: "Idempotency key was already used for a different request" },
      { status: 422 },
    );
  }
  return Response.json({ success: true, queued: true, message_id: messageId, replayed: true });
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
        let bodyIdempotencyKey: string;
        let templateData: Record<string, unknown> = {};
        try {
          const parsed: unknown = await request.json();
          const body: Record<string, unknown> =
            typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {};
          templateName = readString(body, "templateName", "template_name");
          recipientEmail = readString(body, "recipientEmail", "recipient_email");
          bodyIdempotencyKey = readString(body, "idempotencyKey", "idempotency_key").trim();
          const data = body.templateData;
          if (typeof data === "object" && data !== null && !Array.isArray(data)) {
            templateData = data as Record<string, unknown>;
          }
        } catch {
          return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }

        // Klucz idempotencji: pole ciała (dotychczasowy kontrakt trasy) albo
        // nagłówek `Idempotency-Key` (konwencja HTTP API). Oba naraz i RÓŻNE to
        // sprzeczne żądanie - wybranie jednego po cichu ukryłoby błąd klienta.
        const headerIdempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
        if (
          bodyIdempotencyKey &&
          headerIdempotencyKey &&
          bodyIdempotencyKey !== headerIdempotencyKey
        ) {
          return Response.json(
            { error: "Idempotency-Key header and idempotencyKey in body differ" },
            { status: 400 },
          );
        }
        // Brak klucza to `null`, a NIE zastępnik z `message_id`. Zastępnik
        // udawał idempotencję, której nie było: losowy identyfikator jest inny
        // przy każdym ponowieniu, więc niczego nie deduplikował, a w dzienniku
        // wyglądałby jak klucz podany przez klienta.
        const idempotencyKey = bodyIdempotencyKey || headerIdempotencyKey || null;
        if (idempotencyKey && idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
          return Response.json(
            { error: `idempotencyKey must be at most ${IDEMPOTENCY_KEY_MAX} characters` },
            { status: 400 },
          );
        }

        if (!templateName) {
          return Response.json({ error: "templateName is required" }, { status: 400 });
        }

        // 1. Look up template from registry (early — needed to resolve recipient)
        const { TEMPLATES } = await import("@/lib/email-templates/registry");
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

        // 1d. TOŻSAMOŚĆ WIADOMOŚCI i powtórzenia (patrz IDEMPOTENCJA wyżej).
        //
        // Sprawdzenie stoi PO autoryzacji i walidacji (powtórzenie przechodzi te
        // same bramki co oryginał), a PRZED bramką wykluczeń, tokenem wypisu i
        // renderem: powtórzenie nie ma powodu płacić za nie zapytaniami, a
        // rotacja zużytego tokenu wypisu to efekt uboczny, którego powtórzenie
        // nie może wywołać drugi raz.
        const idempotency = idempotencyKey
          ? {
              key: idempotencyKey,
              request: {
                templateName,
                recipient: effectiveRecipient,
                fingerprint: await templateDataFingerprint(templateData),
              } satisfies RequestIdentity,
            }
          : null;
        const messageId = idempotency
          ? await deterministicMessageId(`${IDEMPOTENCY_SCOPE}:${user.id}:${idempotency.key}`)
          : crypto.randomUUID();

        if (idempotency) {
          const { claim, error: claimLookupFailed } = await findIdempotencyClaim(
            supabase,
            messageId,
          );
          if (claimLookupFailed) {
            // Bez odczytu nie wiemy, czy mail już wyszedł - wysyłka „na ślepo"
            // mogłaby być drugą. 500 jest tu bezpieczne: klient ponawia z tym
            // samym kluczem, a ten nie został jeszcze zajęty.
            console.error("Idempotency lookup failed for transactional send", {
              templateName,
              recipient_redacted: redactEmail(effectiveRecipient),
            });
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }
          if (claim) return replayResponse(claim, messageId, idempotency.request);
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

        // Wspólna część KAŻDEGO wiersza dziennika tej trasy - jedno miejsce
        // zamiast siedmiu kopii, z których każda mogła zgubić pole.
        //  * `tenant_id` z bramki: panel wysyłek czyta dziennik w granicach
        //    JEDNEGO najemcy, więc wiersz bez stempla jest niewidoczny dla
        //    operatora, który ma nim wytłumaczyć brak maila. Gdy bramka nie
        //    rozstrzygnęła tenanta, `null` przechodzi do triggera
        //    `trg_email_send_log_bind_tenant`, a ten dopina go z adresu.
        //  * `metadata.idempotency_key` - klucz klienta, gdy go podał: wiąże
        //    wiersz z żądaniem, o które pyta wsparcie, a w wierszu 'pending'
        //    jest predykatem indeksu `email_send_log_idempotent_pending_uidx`.
        //    Obok niego `template_data_sha256` - odcisk treści, po którym
        //    powtórzenie odróżnia ponowienie od klucza użytego dla innej
        //    wiadomości. Bez klucza `metadata` w ogóle nie powstaje, więc
        //    wiersz jest poza indeksem i niczego nie blokuje.
        const logRow = {
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          tenant_id: gate.tenantId,
          ...(idempotency
            ? {
                metadata: {
                  idempotency_key: idempotency.key,
                  template_data_sha256: idempotency.request.fingerprint,
                },
              }
            : {}),
        };

        // Wpis porażki PRÓBY, która nie doszła do kolejki. Z kluczem niesie
        // własny identyfikator próby, a NIE `message_id` wiadomości: dren liczy
        // budżet ponowień (MAX_RETRIES) po wierszach 'failed' danego
        // `message_id` (`loadFailedAttempts` w `queueDrain.server.ts`), więc
        // pięć nieudanych ponowień klienta w czasie awarii bazy wysłałoby
        // wiadomość - gdy w końcu wejdzie do kolejki - prosto do DLQ, bez jednej
        // próby wysyłki, choć klient dostał „zakolejkowano". Z wiadomością
        // wiąże taki wpis `metadata.idempotency_key`. Bez klucza próba i
        // wiadomość to jedno (losowy `message_id`), jak dotąd.
        const attemptId = idempotency ? crypto.randomUUID() : messageId;
        const logAttemptFailure = (errorMessage: string) =>
          supabase.from("email_send_log").insert({
            ...logRow,
            message_id: attemptId,
            status: "failed",
            error_message: errorMessage,
          });

        if (!gate.allowed) {
          const reason = gate.hit ? suppressionSkipReason(gate.hit.reason) : "suppressed";
          await supabase.from("email_send_log").insert({
            ...logRow,
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
          await logAttemptFailure("Failed to look up unsubscribe token");
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
            await logAttemptFailure("Failed to create unsubscribe token");
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
            await logAttemptFailure("Failed to confirm unsubscribe token storage");
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
            await logAttemptFailure("Failed to rotate unsubscribe token");
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }
        }

        // 4. Render React Email template to HTML and plain text
        const { render } = await import("@react-email/render");
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

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes.
        //
        // Z kluczem idempotencji ten wpis jest zarazem ZAJĘCIEM klucza:
        // unikalny indeks częściowy przepuszcza tylko jeden wiersz 'pending' z
        // kluczem na `message_id`, więc z dwóch równoległych żądań do kolejki
        // trafia dokładnie jedno. Bez klucza wpis jest - jak dawniej - samym
        // śladem diagnostycznym i jego porażka nie zatrzymuje wysyłki.
        const { error: pendingError } = await supabase
          .from("email_send_log")
          .insert({ ...logRow, status: "pending" });

        if (pendingError && idempotency) {
          if (pendingError.code !== UNIQUE_VIOLATION) {
            // Bez zapisanego zajęcia nie ma gwarancji „jeden klucz = jeden
            // mail". Klucz pozostaje wolny, więc ponowienie jest bezpieczne.
            console.error("Failed to claim idempotency key for transactional send", {
              error: pendingError,
              templateName,
              recipient_redacted: redactEmail(effectiveRecipient),
            });
            return Response.json({ error: "Failed to prepare email" }, { status: 500 });
          }
          // Przegrana w wyścigu: równoległe żądanie z tym samym kluczem zajęło
          // go między naszym sprawdzeniem a zapisem. `message_id` jest wspólny
          // (liczony z klucza), ale zwycięzcę czytamy, żeby wykryć ten sam klucz
          // użyty dla INNEJ wiadomości. Jeśli zajęcia już nie ma, zwycięzca
          // poległ na kolejce i zwolnił klucz - „zakolejkowano" byłoby wtedy
          // nieprawdą, a 409 każe klientowi ponowić, co jest bezpieczne.
          const { claim } = await findIdempotencyClaim(supabase, messageId);
          if (!claim) {
            return Response.json(
              { error: "A request with this idempotency key is in progress, retry" },
              { status: 409 },
            );
          }
          return replayResponse(claim, messageId, idempotency.request);
        }

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
            // Klucz dostawcy = `message_id`, nie surowy klucz klienta. Surowy
            // napis jest unikalny tylko w obrębie WYWOŁUJĄCEGO, a dostawca widzi
            // jedno konto nadawcze całej platformy - `order-1` dwóch kont
            // zlałby się u niego w jedną wiadomość. `message_id` niesie już
            // zakres wywołującego; bez klucza klienta jest losowy i odsiewa
            // tylko ponowne doręczenie TEJ wiadomości przez dren.
            idempotency_key: messageId,
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

          // Wpis 'pending' wiadomości, która NIE weszła do kolejki, przechodzi
          // w 'failed' próby (z `attemptId`, patrz `logAttemptFailure`), zamiast
          // zostać obok nowego wiersza 'failed'. Z kluczem to warunek konieczny:
          // zawieszony 'pending' trzymałby klucz w unikalnym indeksie, a każde
          // ponowienie klienta dostawałoby „replayed" bez maila. Bez klucza to
          // po prostu prawda w dzienniku - ta wiadomość nigdy nie była w obiegu
          // (`attemptId` jest wtedy samym `message_id`). Gdy wpisu 'pending'
          // nie udało się zapisać (możliwe tylko bez klucza), dopisujemy
          // 'failed' jak dawniej, żeby porażka nie zniknęła z dziennika.
          const enqueueFailure = "Failed to enqueue email";
          const { error: failureLogError } = pendingError
            ? await logAttemptFailure(enqueueFailure)
            : await supabase
                .from("email_send_log")
                .update({ status: "failed", error_message: enqueueFailure, message_id: attemptId })
                .eq("message_id", messageId)
                .eq("status", "pending");
          if (failureLogError) {
            console.error("Failed to record enqueue failure", {
              error: failureLogError,
              templateName,
              recipient_redacted: redactEmail(effectiveRecipient),
            });
          }

          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        console.log("Transactional email enqueued", {
          templateName,
          recipient_redacted: redactEmail(effectiveRecipient),
        });

        // `message_id` w odpowiedzi to uchwyt, którym klient koreluje wysyłkę z
        // dziennikiem i z odpowiedzią na powtórzenie (ta sama wartość).
        return Response.json({ success: true, queued: true, message_id: messageId });
      },
    },
  },
});
