// Core accuracy computation logic for df_out CSV exports.
//
// IMPORTANT — calculation methodology (revised 2026-07-16, verified
// metric-by-metric against a real df_out export):
//
// 1. GPD accuracy = simple POOLED accuracy across all SKU rows (every row
//    counts equally, NOT per-shop averaged — corrected from an earlier
//    per-shop-average implementation).
//    Formula: count(SKU rows where gpd=='0') / count(all SKU rows)
//
// 2. Group accuracy = simple POOLED accuracy across all SKU rows, NOT
//    gpd-gated. Excludes rows where actual_group or predicted_group is
//    None/Sticker/Shelf (any casing) — not meaningful group-level comparisons.
//    Formula: count(eligible rows where wrong_group=='0')/count(eligible rows)
//
//    Class accuracy = same shape as Group accuracy — simple POOLED accuracy,
//    NOT gpd-gated, excluding rows where actual_class or predicted_class is
//    None/Sticker/Shelf (any casing).
//    Formula: count(eligible rows where wrong_class=='0')/count(eligible rows)
//
// 3. Openset accuracy = simple POOLED accuracy across all SKU rows (NOT
//    per-shop averaged, NOT gpd-gated). Excludes rows where any of
//    actual_group/predicted_group/actual_class/predicted_class is
//    None/Sticker/Shelf (any casing).
//
// 4. OSA (On Shelf Availability): POOLED across all shops (not per-shop
//    averaged) — count(correct (shop,date,category,actual_class) combos)
//    / count(all such combos), where a combo is correct if at least one
//    row in it has actual_class==predicted_class.
//
// 5. Sticker detector accuracy = simple POOLED accuracy over Sticker-type
//    annotations only, using the gpd column (same shape as GPD accuracy).
//    Formula: count(Sticker rows where gpd=='0') / count(Sticker rows)
//
// 6. Sticker value accuracy = pooled accuracy over Sticker rows where both
//    sticker_value_actual and sticker_value_predicted are present.
//
// If a file has no "Shop ID" column, all formulas degrade gracefully to
// pooled (single "shop") since there's nothing to average across.

export type Row = Record<string, string>;

// col() is called an enormous number of times per upload (every metric pass
// touches most columns of most rows), and re-deriving the normalized
// header->key lookup from scratch on every single call (Object.keys() +
// per-key string normalization) was the dominant cost. Since the same Row
// object is queried repeatedly across passes, cache each row's normalized
// key map the first time it's built and reuse it on every later call —
// same lookup semantics (first raw key matching a normalized name wins),
// just computed once per row instead of once per (row, call) pair.
const normalizedKeyCache = new WeakMap<Row, Map<string, string>>();

function getNormalizedKeyMap(row: Row): Map<string, string> {
  let map = normalizedKeyCache.get(row);
  if (!map) {
    map = new Map();
    for (const k of Object.keys(row)) {
      const norm = k.trim().toLowerCase().replace(/[_\s]/g, "");
      if (!map.has(norm)) map.set(norm, k);
    }
    normalizedKeyCache.set(row, map);
  }
  return map;
}

export function col(row: Row, ...names: string[]): string {
  const keyMap = getNormalizedKeyMap(row);
  for (const n of names) {
    const target = n.toLowerCase().replace(/[_\s]/g, "");
    const found = keyMap.get(target);
    if (found && row[found] !== undefined) return (row[found] || "").trim();
  }
  return "";
}

export interface CategoryResult {
  category_name: string;
  total_annotations: number;
  image_count: number;
  gpd_accuracy: number | null;
  group_accuracy: number | null;
  class_accuracy: number | null;
  openset_accuracy: number | null;
  osa_accuracy: number | null;
  sticker_detector_accuracy: number | null;
  sticker_value_accuracy: number | null;
}

export interface ConfusionPair {
  category_name: string;
  matrix_type: "class" | "group";
  actual_value: string;
  predicted_value: string;
  count: number;
  self_count: number;
  total_count: number;
  accuracy_pct: number;
  is_mismatch: boolean; // true = actual!=predicted row; false = self-match row with pct<100
}

