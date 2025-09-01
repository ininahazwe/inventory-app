import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Vérifier la session existante
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setIsLoading(false);
        });

        // Écouter les changements d'authentification
        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
            setSession(s);
            setIsLoading(false);
        });

        return () => sub.subscription.unsubscribe();
    }, []);

    // Animation de chargement
    if (isLoading) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
            }}>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    style={{
                        width: 40,
                        height: 40,
                        border: "3px solid rgba(255,255,255,0.3)",
                        borderTop: "3px solid white",
                        borderRadius: "50%"
                    }}
                />
            </div>
        );
    }

    // Page de connexion
    if (!session) {
        return (
            <div style={{
                minHeight: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px"
            }}>
                {/* Particules d'arrière-plan */}
                <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    overflow: "hidden",
                    pointerEvents: "none"
                }}>
                    {[...Array(6)].map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{
                                y: [-20, -100],
                                opacity: [0, 1, 0],
                                scale: [0.5, 1, 0.5]
                            }}
                            transition={{
                                duration: 4 + i * 0.5,
                                repeat: Infinity,
                                delay: i * 0.8
                            }}
                            style={{
                                position: "absolute",
                                left: `${20 + i * 15}%`,
                                bottom: 0,
                                width: 4,
                                height: 4,
                                background: "rgba(255,255,255,0.6)",
                                borderRadius: "50%"
                            }}
                        />
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 30, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                        background: "rgba(255, 255, 255, 0.95)",
                        backdropFilter: "blur(20px)",
                        borderRadius: 24,
                        padding: "40px",
                        maxWidth: 420,
                        width: "100%",
                        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15), 0 8px 25px rgba(0, 0, 0, 0.1)",
                        border: "1px solid rgba(255, 255, 255, 0.2)"
                    }}
                >
                    {/* En-tête avec logo/titre */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        style={{ textAlign: "center", marginBottom: 32 }}
                    >
                        <motion.div
                            animate={{ rotate: [0, 5, -5, 0] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            style={{
                                width: 60,
                                height: 60,
                                background: "linear-gradient(135deg, #667eea, #764ba2)",
                                borderRadius: 16,
                                margin: "0 auto 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 24,
                                color: "white",
                                boxShadow: "0 8px 25px rgba(102, 126, 234, 0.3)"
                            }}
                        >
                            📦
                        </motion.div>
                        <h1 style={{
                            margin: 0,
                            fontSize: 28,
                            fontWeight: 700,
                            background: "linear-gradient(135deg, #667eea, #764ba2)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text"
                        }}>
                            Inventaire
                        </h1>
                        <p style={{
                            margin: "8px 0 0",
                            color: "#666",
                            fontSize: 16
                        }}>
                            Connectez-vous pour accéder à votre inventaire
                        </p>
                    </motion.div>

                    {/* Formulaire d'authentification */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.4 }}
                        style={{
                            // Custom styling pour l'Auth component
                            "--auth-border-color": "#e1e5e9",
                            "--auth-border-radius": "12px",
                            "--auth-primary-color": "#667eea",
                            "--auth-primary-hover": "#5a6fd8"
                        } as React.CSSProperties}
                    >
                        <Auth
                            supabaseClient={supabase}
                            appearance={{
                                theme: ThemeSupa,
                                variables: {
                                    default: {
                                        colors: {
                                            brand: '#667eea',
                                            brandAccent: '#5a6fd8',
                                            brandButtonText: 'white',
                                            defaultButtonBackground: '#f8f9fa',
                                            defaultButtonBackgroundHover: '#e9ecef',
                                            inputBackground: 'white',
                                            inputBorder: '#e1e5e9',
                                            inputBorderHover: '#667eea',
                                            inputBorderFocus: '#667eea',
                                        },
                                        borderWidths: {
                                            buttonBorderWidth: '1px',
                                            inputBorderWidth: '1px',
                                        },
                                        radii: {
                                            borderRadiusButton: '12px',
                                            buttonBorderRadius: '12px',
                                            inputBorderRadius: '12px',
                                        },
                                        space: {
                                            buttonPadding: '12px 24px',
                                            inputPadding: '12px 16px',
                                        },
                                        fonts: {
                                            bodyFontFamily: 'system-ui, -apple-system, sans-serif',
                                            buttonFontFamily: 'system-ui, -apple-system, sans-serif',
                                            inputFontFamily: 'system-ui, -apple-system, sans-serif',
                                        },
                                        fontSizes: {
                                            baseBodySize: '16px',
                                            baseInputSize: '16px',
                                            baseLabelSize: '14px',
                                            baseButtonSize: '16px',
                                        },
                                    }
                                },
                                style: {
                                    button: {
                                        borderRadius: '12px',
                                        fontWeight: '600',
                                        transition: 'all 0.2s ease',
                                    },
                                    input: {
                                        borderRadius: '12px',
                                        transition: 'all 0.2s ease',
                                        fontSize: '16px',
                                    },
                                    label: {
                                        fontWeight: '600',
                                        color: '#374151',
                                        marginBottom: '6px',
                                    }
                                }
                            }}
                            providers={["google"]}
                            onlyThirdPartyProviders
                            localization={{
                                variables: {
                                    sign_in: {
                                        social_provider_text: 'Continuer avec {{provider}}'
                                    }
                                }
                            }}
                        />
                    </motion.div>

                    {/* Footer */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.6 }}
                        style={{
                            textAlign: "center",
                            marginTop: 24,
                            color: "#666",
                            fontSize: 14
                        }}
                    >
                        <div style={{
                            width: 40,
                            height: 1,
                            background: "linear-gradient(90deg, transparent, #ddd, transparent)",
                            margin: "16px auto"
                        }} />
                        Sécurisé et confidentiel
                    </motion.div>
                </motion.div>
            </div>
        );
    }

    // Application principale avec transition d'entrée
    return (
        <AnimatePresence mode="wait">
            <motion.div
                key="app"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}