import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { watchAuthUI, signInWithGoogle, signInWithEmail, signUpWithEmail, logOut, auth } from "./auth.js";
import { openCheckout } from "./checkout.js";
import { addToCart, initCart } from "./cart.js";

watchAuthUI();
initCart((cartItems) => openCheckout(cartItems));

document.getElementById("signOutBtn").addEventListener("click", () => logOut());

// ---------- Login modal wiring (shared pattern, reused on custom-print.html) ----------
const loginModal = document.getElementById("loginModal");
document.getElementById("openLogin").addEventListener("click", () => loginModal.style.display = "flex");
document.getElementById("closeLogin").addEventListener("click", () => loginModal.style.display = "none");

document.getElementById("googleSignIn").addEventListener("click", async () => {
  try { await signInWithGoogle(); loginModal.style.display = "none"; }
  catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});
document.getElementById("emailSignIn").addEventListener("click", async () => {
  try {
    await signInWithEmail(document.getElementById("loginEmail").value, document.getElementById("loginPassword").value);
    loginModal.style.display = "none";
  } catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});
document.getElementById("emailSignUp").addEventListener("click", async () => {
  try {
    await signUpWithEmail(document.getElementById("loginEmail").value, document.getElementById("loginPassword").value);
    loginModal.style.display = "none";
  } catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});

// ---------- Product grid ----------
const grid = document.getElementById("productGrid");

function renderProducts(products) {
  grid.innerHTML = "";
  let inStock = 0, soldOut = 0;

  products.forEach(p => {
    if (p.stock > 0) inStock++; else soldOut++;

    const card = document.createElement("div");
    card.className = "card";
    const stockClass = p.stock === 0 ? "out" : (p.stock <= 3 ? "low" : "");
    const stockLabel = p.stock === 0 ? "Sold out" : `${p.stock} in stock`;

    card.innerHTML = `
      <div class="thumb">${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}">` : ""}</div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <p class="desc">${p.desc || ""}</p>
        <div class="card-foot">
          <span class="price-tag">$${p.price.toFixed(2)}</span>
          <span class="stock ${stockClass}">${stockLabel}</span>
        </div>
        <button class="btn btn-primary" ${p.stock === 0 ? "disabled" : ""} data-id="${p.id}">
          ${p.stock === 0 ? "Sold out" : "Add to cart"}
        </button>
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if (!auth.currentUser) {
        document.getElementById("loginModal").style.display = "flex";
        return;
      }
      addToCart(p);
    });
    grid.appendChild(card);
  });

  document.getElementById("statInStock").textContent = inStock;
  document.getElementById("statSoldOut").textContent = soldOut;
  document.getElementById("countLabel").textContent = `${products.length} products`;
}

const q = query(collection(db, "products"), orderBy("name"));
onSnapshot(q, (snap) => {
  const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderProducts(products);
}, (err) => {
  grid.innerHTML = `<p style="color:var(--danger)">Couldn't load products: ${err.message}</p>`;
});
