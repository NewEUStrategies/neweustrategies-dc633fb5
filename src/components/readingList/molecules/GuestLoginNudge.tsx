// Zachęta do logowania w zakładce, która bez konta nie ma treści.
//
// MOLEKUŁA: prezentacja + JEDNA odpowiedzialność (otworzyć okno logowania
// z kontekstem, dlaczego się pojawiło). Tytuł i opis przychodzą z ustawień
// personalizacji, więc to samo okno widać spójnie na wszystkich powierzchniach.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openLoginPopup } from "@/lib/loginPopupBus";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function GuestLoginNudge({
  text,
  title,
  description,
}: {
  text: string;
  title: string;
  description: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p className="mb-4">{text}</p>
      <Button onClick={() => openLoginPopup({ title, description })}>
        {t("readingList.signIn")}
      </Button>
    </div>
  );
}
