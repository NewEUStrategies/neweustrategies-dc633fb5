// Admin: Biblioteka ikon - własne ikony, flagi, logotypy brandów.
// Per tenant; warianty light/dark; wybór domyślnego wariantu; hurtowy import.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, Search, Plus, Flag, Building2, Sparkles } from "@/lib/lucide-shim";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  listIcons, upsertIcon, deleteIcon, bulkImportIcons,
  uploadIconAsset, slugifyIconName,
  type IconKind, type IconRow, type IconVariant,
} from "@/lib/iconLibrary";

export const Route = createFileRoute("/admin/icons")({
  component: IconsAdmin,
  head: () => ({ meta: [{ title: "Ikony - Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  errorComponent: ({ error }) => <div role="alert" className="p-6">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">404</div>,
});

const KIND_TABS: { id: IconKind; icon: typeof Sparkles; labelKey: string }[] = [
  { id: "custom", icon: Sparkles, labelKey: "admin.icons.tabs.custom" },
  { id: "flag", icon: Flag, labelKey: "admin.icons.tabs.flag" },
  { id: "brand", icon: Building2, labelKey: "admin.icons.tabs.brand" },
];

function IconsAdmin() {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const [kind, setKind] = useState<IconKind>("custom");
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["icon-library", kind],
    queryFn: () => listIcons(kind),
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(needle) ||
      (r.label ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["icon-library", kind] });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("admin.icons.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.icons.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {KIND_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = kind === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setKind(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
                active
                  ? "border-brand text-brand font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <NewIconForm kind={kind} tenantId={tenantId} onCreated={refresh} />
      <BulkUpload kind={kind} tenantId={tenantId} onDone={refresh} />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("admin.icons.searchPlaceholder")}
              className="pl-8 h-9"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} / {rows.length}
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-md">
            {t("admin.icons.empty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((row) => (
              <IconCard
                key={row.id}
                row={row}
                tenantId={tenantId}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewIconForm({
  kind, tenantId, onCreated,
}: { kind: IconKind; tenantId: string; onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const slug = slugifyIconName(name);
    if (!slug) { toast.error(t("admin.icons.errors.nameRequired")); return; }
    setBusy(true);
    try {
      await upsertIcon(tenantId, { kind, name: slug, label: label || null });
      toast.success(t("admin.icons.created"));
      setName(""); setLabel("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="w-4 h-4" />
        {t("admin.icons.newTitle")}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("admin.icons.fields.name")}
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. nes_logo" className="h-9" />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("admin.icons.fields.label")}
          </Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("admin.icons.fields.labelPh")} className="h-9" />
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={busy} className="h-9">{busy ? "…" : t("admin.icons.add")}</Button>
        </div>
      </div>
    </div>
  );
}

function BulkUpload({
  kind, tenantId, onDone,
}: { kind: IconKind; tenantId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const res = await bulkImportIcons(tenantId, kind, Array.from(files));
      toast.success(t("admin.icons.bulk.done", { created: res.created, updated: res.updated }));
      if (res.errors.length) {
        toast.error(t("admin.icons.bulk.errors", { count: res.errors.length }));
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border p-4 flex items-center justify-between gap-3 bg-muted/30">
      <div className="flex items-start gap-3">
        <Upload className="w-5 h-5 text-muted-foreground mt-0.5" />
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{t("admin.icons.bulk.title")}</div>
          <div className="text-xs text-muted-foreground">
            {t("admin.icons.bulk.hint")}
          </div>
        </div>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
      <Button variant="outline" onClick={() => ref.current?.click()} disabled={busy} className="h-9 shrink-0">
        <Upload className="w-4 h-4 mr-1.5" />
        {busy ? t("admin.icons.bulk.uploading") : t("admin.icons.bulk.choose")}
      </Button>
    </div>
  );
}

function IconCard({
  row, tenantId, onChanged,
}: { row: IconRow; tenantId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(row.label ?? "");
  const [variant, setVariant] = useState<IconVariant>(row.default_variant);
  const [saving, setSaving] = useState(false);

  const save = async (overrides: Partial<IconRow> = {}) => {
    setSaving(true);
    try {
      await upsertIcon(tenantId, {
        id: row.id,
        kind: row.kind,
        name: row.name,
        label: overrides.label ?? label,
        url_default: overrides.url_default ?? row.url_default,
        url_light: overrides.url_light ?? row.url_light,
        url_dark: overrides.url_dark ?? row.url_dark,
        default_variant: overrides.default_variant ?? variant,
        position: row.position,
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    if (!confirm(t("admin.icons.confirmDelete", { name: row.name }))) return;
    try {
      await deleteIcon(row.id);
      toast.success(t("admin.icons.deleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium font-mono truncate">:{row.name}:</div>
          <div className="text-[11px] text-muted-foreground truncate">{row.label || row.name}</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive shrink-0"
          title={t("admin.icons.delete")}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <VariantSlot
          label={t("admin.icons.variants.default")}
          value={row.url_default}
          mode="auto"
          onUpload={async (url) => save({ url_default: url })}
          onClear={() => save({ url_default: "" })}
        />
        <VariantSlot
          label={t("admin.icons.variants.light")}
          value={row.url_light}
          mode="light"
          onUpload={async (url) => save({ url_light: url })}
          onClear={() => save({ url_light: "" })}
        />
        <VariantSlot
          label={t("admin.icons.variants.dark")}
          value={row.url_dark}
          mode="dark"
          onUpload={async (url) => save({ url_dark: url })}
          onClear={() => save({ url_dark: "" })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("admin.icons.fields.label")}
          </Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== (row.label ?? "") && save({ label })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("admin.icons.fields.defaultVariant")}
          </Label>
          <select
            value={variant}
            onChange={(e) => {
              const v = e.target.value as IconVariant;
              setVariant(v);
              save({ default_variant: v });
            }}
            disabled={saving}
            className="h-8 text-xs rounded-md border border-border bg-background px-2 w-full"
          >
            <option value="auto">{t("admin.icons.variants.auto")}</option>
            <option value="default">{t("admin.icons.variants.default")}</option>
            <option value="light">{t("admin.icons.variants.light")}</option>
            <option value="dark">{t("admin.icons.variants.dark")}</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function VariantSlot({
  label, value, mode, onUpload, onClear,
}: {
  label: string;
  value: string;
  mode: "auto" | "light" | "dark";
  onUpload: (url: string) => Promise<void>;
  onClear: () => void;
}) {
  const tenantId = useRequiredTenant();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (f: File | null | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const url = await uploadIconAsset(tenantId, "custom", f);
      await onUpload(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const bg = mode === "dark" ? "#131822" : mode === "light" ? "#f8f6f4" : undefined;

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full h-20 rounded-md border border-border flex items-center justify-center overflow-hidden hover:border-brand transition"
        style={{ background: bg ?? "transparent" }}
        title={value ? value : "Wgraj"}
      >
        {value
          ? <img src={value} alt={label} className="max-w-[80%] max-h-[80%] object-contain" />
          : <Upload className="w-4 h-4 text-muted-foreground" />}
      </button>
      <input
        ref={ref} type="file" accept="image/*" className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-muted-foreground hover:text-destructive w-full text-center"
          disabled={busy}
        >
          {busy ? "…" : "✕"}
        </button>
      )}
    </div>
  );
}
