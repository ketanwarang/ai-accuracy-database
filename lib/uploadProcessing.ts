// Shared CSV-upload persistence logic, used by /upload (single-file and
// multi-file queue paths) and the project-scoped uploader. Computes and
// saves the raw-view metrics exactly as before, persists the minimal
// per-row data needed to recompute a Display Name view later, and — if
// the project already has a CGC mapping — computes and saves the
// display-view metrics immediately too.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Row,
  col,
  computeAllCategories,
  buildConfusionPairs,
  computeAllCategoriesDisplay,
  buildConfusionPairsDisplay,
} from "@/lib/accuracy";

function buildAnnotationRow(r: Row, snapshotId: string) {
  const shopId = col(r, "shop_id", "shopid");
  const shopName = col(r, "shop_name", "shopname");
  return {
    snapshot_id: snapshotId,
    category_name: col(r, "category_name"),
    annotation_type: col(r, "annotation_type"),
    shop_key: shopId || shopName || "__no_shop__",
    row_date: col(r, "date"),
    gpd: col(r, "gpd"),
    wrong_group: col(r, "wrong_group"),
    wrong_class: col(r, "wrong_class"),
    actual_group: col(r, "actual_group"),
    predicted_group: col(r, "predicted_group"),
    actual_class: col(r, "actual_class"),
    predicted_class: col(r, "predicted_class"),
    openset_actual: col(r, "openset_actual"),
    openset_prediction: col(r, "openset_prediction"),
    sticker_value_actual: col(r, "sticker_value_actual"),
    sticker_value_predicted: col(r, "sticker_value_predicted"),
    image_id: col(r, "image_id"),
  };
}

// Batches are independent (no shared row identity), so we fire a handful
// concurrently instead of one at a time — for a large df_out export this is
// the dominant cost of an upload, and serial round-trips from the browser
// were the main reason uploads felt slow.
async function insertBatched(supabase: SupabaseClient, table: string, rows: any[], batchSize = 2000, concurrency = 4) {
  const batches: any[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= batches.length) return;
      const { error } = await supabase.from(table).insert(batches[i]);
      if (error) throw new Error(`Failed to save ${table}: ` + error.message);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
}

export interface SaveSnapshotParams {
  projectId: string;
  testDate: string;
  fileName: string;
  rows: Row[];
  uploaderEmail: string | null;
  onProgress?: (message: string, pct: number) => void;
}

export interface SaveSnapshotResult {
  testDate: string;
  categoryCount: number;
}

