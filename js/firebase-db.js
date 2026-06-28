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

  // Save a product (add or update). If no id, generates one.
  function saveProduct(product, cb) {
    if (!isConfigured()) return cb(new Error("Firebase not configured"));
    init();
    if (!db) return cb(new Error("Firestore not available"));

    if (!product.id) {
      product.id = db.collection("products").doc().id;
    }
    product.updatedAt = new Date().toISOString();

    // Serialize to plain JSON to avoid cross-realm Object issues
    var cleanData = JSON.parse(JSON.stringify(product));

    db.collection("products").doc(product.id).set(cleanData)
      .then(function () { cb(null, product); })
      .catch(function (err) { cb(err); });
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
    updateOrderStatus: updateOrderStatus,
    deleteOrder: deleteOrder,
  };
})();
