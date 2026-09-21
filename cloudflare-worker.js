// cloudflare-worker.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // PREFLIGHT CORS
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
      return jsonResponse({ error: error.message || "Worker internal error" }, 500);
    }
  }
};

async function handleUpload(request, env) {
  const t0 = Date.now();

  try {
    const url = new URL(request.url);
    const fileName = url.searchParams.get("fileName") || `upload_${Date.now()}`;
    const mimeType =
      url.searchParams.get("mimeType") ||
      request.headers.get("content-type") ||
      "application/octet-stream";

    if (!request.body) {
      throw new Error("La solicitud no contiene body.");
    }

    // Límite del Worker (~100 MB reales): rechazar antes de consumir el body.
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    const MAX_BYTES = 100 * 1024 * 1024;
    if (contentLength > MAX_BYTES) {
      return jsonResponse({ error: `Archivo muy grande (${(contentLength / 1048576).toFixed(1)} MB). Máximo 100 MB: comprime o divide el audio.` }, 413);
    }

    const cleanName = sanitizeFileName(fileName);
    // uuid evita colisiones (mismo ms + mismo nombre). El tipo se infiere del
    // prefijo que el cliente antepone (pista_/voz_/karaoke_/...) o del query.
    let tipo = (url.searchParams.get("tipo") || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 20);
    if (!tipo) {
      const m = /^([a-z]+)_/.exec(cleanName);
      tipo = (m && m[1]) || "audio";
    }
    const safePath = `${tipo}/${Date.now()}-${crypto.randomUUID()}_${cleanName}`;

    await env.VOCAL_APP_STORAGE.put(safePath, request.body, {
      httpMetadata: { contentType: mimeType }
    });

    const publicUrl = `${env.R2_PUBLIC_URL}/api/file/${encodeURIComponent(safePath)}`;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    console.log("[UPLOAD] OK", { safePath, elapsed });

    return jsonResponse({
      success: true,
      filePath: safePath,
      fileUrl: publicUrl,
      fileName: cleanName
    }, 200);
  } catch (error) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.error("[UPLOAD] Error", elapsed, error);
    return jsonResponse({ error: error.message || "Upload error" }, 500);
  }
}

async function handleDelete(key, env) {
  try {
    await env.VOCAL_APP_STORAGE.delete(key);
    return jsonResponse({ success: true }, 200);
  } catch (error) {
    console.error("[DELETE] Error", error);
    return jsonResponse({ error: error.message || "Delete error" }, 500);
  }
}

async function handleGetFile(request, key, env) {
  try {
    const rangeHeader = request.headers.get("range");

    // Con Range: pedir solo ese tramo a R2 y responder 206 (seek del <audio>).
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!m) {
        return new Response("Rango inválido", { status: 416, headers: CORS_HEADERS });
      }
      // Necesitamos el tamaño total: HEAD via get con solo metadatos.
      const head = await env.VOCAL_APP_STORAGE.head(key);
      if (!head) {
        return new Response("Archivo no encontrado", { status: 404, headers: CORS_HEADERS });
      }
      const size = head.size;
      let start = m[1] === "" ? Math.max(0, size - parseInt(m[2] || "0", 10)) : parseInt(m[1], 10);
      let end = m[2] === "" ? size - 1 : parseInt(m[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
        return new Response("Rango no satisfacible", { status: 416, headers: CORS_HEADERS });
      }
      end = Math.min(end, size - 1);
      const object = await env.VOCAL_APP_STORAGE.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!object) {
        return new Response("Archivo no encontrado", { status: 404, headers: CORS_HEADERS });
      }
      const headers = new Headers(CORS_HEADERS);
      object.writeHttpMetadata(headers);
      if (object.httpEtag) headers.set("ETag", object.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(object.body, { status: 206, headers });
    }

    const object = await env.VOCAL_APP_STORAGE.get(key);

    if (!object) {
      return new Response("Archivo no encontrado", {
        status: 404,
        headers: CORS_HEADERS
      });
    }

    const headers = new Headers(CORS_HEADERS);
    object.writeHttpMetadata(headers);

    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");

    return new Response(object.body, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error("[GET] Error", error);
    return jsonResponse({ error: error.message || "Read error" }, 500);
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
