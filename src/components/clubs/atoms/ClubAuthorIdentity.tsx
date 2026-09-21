// Tożsamość autora w bylinie wpisu: nazwisko i - gdy profil ją niesie - firma.
//
// CZEGO TU NIE MA I DLACZEGO. Nie ma nicku. Identyfikator `@slug` jest kluczem
// technicznym powiadomień, a nie sposobem, w jaki ludzie się przedstawiają;
// w nagłówku wypowiedzi nie niósł żadnej informacji. Zamiast niego stoi firma
// z profilu - bo w dyskusji branżowej to ona mówi, z jakiej pozycji ktoś głos
// zabiera.
//
// BRAK FIRMY NIE ZOSTAWIA DZIURY. `CompanyTag` nie renderuje się bez nazwy,
// razem z nim znika separator - wiersz po prostu domyka się w lewo.
//
// CHATHAM HOUSE. Autor anonimowy i konto usunięte mają `profileSlug === null`
// (tak zwraca `toAuthorLabel`, a baza zeruje dane autora przy `is_anonymous`).
// Wtedy nie ma ani odnośnika, ani dymka, ani firmy - interfejs nie może
// odsłonić tożsamości, której baza celowo nie ujawnia.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PersonHoverCard } from "@/components/mentions/MentionTag";
import { CompanyTag } from "@/components/mentions/CompanyTag";
import { useMentionEntity } from "@/components/mentions/MentionDirectory";
import type { ClubAuthorLabel } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { uiLang } from "@/lib/i18n/format";

ensureClubI18n();

const NAME_CLASS = "truncate text-sm font-semibold leading-tight";

export function ClubAuthorIdentity({
  author,
  nameClassName = NAME_CLASS,
}: {
  author: ClubAuthorLabel;
  /** Typografia nazwiska - strona wątku i ściana klubu mają własną skalę. */
  nameClassName?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const slug = author.profileSlug;
  const entity = useMentionEntity(slug);

  if (slug === null) {
    return <span className={nameClassName}>{author.name}</span>;
  }

  const company = entity !== null && entity.kind === "person" ? entity.company : null;

  return (
    <>
      <PersonHoverCard
        slug={slug}
        entity={entity}
        lang={lang}
        testId="club-author-preview"
        labels={{
          noProfile: t("club.inline.noProfile"),
          viewProfile: t("club.inline.viewProfile"),
          verified: t("club.inline.verified"),
          viewOrg: t("club.inline.viewOrg"),
        }}
      >
        <Link
          to="/author/$slug"
          params={{ slug }}
          data-club-author={slug}
          className={`${nameClassName} hover:underline`}
        >
          {author.name}
        </Link>
      </PersonHoverCard>
      <CompanyTag
        name={company}
        testId="club-company-preview"
        labels={{ website: t("club.inline.companyWebsite") }}
      />
    </>
  );
}
