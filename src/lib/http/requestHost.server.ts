// Server-only helper: reads the active request host via TanStack Start's
// AsyncLocalStorage-backed request context. Kept in a *.server.ts file so
// Vite's client-bundle import protection strips it (the raw specifier
// "@tanstack/react-start/server" is denied in the client graph even behind
// a `import.meta.env.SSR` dynamic import).
import { getRequest } from "@tanstack/react-start/server";
import { normalizeHost } from "./host";

export function currentServerHost(): string | null {
  try {
    const request = getRequest();
    if (!request) return null;
    return normalizeHost(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    );
  } catch {
    return null;
  }
}
