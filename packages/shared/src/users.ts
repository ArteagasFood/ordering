import { z } from 'zod';
import { ROLES } from './enums';
import type { Role } from './enums';
import type { Id } from './common';

/**
 * User administration contract (TDD §3, §4). The admin provisions all accounts:
 * assigns a role and (for Store Users) a store, and sets/resets passwords. There
 * is no self-service signup or password reset.
 */
export interface UserDto {
  id: Id;
  email: string;
  name: string;
  role: Role;
  /** Null for global Admin/AP users; required for Store Users (TDD §3.1). */
  storeId: Id | null;
  storeName: string | null;
  active: boolean;
}

const zRole = z.enum(ROLES);

/**
 * Admin: create a user. A Store User must carry a storeId; Admin/AP must not.
 * The cross-field rule is enforced both here and in the service layer.
 */
export const zCreateUserRequest = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    role: zRole,
    storeId: z.string().uuid().nullable().default(null),
    password: z.string().min(6).max(200),
  })
  .refine((u) => (u.role === 'store_user') === (u.storeId !== null), {
    message: 'Store Users require a storeId; Admin/AP must not have one.',
    path: ['storeId'],
  });
export type CreateUserRequest = z.infer<typeof zCreateUserRequest>;

/** Admin: update a user's profile/role/store/active flag. */
export const zUpdateUserRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  role: zRole.optional(),
  storeId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof zUpdateUserRequest>;

/** Admin: set or reset a user's password (TDD §4 — admin-managed reset). */
export const zSetPasswordRequest = z.object({
  password: z.string().min(6).max(200),
});
export type SetPasswordRequest = z.infer<typeof zSetPasswordRequest>;
