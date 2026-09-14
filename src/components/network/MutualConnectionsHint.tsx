// Dowód społeczny przy profilu: "N wspólnych kontaktów". Czyta ten sam
// batchowany connection_statuses co ConnectButton (wspólny cache React Query),
// więc nie dokłada zapytań. Kliknięcie prowadzi do listy wspólnych kontaktów
// z powrotem do profilu tej osoby.
//
// LICZBA MUSI OPISYWAĆ TO, CO BĘDZIE PO KLIKNIĘCIU. Stąd `mutualVisibleCount`,
// a nie `mutualCount`: docelowa trasa czyta `mutual_connections`, które odsiewa
// po `tenant_id` i `discoverable`, więc do 20260913172000 podpowiedź mówiła
// "7 wspólnych kontaktów" i otwierała stronę z czterema, nie tłumacząc różnicy.
// Kiedy widoczny jest zero mostów, podpowiedzi NIE MA - link do pustej listy
// jest gorszy niż jego brak.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses } from "@/lib/network/useConnections";
import "@/lib/i18n-network";

export function MutualConnectionsHint({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const enabled = modules.connections_enabled && !!user && user.id !== userId;
  const statusesQ = useConnectionStatuses(enabled ? [userId] : []);
  const mutual = statusesQ.data?.get(userId)?.mutualVisibleCount ?? 0;
  if (!enabled || mutual === 0) return null;
  const label = t("network.mutual", { count: mutual });
  return (
    <Link
      to="/network/mutual/$userId"
      params={{ userId }}
      aria-label={t("network.mutualLinkAria", { count: mutual })}
      className="inline-flex items-center gap-1 rounded-[4px] px-1 -mx-1 text-xs font-medium text-muted-foreground transition-colors hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Users className="h-3.5 w-3.5" aria-hidden />
      <span className="underline-offset-2 hover:underline">{label}</span>
    </Link>
  );
}
