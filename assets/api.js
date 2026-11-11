// Small shared helpers used by both the student and the teacher page.

const CONFIG = window.APP_CONFIG || {};

function isConfigured() {
  return (
    CONFIG.SUPABASE_URL &&
    CONFIG.SUPABASE_ANON_KEY &&
    !CONFIG.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !CONFIG.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY")
  );
}

// Calls one of the database functions in supabase/schema.sql.
async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error("Could not reach the server. Check your internet connection.");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new Error((data && data.message) || `Something went wrong (${res.status}).`);
  }
  return data;
}

// Tiny DOM builder: h("div", {class: "x", onclick: fn}, "text", childNode, ...)
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);

let toastTimer;
function toast(message, kind = "ok") {
  let el = $("#toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 3500);
}

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Builds one stamp card with `filled` of 10 stamps stamped.
function stampCard(filled, { small = false } = {}) {
  const card = h("div", {
    class: `stamp-card${small ? " small" : ""}${filled >= 10 ? " full" : ""}`,
    role: "img",
    "aria-label": `Stamp card with ${filled} of 10 stamps`,
  });
  for (let i = 0; i < 10; i++) {
    card.append(h("span", { class: `stamp${i < filled ? " on" : ""}` }, i < filled ? "★" : ""));
  }
  return card;
}

function showSetupNotice(container) {
  container.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "Almost ready"),
      h(
        "p",
        {},
        "This website is not connected to its database yet. Open config.js and paste in your Supabase URL and key. The README file has step-by-step instructions."
      )
    )
  );
}
