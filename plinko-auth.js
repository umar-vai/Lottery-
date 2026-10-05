(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var APP='https://umar-vai.github.io/Lottery-/plinko.html';
document.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('#loginBtn');if(!t)return;e.preventDefault();e.stopImmediatePropagation();location.href=BASE+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(APP)},true);
})();
