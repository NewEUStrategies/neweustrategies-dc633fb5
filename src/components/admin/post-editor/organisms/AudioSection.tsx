// Organizm: sekcja audio wpisu (MP3 PL/EN z fallbackiem do lektora AI).
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { AudioPicker } from "@/components/admin/AudioPicker";
import { SectionCard } from "../atoms";
import type { PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function AudioSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <SectionCard
      title={t("adminPostPanes.sections.audioTitle")}
      icon={Mic}
      description={t("adminPostPanes.sections.audioHint")}
      bodyClassName="p-4 grid md:grid-cols-2 gap-4"
    >
      <AudioPicker
        label={t("adminPostPanes.sections.audioPlLabel")}
        value={form.audio_url_pl ?? ""}
        onChange={(v: string) => set("audio_url_pl", v || null)}
        hint={t("adminPostPanes.sections.audioPlHint")}
      />
      <AudioPicker
        label={t("adminPostPanes.sections.audioEnLabel")}
        value={form.audio_url_en ?? ""}
        onChange={(v: string) => set("audio_url_en", v || null)}
        hint={t("adminPostPanes.sections.audioEnHint")}
      />
    </SectionCard>
  );
}
