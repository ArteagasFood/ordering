import { describe, it, expect } from 'vitest';
import {
  resolvePreference,
  buildCutoffReminder,
  buildReconciliationDigest,
  buildMonthCloseAlert,
  type PolicyRow,
} from './notifications.service';

/**
 * Tests for the notifications slice's pure logic (TDD §14): the per-user preference
 * resolution (a boolean specialization of the §5.2 settings resolver) and the three
 * transactional-message builders (§14.1). DB-backed query helpers are exercised in
 * integration; here we pin the precedence rules and the composed text shapes.
 */

const policy = (over: Partial<PolicyRow>): PolicyRow => ({
  trigger: 'cutoff_reminder',
  globalDefault: false,
  overrideEnabled: null,
  locked: false,
  ...over,
});

describe('resolvePreference precedence (TDD §5.2)', () => {
  it('lets a locked admin override win over the user value and reports it locked', () => {
    const r = resolvePreference('cutoff_reminder', false, policy({ overrideEnabled: true, locked: true }));
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: true, locked: true });
  });

  it('lets a locked admin override force OFF even when the user opted in', () => {
    const r = resolvePreference('cutoff_reminder', true, policy({ overrideEnabled: false, locked: true }));
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: false, locked: true });
  });

  it('ignores an override that is present but NOT locked (advisory only)', () => {
    // User explicitly opted out; an unlocked override must not silently flip it on.
    const r = resolvePreference('cutoff_reminder', false, policy({ overrideEnabled: true, locked: false }));
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: false, locked: false });
  });

  it('prefers the user value over the global default', () => {
    const r = resolvePreference('cutoff_reminder', true, policy({ globalDefault: false }));
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: true, locked: false });
  });

  it('treats a user value of false as set, not as missing (does not fall to globalDefault=true)', () => {
    const r = resolvePreference('cutoff_reminder', false, policy({ globalDefault: true }));
    expect(r.enabled).toBe(false);
    expect(r.locked).toBe(false);
  });

  it('falls to the global default when the user has no stored value', () => {
    const r = resolvePreference('cutoff_reminder', null, policy({ globalDefault: true }));
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: true, locked: false });
  });

  it('falls to the system default (false) when there is no user value and no policy', () => {
    const r = resolvePreference('cutoff_reminder', null, null);
    expect(r).toEqual({ trigger: 'cutoff_reminder', enabled: false, locked: false });
  });

  it('treats a lock with no concrete override value as not forcing a value (resolves below it)', () => {
    // locked but overrideEnabled null → no override candidate; user value applies.
    const r = resolvePreference('cutoff_reminder', true, policy({ overrideEnabled: null, locked: true }));
    expect(r.enabled).toBe(true);
    expect(r.locked).toBe(false);
  });
});

describe('buildCutoffReminder (TDD §8.2, §14.1)', () => {
  it('names the producer, day, and live cutoff in subject and body', () => {
    const { subject, body } = buildCutoffReminder({
      buyerStoreName: 'Maple St Market',
      producerStoreName: 'Central Bakery',
      serviceDay: '2026-06-19',
      cutoffTime: '06:30',
    });
    expect(subject).toContain('Central Bakery');
    expect(subject).toContain('06:30');
    expect(body).toContain('Maple St Market');
    expect(body).toContain('2026-06-19');
    expect(body).toContain('06:30');
  });
});

describe('buildReconciliationDigest (TDD §10.2, §14.1)', () => {
  it('summarizes a single empty digest as nothing-to-review', () => {
    const { subject, body } = buildReconciliationDigest({ date: '2026-06-18', flags: [] });
    expect(subject).toContain('0 flagged');
    expect(body).toContain('No lines were flagged');
  });

  it('lists each flagged line with its variance and direction', () => {
    const { subject, body } = buildReconciliationDigest({
      date: '2026-06-18',
      flags: [
        {
          buyerStoreName: 'Maple St Market',
          producerStoreName: 'Central Bakery',
          itemName: 'Baguette',
          serviceDay: '2026-06-18',
          orderedQty: 40,
          receivedQty: 25,
          variance: -15,
        },
      ],
    });
    expect(subject).toContain('1 flagged line');
    expect(body).toContain('Baguette');
    expect(body).toContain('-15');
    expect(body).toContain('short');
  });
});

describe('buildMonthCloseAlert (TDD §12.3, §14.1)', () => {
  it('formats the month and total as currency', () => {
    const { subject, body } = buildMonthCloseAlert({
      month: '2026-05',
      statementCount: 3,
      totalCents: 123456,
    });
    expect(subject).toContain('2026-05');
    expect(body).toContain('$1,234.56');
    expect(body).toContain('3 statements');
  });
});
