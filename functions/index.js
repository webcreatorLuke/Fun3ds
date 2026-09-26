const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Stripe = require("stripe");

initializeApp();
const db = getFirestore();

// ---- Secrets: set these with `firebase functions:secrets:set NAME` ----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Must match public/js/firebase-config.js ADMIN_EMAIL exactly.
const ADMIN_EMAIL = "lukeplaysgamezandmore@gmail.com";

// Your Cloudflare Worker CORS proxy in front of the FlowQ print queue API
// (the same one Fun3ds already uses) — set as an env var, not hardcoded.
const FLOWQ_PROXY_URL = process.env.FLOWQ_PROXY_URL || "https://YOUR-WORKER.workers.dev";

function requireAdmin(context) {
  if (!context.auth || context.auth.token.email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

// Queues a file to print via the existing FlowQ Cloudflare Worker proxy.
// Returns whatever job identifier FlowQ's API hands back — adjust the
// request shape here to match your actual FlowQ/worker contract.
async function sendToFlowQ(fileId, label) {
  const res = await fetch(`${FLOWQ_PROXY_URL}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, label })
  });
  if (!res.ok) throw new Error(`FlowQ proxy responded ${res.status}`);
  return res.json();
}

// ================= CHECKOUT =================

// Creates a pending order + a Stripe PaymentIntent for one product.
// The client mounts Stripe's Payment Element against the returned clientSecret.
exports.createPaymentIntent = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { productId, quantity = 1 } = request.data;
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!productId) throw new HttpsError("invalid-argument", "productId required.");

  const stripe = Stripe(STRIPE_SECRET_KEY.value());
  const productRef = db.collection("products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) throw new HttpsError("not-found", "Product not found.");
  const product = productSnap.data();
  if (product.stock < quantity) throw new HttpsError("failed-precondition", "Out of stock.");

  const amount = Math.round(product.price * quantity * 100); // cents

  const orderRef = await db.collection("orders").add({
    uid: request.auth.uid,
    customerEmail: request.auth.token.email,
    items: [{ productId, name: product.name, qty: quantity, price: product.price }],
    amountTotal: product.price * quantity,
    status: "pending",
    flowqSent: false,
    createdAt: FieldValue.serverTimestamp()
  });

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    metadata: { orderId: orderRef.id, productId }
  });

  await orderRef.update({ stripePaymentIntentId: paymentIntent.id });

  return { clientSecret: paymentIntent.client_secret, orderId: orderRef.id };
});

// Saves name/address before payment is confirmed — kept separate from the
// PaymentIntent itself so it's simple to store however you like in Firestore.
exports.setOrderDeliveryInfo = onCall(async (request) => {
  const { orderId, name, address } = request.data;
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const orderRef = db.collection("orders").doc(orderId);
  const order = (await orderRef.get()).data();
  if (!order || order.uid !== request.auth.uid) throw new HttpsError("permission-denied", "Not your order.");
  await orderRef.update({ deliveryInfo: { name, address } });
  return { ok: true };
});

// Stripe calls this directly (not through the Firebase SDK) — register this
// function's URL in the Stripe Dashboard as a webhook endpoint listening for
// payment_intent.succeeded.
exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = Stripe(STRIPE_SECRET_KEY.value());
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    res.status(400).send(`Webhook signature error: ${err.message}`);
    return;
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const orderId = intent.metadata.orderId;
    const orderRef = db.collection("orders").doc(orderId);
    const order = (await orderRef.get()).data();
    if (order && order.status !== "paid") {
      await orderRef.update({ status: "paid", paidAt: FieldValue.serverTimestamp() });

      // Decrement stock for each item.
      for (const item of order.items) {
        await db.collection("products").doc(item.productId).update({
          stock: FieldValue.increment(-item.qty)
        });
      }

      // Auto-send to FlowQ if this product has a known file already.
      const productSnap = await db.collection("products").doc(order.items[0].productId).get();
      const flowqFileId = productSnap.data()?.flowqFileId;
      if (flowqFileId) {
        try {
          const job = await sendToFlowQ(flowqFileId, order.items[0].name);
          await orderRef.update({ flowqSent: true, flowqJobId: job.jobId || null });
        } catch (e) {
          // Payment still succeeded even if FlowQ is briefly unreachable —
          // it stays visible as "not sent" in admin so you can retry manually.
          console.error("FlowQ send failed:", e.message);
        }
      }
    }
  }

  res.json({ received: true });
});

// Manual retry button in admin, for orders that didn't auto-send.
exports.sendOrderToFlowQ = onCall(async (request) => {
  requireAdmin(request);
  const orderRef = db.collection("orders").doc(request.data.orderId);
  const order = (await orderRef.get()).data();
  if (!order) throw new HttpsError("not-found", "Order not found.");
  const productSnap = await db.collection("products").doc(order.items[0].productId).get();
  const flowqFileId = productSnap.data()?.flowqFileId;
  if (!flowqFileId) throw new HttpsError("failed-precondition", "This product has no FlowQ file ID set.");
  const job = await sendToFlowQ(flowqFileId, order.items[0].name);
  await orderRef.update({ flowqSent: true, flowqJobId: job.jobId || null });
  return { ok: true };
});

// ================= CUSTOM REQUESTS =================

exports.acceptCustomRequest = onCall(async (request) => {
  requireAdmin(request);
  const { requestId, price, paymentLink, flowqFileId } = request.data;
  if (!price || !paymentLink) throw new HttpsError("invalid-argument", "Price and payment link required.");

  const reqRef = db.collection("customRequests").doc(requestId);
  const update = { status: "accepted", price, paymentLink, acceptedAt: FieldValue.serverTimestamp() };

  // A custom request only has a real, ready-to-print file once you (the
  // admin) provide one at accept time — there's nothing to auto-queue
  // before that, since these are one-off models, not catalog items.
  if (flowqFileId) {
    const reqSnap = await reqRef.get();
    const r = reqSnap.data();
    const label = r.type === "dog" ? `${r.petName}'s print` : "Custom online print";
    const job = await sendToFlowQ(flowqFileId, label);
    update.flowqFileId = flowqFileId;
    update.flowqSent = true;
    update.flowqJobId = job.jobId || null;
  }

  await reqRef.update(update);
  return { ok: true };
});

exports.declineCustomRequest = onCall(async (request) => {
  requireAdmin(request);
  const { requestId, reason = "" } = request.data;
  await db.collection("customRequests").doc(requestId).update({
    status: "declined", declineReason: reason, declinedAt: FieldValue.serverTimestamp()
  });
  return { ok: true };
});
