// Zapytanie ustawien tenanta wspoldzielone przez zakladki Ustawienia i Linki -
// jeden klucz cache, wiec zapis odswieza oba widoki.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGiftAdminSettings } from "@/lib/gifting-admin.functions";

/**
 * Ustawienia tenanta - jeden klucz cache dla zakladki Ustawienia i tabeli
 * linkow (kolumna "otwarcia / cap"), wiec zapis natychmiast odswieza oba.
 */
export function useGiftAdminSettingsQuery() {
  const getSettings = useServerFn(getGiftAdminSettings);
  return useQuery({
    queryKey: ["gift-admin", "settings"],
    queryFn: () => getSettings(),
    staleTime: 30_000,
  });
}
