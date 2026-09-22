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

// Toast no bloqueante (reemplazo progresivo de los alert()). Tipos: info,
// ok, warn, error. Se apila abajo a la derecha y se autodestruye.
export function toast(msg, type = "info", ms = 3500) {
  try {
    let box = document.getElementById("toastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "toastBox";
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = String(msg ?? "");
    el.setAttribute("role", "status");
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 400);
    }, ms);
  } catch (e) {
    console.log(`[toast:${type}]`, msg);
  }
}
