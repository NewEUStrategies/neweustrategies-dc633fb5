// Stan BŁĘDU odczytu - odróżniony od pustego wyniku.
//
// PROBLEM, KTÓRY TO ROZWIĄZUJE. Cała publiczna powierzchnia modułu czytała
// `q.data ?? []` i nie patrzyła na `q.isError`, więc awaria RPC renderowała się
// dokładnie tak, jak brak treści:
//
//   * padnięte `club_list` -> "Nie należysz jeszcze do żadnego klubu",
//   * padnięte `club_view` -> "Ten klub nie istnieje",
//   * padnięty strumień aktywności -> pusta sekcja bez słowa wyjaśnienia.
//
// Każdy z tych komunikatów jest FAŁSZYWY i każdy prowadzi użytkownika do złej
// decyzji: skasowania poprawnego linku, ponownego wysłania prośby o dostęp albo
// wniosku, że klub jest martwy. Panel administracyjny tego samego modułu
// obsługiwał błędy od początku - tu chodzi o parytet powierzchni publicznej.
//
// Komponent jest świadomie skromny: jedno zdanie i przycisk. Szczegóły błędu
// (kod RPC, treść wyjątku) nie należą do interfejsu czytelnika - lądują
// w obserwowalności, nie na ekranie.
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureClubI18n } from "@/lib/i18n-club";

export function ClubErrorNotice({
  onRetry,
  className,
  compact,
}: {
  onRetry?: () => void;
  className?: string;
  /** Wariant do sekcji wewnątrz strony (strumień, katalog) - bez ramki karty. */
  compact?: boolean;
}) {
  ensureClubI18n();
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className={`flex flex-col items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 text-center ${
        compact ? "p-4" : "p-8"
      } ${className ?? ""}`}
    >
      <AlertTriangle
        className={compact ? "h-5 w-5 text-amber-600" : "h-7 w-7 text-amber-600"}
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("club.error.title")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("club.error.body")}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("club.error.retry")}
        </Button>
      ) : null}
    </div>
  );
}
