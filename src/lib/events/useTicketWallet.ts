// Portfel na stronie biletu - zapytanie o dostępność portfeli.
//
// Jedna fabryka kluczy zakorzeniona w `event-wallet`. Dostępność to fakt
// PLATFORMY (sekrety są wspólne dla wszystkich najemców), więc klucz nie
// zależy od wydarzenia ani biletu, a odpowiedź może żyć kilka minut. Akcje
// „Dodaj” nie zmieniają niczego, co ta strona trzyma w cache - nie ma czego
// unieważniać.
import { useQuery } from "@tanstack/react-query";

import { fetchWalletAvailability } from "./ticketWalletApi";

export const ticketWalletKeys = {
  all: ["event-wallet"] as const,
  availability: () => [...ticketWalletKeys.all, "availability"] as const,
};

export function useWalletAvailability() {
  return useQuery({
    queryKey: ticketWalletKeys.availability(),
    queryFn: fetchWalletAvailability,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
