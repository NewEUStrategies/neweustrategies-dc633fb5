import { careersResources } from "./src/lib/i18n-careers";
import { CAREER_ROLES } from "./src/lib/careers/roles";
const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const arr = (a: string[]) => "ARRAY[" + a.map(q).join(",") + "]::text[]";
const lines: string[] = [];
CAREER_ROLES.forEach((r, i) => {
  const pl = (careersResources.pl as any).careers.roles[r.id];
  const en = (careersResources.en as any).careers.roles[r.id];
  const bl = (o: any) => Object.keys(o.bullets).sort().map((k) => o.bullets[k] as string);
  const rq = (o: any) => Object.keys(o.requirements).sort().map((k) => o.requirements[k] as string);
  lines.push(`(${q(r.id)}, ${q(r.department)}, ${q(r.engagement)}, ${q(r.seniority)}, ${q(r.location)}, ${i * 10}, true, ${q(pl.title)}, ${q(en.title)}, ${q(pl.summary)}, ${q(en.summary)}, ${arr(bl(pl))}, ${arr(bl(en))}, ${arr(rq(pl))}, ${arr(rq(en))})`);
});
console.log(lines.join(",\n"));
