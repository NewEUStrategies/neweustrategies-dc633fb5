// Podgląd skutku rezygnacji (REG-03) - JEDEN klucz zapytania dla wszystkich
// powierzchni, które go pokazują: strona samoobsługi, jej gniazdo zasad zwrotu
// i ekran po zapisie. Gniazdo i panel czytają tę samą odpowiedź z cache, więc
// zdanie o zwrocie nie rozjedzie się między nimi, a baza dostaje jedno pytanie.
//
// Klucz samoobsługi jest POŚWIADCZENIEM, więc siedzi w kluczu zapytania obok
// sluga - odpowiedzi dla różnych kluczy nigdy się nie mieszają.
import { useQuery } from "@tanstack/react-query";

import { fetchCancellationPreview } from "@/lib/events/publicRegistrationApi";

export function cancellationPreviewKey(slug: string, credential: string | null) {
  return ["event-registration-cancel-preview", slug, credential] as const;
}

export function useCancellationPreview({
  slug,
  manageToken = null,
  registrationId = null,
  enabled = true,
}: {
  slug: string;
  /** Klucz `manage_token` - pierwszeństwo przed identyfikatorem. */
  manageToken?: string | null;
  /** Identyfikator zgłoszenia zalogowanego właściciela (bez klucza). */
  registrationId?: string | null;
  enabled?: boolean;
}) {
  const credential = manageToken ?? registrationId;
  return useQuery({
    queryKey: cancellationPreviewKey(slug, credential),
    queryFn: () =>
      fetchCancellationPreview(
        manageToken !== null ? { manageToken } : { registrationId: registrationId ?? "" },
      ),
    enabled: enabled && credential !== null,
    // Skutek zależy od zegara (termin zwrotu), więc nie trzymamy go długo.
    staleTime: 15_000,
  });
}
