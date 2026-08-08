// Organizm: panel „Dokumenty" - biblioteka źródeł wątku.
//
// Filtr rodzaju stoi nad listą i pojawia się DOPIERO wtedy, gdy rodzajów jest
// więcej niż jeden. Droplista z jedną pozycją to kontrolka, która niczego nie
// zmienia - a użytkownik, który raz jej użył bez efektu, przestaje ufać
// filtrom na całej stronie.
//
// Usunięcie jest MIĘKKIE po stronie bazy, ale w interfejsie i tak przechodzi
// przez potwierdzenie: pozycja bibliograficzna cytowana w dyskusji znika
// z listy natychmiast, a cofnięcie wymaga moderatora.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubDocumentRow } from "@/components/clubs/molecules/ClubDocumentRow";
import { ClubDocumentForm } from "@/components/clubs/molecules/ClubDocumentForm";
import {
  useClubThreadDocuments,
  useRemoveClubThreadDocument,
  useUpsertClubThreadDocument,
} from "@/lib/clubs/useClubWorkspace";
import {
  CLUB_DOCUMENT_KINDS,
  toClubDocumentKind,
  toClubWorkspaceError,
  type ClubDocumentKind,
  type ClubThreadDocumentRow,
} from "@/lib/clubs/workspaceTypes";

/** `"all"` zamiast pustego stringa: Radix Select nie potrafi przechować `null`,
 *  a pusty string jest w nim wartością zarezerwowaną. */
const ALL = "all";

export function ClubThreadDocumentsPanel({
  threadId,
  lang,
  canContribute,
  canCurate,
}: {
  threadId: string;
  lang: "pl" | "en";
  canContribute: boolean;
  canCurate: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ClubDocumentKind | typeof ALL>(ALL);
  const [editing, setEditing] = useState<ClubThreadDocumentRow | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useClubThreadDocuments({
    threadId,
    kind: filter === ALL ? null : filter,
  });
  const upsert = useUpsertClubThreadDocument(threadId);
  const remove = useRemoveClubThreadDocument(threadId);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  // Filtr liczymy z aktualnie pobranego zbioru, ale przy aktywnym zawężeniu
  // zostawiamy go na ekranie - inaczej wybranie rodzaju usuwałoby kontrolkę,
  // którą właśnie kliknięto, i nie dałoby się jej cofnąć.
  const kindsPresent = useMemo(
    () => new Set(rows.map((row) => toClubDocumentKind(row.kind))),
    [rows],
  );
  const showFilter = filter !== ALL || kindsPresent.size > 1;

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
  };

  const submit = (input: Parameters<typeof upsert.mutate>[0]) => {
    upsert.mutate(input, {
      onSuccess: () => {
        closeForm();
        toast.success(t("club.workspace.documents.saved"));
      },
      onError: (error) => toast.error(t(`club.workspace.error.${toClubWorkspaceError(error)}`)),
    });
  };

  if (query.isPending) return <ClubThreadListSkeleton count={3} />;
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  const formOpen = adding || editing !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showFilter ? (
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value === ALL ? ALL : toClubDocumentKind(value))}
          >
            <SelectTrigger
              className="h-8 w-auto min-w-40"
              aria-label={t("club.workspace.documents.filterLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("club.workspace.documents.allKinds")}</SelectItem>
              {CLUB_DOCUMENT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`club.workspace.documentKind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span />
        )}

        {canContribute && !formOpen ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("club.workspace.documents.add")}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <ClubDocumentForm
          threadId={threadId}
          initial={editing}
          canCurate={canCurate}
          pending={upsert.isPending}
          onCancel={closeForm}
          onSubmit={submit}
        />
      ) : null}

      {rows.length === 0 ? (
        <ClubWorkspaceEmpty
          icon={<FileText className="h-5 w-5" />}
          title={t("club.workspace.documents.empty")}
          hint={
            canContribute
              ? t("club.workspace.documents.emptyHint")
              : t("club.workspace.documents.emptyReadonly")
          }
          action={
            canContribute && !formOpen ? (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("club.workspace.documents.addFirst")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <ClubDocumentRow
              key={row.id}
              row={row}
              lang={lang}
              onEdit={(target) => {
                setAdding(false);
                setEditing(target);
              }}
              onRemove={(target) => {
                if (!window.confirm(t("club.workspace.documents.removeConfirm"))) return;
                remove.mutate(target.id, {
                  onSuccess: () => toast.success(t("club.workspace.documents.removed")),
                  onError: (error) =>
                    toast.error(t(`club.workspace.error.${toClubWorkspaceError(error)}`)),
                });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
