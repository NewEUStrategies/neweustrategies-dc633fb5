// ATOM: wiersz „nazwa ustawienia + opis + kontrolka".
//
// Wyprowadzony z `admin.login-settings.tsx`, gdzie mieszkał jako lokalny `Card`
// i nie miał ani jednej asercji. Czysto prezentacyjny: bez I/O, bez stanu
// serwera, bez `useTranslation` - cały tekst wstrzykuje rodzic, więc atom da
// się użyć w każdej zakładce panelu bez ciągnięcia za sobą przestrzeni nazw
// słownika.
import type { ReactNode } from "react";

export function SettingToggleCard({
  title,
  description,
  children,
}: {
  title: string;
  /** Puste = wiersz bez drugiej linii (są ustawienia, których nazwa wystarcza). */
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border border-border rounded-lg p-4">
      <div>
        <div className="font-medium">{title}</div>
        {description ? (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
