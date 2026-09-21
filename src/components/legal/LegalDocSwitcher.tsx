// Przełącznik dokumentów prawnych - "kokpit" wpięty w każdą stronę prawną.
//
// ZAKŁADKI SĄ LINKAMI, NIE STANEM. Wygląda jak pasek zakładek, ale każda
// pozycja to osobny adres z własnym SSR, własnym `head()` i własnym wpisem
// w sitemapie. Gdyby to był stan komponentu, trzynaście dokumentów miałoby
// jeden URL - nie do zalinkowania, nie do zaindeksowania i nie do wskazania
// w odpowiedzi organowi nadzorczemu.
//
// Aktywną pozycję czytamy z routera (`useRouterState`), a nie z propsa, więc
// żadna z piętnastu tras nie musi jej sobie podawać i nie da się jej rozjechać
// z adresem w pasku.
//
// MOBILE: `flex-wrap`, nie `overflow-x`. Poziomy scroll chowa pozycje przed
// czytelnikiem na telefonie, a to jest nawigacja po dokumentach, w których
// ludzie szukają konkretnej rzeczy - ma być widoczna cała.
import { Link, useRouterState } from "@tanstack/react-router";
import { resolveLegalNav } from "@/lib/legal/documentIndex";

export function LegalDocSwitcher() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const nav = resolveLegalNav(pathname);

  return (
    <nav
      aria-label={nav.label}
      className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-3"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {nav.label}
      </p>
      <div className="space-y-3">
        {nav.groups.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground/70">{group.label}</p>
            <ul className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link
                    to={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={
                      "inline-flex rounded-md px-2.5 py-1 text-xs transition-colors " +
                      (item.active
                        ? "bg-brand-ink/10 text-brand-ink font-medium ring-1 ring-brand-ink/30"
                        : "border border-border bg-background/60 text-muted-foreground hover:text-foreground")
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
