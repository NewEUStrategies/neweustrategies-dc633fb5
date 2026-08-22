// Stan PUSTY sekcji listy czytelniczej: zdanie + wyjście do archiwum.
//
// MOLEKUŁA. To NIE jest stan błędu - dane przyszły, tylko nic w nich nie ma,
// więc czytelnik dostaje drogę dalej (link do artykułów), a nie „spróbuj
// ponownie". Rozróżnienie pustki i awarii jest tu jawne, bo w tym repo
// zlanie ich w jeden komunikat zdarzyło się już trzy razy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function ReadingListEmptyState({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p>{text}</p>
      <Link to="/blog" className="inline-block mt-4 text-brand hover:underline">
        {t("readingList.browseArticles")}
      </Link>
    </div>
  );
}
