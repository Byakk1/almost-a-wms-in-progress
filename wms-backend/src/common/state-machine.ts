import { BadRequestException } from '@nestjs/common';

/**
 * Generic state machine utility.
 * Defines allowed transitions and enforces them at runtime.
 * Prevents frontend or accidental code from setting arbitrary statuses.
 */

export type TransitionMap<S extends string> = Partial<Record<S, S[]>>;

export function assertTransition<S extends string>(
  current: S,
  target: S,
  transitions: TransitionMap<S>,
  entityLabel = '单据',
): void {
  const allowed = transitions[current];
  if (!allowed || !allowed.includes(target)) {
    throw new BadRequestException(
      `${entityLabel}状态 [${current}] 不允许转为 [${target}]。允许的下一步：${allowed?.join(', ') || '无'}`,
    );
  }
}

// ─── Inbound (Receiving Order) State Machine ────────────────────────

export const RECEIVING_TRANSITIONS: TransitionMap<string> = {
  PENDING:            ['ARRIVED', 'EXCEPTION', 'CHECKING'],
  ARRIVED:            ['CHECKING', 'EXCEPTION'],
  CHECKING:           ['RECEIVING', 'EXCEPTION'],
  RECEIVING:          ['COMPLETED', 'EXCEPTION'],
  COMPLETED:          ['PUTAWAY_PENDING'],
  PUTAWAY_PENDING:    ['PUTAWAY_PARTIAL', 'PUTAWAY_COMPLETED'],
  PUTAWAY_PARTIAL:    ['PUTAWAY_COMPLETED'],
  PUTAWAY_COMPLETED:  [],  // terminal
  EXCEPTION:          ['EXCEPTION_CLOSED', 'CHECKING'],
  EXCEPTION_CLOSED:   [],  // terminal
};

// ─── Outbound State Machine ─────────────────────────────────────────

export const OUTBOUND_TRANSITIONS: TransitionMap<string> = {
  PENDING:        ['ALLOCATED', 'CANCELLED', 'EXCEPTION'],
  ALLOCATED:      ['WAVE_ASSIGNED', 'PICKING', 'CANCELLED', 'EXCEPTION'],
  WAVE_ASSIGNED:  ['PICKING', 'ALLOCATED', 'CANCELLED', 'EXCEPTION'],  // ALLOCATED = un-assign on wave cancel
  PICKING:        ['PICKED', 'EXCEPTION'],
  PICKED:         ['PACKING', 'EXCEPTION'],
  PACKING:        ['PACKED', 'EXCEPTION'],
  PACKED:         ['SHIPPED', 'EXCEPTION'],
  SHIPPED:        ['SIGNED'],
  SIGNED:         [],  // terminal
  EXCEPTION:      ['PENDING', 'CANCELLED'],  // can retry or cancel
  CANCELLED:      [],  // terminal
};

// ─── Wave State Machine (Sprint 5 item 3) ───────────────────────────

export const WAVE_TRANSITIONS: TransitionMap<string> = {
  PENDING:    ['RELEASED', 'CANCELLED'],
  RELEASED:   ['COMPLETED'],
  COMPLETED:  [],  // terminal
  CANCELLED:  [],  // terminal
};

// ─── Box (carton) State Machine ─────────────────────────────────────

export const BOX_TRANSITIONS: TransitionMap<string> = {
  PENDING:     ['MEASURED'],
  MEASURED:    ['SIGNED_OUT'],
  SIGNED_OUT:  [],  // terminal
};

