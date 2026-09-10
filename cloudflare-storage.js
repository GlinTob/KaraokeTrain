function getCloudflareConfig() {
  const baseUrl =
    window.CLOUDFLARE_R2_BASE_URL ||
    window.VITE_CLOUDFLARE_R2_BASE_URL ||
    (typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env.VITE_CLOUDFLARE_R2_BASE_URL
      : undefined);

  if (!baseUrl) {
    console.warn("⚠️ Cloudflare R2 no configurado. Define window.CLOUDFLARE_R2_BASE_URL antes de usar CloudflareStorage.");
    return null;
  }

  const normalized = baseUrl.replace(/\/$/, "");

  try {
    const parsed = new URL(normalized);
    const isWorkersDev = /\.workers\.dev$/.test(parsed.hostname);
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);

    if (!isWorkersDev && !isLocalhost) {
      console.error(
        `❌ Cloudflare R2 URL inválida o sospechosa: "${normalized}". ` +
        `Debe apuntar a un subdominio *.workers.dev o localhost. ` +
        `Verifica que VITE_CLOUDFLARE_R2_BASE_URL en index.html coincida con R2_PUBLIC_URL en wrangler.toml.`
      );
      return null;
    }

    if (parsed.protocol !== "https:" && !isLocalhost) {
      console.warn(`⚠️ Cloudflare R2 debería usar HTTPS, no ${parsed.protocol}`);
    }
  } catch (e) {
    console.error("❌ Cloudflare R2 URL malformada:", normalized, e);
    return null;
  }

  return { baseUrl: normalized };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "desconocido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readResponseSafely(response) {
  const rawText = await response.text();

  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch (_) {}

  return {
    rawText,
    json
  };
}

/**
 * Sube archivo a Cloudflare R2 via Worker
 * @param {File|Blob} fileOrBlob
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} tipo
 * @returns {Promise<{filePath: string, fileUrl: string, fileName: string}>}
 */
async function uploadFileToCloudflare(
  fileOrBlob,
  fileName,
  mimeType = "application/octet-stream",
  tipo = "audio"
) {
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado. Define CLOUDFLARE_R2_BASE_URL");
  }

  const fullFileName = `${tipo}_${fileName}`;
  const size = typeof fileOrBlob?.size === "number" ? fileOrBlob.size : NaN;
  const uploadUrl = `${config.baseUrl}/api/upload`;

  console.log(`☁️ Subiendo a Cloudflare R2: ${fullFileName}`);
  console.log(`📊 Tamaño del archivo: ${formatBytes(size)}`);
  console.log(`📊 Tipo MIME: ${mimeType}`);
  console.log(`📡 Enviando a: ${uploadUrl}`);

  const formData = new FormData();
  formData.append("file", fileOrBlob, fullFileName);
  formData.append("fileName", fullFileName);
  formData.append("mimeType", mimeType);

  const controller = new AbortController();
  const timeoutMs = 180000; // 3 minutos
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();

  try {
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(`⏱️ Respuesta recibida en ${elapsed}s con status ${response.status}`);

    const { rawText, json } = await readResponseSafely(response);

    if (!response.ok) {
      const errorMessage =
        json?.error ||
        json?.message ||
        rawText ||
        `Error HTTP ${response.status}`;
      throw new Error(`Error subiendo a R2 (${response.status}): ${errorMessage}`);
    }

    const result = json;
    if (!result) {
      throw new Error("El Worker devolvió una respuesta vacía o no JSON.");
    }

    if (!result.success) {
      throw new Error(`Error R2: ${result.error || result.message || "Unknown error"}`);
    }

    if (!result.fileUrl && !result.url) {
      throw new Error("El Worker respondió sin fileUrl/url.");
    }

    const finalFileUrl = result.fileUrl || result.url || null;
    const finalFilePath = result.filePath || result.key || null;
    const finalFileName = result.fileName || fullFileName;

    console.log(`✅ Subido a R2: ${finalFileUrl}`);

    return {
      filePath: finalFilePath,
      fileUrl: finalFileUrl,
      fileName: finalFileName
    };
  } catch (error) {
    clearTimeout(timeoutId);

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    if (error.name === "AbortError") {
      throw new Error(
        `La subida tardó demasiado (${timeoutMs / 1000}s) y se canceló. ` +
        `Archivo: ${fullFileName} (${formatBytes(size)}). ` +
        `Tiempo transcurrido: ${elapsed}s. Verifica logs del Worker y velocidad de subida.`
      );
    }

    console.error(`❌ Error subiendo a Cloudflare tras ${elapsed}s:`, error);
    throw error;
  }
}

