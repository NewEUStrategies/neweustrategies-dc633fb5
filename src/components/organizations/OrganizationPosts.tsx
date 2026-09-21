// Lista publikacji organizacji.
//
// NIE PISZEMY TU WŁASNEJ SIATKI. Treści organizacji jadą tym samym pivotem
// (`post_categories`) co kategorie, więc i lista ma być ta sama: `PaginatedPostGrid`
// (karty archiwum + indeksowalna paginacja `<a href>`). Ten plik dokłada tylko
// obudowę sekcji profilu i tłumaczy „stronę" na adres - reszta to wspólny organizm.
import { FileText } from "lucide-react";

import { PaginatedPostGrid } from "@/components/archive/PaginatedPostGrid";
import { ProfileSectionCard } from "@/components/profile/shell/ProfileShell";
import type { BlogListItem } from "@/lib/queries/public";

export function OrganizationPosts({
  posts,
  page,
  totalPages,
  lang,
  heading,
  emptyText,
  isPending,
  onPageChange,
  hrefFor,
}: {
  posts: readonly BlogListItem[];
  page: number;
  totalPages: number;
  lang: "pl" | "en";
  heading: string;
  emptyText: string;
  isPending: boolean;
  onPageChange: (page: number) => void;
  hrefFor: (page: number) => string;
}) {
  return (
    <ProfileSectionCard icon={<FileText className="h-3.5 w-3.5" />} title={heading}>
      <PaginatedPostGrid
        posts={posts}
        page={page}
        totalPages={totalPages}
        lang={lang}
        emptyText={emptyText}
        isPending={isPending}
        onPageChange={onPageChange}
        hrefFor={hrefFor}
        firstCardPriority={false}
      />
    </ProfileSectionCard>
  );
}
