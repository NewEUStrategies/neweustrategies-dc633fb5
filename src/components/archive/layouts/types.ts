// Common props for archive layout variants.
import type { BlogListItem } from "@/lib/queries/public";
import type { ArchiveLayoutSettings } from "@/lib/archive-layout-settings";
import type { SectionNode } from "@/lib/builder/types";

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
  canLoadMore: boolean;
  isPending: boolean;
  onLoadMore: () => void;
  emptyText: string;
  loadingText: string;
  loadMoreText: string;
  extraBelow?: React.ReactNode;
}
