import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { functions, auth } from "./firebase-config.js";

// Stripe.js must be loaded from stripe.com's own CDN — required by Stripe, and
// safe: it never has access to your secret key or full card data.
const stripeScript = document.createElement("script");
stripeScript.src = "https://js.stripe.com/v3/";
document.head.appendChild(stripeScript);

let stripe, elements, currentProduct, currentOrderId;

const modal = document.getElementById("checkoutModal");
document.getElementById("closeCheckout").addEventListener("click", () => modal.style.display = "none");

export async function openCheckout(product) {
  if (!auth.currentUser) {
    document.getElementById("loginModal").style.display = "flex";
    return;
  }
  currentProduct = product;
  document.getElementById("ckProductName").textContent = product.name;
  document.getElementById("ckPrice").textContent = `$${product.price.toFixed(2)}`;
  document.getElementById("ckStatus").textContent = "";
  modal.style.display = "flex";

  // STRIPE_PUBLISHABLE_KEY is swapped in by the GitHub Actions deploy
  // workflow from a GitHub Secret — it never appears in this file as
  // committed. Publishable keys are safe to expose publicly regardless,
  // but this keeps it out of your repo history entirely if you'd rather.
  if (!stripe) {
    await new Promise(res => { if (window.Stripe) return res(); stripeScript.onload = res; });
    stripe = Stripe("__STRIPE_PUBLISHABLE_KEY__");
  }

  const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");
  document.getElementById("ckStatus").textContent = "Preparing checkout…";
  try {
    const { data } = await createPaymentIntent({
      productId: product.id,
      quantity: 1
    });
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

  const confirmDelivery = httpsCallable(functions, "setOrderDeliveryInfo");
  status.textContent = "Processing payment…";

  try {
    await confirmDelivery({ orderId: currentOrderId, name, address });

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
      window.location.href = "success.html?orderId=" + currentOrderId;
    }
  } catch (e) {
    status.textContent = "Payment failed: " + e.message;
  }
});
