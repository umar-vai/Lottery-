(function(){
  'use strict';
  window.__DRAW01_ADMIN_BOOT = Date.now();

  function byId(id){ return document.getElementById(id); }
  function setGate(message, showLogin){
    var m = byId('gateMessage');
    var b = byId('adminLoginBtn');
    if(m) m.textContent = message;
    if(b && showLogin) b.hidden = false;
  }

  // Never allow a mobile network request to leave the admin screen hanging forever.
  var nativeFetch = window.fetch && window.fetch.bind(window);
  if(nativeFetch){
    window.fetch = function(input, init){
      init = init || {};
      if(init.signal) return nativeFetch(input, init);
      var controller = new AbortController();
      init.signal = controller.signal;
      var timer = setTimeout(function(){ controller.abort(); }, 8000);
      return nativeFetch(input, init).finally(function(){ clearTimeout(timer); });
    };
  }

  function fallbackLogin(){
    var project = 'https://mwtlsnneooxmryondrex.supabase.co';
    var back = 'https://umar-vai.github.io/Lottery-/admin.html?v=32';
    location.href = project + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(back);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var btn = byId('adminLoginBtn');
    if(btn) btn.addEventListener('click', function(){
      // The main script also binds this button. This fallback only matters if it failed.
      if(!window.__DRAW01_ADMIN_MAIN_READY) fallbackLogin();
    });

    setTimeout(function(){
      var gate = byId('authGate');
      var app = byId('adminApp');
      if(gate && !gate.hidden && (!app || app.hidden)){
        setGate('The session check is taking too long. Tap Continue with Google to refresh your admin session.', true);
      }
    }, 6500);
  });

  window.addEventListener('error', function(e){
    setGate('Admin script error: ' + (e.message || 'unknown browser error') + '. Tap Continue with Google to retry.', true);
  });
  window.addEventListener('unhandledrejection', function(e){
    var reason = e.reason && (e.reason.message || String(e.reason));
    setGate('Admin startup failed: ' + (reason || 'network/session error') + '. Tap Continue with Google to retry.', true);
  });
})();