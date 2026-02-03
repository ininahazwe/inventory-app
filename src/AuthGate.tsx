// src/AuthGate.tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {Session} from "@supabase/supabase-js";
import { supabase } from "./lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import logo from "./assets/mfwa-logo.png";
import { BlurIn } from "./components/TextBlur.tsx";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    // Vérifier la session initiale
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        // Vérifier que l'user existe dans la base
        checkAuthorization();
      } else {
        setIsLoading(false);
      }
    });

    // Écouter les changements d'auth
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (event === "SIGNED_IN" && s) {
          setSession(s);
          await checkAuthorization();
        } else if (event === "SIGNED_OUT" || !s) {
          setSession(null);
          setIsAuthorized(false);
          setAuthError(null);
          setIsLoading(false);
        }
      }
    );

    return () => sub.subscription.unsubscribe();
  }, []);

  // Vérifier que l'user existe dans public.users
  const checkAuthorization = async (): Promise<void> => {
    try {
      const { data: userExists, error } = await supabase.rpc("user_exists");

      if (error) {
        console.error("Error checking user existence:", error);
        setAuthError("An error occurred. Please try again.");
        await supabase.auth.signOut();
        setSession(null);
        setIsAuthorized(false);
        setIsLoading(false);
        return;
      }

      if (!userExists) {
        // User connecté mais n'existe pas dans la base
        setAuthError(
          "Your email address is not authorized to access this application. Please contact an administrator."
        );
        await supabase.auth.signOut();
        setSession(null);
        setIsAuthorized(false);
      } else {
        // User autorisé
        setIsAuthorized(true);
        setAuthError(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Authorization check error:", errorMessage);
      setAuthError("An error occurred. Please try again.");
      await supabase.auth.signOut();
      setSession(null);
      setIsAuthorized(false);
    } finally {
      setIsLoading(false);
    }
  };

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

  // PAGE DE CONNEXION
  if (!session || !isAuthorized) {
    return (
      <div className="auth-shell">
        <div className="grid-bg" aria-hidden />

        <div className="login-wrap">
          {/* Colonne gauche - Branding */}
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

          {/* Colonne droite - Auth */}
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

              {/* Message d'erreur */}
              {authError && (
                <div
                  style={{
                    padding: 16,
                    marginBottom: 16,
                    background: "#fee",
                    border: "1px solid #fcc",
                    borderRadius: 8,
                    color: "#c00",
                    fontSize: 14,
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    ⚠️ Access Denied
                  </div>
                  {authError}
                </div>
              )}

              <Auth
                supabaseClient={supabase}
                providers={["google"]}
                onlyThirdPartyProviders
                appearance={{
                  theme: ThemeSupa,
                  variables: {
                    default: {
                      colors: {
                        brand: "#111111",
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
                      social_provider_text: "Continue with {{provider}}",
                    },
                  },
                }}
              />
            </motion.div>
          </section>
        </div>
      </div>
    );
  }

  // APP authentifiée et autorisée
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
