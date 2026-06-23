import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';

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

async function verifyPaymentWithPaystack(reference: string): Promise<{ valid: boolean; amount?: number; data?: any }> {
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
      return { valid: true, amount: data.data.amount, data: data.data };
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

  if (event !== 'charge.success') {
    return NextResponse.json({ received: true });
  }

  const data = payload.data;
  const { reference } = data;

  const verification = await verifyPaymentWithPaystack(reference);
  if (!verification.valid) {
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 });
  }

  try {
    const existingOrderQuery = query(
      collection(db, 'orders'), 
      where('paymentReference', '==', reference)
    );
    const existingOrders = await getDocs(existingOrderQuery);

    if (!existingOrders.empty) {
      return NextResponse.json({ received: true, message: 'Order already exists' });
    }

    const verifiedAmount = verification.amount ? verification.amount / 100 : 0;
    const verifiedData = verification.data || data;

    const orderData = {
      userId: verifiedData?.customer?.email ? `guest_${Date.now()}` : 'guest',
      userEmail: verifiedData?.customer?.email || '',
      userName: verifiedData?.customer?.name || '',
      userPhone: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'phone')?.value || '',
      userAddress: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'address')?.value || '',
      productName: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'product')?.value || '',
      productId: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'product_id')?.value || null,
      amount: verifiedAmount,
      quantity: parseInt(verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'quantity')?.value) || 1,
      selectedSize: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'size')?.value || null,
      selectedColor: verifiedData?.metadata?.custom_fields?.find((f: any) => f.variable_name === 'color')?.value || null,
      status: 'pending',
      paymentReference: reference,
      paymentStatus: 'success',
      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'orders'), orderData);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error saving order:', error);
    return NextResponse.json({ error: 'Failed to save order' }, { status: 500 });
  }
}