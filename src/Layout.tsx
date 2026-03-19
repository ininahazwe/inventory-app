import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { auth, token } from "./lib/apiClient";
import "./styles/theme.css";
import "./styles/login.css";
import logo from "./assets/mfwa-logo.png";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (token.get()) {
      auth.getUser().then(({ data }) => {
        if (data) setEmail(data.email);
      });
    }
  }, []);

  const login = () => auth.signInWithGoogle('/');

  const logout = async () => {
    await auth.signOut();
    navigate(0);
  };

  return (
    <>
      <header className="site-shell">
        <div className="site-band">
          <div className="site-left">
            <div className="brand-dot">
              <span>
                <img src={logo} alt="logo" onClick={() => navigate('/')} />
              </span>
            </div>
          </div>

          <div className="site-center">
            <span className="site-title">IT INVENTORY</span>
          </div>

          <div className="site-right">
            {email ? (
              <button className="pill red" onClick={logout}>Log out</button>
            ) : (
              <button className="pill green" onClick={login}>Login</button>
            )}
          </div>
        </div>
      </header>

      <motion.main className="shell">
        <div className="shell-inner">
          <div className="grid-bg" aria-hidden />
          <div className="shell-body">{children}</div>
        </div>
      </motion.main>
    </>
  );
}
