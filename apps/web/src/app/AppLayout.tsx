import { Outlet } from 'react-router-dom';
import { Header } from './Header';

/** Authenticated app frame: persistent header above the routed page content. */
export function AppLayout() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
