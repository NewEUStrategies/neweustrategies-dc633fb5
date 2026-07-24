// Out-of-band capture błędów SSR, które h3 połyka do generycznej Response 500
// z ciałem `{"unhandled":true,"message":"HTTPError"}`. Bez tego nie da się
// odtworzyć oryginalnego stack trace'a (`server.ts` normalizator dostaje już
// tylko wyplute Response). Krótkie TTL zapobiega korelacji między
// niepowiązanymi żądaniami na tym samym izolacie Workera.

interface CapturedError {
  error: unknown;
  at: number;
}

let lastCapturedError: CapturedError | undefined;
const TTL_MS = 5_000;

function record(error: unknown): void {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  try {
    globalThis.addEventListener("error", (event: Event) => {
      const errorEvent = event as ErrorEvent;
      record(errorEvent.error ?? errorEvent.message ?? event);
    });
    globalThis.addEventListener("unhandledrejection", (event: Event) => {
      const rejection = event as PromiseRejectionEvent;
      record(rejection.reason ?? event);
    });
  } catch {
    /* runtime bez wsparcia globalThis listeners - normalizator wtedy loguje sam Response */
  }
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
