// Podgląd linku (OpenGraph) dla treści klubowej - warstwa klienta.
//
// Serwerowa część (`fetchClubLinkPreview`) robi jedno żądanie z twardymi
// zabezpieczeniami SSRF; tutaj jest tylko cache i leniwość: pytamy DOPIERO
// gdy ktoś najedzie na link, a wynik trzymamy 10 minut na adres, więc druga
// osoba czytająca ten sam wątek nie generuje kolejnego wyjścia na świat.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchClubLinkPreview, type ClubLinkPreview } from "@/lib/clubs/linkPreview.functions";

export type { ClubLinkPreview };

export function useClubLinkPreview(url: string | null, enabled: boolean) {
  const fetchPreview = useServerFn(fetchClubLinkPreview);
  return useQuery({
    queryKey: ["club", "link-preview", url] as const,
    enabled: enabled && typeof url === "string" && url.length > 0,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<ClubLinkPreview | null> => {
      if (url === null) return null;
      return fetchPreview({ data: { url } });
    },
  });
}
