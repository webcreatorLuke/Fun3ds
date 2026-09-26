import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, ADMIN_EMAIL } from "./firebase-config.js";

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signUpWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logOut() {
  return signOut(auth);
}

export function isAdmin(user) {
  return !!user && user.email === ADMIN_EMAIL;
}

// Wires any element with [data-auth="signed-in"] / [data-auth="signed-out"]
// to show/hide based on auth state, and fills [data-user-email] spans.
// Call once per page after DOM is ready.
export function watchAuthUI() {
  onAuthStateChanged(auth, (user) => {
    document.querySelectorAll('[data-auth="signed-in"]').forEach(el => {
      el.style.display = user ? "" : "none";
    });
    document.querySelectorAll('[data-auth="signed-out"]').forEach(el => {
      el.style.display = user ? "none" : "";
    });
    document.querySelectorAll('[data-auth="admin"]').forEach(el => {
      el.style.display = isAdmin(user) ? "" : "none";
    });
    document.querySelectorAll('[data-user-email]').forEach(el => {
      el.textContent = user ? user.email : "";
    });
  });
}

export { onAuthStateChanged, auth };
