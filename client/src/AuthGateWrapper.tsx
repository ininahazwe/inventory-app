// src/AuthGateWrapper.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, Outlet } from 'react-router-dom';
import { token, auth } from './lib/apiClient';
import logo from './assets/mfwa-logo.png';
import { BlurIn } from './components/TextBlur.tsx';
import { GoogleSignInButton } from './components/GoogleSignInButton';

export default function AuthGateWrapper() {
  const location = useLocation();
  //const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  const isPublicRoute = location.pathname.match(/^\/asset\/\d+$/);

  useEffect(() => {
    auth.initGoogle().then(() => {
      if (token.get()) {
        auth.getUser().then(({ data, error }) => {
          setAuthenticated(!error && !!data);
        });
      } else {
        setAuthenticated(false);
      }
    });
  }, []);

  // Loader
  if (authenticated === null && !isPublicRoute) {
    return (
      <div className="auth-shell loader-shell">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="spinner"
        />
      </div>
    );
  }

  // Public route
  if (isPublicRoute) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="app"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    );
  }

  // Authenticated
  if (authenticated) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="app"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    );
  }

  // Login page
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

            {/* Google's own rendered button — see GoogleSignInButton for why
                this replaced a custom button wired to prompt() (One Tap). */}
            <GoogleSignInButton />
          </motion.div>
        </section>
      </div>
    </div>
  );
}
