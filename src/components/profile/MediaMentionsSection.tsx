// Sekcja "Obecność w mediach" w /profile/author - własciciel (autor)
// zarządza swoimi wpisami `media_mentions` (cytat / wywiad / wystąpienie / oped /
// podcast_guest). Zapis idzie przez RLS "media_mentions owner manage", więc
// user CRUD-uje wyłącznie własne wiersze. Publiczny odczyt (huba eksperta)
// filtruje `is_public=true` osobną politykę.
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, ExternalLink, Save, Mic, Newspaper, Radio, MessageSquareQuote, FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Kind = "quote" | "interview" | "appearance" | "oped" | "podcast_guest";

interface Row {
  /** UUID z bazy - `null` dla świeżo dodanych, nieutrwalonych wierszy. */
  id: string | null;
  outlet: string;
  title: string;
  url: string | null;
  kind: Kind;
  language: string | null;
  published_on: string; // YYYY-MM-DD
  is_public: boolean;
  cover_url: string | null;
  _dirty: boolean;
  _saving: boolean;
}

/** Rodzaje wpisów, dla których pokazujemy pole na okładkę (obraz). */
const KINDS_WITH_COVER: readonly Kind[] = ["quote", "interview", "appearance"] as const;

const KIND_META: Record<Kind, { icon: typeof Mic; labelPl: string; labelEn: string }> = {
  quote: { icon: MessageSquareQuote, labelPl: "Cytat / komentarz", labelEn: "Quote / comment" },
  interview: { icon: Newspaper, labelPl: "Wywiad", labelEn: "Interview" },
  appearance: { icon: Radio, labelPl: "Wystąpienie", labelEn: "Appearance" },
  oped: { icon: FileText, labelPl: "Op-ed / artykuł", labelEn: "Op-ed / article" },
  podcast_guest: { icon: Mic, labelPl: "Gość w podcaście", labelEn: "Podcast guest" },
};

const today = () => new Date().toISOString().slice(0, 10);

function emptyRow(): Row {
  return {
    id: null,
    outlet: "",
    title: "",
    url: null,
    kind: "quote",
    language: null,
    published_on: today(),
    is_public: true,
    cover_url: null,
    _dirty: true,
    _saving: false,
  };
}

