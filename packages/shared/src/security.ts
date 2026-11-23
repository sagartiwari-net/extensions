/** 0 off · 1 warn · 2 block billing URLs · 3 hard (opt-in) */
export const SECURITY_TIERS = [0, 1, 2, 3] as const;
export type SecurityTier = (typeof SECURITY_TIERS)[number];

export const INTEGRITY_MODES = ['off', 'warn', 'block'] as const;
export type IntegrityMode = (typeof INTEGRITY_MODES)[number];