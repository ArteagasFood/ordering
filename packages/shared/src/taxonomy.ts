import { z } from 'zod';
import type { Id } from './common';

/**
 * Taxonomy contract (TDD §5.3). Taxonomy is centralized: the admin defines
 * departments and the categories within them; every store sees the identical
 * structure and only files its data into it. Stores never reorganize taxonomy.
 */

export interface DepartmentDto {
  id: Id;
  name: string;
  active: boolean;
}

export interface CategoryDto {
  id: Id;
  name: string;
  departmentId: Id;
  departmentName: string;
  active: boolean;
}

export const zCreateDepartmentRequest = z.object({
  name: z.string().min(1).max(120),
});
export type CreateDepartmentRequest = z.infer<typeof zCreateDepartmentRequest>;

export const zCreateCategoryRequest = z.object({
  name: z.string().min(1).max(120),
  departmentId: z.string().uuid(),
});
export type CreateCategoryRequest = z.infer<typeof zCreateCategoryRequest>;

export const zUpdateTaxonomyNodeRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
});
export type UpdateTaxonomyNodeRequest = z.infer<typeof zUpdateTaxonomyNodeRequest>;
