import i18n from "@/lib/i18n";
const files = process.argv.slice(2);
for (const f of files) await import(f);
function flat(o: any, p = "", out: string[] = []) {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, out); else out.push(`${key}\t${String(v).slice(0,90)}`);
  }
  return out;
}
const b = i18n.getResourceBundle("pl", "translation");
console.log(flat(b.adminRevenue, "adminRevenue").join("\n"));
