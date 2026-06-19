/**
 * Admin slice page exports (TDD §3, §5.1, §6.1). The integrator registers these in the
 * frontend route registry (apps/web/src/app/routes.tsx) during Phase 2, gated to the
 * admin role. Each page guards itself with `AdminGate` as a usability safety net.
 */
export { StoresAdminPage } from './StoresAdminPage';
export { UsersAdminPage } from './UsersAdminPage';
export { FeatureFlagsPage } from './FeatureFlagsPage';
