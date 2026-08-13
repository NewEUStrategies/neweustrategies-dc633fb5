// Molekuła: wybór obszaru tematycznego (klub albo wątek), z opcją "bez obszaru".
//
// Lista pochodzi z katalogu organizacji (`club_topics`), a nie z zaszytej
// tablicy - redakcja może dodać własny obszar i wyłączyć taki, którego nie
// używa. Jeśli edytowany wpis ma obszar w międzyczasie wyłączony, opcja i tak
// wraca do listy: inaczej pierwszy zapis po cichu skasowałby przypisanie.
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  CLUB_TOPIC_NONE,
  normalizeTopicValue,
  optionsWithCurrent,
  topicLabel,
} from "@/lib/clubs/topicCatalog";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { uiLang } from "@/lib/i18n/format";

export function ClubTopicSelect({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  label?: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics } = useClubTopics();
  const current = normalizeTopicValue(value);
  const options = optionsWithCurrent(topics, current, lang);

  return (
    <div className="space-y-1.5">
      {label !== undefined ? (
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      ) : null}
      <Select
        value={current ?? CLUB_TOPIC_NONE}
        onValueChange={(next) => onChange(normalizeTopicValue(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("club.topic.none")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CLUB_TOPIC_NONE}>{t("club.topic.none")}</SelectItem>
          {options.map((topic) => (
            <SelectItem key={topic.key} value={topic.key}>
              {topicLabel(topic.key, lang, options)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
