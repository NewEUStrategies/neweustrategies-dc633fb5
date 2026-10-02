// Atom prezentacyjny: lista podpowiedzi @wzmianek (role="listbox").
//
// Wydzielona z `MentionTextarea`, żeby komentarze i pola "wiadomość"
// w widgetach formularzy renderowały DOKŁADNIE tę samą listę.
//
// RODZAJ CELU JEST OGŁASZANY. Czytnik ekranu słyszy „Jan Kowalski, Osoba"
// albo „ACME, Firma". Wcześniej ta etykieta siedziała WEWNĄTRZ awatara
// z `aria-hidden`, czyli była ukryta razem z nim - osoba i firma o tej samej
// nazwie brzmiały identycznie.
//
// JEDEN ZNAK ZASTĘPCZY W AWATARZE. Osoba bez zdjęcia dostaje ikonę - tak jak
// wzmianka w biegu tekstu (`MentionAvatar`), bo litery tuż obok pełnego
// nazwiska czytają się jak literówka. Wcześniej wchodziła ikona I dwie
// pierwsze litery naraz. Inicjały (prawdziwe, z `nameInitials`) zostają
// w podglądzie celu, gdzie awatar stoi osobno.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, UserRound } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { nameInitials } from "@/lib/mentions/directory";
import { useMentionProfile } from "@/lib/mentions/useMentionProfile";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";
import { ensureI18n } from "@/lib/i18n-mentions";
import { uiLang } from "@/lib/i18n/format";

ensureI18n();

export interface MentionSuggestionListProps {
  listId: string;
  suggestions: MentionSuggestion[];
  isFetching: boolean;
  highlight: number;
  onHighlight: (index: number) => void;
  onChoose: (s: MentionSuggestion) => void;
}

/** Wizytówka celu pod pozycją listy - podgląd PRZED wstawieniem wzmianki. */
function SuggestionPreview({ slug, lang }: { slug: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const { data, isPending } = useMentionProfile(slug, lang, true);
  if (isPending) return <p className="text-xs text-muted-foreground">...</p>;
  // Nierozwiązany cel mówi to wprost. Wcześniej wchodził tu `@slug` - czyli
  // identyfikator techniczny; przy firmach byłoby to dosłowne `@org-<uuid>`.
  if (!data) return <p className="text-xs text-muted-foreground">{t("mentions.noProfile")}</p>;
  const imageUrl = data.kind === "organization" ? data.logoUrl : data.avatarUrl;
  const fallbackIcon =
    data.kind === "organization" ? (
      <Building2 className="h-4 w-4" aria-hidden="true" />
    ) : (
      nameInitials(data.name)
    );
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            fallbackIcon
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{data.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[data.jobTitle, data.company].filter(Boolean).join(" - ") ||
              (data.kind === "organization" ? t("mentions.organization") : t("mentions.person"))}
          </p>
        </div>
      </div>
      {data.bio ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{data.bio}</p>
      ) : null}
      {data.website ? (
        <p className="truncate text-xs text-primary">{data.website.replace(/^https?:\/\//, "")}</p>
      ) : null}
    </div>
  );
}

/** Awatar wiersza: zdjęcie osoby albo logo firmy, a bez obrazka - ikona
 *  rodzaju. Dekoracja: rodzaj ogłasza tekst wiersza, nie awatar. */
function SuggestionAvatar({ suggestion }: { suggestion: MentionSuggestion }) {
  const image = suggestion.avatarUrl || suggestion.logoUrl;
  return (
    <span
      aria-hidden="true"
      data-suggestion-avatar=""
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
    >
      {image ? (
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : suggestion.kind === "organization" ? (
        <Building2 className="h-3.5 w-3.5" />
      ) : (
        <UserRound className="h-3.5 w-3.5" />
      )}
    </span>
  );
}

export function MentionSuggestionList({
  listId,
  suggestions,
  isFetching,
  highlight,
  onHighlight,
  onChoose,
}: MentionSuggestionListProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t("mentions.listLabel")}
      className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-[8px] border border-border bg-popover p-1 shadow-lg"
    >
      {isFetching && suggestions.length === 0 ? (
        <li className="px-3 py-2 text-sm text-muted-foreground" aria-disabled>
          {t("mentions.loading")}
        </li>
      ) : (
        suggestions.map((s, i) => (
          <li
            key={s.slug}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === highlight}
            // onMouseDown zamiast onClick: wybór PRZED blur textarei.
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(s);
            }}
            onMouseEnter={() => {
              onHighlight(i);
              setPreviewSlug(s.slug);
            }}
            onMouseLeave={() => setPreviewSlug((cur) => (cur === s.slug ? null : cur))}
            className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm ${
              i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            }`}
          >
            <HoverCard open={previewSlug === s.slug} openDelay={250}>
              <HoverCardTrigger asChild>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <SuggestionAvatar suggestion={s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="sr-only">
                      {", "}
                      {s.kind === "organization"
                        ? t("mentions.organization")
                        : t("mentions.person")}
                    </span>
                    {/* BEZ NICKU. Wcześniej stał tu `@slug` - przy firmach
                        dosłownie `@org-<uuid>`, czyli napis, który nikomu nic
                        nie mówi. Zostaje sam podpis, a gdy go nie ma, wiersz
                        domyka się na samej nazwie. */}
                    {s.subtitle ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.subtitle}
                      </span>
                    ) : null}
                  </span>
                </span>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" className="w-72">
                <SuggestionPreview slug={s.slug} lang={lang} />
              </HoverCardContent>
            </HoverCard>
          </li>
        ))
      )}
    </ul>
  );
}
