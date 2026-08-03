// Atom: wybór KANONICZNEGO głosu lektora AI z allowlisty TTS_VOICES.
//
// Jedna kontrolka obsługuje dwie powierzchnie panelu:
//   * ustawienia najemcy (Czytanie -> Lektor AI) - wartość obowiązkowa,
//   * sekcja Audio edytora wpisu - wartość opcjonalna, gdzie puste = dziedzicz
//     głos najemcy (`inheritLabel` włącza tę opcję).
// Etykiety barw głosu są i18n (PL/EN); nazwy własne głosów pochodzą od
// dostawcy i nie są tłumaczone.
import { useTranslation } from "react-i18next";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import { TTS_VOICES } from "@/lib/audio/ttsCanonical";
// Nakładka i18n lektora jest importowana TYLKO tutaj, celowo: to jedyny moduł,
// który renderują OBIE powierzchnie tych kluczy (panel Czytanie i sekcja Audio
// edytora), więc jeden importer trzyma jej ciągi w chunku admin-only.
// Dopisanie tego importu w kolejnym module sprawia, że Rollup wypycha nakładkę
// do WSPÓLNEGO rodzica obu chunków - czyli do entry czytelnika (zmierzone:
// +0,8 KB w `index.js`). Nowa powierzchnia tych kluczy powinna renderować ten
// atom albo dostać własną nakładkę.
import "@/lib/i18n-admin-tts";

interface TtsVoiceSelectBaseProps {
  /** Dostępna nazwa kontrolki - pole ustawień nie ma własnego <label for>. */
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Warianty rozłączne, żeby typ wymuszał spójność: bez `inheritLabel` wartość
 * nigdy nie jest pusta, a `onChange` nigdy nie dostanie null.
 */
export type TtsVoiceSelectProps = TtsVoiceSelectBaseProps &
  (
    | { inheritLabel?: undefined; value: string; onChange: (voiceId: string) => void }
    | { inheritLabel: string; value: string | null; onChange: (voiceId: string | null) => void }
  );

export function TtsVoiceSelect(props: TtsVoiceSelectProps) {
  const { t } = useTranslation();
  const { ariaLabel, className = "h-10 text-sm w-full", disabled } = props;
  const inheritable = props.inheritLabel !== undefined;

  return (
    <AdminSelect
      value={props.value ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        if (props.inheritLabel !== undefined) {
          props.onChange(next === "" ? null : next);
        } else if (next !== "") {
          props.onChange(next);
        }
      }}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      {inheritable ? <option value="">{props.inheritLabel}</option> : null}
      {TTS_VOICES.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {`${voice.name} - ${t(`admin.reading.ttsTimbre.${voice.timbre}`)}`}
        </option>
      ))}
    </AdminSelect>
  );
}
