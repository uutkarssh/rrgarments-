/* =====================================================================
   RR GARMENTS — Admin Panel Logic
   Handles: admin login, product CRUD, order management, stats
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- Helpers ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
  }

  var ADMIN_EMAILS = []; // Populated from config; if empty, any logged-in user is admin
  // Add your admin email here to restrict access:
  // var ADMIN_EMAILS = ["owner@rrgarments.com", "admin@rrgarments.com"];

  var allProducts = [];
  var allOrders = [];
  var currentTab = "products";
  var editingId = null;

  /* ---------- Init ---------- */
  function init() {
    // Wait for Firebase to load
    function tryInit(retries) {
      if (typeof firebase !== "undefined" && window.RRG_AUTH) {
        start();
      } else if (retries > 0) {
        setTimeout(function () { tryInit(retries - 1); }, 300);
      } else {
        start(); // Firebase not loaded — show setup banner
      }
    }
    tryInit(8);
  }

  function start() {
    // Check if Firebase is configured
    var configured = window.RRG_DB && window.RRG_DB.isConfigured();
    if (!configured) {
      $("#setupBanner").style.display = "flex";
    }

    // Check auth state
    if (window.RRG_AUTH) {
      var user = window.RRG_AUTH.getUser();
      if (user) {
        if (isAdmin(user)) {
          showDashboard(user);
        } else {
          showLogin("You need admin access. Sign in with an admin account.");
        }
      } else {
        showLogin();
      }
    } else {
      showLogin();
    }

    // Wire login form
    $("#loginForm").addEventListener("submit", handleLogin);
    $("#adminLogoutBtn").addEventListener("click", function () {
      if (window.RRG_AUTH) window.RRG_AUTH.signOut();
    });

    // Wire tabs
    $all(".admin-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab.getAttribute("data-tab"));
      });
    });

    // Wire product modal
    $("#addProductBtn").addEventListener("click", function () { openModal(); });
    $("#modalCloseBtn").addEventListener("click", closeModal);
    $("#modalCancelBtn").addEventListener("click", closeModal);
    $("#modalSaveBtn").addEventListener("click", saveProduct);
    $("#productModal").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });

    // Wire search
    $("#productSearch").addEventListener("input", renderProducts);
    $("#orderSearch").addEventListener("input", renderOrders);
    $("#refreshOrdersBtn").addEventListener("click", loadOrders);

    // Wire seed button
    var seedBtn = $("#seedProductsBtn");
    if (seedBtn) seedBtn.addEventListener("click", seedProducts);

    // Wire image upload
    var uploadBtn = $("#uploadImageBtn");
    var fileInput = $("#imageFileInput");
    var useUrlBtn = $("#useUrlBtn");
    if (uploadBtn) uploadBtn.addEventListener("click", function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener("change", handleImageUpload);
    if (useUrlBtn) useUrlBtn.addEventListener("click", toggleUrlField);
  }

  /* ---------- Image upload (Firebase Storage) ---------- */
  var uploadedImageUrl = null; // stores the Firebase Storage URL after upload

  function handleImageUpload(e) {
    var file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (JPG, PNG, WebP, etc.)");
      return;
    }
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image is too large. Please use an image under 5MB. Tip: compress at tinypng.com");
      return;
    }

    // Check if Firebase Storage is available
    if (typeof firebase === "undefined" || typeof firebase.storage === "undefined") {
      // Fallback: use local object URL (works for preview, but won't persist)
      alert("Firebase Storage not loaded. Using URL mode instead — paste an image URL.");
      toggleUrlField();
      return;
    }

    // Show preview immediately (local)
    var reader = new FileReader();
    reader.onload = function (ev) {
      var preview = $("#imagePreview");
      preview.innerHTML = '<img src="' + ev.target.result + '" alt="Preview">';
      preview.classList.add("has-image");
    };
    reader.readAsDataURL(file);

    // Show progress
    $("#uploadProgress").style.display = "flex";
    $("#uploadProgressText").textContent = "Uploading… 0%";
    $("#uploadProgressFill").style.width = "0%";
    $("#uploadImageBtn").disabled = true;

    // Upload to Firebase Storage
    try {
      var storage = firebase.storage();
      var fileName = "products/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      var storageRef = storage.ref(fileName);
      var uploadTask = storageRef.put(file);

      // Track upload progress
      uploadTask.on("state_changed",
        function (snapshot) {
          var progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          $("#uploadProgressFill").style.width = progress + "%";
          $("#uploadProgressText").textContent = "Uploading… " + progress + "%";
        },
        function (error) {
          // Error
          $("#uploadProgress").style.display = "none";
          $("#uploadImageBtn").disabled = false;
          alert("Upload failed: " + error.message + "\n\nYou can use 'USE URL INSTEAD' to paste an image link.");
        },
        function () {
          // Success — get the download URL
          uploadTask.snapshot.ref.getDownloadURL().then(function (downloadURL) {
            uploadedImageUrl = downloadURL;
            $("#pImage").value = downloadURL;
            $("#uploadProgressText").textContent = "Uploaded ✓";
            $("#uploadProgressFill").style.width = "100%";
            $("#uploadImageBtn").disabled = false;
            setTimeout(function () {
              $("#uploadProgress").style.display = "none";
            }, 2000);
          }).catch(function (err) {
            $("#uploadProgress").style.display = "none";
            $("#uploadImageBtn").disabled = false;
            alert("Got URL failed: " + err.message);
          });
        }
      );
    } catch (err) {
      $("#uploadProgress").style.display = "none";
      $("#uploadImageBtn").disabled = false;
      alert("Storage error: " + err.message + "\n\nUse 'USE URL INSTEAD' to paste an image link.");
    }
  }

  function toggleUrlField() {
    var field = $("#imageUrlField");
    var btn = $("#useUrlBtn");
    if (field.style.display === "none") {
      field.style.display = "block";
      btn.textContent = "HIDE URL FIELD";
    } else {
      field.style.display = "none";
      btn.textContent = "USE URL INSTEAD";
    }
  }

  /* ---------- Seed products (one-click import from products.json) ---------- */
  function seedProducts() {
    if (!window.RRG_DB || !window.RRG_DB.isConfigured()) {
      alert("Firebase is not configured. Follow the setup guide first.");
      return;
    }
    if (!confirm("This will import the 3 starter products into your Firebase database. Continue?")) return;

    var btn = $("#seedProductsBtn");
    btn.disabled = true; btn.textContent = "IMPORTING…";

    // Fetch the starter products from products.json
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/site/data/products.json", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200) {
        btn.disabled = false; btn.textContent = "IMPORT STARTER PRODUCTS";
        alert("Could not load starter products: " + xhr.status);
        return;
      }
      var products = JSON.parse(xhr.responseText);
      var done = 0;
      var errors = 0;

      products.forEach(function (p) {
        window.RRG_DB.saveProduct(p, function (err) {
          done++;
          if (err) errors++;
          if (done === products.length) {
            btn.disabled = false; btn.textContent = "IMPORT STARTER PRODUCTS";
            if (errors > 0) {
              alert("Imported " + (done - errors) + " of " + done + " products. " + errors + " failed.");
            } else {
              alert("Successfully imported " + done + " products! They now appear on your store.");
            }
            loadProducts();
          }
        });
      });
    };
    xhr.send();
  }

  function isAdmin(user) {
    if (!user) return false;
    if (ADMIN_EMAILS.length === 0) return true; // No restriction — any logged-in user is admin
    return ADMIN_EMAILS.indexOf(user.email) > -1;
  }

  /* ---------- Login ---------- */
  function showLogin(msg) {
    $("#adminLogin").style.display = "block";
    $("#adminDashboard").style.display = "none";
    if (msg) {
      var e = $("#loginError");
      e.textContent = msg; e.classList.add("show");
    }
  }

  function handleLogin(e) {
    e.preventDefault();
    var email = $("#lemail").value.trim();
    var pass = $("#lpass").value;
    var errEl = $("#loginError");
    var btn = $("#loginBtn");
    errEl.classList.remove("show");
    btn.disabled = true; btn.textContent = "SIGNING IN…";

    if (window.RRG_AUTH) {
      window.RRG_AUTH.signIn(email, pass, function (err) {
        btn.disabled = false; btn.textContent = "SIGN IN";
        if (err) {
          errEl.textContent = err.message; errEl.classList.add("show");
        } else {
          var user = window.RRG_AUTH.getUser();
          if (isAdmin(user)) {
            showDashboard(user);
          } else {
            errEl.textContent = "This account does not have admin access."; errEl.classList.add("show");
          }
        }
      });
    } else {
      errEl.textContent = "Firebase not loaded. Check your connection."; errEl.classList.add("show");
      btn.disabled = false; btn.textContent = "SIGN IN";
    }
  }

  /* ---------- Dashboard ---------- */
  function showDashboard(user) {
    $("#adminLogin").style.display = "none";
    $("#adminDashboard").style.display = "block";
    $("#welcomeText").textContent = "Signed in as " + user.email;
    loadProducts();
    loadOrders();
  }

  function switchTab(tab) {
    currentTab = tab;
    $all(".admin-tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
    $("#productsTab").style.display = tab === "products" ? "" : "none";
    $("#ordersTab").style.display = tab === "orders" ? "" : "none";
  }

  /* ---------- Products ---------- */
  function loadProducts() {
    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      $("#productsTableBody").innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">Loading…</td></tr>';
      window.RRG_DB.loadProducts(function (err, products) {
        if (err) {
          allProducts = [];
        } else {
          allProducts = products || [];
        }
        renderProducts();
        updateStats();
      });
    } else {
      // Demo mode: load from JSON
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/site/data/products.json", true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
          allProducts = JSON.parse(xhr.responseText);
          renderProducts();
          updateStats();
        }
      };
      xhr.send();
    }
  }

  function renderProducts() {
    var q = ($("#productSearch").value || "").toLowerCase();
    var filtered = allProducts.filter(function (p) {
      return !q || (p.name || "").toLowerCase().indexOf(q) > -1 || (p.category || "").toLowerCase().indexOf(q) > -1;
    });

    $("#tabProductCount").textContent = allProducts.length;

    if (filtered.length === 0) {
      $("#productsTableBody").innerHTML = "";
      $("#productsEmpty").style.display = "block";
      return;
    }
    $("#productsEmpty").style.display = "none";

    $("#productsTableBody").innerHTML = filtered.map(function (p) {
      var onSale = p.salePrice != null && p.salePrice < p.price;
      var price = p.salePrice != null ? p.salePrice : p.price;
      return '<tr>' +
        '<td><div class="prod-cell">' +
          '<img src="' + esc(p.images && p.images[0] || "") + '" alt="" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2260%22/%3E\'">' +
          '<div><div class="name">' + esc(p.name) + '</div><div class="id">ID: ' + esc(p.id) + '</div></div>' +
        '</div></td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + money(price) + (onSale ? '<br><small style="text-decoration:line-through;color:var(--muted)">' + money(p.price) + '</small>' : '') + '</td>' +
        '<td>' + (p.stock || 0) + '</td>' +
        '<td><span class="stock-badge ' + (p.inStock ? "stock-in" : "stock-out") + '">' + (p.inStock ? "IN STOCK" : "SOLD OUT") + '</span></td>' +
        '<td><div class="actions">' +
          '<button class="edit-btn" data-edit="' + esc(p.id) + '">EDIT</button>' +
          '<button class="del-btn" data-del="' + esc(p.id) + '">DELETE</button>' +
        '</div></td>' +
      '</tr>';
    }).join("");

    // Wire edit/delete
    $all("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openModal(b.getAttribute("data-edit")); });
    });
    $all("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () { deleteProduct(b.getAttribute("data-del")); });
    });
  }

  /* ---------- Product modal (add/edit) ---------- */
  function openModal(id) {
    editingId = id || null;
    var p = id ? allProducts.filter(function (x) { return x.id === id; })[0] : null;

    $("#modalTitle").textContent = p ? "EDIT PRODUCT" : "ADD PRODUCT";
    $("#productId").value = p ? p.id : "";
    $("#pName").value = p ? p.name : "";
    $("#pCategory").value = p ? p.category : "Men";
    $("#pStock").value = p ? (p.stock || 0) : 10;
    $("#pPrice").value = p ? p.price : "";
    $("#pSalePrice").value = (p && p.salePrice != null) ? p.salePrice : "";
    $("#pImage").value = p ? (p.images && p.images[0] || "") : "";
    $("#pSizes").value = p ? p.sizes.join(", ") : "S, M, L, XL";
    $("#pColors").value = p ? p.colors.map(function (c) { return c.name + ", " + c.hex; }).join("\n") : "Off-Black, #1a1a1a\nOff-White, #f5f5f5\nOlive, #6b6f3c";
    $("#pDesc").value = p ? (p.description || "") : "";
    $("#pFeatured").checked = p ? !!p.featured : false;
    $("#pInStock").checked = p ? p.inStock : true;

    // Reset image upload UI + show preview if editing existing product
    uploadedImageUrl = null;
    var preview = $("#imagePreview");
    var existingImage = p ? (p.images && p.images[0] || "") : "";
    if (existingImage) {
      preview.innerHTML = '<img src="' + esc(existingImage) + '" alt="Preview" onerror="this.style.display=\'none\'">';
      preview.classList.add("has-image");
    } else {
      preview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 21" stroke-linecap="round" stroke-linejoin="round"/></svg><span>No image selected</span>';
      preview.classList.remove("has-image");
    }
    // Reset URL field (hidden by default)
    $("#imageUrlField").style.display = existingImage ? "block" : "none";
    $("#useUrlBtn").textContent = existingImage ? "HIDE URL FIELD" : "USE URL INSTEAD";
    $("#uploadProgress").style.display = "none";
    $("#uploadImageBtn").disabled = false;
    // Clear file input
    var fileInput = $("#imageFileInput");
    if (fileInput) fileInput.value = "";

    $("#productModal").classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    $("#productModal").classList.remove("open");
    document.body.style.overflow = "";
    editingId = null;
  }

  function saveProduct() {
    var name = $("#pName").value.trim();
    var price = parseInt($("#pPrice").value, 10);
    var image = $("#pImage").value.trim();

    if (!name) { alert("Please enter a product name"); return; }
    if (!price || price < 0) { alert("Please enter a valid price"); return; }
    if (!image) { alert("Please enter an image URL"); return; }

    var salePriceVal = $("#pSalePrice").value.trim();
    var salePrice = salePriceVal ? parseInt(salePriceVal, 10) : null;

    var sizes = $("#pSizes").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var colors = $("#pColors").value.split("\n").map(function (line) {
      var parts = line.split(",").map(function (s) { return s.trim(); });
      if (parts.length >= 2) return { name: parts[0], hex: parts[1] };
      return null;
    }).filter(Boolean);

    var product = {
      id: $("#productId").value || undefined,
      name: name,
      price: price,
      salePrice: salePrice,
      description: $("#pDesc").value.trim(),
      images: [image],
      sizes: sizes.length ? sizes : ["S", "M", "L", "XL"],
      colors: colors.length ? colors : [{ name: "Off-Black", hex: "#1a1a1a" }],
      category: $("#pCategory").value,
      stock: parseInt($("#pStock").value, 10) || 0,
      inStock: $("#pInStock").checked,
      featured: $("#pFeatured").checked,
    };

    var btn = $("#modalSaveBtn");
    btn.disabled = true; btn.textContent = "SAVING…";

    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      window.RRG_DB.saveProduct(product, function (err, saved) {
        btn.disabled = false; btn.textContent = "SAVE PRODUCT";
        if (err) {
          alert("Error saving: " + err.message);
        } else {
          closeModal();
          loadProducts();
          showToast("Product saved successfully!");
        }
      });
    } else {
      // Demo mode: just update local array
      if (editingId) {
        var idx = allProducts.findIndex(function (x) { return x.id === editingId; });
        if (idx > -1) allProducts[idx] = Object.assign(allProducts[idx], product);
      } else {
        product.id = "demo-" + Date.now();
        allProducts.push(product);
      }
      closeModal();
      renderProducts();
      updateStats();
      btn.disabled = false; btn.textContent = "SAVE PRODUCT";
      showToast("Product saved (demo mode — not synced to cloud)");
    }
  }

  function deleteProduct(id) {
    var p = allProducts.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!confirm("Delete \"" + p.name + "\"? This cannot be undone.")) return;

    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      window.RRG_DB.deleteProduct(id, function (err) {
        if (err) { alert("Error deleting: " + err.message); return; }
        loadProducts();
        showToast("Product deleted");
      });
    } else {
      allProducts = allProducts.filter(function (x) { return x.id !== id; });
      renderProducts();
      updateStats();
      showToast("Product deleted (demo mode)");
    }
  }

  /* ---------- Orders ---------- */
  function loadOrders() {
    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      $("#ordersList").innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Loading orders…</div>';
      window.RRG_DB.loadOrders(function (err, orders) {
        if (err) {
          allOrders = [];
          $("#ordersList").innerHTML = '<div class="admin-empty"><p>COULD NOT LOAD ORDERS</p><small>' + esc(err.message) + '</small></div>';
        } else {
          allOrders = orders || [];
          renderOrders();
          updateStats();
        }
      });
    } else {
      // Demo mode: check localStorage for last order
      var lastOrder = null;
      try { lastOrder = JSON.parse(localStorage.getItem("rrg-last-order")); } catch (e) {}
      allOrders = lastOrder ? [lastOrder] : [];
      renderOrders();
      updateStats();
    }
  }

  function renderOrders() {
    var q = ($("#orderSearch").value || "").toLowerCase();
    var filtered = allOrders.filter(function (o) {
      return !q || (o.number || "").toLowerCase().indexOf(q) > -1 || (o.name || "").toLowerCase().indexOf(q) > -1 || (o.email || "").toLowerCase().indexOf(q) > -1;
    });

    var newCount = allOrders.filter(function (o) { return o.status === "new" || !o.status; }).length;
    $("#tabOrderCount").textContent = newCount;

    if (filtered.length === 0) {
      $("#ordersList").innerHTML = "";
      $("#ordersEmpty").style.display = "block";
      return;
    }
    $("#ordersEmpty").style.display = "none";

    $("#ordersList").innerHTML = filtered.map(function (o) {
      var status = o.status || "new";
      var date = new Date(o.date || o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      var itemsHTML = (o.items || []).map(function (i) {
        return "<li><span>" + esc(i.name) + " (" + esc(i.size) + ", " + esc(i.color) + ") × " + i.qty + "</span><span>" + money(i.price * i.qty) + "</span></li>";
      }).join("");
      return '<div class="order-card" data-id="' + esc(o.id || o.number) + '">' +
        '<div class="order-card-head">' +
          '<div><div class="num">' + esc(o.number || o.id) + '</div><div class="date">' + date + '</div></div>' +
          '<div><span class="stock-badge ' + (status === "new" ? "stock-in" : "") + '" style="text-transform:uppercase">' + esc(status) + '</span></div>' +
        '</div>' +
        '<div class="order-card-body">' +
          '<div><ul class="order-items">' + itemsHTML + '</ul>' +
            '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
              '<div style="display:flex;justify-content:space-between;font-size:13px"><span>Subtotal</span><span>' + money(o.subtotal) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:13px"><span>Shipping</span><span>' + (o.shipping === 0 ? "FREE" : money(o.shipping)) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-top:4px"><span>Total</span><span>' + money(o.total) + '</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="order-customer">' +
            '<strong>Customer</strong><br>' + esc(o.name) + '<br>' + esc(o.email) + '<br><br>' +
            '<strong>Ship to</strong><br>' + esc(o.address) + '<br>' + esc(o.city) + ', ' + esc(o.zip) + '<br>' + esc(o.country) +
          '</div>' +
        '</div>' +
        '<div class="order-card-foot">' +
          '<select class="status-select status-' + status + '" data-order="' + esc(o.id || o.number) + '">' +
            ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'].map(function (s) {
              return '<option value="' + s + '"' + (s === status ? " selected" : "") + ">" + s.toUpperCase() + "</option>";
            }).join("") +
          '</select>' +
          (window.RRG_DB && window.RRG_DB.isConfigured() ? '<button class="btn btn-outline" style="padding:6px 12px;font-size:11px" data-delorder="' + esc(o.id || o.number) + '">DELETE</button>' : '') +
        '</div>' +
      '</div>';
    }).join("");

    // Wire status selects
    $all(".status-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        updateOrderStatus(sel.getAttribute("data-order"), sel.value);
      });
    });
    $all("[data-delorder]").forEach(function (b) {
      b.addEventListener("click", function () {
        var oid = b.getAttribute("data-delorder");
        if (!confirm("Delete this order? This cannot be undone.")) return;
        window.RRG_DB.deleteOrder(oid, function () { loadOrders(); showToast("Order deleted"); });
      });
    });
  }

  function updateOrderStatus(id, status) {
    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      window.RRG_DB.updateOrderStatus(id, status, function (err) {
        if (err) { showToast("Error updating status"); return; }
        showToast("Order status updated to " + status);
        loadOrders();
      });
    } else {
      showToast("Demo mode — status not saved");
    }
  }

  /* ---------- Stats ---------- */
  function updateStats() {
    $("#statProducts").textContent = allProducts.length;
    var newOrders = allOrders.filter(function (o) { return o.status === "new" || !o.status; }).length;
    $("#statNewOrders").textContent = newOrders;
    $("#statTotalOrders").textContent = allOrders.length;
    var revenue = allOrders
      .filter(function (o) { return o.status !== "cancelled"; })
      .reduce(function (sum, o) { return sum + (o.total || 0); }, 0);
    $("#statRevenue").textContent = money(revenue);
  }

  /* ---------- Toast (reuse from script.js or make own) ---------- */
  function showToast(msg) {
    var wrap = document.getElementById("toastWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "toastWrap";
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "toast success";
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.opacity = "0"; t.style.transition = "opacity 0.3s";
      setTimeout(function () { t.remove(); }, 300);
    }, 2400);
  }

  /* ---------- Start ---------- */
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
