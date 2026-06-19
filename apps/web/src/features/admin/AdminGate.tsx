import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Admin-only wrapper for the admin slice (TDD §3.1, §17 — "never present a control that
 * will fail"). The route registry already gates these pages by role; this is a second,
 * in-component guard so a page rendered out of context still refuses to show admin
 * controls to a non-admin. It is a usability mirror of the server boundary, not the
 * boundary itself — every API call is independently authorized by the backend (§2.3).
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || user.role !== 'admin') {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardHeader>
          <CardTitle>Administrator access required</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This area is available only to global administrators.
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
