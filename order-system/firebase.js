import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  collection,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// ─── INITIALIZE ──────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// ─── AUTH HELPERS ────────────────────────────────────────────────────
const signIn = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

const signInWithGoogle = () => {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

const logOut = () => signOut(auth);

const resetPassword = (email) => sendPasswordResetEmail(auth, email);

const getCurrentUser = () => auth.currentUser;

// ─── FIRESTORE HELPERS ───────────────────────────────────────────────
const usersCollection = collection(db, "users");
const ordersCollection = collection(db, "orders");

const getUserOrdersCollection = (uid) => collection(db, `users/${uid}/orders`);

const createOrderDoc = (orderData) =>
  addDoc(ordersCollection, orderData);

const createUserOrderDoc = async (uid, orderId, orderData) => {
  await setDoc(doc(db, `users/${uid}/orders/${orderId}`), orderData);
};

const getOrderDoc = (orderId) => getDoc(doc(db, `orders/${orderId}`));

const getUserOrderDoc = (uid, orderId) =>
  getDoc(doc(db, `users/${uid}/orders/${orderId}`));

const getAllOrders = () => getDocs(ordersCollection);

const getUserOrders = async (uid) => {
  const q = query(
    getUserOrdersCollection(uid),
    orderBy("createdAt", "desc")
  );
  return getDocs(q);
};

const updateOrderStatus = async (orderId, status) => {
  const ref = doc(db, `orders/${orderId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found");
  const uid = snap.data().userId;
  const batch = writeBatch(db);
  batch.update(ref, { orderStatus: status });
  batch.update(
    doc(db, `users/${uid}/orders/${orderId}`),
    { orderStatus: status }
  );
  await batch.commit();
};

const updatePaymentStatus = async (orderId, status) => {
  const ref = doc(db, `orders/${orderId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found");
  const uid = snap.data().userId;
  const batch = writeBatch(db);
  batch.update(ref, { paymentStatus: status });
  batch.update(
    doc(db, `users/${uid}/orders/${orderId}`),
    { paymentStatus: status }
  );
  await batch.commit();
};

const updateOrder = async (orderId, data, uid) => {
  const batch = writeBatch(db);
  batch.update(doc(db, `orders/${orderId}`), data);
  batch.update(doc(db, `users/${uid}/orders/${orderId}`), data);
  await batch.commit();
};

const deleteOrder = async (orderId, uid) => {
  const batch = writeBatch(db);
  batch.delete(doc(db, `orders/${orderId}`));
  batch.delete(doc(db, `users/${uid}/orders/${orderId}`));
  await batch.commit();
};

const reduceProductStock = async (productId, quantity) => {
  const productRef = doc(db, "products", productId);
  await updateDoc(productRef, {
    stock: increment(-quantity),
  });
};

const restoreProductStock = async (productId, quantity) => {
  const productRef = doc(db, "products", productId);
  await updateDoc(productRef, {
    stock: increment(quantity),
  });
};

// ─── CLOUD FUNCTIONS HELPERS ────────────────────────────────────────
const initializePayment = httpsCallable(functions, "initializePayment");
const verifyPayment = httpsCallable(functions, "verifyPayment");

export {
  app,
  auth,
  db,
  storage,
  functions,
  signIn,
  signInWithGoogle,
  logOut,
  resetPassword,
  getCurrentUser,
  onAuthStateChanged,
  serverTimestamp,
  usersCollection,
  ordersCollection,
  createOrderDoc,
  createUserOrderDoc,
  getOrderDoc,
  getUserOrderDoc,
  getAllOrders,
  getUserOrders,
  getUserOrdersCollection,
  updateOrderStatus,
  updatePaymentStatus,
  updateOrder,
  deleteOrder,
  reduceProductStock,
  restoreProductStock,
  runTransaction,
  initializePayment,
  verifyPayment,
};
