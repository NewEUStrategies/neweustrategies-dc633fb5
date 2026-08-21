// Molekuła: WIERSZ TABELI LINKÓW ZAPRASZAJĄCYCH.
//
// CO BYŁA W ORGANIZMIE. Element `(linksQ.data ?? []).map()` z pięcioma
// wyrażeniami warunkowymi w JSX-ie (`label ?? klucz`, `max_uses !== null`,
// `expires_at ? data : "-"`, plakietka stanu, widoczność akcji) i z całym
// deskryptorem potwierdzenia zbudowanym wprost w atrybucie `onClick`.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jeden link i oddać zdarzenie unieważnienia.
// Molekuła nie zna tokenu - token widać RAZ, tuż po utworzeniu, bo tabela
// żywych zaproszeń do klubu wystarczy sfotografować przez ramię.
import { useTranslation } from "react-i18next";
import { XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ClubInviteLinkView } from "@/lib/clubs/adminClubInvites";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubRosterInviteLinkRow({
  view,
  language,
  pending,
  onRevoke,
}: {
  view: ClubInviteLinkView;
  language: string | undefined;
  pending: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();

  return (
    <TableRow>
      <TableCell className="font-medium">
        {view.label ?? t("adminClubs.invitations.linkUnnamed")}
      </TableCell>
      <TableCell>{t(view.roleKey)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {view.used}
        {view.maxUses === null ? "" : ` / ${view.maxUses}`}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {view.expiresAt === null ? "-" : formatDateShort(view.expiresAt, language)}
      </TableCell>
      <TableCell>
        <Badge variant={view.revoked ? "outline" : "secondary"}>{t(view.statusKey)}</Badge>
      </TableCell>
      <TableCell>
        {view.canRevoke ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            disabled={pending}
            onClick={onRevoke}
          >
            <XCircle className="h-4 w-4" />
            <span className="sr-only">{t("adminClubs.invitations.revokeLink")}</span>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
