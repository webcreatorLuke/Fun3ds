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
let currentCartItems = [];
let selectedRateId = null;
let currentSubtotal = 0;

const modal = document.getElementById("checkoutModal");
const stepAddress = document.getElementById("ckStepAddress");
const stepRates = document.getElementById("ckStepRates");
const stepPayment = document.getElementById("ckStepPayment");

document.getElementById("closeCheckout").addEventListener("click", function () {
  modal.style.display = "none";
});

function setStatus(message) {
  document.getElementById("ckStatus").textContent = message;
}

function showStep(step) {
  stepAddress.style.display = step === "address" ? "" : "none";
  stepRates.style.display = step === "rates" ? "" : "none";
  stepPayment.style.display = step === "payment" ? "" : "none";
}

async function loadStripe() {
  if (stripe) return stripe;
  if (window.Stripe) {
    stripe = window.Stripe("__STRIPE_PUBLISHABLE_KEY__");
    return stripe;
  }
  await new Promise(function (resolve, reject) {
    const timeout = setTimeout(function () { reject(new Error("Stripe took too long to load.")); }, 15000);
    stripeScript.addEventListener("load", function () { clearTimeout(timeout); resolve(); }, { once: true });
    stripeScript.addEventListener("error", function () { clearTimeout(timeout); reject(new Error("Could not load Stripe.")); }, { once: true });
  });
  if (!window.Stripe) throw new Error("Stripe failed to load.");
  stripe = window.Stripe("__STRIPE_PUBLISHABLE_KEY__");
  return stripe;
}

function destroyPaymentElement() {
  checkoutReady = false;
  if (paymentElement) {
    try { paymentElement.destroy(); } catch (e) { console.warn("Could not destroy old Payment Element:", e); }
  }
  paymentElement = null;
  elements = null;
  const container = document.getElementById("paymentElement");
  if (container) container.innerHTML = "";
}

function renderSummary(extraLine) {
  const summary = document.getElementById("ckSummary");
  summary.innerHTML = "";
  currentCartItems.forEach(function (item) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.innerHTML = `<span>${item.name} × ${item.qty}</span><span>$${(item.price * item.qty).toFixed(2)}</span>`;
    summary.appendChild(row);
  });
  if (extraLine) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.borderTop = "1px solid var(--line)";
    row.style.marginTop = "6px";
    row.style.paddingTop = "6px";
    row.innerHTML = extraLine;
    summary.appendChild(row);
  }
}

export async function openCheckout(cartItems) {
  if (!auth.currentUser) {
    document.getElementById("loginModal").style.display = "flex";
    return;
  }
  if (!cartItems || cartItems.length === 0) return;

  currentCartItems = cartItems;
  currentSubtotal = cartItems.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
  selectedRateId = null;
  currentOrderId = null;

  renderSummary();
  document.getElementById("ckName").value = "";
  document.getElementById("ckStreet1").value = "";
  document.getElementById("ckStreet2").value = "";
  document.getElementById("ckCity").value = "";
  document.getElementById("ckState").value = "";
  document.getElementById("ckZip").value = "";
  document.getElementById("ckRatesList").innerHTML = "";
  document.getElementById("ckContinueBtn").disabled = true;

  setStatus("");
  destroyPaymentElement();
  showStep("address");
  modal.style.display = "flex";
}

function currentAddress() {
  return {
    name: document.getElementById("ckName").value.trim(),
    street1: document.getElementById("ckStreet1").value.trim(),
    street2: document.getElementById("ckStreet2").value.trim(),
    city: document.getElementById("ckCity").value.trim(),
    state: document.getElementById("ckState").value.trim().toUpperCase(),
    zip: document.getElementById("ckZip").value.trim(),
    country: "US"
  };
}

// ---------- Step 1 → 2: get real shipping rates ----------
document.getElementById("ckGetRatesBtn").addEventListener("click", async function () {
  const address = currentAddress();
  if (!address.name || !address.street1 || !address.city || !address.state || !address.zip) {
    setStatus("Fill in your full shipping address.");
    return;
  }
  if (!auth.currentUser) { setStatus("Please sign in again."); return; }

  const btn = document.getElementById("ckGetRatesBtn");
  btn.disabled = true;
  setStatus("Getting shipping rates…");

  try {
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(WORKER_URL + "/get-shipping-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
      body: JSON.stringify({
        items: currentCartItems.map(function (item) { return { productId: item.productId, quantity: item.qty }; }),
        address: address
      })
    });

    let data = {};
    try { data = await response.json(); } catch (e) { throw new Error("The shipping server returned an invalid response."); }
    if (!response.ok) throw new Error(data.error || "Couldn't get shipping rates (" + response.status + ").");
    if (!data.rates || data.rates.length === 0) throw new Error("No shipping options for that address.");

    const list = document.getElementById("ckRatesList");
    list.innerHTML = "";
    data.rates.forEach(function (rate, i) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid var(--line); border-radius:6px; margin-bottom:8px; cursor:pointer;";
      row.innerHTML = `
        <span style="display:flex; align-items:center; gap:8px;">
          <input type="radio" name="ckRate" value="${rate.id}" ${i === 0 ? "checked" : ""} />
          <span>${rate.carrier} — ${rate.service}${rate.estimatedDays ? ` (${rate.estimatedDays}d)` : ""}</span>
        </span>
        <strong>$${parseFloat(rate.amount).toFixed(2)}</strong>
      `;
      list.appendChild(row);
    });

    selectedRateId = data.rates[0].id;
    list.querySelectorAll('input[name="ckRate"]').forEach(function (input) {
      input.addEventListener("change", function () { selectedRateId = input.value; });
    });

    document.getElementById("ckContinueBtn").disabled = false;
    setStatus("");
    showStep("rates");
  } catch (e) {
    console.error("Shipping rate error:", e);
    setStatus("Couldn't get shipping rates: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("ckBackToAddress").addEventListener("click", function () {
  setStatus("");
  showStep("address");
});

