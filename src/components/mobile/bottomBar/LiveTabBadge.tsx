// Molekuła: licznik na pozycji paska, ładowany leniwie i tylko dla zalogowanych.
//
// Dlaczego lazy: <MobileBottomBar /> siedzi w SiteChrome, czyli w chunku
// wejściowym KAŻDEJ strony. Statyczny import warstwy czatu / sieci /
// powiadomień dociągałby ich zapytania, klucze cache i typy do bundla, którym
// płaci też anonimowy czytelnik artykułu. Tutaj kod źródła badge'a wchodzi
// dopiero wtedy, gdy jest zalogowany użytkownik ORAZ administrator faktycznie
// podpiął licznik do pozycji.
//
// Fallback Suspense jest pusty (null), bo badge to warstwa czysto dodatkowa -
// jej brak przez jedną klatkę nie rusza układu paska (jest pozycjonowany
// absolutnie względem ikony).
import { Suspense, lazy, type ComponentType } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { BottomBarBadgeSource } from "@/lib/mobileBottomBar/config";

type BadgeComponent = ComponentType<{ className?: string }>;

const ChatUnreadBadge = lazy(() => import("./badges/ChatUnreadBadge"));
const NetworkPendingBadge = lazy(() => import("./badges/NetworkPendingBadge"));
const NotificationsUnreadBadge = lazy(() => import("./badges/NotificationsUnreadBadge"));

const SOURCES: Partial<Record<BottomBarBadgeSource, BadgeComponent>> = {
  chat: ChatUnreadBadge,
  network: NetworkPendingBadge,
  notifications: NotificationsUnreadBadge,
};

export function LiveTabBadge({ source }: { source: BottomBarBadgeSource | undefined }) {
  const { user } = useAuth();
  const Badge = source ? SOURCES[source] : undefined;
  if (!user || !Badge) return null;

  return (
    <Suspense fallback={null}>
      <Badge className="mbb__badge" />
    </Suspense>
  );
}
