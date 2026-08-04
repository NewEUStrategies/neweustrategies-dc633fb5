// Organism: team-member widget editor. Łączy kartę zespołu z profilem
// eksperta (author_profiles + profiles). Po wybraniu osoby dane są kopiowane
// do zawartości widgetu (photo/name/position/socials/bio/kontakt), dzięki
// czemu edytor pozostaje spójny z resztą kreatora (schema-driven), a admin
// może dowolnie nadpisywać poszczególne pola.
//
// Wybór osoby i hydratację obsługują moduły współdzielone z widgetem
// `author-profile-card` (ExpertLinkPanel + @/lib/experts/hydration), żeby oba
// edytory nie rozjechały się w zachowaniu.
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { ExpertLinkPanel } from "./ExpertLinkPanel";
import type { ExpertHydration } from "@/lib/experts/hydration";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function TeamMemberEditor({ c, lang, setContent }: Props) {
  const schema = WIDGET_SCHEMAS["team-member"] ?? [];

  const authorId = typeof c.authorId === "string" ? c.authorId : "";
  const authorSlug = typeof c.authorSlug === "string" ? c.authorSlug : "";

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

  const clear = () => {
    setContent("authorId", "");
    setContent("authorSlug", "");
  };

  return (
    <div className="space-y-3">
      <ExpertLinkPanel
        lang={lang}
        authorId={authorId}
        authorSlug={authorSlug}
        onApply={applyHydration}
        onClear={clear}
        hint={
          lang === "pl"
            ? "Wybranie osoby wypełni pola karty (zdjęcie, imię, stanowisko, bio, social) danymi z profilu eksperta. Ręczne wpisy poniżej mają pierwszeństwo."
            : "Selecting a person will populate the card fields (photo, name, position, bio, socials) from the expert profile. Manual entries below take precedence."
        }
      />

      {schema.map((f) => (
        <SchemaFieldControl key={f.key} field={f} lang={lang} content={c} setContent={setContent} />
      ))}
    </div>
  );
}
