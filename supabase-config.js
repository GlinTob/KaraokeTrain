// Configuración de Supabase - Las credenciales se deben configurar en variables de entorno del servidor
// En desarrollo local, crear un archivo .env.local con:
// VITE_SUPABASE_URL=tu_url
// VITE_SUPABASE_ANON_KEY=tu_key

// Helper para obtener variables de entorno (funciona en Vercel dev y navegador)
// Helper para obtener variables de entorno (Compatible con Vite, Vercel y fallbacks)
function getEnv(key, fallback = '') {
  // 1. PRIMERA OPCIÓN (Obligatoria para Vite en Vercel): Buscar en el objeto nativo de Vite
  //if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    //return import.meta.env[key];
  //}
  
  // 2. SEGUNDA OPCIÓN: En Vercel dev o configuraciones globales antiguas
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  
  // 3. TERCERA OPCIÓN: Intentar leer directamente de una variable global inyectada
  if (typeof window !== 'undefined' && window[key]) {
    return window[key];
  }
  
  return fallback;
}


function getSupabaseConfig() {
  const url = getEnv('VITE_SUPABASE_URL') || "";
  const key = getEnv('VITE_SUPABASE_ANON_KEY') || "";
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

// Para compatibilidad con código existente
const supabaseApp = new Proxy({}, {
  get(_, prop) {
    return getSupabaseClient()[prop];
  }
});

// Exponer globalmente
window.supabaseApp = supabaseApp;
window.getSupabaseClient = getSupabaseClient;
