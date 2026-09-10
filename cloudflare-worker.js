// cloudflare-worker.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-File-Name, X-Mime-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      if (request.method === "POST" && path === "/api/upload") {
        return await handleUpload(request, env);
      }

      if (request.method === "DELETE" && path.startsWith("/api/delete/")) {
        const key = decodeURIComponent(path.replace("/api/delete/", ""));
        return await handleDelete(key, env);
      }

      if (request.method === "GET" && path.startsWith("/api/file/")) {
        const key = decodeURIComponent(path.replace("/api/file/", ""));
        return await handleGetFile(request, key, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse({ error: error.message || "Error interno del Worker" }, 500);
    }
  }
};

async function handleUpload(request, env) {
  const t0 = Date.now();

  try {
    console.log("[UPLOAD] Inicio handleUpload");

    const fileNameHeader = request.headers.get("X-File-Name");
    const mimeTypeHeader = request.headers.get("X-Mime-Type");
    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    const contentLength = request.headers.get("Content-Length") || "desconocido";

    const fileName = fileNameHeader || `upload_${Date.now()}`;
    const mimeType = mimeTypeHeader || contentType || "application/octet-stream";

    console.log("[UPLOAD] Headers recibidos:", {
      fileName,
      mimeType,
      contentType,
      contentLength
    });

    if (!request.body) {
      throw new Error("La solicitud no contiene body.");
    }

    const cleanName = sanitizeFileName(fileName);
    const safePath = `${Date.now()}_${cleanName}`;

    console.log("[UPLOAD] Key destino:", safePath);
    console.log("[UPLOAD] Iniciando put() a R2...");

    await env.VOCAL_APP_STORAGE.put(safePath, request.body, {
      httpMetadata: {
        contentType: mimeType
      }
    });

    console.log("[UPLOAD] put() completado");

    const publicUrl = `${env.R2_PUBLIC_URL}/api/file/${encodeURIComponent(safePath)}`;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    console.log("[UPLOAD] Completado en", `${elapsed}s`);
    console.log("[UPLOAD] URL pública:", publicUrl);

    return jsonResponse({
      success: true,
      filePath: safePath,
      fileUrl: publicUrl,
      fileName: cleanName
    }, 200);

  } catch (error) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.error("[UPLOAD] Error tras", `${elapsed}s:`, error);

    return jsonResponse({
      error: error.message || "Error desconocido en upload"
    }, 500);
  }
}

async function handleDelete(key, env) {
  try {
    console.log("[DELETE] Eliminando:", key);
    await env.VOCAL_APP_STORAGE.delete(key);

    return jsonResponse({ success: true }, 200);
  } catch (error) {
    console.error("[DELETE] Error:", error);
    return jsonResponse({ error: error.message || "Error eliminando archivo" }, 500);
  }
}

async function handleGetFile(request, key, env) {
  try {
    console.log("[GET] Solicitando archivo:", key);

    const object = await env.VOCAL_APP_STORAGE.get(key);

    if (!object) {
      return new Response("Archivo no encontrado", {
        status: 404,
        headers: CORS_HEADERS
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);

    if (object.httpEtag) {
      headers.set("etag", object.httpEtag);
    }

    headers.set("Accept-Ranges", "bytes");

    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      headers.set(k, v);
    }

    return new Response(object.body, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error("[GET] Error:", error);
    return jsonResponse({ error: error.message || "Error leyendo archivo" }, 500);
  }
}

function sanitizeFileName(fileName) {
  return String(fileName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json"
    }
  });
}
