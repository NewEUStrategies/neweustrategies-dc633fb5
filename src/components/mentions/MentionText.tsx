// Atom: renderuje treść komentarza z @wzmiankami zamienionymi na linki do
// profilu autora (/author/$slug), resztę zostawiając zwykłym tekstem.
//
// Bezpieczeństwo: budujemy tablicę węzłów React (tekst + <Link>), NIGDY
// dangerouslySetInnerHTML - React escapuje węzły tekstowe, więc treść od
// użytkownika nie może wstrzyknąć znaczników. Odstępy/nowe linie zachowuje
// klasa `whitespace-pre-wrap` rodzica (kontener komentarza), więc atom nie musi
// nic robić ze znakami białymi. Slug w linku jest kanonicznie mały (spójnie z
// backendem process_mentions), a widoczny tekst zachowuje wpisaną wielkość.
import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { splitMentions } from "@/lib/mentions/parse";

interface MentionTextProps {
  body: string | null | undefined;
  /** Dodatkowe klasy dla linku wzmianki (domyślnie akcentowany, podkreślany na hover). */
  mentionClassName?: string;
}

const DEFAULT_MENTION_CLASS = "font-medium text-primary hover:underline";

export function MentionText({ body, mentionClassName }: MentionTextProps) {
  const segments = splitMentions(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <Link
            key={i}
            to="/author/$slug"
            params={{ slug: seg.slug }}
            className={mentionClassName ?? DEFAULT_MENTION_CLASS}
            data-mention={seg.slug}
          >
            {seg.raw}
          </Link>
        ),
      )}
    </>
  );
}
