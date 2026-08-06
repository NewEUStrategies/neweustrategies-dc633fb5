// Parametry adresu skrzynki „Zapytania do ekspertów" (/profile/expert-requests).
//
// Głęboki link pochodzi z powiadomienia produkowanego w bazie
// (`tg_expert_request_notify`, migracja 20260806161000):
//   /profile/expert-requests?box=received&r=<uuid>   - nowe zapytanie u eksperta,
//   /profile/expert-requests?box=sent&r=<uuid>       - decyzja u nadawcy.
// Bez walidacji router zgubiłby oba parametry i powiadomienie lądowałoby na
// domyślnej zakładce, nie wskazując, o które zapytanie chodzi.
//
// Czysty moduł (bez Reacta) - trasa tylko go podpina, a test sprawdza kontrakt
// bez montowania routera.
import type { ExpertRequestBox } from "./useExpertRequests";

export interface ExpertRequestsSearch {
  box?: ExpertRequestBox;
  r?: string;
}

/** Kanoniczny UUID v4-podobny; identyfikator idzie do RPC, więc nie ufamy adresowi. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateExpertRequestsSearch(
  search: Record<string, unknown>,
): ExpertRequestsSearch {
  const rawBox = typeof search.box === "string" ? search.box : undefined;
  const box: ExpertRequestBox | undefined =
    rawBox === "sent" || rawBox === "received" ? rawBox : undefined;
  const rawId = typeof search.r === "string" ? search.r.trim() : "";
  const r = UUID_RE.test(rawId) ? rawId.toLowerCase() : undefined;
  // Klucze pojawiają się w adresie WYŁĄCZNIE gdy niosą wartość - inaczej
  // `?box=undefined` zaśmiecałby link kopiowany przez użytkownika.
  return { ...(box ? { box } : {}), ...(r ? { r } : {}) };
}