function avgNumericCol(rows: Row[], colName: string): number | null {
  const vals = rows
    .map((r) => col(r, colName))
    .filter((v) => v !== "" && v !== "NA" && v !== "//" && !isNaN(parseFloat(v)))
    .map((v) => parseFloat(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Groups rows by category_name in a single pass, preserving first-occurrence
// order (matches the [...new Set(...)] ordering the old per-category
// re-filtering relied on) — avoids re-scanning the full row array once per
// category.
function groupByCategoryName(rows: Row[]): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const c = col(r, "category_name");
    if (!c) continue;
    const bucket = map.get(c);
    if (bucket) bucket.push(r);
    else map.set(c, [r]);
  }
  return map;
}

function getShopKey(row: Row): string {
  const shopId = col(row, "shop_id", "shopid");
  const shopName = col(row, "shop_name", "shopname");
  return shopId || shopName || "__no_shop__";
}

// True for "None"/"Sticker"/"Shelf" (any casing) — these aren't meaningful
// group-level values and are excluded from Group/Class/Openset accuracy's
// eligible sets.
function isExcludedGroupValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "none" || v === "sticker" || v === "shelf";
}

// A row is excluded from Openset accuracy if any of its raw group/class
// fields is None/Sticker (any casing) — same exclusion values as Group and
// Class accuracy, just checked across all four fields at once.
function isExcludedForOpenset(r: Row): boolean {
  return (
    isExcludedGroupValue(col(r, "actual_group")) ||
    isExcludedGroupValue(col(r, "predicted_group")) ||
    isExcludedGroupValue(col(r, "actual_class")) ||
    isExcludedGroupValue(col(r, "predicted_class"))
  );
}

// Pooled accuracy: every row counts equally, no per-shop averaging.
// failFlag: column name whose value '1' marks a failure for that row.
function pooledFlagAccuracy(rows: Row[], failFlagCol: string): number | null {
  if (!rows.length) return null;
  const fails = rows.filter((r) => col(r, failFlagCol) === "1").length;
  return 1 - fails / rows.length;
}

export function computeCategoryMetrics(allRows: Row[], categoryName: string | null): CategoryResult | null {
  const rows = categoryName
    ? allRows.filter((r) => col(r, "category_name") === categoryName)
    : allRows;
  return computeMetricsForRows(rows, categoryName);
}

