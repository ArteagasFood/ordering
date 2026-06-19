import { useState } from 'react';
import { Users as UsersIcon, Plus, Power, Save, KeyRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ROLES } from '@panaderia/shared';
import type {
  UserDto,
  StoreDto,
  Role,
  CreateUserRequest,
  UpdateUserRequest,
  SetPasswordRequest,
} from '@panaderia/shared';
import { AdminGate } from './AdminGate';
import { useResource } from './useResource';

/**
 * User administration (TDD §3, §4). The admin provisions every account: role, store
 * assignment, and password. The store_user ⇔ storeId rule is mirrored in the UI (a
 * Store User must pick a store; Admin/AP must not) and enforced again on the server.
 * Passwords are write-only — set on create and via an explicit reset; never displayed.
 */

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  accounts_payable: 'Accounts Payable',
  store_user: 'Store User',
};

/** A native select styled with the design tokens (no Select primitive in the shared kit). */
function Select(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </select>
  );
}

/** Options for the store-assignment dropdown, limited to active stores. */
function StoreOptions({ stores }: { stores: StoreDto[] }) {
  return (
    <>
      <option value="">— none (global) —</option>
      {stores
        .filter((s) => s.active)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </>
  );
}

function CreateUserForm({ stores, onCreated }: { stores: StoreDto[]; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('store_user');
  const [storeId, setStoreId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsStore = role === 'store_user';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: CreateUserRequest = {
        email,
        name,
        role,
        storeId: needsStore ? (storeId || null) : null,
        password,
      };
      await api.post<UserDto>('/users', payload);
      setEmail('');
      setName('');
      setRole('store_user');
      setStoreId('');
      setPassword('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the user.');
    } finally {
      setBusy(false);
    }
  }

  const valid =
    email.trim() && name.trim() && password.length >= 6 && (!needsStore || storeId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> Add a user
        </CardTitle>
        <CardDescription>Store Users must be assigned a store; Admin and AP are global.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nu-email">Email</Label>
            <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-name">Name</Label>
            <Input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-role">Role</Label>
            <Select
              id="nu-role"
              value={role}
              onChange={(v) => {
                const next = v as Role;
                setRole(next);
                if (next !== 'store_user') setStoreId('');
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-store">Store</Label>
            <Select id="nu-store" value={storeId} onChange={setStoreId} disabled={!needsStore}>
              <StoreOptions stores={stores} />
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nu-pw">Initial password</Label>
            <Input
              id="nu-pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={busy || !valid}>
          {busy ? 'Adding…' : 'Add user'}
        </Button>
      </CardContent>
    </Card>
  );
}

function PasswordResetRow({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post<void>(`/users/${userId}/password`, { password } satisfies SetPasswordRequest);
      setPassword('');
      setOpen(false);
      setMsg('Password updated.');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" /> Reset password
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        autoComplete="new-password"
        className="max-w-xs"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password (6+ chars)"
      />
      <Button size="sm" onClick={reset} disabled={busy || password.length < 6}>
        Set
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

function UserRow({
  user,
  stores,
  onChanged,
}: {
  user: UserDto;
  stores: StoreDto[];
  onChanged: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [storeId, setStoreId] = useState(user.storeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsStore = role === 'store_user';
  const dirty = name !== user.name || role !== user.role || (storeId || null) !== user.storeId;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const patch: UpdateUserRequest = {
        name,
        role,
        storeId: needsStore ? (storeId || null) : null,
      };
      await api.patch<UserDto>(`/users/${user.id}`, patch);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      if (user.active) {
        await api.del<UserDto>(`/users/${user.id}`);
      } else {
        await api.patch<UserDto>(`/users/${user.id}`, { active: true } satisfies UpdateUserRequest);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn(!user.active && 'opacity-60')}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{user.email}</span>
          {!user.active && <span className="text-xs font-medium text-destructive">Inactive</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`name-${user.id}`}>Name</Label>
            <Input id={`name-${user.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`role-${user.id}`}>Role</Label>
            <Select
              id={`role-${user.id}`}
              value={role}
              onChange={(v) => {
                const next = v as Role;
                setRole(next);
                if (next !== 'store_user') setStoreId('');
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`store-${user.id}`}>Store</Label>
            <Select id={`store-${user.id}`} value={storeId} onChange={setStoreId} disabled={!needsStore}>
              <StoreOptions stores={stores} />
            </Select>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy || !dirty || !name.trim()}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button
            size="sm"
            variant={user.active ? 'destructive' : 'secondary'}
            onClick={toggleActive}
            disabled={busy}
          >
            <Power className="h-4 w-4" /> {user.active ? 'Deactivate' : 'Reactivate'}
          </Button>
          <PasswordResetRow userId={user.id} />
        </div>
      </CardContent>
    </Card>
  );
}

export function UsersAdminPage() {
  const usersRes = useResource<UserDto[]>('/users');
  const storesRes = useResource<StoreDto[]>('/stores');
  const stores = storesRes.data ?? [];

  return (
    <AdminGate>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <UsersIcon className="h-6 w-6 text-primary" /> Users
          </h1>
          <p className="text-muted-foreground">Provision accounts, assign roles and stores, reset passwords.</p>
        </div>

        <CreateUserForm stores={stores} onCreated={usersRes.reload} />

        {usersRes.loading && <p className="text-sm text-muted-foreground">Loading users…</p>}
        {usersRes.error && <p role="alert" className="text-sm text-destructive">{usersRes.error}</p>}

        <div className="space-y-4">
          {usersRes.data?.map((u) => (
            <UserRow key={u.id} user={u} stores={stores} onChanged={usersRes.reload} />
          ))}
          {usersRes.data && usersRes.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          )}
        </div>
      </div>
    </AdminGate>
  );
}
