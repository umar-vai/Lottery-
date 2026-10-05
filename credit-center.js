(function(){
'use strict';
/* Virtual Credit Requests are intentionally disabled.
   Draw Credits can still be managed directly by an admin from Players.
   Keeping this file as an inert compatibility stub prevents old cached pages from reopening the request workflow. */
function closeLegacy(){var c=document.getElementById('d01CreditCenter');if(c)c.remove();var b=document.getElementById('d01AddCredit');if(b)b.remove()}
window.Draw01CreditCenter={enabled:false,open:function(){closeLegacy()},close:closeLegacy,refresh:function(){return Promise.resolve(null)}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',closeLegacy);else closeLegacy();
})();