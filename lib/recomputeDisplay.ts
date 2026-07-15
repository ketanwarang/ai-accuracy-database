// Recomputes the Display Name view (view_mode='display') for every
// snapshot in a project that has persisted row-level data, using the
// project's current CGC mapping. Runs whenever a CGC sheet is uploaded
// or re-uploaded. Mirrors the write pattern already used at upload time
// (lib/uploadProcessing.ts): category_metrics keeps one row per
// (snapshot, category) for historical trend tracking; confusion_pairs
// only ever holds the latest snapshot's rows per category.

import type { SupabaseClient } from "@supabase/supabase-js";
import { Row, computeAllCategoriesDisplay, buildConfusionPairsDisplay } from "@/lib/accuracy";

async function fetchAllAnnotations(supabase: SupabaseClient, snapshotId: string): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("snapshot_annotations")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .range(from, from + PAGE - 1);
    if (!data || !data.length) break;
    for (const a of data as any[]) {
      rows.push({
        category_name: a.category_name || "",
        annotation_type: a.annotation_type || "",
        // shop_key already encodes the same identity getShopKey() would
        // derive from shop_id/shop_name — reusing it as shop_id reproduces
        // identical per-shop grouping without needing both raw columns.
        shop_id: a.shop_key || "",
        shop_name: "",
        date: a.row_date || "",
        gpd: a.gpd || "",
        wrong_group: a.wrong_group || "",
        wrong_class: a.wrong_class || "",
        actual_group: a.actual_group || "",
        predicted_group: a.predicted_group || "",
        actual_class: a.actual_class || "",
        predicted_class: a.predicted_class || "",
        openset_actual: a.openset_actual || "",
        openset_prediction: a.openset_prediction || "",
        sticker_value_actual: a.sticker_value_actual || "",
        sticker_value_predicted: a.sticker_value_predicted || "",
        image_id: a.image_id || "",
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function insertBatched(supabase: SupabaseClient, table: string, rows: any[], batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + batchSize));
    if (error) throw new Error(`Failed to save ${table}: ` + error.message);
  }
}

export interface RecomputeResult {
  snapshotsUpdated: number;
  snapshotsSkipped: number;
}

export async function recomputeDisplayViewForProject(
  supabase: SupabaseClient,
  projectId: string,
  classNameMap: Record<string, string>,
  onProgress?: (message: string, pct: number) => void
): Promise<RecomputeResult> {
  onProgress?.("Finding snapshots…", 5);
  const { data: snapshots } = await supabase
    .from("snapshots")
    .select("id, test_date")
    .eq("project_id", projectId)
    .order("test_date", { ascending: true });
  const snapList = snapshots || [];
  const allSnapIds = snapList.map((s: any) => s.id);

  // Clear old display-view trend rows for this project; repopulated below.
  if (allSnapIds.length) {
    await supabase.from("category_metrics").delete().in("snapshot_id", allSnapIds).eq("view_mode", "display");
  }

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < snapList.length; i++) {
    const snap = snapList[i];
    onProgress?.(
      `Recomputing ${snap.test_date} (${i + 1}/${snapList.length})…`,
      10 + Math.floor((i / Math.max(snapList.length, 1)) * 85)
    );

    const rows = await fetchAllAnnotations(supabase, snap.id);
    if (!rows.length) {
      // No row-level data for this snapshot (uploaded before V2.0) —
      // nothing to recompute from; leave it with no display-view rows.
      skipped++;
      continue;
    }

    const { categories } = computeAllCategoriesDisplay(rows, classNameMap);
    const pairs = buildConfusionPairsDisplay(rows, classNameMap);

    for (const cat of categories) {
      await supabase.from("category_metrics").insert({
        snapshot_id: snap.id,
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

      // confusion_pairs only ever holds the latest snapshot's rows per
      // category — purge older display rows for this category across the
      // whole project before inserting this snapshot's, same as upload time.
      if (allSnapIds.length) {
        await supabase
          .from("confusion_pairs")
          .delete()
          .in("snapshot_id", allSnapIds)
          .eq("category_name", cat.category_name)
          .eq("view_mode", "display");
      }
      const catPairs = pairs.filter((p) => p.category_name === cat.category_name);
      if (catPairs.length) {
        await insertBatched(
          supabase,
          "confusion_pairs",
          catPairs.map((p) => ({
            snapshot_id: snap.id,
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
    updated++;
  }

  onProgress?.("Done", 100);
  return { snapshotsUpdated: updated, snapshotsSkipped: skipped };
}
