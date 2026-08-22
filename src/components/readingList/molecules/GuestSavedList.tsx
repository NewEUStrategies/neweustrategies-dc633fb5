// Lista artykułów zapisanych LOKALNIE (gość, bez konta).
//
// MOLEKUŁA: prezentacja pozycji z propsów + jedno zdarzenie („usuń"). Odczyt
// i zapis magazynu przeglądarki należą do organizmu - tutaj nie ma I/O.
//
// DATA ZAPISU jest opcjonalna z konieczności: wpis mógł powstać w starszej
// wersji hooka zapisywania i nie mieć `savedAt` (albo mieć śmieć), a wtedy
// `new Date(NaN).toLocaleDateString()` wypisałoby czytelnikowi „Invalid Date".
// Stąd `Number.isFinite` - to warunek POPRAWNOŚCI, nie kosmetyka.
//
// Ikona odnośnika zewnętrznego jest `aria-hidden` i wypadnięta z kolejności
// tabulacji: prowadzi DOKŁADNIE tam, gdzie tytuł obok, więc dla czytnika ekranu
// byłaby drugim, identycznym odnośnikiem.
import { useTranslation } from "react-i18next";
import { ExternalLink, Trash2 } from "lucide-react";
import type { GuestSavedItem } from "@/lib/readingList/guestSaved";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function GuestSavedList({
  items,
  lang,
  onRemove,
}: {
  items: readonly GuestSavedItem[];
  lang: "pl" | "en";
  onRemove: (url: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border/60 rounded-[6px] border border-border/60">
      {items.map((item) => (
        <li key={item.url} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <a href={item.url} className="block truncate text-sm font-medium hover:underline">
              {item.title || item.url}
            </a>
            {Number.isFinite(item.savedAt) && (
              <p className="text-[11px] text-muted-foreground">
                {t("readingList.savedAt", {
                  date: new Date(item.savedAt).toLocaleDateString(
                    lang === "en" ? "en-GB" : "pl-PL",
                  ),
                })}
              </p>
            )}
          </div>
          <a
            href={item.url}
            className="text-muted-foreground hover:text-foreground"
            aria-hidden
            tabIndex={-1}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={() => onRemove(item.url)}
            className="text-muted-foreground transition-colors hover:text-destructive"
            aria-label={t("readingList.guestRemove")}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
