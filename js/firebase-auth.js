/* =====================================================================
   RR GARMENTS — Firebase Authentication
   Uses Firebase compat SDK (loaded via CDN in HTML).
   Handles: login, signup, logout, session persistence.
   ===================================================================== */
(function () {
  "use strict";

  // ---- Firebase config ----
  // Live credentials for RR Garments Firebase project.
  var firebaseConfig = {
    apiKey: "AIzaSyDTQQhiXuNENro1ySVFyGrhbj7bguqCuK4",
    authDomain: "rrgarments.firebaseapp.com",
    projectId: "rrgarments",
    storageBucket: "rrgarments.firebasestorage.app",
    messagingSenderId: "964839432989",
    appId: "1:964839432989:web:c7c2772be866ef8dd4b7f4",
    measurementId: "G-NR4EB85ZRJ",
  };

  var authReady = false;
  var currentUser = null;
  var authCallbacks = [];
  var authDetermined = false;

  function init(onReady) {
    if (typeof firebase === "undefined") {
      // Firebase SDK not loaded — auth disabled (preview mode).
      updateUI(null);
      if (onReady) onReady(null);
      return;
    }
    if (!authReady) {
      firebase.initializeApp(firebaseConfig);
      authReady = true;
      // Set persistence to LOCAL — session survives page refresh and browser restart
      try { firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
    }

    // If already determined, call callback immediately
    if (authDetermined) {
      if (onReady) onReady(currentUser);
      return;
    }
    // Queue callback for when auth state is determined
    if (onReady) authCallbacks.push(onReady);

    // Listen for auth state changes (fires on init + whenever session changes).
    // This only needs to be registered once.
    if (!authDetermined) {
      firebase.auth().onAuthStateChanged(function (user) {
        currentUser = user;
        authDetermined = true;
        updateUI(user);
        // Fire all queued callbacks
        var cbs = authCallbacks.slice();
        authCallbacks = [];
        cbs.forEach(function (cb) { try { cb(user); } catch (e) {} });
      });
    }
  }

  function signIn(email, password, cb) {
    if (!authReady) return cb(new Error("Auth not initialized"));
    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () { cb(null); })
      .catch(function (err) { cb(err); });
  }

  function signUp(email, password, cb) {
    if (!authReady) return cb(new Error("Auth not initialized"));
    firebase.auth().createUserWithEmailAndPassword(email, password)
      .then(function () { cb(null); })
      .catch(function (err) { cb(err); });
  }

  function signOut() {
    if (!authReady) return;
    firebase.auth().signOut().then(function () {
      window.location.href = "index.html";
    });
  }

  function getUser() { return currentUser; }

  // ---- UI updates ----
  function updateUI(user) {
    var userMenu = document.querySelector(".header-user-menu");
    var loginBtn = document.querySelector(".header-login-btn");
    if (!userMenu || !loginBtn) return;

    if (user) {
      // Logged in
      loginBtn.style.display = "none";
      userMenu.style.display = "";
      var initial = (user.email || "?").charAt(0).toUpperCase();
      var avatarEl = userMenu.querySelector(".avatar");
      var emailEl = userMenu.querySelector(".user-dropdown .email");
      if (avatarEl) avatarEl.textContent = initial;
      if (emailEl) emailEl.textContent = user.email;
      var labelText = userMenu.querySelector(".label-text");
      if (labelText) labelText.textContent = "ACCOUNT";
    } else {
      // Logged out
      loginBtn.style.display = "";
      userMenu.style.display = "none";
    }
  }

  // ---- Expose ----
  window.RRG_AUTH = {
    init: init,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    getUser: getUser,
  };
})();
