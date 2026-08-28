// Organizm: UPRAWNIENIA DO STAWEK (akademicka, pozarządowa, firmowa).
//
// EKRAN ISTNIEJE, BO CENA BEZ NIEGO NIE MA JAK ZADZIAŁAĆ. Pakiet zawężony do
// grupy odbiorców pyta bazę `event_audience_qualifies`, a ta odpowiada wyłącznie
// na podstawie nadania. Bez ekranu nadania stawka akademicka była ceną, której
// nikt nie mógł dostać.
//
// NADANIA SIĘ NIE KASUJE. „Wycofaj" stempluje `revoked_at`; wiersz zostaje,
// bo tłumaczy, dlaczego ktoś zapłacił mniej. Filtr „Pokaż wycofane" jest
// domyślnie wyłączony, żeby lista mówiła o stanie dzisiejszym.
//
// PODMIOT JEST DOKŁADNIE JEDEN: konto, osoba z kartoteki albo organizacja.
// Baza odrzuca dwa naraz, więc formularz pyta najpierw o rodzaj podmiotu -
// inaczej administrator dowiadywałby się o regule dopiero z komunikatu odmowy.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, ShieldCheck, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { formatDateTime } from "@/lib/i18n/format";
import {
  AUDIENCE_GRANT_AUDIENCES,
  audienceGrantState,
  type AudienceGrantAudience,
  type AudienceGrantInput,
  type EventAudienceGrantRow,
} from "@/lib/events/audienceGrantsApi";
import {
  useAudienceGrants,
  useRevokeAudienceGrant,
  useSaveAudienceGrant,
} from "@/lib/events/useEventAudienceGrants";

