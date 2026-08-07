// Redakcja własnego wpisu w miejscu.
//
// Autor mógł poprawić swój wpis od etapu A4 (`club_edit_thread`,
// `club_edit_reply`), ale w interfejsie nie było przycisku - jedyną drogą do
// literówki był panel moderacyjny, czyli poproszenie kogoś innego. Ten
// komponent domyka tę lukę i nic poza tym: nie ma tu uprawnień, nie ma
// wywołania RPC, jest formularz.
//
// Pole powodu pokazuje się WYŁĄCZNIE moderacji (`showReason`). Autor poprawia
// swoją literówkę i nie ma się przed kim tłumaczyć; moderator zmienia cudzy
// tekst i jego powód ląduje w dzienniku.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ClubInlineEditor({
  idPrefix,
  initialTitle,
  initialBody,
  showReason,
  pending,
  onCancel,
  onSave,
}: {
  idPrefix: string;
  /** `undefined` dla odpowiedzi - odpowiedź nie ma tytułu. */
  initialTitle?: string;
  initialBody: string;
  showReason: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (patch: { title?: string; body: string; reason: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState(initialBody);
  const [reason, setReason] = useState("");

  // Gdy zmieni się wpis pod spodem (np. moderator poprawił go równolegle),
  // formularz podąża za świeżą treścią zamiast trzymać kopię sprzed edycji.
  useEffect(() => {
    setTitle(initialTitle ?? "");
    setBody(initialBody);
  }, [initialTitle, initialBody]);

  const trimmed = body.trim();
  const titleChanged = initialTitle !== undefined && title.trim() !== initialTitle;
  const bodyChanged = trimmed !== initialBody.trim();
  const canSave =
    !pending &&
    trimmed.length >= 10 &&
    (bodyChanged || titleChanged) &&
    (initialTitle === undefined || title.trim().length >= 3);

  return (
    <div className="space-y-3">
      {initialTitle !== undefined ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-title`}>{t("club.editor.titleLabel")}</Label>
          <Input
            id={`${idPrefix}-title`}
            value={title}
            maxLength={200}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-body`}>{t("club.editor.bodyLabel")}</Label>
        <Textarea
          id={`${idPrefix}-body`}
          rows={6}
          maxLength={20000}
          value={body}
          disabled={pending}
          autoFocus
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      {showReason ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-reason`}>{t("club.editor.reasonLabel")}</Label>
          <Input
            id={`${idPrefix}-reason`}
            value={reason}
            maxLength={280}
            disabled={pending}
            placeholder={t("club.editor.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("club.editor.reasonHint")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({
              ...(initialTitle !== undefined ? { title: title.trim() } : {}),
              body: trimmed,
              reason: reason.trim() === "" ? null : reason.trim(),
            })
          }
        >
          {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("common.save")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