export async function saveSnapshotData(
  supabase: SupabaseClient,
  { projectId, testDate, fileName, rows, uploaderEmail, onProgress }: SaveSnapshotParams
): Promise<SaveSnapshotResult> {
  onProgress?.("Computing accuracy metrics…", 10);
  const { categories } = computeAllCategories(rows);
  const confusionPairs = buildConfusionPairs(rows);

  // Find or create the snapshot row for this project+date (once, not per category).
  let snapshotId: string;
  const { data: existingSnap } = await supabase
    .from("snapshots")
    .select("id")
    .eq("project_id", projectId)
    .eq("test_date", testDate)
    .maybeSingle();

  if (existingSnap) {
    snapshotId = existingSnap.id;
  } else {
    const { data: snapRow, error: snapErr } = await supabase
      .from("snapshots")
      .insert({ project_id: projectId, test_date: testDate, file_name: fileName, row_count: rows.length, uploaded_by: uploaderEmail })
      .select()
      .single();
    if (snapErr || !snapRow) throw new Error("Failed to create snapshot: " + snapErr?.message);
    snapshotId = snapRow.id;
  }

  onProgress?.("Saving accuracy metrics…", 25);

  const { data: allSnapsForProject } = await supabase.from("snapshots").select("id").eq("project_id", projectId);
  const allSnapIds = (allSnapsForProject || []).map((s: any) => s.id);

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    onProgress?.(`Saving ${cat.category_name} (${ci + 1}/${categories.length})…`, 25 + Math.floor((ci / categories.length) * 45));

    if (allSnapIds.length) {
      await supabase.from("confusion_pairs").delete().in("snapshot_id", allSnapIds).eq("category_name", cat.category_name).eq("view_mode", "raw");
    }
    await supabase.from("category_metrics").delete().eq("snapshot_id", snapshotId).eq("category_name", cat.category_name).eq("view_mode", "raw");

    const { error: catErr } = await supabase.from("category_metrics").insert({
      snapshot_id: snapshotId,
      category_name: cat.category_name,
      view_mode: "raw",
      total_annotations: cat.total_annotations,
      image_count: cat.image_count,
      gpd_accuracy: cat.gpd_accuracy,
      group_accuracy: cat.group_accuracy,
      class_accuracy: cat.class_accuracy,
      openset_accuracy: cat.openset_accuracy,
      osa_accuracy: cat.osa_accuracy,
      sticker_detector_accuracy: cat.sticker_detector_accuracy,
      sticker_value_accuracy: cat.sticker_value_accuracy,
    });
    if (catErr) throw new Error(`Failed to save ${cat.category_name}: ` + catErr.message);

    const catPairs = confusionPairs.filter((p) => p.category_name === cat.category_name);
    if (catPairs.length) {
      await insertBatched(
        supabase,
        "confusion_pairs",
        catPairs.map((p) => ({
          snapshot_id: snapshotId,
          category_name: p.category_name,
          matrix_type: p.matrix_type,
          view_mode: "raw",
          actual_value: p.actual_value,
          predicted_value: p.predicted_value,
          count: p.count,
          self_count: p.self_count,
          total_count: p.total_count,
          accuracy_pct: p.accuracy_pct,
          is_mismatch: p.is_mismatch,
        }))
      );
    }
  }

  // Persist the minimal per-row data needed to (re)compute a Display Name
  // view later, whenever a CGC sheet is uploaded or changed for this project.
  // Scoped to just the categories in *this* upload — a project can be built
  // up by uploading one category's file at a time to the same date, and an
  // upload for category B must not delete category A's previously-saved rows.
  onProgress?.("Saving row-level data for future recalculation…", 72);
  const uploadedCategoryNames = categories.map((c) => c.category_name);
  await supabase.from("snapshot_annotations").delete().eq("snapshot_id", snapshotId).in("category_name", uploadedCategoryNames);
  await insertBatched(supabase, "snapshot_annotations", rows.map((r) => buildAnnotationRow(r, snapshotId)));

  // If this project already has a CGC sheet uploaded, compute and save the
  // display-view metrics right away too — no need to wait for a CGC re-upload.
  onProgress?.("Checking for a CGC sheet…", 85);
  const { data: cgcRows } = await supabase.from("project_cgc_mappings").select("class_name, display_name").eq("project_id", projectId);
  if (cgcRows && cgcRows.length) {
    const classNameMap: Record<string, string> = {};
    for (const r of cgcRows) classNameMap[r.class_name] = r.display_name;

    onProgress?.("Computing display-name metrics…", 88);
    const { categories: displayCategories } = computeAllCategoriesDisplay(rows, classNameMap);
    const displayPairs = buildConfusionPairsDisplay(rows, classNameMap);

    for (const cat of displayCategories) {
      if (allSnapIds.length) {
        await supabase.from("confusion_pairs").delete().in("snapshot_id", allSnapIds).eq("category_name", cat.category_name).eq("view_mode", "display");
      }
      // Scoped to this category only — an unscoped delete here was wiping
      // every other category's display-view metrics for this snapshot on
      // every single-category upload (the Display Name view bug).
      await supabase.from("category_metrics").delete().eq("snapshot_id", snapshotId).eq("category_name", cat.category_name).eq("view_mode", "display");

      await supabase.from("category_metrics").insert({
        snapshot_id: snapshotId,
        category_name: cat.category_name,
        view_mode: "display",
        total_annotations: cat.total_annotations,
        image_count: cat.image_count,
        gpd_accuracy: cat.gpd_accuracy,
        group_accuracy: cat.group_accuracy,
        class_accuracy: cat.class_accuracy,
        openset_accuracy: cat.openset_accuracy,
        osa_accuracy: cat.osa_accuracy,
        sticker_detector_accuracy: cat.sticker_detector_accuracy,
        sticker_value_accuracy: cat.sticker_value_accuracy,
      });

      const catPairs = displayPairs.filter((p) => p.category_name === cat.category_name);
      if (catPairs.length) {
        await insertBatched(
          supabase,
          "confusion_pairs",
          catPairs.map((p) => ({
            snapshot_id: snapshotId,
            category_name: p.category_name,
            matrix_type: p.matrix_type,
            view_mode: "display",
            actual_value: p.actual_value,
            predicted_value: p.predicted_value,
            count: p.count,
            self_count: p.self_count,
            total_count: p.total_count,
            accuracy_pct: p.accuracy_pct,
            is_mismatch: p.is_mismatch,
          }))
        );
      }
    }
  }

  onProgress?.("Done", 100);
  return { testDate, categoryCount: categories.length };
}
