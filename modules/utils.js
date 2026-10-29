export function $(id) {
  return document.getElementById(id);
}

// safeAdd ahora es idempotente: registra el handler en WeakSet por elemento
// y no lo duplica aunque se llame varias veces con el mismo par (el,event).
const _safeAddRegistrado = new WeakMap();

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (!el) {
    console.warn(`⚠️ No se encontró el elemento con ID: ${id} para registrar el evento [${event}]`);
    return;
  }
  let set = _safeAddRegistrado.get(el);
  if (!set) {
    set = new Set();
    _safeAddRegistrado.set(el, set);
  }
  const clave = `${event}::${handler?.name || handler?.toString?.() || "anon"}`;
  if (set.has(clave)) return;
  set.add(clave);
  el.addEventListener(event, handler);
}

// Confirmación no bloqueante. Devuelve una Promise<boolean> y usa el mismo
// lenguaje visual que el resto de la app (evita confirm() nativo, que congela
// el hilo y en móvil se ve fuera de contexto).
export function confirmDialog(message, { okText = "Aceptar", cancelText = "Cancelar", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel"></button>
          <button type="button" class="confirm-ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".confirm-msg").textContent = String(message ?? "");
    const ok = overlay.querySelector(".confirm-ok");
    const cancel = overlay.querySelector(".confirm-cancel");
    ok.textContent = okText;
    cancel.textContent = cancelText;
    if (danger) ok.classList.add("danger");

    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    };
    const close = (valor) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(valor);
    };

    ok.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    ok.focus();
  });
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
