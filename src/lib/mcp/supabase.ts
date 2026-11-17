// Klient bazy dla narzędzi /mcp - JEDYNE miejsce, w którym narzędzia dostają
// dostęp do danych.
//
// TOŻSAMOŚĆ WOŁAJĄCEGO, NIE KLUCZ SERWERA. Każde żądanie /mcp przechodzi przez
// weryfikację tokenu OAuth (`src/lib/mcp/index.ts`), więc klient niesie TEN SAM
// token, który zweryfikował SDK. RLS i bramkowane RPC (`get_entity_content`)
// oceniają wołającego tak samo jak w aplikacji: członek z dostępem dostaje
// treść płatną, gość - tylko metadane. Nigdy nie używamy klucza serwisowego
// i nigdy nie spadamy do zapytania anonimowego, gdy tokenu brak.
//
// NAJEMCA. `x-tenant-host` niesie przeglądany host, z którego
// `public_tenant_id()` wyprowadza najemcę; poza zakresem żądania nagłówek jest
// pomijany (zachowanie domyślnego najemcy).
//
// ŚRODOWISKO CZYTANE LENIWIE, W HANDLERZE. Moduł jest importowany przy zimnym
// starcie i przy ekstrakcji manifestu - odczyt `process.env` na poziomie
// modułu zwraca `undefined` na Cloudflare Workers i nie może rzucać.
import { ToolError, type AuthContext } from "@lovable.dev/mcp-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { currentTenantHost } from "@/lib/http/requestHost";

export type McpDatabase = SupabaseClient<Database>;

/** Komunikaty widoczne dla klienta MCP - stałe, bez szczegółów infrastruktury. */
export const MCP_CALLER_MESSAGES = {
  signInRequired: "Sign in to New European Strategies to use this tool.",
  backendUnavailable: "The content service is temporarily unavailable. Try again shortly.",
} as const;

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function readEnv(names: readonly string[]): string | undefined {
  const env = (globalThis as RuntimeGlobals).process?.env;
  for (const name of names) {
    const value = env?.[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Adres i klucz publikowalny projektu albo `null`, gdy wdrożenie ich nie ma. */
export function mcpBackendConfig(): { url: string; publishableKey: string } | null {
  const url = readEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const publishableKey = readEnv([
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ]);
  return url && publishableKey ? { url, publishableKey } : null;
}

/**
 * Klient bazy działający JAKO zweryfikowany wołający. Rzuca `ToolError`
 * (komunikat widoczny dla klienta MCP), gdy wołający nie ma tokenu albo
 * wdrożenie nie ma konfiguracji bazy.
 */
export async function supabaseForCaller(auth: AuthContext): Promise<McpDatabase> {
  const token = auth.getToken();
  if (!auth.isAuthenticated() || !token) {
    throw new ToolError(MCP_CALLER_MESSAGES.signInRequired);
  }
  const config = mcpBackendConfig();
  if (!config) {
    console.error("[mcp] backend configuration missing (SUPABASE_URL / publishable key)");
    throw new ToolError(MCP_CALLER_MESSAGES.backendUnavailable);
  }
  const host = await currentTenantHost();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (host) headers["x-tenant-host"] = host;
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers },
  });
}
