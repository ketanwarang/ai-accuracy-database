// Core accuracy computation logic for df_out CSV exports.
//
// IMPORTANT — calculation methodology (verified against ParallelDots'
// own reference report on 2026-06-30):
//
// 1. GPD accuracy = per-shop accuracy averaged across shops (not pooled).
//    Formula per shop: 1 - (rows where gpd=='1') / (total SKU rows in shop)
//
// 2. Group/Class accuracy = per-shop accuracy averaged across shops,
//    computed ONLY over rows where gpd=='0' (i.e. GPD succeeded —
//    you can't meaningfully score group/class correctness on a row
//    where detection itself failed). Uses the wrong_group/wrong_class
//    flags directly (authoritative — handles edge cases like
//    actual_group=="None" correctly, since those rows always have gpd=='1'
//    and get excluded by the gate).
//    Formula per shop: 1 - (gpd==0 rows where wrong_group=='1') / (gpd==0 row count)
//
// 3. Openset accuracy = simple POOLED accuracy across all SKU rows
//    (NOT per-shop averaged, NOT gpd-gated). Matches reference exactly.
//
// 4. OSA/SOS accuracy = simple pooled average of the osa_accuracy/
//    sos_accuracy columns when present (these are file-level percentage
//    columns from a different report shape, not computed from raw rows).
//
// If a file has no "Shop ID" column, all formulas degrade gracefully to
// pooled (single "shop") since there's nothing to average across.

export type Row = Record<string, string>;

export function col(row: Row, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const n of names) {
    const target = n.toLowerCase().replace(/[_\s]/g, "");
    const found = keys.find(
      (k) => k.trim().toLowerCase().replace(/[_\s]/g, "") === target
    );
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
  sos_accuracy: number | null;
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

function getShopKey(row: Row): string {
  const shopId = col(row, "shop_id", "shopid");
  const shopName = col(row, "shop_name", "shopname");
  return shopId || shopName || "__no_shop__";
}

function groupByShop(rows: Row[]): Row[][] {
  const map: Record<string, Row[]> = {};
  for (const r of rows) {
    const key = getShopKey(r);
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return Object.values(map);
}

// Per-shop average of a boolean-flag-derived accuracy.
// failFlag: column name whose value '1' marks a failure for that row.
// rows passed in should already be the eligible/gated rowset.
function perShopAverageAccuracy(rows: Row[], failFlagCol: string): number | null {
  if (!rows.length) return null;
  const shops = groupByShop(rows);
  const shopAccuracies = shops
    .map((shopRows) => {
      if (!shopRows.length) return null;
      const fails = shopRows.filter((r) => col(r, failFlagCol) === "1").length;
      return 1 - fails / shopRows.length;
    })
    .filter((v): v is number => v !== null);
  if (!shopAccuracies.length) return null;
  return shopAccuracies.reduce((a, b) => a + b, 0) / shopAccuracies.length;
}

export function computeCategoryMetrics(allRows: Row[], categoryName: string | null): CategoryResult | null {
  const rows = categoryName
    ? allRows.filter((r) => col(r, "category_name") === categoryName)
    : allRows;
  if (!rows.length) return null;

  const skuRows = rows.filter((r) => col(r, "annotation_type") !== "Sticker");
  const stickerRows = rows.filter((r) => col(r, "annotation_type") === "Sticker");

  const total = skuRows.length || rows.length;

  // GPD accuracy: per-shop average, ungated (GPD measures itself).
  const gpdAcc = perShopAverageAccuracy(skuRows, "gpd");

  // Group/Class accuracy: per-shop average, GATED to rows where gpd=='0'
  // (GPD succeeded) — can't score group/class on a detection failure.
  const gpdOkRows = skuRows.filter((r) => col(r, "gpd") === "0");
  const grpAcc = perShopAverageAccuracy(gpdOkRows, "wrong_group");
  const clsAcc = perShopAverageAccuracy(gpdOkRows, "wrong_class");

  // Openset accuracy: simple POOLED accuracy (not gated, not per-shop averaged).
  const osRows = skuRows.filter((r) => col(r, "openset_actual") !== "");
  const osCorrect = osRows.filter((r) => col(r, "openset_actual") === col(r, "openset_prediction")).length;
  const osAcc = osRows.length ? osCorrect / osRows.length : null;

  // SOS (Sticker On Shelf accuracy): per-shop average of sticker_accuracy on Sticker rows.
  // Sticker rows where sticker_value_predicted == sticker_value_actual => sticker_accuracy = 1.
  const sosAcc = (() => {
    const stickerRows = rows.filter((r) => col(r, "annotation_type") === "Sticker");
    if (!stickerRows.length) return null;
    const shops = groupByShop(stickerRows);
    const shopAccs = shops.map((shopRows) => {
      const vals = shopRows
        .map((r) => parseFloat(col(r, "sticker_accuracy")))
        .filter((v) => !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }).filter((v): v is number => v !== null);
    return shopAccs.length ? shopAccs.reduce((a, b) => a + b, 0) / shopAccs.length : null;
  })();

  // OSA (On Shelf Availability): per-shop % of self/comp_actual='self' SKU images
  // where at least one annotation has gpd==0 (detected successfully).
  // Falls back to null if no self-SKU rows exist in this export.
  const osaAcc = (() => {
    const selfSkuRows = skuRows.filter((r) => col(r, "self/comp_actual", "self_comp_actual") === "self");
    if (!selfSkuRows.length) return null;
    const shops = groupByShop(selfSkuRows);
    const shopAccs = shops.map((shopRows) => {
      // Group by image_id within this shop
      const byImage: Record<string, typeof shopRows> = {};
      for (const r of shopRows) {
        const imgId = col(r, "image_id", "imageid");
        if (!byImage[imgId]) byImage[imgId] = [];
        byImage[imgId].push(r);
      }
      const imageIds = Object.keys(byImage);
      if (!imageIds.length) return null;
      const available = imageIds.filter((id) => byImage[id].some((r) => col(r, "gpd") === "0")).length;
      return available / imageIds.length;
    }).filter((v): v is number => v !== null);
    return shopAccs.length ? shopAccs.reduce((a, b) => a + b, 0) / shopAccs.length : null;
  })();

  let stickerDetAcc: number | null = null;
  let stickerValAcc: number | null = null;
  if (stickerRows.length) {
    const detTotal = stickerRows.filter((r) => col(r, "openset_actual") !== "");
    const detCorrect = detTotal.filter((r) => col(r, "openset_actual") === col(r, "openset_prediction")).length;
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
    sos_accuracy: sosAcc,
    sticker_detector_accuracy: stickerDetAcc,
    sticker_value_accuracy: stickerValAcc,
  };
}

export function computeAllCategories(allRows: Row[]): { overall: CategoryResult; categories: CategoryResult[] } {
  const categories = [...new Set(allRows.map((r) => col(r, "category_name")).filter(Boolean))];
  const overall = computeCategoryMetrics(allRows, null)!;
  const perCategory = categories
    .map((c) => computeCategoryMetrics(allRows, c))
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
  const categories = [...new Set(skuRows.map((r) => col(r, "category_name")).filter(Boolean))];
  const pairs: ConfusionPair[] = [];

  for (const matrixType of ["class", "group"] as const) {
    const aCol = matrixType === "class" ? "actual_class" : "actual_group";
    const pCol = matrixType === "class" ? "predicted_class" : "predicted_group";

    for (const cat of categories) {
      const rows = skuRows.filter((r) => col(r, "category_name") === cat);

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