export function MediaMentionsSection({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("media_mentions")
      .select("id, outlet, title, url, kind, language, published_on, is_public, cover_url")
      .eq("user_id", userId)
      .order("published_on", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setRows(
      (data ?? []).map((r) => ({
        id: r.id as string,
        outlet: (r.outlet as string) ?? "",
        title: (r.title as string) ?? "",
        url: (r.url as string | null) ?? null,
        kind: ((r.kind as Kind) ?? "quote"),
        language: (r.language as string | null) ?? null,
        published_on: (r.published_on as string) ?? today(),
        is_public: (r.is_public as boolean) ?? true,
        cover_url: ((r as { cover_url?: string | null }).cover_url ?? null) as string | null,
        _dirty: false,
        _saving: false,
      })),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (idx: number, changes: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...changes, _dirty: true } : r)),
    );
  };

  const addRow = () => setRows((prev) => [emptyRow(), ...prev]);

  const removeRow = async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    if (row.id) {
      const { error } = await supabase.from("media_mentions").delete().eq("id", row.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        t("profile.author.media.removed", { defaultValue: "Usunięto wpis medialny" }),
      );
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveRow = async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    if (!row.outlet.trim() || !row.title.trim() || !row.published_on) {
      toast.error(
        t("profile.author.media.validation", {
          defaultValue: "Wypełnij tytuł, wydawcę i datę.",
        }),
      );
      return;
    }
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, _saving: true } : r)),
    );
    const payload = {
      user_id: userId,
      outlet: row.outlet.trim(),
      title: row.title.trim(),
      url: row.url?.trim() ? row.url.trim() : null,
      kind: row.kind,
      language: row.language?.trim() ? row.language.trim() : null,
      published_on: row.published_on,
      is_public: row.is_public,
      cover_url: row.cover_url?.trim() ? row.cover_url.trim() : null,
    };
    if (row.id) {
      const { error } = await supabase
        .from("media_mentions")
        .update(payload)
        .eq("id", row.id);
      if (error) {
        toast.error(error.message);
        setRows((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, _saving: false } : r)),
        );
        return;
      }
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, _dirty: false, _saving: false } : r)),
      );
      toast.success(t("profile.author.media.saved", { defaultValue: "Zapisano" }));
    } else {
      const { data, error } = await supabase
        .from("media_mentions")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        toast.error(error?.message ?? "Insert failed");
        setRows((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, _saving: false } : r)),
        );
        return;
      }
      setRows((prev) =>
        prev.map((r, i) =>
          i === idx ? { ...r, id: data.id as string, _dirty: false, _saving: false } : r,
        ),
      );
      toast.success(t("profile.author.media.added", { defaultValue: "Dodano wpis medialny" }));
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground/80">
            {t("profile.author.media.heading", {
              defaultValue: "Obecność w mediach, materiały zewnętrzne, podcasty",
            })}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("profile.author.media.hint", {
              defaultValue:
                "Dodawaj linki do wywiadów, wystąpień, op-edów i podcastów, w których się pojawiasz. Publiczne wpisy pokażą się na Twoim profilu eksperta w sekcji „W mediach”.",
            })}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" />
          {t("common.add", { defaultValue: "Dodaj" })}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">
          {t("common.loading", { defaultValue: "Ładowanie..." })}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
          {t("profile.author.media.empty", {
            defaultValue:
              "Nie masz jeszcze dodanych wystąpień medialnych. Kliknij „Dodaj” i wklej link do wywiadu, op-eda lub podcastu.",
          })}
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row, idx) => {
            const Icon = KIND_META[row.kind].icon;
            const isNew = row.id === null;
            return (
              <li
                key={row.id ?? `new-${idx}`}
                className="rounded-md border border-border bg-card/40 p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-start">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[11px] text-muted-foreground">
                      {t("profile.author.media.kind", { defaultValue: "Rodzaj" })}
                    </Label>
                    <Select
                      value={row.kind}
                      onValueChange={(v) => patch(idx, { kind: v as Kind })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KIND_META) as Kind[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {lang === "en" ? KIND_META[k].labelEn : KIND_META[k].labelPl}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[11px] text-muted-foreground">
                      {t("profile.author.media.publishedOn", { defaultValue: "Data publikacji" })}
                    </Label>
                    <Input
                      type="date"
                      value={row.published_on}
                      onChange={(e) => patch(idx, { published_on: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label className="text-[11px] text-muted-foreground">
                      {t("profile.author.media.outlet", {
                        defaultValue: "Wydawca / stacja / podcast",
                      })}
                    </Label>
                    <Input
                      placeholder="Rzeczpospolita, TVN24, Polityka Insight..."
                      value={row.outlet}
                      maxLength={160}
                      onChange={(e) => patch(idx, { outlet: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[11px] text-muted-foreground">
                      {t("profile.author.media.language", {
                        defaultValue: "Język (opcjonalnie)",
                      })}
                    </Label>
                    <Input
                      placeholder="pl / en"
                      maxLength={8}
                      value={row.language ?? ""}
                      onChange={(e) => patch(idx, { language: e.target.value || null })}
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label className="text-[11px] text-muted-foreground">
                      {t("profile.author.media.title", { defaultValue: "Tytuł materiału" })}
                    </Label>
                    <Input
                      placeholder={t("profile.author.media.titlePlaceholder", {
                        defaultValue: "np. Wywiad o polityce bezpieczeństwa UE",
                      })}
                      value={row.title}
                      maxLength={300}
                      onChange={(e) => patch(idx, { title: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      {t("profile.author.media.url", { defaultValue: "Link (URL)" })}
                    </Label>
                    <Input
                      type="url"
                      placeholder="https://..."
                      value={row.url ?? ""}
                      onChange={(e) => patch(idx, { url: e.target.value || null })}
                    />
                  </div>
                  {KINDS_WITH_COVER.includes(row.kind) && (
                    <div className="grid gap-2 sm:col-span-2">
                      <Label className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" aria-hidden />
                        {t("profile.author.media.cover", {
                          defaultValue: "Okładka - URL obrazu (opcjonalnie)",
                        })}
                      </Label>
                      <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-start">
                        {row.cover_url?.trim() ? (
                          <img
                            src={row.cover_url}
                            alt=""
                            loading="lazy"
                            className="h-16 w-24 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-border/70 bg-muted/20 text-muted-foreground">
                            <ImageIcon className="h-4 w-4" aria-hidden />
                          </div>
                        )}
                        <Input
                          type="url"
                          placeholder="https://.../cover.jpg"
                          value={row.cover_url ?? ""}
                          onChange={(e) => patch(idx, { cover_url: e.target.value || null })}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <Switch
                      checked={row.is_public}
                      onCheckedChange={(v) => patch(idx, { is_public: v })}
                    />
                    <span className="text-muted-foreground">
                      {t("profile.author.media.isPublic", {
                        defaultValue: "Widoczne na profilu publicznym",
                      })}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeRow(idx)}
                      disabled={row._saving}
                    >
                      <Trash2 className="mr-1 h-4 w-4 text-destructive" />
                      {t("common.remove", { defaultValue: "Usuń" })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveRow(idx)}
                      disabled={row._saving || (!row._dirty && !isNew)}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      {row._saving
                        ? t("common.saving", { defaultValue: "Zapisuję..." })
                        : isNew
                          ? t("common.add", { defaultValue: "Dodaj" })
                          : t("common.save", { defaultValue: "Zapisz" })}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
