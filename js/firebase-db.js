/* =====================================================================
   RR GARMENTS — Firebase Firestore Data Layer
   Handles: products (read/write), orders (create/read/update)
   Falls back to products.json if Firebase isn't configured yet.
   ===================================================================== */
(function () {
  "use strict";

  var db = null;
  var initialized = false;

  function init() {
    // Only skip if we already have a working db connection
    if (db) return db;
    if (typeof firebase === "undefined") return null;
    if (typeof firebase.firestore === "undefined") return null; // Firestore SDK not loaded yet
    try {
      // Check if the Firebase app has been initialized by firebase-auth.js
      var app;
      try { app = firebase.app(); } catch (e) { return null; } // app not initialized yet
      db = firebase.firestore();
      initialized = true;
    } catch (e) {
      db = null;
    }
    return db;
  }

  function isConfigured() {
    if (typeof firebase === "undefined") return false;
    if (typeof firebase.firestore === "undefined") return false; // Firestore SDK not loaded yet
    try {
      // Check if the app has been initialized with real config (by firebase-auth.js)
      var app = firebase.app();
      return !!app && !!app.options && app.options.apiKey &&
        app.options.apiKey.indexOf("DemoKey") === -1;
    } catch (e) {
      return false; // app not initialized yet
    }
  }

  /* ---------- Products ---------- */

  // Load products: tries Firestore first, falls back to products.json
  function loadProducts(cb) {
    if (!isConfigured()) {
      // Fallback: load from static JSON file
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/site/data/products.json", true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200) {
          try { cb(null, JSON.parse(xhr.responseText)); }
          catch (e) { cb(e); }
        } else { cb(new Error("Failed to load products (" + xhr.status + ")")); }
      };
      xhr.send();
      return;
    }

    init();
    if (!db) return cb(new Error("Firestore not available"));

    db.collection("products").get()
      .then(function (snapshot) {
        var products = [];
        if (snapshot && snapshot.forEach) {
          snapshot.forEach(function (doc) {
            var data = doc.data();
            if (data) products.push(data);
          });
        }
        // Sort by featured first, then name
        products.sort(function (a, b) {
          if (!!b.featured !== !!a.featured) return !!b.featured - !!a.featured;
          return (a.name || "").localeCompare(b.name || "");
        });
        cb(null, products);
      })
      .catch(function (err) { cb(err); });
  }

  // Generate a clean URL-friendly ID from product name
  // e.g., "Tommy Hilfiger T-Shirt" → "tommy-hilfiger-t-shirt"
  function generateSlug(name) {
    if (!name) return "product-" + Date.now();
    var slug = name.toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")     // remove special chars
      .replace(/\s+/g, "-")              // spaces to hyphens
      .replace(/-+/g, "-")               // multiple hyphens to one
      .replace(/^-|-$/g, "");            // remove leading/trailing hyphens
    // If slug is empty (e.g., name was only special chars), use fallback
    if (!slug) slug = "product-" + Date.now();
    return slug;
  }

  // Check if a product ID already exists (to avoid duplicates)
  function productIdExists(id, cb) {
    init();
    if (!db) return cb(null, false);
    db.collection("products").doc(id).get()
      .then(function (doc) { cb(null, doc.exists); })
      .catch(function () { cb(null, false); });
  }

  // Save a product (add or update). If no id, generates a clean slug from name.
  function saveProduct(product, cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    // Ensure images is always an array
    if (typeof product.images === "string") {
      product.images = [product.images];
    } else if (!Array.isArray(product.images)) {
      product.images = product.images ? [product.images] : [];
    }

    // Generate clean ID from product name if no ID provided
    if (!product.id) {
      var baseSlug = generateSlug(product.name);
      product.id = baseSlug;
      // Check if slug already exists — if so, append a number
      productIdExists(baseSlug, function (exists) {
        if (exists) {
          var counter = 2;
          function tryUnique() {
            var tryId = baseSlug + "-" + counter;
            productIdExists(tryId, function (ex) {
              if (ex) { counter++; tryUnique(); }
              else {
                product.id = tryId;
                doSave();
              }
            });
          }
          tryUnique();
        } else {
          doSave();
        }
      });
    } else {
      doSave();
    }

    function doSave() {
      product.updatedAt = new Date().toISOString();
      // Serialize to plain JSON to avoid cross-realm Object issues
      var cleanData = JSON.parse(JSON.stringify(product));
      db.collection("products").doc(product.id).set(cleanData)
        .then(function () { cb(null, product); })
        .catch(function (err) { cb(err); });
    }
  }

  // Delete a product
  function deleteProduct(id, cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    db.collection("products").doc(id).delete()
      .then(function () { cb(null); })
      .catch(function (err) { cb(err); });
  }

  /* ---------- Orders ---------- */

  // Create a new order
  function createOrder(order, cb) {
    if (!isConfigured()) {
      // Fallback: just save to localStorage (preview mode)
      try {
        localStorage.setItem("rrg-last-order", JSON.stringify(order));
        cb(null, order);
      } catch (e) { cb(e); }
      return;
    }

    init();
    if (!db) return cb(new Error("Firestore not available"));

    if (!order.id) {
      order.id = db.collection("orders").doc().id;
    }
    order.createdAt = new Date().toISOString();
    order.status = order.status || "new"; // new, confirmed, shipped, delivered, cancelled

    // Serialize to plain JSON to avoid cross-realm Object issues
    var cleanData = JSON.parse(JSON.stringify(order));

    db.collection("orders").doc(order.id).set(cleanData)
      .then(function () { cb(null, order); })
      .catch(function (err) { cb(err); });
  }

  // Load all orders (admin only)
  function loadOrders(cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    db.collection("orders").orderBy("createdAt", "desc").get()
      .then(function (snapshot) {
        var orders = [];
        if (snapshot && snapshot.forEach) {
          snapshot.forEach(function (doc) {
            var data = doc.data();
            if (data) orders.push(data);
          });
        }
        cb(null, orders);
      })
      .catch(function (err) { cb(err); });
  }

  // Load orders belonging to a specific signed-in user (for "My Orders")
  function loadOrdersByUser(uid, cb) {
    if (!uid) return cb(new Error("No user id provided"));
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    // NOTE: not using .orderBy() here so this works without needing a
    // composite Firestore index. We sort client-side instead.
    db.collection("orders").where("uid", "==", uid).get()
      .then(function (snapshot) {
        var orders = [];
        if (snapshot && snapshot.forEach) {
          snapshot.forEach(function (doc) {
            var data = doc.data();
            if (data) orders.push(data);
          });
        }
        orders.sort(function (a, b) {
          return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        cb(null, orders);
      })
      .catch(function (err) { cb(err); });
  }

  // Update order status
  function updateOrderStatus(id, status, cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    db.collection("orders").doc(id).update({ status: status, updatedAt: new Date().toISOString() })
      .then(function () { cb(null); })
      .catch(function (err) { cb(err); });
  }

  // Delete an order
  function deleteOrder(id, cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    db.collection("orders").doc(id).delete()
      .then(function () { cb(null); })
      .catch(function (err) { cb(err); });
  }

  /* ---------- Expose ---------- */
  window.RRG_DB = {
    init: init,
    isConfigured: isConfigured,
    loadProducts: loadProducts,
    saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    createOrder: createOrder,
    loadOrders: loadOrders,
    loadOrdersByUser: loadOrdersByUser,
    updateOrderStatus: updateOrderStatus,
    deleteOrder: deleteOrder,
  };
})();
