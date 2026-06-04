import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Minimal shapes the recommendation engine needs. Kept local so the engine is a
// pure function over plain data — the caller (putaway-tasks list) owns DB access.
export interface TaskForRec {
  id: string;
  warehouseId: string;
  itemType: string | null;
}
export interface RuleRow {
  warehouseId: string;
  zone: string;
  productCategory: string | null;
  priority: number;
}
export interface LocationRow {
  id: string;
  code: string;
  warehouseId: string;
  zone: string | null;
}
export interface Recommendation {
  recommendedLocationId: string | null;
  recommendedLocationCode: string | null;
}

@Injectable()
export class PutawayRulesService {
  constructor(private readonly prisma: PrismaService) {}

  // Read-only listing for inspection / the future rule-management UI.
  // Write CRUD is intentionally deferred to Sprint 6; rules are seeded via SQL.
  async findAll(warehouseId?: string) {
    return this.prisma.putawayRule.findMany({
      where: warehouseId ? { warehouseId } : {},
      orderBy: [{ warehouseId: 'asc' }, { priority: 'desc' }],
    });
  }

  /**
   * Recommend an EMPTY location for each task. Pure function over pre-fetched data.
   *
   * For each task, in input order:
   *   1. pick the highest-priority active rule (same warehouse) whose productCategory
   *      matches the product's itemType — an exact match wins over the '*'/NULL catch-all;
   *   2. take the first EMPTY location in that rule's zone (same warehouse) not already
   *      handed to an earlier task in THIS response;
   *   3. fall back to any EMPTY same-warehouse location; else null (operator picks manually).
   *
   * Dedup is response-scoped: within one list() call two tasks never receive the same
   * single-occupancy location. This is advisory only — it is NOT a reservation. putaway()
   * remains the source of truth that actually flips a location to OCCUPIED.
   *
   * @param rules MUST be pre-sorted by priority DESC.
   */
  recommendForTasks(
    tasks: TaskForRec[],
    rules: RuleRow[],
    emptyLocations: LocationRow[],
  ): Map<string, Recommendation> {
    const used = new Set<string>();
    const result = new Map<string, Recommendation>();

    for (const task of tasks) {
      const cat = task.itemType ?? null;
      const whRules = rules.filter((r) => r.warehouseId === task.warehouseId);
      const rule =
        whRules.find((r) => r.productCategory === cat) ??
        whRules.find((r) => r.productCategory === '*' || r.productCategory === null);

      let loc: LocationRow | undefined;
      if (rule) {
        loc = emptyLocations.find(
          (l) =>
            l.warehouseId === task.warehouseId &&
            l.zone === rule.zone &&
            !used.has(l.id),
        );
      }
      if (!loc) {
        loc = emptyLocations.find(
          (l) => l.warehouseId === task.warehouseId && !used.has(l.id),
        );
      }

      if (loc) {
        used.add(loc.id);
        result.set(task.id, {
          recommendedLocationId: loc.id,
          recommendedLocationCode: loc.code,
        });
      } else {
        result.set(task.id, {
          recommendedLocationId: null,
          recommendedLocationCode: null,
        });
      }
    }

    return result;
  }
}
