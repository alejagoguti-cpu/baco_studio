import { workers, plan } from './assets.mjs';
import { Drive } from './drive.mjs';
import { processes, statuses, validateRoom, validatePhoto, filterRooms, escapeHTML as e, dateLabel, safeDriveLink } from './model.mjs';

const $ = selector => document.querySelector(selector);
const drive = new Drive();
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
let config = read('baco.config', {});
let state = read('baco.state', {rooms:[], records:[], rootId:'', rootName:''});
let activeRoom = null;
let view = 'habitaciones';
let roomMode = 'cards';
let syncing = false;
let uploadBusy = false;
const urls = new Map();
const worker = id => workers.find(w => w.id === id);
const workerName = id => worker(id)?.name || 'Responsable pendiente';
const options = (values, selected) => values.map(v => `<option value="${e(v)}" ${v === selected ? 'selected' : ''}>${e(v)}</option>`).join('');
const workerOptions = selected => '<option value="">Seleccionar maestro</option>' + workers.map(w => `<option value="${w.id}" ${w.id === selected ? 'selected' : ''}>${e(w.name)}</option>`).join('');
const persist = () => { localStorage.setItem('baco.state', JSON.stringify(state)); if (state.rootId) localStorage.setItem(`baco.project.${state.rootId}`, JSON.stringify(state)); };
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 6500); }
function errorToast(error) {
  const message = error.message || 'No se pudo completar la operación.';
  const dialog = document.activeElement?.closest('dialog[open]');
  if (dialog) {
    let feedback = dialog.querySelector('.dialog-feedback');
    if (!feedback) { feedback = document.createElement('p'); feedback.className = 'dialog-feedback'; feedback.setAttribute('role','alert'); dialog.append(feedback); }
    feedback.textContent = message;
  }
  toast(message);
}
const statusClass = status => ({'Pendiente':'pending','En proceso':'active','En revisión':'review','Finalizada':'done'}[status] || 'pending');
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('baco-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento de fotos de este navegador.'));
  });
  return dbPromise;
}
async function blobStore(id, action, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', action === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('photos');
    const request = action === 'put' ? store.put(value, id) : action === 'delete' ? store.delete(id) : store.get(id);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(new Error('No hay espacio suficiente para guardar esta foto.'));
  });
}
function setView(next) {
  view = next;
  const titles = {habitaciones:['Resumen de obra', 'Consulta las habitaciones, asigna responsables y documenta los procesos.', 'Habitaciones'], registro:['Registro fotográfico', 'Consulta los procesos y las evidencias de cada habitación.', 'Registro fotográfico'], equipo:['Equipo de obra', 'Personal, asignaciones y habitaciones a su cargo.', 'Equipo de obra'], plano:['Planta del proyecto', 'Consulta el plano original para orientar el seguimiento.', 'Planta de referencia']};
  const title = titles[next]; if (!title) return;
  $('#page-title').textContent = title[0]; $('#page-subtitle').textContent = title[1]; $('#breadcrumb-view').textContent = title[2];
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${next}`);
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === next));
  $('#overview').hidden = next === 'plano';
  history.replaceState(null, '', `#${next}`);
  render();
}
function avatar(id, extra = '') { const w = worker(id); return w ? `<img class="avatar ${extra}" src="${w.photo}" alt="${e(w.name)}" loading="lazy">` : ''; }
function render() {
  $('#stat-rooms').textContent = String(state.rooms.length).padStart(2, '0');
  $('#stat-active').textContent = String(state.rooms.filter(r => r.status === 'En proceso').length).padStart(2, '0');
  $('#stat-photos').textContent = String(state.records.filter(r => !r.pending).length).padStart(2, '0');
  $('#stat-photo-caption').textContent = state.records.some(r => r.pending) ? `${state.records.filter(r => r.pending).length} fotos pendientes de subir` : drive.connected ? 'Fotos consultadas en este proyecto' : 'Conecta Drive para consultar';
  $('#nav-count').textContent = state.rooms.length;
  $('#drive-status').textContent = drive.connected ? 'Drive conectado' : 'Conectar Drive';
  $('#drive-button').classList.toggle('connected', drive.connected);
  const rooms = filterRooms(state.rooms, $('#search').value, $('#status-filter').value, workers);
  $('#room-grid').innerHTML = rooms.length ? rooms.map(room => {
    const records = state.records.filter(r => r.roomId === room.id);
    return `<button class="room-card" data-room="${e(room.id)}"><div class="room-card-top"><span class="room-sector">${e(room.level)}</span><span class="badge ${statusClass(room.status)}">${e(room.status)}</span></div><div class="room-number"><small>HABITACIÓN</small><strong>${e(room.number)}</strong><span>↗</span></div><div class="room-process"><span class="process-dot"></span>${e(room.process)}</div><div class="stage-track" aria-label="Estado: ${e(room.status)}">${statuses.map((status,i) => `<span class="${i <= statuses.indexOf(room.status) ? 'reached' : ''}" title="${e(status)}"></span>`).join('')}</div><div class="room-workers">${room.workers.map(id => `<div>${avatar(id)}<span>${e(workerName(id))}</span></div>`).join('')}</div><div class="room-card-footer"><span>▧ ${records.filter(r => !r.pending).length} fotos en Drive</span><span>${room.dirty ? 'Sin sincronizar' : 'En Drive'}</span></div></button>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">⌑</div><h3>${state.rooms.length ? 'No encontramos coincidencias' : 'Tu primera habitación, el primer paso.'}</h3><p>${state.rooms.length ? 'Prueba otro número, responsable o estado.' : 'Registra el espacio y asigna a los dos maestros encargados. La numeración la defines tú.'}</p>${state.rooms.length ? '' : '<button class="button primary" id="empty-new-room">＋ Crear habitación</button>'}</div>`;
  $('#empty-new-room')?.addEventListener('click', () => editRoom());
  document.querySelectorAll('[data-room]').forEach(button => button.addEventListener('click', () => openRoom(button.dataset.room)));
  if (rooms.length && roomMode === 'list') {
    $('#room-grid').innerHTML = `<div class="room-table-wrap"><table class="room-table"><thead><tr><th>Habitación</th><th>Proceso</th><th>Responsables</th><th>Estado</th><th></th></tr></thead><tbody>${rooms.map(room => `<tr><td><strong>${e(room.number)}</strong><small>${e(room.level)}</small></td><td>${e(room.process)}</td><td><div class="table-avatars">${room.workers.map(id => avatar(id)).join('')}</div><small>${room.workers.map(id => e(workerName(id))).join('<br>')}</small></td><td><span class="badge ${statusClass(room.status)}">${e(room.status)}</span></td><td><button class="text-button" data-list-room="${e(room.id)}">Ver ↗</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (rooms.length && roomMode === 'sectors') {
    const sectors = [...new Set(rooms.map(room => room.level))];
    $('#room-grid').innerHTML = sectors.map(sector => `<section class="sector-card"><h3>${e(sector)}</h3><div class="sector-rooms">${rooms.filter(r => r.level === sector).map(room => `<button class="sector-room ${statusClass(room.status)}" data-list-room="${e(room.id)}"><strong>${e(room.number)}</strong><small>${e(room.status)}</small></button>`).join('')}</div></section>`).join('');
  }
  $('#room-grid').classList.toggle('list-mode', roomMode !== 'cards');
  document.querySelectorAll('[data-list-room]').forEach(button => button.onclick = () => openRoom(button.dataset.listRoom));
  $('#status-summary').innerHTML = statuses.map(status => {
    const count = state.rooms.filter(r => r.status === status).length;
    return `<div class="summary-status"><div><span class="summary-dot ${statusClass(status)}"></span><span>${e(status)}</span><strong>${count}</strong></div><div class="summary-track"><span class="${statusClass(status)}" style="width:${state.rooms.length ? count/state.rooms.length*100 : 0}%"></span></div></div>`;
  }).join('');
  const recent = [...state.records].sort((a,b) => b.date.localeCompare(a.date)).slice(0,4);
  $('#recent-activity').innerHTML = recent.length ? recent.map(record => `<div class="activity-item">${avatar(record.workers[0])}<div><strong>Hab. ${e(state.rooms.find(r => r.id === record.roomId)?.number || '')}</strong><p>${e(record.process)}</p><small>${e(dateLabel(record.date+'T12:00:00-05:00'))} · ${record.pending ? 'Pendiente' : 'En Drive'}</small></div></div>`).join('') : '<p class="rail-empty">Aún no hay registros.<br>Las fotos que agregues aparecerán aquí.</p>';
  $('#team-grid').innerHTML = workers.map(w => {
    const assigned = state.rooms.filter(r => r.workers.includes(w.id));
    return `<article class="team-card"><div class="portrait"><img src="${w.photo}" alt="${e(w.name)}" loading="lazy"><span class="portrait-label">EQUIPO BACO</span></div><div class="team-info"><h3>${e(w.name)}</h3><p>Personal de obra</p><div class="team-assignments">${assigned.length ? assigned.map(r => `<button class="pill" data-team-room="${e(r.id)}">Hab. ${e(r.number)}</button>`).join('') : '<span class="muted">Sin habitación asignada</span>'}</div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-team-room]').forEach(button => button.addEventListener('click', () => openRoom(button.dataset.teamRoom)));
  if (view === 'registro') renderGallery($('#global-gallery'), state.records);
}
function editRoom(id) {
  const room = state.rooms.find(r => r.id === id);
  $('#room-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#room-form'); form.reset();
  $('#room-form-title').textContent = room ? `Editar habitación ${room.number}` : 'Nueva habitación';
  for (const key of ['id','number','level','notes','status']) form.elements[key].value = room?.[key] || (key === 'status' ? 'Pendiente' : '');
  form.elements.process.innerHTML = options(processes, room?.process || processes[0]);
  form.elements.worker1.innerHTML = workerOptions(room?.workers[0]);
  form.elements.worker2.innerHTML = workerOptions(room?.workers[1]);
  $('#room-dialog').showModal();
}
$('#room-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const existing = state.rooms.find(r => r.id === data.id);
    const room = validateRoom({...existing,...data,id:data.id || crypto.randomUUID(),workers:[data.worker1,data.worker2],dirty:true,updatedAt:new Date().toISOString()}, state.rooms, workers);
    delete room.worker1; delete room.worker2;
    state.rooms = [...state.rooms.filter(r => r.id !== room.id), room]; persist();
    $('#room-dialog').close(); render();
    if (activeRoom === room.id && $('#detail-dialog').open) renderDetail();
    toast('Habitación guardada. Usa «Actualizar desde Drive» para sincronizarla.');
  } catch (error) { errorToast(error); }
});
async function openRoom(id) {
  activeRoom = id; renderDetail(); $('#detail-dialog').showModal();
  const room = state.rooms.find(r => r.id === id);
  if (drive.connected && room.folderId && !syncing) {
    try { await loadRecords(room); persist(); render(); if (activeRoom === id) renderDetail(); } catch (error) { errorToast(error); }
  }
}
function renderDetail() {
  const room = state.rooms.find(r => r.id === activeRoom); if (!room) return;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">${e(room.level)}</p><h2>Habitación ${e(room.number)}</h2></div><button class="icon-button" id="close-detail" aria-label="Cerrar">×</button></div><div class="detail-toolbar"><span class="badge ${statusClass(room.status)}">${e(room.status)}</span><button class="text-button" id="edit-detail">Editar habitación ↗</button>${room.folderId ? `<a class="text-button" href="https://drive.google.com/drive/folders/${e(room.folderId)}" target="_blank" rel="noopener noreferrer">Abrir carpeta ↗</a>` : ''}</div><div class="detail-process"><small>PROCESO ACTUAL</small><h3>${e(room.process)}</h3></div><div class="detail-workers">${room.workers.map(id => `<div>${avatar(id)}<div><small>MAESTRO ENCARGADO</small><strong>${e(workerName(id))}</strong></div></div>`).join('')}</div>${room.notes ? `<p class="room-notes">${e(room.notes)}</p>` : ''}<div class="detail-divider"></div><h3>Nuevo registro fotográfico</h3><form id="photo-form"><div class="form-row"><label>Proceso<select name="process">${options(processes, room.process)}</select></label><label>Momento<select name="stage"><option>Antes</option><option selected>Durante</option><option>Después</option></select></label></div><label>Fecha del registro<input type="date" name="date" required value="${today()}" max="${today()}"></label><label class="upload-zone" id="upload-zone"><span class="upload-symbol">↑</span><strong>Seleccionar fotos del proceso</strong><span>JPG, PNG o WebP · hasta 20 MB por foto</span><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label><div id="selected-photos" class="selected-photos"></div><label>Observaciones<textarea name="notes" maxlength="1000" placeholder="¿Qué se hizo? ¿Qué falta por resolver?"></textarea></label><div class="dialog-actions"><button type="button" id="pending-upload" class="button secondary" ${uploadBusy || syncing ? 'disabled' : ''}>Subir pendientes</button><button type="submit" class="button primary" ${uploadBusy || syncing ? 'disabled' : ''}>${drive.connected ? 'Guardar y subir fotos' : 'Guardar fotos pendientes'}</button></div><p class="form-note">${drive.connected ? 'Cada foto se marca como subida cuando Google Drive confirma la carga.' : 'Drive no está conectado. Las fotos quedarán pendientes en este dispositivo.'}</p></form><div class="section-heading"><h3>Historial de esta habitación</h3><span class="pill">${state.records.filter(r => r.roomId === room.id).length} registros</span></div><div id="room-gallery" class="gallery"></div>`;
  $('#close-detail').onclick = () => $('#detail-dialog').close();
  $('#edit-detail').onclick = () => editRoom(room.id);
  $('#pending-upload').onclick = () => uploadPending(room.id).catch(errorToast);
  $('#photo-input').onchange = event => {
    $('#selected-photos').textContent = Array.from(event.target.files).map(f => f.name).join(' · ');
  };
  const zone = $('#upload-zone');
  zone.ondragover = event => { event.preventDefault(); zone.classList.add('dragging'); };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = event => { event.preventDefault(); zone.classList.remove('dragging'); $('#photo-input').files = event.dataTransfer.files; $('#photo-input').dispatchEvent(new Event('change')); };
  $('#photo-form').onsubmit = async event => {
    event.preventDefault(); if (uploadBusy || syncing) return;
    const form = event.target;
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const files = [...$('#photo-input').files]; if (!files.length) throw new Error('Selecciona al menos una foto.');
      files.forEach(validatePhoto);
      const data = Object.fromEntries(new FormData(form));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date > today()) throw new Error('Selecciona una fecha válida, hasta hoy.');
      for (const file of files) {
        const record = {id:crypto.randomUUID(),roomId:room.id,process:data.process,date:data.date,stage:data.stage,notes:data.notes,workers:[...room.workers],pending:true,originalName:file.name};
        await blobStore(record.id, 'put', file);
        state.records.push(record); persist();
      }
      render(); renderDetail();
      if (drive.connected) await uploadPending(room.id);
      else toast(`${files.length} fotos guardadas como pendientes en este dispositivo.`);
    } catch (error) { errorToast(error); }
    finally { if (submit.isConnected) submit.disabled = false; }
  };
  renderGallery($('#room-gallery'), state.records.filter(r => r.roomId === room.id));
}
async function recordImage(record) {
  if (urls.has(record.id)) return urls.get(record.id);
  const blob = record.pending ? await blobStore(record.id, 'get') : drive.connected ? await drive.image(record.fileId) : null;
  if (!blob) return '';
  const url = URL.createObjectURL(blob); urls.set(record.id, url); return url;
}
function renderGallery(container, records) {
  if (!records.length) { container.innerHTML = '<div class="empty-state compact"><div class="empty-icon">▧</div><h3>El avance todavía está por documentar.</h3><p>Abre una habitación para añadir las primeras fotos del proceso.</p></div>'; return; }
  const sorted = [...records].sort((a,b) => b.date.localeCompare(a.date));
  container.innerHTML = sorted.map(record => {
    const room = state.rooms.find(r => r.id === record.roomId);
    return `<article class="photo-card"><button class="photo-image" data-photo="${e(record.id)}" aria-label="Ver foto de habitación ${e(room?.number || '')}"><span>Cargando foto…</span><img data-record-image="${e(record.id)}" alt="${e(record.process)} · ${e(record.stage)}" hidden loading="lazy"></button><div class="photo-info"><div><span class="badge ${record.pending ? 'pending' : 'done'}">${record.pending ? 'Pendiente de subir' : 'En Drive'}</span><small>${e(record.stage)}</small></div><h4>Hab. ${e(room?.number || '')} · ${e(record.process)}</h4><p>${e(dateLabel(record.date+'T12:00:00-05:00'))}</p><p class="photo-workers">${record.workers.map(id => e(workerName(id))).join(' · ')}</p>${record.notes ? `<p>${e(record.notes)}</p>` : ''}${!record.pending ? `<a class="text-button" href="${safeDriveLink(record.fileId)}" target="_blank" rel="noopener noreferrer">Ver en Drive ↗</a>` : ''}</div></article>`;
  }).join('');
  sorted.forEach(async record => {
    const img = [...container.querySelectorAll('[data-record-image]')].find(el => el.dataset.recordImage === record.id);
    try {
      const src = await recordImage(record); if (!img.isConnected) return;
      if (src) { img.src = src; img.hidden = false; img.previousElementSibling.hidden = true; }
      else img.previousElementSibling.textContent = 'Conecta Drive para ver esta foto';
    } catch { if (img.isConnected) img.previousElementSibling.textContent = 'No se pudo cargar. Actualiza Drive.'; }
  });
  container.querySelectorAll('[data-photo]').forEach(button => button.onclick = () => {
    const record = records.find(r => r.id === button.dataset.photo);
    if (!record.pending) window.open(safeDriveLink(record.fileId), '_blank', 'noopener,noreferrer');
    else {
      const src = urls.get(record.id); if (src) {
        const dialog = document.createElement('dialog'); dialog.className = 'lightbox';
        const image = document.createElement('img'); image.src = src; image.alt = record.process;
        const close = document.createElement('button'); close.className = 'button secondary'; close.textContent = 'Cerrar'; close.onclick = () => dialog.close();
        dialog.append(image, close); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
      }
    }
  });
}
async function ensureRoot() {
  if (!state.rootId) {
    const folder = await drive.folder('Baco Studio · Registro de obra', null, {bacoKind:'project'});
    state.rootId = folder.id; state.rootName = folder.name; persist();
  } else await drive.checkFolder(state.rootId);
}
async function syncRoom(room) {
  room.folderId = await drive.saveRoom(room, state.rootId); room.dirty = false; persist();
}
async function loadRecords(room) {
  const remote = await drive.records(room);
  const map = new Map(state.records.filter(r => r.roomId === room.id).map(r => [r.id,r]));
  for (const record of remote) {
    if (!record.id || !processes.includes(record.process) || !Array.isArray(record.workers) || !record.workers.every(id => worker(id)) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue;
    if (map.get(record.id)?.pending) await blobStore(record.id, 'delete');
    map.set(record.id,record);
  }
  state.records = [...state.records.filter(r => r.roomId !== room.id),...map.values()];
}
async function synchronize() {
  if (syncing || uploadBusy) return;
  syncing = true; $('#sync-button').disabled = true;
  try {
    await ensureRoot();
    for (const room of state.rooms.filter(r => r.dirty || !r.folderId)) await syncRoom(room);
    const remote = await drive.list(state.rootId, 'room');
    for (const folder of remote) {
      let room;
      try { room = JSON.parse(folder.description); if (!room.id) continue; room = validateRoom(room, [], workers); } catch { continue; }
      state.rooms = [...state.rooms.filter(r => r.id !== room.id), {...room,folderId:folder.id,dirty:false}];
    }
    for (const room of state.rooms.filter(r => r.folderId)) await loadRecords(room);
    persist(); toast('Habitaciones y registros actualizados desde Drive.');
  } finally { syncing = false; $('#sync-button').disabled = false; render(); if ($('#detail-dialog').open) renderDetail(); }
}
async function uploadPending(roomId) {
  if (uploadBusy || syncing) return;
  if (!drive.connected) throw new Error('Conecta Google Drive para subir las fotos pendientes.');
  uploadBusy = true; renderDetail();
  let count = 0;
  try {
    await ensureRoot();
    for (const record of state.records.filter(r => r.pending && (!roomId || r.roomId === roomId))) {
      const room = state.rooms.find(r => r.id === record.roomId); if (!room) continue;
      if (room.dirty || !room.folderId) await syncRoom(room);
      const blob = await blobStore(record.id, 'get');
      if (!blob) throw new Error('No se encontró la foto pendiente en este navegador. Selecciona el archivo nuevamente.');
      const uploaded = await drive.upload(record, blob, room);
      record.fileId = uploaded.id; record.pending = false; persist(); await blobStore(record.id, 'delete'); count++;
    }
    toast(count ? `${count} fotos subidas y confirmadas en Google Drive.` : 'No hay fotos pendientes para subir.');
  } finally { uploadBusy = false; render(); if ($('#detail-dialog').open) renderDetail(); }
}
function openDriveSettings() {
  $('#drive-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#drive-form');
  ['clientId','apiKey','appId'].forEach(key => form.elements[key].value = config[key] || '');
  $('#connection-info').textContent = state.rootName ? `Carpeta actual: ${state.rootName}` : 'Al conectar, se creará una carpeta del proyecto. También puedes elegir una existente.';
  $('#drive-dialog').showModal();
}
$('#drive-form').onsubmit = async event => {
  event.preventDefault();
  const submit = event.target.querySelector('[type="submit"]');
  try {
    const nextConfig = Object.fromEntries(new FormData(event.target));
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(nextConfig.clientId.trim())) throw new Error('Indica un ID de cliente OAuth válido de Google.');
    config = {...nextConfig,clientId:nextConfig.clientId.trim()}; localStorage.setItem('baco.config', JSON.stringify(config));
    submit.disabled = true; await drive.connect(config.clientId); $('#drive-dialog').close();
    await synchronize();
  } catch (error) { errorToast(error); }
  finally { submit.disabled = false; render(); }
};
$('#disconnect-button').onclick = () => {
  if (syncing || uploadBusy) return toast('Espera a que termine la operación de Drive.');
  drive.disconnect();
  for (const record of state.records.filter(r => !r.pending)) { const url = urls.get(record.id); if (url) URL.revokeObjectURL(url); urls.delete(record.id); }
  $('#drive-dialog').close(); render(); if ($('#detail-dialog').open) renderDetail(); toast('Sesión de Drive desconectada en este dispositivo.');
};
$('#pick-folder').onclick = async () => {
  try {
    if (syncing || uploadBusy) throw new Error('Espera a que termine la operación actual.');
    const pickerConfig = Object.fromEntries(new FormData($('#drive-form')));
    config = pickerConfig; localStorage.setItem('baco.config', JSON.stringify(config));
    if (!drive.connected) await drive.connect(config.clientId);
    const folder = await drive.pickFolder(config); if (!folder) return;
    const checked = await drive.checkFolder(folder.id);
    if (state.rootId !== folder.id) {
      persist();
      if (state.rootId) state = read(`baco.project.${folder.id}`, {rooms:[],records:[],rootId:folder.id,rootName:checked.name});
      else { state.rootId = folder.id; state.rootName = checked.name; }
      activeRoom = null; if ($('#detail-dialog').open) $('#detail-dialog').close();
    }
    state.rootName = checked.name; persist(); $('#drive-dialog').close(); await synchronize();
  } catch (error) { errorToast(error); }
};
$('#sync-button').onclick = () => synchronize().catch(errorToast);
$('#new-room').onclick = () => editRoom();
$('#drive-button').onclick = openDriveSettings;
$('#rail-connect').onclick = openDriveSettings;
document.querySelectorAll('[data-room-mode]').forEach(button => button.onclick = () => { roomMode = button.dataset.roomMode; document.querySelectorAll('[data-room-mode]').forEach(b => b.classList.toggle('selected', b === button)); render(); });
$('#show-plan').onclick = $('#plan-preview').onclick = () => setView('plano');
$('#search').oninput = render;
$('#status-filter').onchange = render;
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view));
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#plan-image').src = $('#full-plan-image').src = $('#download-plan').href = plan;
$('#export-button').onclick = () => {
  const blob = new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `baco-studio-respaldo-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  toast('Respaldo de habitaciones y metadatos exportado. Las fotos pendientes permanecen en este dispositivo.');
};
setInterval(() => { if (!drive.connected && $('#drive-button').classList.contains('connected')) render(); }, 30000);
setView(['habitaciones','registro','equipo','plano'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'habitaciones');
