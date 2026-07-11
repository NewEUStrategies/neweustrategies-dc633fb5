// Fetch wrapper dopinający x-correlation-id do każdego wywołania PostgREST/RPC,
// gdy mutacja biegnie wewnątrz runWithCorrelation (lib/realtime/correlationContext).
// Po stronie bazy public.request_correlation_id() czyta ten nagłówek z GUC
// request.headers, a emitery zapisują go w domain_events.correlation_id -
// to domyka ślad "klik -> zdarzenia" end-to-end.
//
// Komponuje się z fetchWithTenantHost (multi-tenant) - to TEN wrapper jest
// wpinany do createClient w client.ts.
import { fetchWithTenantHost } from "./tenant-host-fetch";
import { CORRELATION_HEADER, currentCorrelationId } from "@/lib/realtime/correlationContext";

export async function fetchWithTenantHostAndCorrelation(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const correlationId = currentCorrelationId();
  if (!correlationId) return fetchWithTenantHost(input, init);

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has(CORRELATION_HEADER)) headers.set(CORRELATION_HEADER, correlationId);

  if (init || !(input instanceof Request)) {
    return fetchWithTenantHost(input, { ...init, headers });
  }
  return fetchWithTenantHost(new Request(input, { headers }));
}