// Core computation, assuming `rows` is already the correct (category-filtered
// or "ALL") subset — split out so computeAllCategories can group once instead
// of re-filtering allRows from scratch for every category.
function computeMetricsForRows(rows: Row[], categoryName: string | null): CategoryResult | null {
  if (!rows.length) return null;

  const skuRows = rows.filter((r) => col(r, "annotation_type") !== "Sticker");
  const stickerRows = rows.filter((r) => col(r, "annotation_type") === "Sticker");

  const total = skuRows.length || rows.length;

  // GPD accuracy: pooled across all SKU rows (every row counts equally),
  // ungated (GPD measures itself). = count(gpd==0) / count(all SKU rows).
  const gpdAcc = pooledFlagAccuracy(skuRows, "gpd");

  // Group accuracy: pooled across all SKU rows (every row counts equally),
  // NOT gpd-gated. Excludes rows where actual_group or predicted_group is
  // None/Sticker/Shelf (any casing) — not meaningful group-level comparisons.
  // = count(eligible rows where wrong_group==0) / count(eligible rows)
  const groupEligibleRows = skuRows.filter(
    (r) => !isExcludedGroupValue(col(r, "actual_group")) && !isExcludedGroupValue(col(r, "predicted_group"))
  );
  const grpAcc = pooledFlagAccuracy(groupEligibleRows, "wrong_group");

  // Class accuracy: same shape as Group accuracy — pooled, ungated,
  // excluding rows where actual_class or predicted_class is None/Sticker.
  const classEligibleRows = skuRows.filter(
    (r) => !isExcludedGroupValue(col(r, "actual_class")) && !isExcludedGroupValue(col(r, "predicted_class"))
  );
  const clsAcc = pooledFlagAccuracy(classEligibleRows, "wrong_class");

  // Openset accuracy: simple POOLED accuracy (not gated, not per-shop
  // averaged). Excludes rows where any of actual_group/predicted_group/
  // actual_class/predicted_class is None/Sticker.
  const osRows = skuRows.filter((r) => col(r, "openset_actual") !== "" && !isExcludedForOpenset(r));
  const osCorrect = osRows.filter((r) => col(r, "openset_actual") === col(r, "openset_prediction")).length;
  const osAcc = osRows.length ? osCorrect / osRows.length : null;

  // Eligible rows for OSA: same filter as group/class level analysis
  const eligibleRows = skuRows.filter(
    (r) =>
      !["", "None", "Shelf", "Sticker"].includes(col(r, "actual_group")) &&
      !["", "None"].includes(col(r, "actual_class"))
  );

  // OSA (On Shelf Availability), POOLED across all shops (not per-shop
  // averaged): combos are keyed by (shop, date, category, actual_class); a
  // combo is correct if at least one row in it has actual_class==predicted_class.
  // OSA = count(correct combos) / count(all combos), across the whole eligible set.
  const osaAcc = (() => {
    if (!eligibleRows.length) return null;
    const combos: Record<string, Row[]> = {};
    for (const r of eligibleRows) {
      const key = `${getShopKey(r)}||${col(r, "date")}||${col(r, "category_name")}||${col(r, "actual_class")}`;
      if (!combos[key]) combos[key] = [];
      combos[key].push(r);
    }
    const comboKeys = Object.keys(combos);
    if (!comboKeys.length) return null;
    const correct = comboKeys.filter((k) =>
      combos[k].some((r) => col(r, "actual_class") === col(r, "predicted_class"))
    ).length;
    return correct / comboKeys.length;
  })();

  // Sticker detector accuracy: pooled, over Sticker-type annotations only,
  // using the gpd column (same shape as GPD accuracy, just scoped to stickers).
  let stickerDetAcc: number | null = null;
  let stickerValAcc: number | null = null;
  if (stickerRows.length) {
    const detTotal = stickerRows.filter((r) => col(r, "gpd") !== "");
    const detCorrect = detTotal.filter((r) => col(r, "gpd") === "0").length;
    stickerDetAcc = detTotal.length ? detCorrect / detTotal.length : null;

    const valRows = stickerRows.filter(
      (r) => col(r, "sticker_value_actual") !== "" && col(r, "sticker_value_predicted") !== ""
    );
    const valCorrect = valRows.filter(
      (r) => col(r, "sticker_value_actual") === col(r, "sticker_value_predicted")
    ).length;
    stickerValAcc = valRows.length ? valCorrect / valRows.length : null;
  }

  const imageCount = new Set(rows.map((r) => col(r, "image_id")).filter(Boolean)).size;

  return {
    category_name: categoryName || "ALL",
    total_annotations: total,
    image_count: imageCount,
    gpd_accuracy: gpdAcc,
    group_accuracy: grpAcc,
    class_accuracy: clsAcc,
    openset_accuracy: osAcc,
    osa_accuracy: osaAcc,
    sticker_detector_accuracy: stickerDetAcc,
    sticker_value_accuracy: stickerValAcc,
  };
}

export function computeAllCategories(allRows: Row[]): { overall: CategoryResult; categories: CategoryResult[] } {
  const overall = computeMetricsForRows(allRows, null)!;
  const byCategory = groupByCategoryName(allRows);
  const perCategory = [...byCategory.entries()]
    .map(([c, rows]) => computeMetricsForRows(rows, c))
    .filter((c): c is CategoryResult => c !== null);
  return { overall, categories: perCategory };
}

