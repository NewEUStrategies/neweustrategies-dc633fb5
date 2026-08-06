// Atom: licznik otrzymanych zaproszeń do sieci dla pozycji "Sieć kontaktów".
//
// Liczy WYŁĄCZNIE zaproszenia przychodzące (pending_in) - wysłane przez
// użytkownika nie są zadaniem do wykonania, więc nie zapalają badge'a.
import { useNetworkCounts } from "@/lib/network/useConnections";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";

export function NetworkPendingBadge({ className }: { className?: string }) {
  const { data } = useNetworkCounts();
  return (
    <UnreadBadge
      count={data?.pending_in ?? 0}
      size="sm"
      variant="alert"
      labelKey="mobileBottomBar.unreadNetwork"
      className={className}
    />
  );
}

export default NetworkPendingBadge;
