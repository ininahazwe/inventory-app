import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import "./styles/theme.css"; // <-- important
import "./styles/login.css";
import logo from "./assets/mfwa-logo.png"

export default function Layout({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<any>(null);
    const navigate = useNavigate();

    useEffect(() => {
        // 1) état initial
        supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
        // 2) écoute des changements (login/logout/refresh)
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    const login = async () => {
        await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${window.location.origin}` }, // ajuste si tu as une route /auth/callback
        });
    };

    const logout = async () => {
        await supabase.auth.signOut();
        // navigate(0) déclenche un refresh soft; sinon setUser(null) suffit
        navigate(0);
    };

    return (
        <>

            <header className="site-shell">
                <div className="site-band">
                    <div className="site-left">
                        <div className="brand-dot">
                            <span>
                                <img src={logo} alt="logo"/>
                            </span>
                        </div>
                    </div>

                    <div className="site-center">
                        <span className="site-title">INVENTAIRE IT</span>
                    </div>

                    <div className="site-right">
                        {user ? (
                            <button className="pill red" onClick={logout}>Déconnexion</button>
                        ) : (
                            <button className="pill green" onClick={login}>Login</button>
                        )}
                    </div>
                </div>
            </header>

            <motion.main className="shell" /* ... */>
                <div className="shell-inner">
                    <div className="grid-bg" aria-hidden />
                    <div className="shell-body">{children}</div> {/* <-- nouveau wrapper */}
                </div>
            </motion.main>
        </>
    );
}