export function buildConfusionPairs(allRows: Row[]): ConfusionPair[] {
  // Filter matches the sheet's Group Level Analysis formula:
  // actual_group not in (None, Shelf, Sticker), actual_class not in (None)
  // NOTE: NO GPD gate here — the sheet formula does not gate by GPD for the Accuracies tab.
  const skuRows = allRows.filter(
    (r) =>
      col(r, "annotation_type") !== "Sticker" &&
      !["", "None", "Shelf", "Sticker"].includes(col(r, "actual_group")) &&
      !["", "None"].includes(col(r, "actual_class"))
  );
  const byCategory = groupByCategoryName(skuRows);
  const categories = [...byCategory.keys()];
  const pairs: ConfusionPair[] = [];

  for (const matrixType of ["class", "group"] as const) {
    const aCol = matrixType === "class" ? "actual_class" : "actual_group";
    const pCol = matrixType === "class" ? "predicted_class" : "predicted_group";

    for (const cat of categories) {
      const rows = byCategory.get(cat)!;

      const totals: Record<string, number> = {};
      const selfCounts: Record<string, number> = {};
      const allPredictions: Record<string, Record<string, number>> = {};

      for (const r of rows) {
        const a = col(r, aCol);
        const p = col(r, pCol);
        if (!a || !p || a === "None") continue;
        totals[a] = (totals[a] || 0) + 1;
        if (a === p) selfCounts[a] = (selfCounts[a] || 0) + 1;
        if (!allPredictions[a]) allPredictions[a] = {};
        allPredictions[a][p] = (allPredictions[a][p] || 0) + 1;
      }

      for (const actual of Object.keys(totals)) {
        const total = totals[actual];
        const self = selfCounts[actual] || 0;
        const pct = (self / total) * 100;

        // Store self-match row for ALL groups/classes (including 100%)
        // so the Accuracies tab shows the complete picture like the sheet does
        pairs.push({
          category_name: cat,
          matrix_type: matrixType,
          actual_value: actual,
          predicted_value: actual,
          count: self,
          self_count: self,
          total_count: total,
          accuracy_pct: pct,
          is_mismatch: false,
        });

        // Store all mismatch rows (for Issues tab): actual != predicted
        if (allPredictions[actual]) {
          for (const pred of Object.keys(allPredictions[actual])) {
            if (pred !== actual) {
              pairs.push({
                category_name: cat,
                matrix_type: matrixType,
                actual_value: actual,
                predicted_value: pred,
                count: allPredictions[actual][pred],
                self_count: self,
                total_count: total,
                accuracy_pct: pct,
                is_mismatch: true,
              });
            }
          }
        }
      }
    }
  }

  // Worst accuracy first
  return pairs.sort((a, b) => a.accuracy_pct - b.accuracy_pct);
}

// Parses a date string in either YYYY-MM-DD or M/D/YYYY (or MM/DD/YYYY)
// format into a sortable YYYY-MM-DD string. Returns null if unparseable.
function normalizeDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  // M/D/YYYY or MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Fallback: let the JS Date parser try, then reformat if valid
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export function detectTestDate(allRows: Row[]): string | null {
  const dates = allRows
    .map((r) => normalizeDate(col(r, "date")))
    .filter((d): d is string => d !== null);
  if (!dates.length) return null;
  return dates.reduce((latest, current) => (current > latest ? current : latest));
}

export function filterToLatestDate(allRows: Row[]): Row[] {
  const latestDate = detectTestDate(allRows);
  if (!latestDate) return allRows;
  return allRows.filter((r) => normalizeDate(col(r, "date")) === latestDate);
}

// ============================================================
// Display Name view (V2.0) — additive only, nothing above this
// line is modified. See lib/cgc.ts for how the class_name ->
// display_name mapping is built from a project's CGC sheet.
//
// Only class_accuracy, osa_accuracy, and the "class" confusion
// matrix change between raw and display view — GPD, group,
// openset, and sticker metrics don't reference class names at
// all (group has no display-name data in the CGC sheet), so
// they're computed identically to the raw view either way.
// ============================================================

export function mapValue(map: Record<string, string>, value: string): string {
  if (!value) return value;
  return map[value] ?? value;
}

// Same shape as pooledFlagAccuracy, but "wrong" is derived fresh from mapped
// actual/predicted equality instead of reading an existing flag column —
// this is what lets two raw classes that share a display name stop counting
// as a mismatch against each other.
function pooledMappedAccuracy(
  rows: Row[],
  actualCol: string,
  predictedCol: string,
  classNameMap: Record<string, string>
): number | null {
  if (!rows.length) return null;
  const fails = rows.filter(
    (r) => mapValue(classNameMap, col(r, actualCol)) !== mapValue(classNameMap, col(r, predictedCol))
  ).length;
  return 1 - fails / rows.length;
}

