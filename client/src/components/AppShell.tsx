// Persistent layout: header + shell are mounted once for all authenticated
// pages, so navigating only swaps the page content (no menu flicker).
import { Outlet } from 'react-router-dom';
import { LayoutShell } from '../Layout';
import { InsideShellContext } from './ShellContext';

export default function AppShell() {
  return (
    <LayoutShell>
      <InsideShellContext.Provider value={true}>
        <Outlet />
      </InsideShellContext.Provider>
    </LayoutShell>
  );
}
