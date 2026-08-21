// Molekuła: plakietka akcji w dzienniku moderacji.
//
// CO BYŁO W ORGANIZMIE. Ta sama plakietka stała w `ClubModerationTab` DWA
// RAZY - raz w komórce tabeli (od `lg`), raz w karcie (poniżej `lg`) - i za
// każdym razem miała własną kopię warunku wyróżnienia
// (`r.action === "reveal_author" ? "border-amber-500/40 ..." : "text-[11px]"`).
// Dwie kopie jednej decyzji o kolorze znaczą, że poprawka w jednym układzie
// milczy w drugim.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać etykietę akcji i WYRÓŻNIĆ ujawnienie autora.
// Wyróżnienie nie jest ozdobą: ujawnienie to jedyny wpis w dzienniku, który
// łamie regułę Chatham House, więc musi dać się znaleźć wzrokiem w kolumnie
// z siedemnastoma innymi akcjami. O tym, CZY akcja jest ujawnieniem, decyduje
// `isRevealLogAction` z warstwy reguł - molekuła nie zna nazw akcji.
import { Badge } from "@/components/ui/badge";
import { isRevealLogAction } from "@/lib/clubs/adminModerationDesk";

export function ClubModerationLogBadge({ action, label }: { action: string; label: string }) {
  const reveal = isRevealLogAction(action);
  return (
    <Badge
      variant="outline"
      data-reveal={reveal ? "true" : "false"}
      className={
        reveal
          ? "border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
          : "text-[11px]"
      }
    >
      {label}
    </Badge>
  );
}
