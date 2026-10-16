import { createContext } from 'react';

// true when rendered inside the persistent AppShell (see AppShell.tsx).
export const InsideShellContext = createContext(false);
