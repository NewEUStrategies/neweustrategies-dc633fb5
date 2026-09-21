// Atom: renderuje treść komentarza, zamieniając @wzmianki na wizytówki osób
// (awatar + imię i nazwisko + opcjonalnie firma), a resztę zostawiając zwykłym
// tekstem.
//
// NICK ZNIKNĄŁ ŚWIADOMIE. Wcześniej w treści stało dosłowne `@slug`. To był
// identyfikator techniczny, nie człowiek: czytelnik komentarza widział
// `@a-nowak` i nie wiedział, kto to ani z czym jest związany. Etykietą jest
// teraz nazwa z profilu, a gdy profilu nie da się rozwiązać - uczytelniony
// slug. `@` nie pojawia się w żadnym z tych stanów.
//
// Bezpieczeństwo bez zmian: budujemy tablicę węzłów React, NIGDY
// `dangerouslySetInnerHTML`. Odstępy i nowe linie zachowuje `whitespace-pre-wrap`
// rodzica. Slug w linku jest kanonicznie mały - spójnie z `process_mentions`.
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { splitMentions } from "@/lib/mentions/parse";
import { MentionTag } from "@/components/mentions/MentionTag";
import { useMentionEntity } from "@/components/mentions/MentionDirectory";
import { ensureI18n } from "@/lib/i18n-mentions";
import { uiLang } from "@/lib/i18n/format";

ensureI18n();

interface MentionTextProps {
  body: string | null | undefined;
  /** Dodatkowe klasy dla wyzwalacza wzmianki. */
  mentionClassName?: string;
}

function CommentMention({ slug, className }: { slug: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const entity = useMentionEntity(slug);
  return (
    <MentionTag
      slug={slug}
      entity={entity}
      lang={uiLang(i18n.language)}
      className={className}
      testId="comment-mention-preview"
      labels={{
        noProfile: t("mentions.noProfile"),
        viewProfile: t("mentions.viewProfile"),
        verified: t("mentions.verified"),
        viewOrg: t("mentions.viewOrg"),
      }}
    />
  );
}

export function MentionText({ body, mentionClassName }: MentionTextProps) {
  const segments = splitMentions(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <CommentMention key={i} slug={seg.slug} className={mentionClassName} />
        ),
      )}
    </>
  );
}
