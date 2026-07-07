import React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { auth, token } from "./lib/apiClient";
import "./styles/theme.css";
import "./styles/login.css";
import logo from "./assets/mfwa-logo.png";
import { Link } from 'react-router-dom';
import { useToast } from './hooks/useToast';
import ToastContainer from './components/ToastContainer';
import {usePermissions} from "./hooks/usePermissions.ts";
import Modal from './components/Modal';
import AuditDashboard from './components/AuditDashboard';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const adminBtnRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { toasts, removeToast } = useToast();

  const { isAdmin, isSuperAdmin } = usePermissions();

  useEffect(() => {
    if (token.get()) {
      auth.getUser().then(({ data }) => {
        if (data) setEmail(data.email);
      });
    }
  }, []);

  const login = () => auth.signInWithGoogle();

  const logout = async () => {
    await auth.signOut();
    navigate(0);
  };

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
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
            <span className="site-title">ASSET & SUPPLY INVENTORY</span>
          </div>

          <div className="site-right">
            <Link to="/auctions" className="pill bordeaux">⏱︎ Auctions</Link>
            {isAdmin && (
              <Link to="/supplies" className="pill green">📋︎ Supplies</Link>
            )}
            {isAdmin && (
              <Link to="/incidents" className="pill">🛠︎ Incidents</Link>
            )}
            {isSuperAdmin && (
              <div
                ref={adminBtnRef}
                style={{ position: 'relative' }}
                onMouseEnter={() => {
                  const rect = adminBtnRef.current?.getBoundingClientRect();
                  if (rect) setMenuPos({ top: rect.bottom, right: window.innerWidth - rect.right });
                  setAdminMenuOpen(true);
                }}
                onMouseLeave={() => setAdminMenuOpen(false)}
              >
                <button
                  className="pill"
                  onClick={() => {
                    const rect = adminBtnRef.current?.getBoundingClientRect();
                    if (rect) setMenuPos({ top: rect.bottom, right: window.innerWidth - rect.right });
                    setAdminMenuOpen(o => !o);
                  }}
                >
                  ⚙︎ Administration ▾
                </button>
              </div>
            )}
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

      {isSuperAdmin && (
        <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="📋 Audit Log">
          <AuditDashboard />
        </Modal>
      )}

      {isSuperAdmin && adminMenuOpen && menuPos && createPortal(
        <div
          onMouseEnter={() => setAdminMenuOpen(true)}
          onMouseLeave={() => setAdminMenuOpen(false)}
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            minWidth: 180,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            padding: 6,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <Link to="/locations" className="pill" style={{ textAlign: 'left' }} onClick={() => setAdminMenuOpen(false)}>🏤 Locations</Link>
          <Link to="/assignees" className="pill" style={{ textAlign: 'left' }} onClick={() => setAdminMenuOpen(false)}>👥 User Management</Link>
          <button
            className="pill"
            style={{ textAlign: 'left' }}
            onClick={() => { setAdminMenuOpen(false); setAuditOpen(true); }}
          >
            📋 Audit Log
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
