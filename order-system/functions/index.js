const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const PAYSTACK_SECRET_KEY = functions.config().paystack.secret_key;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

// ─── HELPER: Verify Paystack Signature ─────────────────────────────
function verifyPaystackSignature(payload, signature) {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(payload))
    .digest("hex");
  return hash === signature;
}

// ─── HELPER: Initialize Paystack Transaction ───────────────────────
async function initializePaystackTransaction(email, amount, reference, metadata) {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    {
      email,
      amount: Math.round(amount * 100), // Paystack expects kobo/cents
      reference,
      metadata,
      callback_url: metadata.callback_url || `${metadata.site_url}/order-details.html?orderId=${metadata.orderId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.data;
}

// ─── CLOUD FUNCTION: Initialize Payment ─────────────────────────────
exports.initializePayment = functions.https.onCall(async (data, context) => {
  // 1. Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
  }

  const uid = context.auth.uid;
  const { cart, shipping } = data;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Cart is empty.");
  }

  if (!shipping || !shipping.customerName || !shipping.email || !shipping.phone || !shipping.address || !shipping.city) {
    throw new functions.https.HttpsError("invalid-argument", "Shipping information is incomplete.");
  }

  // 2. Validate cart against Firestore and calculate totals
  const productIds = cart.map(item => item.productId);
  const productsSnap = await db.collection("products").where(admin.firestore.FieldPath.documentId(), "in", productIds).get();

  if (productsSnap.empty) {
    throw new functions.https.HttpsError("not-found", "Some products no longer exist.");
  }

  const productsMap = {};
  productsSnap.forEach(doc => {
    productsMap[doc.id] = doc.data();
  });

  let subtotal = 0;
  const validatedItems = [];

  for (const cartItem of cart) {
    const product = productsMap[cartItem.productId];
    if (!product) {
      throw new functions.https.HttpsError("not-found", `Product ${cartItem.productId} not found.`);
    }

    const quantity = Math.min(cartItem.quantity, product.stock);
    if (quantity <= 0) {
      throw new functions.https.HttpsError("failed-precondition", `Insufficient stock for ${product.productName}.`);
    }

    const price = product.price;
    const lineTotal = price * quantity;
    subtotal += lineTotal;

    validatedItems.push({
      productId: product.productId,
      productName: product.productName,
      image: product.image || cartItem.image,
      quantity,
      price,
      subtotal: lineTotal,
    });
  }

  const deliveryFee = 1500;
  const total = subtotal + deliveryFee;

  // 3. Generate order ID and reference
  const orderId = `ORD-${Date.now()}-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
  const paystackReference = `PAY-${orderId}`;

  // 4. Create order in Firestore (pending payment)
  const orderData = {
    orderId,
    userId: uid,
    customerName: shipping.customerName,
    email: shipping.email,
    phone: shipping.phone,
    address: shipping.address,
    city: shipping.city,
    paymentMethod: "paystack",
    paymentStatus: "pending",
    orderStatus: "pending",
    items: validatedItems,
    subtotal,
    deliveryFee,
    total,
    paystackReference,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("orders").doc(orderId).set(orderData);
  await db.collection("users").doc(uid).collection("orders").doc(orderId).set(orderData);

  // 5. Initialize Paystack transaction
  const paystackResponse = await initializePaystackTransaction(
    shipping.email,
    total,
    paystackReference,
    {
      orderId,
      userId: uid,
      site_url: process.env.SITE_URL || "http://localhost:8000/order-system",
    }
  );

  // 6. Update order with Paystack access code
  await db.collection("orders").doc(orderId).update({
    paystackAccessCode: paystackResponse.access_code,
  });
  await db.collection("users").doc(uid).collection("orders").doc(orderId).update({
    paystackAccessCode: paystackResponse.access_code,
  });

  return {
    orderId,
    reference: paystackReference,
    authorization_url: paystackResponse.authorization_url,
    access_code: paystackResponse.access_code,
  };
});

// ─── HELPER: Verify Payment with Paystack API ───────────────────────────
async function verifyPaymentWithPaystack(reference) {
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data?.status && response.data?.data?.status === "success") {
      return {
        valid: true,
        amount: response.data.data.amount,
        currency: response.data.data.currency,
        paidAt: response.data.data.paid_at,
        gatewayResponse: response.data.data.gateway_response,
      };
    }
    return { valid: false };
  } catch (error) {
    console.error(`Paystack verification error for ${reference}:`, error.message);
    return { valid: false };
  }
}

