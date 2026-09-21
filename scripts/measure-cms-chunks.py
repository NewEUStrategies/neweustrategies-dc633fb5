"""Report static JS dependencies after BUNDLE_INVENTORY=1 npm run build.

Owner: Fundacja New European Strategies.
Run from the repository root: python3 scripts/measure-cms-chunks.py
Byte counts include shared boot code and deduplicate each emitted chunk.
They describe the build graph, not observed browser transfer or loading time.
"""

import gzip
import json
from pathlib import Path


def measure(inventory_path=Path("reports/chunk-inventory.json")):
    inventory = json.loads(inventory_path.read_text())
    chunks = {chunk["file"]: chunk for chunk in inventory["chunks"]}
    output_dir = Path(inventory["outDir"])
    result = {}
    for label, module_suffix in [
        ("boot", None),
        ("blocks", "/components/blocks/BlocksRenderer.tsx"),
        ("content-route", "/routes/$.tsx?tsr-split=component"),
    ]:
        roots = [
            name
            for name, chunk in chunks.items()
            if (
                chunk["isEntry"]
                if module_suffix is None
                else any(module_suffix in module["id"] for module in chunk["modules"])
            )
        ]
        if not roots:
            raise ValueError(f"No build entry found for {label}")
        pending, seen = roots[:], set()
        while pending:
            name = pending.pop()
            if name in seen:
                continue
            seen.add(name)
            pending.extend(chunks[name]["imports"])
        files = []
        for name in sorted(seen):
            data = (output_dir / name).read_bytes()
            files.append({"file": name, "gzip": len(gzip.compress(data)), "raw": len(data)})
        optional_modules = sorted({
            module["id"].split("/src/")[-1]
            for name in seen
            for module in chunks[name]["modules"]
            if module["id"].endswith((
                "AuthFormBlocks.tsx", "NewsletterForm.tsx", "MarketingContactFormView.tsx",
            )) or "/node_modules/jszip/" in module["id"]
        })
        result[label] = {
            "roots": roots,
            "chunks": len(files),
            "gzip": sum(row["gzip"] for row in files),
            "raw": sum(row["raw"] for row in files),
            "optionalModulesInStaticGraph": optional_modules,
            "files": files,
        }
    return result


if __name__ == "__main__":
    print(json.dumps(measure(), indent=2))
