# Order Management System

A complete Firebase-powered order management system for e-commerce built with vanilla HTML, CSS, and JavaScript (ES6 Modules).

## Features

### Customer
- Browse products and add to cart
- Secure checkout with authentication
- Real-time order history
- Order tracking and status updates
- Receipt download/print
- Reorder functionality
- WhatsApp order summary

### Admin
- Real-time order dashboard
- Search and filter orders
- Update order/payment status
- Edit delivery information
- Export orders to CSV
- Dashboard statistics (total orders, sales, pending, delivered)

### Security
- Firestore security rules
- Owner-only access for customer orders
- Admin-only access for management features

## Setup

### 1. Firebase Project
1. Create a Firebase project at https://console.firebase.google.com
2. Enable Authentication (Email/Password)
3. Enable Firestore Database
4. Enable Storage (optional)

### 2. Configure Firebase
Update `firebase.js` with your Firebase config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### 3. Deploy Firestore Rules
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### 4. Create Admin User
1. Register a user via the app
2. In Firestore, create a `users` collection
3. Add a document with the user's UID as the document ID
4. Set `role` field to `admin`

Or manually in code:
```javascript
import { setDoc, doc } from "./firebase.js";
await setDoc(doc(db, "users", "ADMIN_UID"), {
  email: "admin@example.com",
  role: "admin",
});
```

### 5. Create Products Collection
Add products to the `products` collection in Firestore:
```javascript
{
  productId: "prod-1",
  productName: "Product Name",
  price: 15000,
  image: "https://...",
  stock: 50,
  description: "...",
  category: "..."
}
```

### 6. Run Locally
Serve the `order-system` folder with any static server:
```bash
# Using Python
python -m http.server 8000 --directory order-system

# Using Node.js
npx serve order-system

# Using VS Code Live Server
# Right-click index.html -> Open with Live Server
```

### 6. Configure Paystack (Cloud Functions)
Set the Paystack secret key in Firebase Functions config:
```bash
firebase functions:config:set paystack.secret_key="sk_live_xxx"
```

For local development, create `order-system/functions/.runtimeconfig.json`:
```json
{
  "paystack": {
    "secret_key": "sk_test_xxx"
  }
}
```

### 7. Deploy Cloud Functions
```bash
cd order-system
firebase deploy --only functions
```

## File Structure

```
order-system/
├── firebase.js          # Firebase v12+ initialization and exports
├── styles.css           # Global styles, responsive design
├── cart.js              # Shopping cart logic
├── orders.js            # Shared order utilities
├── login.js             # Authentication page logic
├── index.js             # Home page logic
├── products.js          # Products page logic
├── checkout.js          # Checkout and order placement
├── order-history.js     # Customer order history (realtime)
├── order-details.js     # Order details, receipt, reorder
├── admin-orders.js      # Admin dashboard, stats, CSV export
├── firestore.rules      # Firestore security rules
├── index.html           # Home page
├── login.html           # Login page
├── products.html        # Products listing
├── cart.html            # Shopping cart
├── checkout.html        # Checkout page
├── orders.html          # Customer order history
├── order-details.html   # Order details page
└── admin.html           # Admin dashboard
```

## Key Implementation Notes

### Order Creation
Orders are saved to BOTH:
- `orders/{orderId}` (global collection)
- `users/{uid}/orders/{orderId}` (user subcollection)

### Stock Management
- Stock reduces automatically when order is placed (paymentMethod: paystack)
- Stock restores when order is cancelled

### Real-time Updates
- Customer order history uses `onSnapshot` for real-time updates
- Admin dashboard uses `onSnapshot` for real-time order monitoring

### Security
- Customers can only read their own orders
- Admin role is checked via Firestore `users/{uid}` document
- All updates use batched writes to keep collections synchronized

## Browser Support
Modern browsers with ES6 module support:
- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 79+

## License
MIT
