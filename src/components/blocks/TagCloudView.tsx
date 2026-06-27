// Publiczny renderer: chmura tagów. Losuje rozmiar fontu deterministycznie po slug-u.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";

interface Props {
  count: number;
  showCount: boolean;
  lang: "pl" | "en";
}

interface Tag { slug: string; name: string; }

function sizeFor(slug: string): string {
  // 5 stopni: xs/sm/base/lg/xl. Deterministyczne hashowanie nazwy.
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  const buckets = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"];
  return buckets[h % buckets.length];
}

export function TagCloudView({ count, showCount, lang }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("slug, name").order("name").limit(Math.max(1, Math.min(200, count)));
      if (cancelled) return;
      setTags((data ?? []) as Tag[]);
    })();
    return () => { cancelled = true; };
  }, [count]);

  if (tags.length === 0) return null;
  return (
    <div className="not-prose flex flex-wrap gap-2" aria-label={lang === "en" ? "Tags" : "Tagi"}>
      {tags.map((t) => (
        <AppLink
          key={t.slug}
          href={`/tag/${t.slug}`}
          className={`inline-flex items-center px-2 py-1 rounded-md bg-muted hover:bg-primary hover:text-primary-foreground transition-colors ${sizeFor(t.slug)}`}
        >
          #{t.name}{showCount ? "" : ""}
        </AppLink>
      ))}
    </div>
  );
}
