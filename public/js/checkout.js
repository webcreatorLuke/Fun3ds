import { auth, WORKER_URL } from "./firebase-config.js";
import { clearCart } from "./cart.js";

const stripeScript = document.createElement("script");
stripeScript.src = "https://js.stripe.com/v3/";
document.head.appendChild(stripeScript);

let stripe, elements, currentOrderId;

const modal = document.getElementById("checkoutModal");
document.getElementById("closeCheckout").addEventListener("click", () => modal.style.display = "none");

export async function openCheckout(cartItems) {
  if (!auth.currentUser) {
    document.getElementById("loginModal").style.display = "flex";
    return;
  }
  if (!cartItems || cartItems.length === 0) return;

  const total = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);

  document.getElementById("ckSummary").innerHTML = cartItems
    .map(i => `<div style="display:flex; justify-content:space-between;"><span>${i.name} × ${i.qty}</span><span>$${(i.price * i.qty).toFixed(2)}</span></div>`)
    .join("");
  document.getElementById("ckPrice").textContent = `$${total.toFixed(2)}`;
  document.getElementById("ckStatus").textContent = "";
  modal.style.display = "flex";

  if (!stripe) {
    await new Promise(res => { if (window.Stripe) return res(); stripeScript.onload = res; });
    stripe = Stripe("__STRIPE_PUBLISHABLE_KEY__");
  }

  document.getElementById("ckStatus").textContent = "Preparing checkout…";
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/create-payment-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        items: cartItems.map(i => ({ productId: i.productId, quantity: i.qty }))
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed.");

    currentOrderId = data.orderId;
    elements = stripe.elements({ clientSecret: data.clientSecret, appearance: { theme: "night" } });
    const paymentElement = elements.create("payment");
    paymentElement.mount("#paymentElement");
    document.getElementById("ckStatus").textContent = "";
  } catch (e) {
    document.getElementById("ckStatus").textContent = "Couldn't start checkout: " + e.message;
  }
}

document.getElementById("ckPayBtn").addEventListener("click", async () => {
  const status = document.getElementById("ckStatus");
  const name = document.getElementById("ckName").value.trim();
  const address = document.getElementById("ckAddress").value.trim();
  if (!name || !address) { status.textContent = "Enter your name and shipping address."; return; }

  status.textContent = "Processing payment…";

  try {
    const idToken = await auth.currentUser.getIdToken();
    const confirmRes = await fetch(`${WORKER_URL}/set-order-delivery-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ orderId: currentOrderId, name, address })
    });
    if (!confirmRes.ok) {
      const err = await confirmRes.json();
      throw new Error(err.error || "Couldn't save delivery info.");
    }

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.origin + "/success.html?orderId=" + currentOrderId },
      redirect: "if_required"
    });

    if (error) {
      status.textContent = error.message;
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      status.textContent = "Payment confirmed! Redirecting…";
      clearCart();
      window.location.href = "success.html?orderId=" + currentOrderId;
    }
  } catch (e) {
    status.textContent = "Payment failed: " + e.message;
  }
});
