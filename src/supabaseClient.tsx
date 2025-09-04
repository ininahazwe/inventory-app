// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY; // ← ton nom de variable

if (!url) throw new Error("VITE_SUPABASE_URL is missing");
if (!key) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is missing");

export const supabase = createClient(url, key);
