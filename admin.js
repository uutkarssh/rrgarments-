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
  // Get image URL from product — handles both string and array formats
  function getImageUrl(p, index) {
    if (!p || !p.images) return "";
    var idx = index || 0;
    if (Array.isArray(p.images)) return p.images[idx] || p.images[0] || "";
    if (typeof p.images === "string") return p.images;
    return "";
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

    // Wire login form + logout (do this early so they're always ready)
    $("#loginForm").addEventListener("submit", handleLogin);
    $("#adminLogoutBtn").addEventListener("click", function () {
      if (window.RRG_AUTH) window.RRG_AUTH.signOut();
    });

    // Show loading state while Firebase checks auth
    showLoading();

    // Wait for auth state to be determined (survives page refresh)
    if (window.RRG_AUTH) {
      window.RRG_AUTH.init(function (user) {
        if (user) {
          if (isAdmin(user)) {
            showDashboard(user);
          } else {
            showLogin("You need admin access. Sign in with an admin account.");
          }
        } else {
          showLogin();
        }
      });
    } else {
      showLogin();
    }

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

    // Wire image upload (multiple)
    var uploadBtn = $("#uploadImageBtn");
    var fileInput = $("#imageFileInput");
    var addUrlBtn = $("#addImageUrlBtn");
    var addUrlConfirm = $("#addImageUrlConfirm");
    if (uploadBtn) uploadBtn.addEventListener("click", function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener("change", handleMultiImageUpload);
    if (addUrlBtn) addUrlBtn.addEventListener("click", toggleUrlField);
    if (addUrlConfirm) addUrlConfirm.addEventListener("click", addImageUrl);

    // Wire colors textarea to regenerate color image rows
    var colorsTa = $("#pColors");
    if (colorsTa) colorsTa.addEventListener("input", renderColorImageRows);
  }

  /* ---------- Multi-image management ---------- */
  var productImages = []; // array of image URLs
  var colorImages = {}; // { "ColorName": "url", ... }

  function renderGallery() {
    var gallery = $("#imageGallery");
    if (!gallery) return;
    if (productImages.length === 0) {
      gallery.innerHTML = '<div class="gallery-empty">No images yet. Click "UPLOAD IMAGES" to add photos.</div>';
      return;
    }
    gallery.innerHTML = productImages.map(function (url, i) {
      return '<div class="gallery-item">' +
        '<img src="' + esc(url) + '" alt="Image ' + (i + 1) + '" onerror="this.style.opacity=0.3">' +
        '<span class="gallery-num">' + (i + 1) + '</span>' +
        (i === 0 ? '<span class="gallery-main">MAIN</span>' : '') +
        (i > 0 ? '<button class="gallery-move" data-move="' + i + '" title="Move left">←</button>' : '') +
        (i < productImages.length - 1 ? '<button class="gallery-move" data-move-right="' + i + '" title="Move right" style="left:auto;right:4px">→</button>' : '') +
        '<button class="gallery-remove" data-remove="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join("");
    // Wire remove/move buttons
    $all("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-remove"), 10);
        productImages.splice(idx, 1);
        renderGallery();
      });
    });
    $all("[data-move]").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-move"), 10);
        if (idx > 0) {
          var tmp = productImages[idx - 1];
          productImages[idx - 1] = productImages[idx];
          productImages[idx] = tmp;
          renderGallery();
        }
      });
    });
    $all("[data-move-right]").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-move-right"), 10);
        if (idx < productImages.length - 1) {
          var tmp = productImages[idx + 1];
          productImages[idx + 1] = productImages[idx];
          productImages[idx] = tmp;
          renderGallery();
        }
      });
    });
  }

  function handleMultiImageUpload(e) {
    var files = e.target.files;
    if (!files || files.length === 0) return;

    // Check Firebase Storage
    if (typeof firebase === "undefined" || typeof firebase.storage === "undefined") {
      alert("Firebase Storage not loaded. Use 'ADD BY URL' to paste image links instead.");
      return;
    }

    var fileCount = files.length;
    var processed = 0;
    $("#uploadProgress").style.display = "flex";
    $("#uploadProgressText").textContent = "Uploading 0/" + fileCount + "…";
    $("#uploadProgressFill").style.width = "0%";
    $("#uploadImageBtn").disabled = true;

    for (var i = 0; i < fileCount; i++) {
      (function (file, idx) {
        if (!file.type.startsWith("image/")) {
          alert("File " + file.name + " is not an image. Skipping.");
          processed++;
          checkDone();
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          alert("File " + file.name + " is too large (max 5MB). Skipping. Compress at tinypng.com");
          processed++;
          checkDone();
          return;
        }

        var storage = firebase.storage();
        var fileName = "products/" + Date.now() + "-" + idx + "-" + file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        var storageRef = storage.ref(fileName);
        var uploadTask = storageRef.put(file);

        uploadTask.on("state_changed",
          function (snapshot) {
            var progress = Math.round((processed + snapshot.bytesTransferred / snapshot.totalBytes) / fileCount * 100);
            $("#uploadProgressFill").style.width = progress + "%";
            $("#uploadProgressText").textContent = "Uploading " + processed + "/" + fileCount + "…";
          },
          function (error) {
            alert("Upload failed for " + file.name + ": " + error.message);
            processed++;
            checkDone();
          },
          function () {
            uploadTask.snapshot.ref.getDownloadURL().then(function (downloadURL) {
              productImages.push(downloadURL);
              processed++;
              renderGallery();
              checkDone();
            }).catch(function () {
              processed++;
              checkDone();
            });
          }
        );
      })(files[i], i);
    }

    function checkDone() {
      if (processed >= fileCount) {
        $("#uploadImageBtn").disabled = false;
        $("#uploadProgressText").textContent = "Uploaded " + productImages.length + " image(s) ✓";
        $("#uploadProgressFill").style.width = "100%";
        setTimeout(function () { $("#uploadProgress").style.display = "none"; }, 2500);
        // Clear file input so same file can be re-selected
        var fi = $("#imageFileInput");
        if (fi) fi.value = "";
      }
    }
  }

  function toggleUrlField() {
    var field = $("#imageUrlField");
    var btn = $("#addImageUrlBtn");
    if (field.style.display === "none") {
      field.style.display = "block";
      btn.textContent = "HIDE URL FIELD";
    } else {
      field.style.display = "none";
      btn.textContent = "ADD BY URL";
    }
  }

  function addImageUrl() {
    var input = $("#pImageUrl");
    var url = input.value.trim();
    if (!url) { alert("Enter an image URL first"); return; }
    productImages.push(url);
    input.value = "";
    renderGallery();
  }

  /* ---------- Color-specific images ---------- */
  function renderColorImageRows() {
    var colors = parseColors();
    var list = $("#colorImageList");
    if (!list) return;

    if (colors.length === 0) {
      list.innerHTML = '<div class="hint">Add colors above first, then upload color-specific images here.</div>';
      return;
    }

    list.innerHTML = colors.map(function (c) {
      var existing = colorImages[c.name];
      var previewHTML = existing
        ? '<img src="' + esc(existing) + '" alt="' + esc(c.name) + '">'
        : '<div class="no-img">No image</div>';
      return '<div class="color-image-row">' +
        '<div class="color-image-swatch" style="background:' + c.hex + '"></div>' +
        '<div class="color-image-name">' + esc(c.name) + '</div>' +
        '<div class="color-image-preview">' + previewHTML + '</div>' +
        '<input type="file" accept="image/*" data-color="' + esc(c.name) + '">' +
        '<button class="btn btn-outline color-image-btn" data-color-upload="' + esc(c.name) + '">UPLOAD</button>' +
        (existing ? '<button class="btn btn-outline color-image-btn" data-color-remove="' + esc(c.name) + '" style="color:#b23b2e;border-color:#b23b2e">REMOVE</button>' : '') +
      '</div>';
    }).join("");

    // Wire upload buttons
    $all("[data-color-upload]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var colorName = btn.getAttribute("data-color-upload");
        var input = list.querySelector('input[data-color="' + CSSescape(colorName) + '"]');
        if (input) input.click();
      });
    });
    // Wire file inputs
    $all('input[data-color]').forEach(function (input) {
      input.addEventListener("change", function (e) {
        handleColorImageUpload(e, input.getAttribute("data-color"));
      });
    });
    // Wire remove buttons
    $all("[data-color-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var colorName = btn.getAttribute("data-color-remove");
        delete colorImages[colorName];
        renderColorImageRows();
      });
    });
  }

  function CSSescape(s) {
    return s.replace(/"/g, '\\"');
  }

  function handleColorImageUpload(e, colorName) {
    var file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { alert("Image too large (max 5MB). Compress at tinypng.com"); return; }
    if (typeof firebase === "undefined" || typeof firebase.storage === "undefined") {
      alert("Firebase Storage not loaded."); return;
    }

    var storage = firebase.storage();
    var fileName = "products/colors/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    var storageRef = storage.ref(fileName);
    var uploadTask = storageRef.put(file);

    $("#uploadProgress").style.display = "flex";
    $("#uploadProgressText").textContent = "Uploading " + colorName + " image…";
    $("#uploadProgressFill").style.width = "0%";

    uploadTask.on("state_changed",
      function (snapshot) {
        var progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        $("#uploadProgressFill").style.width = progress + "%";
      },
      function (error) {
        $("#uploadProgress").style.display = "none";
        alert("Upload failed: " + error.message);
      },
      function () {
        uploadTask.snapshot.ref.getDownloadURL().then(function (downloadURL) {
          colorImages[colorName] = downloadURL;
          renderColorImageRows();
          $("#uploadProgressText").textContent = "Image for " + colorName + " uploaded ✓";
          $("#uploadProgressFill").style.width = "100%";
          setTimeout(function () { $("#uploadProgress").style.display = "none"; }, 2000);
        }).catch(function (err) {
          $("#uploadProgress").style.display = "none";
          alert("Failed to get URL: " + err.message);
        });
      }
    );
  }

  function parseColors() {
    var text = $("#pColors").value || "";
    return text.split("\n").map(function (line) {
      var parts = line.split(",").map(function (s) { return s.trim(); });
      if (parts.length >= 2) return { name: parts[0], hex: parts[1] };
      return null;
    }).filter(Boolean);
  }

  function isAdmin(user) {
    if (!user) return false;
    if (ADMIN_EMAILS.length === 0) return true; // No restriction — any logged-in user is admin
    return ADMIN_EMAILS.indexOf(user.email) > -1;
  }

  /* ---------- Login ---------- */
  function showLoading() {
    // Hide both login and dashboard, show a loading spinner
    $("#adminLogin").style.display = "none";
    $("#adminDashboard").style.display = "none";
    var loading = $("#adminLoading");
    if (!loading) {
      loading = document.createElement("div");
      loading.id = "adminLoading";
      loading.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:60vh;flex-direction:column;gap:12px";
      loading.innerHTML = '<div style="width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--olive);border-radius:50%;animation:spin 0.8s linear infinite"></div><p style="color:var(--muted);font-size:14px">Checking session…</p>';
      document.querySelector("main").appendChild(loading);
      // Add spin animation if not exists
      if (!document.getElementById("spinKeyframes")) {
        var style = document.createElement("style");
        style.id = "spinKeyframes";
        style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
      }
    }
    loading.style.display = "flex";
  }

  function hideLoading() {
    var loading = $("#adminLoading");
    if (loading) loading.style.display = "none";
  }

  function showLogin(msg) {
    hideLoading();
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
    hideLoading();
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
      var imgUrl = getImageUrl(p);
      return '<tr>' +
        '<td><div class="prod-cell">' +
          '<img src="' + esc(imgUrl) + '" alt="" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2260%22/%3E\'">' +
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
    $("#pSizes").value = p ? (Array.isArray(p.sizes) ? p.sizes.join(", ") : "S, M, L, XL") : "S, M, L, XL";
    $("#pColors").value = p ? (Array.isArray(p.colors) ? p.colors.map(function (c) { return c.name + ", " + c.hex; }).join("\n") : "Off-Black, #1a1a1a\nOff-White, #f5f5f5\nOlive, #6b6f3c") : "Off-Black, #1a1a1a\nOff-White, #f5f5f5\nOlive, #6b6f3c";
    $("#pDesc").value = p ? (p.description || "") : "";
    $("#pFeatured").checked = p ? !!p.featured : false;
    $("#pInStock").checked = p ? p.inStock : true;

    // Reset multi-image gallery
    productImages = [];
    if (p) {
      if (Array.isArray(p.images)) productImages = p.images.slice();
      else if (typeof p.images === "string" && p.images) productImages = [p.images];
    }
    renderGallery();

    // Reset color images
    colorImages = {};
    if (p && p.colorImages) {
      colorImages = JSON.parse(JSON.stringify(p.colorImages));
    }
    renderColorImageRows();

    // Reset URL field (hidden by default)
    $("#imageUrlField").style.display = "none";
    $("#addImageUrlBtn").textContent = "ADD BY URL";
    $("#uploadProgress").style.display = "none";
    $("#uploadImageBtn").disabled = false;
    var fileInput = $("#imageFileInput");
    if (fileInput) fileInput.value = "";
    var urlInput = $("#pImageUrl");
    if (urlInput) urlInput.value = "";

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

    if (!name) { alert("Please enter a product name"); return; }
    if (!price || price < 0) { alert("Please enter a valid price"); return; }
    if (productImages.length === 0) { alert("Please upload at least one product image"); return; }

    var salePriceVal = $("#pSalePrice").value.trim();
    var salePrice = salePriceVal ? parseInt(salePriceVal, 10) : null;

    var sizes = $("#pSizes").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var colors = $("#pColors").value.split("\n").map(function (line) {
      var parts = line.split(",").map(function (s) { return s.trim(); });
      if (parts.length >= 2) return { name: parts[0], hex: parts[1] };
      return null;
    }).filter(Boolean);

    // Clean colorImages: only keep images for colors that still exist
    var cleanedColorImages = {};
    colors.forEach(function (c) {
      if (colorImages[c.name]) cleanedColorImages[c.name] = colorImages[c.name];
    });

    var product = {
      id: $("#productId").value || undefined,
      name: name,
      price: price,
      salePrice: salePrice,
      description: $("#pDesc").value.trim(),
      images: productImages,
      colorImages: cleanedColorImages,
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

    var newCount = allOrders.filter(function (o) { return o.status === "pending" || !o.status || o.status === "new"; }).length;
    $("#tabOrderCount").textContent = newCount;

    if (filtered.length === 0) {
      $("#ordersList").innerHTML = "";
      $("#ordersEmpty").style.display = "block";
      return;
    }
    $("#ordersEmpty").style.display = "none";

    var STATUS_FLOW = [
      { key: "pending", label: "Pending" },
      { key: "confirmed", label: "Confirmed" },
      { key: "packed", label: "Packed" },
      { key: "dispatched", label: "Dispatched" },
      { key: "transit", label: "In Transit" },
      { key: "delivered", label: "Delivered" },
      { key: "cancelled", label: "Cancelled" }
    ];

    $("#ordersList").innerHTML = filtered.map(function (o) {
      var status = o.status || "pending";
      var date = new Date(o.date || o.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      var itemsHTML = (o.items || []).map(function (i) {
        return "<li><span>" + esc(i.name) + " (" + esc(i.size) + ", " + esc(i.color) + ") × " + i.qty + "</span><span>" + money(i.price * i.qty) + "</span></li>";
      }).join("");
      var trackingId = o.trackingId || o.number;

      // Status history
      var historyHTML = "";
      if (o.statusHistory && o.statusHistory.length) {
        historyHTML = '<div class="order-history">' + o.statusHistory.map(function (h) {
          var hd = new Date(h.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          return '<div class="oh-item"><span class="oh-date">' + hd + '</span><span class="oh-label">' + esc(h.label || h.status) + '</span>' + (h.note ? '<span class="oh-note">' + esc(h.note) + '</span>' : '') + '</div>';
        }).join("") + '</div>';
      }

      return '<div class="order-card" data-id="' + esc(o.id || o.number) + '">' +
        '<div class="order-card-head">' +
          '<div><div class="num">' + esc(o.number || o.id) + '</div><div class="date">' + date + '</div><div class="tracking-id">TRACKING: ' + esc(trackingId) + '</div></div>' +
          '<div><span class="stock-badge ' + (status === "pending" ? "stock-in" : status === "cancelled" ? "stock-out" : "") + '" style="text-transform:uppercase">' + esc(status) + '</span></div>' +
        '</div>' +
        '<div class="order-card-body">' +
          '<div><ul class="order-items">' + itemsHTML + '</ul>' +
            '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
              '<div style="display:flex;justify-content:space-between;font-size:13px"><span>Subtotal</span><span>' + money(o.subtotal) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:13px"><span>Shipping</span><span>' + (o.shipping === 0 ? "FREE" : money(o.shipping)) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-top:4px"><span>Total</span><span>' + money(o.total) + '</span></div>' +
            '</div>' +
            historyHTML +
          '</div>' +
          '<div class="order-customer">' +
            '<strong>Customer</strong><br>' + esc(o.name) + '<br>' +
            (o.phone ? '<a href="tel:' + esc(o.phone) + '" style="color:var(--olive)">' + esc(o.phone) + '</a><br>' : '') +
            (o.email ? esc(o.email) + '<br>' : '') + '<br>' +
            '<strong>Ship to</strong><br>' + esc(o.address) + '<br>' + esc(o.city) + ', ' + esc(o.zip) + '<br>' + esc(o.country) +
          '</div>' +
        '</div>' +
        '<div class="order-card-foot">' +
          '<label style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted)">Update Status:</label>' +
          '<select class="status-select status-' + status + '" data-order="' + esc(o.id || o.number) + '">' +
            STATUS_FLOW.map(function (s) {
              return '<option value="' + s.key + '"' + (s.key === status ? " selected" : "") + ">" + s.label + "</option>";
            }).join("") +
          '</select>' +
          '<a href="track.html?id=' + encodeURIComponent(trackingId) + '" target="_blank" class="btn btn-outline" style="padding:6px 12px;font-size:11px">VIEW TRACKING</a>' +
          (window.RRG_DB && window.RRG_DB.isConfigured() ? '<button class="btn btn-outline" style="padding:6px 12px;font-size:11px;color:#b23b2e;border-color:#b23b2e" data-delorder="' + esc(o.id || o.number) + '">DELETE</button>' : '') +
        '</div>' +
      '</div>';
    }).join("");

    // Wire status selects
    $all(".status-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        updateOrderStatusWithHistory(sel.getAttribute("data-order"), sel.value);
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

  /* ---------- Update order status with history ---------- */
  function updateOrderStatusWithHistory(orderId, newStatus) {
    var STATUS_LABELS = {
      pending: "Order Placed", confirmed: "Confirmed", packed: "Packed",
      dispatched: "Dispatched", transit: "In Transit", delivered: "Delivered", cancelled: "Cancelled"
    };
    var order = allOrders.filter(function (o) { return (o.id || o.number) === orderId; })[0];
    if (!order) return;

    var historyEntry = {
      status: newStatus,
      label: STATUS_LABELS[newStatus] || newStatus,
      date: new Date().toISOString(),
      note: ""
    };

    if (window.RRG_DB && window.RRG_DB.isConfigured()) {
      var db = window.RRG_DB.init();
      if (!db) { showToast("Database not ready"); return; }

      // Update status and append to history
      var updates = {
        status: newStatus,
        updatedAt: new Date().toISOString()
      };

      // Get current history and append
      var currentHistory = order.statusHistory || [];
      currentHistory.push(historyEntry);
      updates.statusHistory = JSON.parse(JSON.stringify(currentHistory));

      db.collection("orders").doc(orderId).update(updates)
        .then(function () {
          showToast("Order status updated to " + STATUS_LABELS[newStatus]);
          loadOrders();
        })
        .catch(function (err) {
          showToast("Error updating status: " + err.message);
        });
    } else {
      showToast("Demo mode — status not saved");
    }
  }

  /* ---------- Stats ---------- */
  function updateStats() {
    $("#statProducts").textContent = allProducts.length;
    var newOrders = allOrders.filter(function (o) { return o.status === "pending" || !o.status || o.status === "new"; }).length;
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