const SUBJECT_KINDS = ["user", "person", "company"] as const;
type SubjectKind = (typeof SUBJECT_KINDS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GrantDraft {
  audience: AudienceGrantAudience;
  subjectKind: SubjectKind;
  subjectId: string;
  scopeThisEvent: boolean;
  evidence: string;
  validUntil: string;
}

function emptyDraft(): GrantDraft {
  return {
    audience: "academic",
    subjectKind: "user",
    subjectId: "",
    scopeThisEvent: true,
    evidence: "",
    validUntil: "",
  };
}

function subjectLabel(row: EventAudienceGrantRow): string {
  const name = row.subject_name ?? row.company_name ?? "";
  if (name !== "") return name;
  return row.subject_email ?? row.user_id ?? row.person_id ?? row.company_id ?? "-";
}

export function EventAudienceGrantsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [audience, setAudience] = useState<AudienceGrantAudience | "all">("all");
  const [scopeThisEvent, setScopeThisEvent] = useState(true);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<EventAudienceGrantRow | null>(null);

  const query = useMemo(
    () => ({
      eventId: scopeThisEvent ? eventId : null,
      audience,
      includeRevoked,
      search,
    }),
    [audience, eventId, includeRevoked, scopeThisEvent, search],
  );

  const grantsQ = useAudienceGrants(query);
  const save = useSaveAudienceGrant();
  const revoke = useRevokeAudienceGrant();

  const rows = grantsQ.data ?? [];
  const locale = i18n.language.startsWith("en") ? "en" : "pl";

  function openDialog() {
    setDraft(emptyDraft());
    setFormError(null);
    setDialogOpen(true);
  }

  function submit() {
    const subjectId = draft.subjectId.trim();
    if (!UUID_PATTERN.test(subjectId)) {
      setFormError(t("adminEventRegistration.audienceGrants.errors.subjectRequired"));
      return;
    }
    if (draft.evidence.trim() === "") {
      setFormError(t("adminEventRegistration.audienceGrants.errors.evidenceRequired"));
      return;
    }
    const input: AudienceGrantInput = {
      audience: draft.audience,
      userId: draft.subjectKind === "user" ? subjectId : null,
      personId: draft.subjectKind === "person" ? subjectId : null,
      companyId: draft.subjectKind === "company" ? subjectId : null,
      eventId: draft.scopeThisEvent ? eventId : null,
      evidence: draft.evidence,
      validUntil: draft.validUntil === "" ? null : new Date(draft.validUntil).toISOString(),
    };
    save.mutate(input, {
      onSuccess: () => {
        setDialogOpen(false);
        toast.success(t("adminEventRegistration.audienceGrants.toasts.saved"));
      },
      onError: (error) => setFormError(adminRegistrationErrorMessage(error)),
    });
  }

  function confirmRevoke() {
    const row = pendingRevoke;
    if (row === null) return;
    revoke.mutate(row.id, {
      onSuccess: () => {
        setPendingRevoke(null);
        toast.success(t("adminEventRegistration.audienceGrants.toasts.revoked"));
      },
      onError: (error) => {
        setPendingRevoke(null);
        toast.error(adminRegistrationErrorMessage(error));
      },
    });
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">
            {t("adminEventRegistration.audienceGrants.title")}
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventRegistration.audienceGrants.subtitle")}
          </p>
        </div>
        <Button type="button" onClick={openDialog} className="gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("adminEventRegistration.audienceGrants.addAction")}
        </Button>
      </header>

      <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="grants-search">
            {t("adminEventRegistration.audienceGrants.searchLabel")}
          </Label>
          <Input
            id="grants-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("adminEventRegistration.audienceGrants.searchPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grants-audience">
            {t("adminEventRegistration.audienceGrants.audienceLabel")}
          </Label>
          <FormSelect
            id="grants-audience"
            value={audience}
            onValueChange={(value) =>
              setAudience(
                AUDIENCE_GRANT_AUDIENCES.find((item) => item === value) ?? "all",
              )
            }
            options={[
              {
                value: "all",
                label: t("adminEventRegistration.audienceGrants.audienceAll"),
              },
              ...AUDIENCE_GRANT_AUDIENCES.map((item) => ({
                value: item,
                label: t(`adminEventRegistration.audienceGrants.audiences.${item}`),
              })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch
            id="grants-scope"
            checked={scopeThisEvent}
            onCheckedChange={setScopeThisEvent}
          />
          <Label htmlFor="grants-scope" className="cursor-pointer">
            {t("adminEventRegistration.audienceGrants.scopeThis")}
          </Label>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch
            id="grants-revoked"
            checked={includeRevoked}
            onCheckedChange={setIncludeRevoked}
          />
          <Label htmlFor="grants-revoked" className="cursor-pointer">
            {t("adminEventRegistration.audienceGrants.includeRevoked")}
          </Label>
        </div>
      </div>

      <AdminCatalogListState
        isLoading={grantsQ.isLoading}
        loadingLabel={t("adminEventRegistration.audienceGrants.loading")}
        errorMessage={
          grantsQ.error === null ? null : adminRegistrationErrorMessage(grantsQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventRegistration.audienceGrants.empty")}
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const state = audienceGrantState(row);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="font-medium">{subjectLabel(row)}</span>
                    <Badge variant="secondary">
                      {t(`adminEventRegistration.audienceGrants.audiences.${row.audience}`, {
                        defaultValue: row.audience,
                      })}
                    </Badge>
                    <Badge variant={state === "active" ? "default" : "outline"}>
                      {t(`adminEventRegistration.audienceGrants.states.${state}`)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{row.evidence}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.event_title === null
                      ? t("adminEventRegistration.audienceGrants.scopeAll")
                      : row.event_title}
                    {" · "}
                    {row.valid_until === null
                      ? t("adminEventRegistration.audienceGrants.neverExpires")
                      : formatDateTime(row.valid_until, locale)}
                    {row.revoked_at === null
                      ? ""
                      : ` · ${t("adminEventRegistration.audienceGrants.revokedAt", {
                          date: formatDateTime(row.revoked_at, locale),
                        })}`}
                  </p>
                </div>
                {row.revoked_at === null ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setPendingRevoke(row)}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                    {t("adminEventRegistration.audienceGrants.revokeAction")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("adminEventRegistration.audienceGrants.addAction")}
            </DialogTitle>
            <DialogDescription>
              {t("adminEventRegistration.audienceGrants.subjectHint")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="grant-audience">
                {t("adminEventRegistration.audienceGrants.audienceLabel")}
              </Label>
              <FormSelect
                id="grant-audience"
                value={draft.audience}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    audience:
                      AUDIENCE_GRANT_AUDIENCES.find((item) => item === value) ?? "academic",
                  }))
                }
                options={AUDIENCE_GRANT_AUDIENCES.map((item) => ({
                  value: item,
                  label: t(`adminEventRegistration.audienceGrants.audiences.${item}`),
                }))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="grant-subject-kind">
                  {t("adminEventRegistration.audienceGrants.columns.holder")}
                </Label>
                <FormSelect
                  id="grant-subject-kind"
                  value={draft.subjectKind}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      subjectKind:
                        SUBJECT_KINDS.find((item) => item === value) ?? "user",
                    }))
                  }
                  options={[
                    {
                      value: "user",
                      label: t("adminEventRegistration.audienceGrants.subjectUser"),
                    },
                    {
                      value: "person",
                      label: t("adminEventRegistration.audienceGrants.subjectPerson"),
                    },
                    {
                      value: "company",
                      label: t("adminEventRegistration.audienceGrants.subjectCompany"),
                    },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-subject-id">UUID</Label>
                <Input
                  id="grant-subject-id"
                  value={draft.subjectId}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, subjectId: event.target.value }))
                  }
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="grant-evidence">
                {t("adminEventRegistration.audienceGrants.evidenceLabel")}
              </Label>
              <Textarea
                id="grant-evidence"
                value={draft.evidence}
                rows={3}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, evidence: event.target.value }))
                }
                placeholder={t(
                  "adminEventRegistration.audienceGrants.evidencePlaceholder",
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t("adminEventRegistration.audienceGrants.evidenceHint")}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="grant-valid-until">
                  {t("adminEventRegistration.audienceGrants.validUntilLabel")}
                </Label>
                <Input
                  id="grant-valid-until"
                  type="date"
                  value={draft.validUntil}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, validUntil: event.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("adminEventRegistration.audienceGrants.validUntilHint")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-scope">
                  {t("adminEventRegistration.audienceGrants.scopeLabel")}
                </Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    id="grant-scope"
                    checked={draft.scopeThisEvent}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, scopeThisEvent: checked }))
                    }
                  />
                  <span className="text-sm">
                    {draft.scopeThisEvent
                      ? t("adminEventRegistration.audienceGrants.scopeThis")
                      : t("adminEventRegistration.audienceGrants.scopeAll")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("adminEventRegistration.audienceGrants.scopeHint")}
                </p>
              </div>
            </div>

            {formError === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                {t("adminEventRegistration.audienceGrants.cancelAction")}
              </Button>
              <Button type="button" onClick={submit} disabled={save.isPending}>
                {t("adminEventRegistration.audienceGrants.saveAction")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminEventRegistration.audienceGrants.revokeAction")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventRegistration.audienceGrants.revokeConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventRegistration.audienceGrants.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>
              {t("adminEventRegistration.audienceGrants.revokeAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
