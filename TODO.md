# TODO - Paystack checkout reliability

- [ ] Update `src/app/checkout/page.tsx` to make Paystack script loading/ready state deterministic when entering checkout from Cart.
- [ ] Harden checkout UI/data when `productId` is missing (cart passes only `amount`).
- [ ] Keep Paystack setup + iframe open triggered only when user clicks “Pay with Paystack”.
- [ ] Run typecheck/lint to ensure no TS/React issues.

