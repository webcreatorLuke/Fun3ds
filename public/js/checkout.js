```javascript
import { auth, WORKER_URL } from "./firebase-config.js";
import { clearCart } from "./cart.js";

const stripeScript = document.createElement("script");
stripeScript.src = "https://js.stripe.com/v3/";
stripeScript.async = true;
document.head.appendChild(stripeScript);

let stripe = null;
let elements = null;
let paymentElement = null;
let currentOrderId = null;
let checkoutReady = false;

const modal = document.getElementById("checkoutModal");

document
  .getElementById("closeCheckout")
  .addEventListener("click", () => {
    modal.style.display = "none";
  });

function setStatus(message) {
  document.getElementById("ckStatus").textContent = message;
}

async function loadStripe() {
  if (stripe) return stripe;

  if (window.Stripe) {
    stripe = window.Stripe("__STRIPE_PUBLISHABLE_KEY__");
    return stripe;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Stripe took too long to load."));
    }, 15000);

    stripeScript.addEventListener(
      "load",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );

    stripeScript.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Could not load Stripe."));
      },
      { once: true }
    );
  });

  if (!window.Stripe) {
    throw new Error("Stripe failed to load.");
  }

  stripe = window.Stripe("__STRIPE_PUBLISHABLE_KEY__");
  return stripe;
}

function destroyPaymentElement() {
  checkoutReady = false;

  if (paymentElement) {
    try {
      paymentElement.destroy();
    } catch (e) {
      console.warn("Could not destroy old Payment Element:", e);
    }
  }

  paymentElement = null;
  elements = null;

  const container = document.getElementById("paymentElement");
  if (container) {
    container.innerHTML = "";
  }
}

export async function openCheckout(cartItems) {
  if (!auth.currentUser) {
    document.getElementById("loginModal").style.display = "flex";
    return;
  }

  if (!cartItems || cartItems.length === 0) return;

  const total = cartItems.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  document.getElementById("ckSummary").innerHTML = cartItems
    .map(
      item => `
        <div style="display:flex; justify-content:space-between;">
          <span>${item.name} × ${item.qty}</span>
          <span>$${(item.price * item.qty).toFixed(2)}</span>
        </div>
      `
    )
    .join("");

  document.getElementById("ckPrice").textContent =
    `$${total.toFixed(2)}`;

  document.getElementById("ckName").value = "";
  document.getElementById("ckAddress").value = "";

  setStatus("");
  modal.style.display = "flex";

  destroyPaymentElement();

  try {
    setStatus("Preparing checkout…");

    await loadStripe();

    const idToken = await auth.currentUser.getIdToken();

    const res = await fetch(
      `${WORKER_URL}/create-payment-intent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          items: cartItems.map(item => ({
            productId: item.productId,
            quantity: item.qty
          }))
        })
      }
    );

    let data = {};

    try {
      data = await res.json();
    } catch {
      throw new Error("The payment server returned an invalid response.");
    }

    if (!res.ok) {
      throw new Error(
        data.error || `Checkout failed (${res.status}).`
      );
    }

    if (!data.clientSecret) {
      throw new Error("Payment server did not return a client secret.");
    }

    if (!data.orderId) {
      throw new Error("Payment server did not return an order ID.");
    }

    currentOrderId = data.orderId;

    elements = stripe.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: "night"
      }
    });

    paymentElement = elements.create("payment");

    const container = document.getElementById("paymentElement");

    if (!container) {
      throw new Error("Payment Element container was not found.");
    }

    paymentElement.mount(container);

    await paymentElementReady();

    checkoutReady = true;

    setStatus("");

  } catch (e) {
    console.error("Checkout setup error:", e);
    checkoutReady = false;
    setStatus("Couldn't start checkout: " + e.message);
  }
}

function paymentElementReady() {
  return new Promise((resolve, reject) => {
    if (!paymentElement) {
      reject(new Error("Payment Element was not created."));
      return;
    }

    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Payment form took too long to load."));
      }
    }, 15000);

    paymentElement.on("ready", () => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);
      resolve();
    });

    paymentElement.on("loaderror", event => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      reject(
        new Error(
          event?.error?.message ||
          "Payment form could not be loaded."
        )
      );
    });
  });
}

document
  .getElementById("ckPayBtn")
  .addEventListener("click", async () => {

    const status = document.getElementById("ckStatus");
    const button = document.getElementById("ckPayBtn");

    const name = document
      .getElementById("ckName")
      .value
      .trim();

    const address = document
      .getElementById("ckAddress")
      .value
      .trim();

    if (!name || !address) {
      status.textContent =
        "Enter your name and shipping address.";
      return;
    }

    if (!auth.currentUser) {
      status.textContent = "Please sign in again.";
      return;
    }

    if (!stripe || !elements || !paymentElement || !checkoutReady) {
      status.textContent =
        "Payment form is still loading. Please wait a moment and try again.";
      return;
    }

    if (!currentOrderId) {
      status.textContent =
        "No active order. Please close checkout and try again.";
      return;
    }

    button.disabled = true;
    status.textContent = "Saving delivery information…";

    try {
      const idToken =
        await auth.currentUser.getIdToken();

      const confirmRes = await fetch(
        `${WORKER_URL}/set-order-delivery-info`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            orderId: currentOrderId,
            name,
            address
          })
        }
      );

      if (!confirmRes.ok) {
        let err = {};

        try {
          err = await confirmRes.json();
        } catch {}

        throw new Error(
          err.error ||
          "Couldn't save delivery information."
        );
      }

      status.textContent = "Processing payment…";

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url:
            window.location.origin +
            "/success.html?orderId=" +
            encodeURIComponent(currentOrderId)
        },
        redirect: "if_required"
      });

      if (result.error) {
        status.textContent = result.error.message;
        button.disabled = false;
        return;
      }

      const paymentIntent = result.paymentIntent;

      if (
        paymentIntent &&
        paymentIntent.status === "succeeded"
      ) {
        status.textContent =
          "Payment confirmed! Redirecting…";

        clearCart();

        window.location.href =
          "success.html?orderId=" +
          encodeURIComponent(currentOrderId);

        return;
      }

      if (
        paymentIntent &&
        paymentIntent.status === "processing"
      ) {
        status.textContent =
          "Payment is processing. Redirecting…";

        window.location.href =
          "success.html?orderId=" +
          encodeURIComponent(currentOrderId);

        return;
      }

      status.textContent =
        "Payment was not completed. Please try again.";

      button.disabled = false;

    } catch (e) {
      console.error("Payment error:", e);

      status.textContent =
        "Payment failed: " + e.message;

      button.disabled = false;
    }
  });
```
