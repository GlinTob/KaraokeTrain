// Configuración de Supabase - Las credenciales se deben configurar en variables de entorno del servidor
// En desarrollo local, crear un archivo .env.local con:
// VITE_SUPABASE_URL=tu_url
// VITE_SUPABASE_ANON_KEY=tu_key

// Helper para obtener variables de entorno (funciona en Vercel dev y navegador)
function getEnv(key, fallback = '') {
  // En Vercel dev, las env vars vienen en window.__ENV__ o se inyectan globalmente
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  // Fallback: intentar leer de meta tag o variable global inyectada
  if (typeof window !== 'undefined' && window[key]) {
    return window[key];
  }
  return fallback;
}

function getSupabaseConfig() {
  const url = getEnv('VITE_SUPABASE_URL')
    || "https://qfvhwbmgeunvgjwmlxjd.supabase.co";

  const key = getEnv('VITE_SUPABASE_ANON_KEY')
    || "sb_publishable_IGkquzv5abCY4Ao-8jK_2A_CwpiGA4N"; // fallback válido JWT

  if (!url || !key) {
    console.error("❌ Supabase config missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
    throw new Error("Supabase configuration missing");
  }

  return { url, key };
}

// Inicialización perezosa del cliente Supabase
let _supabaseApp = null;

function getSupabaseClient() {
  if (!_supabaseApp) {
    const { url, key } = getSupabaseConfig();
    _supabaseApp = window.supabase.createClient(url, key);
  }
  return _supabaseApp;
}

// Exponer globalmente
window.supabaseApp = supabaseApp;
window.getSupabaseClient = getSupabaseClient;
