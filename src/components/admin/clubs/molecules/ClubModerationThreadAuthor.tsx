// Molekuła: linia autora pod tytułem tematu w panelu.
//
// CO BYŁO W ORGANIZMIE. Lokalny komponent `ThreadAuthorLine` w
// `ClubThreadsTab`, wołany z DWÓCH układów (wiersz tabeli i karta), z regułą
// ochrony tożsamości wpisaną wprost w JSX
// (`row.is_anonymous || row.attribution_mode === "chatham"`).
//
// JEDNA ODPOWIEDZIALNOŚĆ: powiedzieć, KTO jest autorem - i nie powiedzieć tego,
// gdy tożsamość jest chroniona. Reguła siedzi w
// `isThreadIdentityProtected`, adnotacja redakcyjna w `adminAttributionNote`;
// tutaj jest wyłącznie znacznik i ton (bursztyn = tożsamość chroniona).
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucz `adminClubs.threads.protectedIdentity`
// mieszka w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej
// molekuła zamontowana bez organizmu renderuje goły klucz.
import { useTranslation } from "react-i18next";
import { isThreadIdentityProtected, type ThreadIdentityRow } from "@/lib/clubs/adminThreadsBoard";
import { adminAttributionNote } from "@/lib/clubs/types";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubModerationThreadAuthor({
  row,
}: {
  row: ThreadIdentityRow & { posted_by_admin_name: string | null };
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const note = adminAttributionNote(row.posted_by_admin_name, t("club.postedOnBehalf"));

  return (
    <div className="text-xs text-muted-foreground">
      {isThreadIdentityProtected(row) ? (
        <span className="text-amber-700 dark:text-amber-300">
          {t("adminClubs.threads.protectedIdentity")} · {row.author_name}
        </span>
      ) : (
        row.author_name
      )}
      {note !== null ? <span className="ml-1.5 italic">{note}</span> : null}
    </div>
  );
}
