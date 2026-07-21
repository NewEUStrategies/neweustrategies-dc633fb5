// Przycisk „Poproś o wprowadzenie" - widoczny na profilu autora tylko gdy:
//   - user jest zalogowany,
//   - nie ogląda swojego profilu,
//   - nie jest z targetem połączony (status != connected),
//   - istnieje wspólny kontakt (mutualCount > 0),
// bo bez wspólnego mostu wprowadzenie nie ma sensu (baza i tak by odmówiła).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses } from "@/lib/network/useConnections";
import { useMyIntroductions } from "@/lib/network/useIntroductions";
import { RequestIntroductionDialog } from "./RequestIntroductionDialog";
import "@/lib/i18n-network";

export interface RequestIntroductionButtonProps {
  userId: string;
  displayName: string;
}

export function RequestIntroductionButton({ userId, displayName }: RequestIntroductionButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const [open, setOpen] = useState(false);

  const enabled = modules.connections_enabled && !!user && user.id !== userId;
  const statusesQ = useConnectionStatuses(enabled ? [userId] : []);
  const state = statusesQ.data?.get(userId);
  const introsQ = useMyIntroductions("requester");

  if (!enabled) return null;
  if (!state) return null;
  if (state.status === "connected") return null;
  if (state.mutualCount === 0) return null;

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <UsersRound className="h-3.5 w-3.5" />
        {t("network.introductions.requestCta")}
      </Button>
      <RequestIntroductionDialog
        open={open}
        onOpenChange={setOpen}
        targetId={userId}
        targetName={displayName}
        existing={introsQ.data ?? []}
      />
    </>
  );
}
