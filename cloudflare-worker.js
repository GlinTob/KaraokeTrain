// cloudflare-worker.js

// 1. Headers de CORS definidos GLOBALMENTE para asegurar que siempre se envíen
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Permite cualquier origen (tu dominio de Vercel y localhost)
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  'Access-Control-Max-Age': '86400', // Cache de CORS por 24h
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 2. Manejo EXPLÍCITO de preflight (OPTIONS) - CRÍTICO para CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      // --- SUBIR (POST) ---
      if (request.method === 'POST' && path === '/api/upload') {
        return await handleUpload(request, env);
      }

      // --- ELIMINAR (DELETE) ---
      if (request.method === 'DELETE' && path.startsWith('/api/delete/')) {
        const key = path.replace('/api/delete/', '');
        return await handleDelete(key, env);
      }

      // --- LEER (GET) ---
      if (request.method === 'GET' && path.startsWith('/api/file/')) {
        const key = path.replace('/api/file/', '');
        const object = await env.VOCAL_APP_STORAGE.get(key);
        
        if (!object) {
          return new Response('Archivo no encontrado', { 
            status: 404, 
            headers: CORS_HEADERS 
          });
        }

        // Crear una instancia limpia de Headers mezclando metadatos y CORS
        const responseHeaders = new Headers();
        object.writeHttpMetadata(responseHeaders);
        responseHeaders.set('etag', object.httpEtag);
        
        // Habilitar soporte de streaming parcial para etiquetas <audio> multimedia
        responseHeaders.set('Accept-Ranges', 'bytes');

        // Inyectar de forma segura cada una de tus cabeceras CORS globales en el objeto nativo
        for (const [corsKey, corsValue] of Object.entries(CORS_HEADERS)) {
          responseHeaders.set(corsKey, corsValue);
        }

        // Retornar el binario con el estatus y la estructura de opciones correcta
        return new Response(object.body, { 
          status: 200,
          headers: responseHeaders 
        });
      }

      // 404 por defecto
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleUpload(request, env) {
  const t0 = Date.now();

  try {
    const contentType = request.headers.get("content-type") || "";

    console.log("[UPLOAD] Inicio");
    console.log("[UPLOAD] Content-Type:", contentType);

    if (!contentType.includes("multipart/form-data")) {
      console.warn("[UPLOAD] Content-Type incorrecto:", contentType);
      return new Response(JSON.stringify({
        error: "Content-Type debe ser multipart/form-data"
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    console.log("[UPLOAD] Leyendo formData...");
    const formData = await request.formData();

    const file = formData.get("file");
    const fileName = formData.get("fileName") || file?.name || `upload_${Date.now()}`;
    const mimeType = formData.get("mimeType") || file?.type || "application/octet-stream";

    if (!file) {
      throw new Error("No se encontró el archivo en el FormData");
    }

    console.log("[UPLOAD] Archivo recibido:", {
      fileName,
      mimeType,
      size: file.size
    });

    const cleanName = fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_");

    const safePath = `${Date.now()}_${cleanName}`;
    console.log("[UPLOAD] Key destino:", safePath);

    console.log("[UPLOAD] Subiendo a R2...");

    // ✅ CAMBIO CLAVE: evitar arrayBuffer() completo en memoria
    if (typeof file.stream === "function") {
      await env.VOCAL_APP_STORAGE.put(safePath, file.stream(), {
        httpMetadata: { contentType: mimeType }
      });
    } else {
      await env.VOCAL_APP_STORAGE.put(safePath, file, {
        httpMetadata: { contentType: mimeType }
      });
    }

    const publicUrl = `${env.R2_PUBLIC_URL}/api/file/${safePath}`;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    console.log("[UPLOAD] Completado en", `${elapsed}s`);
    console.log("[UPLOAD] URL pública:", publicUrl);

    return new Response(JSON.stringify({
      success: true,
      filePath: safePath,
      fileUrl: publicUrl,
      fileName: cleanName
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });

  } catch (error) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.error("[UPLOAD] Error tras", `${elapsed}s:`, error);

    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
}

async function handleDelete(key, env) {
  try {
    await env.VOCAL_APP_STORAGE.delete(key);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en handleDelete:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}
