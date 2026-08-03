// Organizm: sekcja audio wpisu. Dwie warstwy w kolejności pierwszeństwa:
//   1. wgrany plik MP3 (PL/EN) - wtedy ElevenLabs nie jest wołany w ogóle,
//   2. lektor AI z KANONICZNYM głosem wpisu (nadpisanie redakcyjne albo głos
//      najemcy) plus stan nagrania w prywatnym cache.
// Czytelnik nie wybiera ani głosu, ani modelu - na (wpis, język) istnieje
// dokładnie jedno nagranie (audyt 2026-08-03, amplifikacja kosztu TTS).
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { AudioPicker } from "@/components/admin/AudioPicker";
import { usePostTtsRenditions } from "@/lib/audio/ttsRenditions";
import type { TtsLang } from "@/lib/audio/ttsCanonical";
import { SectionCard } from "../atoms";
import { TtsVoiceCard } from "../molecules";
import type { PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function AudioSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  const { data: renditions } = usePostTtsRenditions(form?.id ?? null);
  if (!form) return null;

  const setVoice = (lang: TtsLang, voiceId: string | null) => {
    set(lang === "en" ? "tts_voice_en" : "tts_voice_pl", voiceId);
  };

  return (
    <SectionCard
      title={t("adminPostPanes.sections.audioTitle")}
      icon={Mic}
      description={t("adminPostPanes.sections.audioHint")}
      bodyClassName="p-4 space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
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
      </div>
      <TtsVoiceCard
        voicePl={form.tts_voice_pl}
        voiceEn={form.tts_voice_en}
        onVoiceChange={setVoice}
        renditions={renditions}
        uploadedPl={Boolean(form.audio_url_pl?.trim())}
        uploadedEn={Boolean(form.audio_url_en?.trim())}
      />
    </SectionCard>
  );
}
