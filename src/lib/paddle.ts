import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

/** Identyfikator klienta u operatora - wymagany przez Paddle Retain. */
export interface RetainCustomer {
  id: string;
}

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: { token: string; pwCustomer?: RetainCustomer }) => void;
      Update?: (opts: { pwCustomer?: RetainCustomer | Record<string, never> }) => void;
      Checkout: { open: (opts: Record<string, unknown>) => void };
    };
  }
}

export function isPaymentsConfigured(): boolean {
  return !!clientToken;
}

export function getStripeEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let initialized = false;
/** Ostatnio przekazany klient Retain - unikamy zbędnych wywołań `Update`. */
let retainCustomerId: string | null = null;

/**
 * Ustawia klienta dla Paddle Retain (odzyskiwanie płatności, anulowania).
 *
 * Musi to być identyfikator klienta u operatora (`ctm_...`) - nie e-mail ani
 * nasz wewnętrzny identyfikator użytkownika. Wołane po inicjalizacji, bo
 * `Initialize` można wykonać tylko raz na sesję strony; kolejne zmiany
 * (logowanie, wylogowanie) idą przez `Paddle.Update`.
 */
export function setRetainCustomer(customerId: string | null): void {
  const next = customerId && customerId.startsWith("ctm_") ? customerId : null;
  if (next === retainCustomerId) return;
  retainCustomerId = next;
  if (!initialized) return;
  window.Paddle?.Update?.({ pwCustomer: next ? { id: next } : {} });
}

export async function initializePaddle(options?: {
  /** Identyfikator klienta u operatora dla Retain, jeśli znany przy starcie. */
  retainCustomerId?: string | null;
}): Promise<void> {
  if (options?.retainCustomerId !== undefined) setRetainCustomer(options.retainCustomerId);
  if (initialized) return;
  if (!clientToken) throw new Error("payments_not_configured");

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle) {
        reject(new Error("paddle_unavailable"));
        return;
      }
      // Środowisko live jest domyślne - `set` wołamy wyłącznie dla testów.
      if (getStripeEnvironment() === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({
        token: clientToken,
        ...(retainCustomerId ? { pwCustomer: { id: retainCustomerId } } : {}),
      });
      initialized = true;
      resolve();
    };
    script.onerror = () => reject(new Error("paddle_script_failed"));
    document.head.appendChild(script);
  });
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  return resolvePaddlePrice({ data: { priceId, environment: getStripeEnvironment() } });
}
