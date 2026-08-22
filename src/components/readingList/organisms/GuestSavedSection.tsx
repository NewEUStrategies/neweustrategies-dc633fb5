// ZAPISANE (gość): lista z `localStorage` z usuwaniem pozycji.
//
// ORGANIZM: to on trzyma stan i dotyka magazynu przeglądarki. Odczyt biegnie
// RAZ, w inicjalizatorze stanu - lista gościa jest lokalna, więc nie ma jej po
// co odpytywać przy każdym renderze; kolejne zmiany idą przez ten stan.
//
// USUNIĘCIE aktualizuje NAJPIERW stan w pamięci, a zapis do magazynu jest
// best-effort: w trybie prywatnym czytelnik nadal widzi efekt kliknięcia.
// UWAGA: wynik zapisu jest tu IGNOROWANY - patrz `writeGuestSaved` i test
// `it.fails` w `src/routes/__tests__/readingListRoute.test.tsx`.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  readGuestSaved,
  withoutGuestSaved,
  writeGuestSaved,
  type GuestSavedItem,
} from "@/lib/readingList/guestSaved";
import { GuestSavedList } from "@/components/readingList/molecules/GuestSavedList";
import { ReadingListEmptyState } from "@/components/readingList/molecules/ReadingListEmptyState";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function GuestSavedSection({ lang }: { lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<GuestSavedItem[]>(() => readGuestSaved());

  const removeItem = useCallback((url: string) => {
    setItems((prev) => {
      const next = withoutGuestSaved(prev, url);
      writeGuestSaved(next);
      return next;
    });
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
        {t("readingList.guestSavedInfo")}
      </p>
      {items.length === 0 ? (
        <ReadingListEmptyState text={t("readingList.guestSavedEmpty")} />
      ) : (
        <GuestSavedList items={items} lang={lang} onRemove={removeItem} />
      )}
    </div>
  );
}
