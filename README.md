# shoe-and-bags

A NextJS e-commerce website for shoes and bags with Paystack payment integration.

## Setup

1. Copy `.env.example` to `.env.local` and configure your Paystack keys:
   ```
   NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_live_your_public_key
   PAYSTACK_SECRET_KEY=sk_live_your_secret_key
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run development server:
   ```
   npm run dev
   ```