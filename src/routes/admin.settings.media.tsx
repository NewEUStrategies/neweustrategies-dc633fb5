import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, NumberInput, SaveBar } from "@/components/admin/settings/fields";

type Media = {
  thumbnail_w: number; thumbnail_h: number;
  medium_w: number; medium_h: number;
  large_w: number; large_h: number;
};

const DEFAULTS: Media = { thumbnail_w: 150, thumbnail_h: 150, medium_w: 768, medium_h: 768, large_w: 1536, large_h: 1536 };

export const Route = createFileRoute("/admin/settings/media")({
  component: MediaSettings,
});

function MediaSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<Media>("media", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Media>(k: K, v: Media[K]) => setDraft({ ...draft, [k]: v });

  const Pair = ({ label, w, h }: { label: string; w: keyof Media; h: keyof Media }) => (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">{t("admin.mediaSizes.w")}</label>
        <NumberInput value={draft[w]} min={1} onChange={(e) => set(w, Number(e.target.value))} />
        <label className="text-xs text-muted-foreground">{t("admin.mediaSizes.h")}</label>
        <NumberInput value={draft[h]} min={1} onChange={(e) => set(h, Number(e.target.value))} />
        <span className="text-xs text-muted-foreground">px</span>
      </div>
    </Field>
  );

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.mediaSizes.title")}</h2>
      <Pair label={t("admin.mediaSizes.thumbnail")} w="thumbnail_w" h="thumbnail_h" />
      <Pair label={t("admin.mediaSizes.medium")} w="medium_w" h="medium_h" />
      <Pair label={t("admin.mediaSizes.large")} w="large_w" h="large_h" />
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
