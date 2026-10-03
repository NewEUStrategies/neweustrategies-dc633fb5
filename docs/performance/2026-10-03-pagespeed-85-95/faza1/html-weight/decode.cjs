const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
globalThis.self=globalThis;globalThis.document={currentScript:{remove(){}}};
eval(src);
const r=self.$_TSR.router;
fs.writeFileSync(process.argv[3],JSON.stringify(r,(k,v)=>v instanceof Map?Object.fromEntries(v):v instanceof Set?[...v]:v));
console.log(Object.keys(r), Object.keys(self.$_TSR));