export function computeCategoryMetricsDisplay(
  allRows: Row[],
  categoryName: string | null,
  classNameMap: Record<string, string>
): CategoryResult | null {
  const rows = categoryName
    ? allRows.filter((r) => col(r, "category_name") === categoryName)
    : allRows;
  return computeMetricsForRowsDisplay(rows, categoryName, classNameMap);
}

// Core computation, assuming `rows` is already the correct subset — split
// out so computeAllCategoriesDisplay can group once instead of re-filtering
// allRows from scratch for every category.
function computeMetricsForRowsDisplay(
  rows: Row[],
  categoryName: string | null,
  classNameMap: Record<string, string>
): CategoryResult | null {
  if (!rows.length) return null;

  const skuRows = rows.filter((r) => col(r, "annotation_type") !== "Sticker");
  const stickerRows = rows.filter((r) => col(r, "annotation_type") === "Sticker");
  const total = skuRows.length || rows.length;

  // Unchanged from raw — GPD doesn't reference class names.
  const gpdAcc = pooledFlagAccuracy(skuRows, "gpd");

  // Unchanged from raw — the CGC sheet has no group-level display names.
  const groupEligibleRows = skuRows.filter(
    (r) => !isExcludedGroupValue(col(r, "actual_group")) && !isExcludedGroupValue(col(r, "predicted_group"))
  );
  const grpAcc = pooledFlagAccuracy(groupEligibleRows, "wrong_group");

  // Same eligibility filter as raw class accuracy; "wrong" is redefined as
  // mapped(actual) != mapped(predicted) instead of the wrong_class flag.
  const classEligibleRows = skuRows.filter(
    (r) => !isExcludedGroupValue(col(r, "actual_class")) && !isExcludedGroupValue(col(r, "predicted_class"))
  );
  const clsAcc = pooledMappedAccuracy(classEligibleRows, "actual_class", "predicted_class", classNameMap);

  // Unchanged from raw — separate openset fields, no class names involved.
  const osRows = skuRows.filter((r) => col(r, "openset_actual") !== "" && !isExcludedForOpenset(r));
  const osCorrect = osRows.filter((r) => col(r, "openset_actual") === col(r, "openset_prediction")).length;
  const osAcc = osRows.length ? osCorrect / osRows.length : null;

  const eligibleRows = skuRows.filter(
    (r) =>
      !["", "None", "Shelf", "Sticker"].includes(col(r, "actual_group")) &&
      !["", "None"].includes(col(r, "actual_class"))
  );

  // Recomputed — combo correctness uses mapped class equality. POOLED
  // across all shops (not per-shop averaged), same as raw OSA.
  const osaAcc = (() => {
    if (!eligibleRows.length) return null;
    const combos: Record<string, Row[]> = {};
    for (const r of eligibleRows) {
      const key = `${getShopKey(r)}||${col(r, "date")}||${col(r, "category_name")}||${mapValue(classNameMap, col(r, "actual_class"))}`;
      if (!combos[key]) combos[key] = [];
      combos[key].push(r);
    }
    const comboKeys = Object.keys(combos);
    if (!comboKeys.length) return null;
    const correct = comboKeys.filter((k) =>
      combos[k].some(
        (r) => mapValue(classNameMap, col(r, "actual_class")) === mapValue(classNameMap, col(r, "predicted_class"))
      )
    ).length;
    return correct / comboKeys.length;
  })();

  // Unchanged from raw — sticker fields don't involve class names.
  // Sticker detector accuracy: pooled, over Sticker-type annotations only,
  // using the gpd column (same shape as GPD accuracy, just scoped to stickers).
  let stickerDetAcc: number | null = null;
  let stickerValAcc: number | null = null;
  if (stickerRows.length) {
    const detTotal = stickerRows.filter((r) => col(r, "gpd") !== "");
    const detCorrect = detTotal.filter((r) => col(r, "gpd") === "0").length;
    stickerDetAcc = detTotal.length ? detCorrect / detTotal.length : null;

    const valRows = stickerRows.filter(
      (r) => col(r, "sticker_value_actual") !== "" && col(r, "sticker_value_predicted") !== ""
    );
    const valCorrect = valRows.filter(
      (r) => col(r, "sticker_value_actual") === col(r, "sticker_value_predicted")
    ).length;
    stickerValAcc = valRows.length ? valCorrect / valRows.length : null;
  }

  const imageCount = new Set(rows.map((r) => col(r, "image_id")).filter(Boolean)).size;

  return {
    category_name: categoryName || "ALL",
    total_annotations: total,
    image_count: imageCount,
    gpd_accuracy: gpdAcc,
    group_accuracy: grpAcc,
    class_accuracy: clsAcc,
    openset_accuracy: osAcc,
    osa_accuracy: osaAcc,
    sticker_detector_accuracy: stickerDetAcc,
    sticker_value_accuracy: stickerValAcc,
  };
}

