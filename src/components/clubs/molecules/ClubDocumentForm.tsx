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
import {
  buildClubDocumentPayload,
  clubDocumentFormInvalid,
  clubDocumentUrlMissing,
} from "@/lib/clubs/workspaceForms";
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
import type { ClubDocumentInput } from "@/lib/clubs/workspaceApi";
import {
  CLUB_THREAD_DOCUMENT_KINDS as CLUB_DOCUMENT_KINDS,
  toClubDocumentKind,
  type ClubThreadDocumentKind as ClubDocumentKind,
  type ClubThreadDocumentRow,
} from "@/lib/clubs/workspaceTypes";

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

  const urlMissing = clubDocumentUrlMissing(kind, url);
  const invalid = clubDocumentFormInvalid(title, urlMissing);

  const submit = () => {
    if (invalid) return;
    // Pusty tekst jedzie jako `null` = "wyczyść", nie jako pusty string: pusty
    // string przeszedłby przez CHECK długości i został w bazie jako pozycja
    // bibliograficzna z wydawcą "". Składanie payloadu jest w warstwie `lib`.
    onSubmit(
      buildClubDocumentPayload(
        {
          kind,
          title,
          url,
          description,
          sourceLabel: source,
          publishedOn,
          isPrimary,
        },
        threadId,
        initial !== null ? initial.id : null,
        canCurate,
      ),
    );
  };

  return (
    <form
      className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-title">{t("club.workspace.documents.titleLabel")}</Label>
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
          <Label htmlFor="club-doc-kind">{t("club.workspace.documents.kindLabel")}</Label>
          <Select value={kind} onValueChange={(value) => setKind(toClubDocumentKind(value))}>
            <SelectTrigger id="club-doc-kind" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_DOCUMENT_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`club.workspace.documentKind.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="club-doc-published">{t("club.workspace.documents.publishedLabel")}</Label>
          <Input
            id="club-doc-published"
            type="date"
            className="mt-1"
            value={publishedOn}
            onChange={(event) => setPublishedOn(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("club.workspace.documents.publishedHint")}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-url">{t("club.workspace.documents.urlLabel")}</Label>
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
              {t("club.workspace.error.url_required")}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-source">{t("club.workspace.documents.sourceLabel")}</Label>
          <Input
            id="club-doc-source"
            className="mt-1"
            value={source}
            maxLength={160}
            placeholder={t("club.workspace.documents.sourcePlaceholder")}
            onChange={(event) => setSource(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-doc-desc">{t("club.workspace.documents.descriptionLabel")}</Label>
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
              {t("club.workspace.documents.primaryLabel")}
            </Label>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid}>
          {initial !== null ? t("club.workspace.save") : t("club.workspace.documents.add")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("club.workspace.cancel")}
        </Button>
      </div>
    </form>
  );
}
