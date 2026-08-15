// Panel biblioteki materiałów członkowskich: metadane w member_resources,
// pliki w prywatnym buckecie Storage 'member-resources'. Upload + publikacja
// (Switch inline), bramka rangi warstwy (min_tier_rank), podmiana pliku w
// edycji (nowy obiekt najpierw, jeden UPDATE metadanych, stary obiekt schodzi
// best-effort po sukcesie), usuwanie (metadane + obiekt storage). Publiczne
// pobranie idzie osobno przez server fn z podpisanym URL-em; tutaj tylko
// zarządzanie (staff, RLS).
import { useMemo, useState, type ChangeEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-library";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Library, Upload, Plus, Save, Trash2, FileText, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  fetchAdminResources,
  uploadResourceFile,
  createResource,
  updateResource,
  deleteResource,
  removeResourceObject,
  type MemberResourceRow,
  type ResourceCategory,
  type ResourceFilePatch,
  type ResourceInput,
} from "@/lib/admin/library";
import { useMembershipTiers, tierName, type MembershipTierRow } from "@/lib/billing/tiers";

export const Route = createFileRoute("/admin/library")({
  component: AdminLibraryPage,
});

type Lang = "pl" | "en";

const CATEGORIES: ResourceCategory[] = ["report", "brief", "transcript", "slides", "data", "other"];

const CATEGORY_LABELS: Record<ResourceCategory, [string, string]> = {
  report: ["Raport", "Report"],
  brief: ["Briefing", "Brief"],
  transcript: ["Transkrypcja", "Transcript"],
  slides: ["Slajdy", "Slides"],
  data: ["Dane", "Data"],
  other: ["Inne", "Other"],
};

function categoryLabel(cat: string, lang: Lang): string {
  const pair = CATEGORY_LABELS[cat as ResourceCategory] ?? CATEGORY_LABELS.other;
  return lang === "pl" ? pair[0] : pair[1];
}

/** Rozmiar w B/KB/MB/GB (jednostki binarne). */
function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

// Stan formularza metadanych (współdzielony przez dialog Nowy / Edytuj).
interface ResourceForm {
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  category: ResourceCategory;
  min_tier_rank: number;
  sort_order: number;
  published: boolean;
}

const DEFAULT_TIER_RANK = 10;

function emptyForm(): ResourceForm {
  return {
    title_pl: "",
    title_en: "",
    description_pl: "",
    description_en: "",
    category: "report",
    min_tier_rank: DEFAULT_TIER_RANK,
    sort_order: 0,
    published: true,
  };
}

