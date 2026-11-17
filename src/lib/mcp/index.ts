// Serwer MCP New European Strategies: trzy narzędzia tylko do odczytu nad
// opublikowanymi artykułami, za uwierzytelnianiem OAuth 2.1.
//
// WYSTAWCA Z BUDOWY, NIE Z CZASU WYKONANIA. Tokeny OAuth wydaje serwer
// autoryzacji Lovable Cloud, a ich `iss` to BEZPOŚREDNI adres projektu
// (`https://<ref>.supabase.co/auth/v1`). Runtime'owy `SUPABASE_URL` bywa na
// produkcji adresem pośrednika - wystawca z niego nie zgadzałby się z `iss`
// (RFC 8414) i odrzucał każdy token. Referencję projektu wkleja Vite podczas
// budowy (`import.meta.env`), więc działa też na Workerach, gdzie
// `process.env` na poziomie modułu jest pusty.
//
// FAIL-CLOSED BEZ RZUCANIA. Brak lub zły kształt referencji NIE wyłącza
// `auth` (SDK bez `auth` obsługuje każdego) i NIE rzuca przy imporcie (moduł
// ładuje ekstrakcja manifestu i zimny start). Zamiast tego wystawca wskazuje
// domenę `.invalid`: każdy token pada na weryfikacji, endpoint zostaje zamknięty.
//
// TYLKO TOKENY KLIENTÓW OAUTH. `requireOAuthClientClaim` odrzuca skopiowane
// tokeny sesji przeglądarki (bez `client_id`) - dostęp daje wyłącznie
// autoryzacja zatwierdzona na stronie zgody `/.lovable/oauth/consent`.
import { auth, defineMcp } from "@lovable.dev/mcp-js";

import getPost from "./tools/get-post";
import listRecentPosts from "./tools/list-recent-posts";
import searchPosts from "./tools/search-posts";

export const MCP_UNCONFIGURED_ISSUER = "https://mcp-unconfigured.invalid/auth/v1";

/** Referencja projektu Lovable Cloud: 20 małych liter i cyfr. */
const PROJECT_REF = /^[a-z0-9]{20}$/;

/** Wystawca tokenów dla referencji projektu albo zamknięty wystawca awaryjny. */
export function issuerForProjectRef(ref: string | undefined): string {
  const trimmed = ref?.trim();
  return trimmed && PROJECT_REF.test(trimmed)
    ? `https://${trimmed}.supabase.co/auth/v1`
    : MCP_UNCONFIGURED_ISSUER;
}

const issuer = issuerForProjectRef(import.meta.env.VITE_SUPABASE_PROJECT_ID);

export default defineMcp({
  name: "new-european-strategies",
  title: "New European Strategies",
  version: "1.0.0",
  instructions:
    "Read-only access to articles published by New European Strategies. Use `list_recent_posts` for the latest analyses, `search_posts` to find articles by keyword and `get_post` to read one article by slug. Every tool accepts `lang` set to 'pl' (default) or 'en'; full bodies of members-only articles are returned only when the signed-in account has access.",
  tools: [listRecentPosts, searchPosts, getPost],
  auth: auth.oauth.issuer({
    issuer,
    acceptedAudiences: "authenticated",
    // Przypięty JWKS: weryfikacja bez sond discovery na każdym zimnym starcie;
    // rotacja kluczy działa, bo zestaw jest odświeżany na żądanie.
    jwksUri: `${issuer}/.well-known/jwks.json`,
    requireOAuthClientClaim: true,
    resourceName: "New European Strategies",
  }),
});
