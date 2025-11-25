import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import logo from "./assets/mfwa-logo.png";
import {BlurIn} from "./components/TextBlur.tsx";

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<
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
        
        // Redirection après login
        if (s) {
        const redirect = sessionStorage.getItem("redirectAfterLogin");
        if (redirect) {
            sessionStorage.removeItem("redirectAfterLogin");
            window.location.href = redirect;
        }
        }
    });
    
    return () => sub.subscription.unsubscribe();
    }, []);
    // Loader
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

    // PAGE DE CONNEXION (inspirée du visuel)
    if (!session) {
        return (
            <div className="auth-shell">
                {/* Fond quadrillé + fondu vers le bas */}
                <div className="grid-bg" aria-hidden />

                <div className="login-wrap">
                    {/* Colonne gauche - Texte / Branding */}
                    <section className="left-col">
                        <div className="mini-topbar">
                            <img src={logo} alt="MFWA" className="brand" />
                            <div className="lang-chip">En</div>
                        </div>

                        {/*<h1 className="hero-title">
                            Gestion
                            <br />
                            du mobilier
                            <br />
                            <span className="break">En temps</span>
                            <span className="pulse-badge" aria-hidden />
                            <span> réel</span>
                        </h1>*/}

                        <BlurIn>
                            Furniture
                            <br />
                            Management
                        </BlurIn>

                        {/*<button className="cta-ghost" type="button">
                            Site principal
                        </button>

                         <div className="kpis">
                            <div>
                                <strong>$4.7M</strong>
                                <span>revenue generated</span>
                            </div>
                            <div>
                                <strong>87%</strong>
                                <span>solved first session</span>
                            </div>
                            <div>
                                <strong>+320</strong>
                                <span>active clients</span>
                            </div>
                        </div> */}
                    </section>

                    {/* Colonne droite - Auth Google */}
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
                                <div className="head-text">

                                </div>
                            </div>

                            <Auth
                                supabaseClient={supabase}
                                providers={["google"]}
                                onlyThirdPartyProviders
                                appearance={{
                                    theme: ThemeSupa,
                                    variables: {
                                        default: {
                                            colors: {
                                                brand: "#111111", // bouton principal sombre
                                                brandAccent: "#000000",
                                                brandButtonText: "#ffffff",
                                                defaultButtonBackground: "#f3f3f2",
                                                defaultButtonBackgroundHover: "#e9e9e8",
                                                inputBackground: "#ffffff",
                                                inputBorder: "#e5e5e0",
                                                inputBorderHover: "#b3b3ae",
                                                inputBorderFocus: "#111111",
                                            },
                                            radii: {
                                                borderRadiusButton: "12px",
                                                inputBorderRadius: "12px",
                                            },
                                            space: {
                                                buttonPadding: "12px 16px",
                                                inputPadding: "12px 14px",
                                            },
                                            fonts: {
                                                bodyFontFamily:
                                                    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"',
                                                buttonFontFamily: "inherit",
                                                inputFontFamily: "inherit",
                                            },
                                        },
                                    },
                                    style: {
                                        button: {
                                            borderRadius: "12px",
                                            fontWeight: 600,
                                        },
                                        anchor: { fontWeight: 600 },
                                        input: { borderRadius: "12px", fontSize: "16px" },
                                        label: { fontWeight: 600, color: "#222" },
                                    },
                                }}
                                localization={{
                                    variables: {
                                        sign_in: {
                                            social_provider_text: "Continuer avec {{provider}}",
                                        },
                                    },
                                }}
                            />

                            {/*<div className="auth-foot-note">Secure • Private • SSO</div>*/}
                        </motion.div>
                    </section>
                </div>
            </div>
        );
    }

    // APP authentifiée
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
