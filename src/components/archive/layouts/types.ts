// Common props for archive layout variants.
import type { BlogListItem } from "@/lib/queries/public";
import type { ArchiveLayoutSettings } from "@/lib/archive-layout-settings";
import type { SectionNode } from "@/lib/builder/types";
import type { ArchiveSort } from "@/lib/queries/archives";

export interface TaxonomyMetaLike {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  featured_section: SectionNode | null;
}

export interface ArchiveLayoutProps {
  kind: "category" | "tag";
  taxonomy: TaxonomyMetaLike;
  posts: readonly BlogListItem[];
  lang: "pl" | "en";
  settings: ArchiveLayoutSettings;
  // Pagination + sort
  page: number;
  pageSize: number;
  total: number;
  sort: ArchiveSort;
  onPageChange: (page: number) => void;
  onSortChange: (sort: ArchiveSort) => void;
  isPending: boolean;
  emptyText: string;
  extraBelow?: React.ReactNode;
  /** When true, disables interactive controls (used for admin live preview). */
  previewMode?: boolean;
}
