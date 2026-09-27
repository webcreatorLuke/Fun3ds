import { WORKER_URL } from "./firebase-config.js";

const CART_KEY = "fun3ds_cart";
let cart = [];
let onCheckoutCallback = null;

try {
  cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
} catch {
  cart = [];
}

function save() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  render();
}

export function addToCart(product, qty = 1) {
  const existing = cart.find((i) => i.productId === product.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, product.stock);
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: Math.min(qty, product.stock),
      maxStock: product.stock,
    });
  }
  save();
  openCart();
}

export function removeFromCart(productId) {
  cart = cart.filter((i) => i.productId !== productId);
  save();
}

export function setQty(productId, qty) {
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;
  if (qty < 1) {
    removeFromCart(productId);
    return;
  }
  item.qty = Math.min(qty, item.maxStock);
  save();
}

export function getCart() {
  return cart;
}

export function getCartTotal() {
  return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function clearCart() {
  cart = [];
  save();
}

export function openCart() {
  document.getElementById("cartModal").style.display = "flex";
}

export function closeCart() {
  document.getElementById("cartModal").style.display = "none";
}

function render() {
  const badge = document.getElementById("cartBadge");
  const count = cart.reduce((sum, i) => sum + i.qty, 0);
  badge.textContent = String(count);
  badge.style.display = count > 0 ? "" : "none";

  const list = document.getElementById("cartItems");
  const emptyMsg = document.getElementById("cartEmpty");
  list.innerHTML = "";

  if (cart.length === 0) {
    emptyMsg.style.display = "";
  } else {
    emptyMsg.style.display = "none";
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.1);";
      row.innerHTML = `
        <div style="flex:1;">
          <div>${item.name}</div>
          <div style="font-size:12px; color:var(--text-dim);">$${item.price.toFixed(2)} each</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn btn-ghost" data-minus="${item.productId}" style="padding:2px 8px;">–</button>
          <span>${item.qty}</span>
          <button class="btn btn-ghost" data-plus="${item.productId}" style="padding:2px 8px;">+</button>
        </div>
        <div style="width:64px; text-align:right;">$${(item.price * item.qty).toFixed(2)}</div>
        <button class="btn btn-ghost" data-remove="${item.productId}">✕</button>
      `;
      list.appendChild(row);
    });
  }

  document.getElementById("cartTotal").textContent = `$${getCartTotal().toFixed(2)}`;

  list.querySelectorAll("[data-minus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.minus;
      const item = cart.find((i) => i.productId === id);
      if (item) setQty(id, item.qty - 1);
    });
  });
  list.querySelectorAll("[data-plus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.plus;
      const item = cart.find((i) => i.productId === id);
      if (item) setQty(id, item.qty + 1);
    });
  });
  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeFromCart(btn.dataset.remove));
  });
}

// Call once on page load. onCheckout receives the cart array when the
// "Checkout" button in the cart drawer is clicked.
export function initCart(onCheckout) {
  onCheckoutCallback = onCheckout;
  document.getElementById("openCart").addEventListener("click", openCart);
  document.getElementById("closeCart").addEventListener("click", closeCart);
  document.getElementById("cartCheckoutBtn").addEventListener("click", () => {
    if (cart.length === 0) return;
    closeCart();
    onCheckoutCallback(cart);
  });
  render();
}
