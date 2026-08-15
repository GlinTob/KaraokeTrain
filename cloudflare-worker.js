/**
 * Cloudflare Worker para subir archivos a R2 (bucket: vocal-app-storage)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method === 'POST' && path === '/api/upload') {
        return await handleUpload(request, env, corsHeaders);
      }

      if (request.method === 'DELETE' && path.startsWith('/api/delete/')) {
        const key = path.replace('/api/delete/', '');
        return await handleDelete(key, env, corsHeaders);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleUpload(request, env, corsHeaders) {
  const contentType = request.headers.get('content-type') || '';

  let fileName, mimeType, fileData;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file');
    fileName = formData.get('fileName') || file?.name || `upload_${Date.now()}`;
    mimeType = formData.get('mimeType') || file?.type || 'application/octet-stream';
    fileData = await file.arrayBuffer();
  } else if (contentType.includes('application/json')) {
    const json = await request.json();
    fileName = json.fileName || `upload_${Date.now()}`;
    mimeType = json.mimeType || 'application/octet-stream';
    const base64 = json.fileBase64 || json.base64;
    if (!base64) throw new Error('fileBase64 requerido');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    fileData = bytes.buffer;
  } else {
    fileName = new URL(request.url).searchParams.get('fileName') || `upload_${Date.now()}`;
    mimeType = new URL(request.url).searchParams.get('mimeType') || 'application/octet-stream';
    fileData = await request.arrayBuffer();
  }

  const cleanName = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._]/g, "_")
    .replace(/__+/g, "_");

  const safePath = `${Date.now()}_${cleanName}`;

  await env.VOCAL_APP_STORAGE.put(safePath, fileData, {
    httpMetadata: {
      contentType: mimeType,
    },
  });

  const publicUrl = `${env.https://pub-009d57f0ff314e0b95d55e0c4df4ab6e.r2.dev}/${safePath}`;

  return new Response(JSON.stringify({
    success: true,
    filePath: safePath,
    fileUrl: publicUrl,
    fileName: cleanName
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleDelete(key, env, corsHeaders) {
  await env.VOCAL_APP_STORAGE.delete(key);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
