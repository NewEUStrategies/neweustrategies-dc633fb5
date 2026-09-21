// Strona główna BEZ TREŚCI: tryb strony statycznej, a dokument buildera jest
// pusty albo go nie ma. Osobna powierzchnia, bo to NIE jest błąd - baza
// odpowiedziała poprawnie, tylko redakcja nie zbudowała jeszcze kanwy.
// Odpowiedź ma status 200 i pełną powłokę serwisu.
//
import { useTranslation } from "react-i18next";

export function HomeEmptyNotice({ lang }: { lang: "pl" | "en" }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
      <p className="text-sm">{t("common.homeEmptyNotice", { lng: lang })}</p>
    </div>
  );
}
