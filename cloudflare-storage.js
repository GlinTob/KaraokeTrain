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
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado");
  }

  const isTextType = type === "texto" || type === "ultrastar_txt";
  const db = typeof getSupabaseClient === "function" ? getSupabaseClient() : window.supabaseClient;

  if (!db) throw new Error("❌ Supabase no inicializado");

  // --- TIPO TEXTO: Guardar SOLO en Supabase ---
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

    if (error) {
      console.error("❌ Error guardando texto en Supabase:", error);
      throw error;
    }
    console.log("✅ Archivo de texto guardado en Supabase (sin R2)");
    return { filePath: null, fileUrl: null };
  }

  // --- TIPO AUDIO: Subir a R2 + metadata en Supabase ---
  
  // 1. Determinar extensión desde el MIME type o el nombre
  const mimeType = blob.type || "application/octet-stream";
  let extension = "bin";
  if (mimeType.includes("wav")) extension = "wav";
  else if (mimeType.includes("mpeg") || name.endsWith(".mp3")) extension = "mp3";
  else if (mimeType.includes("webm")) extension = "webm";
  else if (mimeType.includes("ogg")) extension = "ogg";
  else if (name.endsWith(".txt")) extension = "txt"; // Fallback por seguridad

  // 2. Generar nombre de archivo seguro (USANDO LOS PARÁMETROS DE ENTRADA)
  // Usamos 'name' que viene de la función anterior (ya corregida con el nombre correcto)
  const timestamp = Date.now();
  const key = `${timestamp}_${name}`; 

  // 3. Subir directamente a R2 usando el bucket configurado
  // Asumiendo que 'config.bucket' es tu objeto bucket de R2 inicializado en getCloudflareConfig()
  const bucket = config.bucket; 
  
  if (!bucket) throw new Error("Bucket de R2 no encontrado en la configuración");

  console.log(`☁️ Subiendo a R2: ${key}`);
  
  await bucket.put(key, blob);

  // 4. Construir URL pública (Ajusta 'account_id' y 'bucket_name' según tu config)
  const fileUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`;
  const filePath = key;

  // 5. Insertar metadata en Supabase
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
    // Intento de limpieza en caso de error
    try { await bucket.delete(filePath); } catch (e) {}
    throw error;
  }
  
  console.log("✅ Item guardado en Supabase con URL de Cloudflare");
  return { filePath, fileUrl };
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