export function computeAllCategoriesDisplay(
  allRows: Row[],
  classNameMap: Record<string, string>
): { overall: CategoryResult; categories: CategoryResult[] } {
  const overall = computeMetricsForRowsDisplay(allRows, null, classNameMap)!;
  const byCategory = groupByCategoryName(allRows);
  const perCategory = [...byCategory.entries()]
    .map(([c, rows]) => computeMetricsForRowsDisplay(rows, c, classNameMap))
    .filter((c): c is CategoryResult => c !== null);
  return { overall, categories: perCategory };
}

export function buildConfusionPairsDisplay(allRows: Row[], classNameMap: Record<string, string>): ConfusionPair[] {
  // Group matrix is unaffected by the class-name mapping (no group-level
  // display names exist) — reuse the raw computation's group rows as-is.
  const groupPairs = buildConfusionPairs(allRows).filter((p) => p.matrix_type === "group");

  // Class matrix: same eligibility filter as buildConfusionPairs, but
  // actual/predicted values are passed through the mapping before
  // aggregating, so raw classes sharing a display name merge into one row.
  const skuRows = allRows.filter(
    (r) =>
      col(r, "annotation_type") !== "Sticker" &&
      !["", "None", "Shelf", "Sticker"].includes(col(r, "actual_group")) &&
      !["", "None"].includes(col(r, "actual_class"))
  );
  const byCategory = groupByCategoryName(skuRows);
  const categories = [...byCategory.keys()];
  const classPairs: ConfusionPair[] = [];

  for (const cat of categories) {
    const rows = byCategory.get(cat)!;
    const totals: Record<string, number> = {};
    const selfCounts: Record<string, number> = {};
    const allPredictions: Record<string, Record<string, number>> = {};

    for (const r of rows) {
      const a = mapValue(classNameMap, col(r, "actual_class"));
      const p = mapValue(classNameMap, col(r, "predicted_class"));
      if (!a || !p || a === "None") continue;
      totals[a] = (totals[a] || 0) + 1;
      if (a === p) selfCounts[a] = (selfCounts[a] || 0) + 1;
      if (!allPredictions[a]) allPredictions[a] = {};
      allPredictions[a][p] = (allPredictions[a][p] || 0) + 1;
    }

    for (const actual of Object.keys(totals)) {
      const total = totals[actual];
      const self = selfCounts[actual] || 0;
      const pct = (self / total) * 100;

      classPairs.push({
        category_name: cat,
        matrix_type: "class",
        actual_value: actual,
        predicted_value: actual,
        count: self,
        self_count: self,
        total_count: total,
        accuracy_pct: pct,
        is_mismatch: false,
      });

      if (allPredictions[actual]) {
        for (const pred of Object.keys(allPredictions[actual])) {
          if (pred !== actual) {
            classPairs.push({
              category_name: cat,
              matrix_type: "class",
              actual_value: actual,
              predicted_value: pred,
              count: allPredictions[actual][pred],
              self_count: self,
              total_count: total,
              accuracy_pct: pct,
              is_mismatch: true,
            });
          }
        }
      }
    }
  }

  return [...groupPairs, ...classPairs].sort((a, b) => a.accuracy_pct - b.accuracy_pct);
}
