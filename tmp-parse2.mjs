import { readFileSync } from 'node:fs';
const txt = readFileSync('src/lib/icons/lucideIconNodes.generated.ts','utf8');
const m = /LUCIDE_ICON_NODES: Record<string, IconNode> = (\{[\s\S]*?\}) as unknown as Record<string, IconNode>;/ .exec(txt);
const raw = m ? m[1] : '';
console.log('len', raw.length, 'last 50', raw.slice(-50));
const json = raw.replace(/([,{\[]\s*)([a-zA-Z][a-zA-Z0-9-]*)\s*:/g, '$1"$2":');
try {
  const data = JSON.parse(json);
  console.log('ok keys', Object.keys(data).length);
  console.log('log-in', data['log-in']);
} catch (e) {
  console.error(e.message);
}