/**
 * Guarda item en Supabase + Cloudflare R2 (según tipo)
 */
async function saveLibraryItemToCloudflare({
  name,
  type,
  blob,
  transcription = [],
  metadata = {},
  textoPlano = null
}) {
  const config = getCloudflareConfig();

  if (!config) {
    throw new Error("Cloudflare R2 no configurado");
  }

  const isTextType =
    type === "texto" ||
    type === "ultrastar_txt" ||
    type === "texto_plano" ||
    type === "letra";

  const db =
    typeof getSupabaseClient === "function"
      ? getSupabaseClient()
      : window.supabaseClient;

  if (!db) throw new Error("❌ Supabase no inicializado");

  if (isTextType) {
    const lyrics =
      typeof window.segmentarTextoPlano === "function" && textoPlano
        ? window.segmentarTextoPlano(textoPlano)
        : [];

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

    const { data, error } = await db.from("library").insert([insertData]).select();

    if (error) {
      console.error("❌ Error guardando texto en Supabase:", error);
      throw error;
    }

    console.log("✅ Archivo de texto guardado en Supabase (sin R2)");
    return { filePath: null, fileUrl: null, id: data?.[0]?.id };
  }

  if (!blob) {
    throw new Error("No se recibió blob para subir a Cloudflare.");
  }

  const mimeType = blob.type || "application/octet-stream";

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

  let baseName = name;
  if (baseName.toLowerCase().endsWith(`.${extension}`)) {
    baseName = baseName.substring(0, baseName.length - (extension.length + 1));
  } else if (baseName.match(/\.[a-zA-Z0-9]{3,4}$/)) {
    baseName = baseName.substring(0, baseName.lastIndexOf("."));
  }

  let safeBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!safeBaseName) {
    safeBaseName = `archivo_${Date.now()}`;
  }

  const fileName = `${safeBaseName}.${extension}`;

  console.log(`☁️ Nombre original: "${name}" -> Archivo Seguro: "${fileName}"`);
  console.log(`📊 Tipo MIME: ${mimeType} -> Extensión: ${extension}`);
  console.log(`📦 Blob listo para subir: ${formatBytes(blob.size)}`);

  const { filePath, fileUrl } = await uploadFileToCloudflare(blob, fileName, mimeType, type);

  const insertData = {
    name: baseName,
    type,
    file_path: filePath,
    file_url: fileUrl,
    transcription,
    metadata,
    date: new Date().toISOString()
  };

  const { data, error } = await db.from("library").insert([insertData]).select();

  if (error) {
    console.error("❌ Error guardando en Supabase:", error);
    try {
      await deleteFileFromCloudflare(filePath);
    } catch (_) {}
    throw error;
  }

  console.log("✅ Item guardado en Supabase con URL de Cloudflare");

  return { filePath, fileUrl, id: data?.[0]?.id };
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

    const response = await fetch(deleteUrl, { method: "DELETE" });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Error al eliminar (pero continuando): ${errorText}`);
    } else {
      console.log(`🗑️ Eliminado de R2: ${filePath}`);
    }
  } catch (error) {
    console.warn("No se pudo eliminar de R2:", error);
  }
}

window.CloudflareStorage = {
  uploadFileToCloudflare,
  saveLibraryItemToCloudflare,
  deleteFileFromCloudflare,
  getCloudflareConfig
};
