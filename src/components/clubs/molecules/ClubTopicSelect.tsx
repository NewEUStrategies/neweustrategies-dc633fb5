// Molekuła: wybór obszaru tematycznego (klub albo wątek), z opcją "bez obszaru".
//
// Nie używamy tu generycznego `ClubEnumSelect`, bo ten zakłada wartość zawsze
// obecną. Obszar jest opcjonalny - klub bez tematyki wciąż jest poprawny i ląduje
// w zakładce "wszystkie" na hubie, więc select musi umieć wrócić do pustki.
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
  CLUB_TOPICS,
  CLUB_TOPIC_NONE,
  normalizeClubTopic,
  type ClubTopic,
} from "@/lib/clubs/policyAreas";

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
  onChange: (value: ClubTopic | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const current = normalizeClubTopic(value);

  return (
    <div className="space-y-1.5">
      {label !== undefined ? (
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      ) : null}
      <Select
        value={current ?? CLUB_TOPIC_NONE}
        onValueChange={(next) => onChange(normalizeClubTopic(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("club.topic.none")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CLUB_TOPIC_NONE}>{t("club.topic.none")}</SelectItem>
          {CLUB_TOPICS.map((topic) => (
            <SelectItem key={topic} value={topic}>
              {t(`club.topic.${topic}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
