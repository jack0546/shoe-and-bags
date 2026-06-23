import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ALL_PRODUCTS } from '@/lib/products';

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

export async function POST(request: NextRequest) {
  try {
    const { 
      userId, 
      email, 
      fullName, 
      phone, 
      address, 
      productId, 
      quantity, 
      selectedSize, 
      selectedColor, 
      paymentReference,
      cartItems 
    } = await request.json();

    if (!email || !fullName) {
      return NextResponse.json(
        { error: 'Missing required fields' }, 
        { status: 400 }
      );
    }

    let orderAmount = 0;
    let productName = '';

    if (cartItems && cartItems.length > 0) {
      orderAmount = cartItems.reduce((acc: number, item: any) => 
        acc + ((item.discountPrice || item.price) * item.quantity), 0
      );
      productName = 'Shopping Bag Order';
    } else if (productId) {
      const product = ALL_PRODUCTS.find((p: any) => p.id === productId);
      if (!product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
      const price = product.discountPrice || product.price;
      orderAmount = price * (quantity || 1);
      productName = product.name;
    }

    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      return NextResponse.json({ error: 'Invalid order amount' }, { status: 400 });
    }

    const orderData = {
      userId: userId || `guest_${Date.now()}`,
      userEmail: email,
      userName: fullName,
      userPhone: phone || '',
      userAddress: address || '',
      productName,
      productId: productId || null,
      amount: orderAmount,
      quantity: quantity || (cartItems?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 1),
      selectedSize: selectedSize || null,
      selectedColor: selectedColor || null,
      status: 'pending',
      paymentReference: paymentReference || '',
      paymentStatus: 'success',
      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'orders'), orderData);

    return NextResponse.json({ success: true, message: 'Order created successfully' });
  } catch (error) {
    console.error('Order creation error:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}