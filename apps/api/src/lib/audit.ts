import { db } from '../db/client';
import { auditEntries } from '../db/schema';
import type { AuditAction } from '@panaderia/shared';
import type { Db } from '../db/client';

/**
 * Audit-log writer (TDD §16.2). The single entry point for recording a sensitive
 * change. Entries are append-only — never updated or deleted — and capture who, what,
 * before/after, and a mandatory reason. This is the backbone of segregation of duties
 * (§3.2) and the settlement drill-down (§12.2).
 *
 * Accepts an optional transaction handle so a correction and its audit entry commit
 * atomically: either both land or neither does.
 */
export interface AuditInput {
  actorId: string;
  action: AuditAction;
  /** The entity touched, e.g. `order_line:${id}`. */
  target: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export async function writeAudit(input: AuditInput, tx: Db = db): Promise<void> {
  await tx.insert(auditEntries).values({
    actorId: input.actorId,
    action: input.action,
    target: input.target,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    reason: input.reason,
  });
}
