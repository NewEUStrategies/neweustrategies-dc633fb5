// ATOM: co pokazać w miejscu listy, gdy pozycje SĄ, ale nie dały się wczytać.
//
// PO CO. Panele `/profile/bookmarks` i `/profile/follows` czytają dane w dwóch
// krokach: najpierw identyfikatory (`user_bookmarks` / `user_follows`), potem
// treść do wyświetlenia (wpisy, strony, autorzy, kategorie, tagi, programy).
// Do dziś awaria DRUGIEGO kroku była nieodróżnialna od pustki i od oczekiwania:
// trasa rysowała puste `<ul>` bez ani jednego słowa, a licznik w zakładce
// nadal pokazywał liczbę z pierwszego kroku. Użytkownik czytał „Wpisy (2)" nad
// pustym prostokątem i wnioskował, że panel zgubił jego zapisane artykuły -
// choć one są w bazie i nie udało się tylko jedno zapytanie.
//
// LICZNIK NIE JEST TU KŁAMSTWEM I NIE ZERUJEMY GO. „Wpisy (2)" to prawda:
// zakładki istnieją. Kłamstwem była MILCZĄCA pustka pod nim - i to ona zostaje
// zastąpiona tym komunikatem.
//
// Czysto prezentacyjny: bez I/O, bez stanu serwera. Decyzja, KTÓRY stan pokazać,
// należy do trasy.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export type ListHydrationState = "pending" | "error";

export function ListHydrationNotice({
  state,
  onRetry,
}: {
  state: ListHydrationState;
  /** Ponowienie odczytu; bez niego pozostaje sam komunikat. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (state === "pending") {
    return (
      <p className="py-3 text-sm text-muted-foreground" data-testid="hydration-pending">
        {t("profile.lists.loading")}
      </p>
    );
  }
  return (
    <div
      role="alert"
      data-testid="hydration-error"
      className="space-y-2 rounded-[6px] border border-destructive/50 bg-destructive/10 p-3"
    >
      <p className="text-sm text-destructive">{t("profile.lists.loadFailed")}</p>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t("profile.lists.retry")}
        </Button>
      ) : null}
    </div>
  );
}
