// Atom: licznik nieprzeczytanych wpisów w klubach dla pozycji "Kluby".
//
// Czyta zmaterializowany `user_pending_counters.club_unread`, a nie sumę po
// członkostwach: licznik utrzymuje trigger `club_bump_unread` (migracja A18),
// więc badge kosztuje ten sam jeden odczyt, co czat i powiadomienia, zamiast
// odpytywać listę klubów.
//
// Klub wyciszony (`notify_level = 'none'`) NIE dokłada się do tej liczby -
// decyzja siedzi w bazie, w triggerze, żeby plakietka i lista klubów nie mogły
// powiedzieć dwóch różnych rzeczy o tym samym klubie.
import { useUserCounter } from "@/lib/counters/usePendingCounters";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";

export function ClubUnreadBadge({ className }: { className?: string }) {
  const count = useUserCounter("club_unread");
  return (
    <UnreadBadge
      count={count}
      size="sm"
      variant="alert"
      labelKey="mobileBottomBar.unreadClubs"
      className={className}
    />
  );
}

export default ClubUnreadBadge;
