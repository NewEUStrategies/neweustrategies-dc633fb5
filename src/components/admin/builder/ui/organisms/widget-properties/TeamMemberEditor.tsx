// Organism: team-member widget editor. Łączy kartę zespołu z profilem
// eksperta (author_profiles + profiles). Po wybraniu osoby dane są kopiowane
// do zawartości widgetu (photo/name/position/socials/bio/kontakt), dzięki
// czemu edytor pozostaje spójny z resztą kreatora (schema-driven), a admin
// może dowolnie nadpisywać poszczególne pola.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ExternalLink, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField } from "../../atoms";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { expertsDirectoryQueryOptions } from "@/lib/experts/directory";
import { toast } from "sonner";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const NONE = "__none__";

interface ExpertHydration {
  authorId: string;
  authorSlug: string | null;
  photo: string | null;
  name: string | null;
  positionPl: string | null;
  positionEn: string | null;
  bioPl: string | null;
  bioEn: string | null;
  email: string | null;
  x: string | null;
  linkedin: string | null;
  website: string | null;
}

/** Pobiera scalone dane eksperta (profiles + author_profiles) do skopiowania
 *  do widgetu. Zapytanie robimy on-demand, bo dane trafiają do content i
 *  później renderer nie potrzebuje żadnej dodatkowej sieci. */
async function fetchExpertHydration(userId: string): Promise<ExpertHydration | null> {
  const [{ data: prof, error: profErr }, { data: ap, error: apErr }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, slug, display_name, avatar_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("author_profiles")
      .select(
        "job_title, contact_email, website_url, x_url, linkedin_url, full_bio_pl, full_bio_en",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profErr) throw profErr;
  if (apErr) throw apErr;
  if (!prof) return null;
  const p = prof as Record<string, unknown>;
  const a = (ap ?? {}) as Record<string, unknown>;
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
    return null;
  };
  return {
    authorId: p.id as string,
    authorSlug: (p.slug as string | null) ?? null,
    photo: pick(p.avatar_url),
    name: pick(p.display_name),
    positionPl: pick(a.job_title),
    positionEn: pick(a.job_title),
    bioPl: pick(a.full_bio_pl, p.bio_pl),
    bioEn: pick(a.full_bio_en, p.bio_en),
    email: pick(a.contact_email),
    x: pick(a.x_url, p.twitter_url),
    linkedin: pick(a.linkedin_url, p.linkedin_url),
    website: pick(a.website_url, p.website_url),
  };
}

export function TeamMemberEditor({ c, lang, setContent }: Props) {
  const schema = WIDGET_SCHEMAS["team-member"] ?? [];
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const authorId = (typeof c.authorId === "string" ? c.authorId : "") as string;
  const authorSlug = (typeof c.authorSlug === "string" ? c.authorSlug : "") as string;

  const { data: dir } = useQuery(expertsDirectoryQueryOptions());
  const experts = useMemo(() => dir?.experts ?? [], [dir]);

  const applyHydration = (h: ExpertHydration) => {
    setContent("authorId", h.authorId);
    setContent("authorSlug", h.authorSlug ?? "");
    if (h.photo) setContent("photo", h.photo);
    if (h.name) setContent("name", h.name);
    if (h.positionPl) setContent("position_pl", h.positionPl);
    if (h.positionEn) setContent("position_en", h.positionEn);
    if (h.bioPl) setContent("bio_pl", h.bioPl);
    if (h.bioEn) setContent("bio_en", h.bioEn);
    if (h.email) setContent("email", h.email);
    if (h.x) setContent("x", h.x);
    if (h.linkedin) setContent("linkedin", h.linkedin);
    if (h.website) setContent("website", h.website);
  };

  const handleSelect = async (value: string) => {
    if (value === NONE) {
      setContent("authorId", "");
      setContent("authorSlug", "");
      return;
    }
    setBusy(true);
    try {
      const h = await fetchExpertHydration(value);
      if (!h) {
        toast({
          title: lang === "pl" ? "Nie znaleziono eksperta" : "Expert not found",
          variant: "destructive",
        });
        return;
      }
      applyHydration(h);
      toast({
        title: lang === "pl" ? "Dane eksperta wczytane" : "Expert data loaded",
        description:
          lang === "pl"
            ? "Możesz nadpisać poszczególne pola poniżej."
            : "You can override individual fields below.",
      });
    } catch (err) {
      toast({
        title: lang === "pl" ? "Błąd wczytywania" : "Loading error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!authorId) return;
    setBusy(true);
    try {
      const h = await fetchExpertHydration(authorId);
      if (h) applyHydration(h);
    } catch (err) {
      toast({
        title: lang === "pl" ? "Błąd odświeżania" : "Refresh error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const unlink = () => {
    setContent("authorId", "");
    setContent("authorSlug", "");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {lang === "pl" ? "Powiązany ekspert" : "Linked expert"}
        </div>
        <PropField
          label={lang === "pl" ? "Wybierz z katalogu ekspertów" : "Pick from experts directory"}
          hint={
            lang === "pl"
              ? "Wybranie osoby wypełni pola karty (zdjęcie, imię, stanowisko, bio, social) danymi z profilu eksperta. Ręczne wpisy poniżej mają pierwszeństwo."
              : "Selecting a person will populate the card fields (photo, name, position, bio, socials) from the expert profile. Manual entries below take precedence."
          }
        >
          <Select value={authorId || NONE} onValueChange={handleSelect} disabled={busy}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={lang === "pl" ? "- Brak -" : "- None -"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} className="text-xs">
                {lang === "pl" ? "- Brak (dane ręczne) -" : "- None (manual) -"}
              </SelectItem>
              {experts.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-xs">
                  {e.display_name ?? e.slug ?? e.id}
                  {e.job_title ? ` - ${e.job_title}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        {authorId && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              {lang === "pl" ? "Odśwież dane" : "Refresh data"}
            </Button>
            {authorSlug && (
              <a
                href={`/author/${authorSlug}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                {lang === "pl" ? "Zobacz profil publiczny" : "View public profile"}
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={unlink}
              disabled={busy}
            >
              <Link2Off className="mr-1 h-3 w-3" />
              {lang === "pl" ? "Odłącz" : "Unlink"}
            </Button>
          </div>
        )}
      </div>

      {schema.map((f) => (
        <SchemaFieldControl key={f.key} field={f} lang={lang} content={c} setContent={setContent} />
      ))}
    </div>
  );
}
