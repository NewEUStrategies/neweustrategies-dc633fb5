// Normalizacja wyniku `next()` w request middleware.
//
// TanStack Start nie zwraca z `next()` gołego `Response` - oddaje obiekt
// kontekstu żądania (`{ request, pathname, handlerType, context, response }`).
// Middleware pisane pod starszy kontrakt (`result instanceof Response`) po
// cichu przepuszczały odpowiedź nietkniętą: nagłówki bezpieczeństwa, polityka
// Cache-Control, licznik 404 i NES Edge Cache były w praktyce martwe.
//
// Ten moduł jest jedynym miejscem, które zna oba kształty. Middleware pyta
// `getMiddlewareResponse()` o odpowiedź i oddaje nową przez
// `withMiddlewareResponse()`, więc ewentualna kolejna zmiana kontraktu
// frameworka to poprawka w jednym pliku.

/** Obiekt wyniku middleware niosący `response`. */
interface ResponseCarrier {
  response: Response;
}

function isResponseCarrier(value: unknown): value is ResponseCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "response" in value &&
    (value as { response: unknown }).response instanceof Response
  );
}

/** Odpowiedź HTTP niesiona przez wynik `next()`, albo null gdy jej nie ma. */
export function getMiddlewareResponse(result: unknown): Response | null {
  if (result instanceof Response) return result;
  if (isResponseCarrier(result)) return result.response;
  return null;
}

/** Ten sam kształt wyniku, ale z podmienioną odpowiedzią. */
export function withMiddlewareResponse<T>(result: T, response: Response): T {
  if (result instanceof Response) return response as unknown as T;
  if (isResponseCarrier(result)) return { ...result, response } as unknown as T;
  return result;
}
