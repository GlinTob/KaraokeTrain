function getCloudflareConfig() {
  // Funciona tanto en módulos como en scripts normales
  const baseUrl =
    window.CLOUDFLARE_R2_BASE_URL ||
    window.VITE_CLOUDFLARE_R2_BASE_URL ||
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_CLOUDFLARE_R2_BASE_URL : undefined);

  if (!baseUrl) {
    console.warn('⚠️ Cloudflare R2 no configurado. Define window.CLOUDFLARE_R2_BASE_URL antes de usar CloudflareStorage.');
    return null;
  }

  return { baseUrl: baseUrl.replace(/\/$/, '') };
}


/**
 * Sube archivo a Cloudflare R2 via Worker
 * @param {File|Blob} fileOrBlob - Archivo a subir
 * @param {string} fileName - Nombre del archivo (el Worker lo limpia y genera la clave)
 * @param {string} mimeType - Tipo MIME
 * @param {string} tipo - Tipo para incluir en nombre: pista|voz|karaoke|grabacion|audio
 * @returns {Promise<{filePath: string, fileUrl: string, fileName: string}>}
 */
async function uploadFileToCloudflare(fileOrBlob, fileName, mimeType = "application/octet-stream", tipo = "audio") {
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado. Define CLOUDFLARE_R2_BASE_URL");
  }

  // El Worker limpia el nombre y genera la clave con timestamp.
  // Solo añadimos el tipo como prefijo para organizar.
  const fullFileName = `${tipo}_${fileName}`;

  console.log(`☁️ Subiendo a Cloudflare R2: ${fullFileName}`);
  console.log(`📡 Enviando a: ${config.baseUrl}/api/upload`);

  // Preparar FormData
  const formData = new FormData();
  formData.append('file', fileOrBlob, fullFileName);
  formData.append('fileName', fullFileName);
  formData.append('mimeType', mimeType);

  // Subida al Worker con timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${config.baseUrl}/api/upload`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

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
      filePath: result.filePath,    // clave en R2 (generada por el Worker)
      fileUrl: result.fileUrl,      // URL pública completa
      fileName: result.fileName     // nombre limpio (generado por el Worker)
    };

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("La subida tardó demasiado y se canceló. Verifica los logs del Worker.");
    }
    throw error;
  }
}

/**
 * Guarda item en Supabase + Cloudflare R2 (según tipo)
 */
async function saveLibraryItemToCloudflare({ name, type, blob, transcription = [], metadata = {}, textoPlano = null }) {
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado");
  }

  const isTextType = type === "texto" || type === "ultrastar_txt" || type === "texto_plano" || type === "letra";
  const db = typeof getSupabaseClient === "function" ? getSupabaseClient() : window.supabaseClient;

  if (!db) throw new Error("❌ Supabase no inicializado");

  // TIPO TEXTO: Guardar SOLO en Supabase (sin R2)
  if (isTextType) {
    const lyrics = typeof segmentarTextoPlano === "function" && textoPlano
      ? segmentarTextoPlano(textoPlano)
      : [];

    // Limpiamos la extensión también en base de datos para mostrar un nombre estético sin ".txt"
    let cleanTextName = name;
    if (cleanTextName.toLowerCase().endsWith(".txt")) {
      cleanTextName = cleanTextName.substring(0, cleanTextName.length - 4);
    }

    const insertData = {
      name: cleanTextName,
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

  // TIPO AUDIO: Subir a R2 + metadata en Supabase
  const mimeType = blob.type || "application/octet-stream";

  // Determinar extensión correcta
  const extension = mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
    ? "mp3"
    : mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4") || mimeType.includes("m4a")
    ? "m4a"
    : "bin";

  // ✅ CORRECCIÓN CRÍTICA: Remover de forma segura la extensión previa si ya viene incluida en la variable name
  let baseName = name;
  if (baseName.toLowerCase().endsWith(`.${extension}`)) {
    baseName = baseName.substring(0, baseName.length - (extension.length + 1));
  } else if (baseName.match(/\.[a-zA-Z0-9]{3,4}$/)) {
    // Por si trae extensiones variantes de audio parecidas (ej: .mpeg)
    baseName = baseName.substring(0, baseName.lastIndexOf('.'));
  }

  // Sanitizar espacios o tildes para generar una URL segura
  let safeBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\s-]/g, "")
    .trim();

  const fileName = `${safeBaseName}.${extension}`;

  console.log(`☁️ Nombre original: "${name}" -> Archivo Seguro: "${fileName}"`);
  console.log(`📊 Tipo MIME: ${mimeType} -> Extensión: ${extension}`);

  // 1. Subir binario a Cloudflare R2
  const { filePath, fileUrl } = await uploadFileToCloudflare(blob, fileName, mimeType, type);

  // 2. Insertar metadata en Supabase (Guardamos el baseName limpio sin extensión para tu diseño)
  const insertData = {
    name: baseName, 
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
    try { await deleteFileFromCloudflare(filePath); } catch (e) {}
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
    const deleteUrl = `${config.baseUrl}/api/delete/${filePath}`;
    console.log(`🗑️ Eliminando: ${deleteUrl}`);
    const response = await fetch(deleteUrl, { method: 'DELETE' });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Error al eliminar (pero continuando): ${errorText}`);
    } else {
      console.log(`🗑️ Eliminado de R2: ${filePath}`);
    }
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
