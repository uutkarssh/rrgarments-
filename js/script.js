/* =====================================================================
   RR GARMENTS — Vanilla JavaScript
   Handles: product loading, rendering, cart (localStorage), filters,
   search, sort, pagination, cart drawer, product detail, checkout,
   order confirmation. Shared across all pages.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- Constants & helpers ---------- */
  var DATA_URL = "/site/data/products.json";
  var CART_KEY = "rrg-cart";
  var ORDER_KEY = "rrg-last-order";
  var PER_PAGE = 6;
  var PRICE_MAX = 3000;
  var INSTAGRAM_URL = "https://www.instagram.com/rr_clothing_0?igsh=ZzVncGZneWhhMXZo";
  var BRAND = "RR GARMENTS";

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function money(n) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency", currency: "INR",
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(n);
  }
  function effPrice(p) { return p.salePrice != null ? p.salePrice : p.price; }

  /* Get image URL from a product — handles string, array, and color-specific images.
     If a color is specified and that color has its own image, use it. */
  function getImage(p, index, color) {
    if (!p) return "";
    // If a color is specified and has its own image, return it
    if (color && p.colorImages && p.colorImages[color]) {
      return p.colorImages[color];
    }
    // Otherwise use the images array
    if (!p.images) return "";
    var idx = index || 0;
    if (Array.isArray(p.images)) return p.images[idx] || p.images[0] || "";
    if (typeof p.images === "string") return p.images;
    return "";
  }

  /* Get all images for the gallery (general images + color-specific images) */
  function getAllImages(p) {
    if (!p) return [];
    var result = [];
    if (Array.isArray(p.images)) result = p.images.slice();
    else if (typeof p.images === "string" && p.images) result = [p.images];
    // Add color-specific images that aren't already in the list
    if (p.colorImages) {
      Object.keys(p.colorImages).forEach(function (color) {
        var url = p.colorImages[color];
        if (url && result.indexOf(url) === -1) result.push(url);
      });
    }
    return result;
  }

  /* Get the image to show when a specific color is selected */
  function getImageForColor(p, color) {
    if (!p || !color) return getImage(p);
    if (p.colorImages && p.colorImages[color]) return p.colorImages[color];
    return getImage(p);
  }

  function cartKey(id, size, color) { return id + "__" + size + "__" + color; }
  function qs(name) {
    var m = new URLSearchParams(window.location.search).get(name);
    return m;
  }

  /* ---------- Product loading (Firestore or fallback to JSON) ---------- */
  var _products = null;
  function loadProducts(cb) {
    if (_products) return cb(null, _products);
    // Use Firestore data layer if available (waits for Firebase SDKs to load)
    function tryDB(retries) {
      // Check: RRG_DB exists, is configured, AND db is actually initialized
      if (window.RRG_DB && window.RRG_DB.isConfigured() && typeof firebase !== "undefined" && typeof firebase.firestore === "function") {
        // Ensure db is initialized
        var db = window.RRG_DB.init();
        if (!db) {
          // db not ready yet — retry
          if (retries > 0) { setTimeout(function () { tryDB(retries - 1); }, 400); return; }
          loadFromJSON(cb); return;
        }
        window.RRG_DB.loadProducts(function (err, products) {
          if (err || !products) {
            // Firestore error or empty — fall back to JSON
            loadFromJSON(cb);
          } else {
            _products = products;
            cb(null, products);
          }
        });
      } else if (retries > 0) {
        // Wait for Firebase SDK chain to load (app → auth → firestore → storage)
        setTimeout(function () { tryDB(retries - 1); }, 400);
      } else {
        // Firebase SDKs didn't load in time — use static JSON
        loadFromJSON(cb);
      }
    }
    tryDB(15); // wait up to ~6s for Firebase SDKs to load from CDN
  }

  function loadFromJSON(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", DATA_URL, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try { _products = JSON.parse(xhr.responseText); cb(null, _products); }
        catch (e) { cb(e); }
      } else { cb(new Error("Failed to load products (" + xhr.status + ")")); }
    };
    xhr.send();
  }

  /* ---------- Cart (localStorage) ---------- */
  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCart(items) { localStorage.setItem(CART_KEY, JSON.stringify(items)); updateCartBadge(); }
  function cartCount(items) { return (items || getCart()).reduce(function (n, i) { return n + i.qty; }, 0); }
  function cartSubtotal(items) { return (items || getCart()).reduce(function (n, i) { return n + i.qty * i.price; }, 0); }
  function addToCart(product, size, color, qty) {
    qty = qty || 1;
    var items = getCart();
    var key = cartKey(product.id, size, color);
    var existing = items.filter(function (i) { return i.key === key; })[0];
    if (existing) { existing.qty += qty; }
    else {
      items.push({
        key: key, productId: product.id, name: product.name,
        price: effPrice(product), image: getImageForColor(product, color),
        size: size, color: color, qty: qty
      });
    }
    saveCart(items);
    openCart();
  }
  function removeItem(key) { saveCart(getCart().filter(function (i) { return i.key !== key; })); renderCart(); }
  function setQty(key, qty) {
    var items = getCart().map(function (i) { return i.key === key ? Object.assign({}, i, { qty: Math.max(1, qty) }) : i; });
    saveCart(items); renderCart();
  }

  /* ---------- Cart badge + drawer ---------- */
  function updateCartBadge() {
    var n = cartCount();
    $all(".cart-badge").forEach(function (el) {
      el.textContent = n;
      el.style.display = n > 0 ? "" : "none";
    });
  }
  function openCart() { var o = $("#cartOverlay"), d = $("#cartDrawer"); if (!o || !d) return; o.classList.add("open"); d.classList.add("open"); document.body.style.overflow = "hidden"; renderCart(); }
  function closeCart() { var o = $("#cartOverlay"), d = $("#cartDrawer"); if (!o || !d) return; o.classList.remove("open"); d.classList.remove("open"); document.body.style.overflow = ""; }

  function renderCart() {
    var items = getCart();
    var body = $("#cartBody");
    var foot = $("#cartFoot");
    if (!body || !foot) return;
    if (items.length === 0) {
      body.innerHTML = '<div class="cart-empty"><p>YOUR BAG IS EMPTY</p><small>Add a few essentials to get started.</small><a href="products.html" class="btn btn-outline" style="margin-top:8px">CONTINUE SHOPPING</a></div>';
      foot.style.display = "none";
      return;
    }
    body.innerHTML = items.map(function (i) {
      return '<div class="cart-item">' +
        '<img src="' + i.image + '" alt="' + esc(i.name) + '">' +
        '<div class="meta">' +
          '<div class="top-row"><h3>' + esc(i.name) + '</h3><button class="remove" data-key="' + i.key + '">REMOVE</button></div>' +
          '<div class="variant">' + esc(i.color) + ' · SIZE ' + esc(i.size) + '</div>' +
          '<div class="bottom-row">' +
            '<div class="qty-stepper">' +
              '<button data-act="dec" data-key="' + i.key + '" aria-label="Decrease quantity">−</button>' +
              '<span class="q">' + i.qty + '</span>' +
              '<button data-act="inc" data-key="' + i.key + '" aria-label="Increase quantity">+</button>' +
            '</div>' +
            '<span class="line-total">' + money(i.price * i.qty) + '</span>' +
          '</div>' +
        '</div></div>';
    }).join("");
    foot.style.display = "";
    var sub = cartSubtotal(items);
    $("#cartSubtotal").textContent = money(sub);
    $("#cartCheckoutBtn").textContent = "CHECKOUT · " + money(sub);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    var wrap = $("#toastWrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "toastWrap"; wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
    var t = document.createElement("div");
    t.className = "toast" + (type ? " " + type : "");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(function () { t.remove(); }, 300); }, 2400);
  }

  /* ---------- Shared header/footer/cart injection ---------- */
  function injectShell() {
    // Cart drawer + overlay (appended once)
    if (!$("#cartDrawer")) {
      var ov = document.createElement("div"); ov.id = "cartOverlay"; ov.className = "cart-overlay";
      var dr = document.createElement("aside"); dr.id = "cartDrawer"; dr.className = "cart-drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-label", "Shopping cart");
      dr.innerHTML =
        '<div class="cart-head"><h2>YOUR BAG <span id="cartCountLabel">(0)</span></h2><button class="icon-btn" id="cartCloseBtn" aria-label="Close cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>' +
        '<div class="cart-body" id="cartBody"></div>' +
        '<div class="cart-foot" id="cartFoot" style="display:none">' +
          '<div class="row"><span>Subtotal</span><b id="cartSubtotal">$0</b></div>' +
          '<div class="note">Shipping & taxes calculated at checkout.</div>' +
          '<a href="checkout.html" class="btn btn-primary btn-block" id="cartCheckoutBtn">CHECKOUT</a>' +
          '<button class="continue" id="cartContinueBtn">CONTINUE SHOPPING</button>' +
        '</div>';
      document.body.appendChild(ov); document.body.appendChild(dr);
      ov.addEventListener("click", closeCart);
      $("#cartCloseBtn").addEventListener("click", closeCart);
      $("#cartContinueBtn").addEventListener("click", closeCart);
      // delegate qty/remove
      dr.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-key]");
        if (!btn) return;
        var key = btn.getAttribute("data-key");
        if (btn.getAttribute("data-act") === "inc") setQty(key, getCart().filter(function (i) { return i.key === key; })[0].qty + 1);
        else if (btn.getAttribute("data-act") === "dec") setQty(key, getCart().filter(function (i) { return i.key === key; })[0].qty - 1);
        else if (btn.classList.contains("remove")) removeItem(key);
      });
    }
    // header cart button
    $all("[data-cart-open]").forEach(function (b) { b.addEventListener("click", openCart); });
    updateCartBadge(); renderCart();
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCart(); });
    // Inject auth UI + Firebase
    injectAuth();
  }

  /* ---------- Auth (Firebase) injection ---------- */
  function injectAuth() {
    var headerIcons = document.querySelector(".header-icons");
    if (!headerIcons || document.querySelector(".auth-injected")) return;

    // Insert login button + user menu before the cart button
    var authHTML =
      '<a class="icon-btn header-login-btn" href="account.html" aria-label="Login / Account" style="display:none">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke-linecap="round"/><circle cx="12" cy="7" r="4"/></svg>' +
      '</a>' +
      '<div class="user-menu header-user-menu" style="display:none">' +
        '<button class="user-btn" id="userBtn">' +
          '<span class="avatar">?</span><span class="label-text">ACCOUNT</span>' +
        '</button>' +
        '<div class="user-dropdown" id="userDropdown">' +
          '<div class="head"><p class="label">Signed in as</p><p class="email">—</p></div>' +
          '<a href="account.html">My Account</a>' +
          '<button class="logout" id="logoutBtn">SIGN OUT</button>' +
        '</div>' +
      '</div>';
    var cartBtn = headerIcons.querySelector("[data-cart-open]");
    if (cartBtn) cartBtn.insertAdjacentHTML("beforebegin", authHTML);
    headerIcons.classList.add("auth-injected");

    // Toggle dropdown
    var userBtn = document.getElementById("userBtn");
    var dropdown = document.getElementById("userDropdown");
    if (userBtn && dropdown) {
      userBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dropdown.classList.toggle("open");
      });
      document.addEventListener("click", function () { dropdown.classList.remove("open"); });
    }
    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        if (window.RRG_AUTH) window.RRG_AUTH.signOut();
      });
    }

    // Load Firebase SDKs (app → auth → firestore), then init
    if (typeof firebase === "undefined" && !document.querySelector("#firebase-sdk")) {
      var s = document.createElement("script");
      s.id = "firebase-sdk";
      s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js";
      s.onload = function () {
        var s2 = document.createElement("script");
        s2.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js";
        s2.onload = function () {
          // Load Firestore SDK after auth
          var s3 = document.createElement("script");
          s3.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js";
          s3.onload = function () {
            // Load Storage SDK after Firestore
            var s4 = document.createElement("script");
            s4.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js";
            s4.onload = function () {
              if (window.RRG_AUTH) window.RRG_AUTH.init();
              if (window.RRG_DB) window.RRG_DB.init();
            };
            document.head.appendChild(s4);
          };
          document.head.appendChild(s3);
        };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    } else {
      if (window.RRG_AUTH) window.RRG_AUTH.init();
      if (window.RRG_DB) window.RRG_DB.init();
    }
  }

  /* ---------- Product card HTML ---------- */
  function productCardHTML(p) {
    var onSale = p.salePrice != null && p.salePrice < p.price;
    var price = effPrice(p);
    var priceHTML = onSale
      ? '<span class="old">' + money(p.price) + '</span><span class="sale">' + money(price) + '</span>'
      : '<span>' + money(price) + '</span>';
    var badges = "";
    if (onSale) badges += '<span class="badge badge-sale">SALE</span>';
    if (!p.inStock) badges += '<span class="badge badge-oos">SOLD OUT</span>';
    return '<a class="product-card" href="product.html?id=' + encodeURIComponent(p.id) + '">' +
      '<div class="img-wrap">' +
        '<img class="' + (p.inStock ? "" : "oos") + '" src="' + getImage(p) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.style.opacity=\'0.3\'">' +
        badges +
      '</div>' +
      '<div class="info">' +
        '<div class="top-row"><h3>' + esc(p.name) + '</h3><div class="price">' + priceHTML + '</div></div>' +
        '<div class="cat">' + esc(p.category) + '</div>' +
      '</div></a>';
  }

  /* =====================================================================
     PAGE: HOME
     ===================================================================== */
  function initHome() {
    injectShell();
    loadProducts(function (err, products) {
      var grid = $("#featuredGrid");
      if (err || !grid) return;
      var featured = products.filter(function (p) { return p.featured; }).slice(0, 4);
      if (featured.length < 4) featured = products.slice(0, 4);
      grid.innerHTML = featured.map(productCardHTML).join("");
    });
  }

  /* =====================================================================
     PAGE: SHOP
     ===================================================================== */
  function initShop() {
    injectShell();
    loadProducts(function (err, products) {
      if (err) return;

      // facets
      var sizes = {}, colors = {}, cats = {}, min = Infinity, max = 0;
      products.forEach(function (p) {
        p.sizes.forEach(function (s) { sizes[s] = true; });
        p.colors.forEach(function (c) { colors[c.name] = c.hex; });
        cats[p.category] = true;
        var pr = effPrice(p);
        if (pr < min) min = pr;
        if (pr > max) max = pr;
      });
      var sizeList = Object.keys(sizes);
      var colorList = Object.keys(colors).map(function (n) { return { name: n, hex: colors[n] }; });
      var catList = Object.keys(cats);

      // state
      var state = {
        sizes: [], colors: [], categories: [],
        price: [0, PRICE_MAX], availability: "all", search: "",
        sort: "featured", page: 1
      };
      // init from URL
      var cat = qs("category");
      if (cat) state.categories = [cat];
      var search = qs("search");
      if (search !== null) state.search = search;

      function renderFilters(container) {
        // categories
        container.querySelector("[data-facet=categories]").innerHTML = catList.map(function (c) {
          return '<label><input type="checkbox" value="' + c + '" ' + (state.categories.indexOf(c) > -1 ? "checked" : "") + '>' + c + '</label>';
        }).join("");
        // sizes
        container.querySelector("[data-facet=sizes]").innerHTML = sizeList.map(function (s) {
          return '<button class="size-chip' + (state.sizes.indexOf(s) > -1 ? " active" : "") + '" data-size="' + s + '">' + s + '</button>';
        }).join("");
        // colors
        container.querySelector("[data-facet=colors]").innerHTML = colorList.map(function (c) {
          var light = c.hex.toLowerCase() === "#f5f5f5";
          return '<button class="color-chip' + (light ? " light" : "") + (state.colors.indexOf(c.name) > -1 ? " active" : "") + '" data-color="' + esc(c.name) + '" title="' + esc(c.name) + '" style="background:' + c.hex + '"></button>';
        }).join("");
        // price
        container.querySelector("[data-facet=priceMin]").textContent = "₹" + state.price[0].toLocaleString('en-IN');
        container.querySelector("[data-facet=priceMax]").textContent = "₹" + state.price[1].toLocaleString('en-IN') + (state.price[1] === PRICE_MAX ? "+" : "");
        var lo = container.querySelector("[data-facet=priceLo]"), hi = container.querySelector("[data-facet=priceHi]");
        if (lo) lo.value = state.price[0];
        if (hi) hi.value = state.price[1];
        // availability
        container.querySelectorAll("[data-avail] input").forEach(function (r) { r.checked = r.value === state.availability; });
        // search
        var s = container.querySelector("[data-facet=search]"); if (s) s.value = state.search;
      }

      function applyAndRender() {
        var filtered = products.filter(function (p) {
          var q = state.search.trim().toLowerCase();
          if (q && p.name.toLowerCase().indexOf(q) === -1 && p.category.toLowerCase().indexOf(q) === -1) return false;
          if (state.categories.length && state.categories.indexOf(p.category) === -1) return false;
          if (state.sizes.length && !p.sizes.some(function (s) { return state.sizes.indexOf(s) > -1; })) return false;
          if (state.colors.length && !p.colors.some(function (c) { return state.colors.indexOf(c.name) > -1; })) return false;
          var pr = effPrice(p);
          if (pr < state.price[0] || pr > state.price[1]) return false;
          if (state.availability === "in" && !p.inStock) return false;
          if (state.availability === "out" && p.inStock) return false;
          return true;
        });
        // sort
        var sorted = filtered.slice();
        if (state.sort === "price-asc") sorted.sort(function (a, b) { return effPrice(a) - effPrice(b); });
        else if (state.sort === "price-desc") sorted.sort(function (a, b) { return effPrice(b) - effPrice(a); });
        else if (state.sort === "name-asc") sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
        else sorted.sort(function (a, b) { return Number(!!b.featured) - Number(!!a.featured); });

        var total = sorted.length;
        var totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
        if (state.page > totalPages) state.page = totalPages;
        var pageItems = sorted.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);

        $("#resultCount").textContent = total + (total === 1 ? " item" : " items");
        var grid = $("#shopGrid");
        if (total === 0) {
          grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>NO PRODUCTS MATCH YOUR FILTERS</p><small>Try clearing a filter or widening your price range.</small><button class="btn btn-outline" id="emptyClear">CLEAR FILTERS</button></div>';
          var ec = $("#emptyClear"); if (ec) ec.addEventListener("click", clearAll);
        } else {
          grid.innerHTML = pageItems.map(productCardHTML).join("");
        }

        // pagination
        var pg = $("#pagination");
        if (totalPages <= 1) { pg.innerHTML = ""; }
        else {
          var html = '<button data-page="' + (state.page - 1) + '" ' + (state.page === 1 ? "disabled" : "") + ' aria-label="Previous page">‹</button>';
          for (var i = 1; i <= totalPages; i++) {
            html += '<button data-page="' + i + '" class="' + (i === state.page ? "active" : "") + '">' + i + '</button>';
          }
          html += '<button data-page="' + (state.page + 1) + '" ' + (state.page === totalPages ? "disabled" : "") + ' aria-label="Next page">›</button>';
          pg.innerHTML = html;
        }

        // active count for mobile button
        var ac = state.sizes.length + state.colors.length + state.categories.length +
          (state.availability !== "all" ? 1 : 0) + (state.price[0] !== 0 || state.price[1] !== PRICE_MAX ? 1 : 0) + (state.search.trim() ? 1 : 0);
        $all(".filter-count").forEach(function (el) { el.textContent = ac; el.style.display = ac > 0 ? "" : "none"; });

        // update mobile sheet "show results"
        var sb = $("#sheetShowBtn"); if (sb) sb.textContent = "SHOW " + total + " RESULTS";
      }

      function setPage(n) { state.page = n; applyAndRender(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      function resetPage() { state.page = 1; }

      // wire desktop sidebar
      var sidebar = $("#filtersSidebar");
      renderFilters(sidebar);

      sidebar.addEventListener("change", function (e) {
        var t = e.target;
        if (t.closest("[data-facet=categories]")) {
          state.categories = $all("input:checked", sidebar.querySelector("[data-facet=categories]")).map(function (c) { return c.value; });
          resetPage(); applyAndRender();
        }
        if (t.closest("[data-facet=priceLo]") || t.closest("[data-facet=priceHi]")) {
          var lo = parseInt(sidebar.querySelector("[data-facet=priceLo]").value, 10);
          var hi = parseInt(sidebar.querySelector("[data-facet=priceHi]").value, 10);
          state.price = [Math.min(lo, hi), Math.max(lo, hi)];
          resetPage(); applyAndRender();
        }
        if (t.name === "avail") { state.availability = t.value; resetPage(); applyAndRender(); }
        if (t.closest("[data-facet=search]")) { state.search = t.value; resetPage(); applyAndRender(); }
      });
      // Live search (input event for responsive typing)
      sidebar.addEventListener("input", function (e) {
        var t = e.target;
        if (t.closest("[data-facet=search]")) { state.search = t.value; resetPage(); applyAndRender(); }
        if (t.closest("[data-facet=priceLo]") || t.closest("[data-facet=priceHi]")) {
          var lo = parseInt(sidebar.querySelector("[data-facet=priceLo]").value, 10) || 0;
          var hi = parseInt(sidebar.querySelector("[data-facet=priceHi]").value, 10) || 0;
          state.price = [Math.min(lo, hi), Math.max(lo, hi)]; resetPage(); applyAndRender();
        }
      });
      sidebar.addEventListener("click", function (e) {
        var sz = e.target.closest("[data-size]");
        if (sz) {
          var s = sz.getAttribute("data-size");
          var idx = state.sizes.indexOf(s);
          if (idx > -1) state.sizes.splice(idx, 1); else state.sizes.push(s);
          renderFilters(sidebar); resetPage(); applyAndRender();
          return;
        }
        var cl = e.target.closest("[data-color]");
        if (cl) {
          var c = cl.getAttribute("data-color");
          var ci = state.colors.indexOf(c);
          if (ci > -1) state.colors.splice(ci, 1); else state.colors.push(c);
          renderFilters(sidebar); resetPage(); applyAndRender();
          return;
        }
      });
      $("#clearFiltersBtn").addEventListener("click", clearAll);

      function clearAll() {
        state.sizes = []; state.colors = []; state.categories = [];
        state.price = [0, PRICE_MAX]; state.availability = "all"; state.search = "";
        renderFilters(sidebar); renderFilters($("#mobileSheet")); applyAndRender();
      }

      // sort
      $("#sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; resetPage(); applyAndRender(); });

      // pagination delegation
      $("#pagination").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-page]"); if (!b || b.disabled) return;
        setPage(parseInt(b.getAttribute("data-page"), 10));
      });

      // mobile sheet
      var sheet = $("#mobileSheet"), sheetOv = $("#sheetOverlay");
      function openSheet() { renderFilters(sheet); sheetOv.classList.add("open"); sheet.classList.add("open"); document.body.style.overflow = "hidden"; }
      function closeSheet() { sheetOv.classList.remove("open"); sheet.classList.remove("open"); document.body.style.overflow = ""; }
      $("#mobileFiltersBtn").addEventListener("click", openSheet);
      $("#sheetCloseBtn").addEventListener("click", closeSheet);
      sheetOv.addEventListener("click", closeSheet);
      sheet.addEventListener("change", function (e) {
        var t = e.target;
        if (t.closest("[data-facet=categories]")) { state.categories = $all("input:checked", sheet.querySelector("[data-facet=categories]")).map(function (c) { return c.value; }); resetPage(); applyAndRender(); }
        if (t.closest("[data-facet=priceLo]") || t.closest("[data-facet=priceHi]")) { var lo = parseInt(sheet.querySelector("[data-facet=priceLo]").value, 10) || 0; var hi = parseInt(sheet.querySelector("[data-facet=priceHi]").value, 10) || 0; state.price = [Math.min(lo, hi), Math.max(lo, hi)]; resetPage(); applyAndRender(); }
        if (t.name === "avail") { state.availability = t.value; resetPage(); applyAndRender(); }
      });
      // Live search + price inputs in mobile sheet
      sheet.addEventListener("input", function (e) {
        var t = e.target;
        if (t.closest("[data-facet=search]")) { state.search = t.value; resetPage(); applyAndRender(); }
        if (t.closest("[data-facet=priceLo]") || t.closest("[data-facet=priceHi]")) { var lo = parseInt(sheet.querySelector("[data-facet=priceLo]").value, 10) || 0; var hi = parseInt(sheet.querySelector("[data-facet=priceHi]").value, 10) || 0; state.price = [Math.min(lo, hi), Math.max(lo, hi)]; resetPage(); applyAndRender(); }
      });
      sheet.addEventListener("click", function (e) {
        var sz = e.target.closest("[data-size]");
        if (sz) { var s = sz.getAttribute("data-size"); var idx = state.sizes.indexOf(s); if (idx > -1) state.sizes.splice(idx, 1); else state.sizes.push(s); renderFilters(sheet); return; }
        var cl = e.target.closest("[data-color]");
        if (cl) { var c = cl.getAttribute("data-color"); var ci = state.colors.indexOf(c); if (ci > -1) state.colors.splice(ci, 1); else state.colors.push(c); renderFilters(sheet); return; }
      });
      var sheetClear = $("#sheetClearBtn"); if (sheetClear) sheetClear.addEventListener("click", clearAll);
      var sheetShow = $("#sheetShowBtn"); if (sheetShow) sheetShow.addEventListener("click", closeSheet);

      applyAndRender();
    });
  }

  /* =====================================================================
     PAGE: PRODUCT DETAIL
     ===================================================================== */
  function initProduct() {
    injectShell();
    loadProducts(function (err, products) {
      if (err) return;
      var id = qs("id");
      var p = products.filter(function (x) { return x.id === id; })[0];
      var mount = $("#pdpMount");
      if (!p) {
        mount.innerHTML = '<div class="empty-state"><p>PRODUCT NOT FOUND</p><small>The item you’re looking for is no longer available.</small><a href="products.html" class="btn btn-outline" style="margin-top:20px">BACK TO SHOP</a></div>';
        return;
      }
      document.title = p.name + " — " + BRAND;
      var onSale = p.salePrice != null && p.salePrice < p.price;
      var price = effPrice(p);

      var state = { color: p.colors[0] ? p.colors[0].name : "", size: "", qty: 1, img: 0 };

      function render() {
        var colorHTML = p.colors.map(function (c) {
          var light = c.hex.toLowerCase() === "#f5f5f5";
          var active = state.color === c.name;
          return '<button class="swatch' + (light ? " light" : "") + (active ? " active" : "") + '" data-color="' + esc(c.name) + '" title="' + esc(c.name) + '" style="background:' + c.hex + '">' + (active ? '<span class="check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : "") + '</button>';
        }).join("");
        var sizeHTML = p.sizes.map(function (s) {
          return '<button class="size-btn' + (state.size === s ? " active" : "") + '" data-size="' + s + '" ' + (p.inStock ? "" : "disabled") + '>' + s + '</button>';
        }).join("");
        var allImgs = getAllImages(p);
        var thumbHTML = allImgs.map(function (img, i) {
          return '<div class="pdp-thumb' + (state.img === i ? " active" : "") + '" data-img="' + i + '"><img src="' + img + '" alt="' + esc(p.name) + ' view ' + (i + 1) + '"></div>';
        }).join("");
        var priceHTML = onSale
          ? '<span class="now sale">' + money(price) + '</span><span class="was">' + money(p.price) + '</span><span class="save">SAVE ' + money(p.price - price) + '</span>'
          : '<span class="now">' + money(price) + '</span>';
        var stockNote = !p.inStock ? "SOLD OUT" : (p.stock <= 10 ? "ONLY " + p.stock + " LEFT IN STOCK" : "IN STOCK");

        // Determine main image: if user clicked a thumbnail, use that; otherwise use color image if available
        var mainImg;
        if (state.img > 0 && allImgs[state.img]) {
          mainImg = allImgs[state.img];
        } else {
          mainImg = getImageForColor(p, state.color);
        }

        mount.innerHTML =
          '<nav class="breadcrumb"><a href="index.html">HOME</a> / <a href="products.html?category=' + p.category + '">' + p.category.toUpperCase() + '</a> / <span>' + esc(p.name).toUpperCase() + '</span></nav>' +
          '<div class="pdp">' +
            '<div class="pdp-thumbs">' + thumbHTML + '</div>' +
            '<div class="pdp-main"><img src="' + mainImg + '" alt="' + esc(p.name) + '" onerror="this.src=\'' + getImage(p) + '\'"></div>' +
            '<div class="pdp-info">' +
              '<p class="eyebrow">' + esc(p.category).toUpperCase() + '</p>' +
              '<h1>' + esc(p.name) + '</h1>' +
              '<div class="pdp-price">' + priceHTML + '</div>' +
              '<p class="pdp-stock">' + stockNote + '</p>' +
              '<div class="pdp-row"><div class="pdp-row-head"><span class="pdp-section-label">COLOR</span><span class="val">' + esc(state.color) + '</span></div><div class="swatches">' + colorHTML + '</div></div>' +
              '<div class="pdp-row"><div class="pdp-row-head"><span class="pdp-section-label">SIZE</span></div><div class="size-grid">' + sizeHTML + '</div></div>' +
              '<div class="pdp-actions">' +
                '<div class="qty-box"><button data-act="dec" ' + (state.qty <= 1 ? "disabled" : "") + ' aria-label="Decrease quantity">−</button><span class="q">' + state.qty + '</span><button data-act="inc" aria-label="Increase quantity">+</button></div>' +
                '<button class="btn btn-primary" id="addBtn" style="flex:1" ' + (p.inStock && state.size ? "" : "disabled") + '>' + (p.inStock ? "ADD TO CART" : "SOLD OUT") + '</button>' +
              '</div>' +
              (state.size || !p.inStock ? "" : '<p class="pdp-hint">SELECT A SIZE TO CONTINUE</p>') +
              '<div class="acc" id="acc">' +
                '<div class="acc-item open"><button class="acc-trigger" data-acc="details">DETAILS <span class="arrow">▾</span></button><div class="acc-content"><div class="acc-content-inner">' + esc(p.description) + '<ul><li>· Midweight organic cotton blend</li><li>· Garment-dyed for a soft, lived-in feel</li><li>· Relaxed, considered fit</li><li>· Made responsibly</li></ul></div></div></div>' +
                '<div class="acc-item"><button class="acc-trigger" data-acc="shipping">SHIPPING & RETURNS <span class="arrow">▾</span></button><div class="acc-content"><div class="acc-content-inner">Free standard shipping on orders over ₹2,000. Orders ship within 1–2 business days and arrive in 3–5 business days. Easy 7-day returns and exchanges on unworn items.</div></div></div>' +
                '<div class="acc-item"><button class="acc-trigger" data-acc="care">CARE <span class="arrow">▾</span></button><div class="acc-content"><div class="acc-content-inner">Machine wash cold, inside out, with like colors. Do not bleach. Tumble dry low or hang to dry. Cool iron if needed.</div></div></div>' +
              '</div>' +
            '</div>' +
          '</div>';

        // wire interactions
        $all("[data-color]", mount).forEach(function (b) { b.addEventListener("click", function () { state.color = b.getAttribute("data-color"); state.img = 0; render(); }); });
        $all("[data-size]", mount).forEach(function (b) { b.addEventListener("click", function () { state.size = b.getAttribute("data-size"); render(); }); });
        $all("[data-img]", mount).forEach(function (b) { b.addEventListener("click", function () { state.img = parseInt(b.getAttribute("data-img"), 10); render(); }); });
        $all(".qty-box button", mount).forEach(function (b) { b.addEventListener("click", function () { if (b.getAttribute("data-act") === "inc") state.qty++; else state.qty = Math.max(1, state.qty - 1); render(); }); });
        var addBtn = $("#addBtn", mount);
        if (addBtn) addBtn.addEventListener("click", function () {
          if (!p.inStock) return;
          if (!state.size) { toast("Please select a size"); return; }
          addToCart(p, state.size, state.color, state.qty);
          toast("Added " + state.qty + " × " + p.name + " to your bag", "success");
        });
        // accordions
        $all(".acc-trigger", mount).forEach(function (b) {
          b.addEventListener("click", function () {
            var item = b.closest(".acc-item");
            var open = item.classList.contains("open");
            var content = item.querySelector(".acc-content");
            if (open) { item.classList.remove("open"); content.style.maxHeight = "0px"; }
            else { item.classList.add("open"); content.style.maxHeight = content.scrollHeight + "px"; }
          });
        });
        // open default
        var def = mount.querySelector(".acc-item.open .acc-content");
        if (def) def.style.maxHeight = def.scrollHeight + "px";
      }

      render();

      // related
      var related = products.filter(function (x) { return x.category === p.category && x.id !== p.id; }).slice(0, 4);
      var rg = $("#relatedGrid");
      if (rg && related.length) rg.innerHTML = related.map(productCardHTML).join("");
    });
  }

  /* =====================================================================
     PAGE: CHECKOUT
     ===================================================================== */
  function initCheckout() {
    injectShell();
    var items = getCart();
    var mount = $("#checkoutMount");
    if (items.length === 0) {
      mount.innerHTML = '<div class="empty-state"><p>YOUR BAG IS EMPTY</p><small>Add items to your bag before checking out.</small><a href="products.html" class="btn btn-outline" style="margin-top:20px">CONTINUE SHOPPING</a></div>';
      return;
    }
    var sub = cartSubtotal(items);
    var ship = sub >= 2000 ? 0 : 99;
    var total = sub + ship;
    var itemsHTML = items.map(function (i) {
      return '<div class="summary-item"><div class="si-img"><img src="' + i.image + '" alt="' + esc(i.name) + '"><span class="si-qty">' + i.qty + '</span></div><div class="si-meta"><div class="si-name">' + esc(i.name) + '</div><div class="si-variant">' + esc(i.color) + ' · SIZE ' + esc(i.size) + '</div><div class="si-price">' + money(i.price * i.qty) + '</div></div></div>';
    }).join("");

    mount.innerHTML =
      '<div class="checkout-layout">' +
        '<form id="checkoutForm">' +
          '<div class="form-section"><h2>SHIPPING DETAILS</h2>' +
            '<div class="field"><label for="name">Full Name *</label><input id="name" required placeholder="Name of person or business receiving the parcel"></div>' +
            '<div class="field"><label for="address">Complete Address *</label><textarea id="address" required rows="3" placeholder="Flat/house number, building name, street, area, and landmark"></textarea></div>' +
            '<div class="field-row">' +
              '<div class="field"><label for="zip">PIN / Zip Code *</label><input id="zip" required placeholder="e.g. 221001" pattern="[0-9]{6}" maxlength="6"></div>' +
              '<div class="field"><label for="phone">Contact Number *</label><input id="phone" type="tel" required placeholder="10-digit mobile number" pattern="[0-9]{10}" maxlength="10"></div>' +
            '</div>' +
            '<div class="field"><label for="email">Email Address <small style="color:var(--muted);font-weight:400">(optional)</small></label><input id="email" type="email" placeholder="For digital tracking updates"></div>' +
            '<div class="field"><label for="city">City / Town *</label><input id="city" required placeholder="e.g. Gopiganj"></div>' +
            '<div class="field"><label for="country">State</label><input id="country" value="Uttar Pradesh"></div>' +
          '</div>' +
          '<div class="form-section"><h2>HOW IT WORKS</h2>' +
            '<div class="order-flow-note">' +
              '<div class="flow-step"><span class="flow-num">1</span><div><strong>Place Order</strong><br><small>You place the order here — no online payment needed yet.</small></div></div>' +
              '<div class="flow-step"><span class="flow-num">2</span><div><strong>Owner Call</strong><br><small>The owner will call you on your contact number to confirm the order.</small></div></div>' +
              '<div class="flow-step"><span class="flow-num">3</span><div><strong>Order Confirmed</strong><br><small>Once confirmed, your order is packed and dispatched. Track it anytime.</small></div></div>' +
            '</div>' +
          '</div>' +
          '<div class="form-section"><h2>PAYMENT</h2><div class="payment-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Pay on delivery or as discussed with the owner. No online payment required — the owner will confirm payment method during the call.</div></div>' +
        '</form>' +
        '<aside><div class="summary-card">' +
          '<div class="summary-head"><h2>ORDER SUMMARY</h2></div>' +
          '<div class="summary-items">' + itemsHTML + '</div>' +
          '<div class="summary-totals"><div class="row"><span>Subtotal</span><span>' + money(sub) + '</span></div><div class="row"><span>Shipping</span><span>' + (ship === 0 ? "FREE" : money(ship)) + '</span></div><div class="row total"><span>Total</span><span>' + money(total) + '</span></div></div>' +
          '<div class="summary-foot"><button class="btn btn-primary btn-block" id="placeOrderBtn">PLACE ORDER</button><p style="text-align:center;margin-top:12px;font-size:11px;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:6px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>By placing this order you agree to our <a href="terms.html" style="color:var(--olive);text-decoration:underline">Terms &amp; Policy</a></p></div>' +
        '</div></aside>' +
      '</div>';

    $("#placeOrderBtn").addEventListener("click", function (e) {
      e.preventDefault();
      var req = ["name", "address", "zip", "phone", "city"];
      for (var i = 0; i < req.length; i++) {
        var el = $("#" + req[i]);
        if (!el.value.trim()) { toast("Please complete: " + req[i].toUpperCase()); el.focus(); return; }
      }
      // Validate phone (10 digits)
      var phoneVal = $("#phone").value.trim();
      if (!/^[0-9]{10}$/.test(phoneVal)) { toast("Please enter a valid 10-digit mobile number"); $("#phone").focus(); return; }
      // Validate PIN (6 digits)
      var zipVal = $("#zip").value.trim();
      if (!/^[0-9]{6}$/.test(zipVal)) { toast("Please enter a valid 6-digit PIN code"); $("#zip").focus(); return; }

      // Generate tracking ID and order number
      var trackingId = "RRG" + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, "0");
      // If the customer is signed in, tie this order to their account
      var loggedInUser = (window.RRG_AUTH && window.RRG_AUTH.getUser) ? window.RRG_AUTH.getUser() : null;
      var order = {
        number: "RRG-" + Date.now().toString().slice(-6) + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0"),
        trackingId: trackingId,
        date: new Date().toISOString(),
        uid: loggedInUser ? loggedInUser.uid : null,
        items: items, subtotal: sub, shipping: ship, total: total,
        // Customer details
        name: $("#name").value.trim(),
        address: $("#address").value.trim(),
        zip: zipVal,
        phone: phoneVal,
        email: $("#email").value.trim() || (loggedInUser ? loggedInUser.email : ""),
        city: $("#city").value.trim(),
        country: $("#country").value.trim(),
        // Order status tracking
        status: "pending",
        statusHistory: [
          { status: "pending", label: "Order Placed", date: new Date().toISOString(), note: "Order received. Owner will call to confirm." }
        ]
      };
      var btn = $("#placeOrderBtn");
      btn.disabled = true; btn.textContent = "PLACING ORDER…";

      // Save order to Firestore (or localStorage fallback)
      function completeOrder() {
        localStorage.setItem(ORDER_KEY, JSON.stringify(order));
        localStorage.removeItem(CART_KEY);
        updateCartBadge();
        window.location.href = "order-confirmation.html";
      }

      if (window.RRG_DB && window.RRG_DB.isConfigured()) {
        // Save to Firestore so the admin can see it
        window.RRG_DB.createOrder(order, function (err, saved) {
          if (err) {
            console.warn("Order save failed, using local:", err);
            toast("Order placed (saved locally)");
          } else {
            order.id = saved.id;
            toast("Order placed successfully!", "success");
          }
          completeOrder();
        });
      } else {
        completeOrder();
      }
    });
  }

  /* =====================================================================
     PAGE: CONFIRMATION
     ===================================================================== */
  function initConfirmation() {
    injectShell();
    var order = null;
    try { order = JSON.parse(localStorage.getItem(ORDER_KEY)); } catch (e) {}
    var mount = $("#confirmMount");
    if (!order) {
      mount.innerHTML = '<div class="empty-state"><p>NO RECENT ORDER</p><small>We couldn’t find a recent order to display.</small><a href="products.html" class="btn btn-outline" style="margin-top:20px">START SHOPPING</a></div>';
      return;
    }
    var date = new Date(order.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    var itemsHTML = order.items.map(function (i) {
      return '<div class="item"><img src="' + i.image + '" alt="' + esc(i.name) + '"><div class="meta"><div class="name">' + esc(i.name) + '</div><div class="variant">' + esc(i.color) + ' · SIZE ' + esc(i.size) + ' · QTY ' + i.qty + '</div></div><span class="price">' + money(i.price * i.qty) + '</span></div>';
    }).join("");
    var trackingId = order.trackingId || order.number;
    var contactInfo = order.email ? esc(order.email) : esc(order.phone || "your phone");
    mount.innerHTML =
      '<div class="confirm-head"><span class="confirm-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><p class="eyebrow">ORDER PLACED</p><h1>THANK YOU</h1><p>Your order has been placed successfully. The owner will call you at <strong>' + esc(order.phone || '') + '</strong> shortly to confirm your order.</p></div>' +
      '<div class="confirm-meta">' +
        '<div class="cell"><p class="label">ORDER NUMBER</p><p class="val big">' + order.number + '</p></div>' +
        '<div class="cell"><p class="label">TRACKING ID</p><p class="val big" style="color:var(--olive)">' + trackingId + '</p></div>' +
        '<div class="cell"><p class="label">DATE</p><p class="val">' + date + '</p></div>' +
        '<div class="cell"><p class="label">TOTAL</p><p class="val">' + money(order.total) + '</p></div>' +
      '</div>' +
      '<div class="tracking-banner"><p><strong>📋 Save your Tracking ID:</strong> ' + trackingId + '</p><p>Use this ID to <a href="track.html?id=' + trackingId + '" style="color:var(--white);text-decoration:underline">track your order</a> anytime. The owner will update the status after calling you.</p></div>' +
      '<div class="confirm-card"><div class="head"><h2>ORDER SUMMARY</h2></div>' + itemsHTML + '<div class="totals"><div class="row"><span>Subtotal</span><span>' + money(order.subtotal) + '</span></div><div class="row"><span>Shipping</span><span>' + (order.shipping === 0 ? "FREE" : money(order.shipping)) + '</span></div><div class="row total"><span>Total</span><span>' + money(order.total) + '</span></div></div></div>' +
      '<div class="confirm-ship"><h2>SHIPPING TO</h2><p>' + esc(order.name) + '<br>' + esc(order.address) + '<br>' + esc(order.city) + ', ' + esc(order.zip) + '<br>' + esc(order.country) + '<br><br><strong>Phone:</strong> ' + esc(order.phone || 'N/A') + (order.email ? '<br><strong>Email:</strong> ' + esc(order.email) : '') + '</p></div>' +
      '<div class="confirm-actions"><a href="track.html?id=' + trackingId + '" class="btn btn-primary">TRACK MY ORDER</a><a href="products.html" class="btn btn-outline">CONTINUE SHOPPING</a></div>';
  }

  /* =====================================================================
     PAGE: TRACK ORDER (customer tracking page)
     ===================================================================== */
  function initTrack() {
    injectShell();
    var mount = $("#trackMount");
    if (!mount) return;

    // Status definitions with labels and icons
    var STATUSES = [
      { key: "pending", label: "Order Placed", icon: "📋", desc: "Order received. Owner will call to confirm." },
      { key: "confirmed", label: "Confirmed", icon: "✅", desc: "Owner confirmed the order via call." },
      { key: "packed", label: "Packed", icon: "📦", desc: "Order packed and ready for dispatch." },
      { key: "dispatched", label: "Dispatched", icon: "🚚", desc: "Order handed to delivery partner." },
      { key: "transit", label: "In Transit", icon: "🛵", desc: "Order on the way to you." },
      { key: "delivered", label: "Delivered", icon: "🎉", desc: "Order delivered successfully." },
      { key: "cancelled", label: "Cancelled", icon: "❌", desc: "Order was cancelled." }
    ];

    var urlId = qs("id");
    if (urlId) { $("#trackInput").value = urlId; doTrack(urlId); }

    $("#trackForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = $("#trackInput").value.trim();
      if (!id) { toast("Enter your tracking ID or order number"); return; }
      doTrack(id);
    });

    function doTrack(id) {
      $("#trackResult").innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Looking up your order…</div>';

      // Try Firestore first
      if (window.RRG_DB && window.RRG_DB.isConfigured()) {
        var db = window.RRG_DB.init();
        if (!db) { $("#trackResult").innerHTML = '<div class="track-error">Could not connect to database. Please try again.</div>'; return; }

        // Query by trackingId OR order number
        db.collection("orders").where("trackingId", "==", id).get()
          .then(function (snap) {
            if (snap.empty) {
              // Try by order number
              return db.collection("orders").where("number", "==", id).get();
            }
            return snap;
          })
          .then(function (snap) {
            if (snap.empty) {
              // Check localStorage fallback
              var local = checkLocalOrder(id);
              if (local) { renderOrder(local); }
              else { $("#trackResult").innerHTML = '<div class="track-error"><p>Order not found</p><small>Check your tracking ID and try again. Example: RRG12345678</small></div>'; }
            } else {
              var order = null;
              snap.forEach(function (doc) { order = doc.data(); });
              renderOrder(order);
            }
          })
          .catch(function (err) {
            // Fallback to localStorage
            var local = checkLocalOrder(id);
            if (local) { renderOrder(local); }
            else { $("#trackResult").innerHTML = '<div class="track-error"><p>Could not look up order</p><small>' + esc(err.message) + '</small></div>'; }
          });
      } else {
        // No Firebase — check localStorage
        var local = checkLocalOrder(id);
        if (local) { renderOrder(local); }
        else { $("#trackResult").innerHTML = '<div class="track-error"><p>Order not found</p><small>Check your tracking ID and try again.</small></div>'; }
      }
    }

    function checkLocalOrder(id) {
      try {
        var order = JSON.parse(localStorage.getItem(ORDER_KEY));
        if (order && (order.trackingId === id || order.number === id)) return order;
      } catch (e) {}
      return null;
    }

    function renderOrder(order) {
      var status = order.status || "pending";
      var currentIdx = -1;
      STATUSES.forEach(function (s, i) { if (s.key === status) currentIdx = i; });

      // Status timeline
      var timelineHTML = STATUSES.filter(function (s) { return s.key !== "cancelled"; }).map(function (s, i) {
        var isDone = currentIdx >= i && status !== "cancelled";
        var isCurrent = s.key === status;
        return '<div class="track-step ' + (isDone ? "done" : "") + ' ' + (isCurrent ? "current" : "") + '">' +
          '<div class="track-step-icon">' + (isDone ? "✓" : s.icon) + '</div>' +
          '<div class="track-step-body"><div class="track-step-label">' + s.label + '</div>' +
          '<div class="track-step-desc">' + s.desc + '</div></div>' +
        '</div>';
      }).join("");

      if (status === "cancelled") {
        timelineHTML = '<div class="track-step done current cancelled"><div class="track-step-icon">❌</div><div class="track-step-body"><div class="track-step-label">Order Cancelled</div><div class="track-step-desc">This order was cancelled. Please contact us for help.</div></div></div>';
      }

      // Status history (if available)
      var historyHTML = "";
      if (order.statusHistory && order.statusHistory.length) {
        historyHTML = '<div class="track-history"><h3>STATUS UPDATES</h3>' +
          order.statusHistory.map(function (h) {
            var d = new Date(h.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            return '<div class="history-item"><span class="history-date">' + d + '</span><span class="history-label">' + esc(h.label || h.status) + '</span>' + (h.note ? '<span class="history-note">' + esc(h.note) + '</span>' : '') + '</div>';
          }).join("") + '</div>';
      }

      // Items
      var itemsHTML = (order.items || []).map(function (i) {
        return '<div class="track-item"><img src="' + esc(i.image || "") + '" alt="' + esc(i.name) + '"><div class="track-item-meta"><div class="track-item-name">' + esc(i.name) + '</div><div class="track-item-variant">' + esc(i.color || '') + ' · SIZE ' + esc(i.size || '') + ' · QTY ' + i.qty + '</div></div><span class="track-item-price">' + money(i.price * i.qty) + '</span></div>';
      }).join("");

      var date = new Date(order.date || order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

      $("#trackResult").innerHTML =
        '<div class="track-order">' +
          '<div class="track-order-head">' +
            '<div><div class="track-order-num">' + esc(order.number) + '</div><div class="track-order-date">' + date + '</div></div>' +
            '<div class="track-status-badge status-' + status + '">' + (status === "pending" ? "PENDING" : status.toUpperCase()) + '</div>' +
          '</div>' +
          '<div class="track-timeline">' + timelineHTML + '</div>' +
          historyHTML +
          '<div class="track-items"><h3>ITEMS</h3>' + itemsHTML + '</div>' +
          '<div class="track-customer"><h3>DELIVERY TO</h3><p>' + esc(order.name) + '<br>' + esc(order.address) + '<br>' + esc(order.city) + ', ' + esc(order.zip) + '<br>' + esc(order.country) + '<br><br><strong>Phone:</strong> ' + esc(order.phone || 'N/A') + '</p></div>' +
          '<div class="track-actions"><a href="products.html" class="btn btn-outline">CONTINUE SHOPPING</a><a href="contact.html" class="btn btn-outline">CONTACT US</a></div>' +
        '</div>';
    }
  }

  /* ---------- Router ---------- */
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    var page = document.body.getAttribute("data-page");
    if (page === "home") initHome();
    else if (page === "shop") initShop();
    else if (page === "product") initProduct();
    else if (page === "checkout") initCheckout();
    else if (page === "confirmation") initConfirmation();
    else if (page === "account") initAccount();
    else if (page === "track") initTrack();
    // For info pages, just inject the shell (header/footer/cart/auth)
    if (page !== "home" && page !== "shop" && page !== "product" &&
        page !== "checkout" && page !== "confirmation" && page !== "account" &&
        page !== "track") {
      injectShell();
      // Wire contact form if present
      var cf = document.getElementById("contactForm");
      if (cf) {
        cf.addEventListener("submit", function (e) {
          e.preventDefault();
          var suc = document.getElementById("contactSuccess");
          if (suc) suc.classList.add("show");
          cf.reset();
          setTimeout(function () { if (suc) suc.classList.remove("show"); }, 5000);
        });
      }
    }
  });

  /* =====================================================================
     PAGE: ACCOUNT (Login / Signup via Firebase)
     ===================================================================== */
  function initAccount() {
    injectShell();
    var mount = $("#authMount");
    if (!mount) return;

    var mode = "login"; // or "signup"

    function render() {
      mount.innerHTML =
        '<div class="auth-page">' +
          '<div class="auth-card">' +
            '<h1>' + (mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT") + "</h1>" +
            '<p class="sub">' + (mode === "login" ? "Sign in to your RR Garments account" : "Join RR Garments today") + "</p>" +
            '<div class="auth-tabs">' +
              '<button class="auth-tab' + (mode === "login" ? " active" : "") + '" data-mode="login">SIGN IN</button>' +
              '<button class="auth-tab' + (mode === "signup" ? " active" : "") + '" data-mode="signup">SIGN UP</button>' +
            '</div>' +
            '<div class="auth-error" id="authError"></div>' +
            '<div class="auth-success" id="authSuccess"></div>' +
            '<form id="authForm">' +
              '<div class="field"><label for="email">Email</label><input id="email" type="email" required placeholder="you@example.com"></div>' +
              '<div class="field"><label for="password">Password</label><input id="password" type="password" required placeholder="••••••••" minlength="6"></div>' +
              (mode === "signup" ? '<div class="field"><label for="confirm">Confirm Password</label><input id="confirm" type="password" required placeholder="••••••••" minlength="6"></div>' : "") +
              '<button class="btn btn-primary btn-block" type="submit" id="authSubmit">' + (mode === "login" ? "SIGN IN" : "CREATE ACCOUNT") + "</button>" +
            '</form>' +
            '<p class="auth-foot">' + (mode === "login"
              ? 'Don\'t have an account? <a href="#" data-mode="signup">Sign up</a>'
              : 'Already have an account? <a href="#" data-mode="login">Sign in</a>') + "</p>" +
          '</div>' +
          '<p class="auth-foot" style="margin-top:16px">By continuing you agree to our Terms & Privacy Policy.</p>' +
        '</div>';

      // wire tabs
      $all("[data-mode]", mount).forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault();
          mode = b.getAttribute("data-mode");
          render();
        });
      });

      // wire form
      $("#authForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var errEl = $("#authError"), sucEl = $("#authSuccess");
        errEl.classList.remove("show"); sucEl.classList.remove("show");
        var email = $("#email").value.trim();
        var password = $("#password").value;
        var btn = $("#authSubmit");
        btn.disabled = true; btn.textContent = "PLEASE WAIT…";

        if (mode === "signup") {
          var confirm = $("#confirm").value;
          if (password !== confirm) {
            errEl.textContent = "Passwords do not match."; errEl.classList.add("show");
            btn.disabled = false; btn.textContent = "CREATE ACCOUNT";
            return;
          }
          if (window.RRG_AUTH) {
            window.RRG_AUTH.signUp(email, password, function (err) {
              if (err) {
                errEl.textContent = err.message; errEl.classList.add("show");
                btn.disabled = false; btn.textContent = "CREATE ACCOUNT";
              } else {
                sucEl.textContent = "Account created! Redirecting…"; sucEl.classList.add("show");
                setTimeout(function () { window.location.href = "index.html"; }, 1000);
              }
            });
          } else {
            errEl.textContent = "Auth not available. Configure Firebase in js/firebase-auth.js."; errEl.classList.add("show");
            btn.disabled = false; btn.textContent = "CREATE ACCOUNT";
          }
        } else {
          if (window.RRG_AUTH) {
            window.RRG_AUTH.signIn(email, password, function (err) {
              if (err) {
                errEl.textContent = err.message; errEl.classList.add("show");
                btn.disabled = false; btn.textContent = "SIGN IN";
              } else {
                sucEl.textContent = "Signed in! Redirecting…"; sucEl.classList.add("show");
                setTimeout(function () { window.location.href = "index.html"; }, 800);
              }
            });
          } else {
            errEl.textContent = "Auth not available. Configure Firebase in js/firebase-auth.js."; errEl.classList.add("show");
            btn.disabled = false; btn.textContent = "SIGN IN";
          }
        }
      });
    }

    render();

    // If already logged in, show account info (uses onReady callback to avoid race condition)
    if (window.RRG_AUTH) {
      window.RRG_AUTH.init(function (user) {
        if (user) {
          mount.innerHTML =
            '<div class="auth-page" style="max-width:720px"><div class="auth-card" style="text-align:left">' +
              '<h1>MY ACCOUNT</h1>' +
              '<p class="sub">You are signed in</p>' +
              '<div class="info-card"><h3>EMAIL</h3><p>' + esc(user.email) + '</p></div>' +
              '<div class="info-card"><h3>STORE</h3><p>Gopiganj Road, Between Pillar No. 21 & 22</p></div>' +
              '<a href="products.html" class="btn btn-primary btn-block">CONTINUE SHOPPING</a>' +
              '<button class="btn btn-outline btn-block" style="margin-top:12px" id="acctLogout">SIGN OUT</button>' +
              '<div style="margin-top:32px;border-top:1px solid var(--border);padding-top:24px">' +
                '<h3 style="font-size:14px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">ORDER HISTORY</h3>' +
                '<div id="myOrders"><p class="sub">Loading your orders…</p></div>' +
              '</div>' +
            '</div></div>';
          var lo = $("#acctLogout");
          if (lo) lo.addEventListener("click", function () { if (window.RRG_AUTH) window.RRG_AUTH.signOut(); });
          loadMyOrders(user);
        }
      });
    }
  }

  function loadMyOrders(user) {
    var box = $("#myOrders");
    if (!box) return;
    if (!window.RRG_DB || !window.RRG_DB.isConfigured()) {
      box.innerHTML = '<p class="sub">Order history isn\'t available in demo mode yet.</p>';
      return;
    }
    window.RRG_DB.loadOrdersByUser(user.uid, function (err, orders) {
      if (err) {
        box.innerHTML = '<p class="sub">Couldn\'t load your orders right now.</p>';
        return;
      }
      if (!orders || orders.length === 0) {
        box.innerHTML = '<p class="sub">You haven\'t placed any orders yet.</p>';
        return;
      }
      box.innerHTML = orders.map(function (o) {
        var date = new Date(o.createdAt || o.date).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        var itemsSummary = (o.items || []).map(function (i) { return i.name + " × " + i.qty; }).join(", ");
        var trackingId = o.trackingId || o.number;
        return '<div class="info-card" style="margin-bottom:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
            '<div>' +
              '<p style="font-weight:700">' + esc(o.number || o.id) + '</p>' +
              '<p class="sub" style="margin-top:2px">' + date + ' · ' + esc(itemsSummary) + '</p>' +
              '<p class="sub" style="margin-top:2px">Total: ' + money(o.total) + '</p>' +
            '</div>' +
            '<span class="stock-badge" style="text-transform:uppercase;white-space:nowrap">' + esc(o.status || "pending") + '</span>' +
          '</div>' +
          '<a href="track.html?id=' + encodeURIComponent(trackingId) + '" class="btn btn-outline" style="margin-top:12px;display:inline-block;padding:6px 14px;font-size:11px">TRACK ORDER</a>' +
        '</div>';
      }).join("");
    });
  }

  // Expose for inline onclick handlers if needed
  window.RRG = { openCart: openCart, closeCart: closeCart, INSTAGRAM_URL: INSTAGRAM_URL };
})();
