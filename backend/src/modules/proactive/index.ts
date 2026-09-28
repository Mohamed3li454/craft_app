/**
 * Proactive Intelligence Module (Phases 7.1, 7.2 & 7.3)
 *
 * Public interface for in-turn opportunity detection, policy resolution,
 * prompt guidance, deterministic eligibility gating, suppression rules,
 * persistence, and cron scheduling.
 */

export * from './types';
export * from './candidate_detector';
export * from './proactive_policy';
export * from './proactive_engine';
export * from './prompt_builder';
export * from './consent';
export * from './suppression_engine';
export * from './eligibility_gate';
export * from './proactive_action.repo';
export * from './proactive_scheduler';
