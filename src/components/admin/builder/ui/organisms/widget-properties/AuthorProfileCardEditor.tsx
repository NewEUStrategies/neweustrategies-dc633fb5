// Organizm: edytor widgetu `author-profile-card`. Wybór osoby i hydratacja są
// współdzielone z edytorem `team-member` (ExpertLinkPanel + @/lib/experts/
// hydration), żeby oba buildery zachowywały się identycznie. Pozostałe pola
// idą ze schematu (schema-driven), a podgląd na dole pokazuje dokładnie ten
// sam komponent, który renderuje kanwa i strona publiczna.
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { ExpertLinkPanel } from "./ExpertLinkPanel";
import type { ExpertHydration } from "@/lib/experts/hydration";
import { AuthorProfileCardWidget } from "@/components/builder/organisms/widget-view/AuthorProfileCardWidget";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function AuthorProfileCardEditor({ c, lang, setContent }: Props) {
  const schema = WIDGET_SCHEMAS["author-profile-card"] ?? [];
  const authorId = typeof c.authorId === "string" ? c.authorId : "";
  const authorSlug = typeof c.authorSlug === "string" ? c.authorSlug : "";

  const applyHydration = (h: ExpertHydration) => {
    setContent("authorId", h.authorId);
    setContent("authorSlug", h.authorSlug ?? "");
    if (h.photo) setContent("photo", h.photo);
    if (h.name) setContent("name", h.name);
    if (h.positionPl) setContent("position_pl", h.positionPl);
    if (h.positionEn) setContent("position_en", h.positionEn);
    if (h.bioPl) setContent("description_pl", h.bioPl);
    if (h.bioEn) setContent("description_en", h.bioEn);
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
            ? "Wybranie osoby wypełni kartę (zdjęcie, imię, stanowisko, opis, social) danymi z profilu eksperta. Ręczne wpisy poniżej mają pierwszeństwo."
            : "Selecting a person populates the card (photo, name, position, description, socials) from the expert profile. Manual entries below take precedence."
        }
      />

      {schema.map((f) => (
        <SchemaFieldControl key={f.key} field={f} lang={lang} content={c} setContent={setContent} />
      ))}

      <div className="space-y-2 rounded-[6px] border border-border/60 bg-muted/20 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {lang === "pl" ? "Podgląd karty" : "Card preview"}
        </div>
        <div className="pointer-events-none">
          <AuthorProfileCardWidget
            node={{ id: "preview", kind: "widget", type: "author-profile-card", content: c }}
            lang={lang}
          />
        </div>
      </div>
    </div>
  );
}
