// src/AuthGateWrapper.tsx
// ✅ Avec Outlet pour afficher les pages enfants

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, Outlet } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import logo from "./assets/mfwa-logo.png";
import { BlurIn } from "./components/TextBlur.tsx";

export default function AuthGateWrapper() {
  const location = useLocation();

  const [session, setSession] = useState<
    Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]
  >(null);
  const [isLoading, setIsLoading] = useState(true);

  // ✅ Vérifier si route publique
  const isPublicRoute = location.pathname.match(/^\/asset\/\d+$/);

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

  // ✅ Si route publique, afficher le contenu (PublicAssetCard)
  if (isPublicRoute) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="app"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Outlet /> {/* ← Affiche PublicAssetPage */}
        </motion.div>
      </AnimatePresence>
    );
  }

  // ✅ Si authentifié, afficher le contenu
  if (session) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="app"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Outlet /> {/* ← Affiche HomePage ou AssetDetailPage */}
        </motion.div>
      </AnimatePresence>
    );
  }

  // ✅ Si pas authentifié ET pas route publique → page connexion
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
                    social_provider_text: "Continuer avec {{provider}}",
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
