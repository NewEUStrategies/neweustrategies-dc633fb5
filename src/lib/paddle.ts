import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: { token: string }) => void;
      Checkout: { open: (opts: Record<string, unknown>) => void };
    };
  }
}

export function isPaymentsConfigured(): boolean {
  return !!clientToken;
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let initialized = false;

export async function initializePaddle(): Promise<void> {
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
      paddle.Environment.set(getPaddleEnvironment() === "sandbox" ? "sandbox" : "production");
      paddle.Initialize({ token: clientToken });
      initialized = true;
      resolve();
    };
    script.onerror = () => reject(new Error("paddle_script_failed"));
    document.head.appendChild(script);
  });
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}
