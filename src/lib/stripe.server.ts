// Współdzielona warstwa dostępu do dostawcy płatności (server-only).
// Klucze API nigdy nie trafiają do kodu aplikacji - ruch idzie przez bramkę
// konektorów platformy, która dokłada właściwe poświadczenia per środowisko.
//
// SDK OPERATORA JEST ŁADOWANE LENIWIE (`import type` + `await import`) - i to
// jest naprawa, nie kosmetyka. `routeTree.gen.ts` importuje statycznie WSZYSTKIE
// pliki tras, a wśród nich `routes/api/public/payments/webhook.ts`, który
// potrzebuje z tego modułu wyłącznie `verifyWebhook` (czyste WebCrypto, bez
// SDK). Statyczny `import Stripe from "stripe"` sprawiał więc, że paczka
// (198 kB chunku `_libs/stripe.mjs` w artefakcie serwera) była EWALUOWANA przy
// każdym starcie izolatu Workera - również dla anonimowego czytelnika artykułu,
// który nigdy nie dotknie płatności. Audyt CWV F04 / §8.1 (2026-09-20).
import type Stripe from "stripe";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox" ? getEnv("STRIPE_SANDBOX_API_KEY") : getEnv("STRIPE_LIVE_API_KEY");
}

/**
 * Moduł SDK ładowany RAZ na izolat. Memoizujemy obietnicę, nie wynik: dwa
 * równoległe pierwsze żądania płatnicze mają wtedy jeden import zamiast dwóch.
 */
let stripeSdk: Promise<typeof import("stripe")> | null = null;

function loadStripeSdk(): Promise<typeof import("stripe")> {
  // Odrzuconej obietnicy NIE zostawiamy w pamięci: jednorazowy błąd ładowania
  // zatrułby izolat na stałe, a izolaty Workera żyją minutami.
  stripeSdk ??= import("stripe").catch((error: unknown) => {
    stripeSdk = null;
    throw error;
  });
  return stripeSdk;
}

/** Zapamiętany klient wraz z poświadczeniami, z których powstał. */
interface CachedClient {
  readonly connectionApiKey: string;
  readonly lovableApiKey: string;
  readonly client: Promise<Stripe>;
}

const clients = new Map<StripeEnv, CachedClient>();

/**
 * Klient SDK z transportem przepiętym na bramkę konektorów - SDK nigdy nie
 * widzi prawdziwego klucza sekretnego operatora.
 *
 * SINGLETON PER ŚRODOWISKO, ale poświadczenia czytamy PRZY KAŻDYM WYWOŁANIU i
 * porównujemy z tymi, z których powstał wpis w cache. Dzięki temu brak klucza
 * nadal rzuca tu, a nie dopiero na pierwszym żądaniu do operatora (tak samo jak
 * przed leniwym ładowaniem), a podmiana zmiennych środowiskowych - w testach
 * przez `vi.stubEnv`, na produkcji przy rotacji - buduje nowego klienta zamiast
 * po cichu używać starego.
 */
export async function getStripeClient(env: StripeEnv): Promise<Stripe> {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = getEnv("LOVABLE_API_KEY");

  const cached = clients.get(env);
  if (
    cached !== undefined &&
    cached.connectionApiKey === connectionApiKey &&
    cached.lovableApiKey === lovableApiKey
  ) {
    return cached.client;
  }

  const client = buildStripeClient(connectionApiKey, lovableApiKey);
  clients.set(env, { connectionApiKey, lovableApiKey, client });
  try {
    return await client;
  } catch (error) {
    // Ten sam powód, co przy `loadStripeSdk`: wpis z odrzuconą obietnicą
    // zamieniłby błąd chwilowy w trwałą awarię płatności w tym izolacie.
    if (clients.get(env)?.client === client) clients.delete(env);
    throw error;
  }
}

/**
 * Twardy limit pojedynczego żądania do operatora (ms).
 *
 * Domyślne ustawienia SDK to 80 s na żądanie i 2 ponowienia - czyli do ~4 min
 * jednego wywołania. Ten klient biegnie wewnątrz webhooka (Stripe sam zrywa
 * dostawę po kilkunastu sekundach i ponawia ją, gdy nasza obsługa jeszcze
 * trwa), ticku zadań i kasy kupującego. Zawieszona bramka trzymała więc
 * wiersz dziennika w `received`, a ponowna dostawa trafiała w „w toku" i
 * odbijała się od drzwi. 10 s to zapas nad typowym czasem odpowiedzi
 * operatora, a jednocześnie mieści się w oknie dostawy webhooka.
 */
export const STRIPE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Jedno ponowienie po błędzie sieci/5xx/409. Bezpieczne także dla zapisów:
 * SDK dokłada `Idempotency-Key` do każdego POST-a (v1), więc ponowienie po
 * zerwanym połączeniu trafia w ten sam obiekt u operatora zamiast tworzyć
 * drugie obciążenie. Więcej ponowień wydłużałoby najgorszy przypadek ponad
 * okno dostawy webhooka.
 */
export const STRIPE_MAX_NETWORK_RETRIES = 1;

