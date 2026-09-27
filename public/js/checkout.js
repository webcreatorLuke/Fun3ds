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

document.getElementById("closeCheckout").addEventListener("click", function () {
  modal.style.display = "none";
});

function setStatus(message) {
  document.getElementById("ckStatus").textContent = message;
}

async function loadStripe() {
  if (stripe) {
    return stripe;
  }

  if (window.Stripe) {
    stripe = window.Stripe("__STRIPE_PUBLISHABLE_KEY__");
    return stripe;
  }

  await new Promise(function (resolve, reject) {
    const timeout = setTimeout(function () {
      reject(new Error("Stripe took too long to load."));
    }, 15000);

    stripeScript.addEventListener(
      "load",
      function () {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );

    stripeScript.addEventListener(
      "error",
      function () {
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

  if (!cartItems || cartItems.length === 0) {
    return;
  }

  const total = cartItems.reduce(function (sum, item) {
    return sum + item.price * item.qty;
  }, 0);

  const summary = document.getElementById("ckSummary");

  summary.innerHTML = "";

  cartItems.forEach(function (item) {
    const row = document.createElement("div");

    row.style.display = "flex";
    row.style.justifyContent = "space-between";

    const name = document.createElement("span");
    name.textContent = item.name + " × " + item.qty;

    const price = document.createElement("span");
    price.textContent =
      "$" + (item.price * item.qty).toFixed(2);

    row.appendChild(name);
    row.appendChild(price);
    summary.appendChild(row);
  });

  document.getElementById("ckPrice").textContent =
    "$" + total.toFixed(2);

  document.getElementById("ckName").value = "";
  document.getElementById("ckAddress").value = "";

  setStatus("");

  modal.style.display = "flex";

  destroyPaymentElement();

  try {
    setStatus("Preparing checkout…");

    await loadStripe();

    const idToken =
      await auth.currentUser.getIdToken();

    const response = await fetch(
      WORKER_URL + "/create-payment-intent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + idToken
        },
        body: JSON.stringify({
          items: cartItems.map(function (item) {
            return {
              productId: item.productId,
              quantity: item.qty
            };
          })
        })
      }
    );

    let data = {};

    try {
      data = await response.json();
    } catch (e) {
      throw new Error(
        "The payment server returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Checkout failed (" + response.status + ")."
      );
    }

    if (!data.clientSecret) {
      throw new Error(
        "Payment server did not return a client secret."
      );
    }

    if (!data.orderId) {
      throw new Error(
        "Payment server did not return an order ID."
      );
    }

    currentOrderId = data.orderId;

    elements = stripe.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: "night"
      }
    });

    paymentElement = elements.create("payment");

    const container =
      document.getElementById("paymentElement");

    if (!container) {
      throw new Error(
        "Payment Element container was not found."
      );
    }

    paymentElement.mount(container);

    await new Promise(function (resolve, reject) {
      let finished = false;

      const timeout = setTimeout(function () {
        if (!finished) {
          finished = true;
          reject(
            new Error(
              "Payment form took too long to load."
            )
          );
        }
      }, 15000);

      paymentElement.on("ready", function () {
        if (finished) return;

        finished = true;
        clearTimeout(timeout);
        resolve();
      });

      paymentElement.on("loaderror", function (event) {
        if (finished) return;

        finished = true;
        clearTimeout(timeout);

        reject(
          new Error(
            event &&
            event.error &&
            event.error.message
              ? event.error.message
              : "Payment form could not be loaded."
          )
        );
      });
    });

    checkoutReady = true;
    setStatus("");

  } catch (e) {
    console.error("Checkout setup error:", e);

    checkoutReady = false;

    setStatus(
      "Couldn't start checkout: " + e.message
    );
  }
}

document.getElementById("ckPayBtn").addEventListener(
  "click",
  async function () {
    const status =
      document.getElementById("ckStatus");

    const button =
      document.getElementById("ckPayBtn");

    const name =
      document.getElementById("ckName").value.trim();

    const address =
      document.getElementById("ckAddress").value.trim();

    if (!name || !address) {
      status.textContent =
        "Enter your name and shipping address.";
      return;
    }

    if (!auth.currentUser) {
      status.textContent =
        "Please sign in again.";
      return;
    }

    if (
      !stripe ||
      !elements ||
      !paymentElement ||
      !checkoutReady
    ) {
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

    try {
      status.textContent =
        "Saving delivery information…";

      const idToken =
        await auth.currentUser.getIdToken();

      const deliveryResponse = await fetch(
        WORKER_URL + "/set-order-delivery-info",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + idToken
          },
          body: JSON.stringify({
            orderId: currentOrderId,
            name: name,
            address: address
          })
        }
      );

      if (!deliveryResponse.ok) {
        let errorData = {};

        try {
          errorData = await deliveryResponse.json();
        } catch (e) {}

        throw new Error(
          errorData.error ||
          "Couldn't save delivery information."
        );
      }

      status.textContent =
        "Processing payment…";

      const result =
        await stripe.confirmPayment({
          elements: elements,
          confirmParams: {
            return_url:
              window.location.origin +
              "/success.html?orderId=" +
              encodeURIComponent(currentOrderId)
          },
          redirect: "if_required"
        });

      if (result.error) {
        status.textContent =
          result.error.message;

        button.disabled = false;
        return;
      }

      const paymentIntent =
        result.paymentIntent;

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
  }
);
```
