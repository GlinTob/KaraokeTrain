export function $(id) {
  return document.getElementById(id);
}

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`⚠️ No se encontró el elemento con ID: ${id} para registrar el evento [${event}]`);
  }
}
