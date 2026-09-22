// Molekuła: wybór przekierowania logotypu (szczegóły wystawcy / zewnętrzny URL / bez linku).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SPONSOR_LINK_MODES,
  isHttpsUrl,
  toLinkMode,
  type SponsorLink,
} from "@/lib/events/sponsorBoardApi";
import "@/lib/i18n-admin-event-sponsor-board";

export function SponsorRedirectField({
  id,
  value,
  isSaving,
  onSave,
}: {
  id: string;
  value: SponsorLink;
  isSaving: boolean;
  onSave: (link: SponsorLink) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SponsorLink>(value);
  useEffect(() => setDraft(value), [value]);

  const urlInvalid = draft.mode === "external" && !isHttpsUrl(draft.url);
  const dirty = draft.mode !== value.mode || draft.url !== value.url;

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-mode`}>{t("sponsorBoard.redirect.label")}</Label>
      <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: toLinkMode(v) })}>
        <SelectTrigger id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPONSOR_LINK_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`sponsorBoard.redirect.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {draft.mode === "external" ? (
        <div className="space-y-1">
          <Label htmlFor={`${id}-url`} className="text-xs">
            {t("sponsorBoard.redirect.urlLabel")}
          </Label>
          <Input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            value={draft.url}
            aria-invalid={urlInvalid}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          {urlInvalid && draft.url !== "" ? (
            <p className="text-xs text-destructive">{t("sponsorBoard.redirect.urlInvalid")}</p>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!dirty || urlInvalid || isSaving}
        onClick={() => onSave(draft)}
      >
        {t("sponsorBoard.redirect.save")}
      </Button>
    </div>
  );
}
