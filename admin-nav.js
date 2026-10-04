import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const adminLink = document.getElementById('adminNavLink');
const accountCard = document.getElementById('accountCard');
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
const sessionKey = `sb-${projectRef}-auth-token`;
if (adminLink) adminLink.href = 'ops-v4.html';

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(payload).split('').map(c => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));
    return JSON.parse(json);
  } catch { return {}; }
}
function readSession() {
  try {
    const raw = localStorage.getItem(sessionKey); if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.access_token) return parsed;
    if (parsed?.currentSession?.access_token) return parsed.currentSession;
    if (parsed?.session?.access_token) return parsed.session;
    return null;
  } catch { return null; }
}
function hideAdminLink(){ if(adminLink) adminLink.hidden=true; }
async function syncAdminLink(){
  if(!adminLink)return;
  const s=readSession(); if(!s?.access_token){hideAdminLink();return;}
  const userId=s.user?.id||decodeJwt(s.access_token).sub; if(!userId){hideAdminLink();return;}
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${s.access_token}`}});
    if(!r.ok)throw new Error(`Profile check failed (${r.status})`);
    const rows=await r.json(); adminLink.hidden=rows?.[0]?.role!=='admin';
  }catch(e){console.warn('Admin navigation check failed:',e);hideAdminLink();}
}
if(accountCard)new MutationObserver(()=>{if(accountCard.hidden)hideAdminLink();else syncAdminLink();}).observe(accountCard,{attributes:true,attributeFilter:['hidden']});
window.addEventListener('pageshow',syncAdminLink);
window.addEventListener('storage',e=>{if(e.key===sessionKey)syncAdminLink();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncAdminLink();});
syncAdminLink();
