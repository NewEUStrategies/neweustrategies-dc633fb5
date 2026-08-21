// /admin/community/clubs/$clubId - edytor klubu (dziewięć zakładek).
//
// Stan zakładki żyje w URL (?tab=), tak jak w /network: administrator, który
// wysyła komuś link do zakładki "Uprawnienia", wysyła link do zakładki
// "Uprawnienia", a nie do pierwszej zakładki edytora.
//
// Wersja robocza formularza jest LOKALNA i zapisuje się jednym przyciskiem.
// Autozapis przy każdym znaku byłby tu błędem: pola dostępu zmieniają realną
// widoczność treści, więc zapis musi być świadomą decyzją, a nie efektem
// ubocznym scrollowania po dropListach.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClubGeneralTab,
  type ClubGeneralDraft,
} from "@/components/admin/clubs/organisms/ClubGeneralTab";
import {
  ClubAccessTab,
  type ClubAccessDraft,
} from "@/components/admin/clubs/organisms/ClubAccessTab";
import { ClubGroupsTab } from "@/components/admin/clubs/organisms/ClubGroupsTab";
import { ClubInvitationsTab } from "@/components/admin/clubs/organisms/ClubInvitationsTab";
import { ClubMembersTab } from "@/components/admin/clubs/organisms/ClubMembersTab";
import { ClubModerationTab } from "@/components/admin/clubs/organisms/ClubModerationTab";
import { ClubPermissionsTab } from "@/components/admin/clubs/organisms/ClubPermissionsTab";
import { ClubStatsTab } from "@/components/admin/clubs/organisms/ClubStatsTab";
import { ClubThreadsTab } from "@/components/admin/clubs/organisms/ClubThreadsTab";
import { ClubStatusBadge } from "@/components/admin/clubs/atoms/ClubBadges";
import { useAdminClub, useUpsertClub } from "@/lib/clubs/useClubs";
import { CLUB_STATUSES, narrowClubEnum, toClubSaveError, type ClubStatus } from "@/lib/clubs/types";
// Wersja robocza, wykrycie zmiany i payload zapisu to REGUŁY - mieszkają
// w `lib/clubs/adminClubEditor` z tabelą przypadków. W ciele trasy stały jako
// dwie funkcje przepisujące wiersz RPC i literał dwudziestu pól wewnątrz
// handlera `onClick`, więc jedynym sposobem ich sprawdzenia było zamontowanie
// edytora z dziewięcioma zakładkami.
import {
  CLUB_EDITOR_TABS,
  clubEditorBlock,
  clubEditorPayload,
  clubEditorTab,
  isClubEditorDirty,
  toClubAccessDraft,
  toClubGeneralDraft,
  type ClubEditorTab,
} from "@/lib/clubs/adminClubEditor";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

const TAB_KEYS = CLUB_EDITOR_TABS;
type TabKey = ClubEditorTab;

interface ClubEditorSearch {
  tab: TabKey;
}

export const Route = createFileRoute("/admin/community/clubs/$clubId")({
  head: () => ({ meta: [{ title: "Club · Community · Admin" }] }),
  validateSearch: (search: Record<string, unknown>): ClubEditorSearch => ({
    tab: clubEditorTab(search.tab),
  }),
  component: ClubEditor,
});

