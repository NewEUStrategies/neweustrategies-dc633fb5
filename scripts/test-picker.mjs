import * as ops from "../src/lib/builder/operations.ts";
const doc = { version: 1, sections: [] };
ops.insertContainerAt(doc, 0, true);
const sec = doc.sections[0];
const tabId = sec.tabs.items[0].id;
const tab2 = sec.tabs.items[1].id;
ops.addSectionToTab(doc, sec.id, tab2, [6, 6]);
console.log("kids:", JSON.stringify(doc.sections[0].children, null, 2));
console.log("tab2Id:", tab2);
