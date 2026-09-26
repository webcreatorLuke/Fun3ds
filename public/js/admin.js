import {
  collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { db, functions } from "./firebase-config.js";
import { onAuthStateChanged, auth, isAdmin, logOut, watchAuthUI } from "./auth.js";

watchAuthUI();
document.getElementById("signOutBtn").addEventListener("click", () => logOut());

onAuthStateChanged(auth, (user) => {
  const authorized = isAdmin(user);
  document.getElementById("gate").style.display = authorized ? "none" : "block";
  document.getElementById("dashboard").style.display = authorized ? "block" : "none";
  if (authorized) initDashboard();
});

let initialized = false;
function initDashboard() {
  if (initialized) return; // Firestore listeners should only be attached once
  initialized = true;

  // ---- Tabs ----
  document.querySelectorAll(".tabbar button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabbar button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      ["orders", "requests", "products"].forEach(t => {
        document.getElementById("tab-" + t).style.display = (t === btn.dataset.tab) ? "" : "none";
      });
    });
  });

  watchOrders();
  watchRequests();
  watchProducts();
  wireProductForm();
  wireAcceptModal();
}

// ================= ORDERS =================
function watchOrders() {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const body = document.getElementById("ordersBody");
    if (snap.empty) { body.innerHTML = `<tr><td colspan="7">No orders yet.</td></tr>`; return; }
    body.innerHTML = snap.docs.map(d => {
      const o = d.data();
      const items = (o.items || []).map(i => `${i.name} × ${i.qty}`).join(", ");
      const delivery = o.deliveryInfo ? `${o.deliveryInfo.name}<br/><span style="color:var(--text-dim)">${o.deliveryInfo.address}</span>` : "—";
      const flowqLabel = o.flowqSent ? `<span class="badge accepted">sent</span>` : (o.status === "paid" ? `<span class="badge pending">not sent</span>` : "—");
      const sendBtn = (o.status === "paid" && !o.flowqSent)
        ? `<button class="btn" data-send-flowq="${d.id}">Send to FlowQ</button>` : "";
      return `<tr>
        <td style="font-family:var(--font-tag); font-size:12px;">${d.id.slice(0,8)}</td>
        <td>${items}</td>
        <td>${o.customerEmail || "—"}</td>
        <td>${delivery}</td>
        <td><span class="badge ${o.status}">${o.status}</span></td>
        <td>${flowqLabel}</td>
        <td class="row-actions">${sendBtn}</td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-send-flowq]").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          await httpsCallable(functions, "sendOrderToFlowQ")({ orderId: btn.dataset.sendFlowq });
        } catch (e) { alert("Couldn't send: " + e.message); }
      });
    });
  });
}

// ================= CUSTOM REQUESTS =================
let pendingAcceptId = null;

function watchRequests() {
  const q = query(collection(db, "customRequests"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const body = document.getElementById("requestsBody");
    if (snap.empty) { body.innerHTML = `<tr><td colspan="5">No requests yet.</td></tr>`; return; }
    body.innerHTML = snap.docs.map(d => {
      const r = d.data();
      const details = r.type === "dog"
        ? `<img src="${r.photoData}" alt="" style="width:56px; height:56px; object-fit:cover; border-radius:6px; vertical-align:middle; margin-right:8px;">"${r.petName}", ${r.color}${r.notes ? " — " + r.notes : ""}`
        : `<a href="${r.makerworldLink}" target="_blank">MakerWorld link</a>, ${r.color}${r.notes ? " — " + r.notes : ""}`;
      const actions = r.status === "pending"
        ? `<button class="btn btn-primary" data-accept="${d.id}">Accept</button>
           <button class="btn btn-danger" data-decline="${d.id}">Decline</button>`
        : "";
      return `<tr>
        <td>${r.type === "dog" ? "Dog print" : "Online print"}</td>
        <td>${details}</td>
        <td>${r.customerEmail || "—"}</td>
        <td><span class="badge ${r.status}">${r.status}</span></td>
        <td class="row-actions">${actions}</td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-accept]").forEach(btn => btn.addEventListener("click", () => {
      pendingAcceptId = btn.dataset.accept;
      document.getElementById("acceptModal").style.display = "flex";
    }));
    body.querySelectorAll("[data-decline]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("Decline this request?")) return;
      try { await httpsCallable(functions, "declineCustomRequest")({ requestId: btn.dataset.decline }); }
      catch (e) { alert(e.message); }
    }));
  });
}

function wireAcceptModal() {
  document.getElementById("acceptCancel").addEventListener("click", () => {
    document.getElementById("acceptModal").style.display = "none";
  });
  document.getElementById("acceptConfirm").addEventListener("click", async () => {
    const status = document.getElementById("acceptStatus");
    const price = parseFloat(document.getElementById("acceptPrice").value);
    const paymentLink = document.getElementById("acceptPaymentLink").value.trim();
    const flowqFileId = document.getElementById("acceptFlowq").value.trim();
    if (!price || !paymentLink) { status.textContent = "Price and payment link are required."; return; }
    status.textContent = "Saving…";
    try {
      await httpsCallable(functions, "acceptCustomRequest")({ requestId: pendingAcceptId, price, paymentLink, flowqFileId });
      document.getElementById("acceptModal").style.display = "none";
      document.getElementById("acceptPrice").value = "";
      document.getElementById("acceptPaymentLink").value = "";
      document.getElementById("acceptFlowq").value = "";
    } catch (e) { status.textContent = e.message; }
  });
}

// ================= PRODUCTS =================
function watchProducts() {
  const q = query(collection(db, "products"), orderBy("name"));
  onSnapshot(q, (snap) => {
    const body = document.getElementById("productsBody");
    if (snap.empty) { body.innerHTML = `<tr><td colspan="5">No products yet.</td></tr>`; return; }
    body.innerHTML = snap.docs.map(d => {
      const p = d.data();
      return `<tr>
        <td>${p.name}</td>
        <td><input type="number" step="0.01" value="${p.price}" data-edit="price" data-id="${d.id}" style="width:80px; background:var(--ink); color:var(--text); border:1px solid var(--line); border-radius:4px; padding:4px;" /></td>
        <td><input type="number" value="${p.stock}" data-edit="stock" data-id="${d.id}" style="width:64px; background:var(--ink); color:var(--text); border:1px solid var(--line); border-radius:4px; padding:4px;" /></td>
        <td style="font-family:var(--font-tag); font-size:12px;">${p.flowqFileId || "—"}</td>
        <td class="row-actions"><button class="btn btn-danger" data-delete="${d.id}">Delete</button></td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-edit]").forEach(input => {
      input.addEventListener("change", async () => {
        const field = input.dataset.edit;
        const value = field === "price" ? parseFloat(input.value) : parseInt(input.value, 10);
        await updateDoc(doc(db, "products", input.dataset.id), { [field]: value });
      });
    });
    body.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this product?")) return;
        await deleteDoc(doc(db, "products", btn.dataset.delete));
      });
    });
  });
}

function wireProductForm() {
  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "products"), {
      name: document.getElementById("pName").value.trim(),
      price: parseFloat(document.getElementById("pPrice").value),
      stock: parseInt(document.getElementById("pStock").value, 10),
      desc: document.getElementById("pDesc").value.trim(),
      imageUrl: document.getElementById("pImage").value.trim(),
      flowqFileId: document.getElementById("pFlowq").value.trim(),
      createdAt: serverTimestamp()
    });
    e.target.reset();
  });
}
