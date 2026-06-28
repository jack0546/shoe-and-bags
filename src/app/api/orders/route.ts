import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { ALL_PRODUCTS, getProductByName } from '@/lib/products';

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

async function requireAdmin(uid: string): Promise<boolean> {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  return userDoc.exists && userDoc.data()?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    const authResult = await verifyIdToken(token);
    if (!authResult.success) {
      return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
    }
    
    const { 
      email, 
      fullName, 
      phone, 
      address,
      region,
      productName: productNameParam,
      productId: productIdParam,
      quantity, 
      selectedSize, 
      selectedColor, 
      paymentReference,
      cartItems 
    } = await request.json();

    const uid = authResult.uid!;
    
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
    } else if (productNameParam) {
      const product = getProductByName(productNameParam);
      if (!product && productIdParam) {
        const productById = ALL_PRODUCTS.find((p: any) => p.id === productIdParam);
        if (productById) {
          const price = productById.discountPrice || productById.price;
          orderAmount = price * (quantity || 1);
          productName = productById.name;
        }
      } else if (product) {
        const price = product.discountPrice || product.price;
        orderAmount = price * (quantity || 1);
        productName = product.name;
      }
    } else if (productIdParam) {
      const product = ALL_PRODUCTS.find((p: any) => p.id === productIdParam);
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
      userId: uid,
      userEmail: email,
      userName: fullName,
      userPhone: phone || '',
      userAddress: address || '',
      userRegion: region || '',
      productName,
      productId: productIdParam || null,
      amount: orderAmount,
      quantity: quantity || (cartItems?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 1),
      selectedSize: selectedSize || null,
      selectedColor: selectedColor || null,
      status: 'pending',
      paymentReference: paymentReference || '',
      paymentStatus: 'success',
      createdAt: new Date().toISOString(),
      cartItems: cartItems || null,
    };

    const orderDoc = await adminDb.collection('orders').add(orderData);

    await adminDb.collection('users').doc(uid).set({
      orders: FieldValue.arrayUnion(orderDoc.id),
    }, { merge: true });

    await adminDb.collection('users').doc(uid).collection('orders').doc(orderDoc.id).set({
      ...orderData,
      id: orderDoc.id,
    });

    return NextResponse.json({ success: true, message: 'Order created successfully' });
  } catch (error) {
    console.error('Order creation error:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    const authResult = await verifyIdToken(token);
    if (!authResult.success || !authResult.uid) {
      return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
    }

    const userDoc = await adminDb.collection('users').doc(authResult.uid).get();
    const isAdmin = userDoc.exists && userDoc.data()?.role === 'admin';

    let orders;
    if (isAdmin) {
      const snapshot = await adminDb.collection('orders')
        .where('deleted', '!=', true)
        .orderBy('createdAt', 'desc')
        .get();
      orders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      const snapshot = await adminDb.collection('users')
        .doc(authResult.uid)
        .collection('orders')
        .orderBy('createdAt', 'desc')
        .get();
      orders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    return NextResponse.json({ success: true, orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    const authResult = await verifyIdToken(token);
    if (!authResult.success || !authResult.uid) {
      return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
    }

    const isAdmin = await requireAdmin(authResult.uid);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    await adminDb.collection('orders').doc(orderId).update({
      deleted: true,
      deletedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    const authResult = await verifyIdToken(token);
    if (!authResult.success || !authResult.uid) {
      return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
    }

    const isAdmin = await requireAdmin(authResult.uid);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    const body = await request.json();
    const { status, trackingNumber, carrier, estimatedDelivery, notes } = body;

    const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered'];
    if (status && !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (carrier !== undefined) updateData.carrier = carrier;
    if (estimatedDelivery !== undefined) updateData.estimatedDelivery = estimatedDelivery;
    if (notes !== undefined) updateData.notes = notes;

    if (status === 'shipped') {
      updateData.shippedAt = new Date().toISOString();
    }
    if (status === 'delivered') {
      updateData.deliveredAt = new Date().toISOString();
    }

    const orderSnap = await adminDb.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const existingHistory = orderSnap.data()?.statusHistory || [];
    if (status) {
      updateData.statusHistory = [
        ...existingHistory,
        {
          status,
          timestamp: new Date().toISOString(),
          note: notes || undefined,
        },
      ];
    }

    await adminDb.collection('orders').doc(orderId).update(updateData);

    return NextResponse.json({ success: true, message: 'Order updated successfully' });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}