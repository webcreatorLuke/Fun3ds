import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { watchAuthUI, signInWithGoogle, signInWithEmail, signUpWithEmail, logOut, auth, onAuthStateChanged } from "./auth.js";

// No Firebase Storage (it now requires a billing account regardless of
// usage). Instead, shrink the photo in the browser and store it as a
// base64 data URL directly on the Firestore document — free, no extra
// service, no card on file. A Firestore doc caps out at ~1 MiB, so we
// resize + compress down to well under that.
function compressImageToDataURL(file, maxDimension = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

watchAuthUI();
document.getElementById("signOutBtn").addEventListener("click", () => logOut());

const loginModal = document.getElementById("loginModal");
document.getElementById("openLogin").addEventListener("click", () => loginModal.style.display = "flex");
document.getElementById("closeLogin").addEventListener("click", () => loginModal.style.display = "none");
document.getElementById("googleSignIn").addEventListener("click", async () => {
  try { await signInWithGoogle(); loginModal.style.display = "none"; } catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});
document.getElementById("emailSignIn").addEventListener("click", async () => {
  try { await signInWithEmail(document.getElementById("loginEmail").value, document.getElementById("loginPassword").value); loginModal.style.display = "none"; }
  catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});
document.getElementById("emailSignUp").addEventListener("click", async () => {
  try { await signUpWithEmail(document.getElementById("loginEmail").value, document.getElementById("loginPassword").value); loginModal.style.display = "none"; }
  catch (e) { document.getElementById("loginStatus").textContent = e.message; }
});

// ---------- Mode toggle ----------
const modeOnline = document.getElementById("modeOnline");
const modeDog = document.getElementById("modeDog");
const onlineForm = document.getElementById("onlineForm");
const dogForm = document.getElementById("dogForm");

modeOnline.addEventListener("click", () => {
  modeOnline.classList.add("active"); modeDog.classList.remove("active");
  onlineForm.style.display = ""; dogForm.style.display = "none";
});
modeDog.addEventListener("click", () => {
  modeDog.classList.add("active"); modeOnline.classList.remove("active");
  dogForm.style.display = ""; onlineForm.style.display = "none";
});

// swatches
document.querySelectorAll(".swatch").forEach(sw => {
  sw.addEventListener("click", () => {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
    sw.classList.add("selected");
    document.getElementById("dogColor").value = sw.dataset.color;
  });
});

const status = document.getElementById("formStatus");

function requireSignIn() {
  if (!auth.currentUser) { loginModal.style.display = "flex"; return false; }
  return true;
}

onlineForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireSignIn()) return;
  status.textContent = "Sending…";
  try {
    await addDoc(collection(db, "customRequests"), {
      uid: auth.currentUser.uid,
      customerEmail: auth.currentUser.email,
      type: "online",
      makerworldLink: document.getElementById("mwLink").value.trim(),
      color: document.getElementById("mwColor").value,
      notes: document.getElementById("mwNotes").value.trim(),
      status: "pending",
      createdAt: serverTimestamp()
    });
    status.textContent = "Request sent! I'll get back to you with a price.";
    onlineForm.reset();
  } catch (e) { status.textContent = "Couldn't send: " + e.message; }
});

dogForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireSignIn()) return;
  const file = document.getElementById("dogPhoto").files[0];
  if (!file) { status.textContent = "Choose a photo first."; return; }
  status.textContent = "Compressing photo…";
  try {
    const photoData = await compressImageToDataURL(file);
    if (photoData.length > 900000) {
      status.textContent = "That photo is still too large even compressed — try a smaller/simpler image.";
      return;
    }

    status.textContent = "Sending request…";
    await addDoc(collection(db, "customRequests"), {
      uid: auth.currentUser.uid,
      customerEmail: auth.currentUser.email,
      type: "dog",
      photoData,
      petName: document.getElementById("dogName").value.trim(),
      color: document.getElementById("dogColor").value,
      notes: document.getElementById("dogNotes").value.trim(),
      status: "pending",
      createdAt: serverTimestamp()
    });
    status.textContent = "Request sent! I'll get back to you with a price.";
    dogForm.reset();
  } catch (e) { status.textContent = "Couldn't send: " + e.message; }
});

// ---------- Customer's own request list ----------
const myRequests = document.getElementById("myRequests");
onAuthStateChanged(auth, (user) => {
  if (!user) { myRequests.innerHTML = `<p style="color:var(--text-dim); font-size:14px;">Sign in to see your requests.</p>`; return; }
  const q = query(collection(db, "customRequests"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) { myRequests.innerHTML = `<p style="color:var(--text-dim); font-size:14px;">No requests yet.</p>`; return; }
    myRequests.innerHTML = snap.docs.map(d => {
      const r = d.data();
      const title = r.type === "dog" ? `${r.petName}'s print` : "Online print";
      const thumb = r.type === "dog" && r.photoData
        ? `<img src="${r.photoData}" alt="" style="width:44px; height:44px; object-fit:cover; border-radius:6px; margin-right:10px; vertical-align:middle;">` : "";
      return `<div class="panel" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center;">
          ${thumb}
          <div>
            <strong>${title}</strong><br/>
            <span style="font-size:13px; color:var(--text-dim);">${r.notes || ""}</span>
          </div>
        </div>
        <div style="text-align:right;">
          <span class="badge ${r.status}">${r.status}</span>
          ${r.status === "accepted" && r.paymentLink ? `<div style="margin-top:6px;"><a class="btn btn-primary" href="${r.paymentLink}" target="_blank">Pay $${(r.price||0).toFixed(2)}</a></div>` : ""}
        </div>
      </div>`;
    }).join("");
  });
});
