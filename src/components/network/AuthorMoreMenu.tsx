// Overflow menu (trzy kropki) na pasku akcji profilu autora - trzyma tam
// akcje drugorzędne (obecnie „Zgłoś osobę"), żeby główny pasek pozostał
// zwarty i skupiony na CTA: obserwuj / zapytanie do eksperta.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReportUserDialog } from "@/components/network/ReportUserDialog";
import { useAuth } from "@/hooks/useAuth";
import "@/lib/i18n-network";

export interface AuthorMoreMenuProps {
  userId: string;
  displayName: string;
}

export function AuthorMoreMenu({ userId, displayName }: AuthorMoreMenuProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  if (!user || user.id === userId) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={t("common.more", { defaultValue: "Więcej" })}
            title={t("common.more", { defaultValue: "Więcej" })}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1.5">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false);
              setReportOpen(true);
            }}
          >
            <Flag className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("network.report")}
          </button>
        </PopoverContent>
      </Popover>
      <ReportUserDialog
        userId={userId}
        displayName={displayName}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
    </>
  );
}