function ClubEditor() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  // Jezyk TRESCI (nazwa klubu z blizniaczych kolumn); etykiety ida przez `t()`.
  const lang = uiLang(i18n.language);
  const { isAdmin } = useAuth();
  const { clubId } = Route.useParams();
  const { tab } = useSearch({ from: "/admin/community/clubs/$clubId" });
  const navigate = Route.useNavigate();

  const clubQ = useAdminClub(isAdmin ? clubId : undefined);
  const saveM = useUpsertClub();

  const [general, setGeneral] = useState<ClubGeneralDraft | null>(null);
  const [access, setAccess] = useState<ClubAccessDraft | null>(null);

  // Wersja robocza powstaje z danych serwera raz na wczytanie klubu. Zależność
  // po `updated_at` zamiast po całym obiekcie: React Query zwraca nową
  // referencję przy każdym refetchu, a to kasowałoby niezapisane zmiany.
  const loadedAt = clubQ.data?.updated_at;
  useEffect(() => {
    if (!clubQ.data) return;
    ensureAdminClubsI18n();
    setGeneral(toClubGeneralDraft(clubQ.data));
    setAccess(toClubAccessDraft(clubQ.data));
  }, [clubQ.data, loadedAt]);

  const dirty = useMemo(
    () =>
      clubQ.data && general && access ? isClubEditorDirty(clubQ.data, general, access) : false,
    [clubQ.data, general, access],
  );

  if (!isAdmin) {
    return (
      <Card className="mt-6">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("adminClubs.noPermissionTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("adminClubs.noPermissionBody")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (clubQ.isPending) {
    return <div className="mt-6 h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />;
  }

  if (clubQ.isError || !clubQ.data || !general || !access) {
    return (
      <Card className="mt-6">
        <CardContent className="p-6 text-sm text-destructive">
          {t("adminClubs.loadError")}
        </CardContent>
      </Card>
    );
  }

  const club = clubQ.data;

  const handleSave = () => {
    // Braki pól wymaganych rozstrzyga czysta funkcja: baza odrzuca zapis bez
    // sluga i nazwy polskiej, więc panel nie ma powodu wysyłać żądania, które
    // i tak wróci błędem.
    if (clubEditorBlock(general) !== null) {
      toast.error(t("adminClubs.requiredFields"));
      return;
    }
    saveM.mutate(clubEditorPayload(club.id, general, access), {
      onSuccess: () => toast.success(t("adminClubs.saved")),
      // Ten sam słownik powodów, co przy zakładaniu klubu: "Nie udało się
      // zapisać" bez powodu zostawia administratora bez następnego kroku.
      onError: (error) => toast.error(t(`adminClubs.create.error.${toClubSaveError(error)}`)),
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-7 px-2">
            <Link to="/admin/community/clubs">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {t("adminClubs.title")}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{pickLocalized(club, "name", lang)}</h1>
            <ClubStatusBadge
              status={narrowClubEnum<ClubStatus>(club.status, CLUB_STATUSES, "draft")}
            />
          </div>
          <p className="text-sm text-muted-foreground">/{club.slug}</p>
        </div>

        {/* Przycisk zapisu jest aktywny wyłącznie przy realnej zmianie -
            "Zapisz", które nic nie zapisuje, uczy ignorowania przycisku. */}
        <Button onClick={handleSave} disabled={!dirty || saveM.isPending}>
          {saveM.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t("common.save")}
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (!(TAB_KEYS as readonly string[]).includes(next)) return;
          void navigate({ search: { tab: next as TabKey }, replace: true });
        }}
      >
        {/* Pasek zakładek scrolluje się we własnym kontenerze: dziewięć
            zakładek nie mieści się na telefonie, a zawijanie ich do trzech
            rzędów zjadałoby pół ekranu. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {TAB_KEYS.map((key) => (
              <TabsTrigger key={key} value={key} className="whitespace-nowrap">
                {t(`adminClubs.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="general" className="mt-5">
          <ClubGeneralTab
            draft={general}
            persistedSlug={club.slug}
            disabled={saveM.isPending}
            onChange={(patch) => setGeneral((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        </TabsContent>

        <TabsContent value="access" className="mt-5">
          <ClubAccessTab
            draft={access}
            disabled={saveM.isPending}
            onChange={(patch) => setAccess((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        </TabsContent>

        <TabsContent value="groups" className="mt-5">
          <ClubGroupsTab clubId={club.id} />
        </TabsContent>

        {/* Zakładki treściowe montują się dopiero po wybraniu (`forceMount`
            domyślnie wyłączony w Radiksie): kolejka moderacji i lista tematów
            to trzy zapytania każda, a edytor otwiera się na "Ogólnych". */}
        <TabsContent value="threads" className="mt-5">
          <ClubThreadsTab clubId={club.id} />
        </TabsContent>

        <TabsContent value="moderation" className="mt-5">
          <ClubModerationTab clubId={club.id} />
        </TabsContent>

        <TabsContent value="members" className="mt-5">
          <ClubMembersTab clubId={club.id} />
        </TabsContent>

        <TabsContent value="invitations" className="mt-5">
          <ClubInvitationsTab clubId={club.id} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-5">
          <ClubPermissionsTab clubId={club.id} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-5">
          <ClubStatsTab clubId={club.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
