import type { AuditAction } from './enums';
import type { Id } from './common';

/**
 * Audit log contract (TDD §16.2). Every sensitive change writes an immutable entry
 * capturing who, when, before/after, and a reason. The audit log is the backbone of
 * segregation of duties and the settlement drill-down (TDD §12.2).
 */
export interface AuditEntryDto {
  id: Id;
  actorId: Id;
  actorName: string;
  action: AuditAction;
  /** The entity touched, e.g. 'order_line:<id>'. */
  target: string;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: string;
}
