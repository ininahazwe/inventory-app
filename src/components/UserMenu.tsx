// src/components/UserMenu.tsx
import { supabase } from "../lib/supabaseClient";

export default function UserMenu() {
    return (
        <button onClick={() => supabase.auth.signOut()}>
            Se déconnecter
        </button>
    );
}
