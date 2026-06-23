"use client"

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CreditCard, ShieldCheck, Package, Loader2, ArrowRight } from 'lucide-react';
import { getProductById } from '@/lib/products';
import { useForm, ValidationError } from '@formspree/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { formatCedis } from '@/lib/utils';
import { useCart } from '@/context/CartContext';

declare global {
  interface Window {
    PaystackPop: any;
  }
}

const PAYSTACK_SCRIPT_ID = 'paystack-inline-script';
const PAYSTACK_CURRENCY = 'GHS';

// Note: this is read in the client bundle; ensure it's set in `.env.local`.
const paystackPublicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim() || '';

function getPaystackErrorMessage(error: any) {
  if (typeof error === 'string') return error;
  return error?.message || error?.response?.data?.message || 'Payment failed. Please try again.';
}

function createPaymentReference() {
  return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId');

  const amountParam = searchParams.get('amount');
  const sizeParam = searchParams.get('size');
  const colorParam = searchParams.get('color');
  const quantityParam = searchParams.get('quantity');
  const { user } = useAuth();

   const product = productId ? getProductById(productId) : null;
  const { cart, clearCart } = useCart();
  const hasAmount = amountParam !== null && !isNaN(Number(amountParam));
  const isCartCheckout = !productId && (cart.length > 0 || hasAmount);

  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaystackLoading, setIsPaystackLoading] = useState(true);
  const [paystackLoadError, setPaystackLoadError] = useState<string | null>(null);
  const [isPaystackReady, setIsPaystackReady] = useState(false);


  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [selectedSize, setSelectedSize] = useState(
    sizeParam || product?.sizes?.[0] || ''
  );
  const [selectedColor, setSelectedColor] = useState(
    colorParam || product?.colors?.[0] || ''
  );

  const [quantity, setQuantity] = useState(
    Math.max(1, parseInt(quantityParam || '1', 10) || 1)
  );

  const [state, handleFormSubmit] = useForm("mqewdvrn");
  const [formSubmitMessage, setFormSubmitMessage] = useState<string | null>(null);
  const [finalizedPrice, setFinalizedPrice] = useState<number | null>(null);

  const productPrice = product?.discountPrice || product?.price || (amountParam ? parseFloat(amountParam) : 0);
  const cartTotal = isCartCheckout ? cart.reduce((acc, item) => acc + ((item.discountPrice || item.price) * item.quantity), 0) : 0;
  const clientCalculatedAmount = isCartCheckout ? cartTotal : productPrice * quantity;
  
  useEffect(() => {
    const finalizePrice = async () => {
      if (step !== 'form') return;
      
      if (isCartCheckout) {
        try {
          const response = await fetch('/api/orders/finalize-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart }),
          });
          if (response.ok) {
            const data = await response.json();
            setFinalizedPrice(data.total);
          }
        } catch (error) {
          console.error('Price finalization failed:', error);
        }
      } else if (productId) {
        setFinalizedPrice(productPrice * quantity);
      } else if (amountParam) {
        setFinalizedPrice(parseFloat(amountParam));
      }
    };
    finalizePrice();
  }, [step, productId, amountParam, quantity, cart, isCartCheckout, productPrice]);

  const orderAmount = finalizedPrice ?? clientCalculatedAmount;
  const paystackAmount = Math.round(orderAmount * 100);
  const paymentReferenceRef = useRef(createPaymentReference());
  const paymentReference = paymentReferenceRef.current;
  const productName = product?.name || (isCartCheckout ? 'Shopping Bag Order' : 'Product Order');




  useEffect(() => {
    // Deterministically mark Paystack as ready/failed based on script load.
    if (window.PaystackPop) {
      setIsPaystackLoading(false);
      setPaystackLoadError(null);
      setIsPaystackReady(true);
      return;
    }


    const existingScript = document.getElementById(PAYSTACK_SCRIPT_ID) as HTMLScriptElement | null;

    if (existingScript) {
      if (window.PaystackPop) {
        setIsPaystackLoading(false);
        return;
      }

      existingScript.addEventListener(
        'load',
        () => {
          setIsPaystackLoading(false);
          setPaystackLoadError(null);
          setIsPaystackReady(true);
        },
        { once: true }
      );
      existingScript.addEventListener(
        'error',
        () => {
          setPaystackLoadError('Unable to load Paystack. Check your connection and try again.');
          setIsPaystackLoading(false);
          setIsPaystackReady(false);
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = PAYSTACK_SCRIPT_ID;
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.onload = () => {
      setIsPaystackLoading(false);
      setPaystackLoadError(null);
      setIsPaystackReady(true);
    };
    script.onerror = () => {
      setPaystackLoadError('Unable to load Paystack. Check your connection and try again.');
      setIsPaystackLoading(false);
      setIsPaystackReady(false);
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setPaymentError('Please enter a valid email address')
      return
    }
    if (!fullName || !phone || !address) {
      setPaymentError('Please fill in all required fields.')
      return
    }
    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      setPaymentError('Unable to calculate order total. Please try again.')
      return
    }

    setPaymentError(null)
    setStep('payment')
  }

  const handlePayment = () => {
    if (paystackLoadError) {
      setPaymentError(paystackLoadError);
      return;
    }

    // Deterministic readiness check.
    if (!isPaystackReady || isPaystackLoading) {
      setPaymentError('Paystack is still loading. Please wait a moment and try again.');
      return;
    }


    if (!window.PaystackPop || typeof window.PaystackPop.setup !== 'function') {
      setPaymentError('Paystack failed to initialize. Please refresh and try again.');
      return;
    }

    if (!paystackPublicKey) {
      setPaymentError('Paystack is not configured. Check your public key and restart the app.');
      return;
    }

    if (!Number.isFinite(paystackAmount) || paystackAmount <= 0) {
      setPaymentError('Unable to calculate payment amount. Please try again.');
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);

    try {
      const handler = window.PaystackPop.setup({
        key: paystackPublicKey,
        email: email,
        amount: paystackAmount,
        currency: 'GHS',
        ref: paymentReference,
        metadata: {
          custom_fields: [
            { display_name: 'Product', variable_name: 'product', value: productName },
            { display_name: 'Product ID', variable_name: 'product_id', value: productId || '' },
            { display_name: 'Customer Name', variable_name: 'customer_name', value: fullName },
            { display_name: 'Phone', variable_name: 'phone', value: phone },
            { display_name: 'Payment Reference', variable_name: 'payment_reference', value: paymentReference },
            { display_name: 'Email', variable_name: 'customer_email', value: email },
            { display_name: 'Address', variable_name: 'address', value: address },
            { display_name: 'Quantity', variable_name: 'quantity', value: quantity },
            { display_name: 'Size', variable_name: 'size', value: selectedSize || '' },
            { display_name: 'Color', variable_name: 'color', value: selectedColor || '' },
          ]
        },
        onSuccess: async (transaction: any) => {
          try {
            await submitOrder(transaction);
          } finally {
            setIsProcessing(false);
          }
        },
        onCancel: () => {
          setIsProcessing(false);
          setStep('form');
          setPaymentError('Payment was cancelled. You can try again.');
        },
        onClose: () => {
          if (isProcessing) {
            setIsProcessing(false);
            setPaymentError('Payment window closed. You can try again.');
          }
        },
        onError: (error: any) => {
          setIsProcessing(false);
          setPaymentError(getPaystackErrorMessage(error));
        }
      });

      handler.openIframe();
    } catch (error: any) {
      setIsProcessing(false);
      setPaymentError(getPaystackErrorMessage(error));
    }
  };

  const submitOrder = async (transaction: any) => {
    setPaymentError(null);

    const formData = new FormData();
    formData.append("name", fullName);
    formData.append("email", email);
    formData.append("phone", phone);
    formData.append("address", address);
    formData.append("product", productName);
    formData.append("amount", String(orderAmount));
    formData.append("quantity", String(quantity));
    if (selectedSize) formData.append("size", selectedSize);
    if (selectedColor) formData.append("color", selectedColor);
    formData.append("paymentReference", transaction?.ref || paymentReference);

    try {
      await handleFormSubmit(formData);
    } catch (formError) {
      console.error('Formspree submission failed:', formError);
      setFormSubmitMessage('Order recorded, but notification email failed. We will contact you shortly.');
    }

    setStep('success');
  }

  if (!product && !isCartCheckout) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <Header />
        <main className="flex-grow pt-24 pb-20 flex items-center justify-center">
          <div className="text-center space-y-4">
            <h1 className="font-headline text-3xl font-bold">No Order Found</h1>
            <p className="text-muted-foreground">No product or amount specified for checkout.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <Header />

        <main className="flex-grow pt-24 pb-20 bg-gradient-to-tr from-[#FAF8F5] via-white to-[#F5F8FA]">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="text-center mb-10 space-y-3">
              <div className="inline-flex p-3 bg-emerald-100 text-emerald-600 rounded-full mb-2">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                Order Confirmed!
              </h1>
              <p className="text-muted-foreground text-lg md:text-xl font-light">
                Payment successful and your order has been received.
              </p>
              <div className="w-20 h-1 bg-accent mx-auto mt-4 rounded-full"></div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 md:p-12 text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <Package className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h2 className="font-headline text-2xl font-bold mb-2">Thank You, {fullName}!</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  We've received your order for <strong>{productName}</strong> at <strong>{formatCedis(orderAmount)}</strong>.
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-6 max-w-md mx-auto">
                <p className="text-sm text-muted-foreground mb-2">A confirmation email will be sent to</p>
                <p className="font-semibold text-lg">{email}</p>
              </div>

              {state.succeeded && (
                <div className="max-w-md mx-auto p-4 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Order notification sent to our team.
                </div>
              )}

              {formSubmitMessage && (
                <div className="max-w-md mx-auto p-4 rounded-xl text-sm font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                  {formSubmitMessage}
                </div>
              )}

              <Button
                onClick={() => window.location.href = '/shop'}
                className="mt-4 h-12 px-8 rounded-xl bg-primary text-white hover:bg-primary/95"
              >
                Continue Shopping
              </Button>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  if (step === 'payment') {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <Header />

        <main className="flex-grow pt-24 pb-20 bg-gradient-to-tr from-[#FAF8F5] via-white to-[#F5F8FA]">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="text-center mb-10 space-y-3">
              <div className="inline-flex p-3 bg-primary/10 text-primary rounded-full mb-2">
                <CreditCard className="w-8 h-8" />
              </div>
              <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                Complete Payment
              </h1>
              <p className="text-muted-foreground text-lg md:text-xl font-light">
                Finalize your order with secure payment
              </p>
              <div className="w-20 h-1 bg-accent mx-auto mt-4 rounded-full"></div>
            </div>

            {paymentError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                {paymentError}
              </div>
            )}

            {paystackLoadError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                {paystackLoadError}
              </div>
            )}

            {!paystackLoadError && !isPaystackReady && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm">
                Loading Paystack securely...
              </div>
            )}




            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 md:p-10">
              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Product</span>
                  <span className="font-bold">{productName}</span>
                </div>

                {!productId && isCartCheckout && (
                  <div className="text-xs text-muted-foreground">
                    Order contains {cart.length} item{cart.length !== 1 ? 's' : ''} from your shopping bag.
                  </div>
                )}

                {!productId && !isCartCheckout && (
                  <div className="text-xs text-muted-foreground">
                    Product details were not provided; total is based on cart amount.
                  </div>
                )}

                {!isCartCheckout && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Quantity</span>
                    <span className="font-medium">{quantity}</span>
                  </div>
                )}
                {(selectedSize || selectedColor) && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Options</span>
                    <span className="font-medium">
                      {[selectedSize, selectedColor].filter(Boolean).join(' / ')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{fullName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{email}</span>
                </div>



                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-medium text-right">{phone}</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Address</span>
                  <span className="font-medium text-right">{address}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-2xl">{formatCedis(orderAmount)}</span>
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <Button
                  onClick={handlePayment}
                  disabled={isProcessing || isPaystackLoading}
                  className="w-full h-13 rounded-xl bg-primary text-white hover:bg-primary/95 font-semibold text-base shadow-lg shadow-primary/10 gap-2"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Payment...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Pay with Paystack
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep('form')}
                  className="w-full h-12 rounded-xl"
                >
                  Back to Form
                </Button>
              </div>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4" />
                <span>Secured by Paystack encryption</span>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />

      <main className="flex-grow pt-24 pb-20 bg-gradient-to-tr from-[#FAF8F5] via-white to-[#F5F8FA]">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-center mb-10 space-y-3">
            <div className="inline-flex p-3 bg-primary/10 text-primary rounded-full mb-2">
              <Package className="w-8 h-8" />
            </div>
            <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight text-foreground">
              Checkout
            </h1>
            <p className="text-muted-foreground text-lg md:text-xl font-light">
              Fill in your details to complete your order
            </p>
            <div className="w-20 h-1 bg-accent mx-auto mt-4 rounded-full"></div>
          </div>

          {paymentError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {paymentError}
            </div>
          )}

          <form onSubmit={handleCheckoutSubmit} className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 md:p-10 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-slate-700">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 bg-slate-50 border-slate-200 rounded-xl"
                  required
                />
                <ValidationError prefix="Email" field="email" errors={state.errors} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-sm font-semibold text-slate-700">Full Name *</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-12 bg-slate-50 border-slate-200 rounded-xl"
                  required
                />
                <ValidationError prefix="Name" field="name" errors={state.errors} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-semibold text-slate-700">Phone Number *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+233 24 000 0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 bg-slate-50 border-slate-200 rounded-xl"
                  required
                />
                <ValidationError prefix="Phone" field="phone" errors={state.errors} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-semibold text-slate-700">Delivery Address *</Label>
                <Textarea
                  id="address"
                  placeholder="Enter your full delivery address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="min-h-[100px] bg-slate-50 border-slate-200 rounded-xl"
                  required
                />
                <ValidationError prefix="Address" field="address" errors={state.errors} />
              </div>
            </div>

            <div className="border-t pt-6">
              <div className="flex justify-between items-center mb-6">
                <span className="text-muted-foreground">Product</span>
                <span className="font-bold">{productName}</span>
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold text-2xl">{formatCedis(orderAmount)}</span>
              </div>

              <Button
                type="submit"
                className="w-full h-13 rounded-xl bg-primary text-white hover:bg-primary/95 font-semibold text-base shadow-lg shadow-primary/10 gap-2"
              >
                Proceed to Payment
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
