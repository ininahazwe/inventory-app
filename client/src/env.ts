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
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID || '888523841322-ig43op5lrtf4m5ts3svshdlb8cumvvm6.apps.googleusercontent.com',
  VITE_API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3003/api'
};

export default window.__ENV__;
