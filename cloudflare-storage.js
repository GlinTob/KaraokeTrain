// Cloudflare R2 Storage Client
// Reemplaza uploadFileToSupabase / saveLibraryItemToSupabase

function getCloudflareConfig() {
  const config = window.CLOUDFLARE_R2_CONFIG || {
    uploadUrl: window.VITE_CLOUDFLARE_R2_UPLOAD_URL,
    publicUrl: window.VITE_CLOUDFLARE_R2_PUBLIC_URL
  };

  if (!config || !config.uploadUrl) {
    console.warn('⚠️ Cloudflare R2 no configurado. Define window.CLOUDFLARE_R2_CONFIG o VITE_CLOUDFLARE_R2_UPLOAD_URL.');
    return null;
  }

  return {
    uploadUrl: config.uploadUrl,
    publicUrl: config.publicUrl
  };
}

let uploadCounter = 0;

/**
 * Sube archivo a Cloudflare R2 via Worker
 * @param {File|Blob} fileOrBlob - Archivo a subir
 * @param {string} fileName - Nombre del archivo
 * @param {string} mimeType - Tipo MIME
 * @param {string} tipo - Tipo para incluir en nombre: pista|voz|karaoke|grabacion|audio
 * @returns {Promise<{filePath: string, fileUrl: string, fileName: string}>}
 */
async function uploadFileToCloudflare(fileOrBlob, fileName, mimeType = "application/octet-stream", tipo = "audio") {
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado. Define CLOUDFLARE_R2_UPLOAD_URL");
  }

  // 1. Limpiar nombre
  let originalName = fileName
  
  uploadCounter++;
  const timestamp = Date.now();
  const counter = uploadCounter.toString(36).padStart(4, '0');
  const safePath = `${timestamp}_${counter}_${tipo}_${originalName}`;

  console.log(`☁️ Subiendo a Cloudflare R2: ${safePath}`);

  // 2. Preparar FormData
  const formData = new FormData();
  formData.append('file', fileOrBlob, safePath);
  formData.append('fileName', safePath);
  formData.append('mimeType', mimeType);

  // 3. Subida al Worker de Cloudflare
  const response = await fetch(config.uploadUrl, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error subiendo a R2 (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(`Error R2: ${result.error || 'Unknown error'}`);
  }

  console.log(`✅ Subido a R2: ${result.fileUrl}`);

  return {
    filePath: result.filePath,    // clave en R2
    fileUrl: result.fileUrl,      // URL pública completa
    fileName: result.fileName     // nombre limpio
  };
}

/**
 * Guarda item en Supabase + Cloudflare R2 (según tipo)
 */
async function saveLibraryItemToCloudflare({ name, type, blob, transcription = [], metadata = {}, textoPlano = null }) {
  const isTextType = type === "texto" || type === "ultrastar_txt";
  const db = typeof getSupabaseClient === "function" ? getSupabaseClient() : window.supabaseClient;

  if (!db) throw new Error("❌ Supabase no inicializado");

  // --- TIPO TEXTO: Guardar SOLO en Supabase (Igual que antes) ---
  if (isTextType) {
    const lyrics = typeof segmentarTextoPlano === "function" && textoPlano
      ? segmentarTextoPlano(textoPlano)
      : [];

    const insertData = {
      name,
      type,
      textoPlano: textoPlano || (blob instanceof Blob ? await blob.text() : ""),
      lyrics,
      isSincronizada: false,
      transcription: [],
      metadata,
      date: new Date().toISOString()
    };

    const { error } = await db.from("library").insert([insertData]);
    if (error) throw error;
    
    console.log("✅ Archivo de texto guardado en Supabase");
    return { filePath: null, fileUrl: null };
  }

  // --- TIPO AUDIO: Enviar al Worker (CORRECCIÓN AQUÍ) ---
  
  // URL de tu Worker desplegado
  const WORKER_URL = "https://vocal-app-storage-worker.jodatomx.workers.dev"; 
  
  // Preparar los datos para enviar al Worker
  const formData = new FormData();
  formData.append("file", blob, name); // El archivo
  formData.append("fileName", name);   // El nombre final (ej: "12345_cancion.mp3")
  formData.append("mimeType", blob.type);

  console.log(`☁️ Enviando audio al Worker: ${name}`);

  try {
    // 1. Subir archivo al Worker
    const response = await fetch(`${WORKER_URL}/api/upload`, {
      method: "POST",
      body: formData
      // No establecer 'Content-Type' header manualmente, el navegador lo hace para FormData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Error en el Worker (${response.status}): ${errText}`);
    }

    const result = await response.json();
    
    // El Worker devuelve filePath y fileUrl
    const filePath = result.filePath;
    const fileUrl = result.fileUrl;

    console.log(`✅ Archivo subido a R2. URL: ${fileUrl}`);

    // 2. Guardar metadata en Supabase
    const insertData = {
      name,
      type,
      file_path: filePath,
      file_url: fileUrl,
      transcription,
      metadata,
      date: new Date().toISOString()
    };

    const { error } = await db.from("library").insert([insertData]);

    if (error) {
      console.error("❌ Error guardando en Supabase:", error);
      // Opcional: Podrías llamar a un endpoint DELETE en el Worker para limpiar el archivo
      throw error;
    }

    console.log("✅ Item guardado correctamente en Supabase");
    return { filePath, fileUrl };

  } catch (error) {
    console.error("❌ Error en el proceso de subida:", error);
    throw error;
  }
}   
/**
 * Elimina archivo de Cloudflare R2
 */
async function deleteFileFromCloudflare(filePath) {
  const config = getCloudflareConfig();

  if (!config || !filePath) return;

  try {
    const deleteUrl = `${config.uploadUrl.replace('/api/upload', '/api/delete/')}${filePath}`;
    await fetch(deleteUrl, { method: 'DELETE' });
    console.log(`🗑️ Eliminado de R2: ${filePath}`);
  } catch (error) {
    console.warn('No se pudo eliminar de R2:', error);
  }
}

// Exportar globalmente
window.CloudflareStorage = {
  uploadFileToCloudflare,
  saveLibraryItemToCloudflare,
  deleteFileFromCloudflare,
  getCloudflareConfig
};
