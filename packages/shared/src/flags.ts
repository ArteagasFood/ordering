import { z } from 'zod';
import type { Id } from './common';

/**
 * Feature-flag registry contract (TDD §6.1). Flags are first-class and govern
 * application *capabilities*, never catalog or menu structure. Admin-only.
 */
export interface FeatureFlagDto {
  id: Id;
  key: string;
  description: string;
  enabled: boolean;
}

/** Admin: register a new feature flag. */
export const zCreateFlagRequest = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_.]+$/, 'lowercase letters, digits, dot and underscore only'),
  description: z.string().max(280).default(''),
  enabled: z.boolean().default(false),
});
export type CreateFlagRequest = z.infer<typeof zCreateFlagRequest>;

/** Admin: toggle or re-describe a flag. */
export const zUpdateFlagRequest = z.object({
  description: z.string().max(280).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateFlagRequest = z.infer<typeof zUpdateFlagRequest>;
