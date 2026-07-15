// Parses a CGC sheet (class_id/class_name/attribute_name/attribute_value
// export) into a class_name -> display_name mapping for the Display Name
// toggle. See lib/accuracy.ts for how the mapping is applied to metrics.

import { Row, col } from "@/lib/accuracy";

export interface CgcParseResult {
  mapping: Record<string, string>;
  totalClasses: number;
  mappedClasses: number;
  conflicts: number;
}

const DISPLAY_NAME_ATTRS = new Set(["display_name", "display name"]);

export function parseCgcMapping(rows: Row[]): CgcParseResult {
  const mapping: Record<string, string> = {};
  const classNamesSeen = new Set<string>();
  let conflicts = 0;

  for (const r of rows) {
    const attrName = col(r, "attribute_name").trim().toLowerCase();
    if (!DISPLAY_NAME_ATTRS.has(attrName)) continue;

    const className = col(r, "class_name");
    const displayName = col(r, "attribute_value");
    if (!className || !displayName) continue;
    classNamesSeen.add(className);

    const existing = mapping[className];
    if (existing === undefined) {
      mapping[className] = displayName;
    } else if (existing !== displayName) {
      // Same class_name maps to two different display names depending on
      // which class_id produced it (a data-quality artifact in the source
      // export — the raw accuracy CSV only has class_name, not class_id,
      // so we can't disambiguate perfectly). Prefer the more specific,
      // non-"Others" value over the generic catch-all.
      conflicts++;
      if (existing === "Others" && displayName !== "Others") {
        mapping[className] = displayName;
      }
      // otherwise keep whichever non-Others value we already have
    }
  }

  return {
    mapping,
    totalClasses: classNamesSeen.size,
    mappedClasses: Object.keys(mapping).length,
    conflicts,
  };
}
