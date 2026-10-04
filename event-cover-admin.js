import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, BACKEND_READY } from './config.js';

if (BACKEND_READY) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
  const dialog = document.getElementById('eventDialog');
  const form = document.getElementById('eventForm');
  const slugInput = document.getElementById('fSlug');
  const desc = document.getElementById('fDescription');

  let pendingUrl = null;
  let existingUrl = '';
  let saveRequested = false;
  let previewObjectUrl = '';

  const field = document.createElement('div');
  field.className = 'full event-cover-field';
  field.innerHTML = `
    <div class="event-cover-preview" id="eventCoverPreview"><span>No cover selected</span></div>
    <div class="event-cover-tools">
      <div><span class="eyebrow">EVENT COVER</span><h3>Cover photo</h3></div>
      <p>Upload a JPG, PNG or WebP image up to 5 MB. It will appear on the homepage event card and behind the event hero title.</p>
      <input id="eventCoverFile" type="file" accept="image/jpeg,image/png,image/webp">
      <div class="event-cover-actions"><button type="button" class="btn ghost compact" id="removeEventCover">Remove cover</button></div>
      <div class="event-cover-status" id="eventCoverStatus"></div>
    </div>`;
  desc.closest('label').insertAdjacentElement('afterend', field);

  const fileInput = document.getElementById('eventCoverFile');
  const preview = document.getElementById('eventCoverPreview');
  const status = document.getElementById('eventCoverStatus');
  const removeBtn = document.getElementById('removeEventCover');

  function setStatus(text, type='') {
    status.textContent = text || '';
    status.className = `event-cover-status${type ? ' ' + type : ''}`;
  }
  function setPreview(url) {
    preview.replaceChildren();
    if (!url) {
      const s = document.createElement('span');
      s.textContent = 'No cover selected';
      preview.appendChild(s);
      return;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Event cover preview';
    preview.appendChild(img);
  }
  async function loadExisting() {
    pendingUrl = null;
    fileInput.value = '';
    setStatus('');
    const slug = slugInput.value.trim();
    if (!slug) { existingUrl = ''; setPreview(''); return; }
    const { data } = await supabase.from('lottery_events').select('cover_image_url').eq('slug', slug).maybeSingle();
    existingUrl = data?.cover_image_url || '';
    setPreview(existingUrl);
  }
  function safeName(name) {
    return String(name || 'cover').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  async function uploadCover(file) {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { setStatus('Use JPG, PNG or WebP.', 'err'); fileInput.value=''; return; }
    if (file.size > 5 * 1024 * 1024) { setStatus('Image must be 5 MB or smaller.', 'err'); fileInput.value=''; return; }
    const { data:{session} } = await supabase.auth.getSession();
    if (!session) { setStatus('Admin login is required before uploading.', 'err'); return; }
    setStatus('Uploading cover…');
    const folder = (slugInput.value.trim() || 'event').replace(/[^a-zA-Z0-9_-]+/g,'-');
    const ext = file.name.split('.').pop()?.toLowerCase() || (file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName(file.name.replace(/\.[^.]+$/,''))}.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, file, {cacheControl:'31536000', upsert:false, contentType:file.type});
    if (error) { setStatus(error.message, 'err'); return; }
    const { data } = supabase.storage.from('event-covers').getPublicUrl(path);
    pendingUrl = data.publicUrl;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    setPreview(previewObjectUrl);
    setStatus('Cover uploaded. Save the event to apply it.', 'ok');
  }
  async function applyPendingCover() {
    if (pendingUrl === null) return;
    const slug = slugInput.value.trim();
    if (!slug) return;
    setStatus('Applying cover…');
    await new Promise(r => setTimeout(r, 220));
    const { data:event, error:findError } = await supabase.from('lottery_events').select('id').eq('slug', slug).maybeSingle();
    if (findError || !event) { setStatus(findError?.message || 'Event saved, but cover could not be linked.', 'err'); return; }
    const { error } = await supabase.rpc('admin_set_event_cover', {p_event_id:event.id,p_cover_image_url:pendingUrl});
    if (error) { setStatus(error.message, 'err'); return; }
    existingUrl = pendingUrl || '';
    pendingUrl = null;
  }

  fileInput.addEventListener('change', () => uploadCover(fileInput.files?.[0]));
  removeBtn.addEventListener('click', () => { pendingUrl=''; setPreview(''); setStatus('Cover will be removed when you save the event.'); });
  form.addEventListener('submit', () => { saveRequested = true; }, true);
  document.getElementById('cancelEventModal')?.addEventListener('click', () => { saveRequested=false; });
  document.getElementById('closeEventModal')?.addEventListener('click', () => { saveRequested=false; });
  dialog.addEventListener('cancel', () => { saveRequested=false; });
  dialog.addEventListener('close', async () => {
    if (!saveRequested) { pendingUrl=null; return; }
    saveRequested=false;
    try { await applyPendingCover(); } catch (e) { console.error(e); }
  });

  const observer = new MutationObserver(() => { if (dialog.hasAttribute('open')) setTimeout(loadExisting, 60); });
  observer.observe(dialog, {attributes:true,attributeFilter:['open']});
}
