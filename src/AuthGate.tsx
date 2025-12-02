// src/AuthGate.tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./lib/supabaseClient";
import logo from "./assets/mfwa-logo.png";
import { BlurIn } from "./components/TextBlur.tsx";
import EmailWhitelistCheck from "./components/EmailWhitelistCheck"; // NOUVEAU

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState
        Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]
    >(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setIsLoading(false);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
            setSession(s);
            setIsLoading(false);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    if (isLoading) {
        return (
            <div className="auth-shell loader-shell">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="spinner"
                />
            </div>
        );
    }

    if (!session) {
        return (
            <div className="auth-shell">
                <div className="grid-bg" aria-hidden />

                <div className="login-wrap">
                    <section className="left-col">
                        <div className="mini-topbar">
                            <img src={logo} alt="MFWA" className="brand" />
                            <div className="lang-chip">En</div>
                        </div>

                        <BlurIn>
                            Furniture
                            <br />
                            Management
                        </BlurIn>
                    </section>

                    <section className="right-col">
                        <motion.div
                            initial={{ opacity: 0, x: 0, scale: 0.5 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            transition={{ duration: 1.5 }}
                            className="auth-card"
                        >
                            <div className="auth-card-head">
                                <div className="avatar">
                                    <img src={logo} alt="MFWA" />
                                </div>
                            </div>

                            {/* REMPLACER Auth UI par notre composant */}
                            <EmailWhitelistCheck />
                        </motion.div>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key="app"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}