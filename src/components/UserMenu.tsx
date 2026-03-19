// src/components/UserMenu.tsx
import { auth } from '../lib/apiClient';

export default function UserMenu() {
  return (
    <button onClick={() => auth.signOut()}>
      Se déconnecter
    </button>
  );
}