// ─── CLOUD FUNCTION: Paystack Webhook ──────────────────────────────
exports.paystackWebhook = functions.https.onRequest(async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const payload = req.body;

  // Verify webhook signature
  if (!signature || !verifyPaystackSignature(payload, signature)) {
    console.error("Invalid webhook signature");
    return res.status(401).send("Invalid signature");
  }

  const event = payload.event;
  const data = payload.data;

  if (event === "charge.success") {
    const reference = data.reference;

    // Validate reference format
    if (!reference || !reference.startsWith("PAY-")) {
      console.error("Invalid reference format:", reference);
      return res.status(400).send("Invalid reference format");
    }

    const orderId = reference.replace("PAY-", "");

    try {
      // Explicitly verify payment with Paystack API (defense-in-depth)
      const verification = await verifyPaymentWithPaystack(reference);
      if (!verification.valid) {
        console.error(`Payment verification failed for ${reference}`);
        return res.status(400).send("Payment verification failed");
      }

      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        console.error(`Order ${orderId} not found`);
        return res.status(404).send("Order not found");
      }

      const orderData = orderSnap.data();

      // Prevent double processing
      if (orderData.paymentStatus === "paid") {
        return res.status(200).send("Already processed");
      }

      // Verify amount matches (using verified amount from API)
      const expectedAmount = Math.round(orderData.total * 100);
      if (verification.amount !== expectedAmount) {
        console.error(`Amount mismatch for ${orderId}: expected ${expectedAmount}, got ${verification.amount}`);
        return res.status(400).send("Amount mismatch");
      }

      // Use transaction to atomically reduce stock and update order
      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection("orders").doc(orderId);
        const orderSnap = await transaction.get(orderRef);

        if (!orderSnap.exists) {
          throw new Error("Order not found");
        }

        const order = orderSnap.data();

        // Reduce stock for each item
        for (const item of order.items) {
          const productRef = db.collection("products").doc(item.productId);
          const productSnap = await transaction.get(productRef);

          if (!productSnap.exists) {
            throw new Error(`Product ${item.productId} not found`);
          }

          const currentStock = productSnap.data().stock || 0;
          if (currentStock < item.quantity) {
            throw new Error(`Insufficient stock for ${item.productName}`);
          }

          transaction.update(productRef, {
            stock: currentStock - item.quantity,
          });
        }

        // Update order status with verified payment info
        transaction.update(orderRef, {
          paymentStatus: "paid",
          orderStatus: "processing",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          paystackVerifiedAmount: verification.amount,
          paystackVerifiedAt: verification.paidAt,
          paystackGatewayResponse: verification.gatewayResponse,
        });

        // Update user subcollection
        transaction.update(
          db.collection("users").doc(order.userId).collection("orders").doc(orderId),
          {
            paymentStatus: "paid",
            orderStatus: "processing",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paystackVerifiedAmount: verification.amount,
            paystackVerifiedAt: verification.paidAt,
          }
        );
      });

      console.log(`Payment verified and processed for order ${orderId}`);
      return res.status(200).send("Webhook processed");
    } catch (error) {
      console.error("Error processing webhook:", error);
      return res.status(500).send("Processing error");
    }
  }

  if (event === "charge.failed") {
    const reference = data.reference;

    // Validate reference format
    if (!reference || !reference.startsWith("PAY-")) {
      console.error("Invalid reference format:", reference);
      return res.status(400).send("Invalid reference format");
    }

    const orderId = reference.replace("PAY-", "");

    try {
      await db.collection("orders").doc(orderId).update({
        paymentStatus: "failed",
        orderStatus: "cancelled",
        paystackFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection("users").doc(data.metadata?.userId).collection("orders").doc(orderId).update({
        paymentStatus: "failed",
        orderStatus: "cancelled",
        paystackFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Payment failed for order ${orderId}`);
      return res.status(200).send("Failure recorded");
    } catch (error) {
      console.error("Error recording failure:", error);
      return res.status(500).send("Processing error");
    }
  }

  return res.status(200).send("Event ignored");
});

// ─── CLOUD FUNCTION: Verify Payment (Callable) ───────────────────────
exports.verifyPayment = functions.https.onCall(async (data, context) => {
  // Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
  }

  const { reference, orderId } = data;

  if (!reference && !orderId) {
    throw new functions.https.HttpsError("invalid-argument", "Reference or orderId is required.");
  }

  let orderRef;
  if (orderId) {
    orderRef = db.collection("orders").doc(orderId);
  } else {
    const q = db.collection("orders").where("paystackReference", "==", reference).limit(1);
    const snap = await q.get();
    if (snap.empty) {
      throw new functions.https.HttpsError("not-found", "Order not found.");
    }
    orderRef = snap.docs[0].ref;
  }

  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Order not found.");
  }

  const orderData = orderSnap.data();

  // Verify authorization
  if (orderData.userId !== context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Access denied.");
  }

  // Already paid
  if (orderData.paymentStatus === "paid") {
    return { success: true, status: "paid", orderData };
  }

  // Verify with Paystack API
  const paystackRef = orderData.paystackReference;
  if (!paystackRef) {
    throw new functions.https.HttpsError("failed-precondition", "No Paystack reference found.");
  }

  const verification = await verifyPaymentWithPaystack(paystackRef);
  if (!verification.valid) {
    return { success: false, status: "unverified", error: "Payment not verified with Paystack" };
  }

  // Confirm with Paystack amount (handle both total and amount fields)
  const orderTotal = orderData.total ?? orderData.amount ?? 0;
  const expectedAmount = Math.round(orderTotal * 100);
  if (verification.amount !== expectedAmount) {
    return { success: false, status: "amount-mismatch", error: "Amount mismatch" };
  }

  // Reduce stock and update order atomically
  await db.runTransaction(async (transaction) => {
    for (const item of orderData.items) {
      const productRef = db.collection("products").doc(item.productId);
      const productSnap = await transaction.get(productRef);
      if (productSnap.exists) {
        const currentStock = productSnap.data().stock || 0;
        if (currentStock < item.quantity) {
          throw new Error(`Insufficient stock for ${item.productName}`);
        }
        transaction.update(productRef, { stock: currentStock - item.quantity });
      }
    }
    transaction.update(orderRef, {
      paymentStatus: "paid",
      orderStatus: "processing",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paystackVerifiedAmount: verification.amount,
      paystackVerifiedAt: verification.paidAt,
    });
    transaction.update(
      db.collection("users").doc(context.auth.uid).collection("orders").doc(orderSnap.id),
      {
        paymentStatus: "paid",
        orderStatus: "processing",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    );
  });

  return { success: true, status: "verified", orderData: { ...orderData, paymentStatus: "paid" } };
});

// ─── CLOUD FUNCTION: Cleanup Stale Pending Orders ──────────────────
exports.cleanupPendingOrders = functions.pubsub.schedule("every 24 hours").onRun(async (context) => {
  const oneDayAgo = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  const staleOrdersSnap = await db
    .collection("orders")
    .where("paymentStatus", "==", "pending")
    .where("createdAt", "<", oneDayAgo)
    .get();

  const batch = db.batch();
  staleOrdersSnap.forEach(doc => {
    batch.update(doc.ref, {
      paymentStatus: "failed",
      orderStatus: "cancelled",
    });
    batch.update(
      db.collection("users").doc(doc.data().userId).collection("orders").doc(doc.id),
      {
        paymentStatus: "failed",
        orderStatus: "cancelled",
      }
    );
  });

  await batch.commit();
  console.log(`Cleaned up ${staleOrdersSnap.size} stale pending orders`);
  return null;
});
