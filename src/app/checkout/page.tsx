"use client"

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CreditCard, ShieldCheck, Package, Loader2, ArrowRight } from 'lucide-react';
import { getProductById } from '@/lib/products';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

declare global {
  interface Window {
    PaystackPop: any;
  }
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId');
  const amountParam = searchParams.get('amount');
  
  const product = productId ? getProductById(productId) : null;
  
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const price = product?.discountPrice || product?.price || (amountParam ? parseFloat(amountParam) : 0);
  const productName = product?.name || 'Product Order';

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    document.body.appendChild(script);
    
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !email.includes('@')) {
      setPaymentError('Please enter a valid email address')
      return
    }
    if (!fullName || !phone || !address) {
      setPaymentError('Please fill in all required fields.')
      return
    }
    
    setPaymentError(null)
    setStep('payment')
  }

  const handlePayment = () => {
    if (!window.PaystackPop) {
      setPaymentError('Paystack failed to load. Please refresh and try again.');
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);

    const handler = window.PaystackPop.setup({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
      email: email,
      amount: Math.round(price * 100),
      currency: 'GHS',
      ref: 'PAY-' + Date.now(),
      metadata: {
        custom_fields: [
          { display_name: 'Product', variable_name: 'product', value: productName },
          { display_name: 'Customer Name', variable_name: 'customer_name', value: fullName },
          { display_name: 'Phone', variable_name: 'phone', value: phone }
        ]
      },
      onSuccess: async (transaction: any) => {
        setIsProcessing(false);
        await submitOrder(transaction);
      },
      onCancel: () => {
        setIsProcessing(false);
        setStep('form');
        setPaymentError('Payment was cancelled');
      },
      onError: (error: any) => {
        setIsProcessing(false);
        setStep('form');
        setPaymentError(error.message || 'Payment failed. Please try again.');
      }
    });

    handler.openIframe();
  };

  const submitOrder = async (transaction: any) => {
    setIsSubmittingOrder(true)
    setPaymentError(null)

    try {
      const orderData = {
        userId: 'guest_' + Date.now(),
        userEmail: email,
        userName: fullName,
        userPhone: phone,
        userAddress: address,
        productName: productName,
        amount: price,
        status: 'pending',
        paymentReference: transaction?.ref || 'PAY-' + Date.now(),
        paymentStatus: 'success',
        createdAt: serverTimestamp(),
        notes: notes || null
      }

      await addDoc(collection(db, 'orders'), orderData)
      setStep('success')
    } catch (error: any) {
      setPaymentError(error.message || 'Payment succeeded but failed to save order. Please contact support.')
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  if (!product && !amountParam) {
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
                  We've received your order for <strong>{productName}</strong> at <strong>${price.toFixed(2)}</strong>.
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-6 max-w-md mx-auto">
                <p className="text-sm text-muted-foreground mb-2">A confirmation email will be sent to</p>
                <p className="font-semibold text-lg">{email}</p>
              </div>
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

            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 md:p-10">
              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Product</span>
                  <span className="font-bold">{productName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{fullName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-2xl">${price.toFixed(2)}</span>
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <Button
                  onClick={handlePayment}
                  disabled={isProcessing}
                  className="w-full h-13 rounded-xl bg-primary text-white hover:bg-primary/95 font-semibold text-base shadow-lg shadow-primary/10 gap-2"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Payment...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Pay $${price.toFixed(2)} with Paystack
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

          <form onSubmit={handleFormSubmit} className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 md:p-10 space-y-6">
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-sm font-semibold text-slate-700">Additional Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Any special instructions or preferences..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[80px] bg-slate-50 border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <div className="flex justify-between items-center mb-6">
                <span className="text-muted-foreground">Product</span>
                <span className="font-bold">{productName}</span>
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold text-2xl">${price.toFixed(2)}</span>
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