// ---------- Step 2 → 3: create the payment intent and mount payment element ----------
document.getElementById("ckContinueBtn").addEventListener("click", async function () {
  if (!selectedRateId) { setStatus("Pick a shipping option."); return; }
  const btn = document.getElementById("ckContinueBtn");
  btn.disabled = true;
  setStatus("Preparing checkout…");

  try {
    await loadStripe();
    const idToken = await auth.currentUser.getIdToken();

    const response = await fetch(WORKER_URL + "/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
      body: JSON.stringify({
        items: currentCartItems.map(function (item) { return { productId: item.productId, quantity: item.qty }; }),
        address: currentAddress(),
        rateId: selectedRateId
      })
    });

    let data = {};
    try { data = await response.json(); } catch (e) { throw new Error("The payment server returned an invalid response."); }
    if (!response.ok) throw new Error(data.error || "Checkout failed (" + response.status + ").");
    if (!data.clientSecret) throw new Error("Payment server did not return a client secret.");
    if (!data.orderId) throw new Error("Payment server did not return an order ID.");

    currentOrderId = data.orderId;
    const shippingAmount = data.shipping ? data.shipping.amount : 0;
    renderSummary(`<span>Shipping</span><span>$${shippingAmount.toFixed(2)}</span>`);
    document.getElementById("ckPrice").textContent = "$" + data.amountTotal.toFixed(2);

    elements = stripe.elements({ clientSecret: data.clientSecret, appearance: { theme: "night" } });
    paymentElement = elements.create("payment");
    const container = document.getElementById("paymentElement");
    if (!container) throw new Error("Payment Element container was not found.");
    paymentElement.mount(container);

    await new Promise(function (resolve, reject) {
      let finished = false;
      const timeout = setTimeout(function () { if (!finished) { finished = true; reject(new Error("Payment form took too long to load.")); } }, 15000);
      paymentElement.on("ready", function () { if (finished) return; finished = true; clearTimeout(timeout); resolve(); });
      paymentElement.on("loaderror", function (event) {
        if (finished) return; finished = true; clearTimeout(timeout);
        reject(new Error(event && event.error && event.error.message ? event.error.message : "Payment form could not be loaded."));
      });
    });

    checkoutReady = true;
    setStatus("");
    showStep("payment");
  } catch (e) {
    console.error("Checkout setup error:", e);
    checkoutReady = false;
    setStatus("Couldn't start checkout: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Step 3: pay ----------
document.getElementById("ckPayBtn").addEventListener("click", async function () {
  const status = document.getElementById("ckStatus");
  const button = document.getElementById("ckPayBtn");

  if (!auth.currentUser) { status.textContent = "Please sign in again."; return; }
  if (!stripe || !elements || !paymentElement || !checkoutReady) {
    status.textContent = "Payment form is still loading. Please wait a moment and try again.";
    return;
  }
  if (!currentOrderId) { status.textContent = "No active order. Please close checkout and try again."; return; }

  button.disabled = true;
  status.textContent = "Processing payment…";

  try {
    const result = await stripe.confirmPayment({
      elements: elements,
      confirmParams: { return_url: window.location.origin + "/success.html?orderId=" + encodeURIComponent(currentOrderId) },
      redirect: "if_required"
    });

    if (result.error) {
      status.textContent = result.error.message;
      button.disabled = false;
      return;
    }

    const paymentIntent = result.paymentIntent;
    if (paymentIntent && paymentIntent.status === "succeeded") {
      status.textContent = "Payment confirmed! Redirecting…";
      clearCart();
      window.location.href = "success.html?orderId=" + encodeURIComponent(currentOrderId);
      return;
    }
    if (paymentIntent && paymentIntent.status === "processing") {
      status.textContent = "Payment is processing. Redirecting…";
      window.location.href = "success.html?orderId=" + encodeURIComponent(currentOrderId);
      return;
    }

    status.textContent = "Payment was not completed. Please try again.";
    button.disabled = false;
  } catch (e) {
    console.error("Payment error:", e);
    status.textContent = "Payment failed: " + e.message;
    button.disabled = false;
  }
});
