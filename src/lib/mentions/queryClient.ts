// Klient zapytań dla hooków wzmianek - z drzewa albo zapasowy.
//
// Poza drzewem QueryClientProvider (izolowany render pola, karty albo dymka
// w teście lub podglądzie komponentu) hooki wzmianek degradują się zamiast
// rzucać. Do tej zmiany każdy z czterech hooków trzymał WŁASNEGO klienta
// zapasowego - cztery kopie tego samego wzorca i cztery osobne cache'e dla
// jednej powierzchni. `hasProvider` mówi wołającemu, czy klient jest
// prawdziwy: katalog i podpowiedzi bez dostawcy w ogóle nie pytają bazy,
// a dymki (leniwe z definicji) pytają przez klienta zapasowego.
import { useContext } from "react";
import { QueryClient, QueryClientContext } from "@tanstack/react-query";

let fallbackClient: QueryClient | null = null;

export function useMentionQueryClient(): { client: QueryClient; hasProvider: boolean } {
  const ctxClient = useContext(QueryClientContext);
  if (ctxClient !== undefined) return { client: ctxClient, hasProvider: true };
  fallbackClient ??= new QueryClient();
  return { client: fallbackClient, hasProvider: false };
}
