// Organizm: CZLONKOSTWA DODATKOWE - przypisanie osoby do grupy dodatkowej.
//
// GRUPA DODATKOWA NIE ZASTEPUJE GRUPY Z BILETU, tylko doklada uprawnienia. Dlatego
// ekran nie edytuje `group_id` zapisu (to robi ekran zapisow), a wola
// `admin_event_group_member_set`, ktore jest idempotentne w obie strony.
//
// LUDZI SZUKAMY WSROD ZAPISOW TEGO WYDARZENIA. Osoba bez zapisu nie ma po co
// dostawac uprawnien wydarzenia, a wyszukiwarka po calym tenancie zapraszalaby do
// przypisywania obcych osob.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminTermsErrorMessage } from "@/lib/events/adminTermsErrors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLang } from "@/lib/i18n/format";
import { DEFAULT_REGISTRATIONS_QUERY } from "@/lib/events/registrationsApi";
import { useRegistrationsList } from "@/lib/events/useEventRegistrations";
import { useEventGroups, useSetEventGroupMember } from "@/lib/events/useEventTermsGroups";
import type { EventGroupRow } from "@/lib/events/termsGroupsApi";

export function GroupMembersPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const groupsQ = useEventGroups(eventId);
  const memberM = useSetEventGroupMember(eventId);

  const [groupId, setGroupId] = useState<string>("");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const nameOf = (row: EventGroupRow): string =>
    lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en;

  const listQ = useRegistrationsList({
    ...DEFAULT_REGISTRATIONS_QUERY,
    eventId,
    q: debounced,
    limit: 20,
  });

  const rows = useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  const toggle = (personId: string, isMember: boolean) => {
    if (groupId === "") return;
    memberM.mutate(
      { groupId, personId, isMember },
      {
        onSuccess: () =>
          toast.success(
            t(
              isMember
                ? "adminEventTerms.toasts.memberAdded"
                : "adminEventTerms.toasts.memberRemoved",
            ),
          ),
        onError: (error) => toast.error(adminTermsErrorMessage(error)),
      },
    );
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventTerms.members.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("adminEventTerms.members.subtitle")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="group-members-group">{t("adminEventTerms.members.groupLabel")}</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger id="group-members-group">
              <SelectValue placeholder={t("adminEventTerms.members.groupLabel")} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {nameOf(row)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-members-search">{t("adminEventTerms.members.search")}</Label>
          <Input
            id="group-members-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("adminEventTerms.members.search")}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("adminEventTerms.members.hint")}</p>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventTerms.members.loading")}
        errorMessage={listQ.error === null ? null : adminTermsErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventTerms.members.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{`${row.first_name} ${row.last_name}`.trim()}</span>
                  {row.extra_groups_count > 0 ? (
                    <Badge variant="secondary">
                      {`${t("adminEventTerms.labels.extraMembers")}: ${String(row.extra_groups_count)}`}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[row.email, row.company_name || row.company_text].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={groupId === "" || memberM.isPending}
                  onClick={() => toggle(row.person_id, true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("adminEventTerms.members.addAction")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={groupId === "" || memberM.isPending}
                  onClick={() => toggle(row.person_id, false)}
                >
                  <Minus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("adminEventTerms.members.removeAction")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>
    </section>
  );
}