async function buildStripeClient(connectionApiKey: string, lovableApiKey: string): Promise<Stripe> {
  const { default: Stripe } = await loadStripeSdk();

  return new Stripe(connectionApiKey, {
    apiVersion: "2026-08-26.dahlia",
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    // `FetchHttpClient` SDK woła transport zawsze z adresem jako napisem i z
    // nagłówkami w `init` - nigdy z obiektem `Request`.
    httpClient: Stripe.createFetchHttpClient((url, init) => {
      const gatewayUrl = String(url).replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          "X-Connection-Api-Key": connectionApiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }),
  });
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const stripeError = error as {
      message?: string;
      type?: string;
      code?: string;
      decline_code?: string;
      param?: string;
      requestId?: string;
      raw?: {
        message?: string;
        type?: string;
        code?: string;
        decline_code?: string;
        param?: string;
        requestId?: string;
      };
    };

    const message = stripeError.raw?.message ?? stripeError.message;
    if (message) {
      const details = [
        stripeError.raw?.type ?? stripeError.type,
        stripeError.raw?.code ?? stripeError.code,
        stripeError.raw?.decline_code ?? stripeError.decline_code,
        stripeError.raw?.param ?? stripeError.param,
        stripeError.raw?.requestId ?? stripeError.requestId,
      ].filter(Boolean);
      return details.length ? `${message} (${details.join(", ")})` : message;
    }
  }

  return "Stripe request failed";
}

export function getWebhookSecret(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
    : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");
}

export interface VerifiedWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

/** Podpis v1 to HMAC-SHA256: dokładnie 32 bajty, czyli 64 znaki szesnastkowe. */
const V1_SIGNATURE_HEX = /^[0-9a-f]{64}$/i;

/**
 * Bajty podpisu z zapisu szesnastkowego albo `null` dla wpisu uszkodzonego.
 * Uszkodzony wpis POMIJAMY zamiast odrzucać cały nagłówek - przy rotacji
 * sekretu operator wysyła kilka `v1`, a jeden śmieciowy nie może unieważnić
 * poprawnego obok.
 */
function v1SignatureBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!V1_SIGNATURE_HEX.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Weryfikacja podpisu webhooka (HMAC-SHA256) bez SDK - działa w runtime
 * Workers i nie wymaga bramki (sekret podpisu jest lokalny).
 *
 * Porównanie podpisów robi `crypto.subtle.verify`, czyli WebCrypto w czasie
 * stałym - nie `===`/`includes` na napisach. Porównanie napisów kończy się na
 * pierwszym różnym znaku, więc czas odpowiedzi zdradzał, ile początkowych
 * znaków podrobionego podpisu się zgadza; przy publicznym odbiorniku to
 * wyrocznia do zgadywania podpisu „opłacono" znak po znaku.
 */
export async function verifyWebhook(req: Request, env: StripeEnv): Promise<VerifiedWebhookEvent> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = getWebhookSecret(env);

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1" && value) v1Signatures.push(value);
  }
  // Znacznik czasu WYŁĄCZNIE z cyfr i skończony. `Number("abc")` to `NaN`,
  // a `Math.abs(NaN) > 300` jest FAŁSZEM - zdarzenie z `t=abc` przechodziło
  // przez okno powtórki, czyli przechwycony podpis dało się odtwarzać bez
  // limitu czasu (wystarczyło podpisać nim treść z nieliczbowym `t`).
  if (!timestamp || !/^\d+$/.test(timestamp) || v1Signatures.length === 0) {
    throw new Error("Invalid signature format");
  }
  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt)) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - signedAt);
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedPayload = new TextEncoder().encode(`${timestamp}.${body}`);

  // Każdy kandydat jest sprawdzany do końca (bez wczesnego wyjścia), żeby czas
  // zależał od LICZBY wpisów w nagłówku, a nie od tego, który z nich pasuje.
  let valid = false;
  for (const candidate of v1Signatures) {
    const bytes = v1SignatureBytes(candidate);
    if (!bytes) continue;
    if (await crypto.subtle.verify("HMAC", key, bytes, signedPayload)) valid = true;
  }
  if (!valid) throw new Error("Invalid webhook signature");

  return JSON.parse(body) as VerifiedWebhookEvent;
}

/**
 * Środowisko bramki dla żądania - AUTORYTATYWNE po stronie serwera.
 *
 * W produkcji zwracamy ZAWSZE 'live', ignorując wartość od klienta: gdyby
 * klient mógł wymusić 'sandbox', powstałoby zamówienie ostemplowane 'sandbox',
 * które sandboxowy webhook (opłacony kartą testową) mógłby zrealizować i
 * odblokować realną treść.
 */
export function resolveEnvironment(requested?: StripeEnv | null): StripeEnv {
  if (process.env["NODE_ENV"] === "production") return "live";
  if (requested === "sandbox" || requested === "live") return requested;
  return "sandbox";
}

/**
 * Czy zdarzenie operatora z danego środowiska może nadać na TYM wdrożeniu
 * realny skutek: uprawnienie, miejsce w zespole, mail, wpis CRM, dokument
 * w panelu klienta.
 *
 * Produkcja przyjmuje wyłącznie pieniądze z trybu `live`. Zdarzenie z
 * piaskownicy (karta testowa) może tu co najwyżej zostawić ślad księgowy
 * oznaczony środowiskiem - `metadata.userId` w subskrypcji testowej potrafi
 * wskazać prawdziwe konto, a `user_subscriptions` nie zna środowisk. Poza
 * produkcją (podgląd, dev) oba tryby są dozwolone, tak jak w
 * `resolveEnvironment`.
 */
export function environmentGrantsAccess(env: StripeEnv): boolean {
  return process.env["NODE_ENV"] !== "production" || env === "live";
}