export function AdminLibraryPage() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();

  const resourcesQ = useQuery({
    queryKey: ["admin", "member-resources"],
    queryFn: fetchAdminResources,
  });
  const tiersQ = useMembershipTiers();

  const tierOptions = useMemo<MembershipTierRow[]>(
    () =>
      (tiersQ.data ?? [])
        .filter((t) => t.active)
        .slice()
        .sort((a, b) => a.rank - b.rank),
    [tiersQ.data],
  );

  const rankLabel = (rank: number): string => {
    // `tier`, nie `t` - lokalna zmienna przesłaniała funkcję tłumaczącą.
    const tier = (tiersQ.data ?? []).find((x) => x.rank === rank);
    return tier ? tierName(tier, lang) : t("adminLibrary.rank", { rank });
  };

  // Publikacja inline z optymistyczną aktualizacją cache (natychmiastowy Switch).
  const setPublished = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      updateResource(id, { published }),
    onMutate: async ({ id, published }) => {
      await qc.cancelQueries({ queryKey: ["admin", "member-resources"] });
      const prev = qc.getQueryData<MemberResourceRow[]>(["admin", "member-resources"]);
      qc.setQueryData<MemberResourceRow[]>(["admin", "member-resources"], (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, published } : r)),
      );
      return { prev };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin", "member-resources"], ctx.prev);
      toast.error(e instanceof Error ? e.message : t("adminLibrary.couldSave"));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "member-resources"] });
    },
  });

  const removeResource = useMutation({
    mutationFn: ({ id, filePath }: { id: string; filePath: string | null }) =>
      deleteResource(id, filePath),
    onSuccess: () => {
      toast.success(t("adminLibrary.resourceDeleted"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-resources"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("adminLibrary.couldDelete")),
  });

  const rows = resourcesQ.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Library className="h-6 w-6" aria-hidden="true" />
            {t("adminLibrary.membersLibrary")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("adminLibrary.filesGoPrivateStorageBucket")}
          </p>
        </div>
        <NewResourceDialog lang={lang} tierOptions={tierOptions} />
      </header>

      {resourcesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("adminLibrary.loading")}</p>
      ) : resourcesQ.isError ? (
        <p className="text-sm text-destructive">{t("adminLibrary.couldLoadResources")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-8 text-center text-sm text-muted-foreground">
          {t("adminLibrary.noResourcesYet")}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <FileText
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {lang === "pl" ? r.title_pl : r.title_en}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {categoryLabel(r.category, lang)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        {rankLabel(r.min_tier_rank)}
                      </span>
                      <span className="tabular-nums">{formatBytes(r.file_size)}</span>
                      <span className="tabular-nums">
                        {t("adminLibrary.downloads")}: {r.download_count}
                      </span>
                      <span className="truncate font-mono opacity-70">{r.file_name}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={r.published}
                      onCheckedChange={(v) => setPublished.mutate({ id: r.id, published: v })}
                      aria-label={t("adminLibrary.published")}
                    />
                    <span className="text-xs text-muted-foreground">
                      {r.published ? t("adminLibrary.published") : t("adminLibrary.hidden")}
                    </span>
                  </div>
                  <EditResourceDialog lang={lang} tierOptions={tierOptions} row={r} />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={t("adminLibrary.deleteResource")}
                    disabled={removeResource.isPending}
                    onClick={() => {
                      const title = lang === "pl" ? r.title_pl : r.title_en;
                      if (confirm(t("adminLibrary.confirmDeleteResource", { title }))) {
                        removeResource.mutate({ id: r.id, filePath: r.file_path });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Współdzielone pola metadanych (tytuł/opis PL+EN, kategoria, warstwa, kolejność,
// publikacja). Nie obejmuje pliku - uploadem zajmują się dialogi: Nowy materiał
// (plik wymagany) i Edytuj (opcjonalna podmiana).
// ---------------------------------------------------------------------------
function ResourceFields({
  lang,
  value,
  onChange,
  tierOptions,
}: {
  lang: Lang;
  value: ResourceForm;
  onChange: (patch: Partial<ResourceForm>) => void;
  tierOptions: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">
            {t("adminLibrary.titlePl")} <span className="text-destructive">*</span>
          </Label>
          <Input value={value.title_pl} onChange={(e) => onChange({ title_pl: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">
            {t("adminLibrary.titleEn")} <span className="text-destructive">*</span>
          </Label>
          <Input value={value.title_en} onChange={(e) => onChange({ title_en: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">{t("adminLibrary.descriptionPl")}</Label>
          <Textarea
            rows={2}
            value={value.description_pl}
            onChange={(e) => onChange({ description_pl: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">{t("adminLibrary.descriptionEn")}</Label>
          <Textarea
            rows={2}
            value={value.description_en}
            onChange={(e) => onChange({ description_en: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">{t("adminLibrary.category")}</Label>
          <Select
            value={value.category}
            onValueChange={(v) => onChange({ category: v as ResourceCategory })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryLabel(c, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("adminLibrary.requiredTier")}</Label>
          <Select
            value={String(value.min_tier_rank)}
            onValueChange={(v) => onChange({ min_tier_rank: Number(v) })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("adminLibrary.selectTier")} />
            </SelectTrigger>
            <SelectContent>
              {tierOptions.map((t) => (
                <SelectItem key={t.id} value={String(t.rank)}>
                  {t.rank} · {tierName(t, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("adminLibrary.rank0AnySignedUser")}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">{t("adminLibrary.sortOrder")}</Label>
          <Input
            type="number"
            value={value.sort_order}
            onChange={(e) => onChange({ sort_order: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            checked={value.published}
            onCheckedChange={(v) => onChange({ published: v })}
            aria-label={t("adminLibrary.published")}
          />
          <span className="text-xs">{t("adminLibrary.published")}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog: nowy materiał - upload pliku do prywatnego bucketu + metadane.
// ---------------------------------------------------------------------------
function NewResourceDialog({
  lang,
  tierOptions,
}: {
  lang: Lang;
  tierOptions: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ResourceForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: (f: File) => uploadResourceFile(f),
    onError: (e: unknown) => {
      setFile(null);
      toast.error(e instanceof Error ? e.message : t("adminLibrary.uploadFailed"));
    },
  });

  const reset = () => {
    setForm(emptyForm());
    setFile(null);
    upload.reset();
  };

  const create = useMutation({
    mutationFn: (input: ResourceInput) => createResource(input),
    onSuccess: () => {
      toast.success(t("adminLibrary.resourceAdded"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-resources"] });
      reset();
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("adminLibrary.couldSave")),
  });

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    upload.reset();
    if (f) upload.mutate(f);
  };

  const canSubmit =
    form.title_pl.trim().length > 0 &&
    form.title_en.trim().length > 0 &&
    file !== null &&
    upload.data !== undefined &&
    !upload.isPending &&
    !create.isPending;

  const submit = () => {
    if (!canSubmit || !file || !upload.data) return;
    create.mutate({
      title_pl: form.title_pl.trim(),
      title_en: form.title_en.trim(),
      description_pl: form.description_pl.trim() || null,
      description_en: form.description_en.trim() || null,
      category: form.category,
      file_path: upload.data.path,
      file_name: file.name,
      file_size: upload.data.size,
      mime_type: file.type || null,
      min_tier_rank: form.min_tier_rank,
      published: form.published,
      sort_order: form.sort_order,
    });
  };

  // Wspólna ścieżka zamykania: przycisk Anuluj MUSI przechodzić tędy (a nie
  // przez samo setOpen), inaczej wgrany obiekt bez wiersza metadanych zostaje
  // w buckecie na zawsze.
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      reset();
    } else if (upload.data && !create.isPending) {
      // Zamknięcie bez zapisu: upload nie ma wiersza metadanych - sprzątamy.
      void removeResourceObject(upload.data.path);
      reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminLibrary.newResource")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("adminLibrary.newResource")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t("adminLibrary.file")} <span className="text-destructive">*</span>
            </Label>
            <input
              type="file"
              onChange={onPick}
              aria-label={t("adminLibrary.chooseFileUpload")}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {upload.isPending ? (
              <p className="text-xs text-muted-foreground">{t("adminLibrary.uploading")}</p>
            ) : upload.data && file ? (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Upload className="h-3 w-3" aria-hidden="true" />
                {file.name} · {formatBytes(upload.data.size)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("adminLibrary.pickFileUploadsPrivateBucket")}
              </p>
            )}
          </div>

          <ResourceFields
            lang={lang}
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            tierOptions={tierOptions}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("adminLibrary.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminLibrary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog: edycja materiału - metadane + opcjonalna podmiana pliku.
// Kolejność podmiany gwarantuje spójność bez transakcji po stronie klienta:
//   1. nowy obiekt idzie do bucketu (stary wciąż obsługuje pobrania),
//   2. jeden UPDATE metadanych przełącza file_path/name/size/mime atomowo,
//   3. dopiero po sukcesie stary obiekt schodzi best-effort; porzucenie
//      dialogu sprząta osierocony upload zamiast zostawiać śmieci w buckecie.
// Licznik pobrań i historia (resource_downloads) zostają - podmieniamy plik,
// nie tożsamość materiału.
// ---------------------------------------------------------------------------

/** Świeżo wgrany, jeszcze niezapisany plik podmiany. */
interface PendingReplacement {
  path: string;
  name: string;
  size: number;
  mime: string | null;
}

function EditResourceDialog({
  lang,
  tierOptions,
  row,
}: {
  lang: Lang;
  tierOptions: MembershipTierRow[];
  row: MemberResourceRow;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<PendingReplacement | null>(null);

  const formFromRow = (): ResourceForm => ({
    title_pl: row.title_pl,
    title_en: row.title_en,
    description_pl: row.description_pl ?? "",
    description_en: row.description_en ?? "",
    category: row.category as ResourceCategory,
    min_tier_rank: row.min_tier_rank,
    sort_order: row.sort_order,
    published: row.published,
  });

  const [form, setForm] = useState<ResourceForm>(formFromRow);

  const upload = useMutation({
    mutationFn: async (f: File): Promise<PendingReplacement> => {
      const res = await uploadResourceFile(f);
      return { path: res.path, name: f.name, size: res.size, mime: f.type || null };
    },
    onSuccess: (uploaded) => {
      // Poprzedni niezapisany upload jest już osierocony - sprzątamy od razu.
      if (pendingFile) void removeResourceObject(pendingFile.path);
      setPendingFile(uploaded);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("adminLibrary.uploadFailed")),
  });

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    // Czyścimy input, żeby ponowny wybór tego samego pliku znów odpalił change.
    e.target.value = "";
    if (f) upload.mutate(f);
  };

  const cancelReplacement = () => {
    if (pendingFile) void removeResourceObject(pendingFile.path);
    setPendingFile(null);
    upload.reset();
  };

  const update = useMutation({
    mutationFn: () => {
      // Metadane i (ewentualna) podmiana pliku w JEDNYM update - wiersz nigdy
      // nie wskazuje pliku "w połowie podmienionego".
      const filePatch: Partial<ResourceFilePatch> = pendingFile
        ? {
            file_path: pendingFile.path,
            file_name: pendingFile.name,
            file_size: pendingFile.size,
            mime_type: pendingFile.mime,
          }
        : {};
      return updateResource(row.id, {
        title_pl: form.title_pl.trim(),
        title_en: form.title_en.trim(),
        description_pl: form.description_pl.trim() || null,
        description_en: form.description_en.trim() || null,
        category: form.category,
        min_tier_rank: form.min_tier_rank,
        sort_order: form.sort_order,
        published: form.published,
        ...filePatch,
      });
    },
    onSuccess: () => {
      // Wiersz wskazuje już nowy plik - stary obiekt schodzi best-effort.
      if (pendingFile && row.file_path && row.file_path !== pendingFile.path) {
        void removeResourceObject(row.file_path);
      }
      setPendingFile(null);
      upload.reset();
      toast.success(t("adminLibrary.changesSaved"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-resources"] });
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("adminLibrary.couldSave")),
  });

  const busy = upload.isPending || update.isPending;
  const canSubmit = form.title_pl.trim().length > 0 && form.title_en.trim().length > 0 && !busy;

  // Wspólna ścieżka zamykania: przycisk Anuluj MUSI przechodzić tędy (a nie
  // przez samo setOpen), inaczej niezapisana podmiana osieroca obiekt w buckecie.
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      setForm(formFromRow());
      setPendingFile(null);
      upload.reset();
    } else if (pendingFile && !update.isPending) {
      // Zamknięcie bez zapisu: świeżo wgrany obiekt byłby osierocony.
      cancelReplacement();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={t("adminLibrary.editResource")}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("adminLibrary.editResource")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("adminLibrary.file")}</Label>
            <div className="space-y-1 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <p
                className={`flex items-center gap-1.5 ${pendingFile ? "line-through opacity-60" : ""}`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono">{row.file_name}</span>
                <span className="shrink-0">· {formatBytes(row.file_size)}</span>
              </p>
              {pendingFile && (
                <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate font-mono">{pendingFile.name}</span>
                  <span className="shrink-0">· {formatBytes(pendingFile.size)}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                onChange={onPick}
                disabled={busy}
                aria-label={t("adminLibrary.chooseReplacementFile")}
                className="block w-full min-w-0 flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
              />
              {pendingFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelReplacement}
                  disabled={busy}
                >
                  {t("adminLibrary.keepCurrentFile")}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {upload.isPending
                ? t("adminLibrary.uploading")
                : pendingFile
                  ? t("adminLibrary.newFileReplacesCurrentOne")
                  : t("adminLibrary.canReplaceFileDownloadCounter")}
            </p>
          </div>
          <ResourceFields
            lang={lang}
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            tierOptions={tierOptions}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("adminLibrary.cancel")}
          </Button>
          <Button onClick={() => update.mutate()} disabled={!canSubmit}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminLibrary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
