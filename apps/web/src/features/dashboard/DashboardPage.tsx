import { useAuth } from '@/lib/auth-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing dashboard placeholder (Phase 0). The real role-aware dashboard — daily
 * actions, cutoff countdown, reconciliation exceptions, settlement summary — is
 * assembled in Phase 2 from the slice features. For now it confirms the authenticated
 * shell works and greets the user by store/role.
 */
export function DashboardPage() {
  const user = useAuth((s) => s.user);
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Good morning, {user.name.split(' ')[0]}</h1>
        <p className="text-muted-foreground">
          {user.storeName
            ? `Signed in for ${user.storeName}.`
            : 'Signed in with organization-wide access.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Welcome to Panadería Exchange</CardTitle>
          <CardDescription>
            The foundation is in place. Daily tools — ordering, the bake list, receiving,
            reconciliation, and settlement — appear here as each is wired in.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Role: <span className="font-medium text-foreground">{user.role}</span>
        </CardContent>
      </Card>
    </div>
  );
}
