// Organism: Section Advanced tab (id/class, motion, visibility, custom CSS).
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SectionNode } from "@/lib/builder/types";
import { PropField } from "../../atoms";
import { AccessControl, MotionControl, VisibilityControl } from "../../molecules";

type Mut = (mut: (s: SectionNode) => void) => void;
const ensure = <T extends object>(v: T | undefined): T => (v ?? ({} as T));

export function AdvancedPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const setA = (mut: (a: NonNullable<SectionNode["advanced"]>) => void) =>
    onChange((s) => { s.advanced = ensure(s.advanced); mut(s.advanced!); });
  const a = section.advanced ?? {};
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Identyfikatory</h4>
        <PropField label="HTML ID">
          <Input value={a.htmlId ?? ""} onChange={(e) => setA((x) => { x.htmlId = e.target.value || undefined; })} className="h-8 text-xs" />
        </PropField>
        <PropField label="CSS class">
          <Input value={a.cssClass ?? ""} onChange={(e) => setA((x) => { x.cssClass = e.target.value || undefined; })} className="h-8 text-xs" />
        </PropField>
      </section>

      <section className="space-y-2 pt-2 border-t border-border">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Motion</h4>
        <MotionControl value={a} onChange={setA} />
      </section>

      <section className="space-y-2 pt-2 border-t border-border">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Widoczność</h4>
        <VisibilityControl value={a} onChange={setA} />
      </section>

      <section className="space-y-2 pt-2 border-t border-border">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Dostęp (auth/role)</h4>
        <AccessControl value={a} onChange={setA} />
        <p className="text-[10px] text-muted-foreground">Reguły obowiązują tylko na opublikowanej stronie. W edytorze sekcja jest zawsze widoczna.</p>
      </section>

      <section className="space-y-2 pt-2 border-t border-border">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Custom CSS</h4>
        <Textarea rows={4} value={a.customCss ?? ""} onChange={(e) => setA((x) => { x.customCss = e.target.value || undefined; })} className="text-xs font-mono" placeholder=".my-class { color: red; }" />
      </section>
    </div>
  );
}
