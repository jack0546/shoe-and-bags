import { NextRequest, NextResponse } from 'next/server';
import { adminDb, runAdminTransaction } from '@/lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_URL = 'https://api.paystack.co';

function verifyPaystackSignature(body: string, signature: string | null): boolean {
  if (!signature || !PAYSTACK_SECRET_KEY) return false;
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(body)
    .digest('hex');
  return signature === expectedSignature;
}

async function verifyPaymentWithPaystack(reference: string): Promise<{ valid: boolean; amount?: number; paidAt?: string; gatewayResponse?: string }> {
  if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY not configured');
    return { valid: false };
  }

  try {
    const response = await fetch(`${PAYSTACK_API_URL}/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Paystack verification failed: ${response.status}`);
      return { valid: false };
    }

    const data = await response.json();
    if (data?.status && data?.data?.status === 'success') {
      return { valid: true, amount: data.data.amount, paidAt: data.data.paid_at, gatewayResponse: data.data.gateway_response };
    }
    return { valid: false };
  } catch (error) {
    console.error('Paystack verification error:', error);
    return { valid: false };
  }
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-paystack-signature');
  const body = await request.text();

  if (!verifyPaystackSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const event = payload.event;

  if (event !== 'charge.success' && event !== 'charge.failed') {
    return NextResponse.json({ received: true });
  }

  const data = payload.data;
  const { reference } = data;

  if (event === 'charge.failed') {
    if (!reference || !reference.startsWith('PAY-')) {
      return NextResponse.json({ received: true });
    }
    try {
      const orderId = reference.replace('PAY-', '');
      await adminDb.collection('orders').doc(orderId).update({
        paymentStatus: 'failed',
        orderStatus: 'cancelled',
        paystackFailedAt: Timestamp.now(),
      });
      await adminDb.collection('users').doc(data.metadata?.userId).collection('orders').doc(orderId).update({
        paymentStatus: 'failed',
        orderStatus: 'cancelled',
        paystackFailedAt: Timestamp.now(),
      });
      return NextResponse.json({ received: true });
    } catch (error) {
      console.error('Error recording failure:', error);
      return NextResponse.json({ received: true });
    }
  }

  // charge.success handling
  if (!reference || !reference.startsWith('PAY-')) {
    return NextResponse.json({ error: 'Invalid reference format' }, { status: 400 });
  }
  const orderId = reference.replace('PAY-', '');

  const verification = await verifyPaymentWithPaystack(reference);
  if (!verification.valid) {
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 });
  }

  try {
    // Try orderId lookup (PAY-{orderId} format)
    const orderRef = adminDb.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderData = orderSnap.data();

    if (orderData?.paymentStatus === 'paid') {
      return NextResponse.json({ received: true, message: 'Already processed' });
    }

    const orderTotal = orderData?.total ?? orderData?.amount ?? 0;
    const expectedAmount = Math.round(orderTotal * 100);
    if (verification.amount !== expectedAmount) {
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    }

    await runAdminTransaction(async (transaction) => {
      const orderRef = adminDb.collection('orders').doc(orderId);
      const orderSnapTx = await transaction.get(orderRef);

      if (!orderSnapTx.exists) {
        throw new Error('Order not found');
      }

      const order = orderSnapTx.data()!;

      for (const item of (order.items || [])) {
        const productRef = adminDb.collection('products').doc(item.productId);
        const productSnap = await transaction.get(productRef);

        if (productSnap.exists) {
          const currentStock = productSnap.data()?.stock || 0;
          if (currentStock < item.quantity) {
            throw new Error(`Insufficient stock for ${item.productName}`);
          }
          transaction.update(productRef, { stock: currentStock - item.quantity });
        }
      }

      transaction.update(orderRef, {
        paymentStatus: 'paid',
        orderStatus: 'processing',
        paidAt: Timestamp.now(),
        paystackVerifiedAmount: verification.amount,
        paystackVerifiedAt: verification.paidAt,
        paystackGatewayResponse: verification.gatewayResponse,
      });

      transaction.update(
        adminDb.collection('users').doc(order.userId).collection('orders').doc(orderId),
        {
          paymentStatus: 'paid',
          orderStatus: 'processing',
          paidAt: Timestamp.now(),
        }
      );
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return NextResponse.json({ error: 'Processing error', details: error?.message || 'Unknown error' }, { status: 500 });
  }
}