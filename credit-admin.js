(function(){
'use strict';
/* Public virtual-credit requests are disabled for now.
   Admins still manage Draw Credit balances directly from the Players tab. */
function removeInbox(){var box=document.getElementById('creditAdminBox');if(box)box.remove()}
window.Draw01CreditRequestsAdmin={enabled:false};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeInbox);else removeInbox();
})();