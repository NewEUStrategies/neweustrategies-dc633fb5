// Znacznik stanu dostępu do klubów.
//
// Wydzielony z nagłówka huba, bo używają go DWIE powierzchnie: strona główna
// klubów i katalog elementów. Dwie kopie tej mapy ikon rozjechałyby się przy
// pierwszym nowym stanie - a katalog istnieje właśnie po to, żeby pokazywać
// prawdziwy komponent, nie jego podobiznę.
import { useTranslation } from "react-i18next";
import { KeyRound, Lock, MailCheck, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";

const ACCESS_ICON: Record<ClubHubAccess, React.ComponentType<{ className?: string }>> = {
  member: ShieldCheck,
  invited: MailCheck,
  entitled: KeyRound,
  locked: Lock,
};

export function ClubHubAccessBadge({ access }: { access: ClubHubAccess }) {
  const { t } = useTranslation();
  const Icon = ACCESS_ICON[access];
  return (
    <Badge variant={access === "locked" ? "outline" : "secondary"} className="gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      {t(`club.hub.access.${access}`)}
    </Badge>
  );
}
