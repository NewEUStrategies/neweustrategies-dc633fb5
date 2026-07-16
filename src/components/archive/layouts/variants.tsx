// 6 layout variants. Each composes ArchiveHeader + ArchiveBody differently
// (backgrounds, spacing, hero variant, featured card).
import { ArchiveHeader } from "./ArchiveHeader";
import { ArchiveBody } from "./ArchiveBody";
import { PostListCard } from "@/components/molecules/PostListCard";
import type { ArchiveLayoutProps } from "./types";

function name(props: ArchiveLayoutProps) {
  const { taxonomy, lang } = props;
  return lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl || taxonomy.name_en;
}
function desc(props: ArchiveLayoutProps) {
  const { taxonomy, lang } = props;
  return lang === "en"
    ? taxonomy.description_en || taxonomy.description_pl
    : taxonomy.description_pl || taxonomy.description_en;
}

// 1) Minimal
export function LayoutMinimal(props: ArchiveLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ArchiveHeader
        kind={props.kind}
        taxonomyId={props.taxonomy.id}
        name={name(props)}
        description={desc(props)}
        lang={props.lang}
        settings={props.settings}
        variant="compact"
      />
      <div className="border-t border-border" />
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-10">
        <ArchiveBody {...props} />
      </section>
    </div>
  );
}

// 2) Classic
export function LayoutClassic(props: ArchiveLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ArchiveHeader
        kind={props.kind}
        taxonomyId={props.taxonomy.id}
        name={name(props)}
        description={desc(props)}
        lang={props.lang}
        settings={props.settings}
      />
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-16">
        <ArchiveBody {...props} />
      </section>
    </div>
  );
}

// 3) Magazine - featured big on the left, grid on the right
export function LayoutMagazine(props: ArchiveLayoutProps) {
  const [featured, ...rest] = props.posts;
  const showFeatured = props.settings.show_featured_top && featured;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ArchiveHeader
        kind={props.kind}
        taxonomyId={props.taxonomy.id}
        name={name(props)}
        description={desc(props)}
        lang={props.lang}
        settings={props.settings}
        variant="wide"
      />
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-16">
        {showFeatured && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] mb-10">
            <div className="rounded-2xl overflow-hidden border border-border bg-card">
              <PostListCard post={featured} href={featured.href} lang={props.lang} viewTransitionId={featured.id} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rest.slice(0, 4).map((p) => (
                <PostListCard key={p.id} post={p} href={p.href} lang={props.lang} viewTransitionId={p.id} />
              ))}
            </div>
          </div>
        )}
        <ArchiveBody
          {...props}
          posts={showFeatured ? rest.slice(4) : props.posts}
          hasCustomFeaturedTop
        />
      </section>
    </div>
  );
}

// 4) Hero - full-width mesh hero, then grid
export function LayoutHero(props: ArchiveLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ArchiveHeader
        kind={props.kind}
        taxonomyId={props.taxonomy.id}
        name={name(props)}
        description={desc(props)}
        lang={props.lang}
        settings={props.settings}
        variant="wide"
      />
      <div className="max-w-[1200px] mx-auto px-4 lg:px-8 -mt-4">
        <div className="text-sm text-muted-foreground">
          {props.lang === "en" ? "Posts" : "Wpisy"}: <span className="font-medium">{props.posts.length}</span>
        </div>
      </div>
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-8">
        <ArchiveBody {...props} />
      </section>
    </div>
  );
}

// 5) Dark
export function LayoutDark(props: ArchiveLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="dark bg-neutral-950 text-neutral-100">
        <ArchiveHeader
          kind={props.kind}
          taxonomyId={props.taxonomy.id}
          name={name(props)}
          description={desc(props)}
          lang={props.lang}
          settings={props.settings}
          variant="wide"
        />
      </div>
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-10">
        <ArchiveBody {...props} />
      </section>
    </div>
  );
}

// 6) Bento - sticky header on the left, mixed sizes on the right
export function LayoutBento(props: ArchiveLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-10">
        <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
          <div className="lg:sticky lg:top-24 self-start">
            <ArchiveHeader
              kind={props.kind}
              taxonomyId={props.taxonomy.id}
              name={name(props)}
              description={desc(props)}
              lang={props.lang}
              settings={props.settings}
              variant="compact"
            />
          </div>
          <div>
            <ArchiveBody {...props} />
          </div>
        </div>
      </section>
    </div>
  );
}
