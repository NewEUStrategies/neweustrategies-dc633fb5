// Dowód społeczny przy profilu: "N wspólnych kontaktów". Czyta ten sam
// batchowany connection_statuses co ConnectButton (wspólny cache React Query),
// więc nie dokłada zapytań.
import { useTranslation } from "react-i18next";
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
  const mutual = statusesQ.data?.get(userId)?.mutualCount ?? 0;
  if (!enabled || mutual === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Users className="h-3.5 w-3.5" aria-hidden />
      {t("network.mutual", { count: mutual })}
    </span>
  );
}
