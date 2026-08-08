// Molekuła: formularz źródła (dodanie i redakcja jednym komponentem).
//
// JEDEN formularz na obie operacje, bo pola są identyczne, a dwa komponenty
// rozjeżdżają się przy pierwszym nowym polu - wtedy "dodaj" i "edytuj"
// przyjmują różne zestawy danych i tylko jedna ścieżka jest przetestowana.
//
// Wymóg adresu jest sprawdzany PRZED wysyłką (`clubDocumentNeedsUrl`), bo
// CHECK bazy odrzuciłby zapis dopiero po utracie tego, co użytkownik wpisał.
// Reguła ma jedno źródło prawdy - słownik w `workspaceTypes`, wyprowadzony
// z tego samego CHECK-a.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClubDocumentInput } from "@/lib/clubs/threadWorkspaceApi";
import {
  CLUB_DOCUMENT_KINDS,
  clubDocumentNeedsUrl,
  toClubDocumentKind,
  type ClubDocumentKind,
  type ClubThreadDocumentRow,
} from "@/lib/clubs/threadWorkspaceTypes";

export function ClubDocumentForm({
  threadId,
  initial,
  canCurate,
  pending,
  onCancel,
  onSubmit,
}: {
  threadId: string;
  /** `null` = nowa pozycja. */
  initial: ClubThreadDocumentRow | null;
  /** Wyróżnienie „to jest TEN dokument" jest aktem kuratorskim - baza i tak
   *  je zignoruje bez uprawnienia, więc przełącznik ma się wtedy nie pokazywać. */
  canCurate: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: ClubDocumentInput) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ClubDocumentKind>(toClubDocumentKind(initial?.kind));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [source, setSource] = useState(initial?.source_label ?? "");
  const [publishedOn, setPublishedOn] = useState(initial?.published_on ?? "");
  const [isPrimary, setIsPrimary] = useState(initial?.is_primary ?? false);

  const urlMissing = clubDocumentNeedsUrl(kind) && url.trim().length === 0;
  const invalid = title.trim().length < 3 || urlMissing;

  const submit = () => {
    if (invalid) return;
    onSubmit({
      ...(initial !== null ? { id: initial.id } : {}),
      thread_id: threadId,
      kind,
      title: title.trim(),
      // Pusty tekst jedzie jako `null` = "wyczyść", nie jako pusty string:
      // pusty string przeszedłby przez CHECK długości i został w bazie jako
      // pozycja bibliograficzna z wydawcą "".
      url: url.trim().length > 0 ? url.trim() : null,
      description: description.trim().length > 0 ? description.trim() : null,
      source_label: source.trim().length > 0 ? source.trim() : null,
      published_on: publishedOn.length > 0 ? publishedOn : null,
      ...(canCurate ? { is_primary: isPrimary } : {}),
    });
  };

  return (
    <form
      className="rounded-lg border border-border/60 bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-title">{t("club.threadHub.documents.titleLabel")}</Label>
          <Input
            id="club-doc-title"
            className="mt-1"
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="club-doc-kind">{t("club.threadHub.documents.kindLabel")}</Label>
          <Select value={kind} onValueChange={(value) => setKind(toClubDocumentKind(value))}>
            <SelectTrigger id="club-doc-kind" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_DOCUMENT_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`club.threadHub.documentKind.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="club-doc-published">{t("club.threadHub.documents.publishedLabel")}</Label>
          <Input
            id="club-doc-published"
            type="date"
            className="mt-1"
            value={publishedOn}
            onChange={(event) => setPublishedOn(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("club.threadHub.documents.publishedHint")}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-url">{t("club.threadHub.documents.urlLabel")}</Label>
          <Input
            id="club-doc-url"
            type="url"
            inputMode="url"
            className="mt-1"
            value={url}
            maxLength={2000}
            aria-invalid={urlMissing}
            aria-describedby={urlMissing ? "club-doc-url-error" : undefined}
            onChange={(event) => setUrl(event.target.value)}
          />
          {urlMissing ? (
            <p id="club-doc-url-error" className="mt-1 text-[11px] text-destructive">
              {t("club.threadHub.error.url_required")}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-source">{t("club.threadHub.documents.sourceLabel")}</Label>
          <Input
            id="club-doc-source"
            className="mt-1"
            value={source}
            maxLength={160}
            placeholder={t("club.threadHub.documents.sourcePlaceholder")}
            onChange={(event) => setSource(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-desc">{t("club.threadHub.documents.descriptionLabel")}</Label>
          <Textarea
            id="club-doc-desc"
            className="mt-1"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {canCurate ? (
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="club-doc-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
            <Label htmlFor="club-doc-primary" className="text-sm font-normal">
              {t("club.threadHub.documents.primaryLabel")}
            </Label>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid}>
          {initial !== null ? t("club.threadHub.save") : t("club.threadHub.documents.add")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("club.threadHub.cancel")}
        </Button>
      </div>
    </form>
  );
}
