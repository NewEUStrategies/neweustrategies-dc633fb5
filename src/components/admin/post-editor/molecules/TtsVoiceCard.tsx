// Molekuła: kanoniczny lektor AI wpisu - wybór głosu per język plus stan
// nagrania w prywatnym cache.
//
// Sens produktowy: głos jest decyzją REDAKCJI, nie czytelnika. Karta pokazuje
// wprost konsekwencję kosztową tej decyzji (jedno nagranie na język, licznik
// syntez), żeby zmiana głosu była świadoma, a nie przypadkowa. Komponent jest
// w pełni prezentacyjny - dane i zapis wstrzykuje organizm AudioSection.
import { useTranslation } from "react-i18next";
import { Headphones } from "@/lib/lucide-shim";
import { TtsVoiceSelect } from "@/components/admin/atoms/TtsVoiceSelect";
import { findTtsModel, findTtsVoice, type TtsLang } from "@/lib/audio/ttsCanonical";
import type { PostTtsRendition, PostTtsRenditionMap } from "@/lib/audio/ttsRenditions";

interface TtsVoiceCardProps {
  voicePl: string | null;
  voiceEn: string | null;
  onVoiceChange: (lang: TtsLang, voiceId: string | null) => void;
  /** Nagrania wpisu (klucz per język); brak wpisu = jeszcze nie syntezowano. */
  renditions: PostTtsRenditionMap | undefined;
  /** Wgrany MP3 per język - wtedy lektor AI nie jest wołany w ogóle. */
  uploadedPl: boolean;
  uploadedEn: boolean;
}

function formatBytes(bytes: number, locale: string): string {
  if (bytes <= 0) return "-";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} kB`;
}

function RenditionRow({ rendition, locale }: { rendition: PostTtsRendition; locale: string }) {
  const { t } = useTranslation();
  const voice = findTtsVoice(rendition.voice_id);
  const model = findTtsModel(rendition.model);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(rendition.synthesized_at));

  const cells: Array<{ label: string; value: string }> = [
    {
      label: t("adminPostPanes.sections.ttsRenditionVoice"),
      value: voice ? voice.name : rendition.voice_id,
    },
    {
      label: t("adminPostPanes.sections.ttsRenditionModel"),
      value: model ? t(`admin.reading.ttsModelTier.${model.tier}`) : rendition.model,
    },
    {
      label: t("adminPostPanes.sections.ttsRenditionSize"),
      value: formatBytes(rendition.byte_size, locale),
    },
    {
      label: t("adminPostPanes.sections.ttsRenditionChars"),
      value: new Intl.NumberFormat(locale).format(rendition.char_count),
    },
    {
      label: t("adminPostPanes.sections.ttsRenditionSynths"),
      value: new Intl.NumberFormat(locale).format(rendition.synth_count),
    },
    { label: t("adminPostPanes.sections.ttsRenditionWhen"), value: when },
  ];

  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</dt>
          <dd className="truncate text-[11px] font-medium text-foreground">{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LangColumn({
  lang,
  label,
  hint,
  value,
  onChange,
  rendition,
  uploaded,
  locale,
}: {
  lang: TtsLang;
  label: string;
  hint: string;
  value: string | null;
  onChange: (voiceId: string | null) => void;
  rendition: PostTtsRendition | undefined;
  uploaded: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const selectId = `tts-voice-${lang}`;
  // Redakcja właśnie zmieniła kanoniczny głos, a nagranie jest jeszcze stare:
  // mówimy to wprost, bo to jedna dodatkowa (płatna) synteza przy najbliższym
  // odsłuchaniu. Twierdzimy to WYŁĄCZNIE przy jawnym nadpisaniu - przy
  // dziedziczeniu edytor nie zna głosu najemcy, więc nie ma czego porównać.
  const voiceChanged = Boolean(value && rendition && rendition.voice_id !== value);
  return (
    <div className="min-w-0">
      <label htmlFor={selectId} className="mb-1 block text-xs font-semibold text-foreground">
        {label}
      </label>
      <TtsVoiceSelect
        value={value}
        onChange={onChange}
        inheritLabel={t("adminPostPanes.sections.ttsVoiceInherit")}
        ariaLabel={label}
        disabled={uploaded}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {uploaded ? t("adminPostPanes.sections.ttsRenditionUploadedNote") : hint}
      </p>
      {!uploaded && (
        <div className="mt-2 rounded-[6px] border border-border bg-muted/20 px-3 py-2">
          <p className="text-[11px] font-semibold text-foreground">
            {t("adminPostPanes.sections.ttsRenditionTitle")}
          </p>
          {rendition ? (
            <RenditionRow rendition={rendition} locale={locale} />
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("adminPostPanes.sections.ttsRenditionNone")}
            </p>
          )}
          {voiceChanged && (
            <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-500">
              {t("adminPostPanes.sections.ttsRenditionVoiceChanged")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TtsVoiceCard({
  voicePl,
  voiceEn,
  onVoiceChange,
  renditions,
  uploadedPl,
  uploadedEn,
}: TtsVoiceCardProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language ?? "pl").startsWith("en") ? "en-GB" : "pl-PL";

  return (
    <section className="rounded-[6px] border border-border bg-background p-4">
      <h4 className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
        <Headphones className="h-3.5 w-3.5 text-brand" aria-hidden />
        {t("adminPostPanes.sections.ttsVoiceTitle")}
      </h4>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {t("adminPostPanes.sections.ttsVoiceHint")}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <LangColumn
          lang="pl"
          label={t("adminPostPanes.sections.ttsVoicePlLabel")}
          hint={t("adminPostPanes.sections.ttsVoicePlHint")}
          value={voicePl}
          onChange={(v) => onVoiceChange("pl", v)}
          rendition={renditions?.pl}
          uploaded={uploadedPl}
          locale={locale}
        />
        <LangColumn
          lang="en"
          label={t("adminPostPanes.sections.ttsVoiceEnLabel")}
          hint={t("adminPostPanes.sections.ttsVoiceEnHint")}
          value={voiceEn}
          onChange={(v) => onVoiceChange("en", v)}
          rendition={renditions?.en}
          uploaded={uploadedEn}
          locale={locale}
        />
      </div>
    </section>
  );
}
