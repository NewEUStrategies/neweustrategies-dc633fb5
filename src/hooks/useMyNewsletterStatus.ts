// Hook: "czy jestem już zapisany do newslettera" dla zalogowanego użytkownika.
//
// Zapytanie leci wyłącznie z sesją - anonimowy odwiedzający nie wywołuje
// serwera i widzi klasyczny formularz.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import {
  getMyNewsletterStatus,
  updateMyNewsletterTopics,
  type MyNewsletterStatus,
} from "@/lib/newsletter-status.functions";

const QUERY_KEY = ["newsletter", "my-status"] as const;

export function useMyNewsletterStatus(): {
  data: MyNewsletterStatus | null;
  isLoading: boolean;
} {
  const { user } = useAuth();
  const fetchStatus = useServerFn(getMyNewsletterStatus);
  const query = useQuery({
    queryKey: [...QUERY_KEY, user?.id ?? "anon"],
    queryFn: () => fetchStatus(),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  return { data: query.data ?? null, isLoading: query.isLoading };
}

export function useUpdateMyNewsletterTopics() {
  const client = useQueryClient();
  const update = useServerFn(updateMyNewsletterTopics);
  return useMutation({
    mutationFn: (input: { topics: string[]; mailingLists: string[] }) => update({ data: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
