import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  auth,
  isAdmin,
  logOut,
  watchAuthUI
} from "./auth.js";

watchAuthUI();

document
  .getElementById("signOutBtn")
  .addEventListener("click", () => logOut());


// ============================================================
// CONFIG
// ============================================================

const WORKER_URL =
  "https://fun3ds-flowq-proxy.lukeplaysgamezandmore.workers.dev";


// ============================================================
// WORKER HELPER
// ============================================================

async function callWorker(path, body = {}) {

  const user = auth.currentUser;

  if (!user) {
    throw new Error("You must be signed in.");
  }

  const idToken =
    await user.getIdToken();

  const response =
    await fetch(
      `${WORKER_URL}${path}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },

        body: JSON.stringify(body)
      }
    );

  let data = {};

  try {
    data = await response.json();
  } catch {
    // Ignore JSON parse errors.
  }

  if (!response.ok) {

    throw new Error(
      data.error ||
      `Worker request failed (${response.status})`
    );

  }

  return data;
}


// ============================================================
// AUTH
// ============================================================

onAuthStateChanged(auth, (user) => {

  const authorized =
    isAdmin(user);

  document.getElementById("gate").style.display =
    authorized ? "none" : "block";

  document.getElementById("dashboard").style.display =
    authorized ? "block" : "none";

  if (authorized) {
    initDashboard();
  }

});


// ============================================================
// DASHBOARD INIT
// ============================================================

let initialized = false;

function initDashboard() {

  if (initialized) return;

  initialized = true;


  // ==========================================================
  // TABS
  // ==========================================================

  document
    .querySelectorAll(".tabbar button")
    .forEach((btn) => {

      btn.addEventListener("click", () => {

        document
          .querySelectorAll(".tabbar button")
          .forEach((b) => {
            b.classList.remove("active");
          });

        btn.classList.add("active");


        [
          "orders",
          "requests",
          "products"
        ].forEach((tab) => {

          document.getElementById(
            "tab-" + tab
          ).style.display =
            tab === btn.dataset.tab
              ? ""
              : "none";

        });

      });

    });


  watchOrders();
  watchRequests();
  watchProducts();
  wireProductForm();
  wireAcceptModal();

}


// ============================================================
// ORDERS
// ============================================================

function watchOrders() {

  const q =
    query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    );


  onSnapshot(q, (snap) => {

    const body =
      document.getElementById("ordersBody");


    if (snap.empty) {

      body.innerHTML =
        `<tr><td colspan="7">No orders yet.</td></tr>`;

      return;

    }


    body.innerHTML =
      snap.docs.map((d) => {

        const o = d.data();

        const items =
          (o.items || [])
            .map(
              (i) =>
                `${i.name} × ${i.qty}`
            )
            .join(", ");


        const delivery =
          o.deliveryInfo

            ? `
              ${o.deliveryInfo.name}
              <br/>
              <span style="color:var(--text-dim)">
                ${o.deliveryInfo.address}
              </span>
            `

            : "—";


        const flowqLabel =
          o.flowqSent

            ? `<span class="badge accepted">sent</span>`

            : (
                o.status === "paid"
                  ? `<span class="badge pending">not sent</span>`
                  : "—"
              );


        const sendBtn =
          o.status === "paid" &&
          !o.flowqSent

            ? `
              <button
                class="btn"
                data-send-flowq="${d.id}"
              >
                Send to FlowQ
              </button>
            `

            : "";


        return `
          <tr>

            <td
              style="
                font-family:var(--font-tag);
                font-size:12px;
              "
            >
              ${d.id.slice(0, 8)}
            </td>

            <td>
              ${items}
            </td>

            <td>
              ${o.customerEmail || "—"}
            </td>

            <td>
              ${delivery}
            </td>

            <td>

              <span class="badge ${o.status}">
                ${o.status}
              </span>

            </td>

            <td>
              ${flowqLabel}
            </td>

            <td class="row-actions">
              ${sendBtn}
            </td>

          </tr>
        `;

      }).join("");


    // ========================================================
    // SEND TO FLOWQ
    // ========================================================

    body
      .querySelectorAll("[data-send-flowq]")
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          async () => {

            if (
              !confirm(
                "Send this order to FlowQ?"
              )
            ) {
              return;
            }


            btn.disabled = true;

            btn.textContent =
              "Sending…";


            try {

              const result =
                await callWorker(
                  "/send-order-to-flowq",
                  {
                    orderId:
                      btn.dataset.sendFlowq
                  }
                );


              if (result.skippedAll) {

                btn.textContent =
                  "All printed";

              } else {

                btn.textContent =
                  "Sent";

              }


            } catch (e) {

              btn.disabled = false;

              btn.textContent =
                "Send to FlowQ";


              alert(
                "Couldn't send to FlowQ: " +
                e.message
              );

            }

          }
        );

      });

  });

}


// ============================================================
// CUSTOM REQUESTS
// ============================================================

let pendingAcceptId = null;


function watchRequests() {

  const q =
    query(
      collection(db, "customRequests"),
      orderBy("createdAt", "desc")
    );


  onSnapshot(q, (snap) => {

    const body =
      document.getElementById(
        "requestsBody"
      );


    if (snap.empty) {

      body.innerHTML =
        `<tr><td colspan="5">No requests yet.</td></tr>`;

      return;

    }


    body.innerHTML =
      snap.docs.map((d) => {

        const r = d.data();


        const details =
          r.type === "dog"

            ? `
              <img
                src="${r.photoData}"
                alt=""
                style="
                  width:56px;
                  height:56px;
                  object-fit:cover;
                  border-radius:6px;
                  vertical-align:middle;
                  margin-right:8px;
                "
              >

              "${r.petName}",
              ${r.color}

              ${r.notes
                ? " — " + r.notes
                : ""}
            `

            : `
              <a
                href="${r.makerworldLink}"
                target="_blank"
                rel="noopener noreferrer"
              >
                MakerWorld link
              </a>,

              ${r.color}

              ${r.notes
                ? " — " + r.notes
                : ""}
            `;


        const actions =
          r.status === "pending"

            ? `
              <button
                class="btn btn-primary"
                data-accept="${d.id}"
              >
                Accept
              </button>

              <button
                class="btn btn-danger"
                data-decline="${d.id}"
              >
                Decline
              </button>
            `

            : "";


        return `
          <tr>

            <td>
              ${
                r.type === "dog"
                  ? "Dog print"
                  : "Online print"
              }
            </td>

            <td>
              ${details}
            </td>

            <td>
              ${r.customerEmail || "—"}
            </td>

            <td>

              <span class="badge ${r.status}">
                ${r.status}
              </span>

            </td>

            <td class="row-actions">
              ${actions}
            </td>

          </tr>
        `;

      }).join("");


    // ========================================================
    // ACCEPT
    // ========================================================

    body
      .querySelectorAll("[data-accept]")
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          () => {

            pendingAcceptId =
              btn.dataset.accept;

            document
              .getElementById("acceptModal")
              .style.display =
                "flex";

          }
        );

      });


    // ========================================================
    // DECLINE
    // ========================================================

    body
      .querySelectorAll("[data-decline]")
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          async () => {

            if (
              !confirm(
                "Decline this request?"
              )
            ) {
              return;
            }


            btn.disabled = true;

            btn.textContent =
              "Declining…";


            try {

              await callWorker(
                "/decline-custom-request",
                {
                  requestId:
                    btn.dataset.decline
                }
              );


            } catch (e) {

              btn.disabled = false;

              btn.textContent =
                "Decline";


              alert(
                "Couldn't decline request: " +
                e.message
              );

            }

          }
        );

      });

  });

}


// ============================================================
// ACCEPT CUSTOM REQUEST MODAL
// ============================================================

function wireAcceptModal() {

  const cancelBtn =
    document.getElementById(
      "acceptCancel"
    );

  const confirmBtn =
    document.getElementById(
      "acceptConfirm"
    );


  cancelBtn.addEventListener(
    "click",
    () => {

      document
        .getElementById("acceptModal")
        .style.display =
          "none";

      pendingAcceptId = null;

    }
  );


  confirmBtn.addEventListener(
    "click",
    async () => {

      const status =
        document.getElementById(
          "acceptStatus"
        );


      const price =
        parseFloat(
          document.getElementById(
            "acceptPrice"
          ).value
        );


      const paymentLink =
        document
          .getElementById(
            "acceptPaymentLink"
          )
          .value
          .trim();


      const flowqFileId =
        document
          .getElementById(
            "acceptFlowq"
          )
          .value
          .trim();


      if (!pendingAcceptId) {

        status.textContent =
          "No request selected.";

        return;

      }


      if (
        !price ||
        price <= 0 ||
        !paymentLink
      ) {

        status.textContent =
          "Price and payment link are required.";

        return;

      }


      confirmBtn.disabled = true;

      status.textContent =
        "Saving…";


      try {

        await callWorker(
          "/accept-custom-request",
          {
            requestId:
              pendingAcceptId,

            price,

            paymentLink,

            flowqFileId
          }
        );


        document
          .getElementById(
            "acceptModal"
          )
          .style.display =
            "none";


        document
          .getElementById(
            "acceptPrice"
          )
          .value = "";


        document
          .getElementById(
            "acceptPaymentLink"
          )
          .value = "";


        document
          .getElementById(
            "acceptFlowq"
          )
          .value = "";


        status.textContent =
          "";


        pendingAcceptId =
          null;


      } catch (e) {

        status.textContent =
          "Error: " + e.message;

      } finally {

        confirmBtn.disabled = false;

      }

    }
  );

}


// ============================================================
// PRODUCTS
// ============================================================

function watchProducts() {

  const q =
    query(
      collection(db, "products"),
      orderBy("name")
    );


  onSnapshot(q, (snap) => {

    const body =
      document.getElementById(
        "productsBody"
      );


    if (snap.empty) {

      body.innerHTML =
        `<tr><td colspan="6">No products yet.</td></tr>`;

      return;

    }


    body.innerHTML =
      snap.docs.map((d) => {

        const p = d.data();

        const alreadyPrinted =
          p.alreadyPrinted === true;


        return `
          <tr>

            <td>
              ${p.name}
            </td>


            <td>

              <input
                type="number"
                step="0.01"
                value="${p.price}"
                data-edit="price"
                data-id="${d.id}"

                style="
                  width:80px;
                  background:var(--ink);
                  color:var(--text);
                  border:1px solid var(--line);
                  border-radius:4px;
                  padding:4px;
                "
              />

            </td>


            <td>

              <input
                type="number"
                value="${p.stock}"
                data-edit="stock"
                data-id="${d.id}"

                style="
                  width:64px;
                  background:var(--ink);
                  color:var(--text);
                  border:1px solid var(--line);
                  border-radius:4px;
                  padding:4px;
                "
              />

            </td>


            <td
              style="
                font-family:var(--font-tag);
                font-size:12px;
              "
            >
              ${p.flowqFileId || "—"}
            </td>


            <!-- =================================================
                 ALREADY PRINTED
            ================================================== -->

            <td>

              <label
                style="
                  display:flex;
                  align-items:center;
                  gap:7px;
                  cursor:pointer;
                  white-space:nowrap;
                "
              >

                <input
                  type="checkbox"

                  data-printed-id="${d.id}"

                  ${alreadyPrinted
                    ? "checked"
                    : ""}

                  style="
                    width:18px;
                    height:18px;
                    cursor:pointer;
                  "
                />

                <span>
                  Already printed
                </span>

              </label>

            </td>


            <td class="row-actions">

              <button
                class="btn btn-danger"
                data-delete="${d.id}"
              >
                Delete
              </button>

            </td>

          </tr>
        `;

      }).join("");


    // ========================================================
    // EDIT PRICE / STOCK
    // ========================================================

    body
      .querySelectorAll("[data-edit]")
      .forEach((input) => {

        input.addEventListener(
          "change",
          async () => {

            const field =
              input.dataset.edit;


            const value =
              field === "price"

                ? parseFloat(input.value)

                : parseInt(
                    input.value,
                    10
                  );


            try {

              await updateDoc(
                doc(
                  db,
                  "products",
                  input.dataset.id
                ),
                {
                  [field]: value
                }
              );


            } catch (e) {

              alert(
                "Couldn't update product: " +
                e.message
              );

            }

          }
        );

      });


    // ========================================================
    // ALREADY PRINTED CHECKBOX
    // ========================================================

    body
      .querySelectorAll(
        "[data-printed-id]"
      )
      .forEach((checkbox) => {

        checkbox.addEventListener(
          "change",
          async () => {

            const productId =
              checkbox.dataset.printedId;


            const alreadyPrinted =
              checkbox.checked;


            checkbox.disabled = true;


            try {

              await updateDoc(
                doc(
                  db,
                  "products",
                  productId
                ),
                {
                  alreadyPrinted
                }
              );


            } catch (e) {

              checkbox.checked =
                !alreadyPrinted;


              alert(
                "Couldn't update printed status: " +
                e.message
              );


            } finally {

              checkbox.disabled = false;

            }

          }
        );

      });


    // ========================================================
    // DELETE
    // ========================================================

    body
      .querySelectorAll(
        "[data-delete]"
      )
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          async () => {

            if (
              !confirm(
                "Delete this product?"
              )
            ) {
              return;
            }


            try {

              await deleteDoc(
                doc(
                  db,
                  "products",
                  btn.dataset.delete
                )
              );


            } catch (e) {

              alert(
                "Couldn't delete product: " +
                e.message
              );

            }

          }
        );

      });

  });

}


// ============================================================
// ADD PRODUCT
// ============================================================

function wireProductForm() {

  document
    .getElementById("productForm")
    .addEventListener(
      "submit",
      async (e) => {

        e.preventDefault();


        try {

          await addDoc(
            collection(
              db,
              "products"
            ),
            {

              name:
                document
                  .getElementById(
                    "pName"
                  )
                  .value
                  .trim(),


              price:
                parseFloat(
                  document
                    .getElementById(
                      "pPrice"
                    )
                    .value
                ),


              stock:
                parseInt(
                  document
                    .getElementById(
                      "pStock"
                    )
                    .value,
                  10
                ),


              desc:
                document
                  .getElementById(
                    "pDesc"
                  )
                  .value
                  .trim(),


              imageUrl:
                document
                  .getElementById(
                    "pImage"
                  )
                  .value
                  .trim(),


              flowqFileId:
                document
                  .getElementById(
                    "pFlowq"
                  )
                  .value
                  .trim(),


              // NEW
              alreadyPrinted:
                document
                  .getElementById(
                    "pAlreadyPrinted"
                  )
                  .checked,


              createdAt:
                serverTimestamp()

            }
          );


          e.target.reset();


        } catch (e) {

          alert(
            "Couldn't add product: " +
            e.message
          );

        }

      }
    );

}
