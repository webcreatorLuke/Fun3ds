// Fill these in from Firebase Console → Project settings → Your apps → SDK setup and config.
// This file is safe to be public — these are client identifiers, not secrets.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTkFpKwKniIr3acI9Z8DhDZtKi7z4YNic",
  authDomain: "fun3ds-41428.firebaseapp.com",
  projectId: "fun3ds-41428",
  storageBucket: "fun3ds-41428.firebasestorage.app",
  messagingSenderId: "28838365870",
  appId: "1:28838365870:web:7d09091c18bc6001737b3f"
};

// The only account that can see /admin.html. Also enforced server-side in
// firestore.rules and in functions/index.js — never trust this line alone.
export const ADMIN_EMAIL = "lukeplaysgamezandmore@gmail.com";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
