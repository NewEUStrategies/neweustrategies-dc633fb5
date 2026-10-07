// Podgląd linku w kompozytorze (komentarz, odpowiedź z karty, nowy wpis).
//
// PIERWSZY ADRES, JEDEN PODGLĄD. Kandydatem jest pierwszy adres `https://`
// w treści - ten sam parser, którym karta zamienia adresy na linki
// (`firstUrl` -> `splitInline`), więc kompozytor nie pokaże podglądu adresu,
// którego potem nie podlinkuje. `http://` odpada od razu: serwer podglądów
// i tak go nie pobierze (bramka egress wymusza https), a pytanie o niego
// zjadałoby limit żądań autora.
//
// DEBOUNCE ~600 ms. Adres wpisywany ręcznie zmienia się co znak; podgląd
// pytamy dopiero, gdy kandydat USTOI. Do tego czasu karta nie pokazuje
// starego wyniku - wynik należy wyłącznie do adresu, który jest w treści TERAZ.
//
// „×" ZAPAMIĘTUJE ADRES. Odrzucony podgląd nie wraca przy następnej literze;
// wraca dopiero, gdy w treści pojawi się INNY adres.
//
// BEST EFFORT. `fetchClubLinkPreview` zwraca `null` przy każdym niepowodzeniu
// (limit, SSRF, brak metadanych) - wtedy po prostu nie ma karty, a wysyłka
// nigdy na podgląd nie czeka. Migawka jest normalizowana do kształtu, który
// przyjmuje RPC (`clubLinkSnapshotFromPreview`), zanim trafi do wołającego.
import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { firstUrl } from "@/lib/clubs/inlineSegments";
import { clubLinkSnapshotFromPreview, type ClubLinkSnapshot } from "@/lib/clubs/postTypes";
import { useClubLinkPreview } from "@/lib/clubs/useClubLinkPreview";

/** Ile kandydat musi ustać, zanim zapytamy serwer o podgląd. */
export const COMPOSER_LINK_PREVIEW_DEBOUNCE_MS = 600;

const HTTPS = /^https:\/\//i;

export interface ComposerLinkPreview {
  /** Adres, którego dotyczy karta (`null` = karty nie ma). */
  url: string | null;
  /** Gotowa migawka do wysyłki - `null` w trakcie pobierania i bez podglądu. */
  snapshot: ClubLinkSnapshot | null;
  loading: boolean;
  /** „×" na karcie - zapamiętuje odrzucony adres. */
  dismiss: () => void;
  /** Po wysyłce: kolejny wpis może znów pokazać podgląd tego samego adresu. */
  reset: () => void;
}

export function useComposerLinkPreview(body: string, enabled = true): ComposerLinkPreview {
  const candidate = useMemo(() => {
    const href = firstUrl(body);
    return href !== null && HTTPS.test(href) ? href : null;
  }, [body]);
  const debounced = useDebouncedValue(candidate, COMPOSER_LINK_PREVIEW_DEBOUNCE_MS);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  // Wynik należy do adresu, który JEST w treści - po skasowaniu adresu karta
  // znika od razu, nie dopiero po debounce.
  const settled = debounced !== null && debounced === candidate ? debounced : null;
  const active = enabled && settled !== null && !dismissed.has(settled);
  const query = useClubLinkPreview(active ? settled : null, active);

  const snapshot = useMemo(
    () => (active ? clubLinkSnapshotFromPreview(query.data ?? null) : null),
    [active, query.data],
  );

  const dismiss = useCallback(() => {
    if (settled === null) return;
    setDismissed((current) => new Set(current).add(settled));
  }, [settled]);

  const reset = useCallback(() => setDismissed(new Set()), []);

  const loading = active && query.isFetching && query.data === undefined;
  return {
    url: active && (loading || snapshot !== null) ? settled : null,
    snapshot,
    loading,
    dismiss,
    reset,
  };
}
