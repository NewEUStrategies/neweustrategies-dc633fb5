import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/content-area")({ component: Page });

function Page() {
  const { t } = useTranslation();
  const { data } = usePostLayoutSettings();
  const save = useSavePostLayoutSettings();
  const [local, setLocal] = useState<PostLayoutSettings | null>(null);
  useEffect(() => { if (data && !local) setLocal(data); }, [data, local]);
  if (!local) return <AdminShell hideSidebar><div className="p-6">{t("admin.loading")}</div></AdminShell>;

  const upd = (p: Partial<PostLayoutSettings>) => setLocal({ ...local, ...p });
  const onSave = async () => {
    const { tenant_id, ...rest } = local;
    void tenant_id;
    await save.mutateAsync(rest);
    toast.success(t("admin.saved"));
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
  const ipt = "w-full px-3 py-2 rounded border border-input bg-background text-sm";

  return (
    <AdminShell hideSidebar>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl">{t("admin.contentArea.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("admin.contentArea.subtitle")}</p>
          </div>
          <button onClick={onSave} className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">{t("admin.save")}</button>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("admin.contentArea.width")}</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t("admin.contentArea.withSidebar")}><input type="number" value={local.has_sidebar_max_width} onChange={(e) => upd({ has_sidebar_max_width: Number(e.target.value) })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.noSidebar")}><input type="number" value={local.no_sidebar_max_width} onChange={(e) => upd({ no_sidebar_max_width: Number(e.target.value) })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.wideMax")}><input type="number" value={local.wide_align_max_width} onChange={(e) => upd({ wide_align_max_width: Number(e.target.value) })} className={ipt} /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("admin.contentArea.paragraphs")}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t("admin.contentArea.paragraphSpacing")}><input type="number" step="0.1" value={local.paragraph_spacing_rem} onChange={(e) => upd({ paragraph_spacing_rem: Number(e.target.value) })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.listStyle")}>
              <select value={local.list_style} onChange={(e) => upd({ list_style: e.target.value })} className={ipt}>
                <option value="disc">Disc</option><option value="circle">Circle</option><option value="square">Square</option><option value="none">None</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("admin.contentArea.hyperlinks")}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t("admin.contentArea.style")}>
              <select value={local.hyperlink_style} onChange={(e) => upd({ hyperlink_style: e.target.value })} className={ipt}>
                <option value="normal">Normal</option><option value="bold">Bold</option><option value="italic">Italic</option><option value="bold-italic">Bold + Italic</option>
              </select>
            </Field>
            <Field label={t("admin.contentArea.underline")}>
              <select value={local.hyperlink_underline ? "1" : "0"} onChange={(e) => upd({ hyperlink_underline: e.target.value === "1" })} className={ipt}>
                <option value="1">{t("admin.contentArea.on")}</option><option value="0">{t("admin.contentArea.off")}</option>
              </select>
            </Field>
            <Field label={t("admin.contentArea.linkColorLight")}><input type="text" placeholder="#... lub hsl(...)" value={local.hyperlink_color ?? ""} onChange={(e) => upd({ hyperlink_color: e.target.value || null })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.linkColorDark")}><input type="text" value={local.hyperlink_color_dark ?? ""} onChange={(e) => upd({ hyperlink_color_dark: e.target.value || null })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.underlineColorLight")}><input type="text" value={local.underline_color ?? ""} onChange={(e) => upd({ underline_color: e.target.value || null })} className={ipt} /></Field>
            <Field label={t("admin.contentArea.underlineColorDark")}><input type="text" value={local.underline_color_dark ?? ""} onChange={(e) => upd({ underline_color_dark: e.target.value || null })} className={ipt} /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("admin.contentArea.imageCaption")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={local.image_caption_left_border} onChange={(e) => upd({ image_caption_left_border: e.target.checked })} />
            {t("admin.contentArea.imageCaptionToggle")}
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("admin.contentArea.quickView")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={local.quick_view_info} onChange={(e) => upd({ quick_view_info: e.target.checked })} />
            {t("admin.contentArea.quickViewToggle")}
          </label>
        </section>
      </div>
    </AdminShell>
  );
}
