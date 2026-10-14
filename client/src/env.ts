// Injecte les variables directement dans window
declare global {
  interface Window {
    __ENV__: {
      VITE_GOOGLE_CLIENT_ID: string;
      VITE_API_URL: string;
    };
  }
}

// Définis les variables globales
window.__ENV__ = {
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID || '408188100193-gud574m6q4tv7rmtgojj2cat9m290tvg.apps.googleusercontent.com',
  VITE_API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3003/api'
};

export default window.__ENV__;
