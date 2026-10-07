import { workers as baseWorkers, plan } from './assets.mjs?v=20261007e';
import { Drive } from './drive.mjs?v=20261007e';
import { enhanceSelects, syncSelects } from './select.mjs?v=20261007e';
import { processes, statuses, taskStatuses, priorities, validateTask, sortTasks, orderStatuses, paymentStatuses, paymentStatus, balance, parseMoney, validateMaterial, materialStats, validateWorker, validateMilestone, validateProcessName, validateGoal, validateActivity, upsertActivity, activityOn, lastActivity, daysBetween, nextMilestone, validateRoom, validatePhoto, filterRooms, escapeHTML as e, dateLabel, safeDriveLink } from './model.mjs?v=20261007e';

const $ = selector => document.querySelector(selector);
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () { nativeShowModal.call(this); syncSelects(this); };
const drive = new Drive();
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
let config = read('baco.config', {});
let state = read('baco.state', {rooms:[], records:[], rootId:'', rootName:''});
function ensureState() { state.tasks ||= []; state.materials ||= []; state.customWorkers ||= []; state.removedWorkers ||= []; state.workerEdits ||= {}; state.workerArchive ||= {}; state.milestones ||= []; state.goals ||= {}; state.customProcesses ||= []; state.plans ||= {}; }
ensureState();
let workers = [];
function refreshWorkers() { workers = [...baseWorkers.filter(w => !state.removedWorkers.includes(w.id)).map(w => ({role:'Personal de obra', ...w, ...(state.workerEdits[w.id] || {})})), ...state.customWorkers]; }
refreshWorkers();
let materialScope = 'all';
let materialRequester = 'all';
let materialPage = 1;
const materialSelected = new Set();
let activeRoom = null;
let taskScope = 'all';
let view = 'inicio';
let roomMode = 'cards';
let syncing = false;
let uploadBusy = false;
const urls = new Map();
const allProcesses = () => [...processes, ...state.customProcesses];
const worker = id => workers.find(w => w.id === id) || state.workerArchive[id];
const initials = name => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const photoOf = w => w?.photo || `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#f1ede9'/><text x='32' y='40' font-family='Arial' font-size='24' font-weight='700' fill='#6e655e' text-anchor='middle'>${initials(w?.name).replace(/[<&]/g, '')}</text></svg>`)}`;
const cop = n => new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0}).format(n || 0);
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
const icon = id => `<svg><use href="#i-${id}"/></svg>`;
const statusIcon = {pending:'clock', active:'sync', review:'eye', done:'check'};
const selected = new Set();
const pad = n => String(n).padStart(2, '0');
function bars(container, values) {
  const max = Math.max(...values, 0);
  container.innerHTML = values.map(v => `<span class="${v ? '' : 'zero'}" style="height:${max ? Math.max(12, v / max * 100) : 12}%"></span>`).join('');
}
function setRoomMode(mode) {
  roomMode = mode;
  document.querySelectorAll('[data-room-mode]').forEach(b => b.classList.toggle('selected', b.dataset.roomMode === mode));
  if (mode !== 'list') selected.clear();
}
function closeNav() { document.body.classList.remove('nav-open'); $('#scrim').hidden = true; }
function setView(next) {
  view = next;
  const titles = {reportes:['Reportes de obra', 'Avance, gastos y desempeño del equipo en un solo lugar.', 'Reportes'], materiales:['Materiales y pedidos', 'Controla qué falta por pedir, qué llegó y cuánto se debe.', 'Materiales'], tareas:['Tus tareas asignadas', 'Anótalas y complétalas para mantener la obra al día.', 'Tareas'], inicio:['Inicio', 'Objetivo del día y entregas de la obra.', 'Inicio'], habitaciones:['Habitaciones', 'Asigna responsables y procesos, y documenta el avance de cada espacio.', 'Habitaciones'], registro:['Registro fotográfico', 'Consulta los procesos y las evidencias de cada habitación.', 'Registro fotográfico'], equipo:['Equipo de obra', 'Monitorea al personal, sus asignaciones y el avance de sus habitaciones.', 'Equipo de obra'], planos:['Planos', 'Arquitectónico, eléctrico, hidráulico y federado.', 'Planos'], plano:['Planos', 'Arquitectónico, eléctrico, hidráulico y federado.', 'Planos']};
  const title = titles[next]; if (!title) return;
  $('#page-title').textContent = title[0]; $('#page-subtitle').textContent = title[1]; $('#breadcrumb-view').textContent = title[2];
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${next}`);
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === next));
  $('#rooms-toggle').classList.toggle('active', ['habitaciones','planos','plano'].includes(next));
  if (['habitaciones','planos','plano'].includes(next)) $('#rooms-group').classList.add('open');
  document.querySelectorAll('.sub-item[data-view]').forEach(b => b.classList.toggle('selected', b.dataset.view === next || (next === 'plano' && b.dataset.view === 'planos')));
  $('#overview').hidden = ['plano','planos','tareas','materiales','reportes','inicio','habitaciones'].includes(next);
  $('#heading-action').hidden = ['plano','planos','reportes'].includes(next);
  $('#heading-action').lastChild.textContent = {inicio:'Nueva entrega', tareas:'Nueva tarea', materiales:'Nuevo pedido', equipo:'Agregar trabajador'}[next] || 'Nueva habitación';
  $('#materials-toggle').classList.toggle('active', next === 'materiales');
  $('#tasks-toggle').classList.toggle('active', next === 'tareas');
  if (next === 'tareas') $('#tasks-group').classList.add('open');
  history.replaceState(null, '', `#${next}`);
  document.body.dataset.view = next;
  closeNav();
  render();
}
function avatar(id, extra = '') { const w = worker(id); return w ? `<img class="avatar ${extra}" src="${photoOf(w)}" alt="${e(w.name)}" loading="lazy">` : ''; }
function renderCore() {
  const total = state.rooms.length;
  const countBy = status => state.rooms.filter(r => r.status === status).length;
  const uploaded = state.records.filter(r => !r.pending);
  const pendingPhotos = state.records.filter(r => r.pending).length;
  $('#stat-rooms').textContent = pad(total);
  $('#stat-active').textContent = pad(countBy('En proceso'));
  $('#stat-photos').textContent = pad(uploaded.length);
  bars($('#bars-rooms'), statuses.map(countBy));
  bars($('#bars-process'), allProcesses().map(p => state.rooms.filter(r => r.process === p && r.status !== 'Finalizada').length));
  bars($('#bars-photos'), allProcesses().map(p => uploaded.filter(r => r.process === p).length));
  $('#stat-photo-caption').textContent = pendingPhotos ? `${pendingPhotos} fotos pendientes de subir` : drive.connected ? 'Fotos consultadas en este proyecto' : 'Conecta Drive para consultar';
  renderClock();
  const goal = state.goals[today()]?.text;
  $('#goal-today-text').textContent = goal || 'Aún no defines el objetivo de hoy.';
  $('#goal-today-text').classList.toggle('goal-empty', !goal);
  $('#goal-edit').firstChild.textContent = goal ? 'Cambiar objetivo ' : 'Definir objetivo ';
  $('#goal-date').textContent = longDate(today());
  const progress = total ? Math.round(state.rooms.reduce((sum, r) => sum + statuses.indexOf(r.status), 0) / (total * (statuses.length - 1)) * 100) : 0;
  $('#pending-pill').hidden = !pendingPhotos; $('#pending-pill').textContent = `${pendingPhotos} pendientes`;
  $('#nav-count').textContent = total;
  $('#drive-status').textContent = drive.connected ? 'Drive conectado' : 'Conectar Drive';
  $('#drive-button').classList.toggle('connected', drive.connected);

  const rooms = filterRooms(state.rooms, $('#search').value, $('#status-filter').value, workers);
  $('#rooms-count').textContent = rooms.length;
  $('#rooms-sub').textContent = roomMode === 'sectors' ? 'Mapa de habitaciones agrupadas por piso o sector.' : roomMode === 'list' ? `Mostrando ${rooms.length} de ${total} habitaciones.` : 'Asignaciones y estado de cada espacio.';
  for (const id of [...selected]) if (!rooms.some(r => r.id === id)) selected.delete(id);
  const grid = $('#room-grid');
  if (!rooms.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('room')}</div><h3>${total ? 'No encontramos coincidencias' : 'Tu primera habitación, el primer paso.'}</h3><p>${total ? 'Prueba otro número, responsable o estado.' : 'Registra el espacio y asigna a los dos maestros encargados. La numeración la defines tú.'}</p>${total ? '' : `<button class="button primary" id="empty-new-room">${icon('plus')}Crear habitación</button>`}</div>`;
    $('#empty-new-room')?.addEventListener('click', () => editRoom());
  } else if (roomMode === 'list') {
    const all = rooms.every(r => selected.has(r.id));
    grid.innerHTML = `<div class="room-table-wrap"><table class="room-table"><thead><tr><th><input type="checkbox" class="check" id="check-all" aria-label="Seleccionar todas" ${all ? 'checked' : ''}></th><th>Habitación</th><th>Proceso</th><th>Responsables</th><th>Estado</th><th>Drive</th><th>Fotos</th><th></th></tr></thead><tbody>${rooms.map(room => {
      const cls = statusClass(room.status); const photos = state.records.filter(r => r.roomId === room.id && !r.pending).length;
      return `<tr class="${selected.has(room.id) ? 'checked' : ''}"><td><input type="checkbox" class="check" data-select="${e(room.id)}" aria-label="Seleccionar habitación ${e(room.number)}" ${selected.has(room.id) ? 'checked' : ''}></td><td><strong>${e(room.number)}</strong><small>${e(room.level)}</small></td><td>${e(room.process)}</td><td><div class="table-avatars">${room.workers.map(id => avatar(id)).join('')}</div><small>${room.workers.map(id => e(workerName(id))).join('<br>')}</small></td><td><span class="status-cell"><span class="status-icon ${cls}">${icon(statusIcon[cls])}</span>${e(room.status)}</span></td><td><span class="prio ${room.dirty ? 'n2' : 'n3'}">${room.dirty ? 'Sin sincronizar' : 'En Drive'}</span></td><td>${photos}</td><td><button class="small-btn" data-list-room="${e(room.id)}">Ver ${icon('arrow')}</button></td></tr>`;
    }).join('')}</tbody></table></div><div class="table-foot"><span>Mostrando ${rooms.length} de ${total} habitaciones</span><span>${selected.size} seleccionadas</span></div>`;
    const checkAll = $('#check-all'); checkAll.indeterminate = !all && rooms.some(r => selected.has(r.id));
    checkAll.onchange = () => { rooms.forEach(r => checkAll.checked ? selected.add(r.id) : selected.delete(r.id)); render(); };
    grid.querySelectorAll('[data-select]').forEach(box => box.onchange = () => { box.checked ? selected.add(box.dataset.select) : selected.delete(box.dataset.select); render(); });
  } else if (roomMode === 'sectors') {
    const sectors = [...new Set(rooms.map(room => room.level))];
    const legend = `<div class="legend">${statuses.map(s => `<span class="${statusClass(s)}"><i></i>${e(s)}</span>`).join('')}</div>`;
    grid.innerHTML = sectors.map(sector => `<section class="sector-card"><div class="sector-head"><h3>${e(sector)}</h3>${legend}</div><div class="sector-rooms">${rooms.filter(r => r.level === sector).map(room => `<button class="sector-room ${statusClass(room.status)}" data-list-room="${e(room.id)}" aria-label="Habitación ${e(room.number)}, ${e(room.status)}">${e(room.number)}<span class="tip"><b>Habitación</b>${e(room.number)}<br><b>Proceso</b>${e(room.process)}<br><b>Estado</b>${e(room.status)}<br><b>Fotos</b>${state.records.filter(r => r.roomId === room.id).length}</span></button>`).join('')}</div></section>`).join('');
  } else {
    grid.innerHTML = rooms.map(room => {
      const records = state.records.filter(r => r.roomId === room.id);
      const step = statuses.indexOf(room.status) + 1;
      const act = activityOn(room, today()), last = act ? null : lastActivity(room, today());
      const crew = act ? act.workers : room.workers;
      return `<article class="room-card"><div class="room-card-top"><span class="room-tile">${e(room.number)}</span><div class="room-title"><strong>Habitación ${e(room.number)}</strong><span>${e(room.level)} · ${records.filter(r => !r.pending).length} fotos · ${room.dirty ? 'Sin sincronizar' : 'En Drive'}</span></div><span class="badge ${statusClass(room.status)}">${e(room.status)}</span></div><div class="room-progress"><div><span>Avance de etapa</span><span><b>${step}/${statuses.length}</b></span></div><div class="stage-track" aria-label="Estado: ${e(room.status)}">${statuses.map((status,i) => `<span class="${i < step ? 'reached' : ''}" title="${e(status)}"></span>`).join('')}</div></div><div class="room-today ${act ? '' : 'empty'}"><div class="room-today-head"><small>HOY · ${e(shortDate(today()))}</small><button class="text-button" data-activity="${e(room.id)}">${act ? `${icon('edit')}Cambiar` : '+ Anotar actividad'}</button></div><strong>${act ? e(act.activity) : 'Sin actividad registrada'}</strong>${act?.notes ? `<span>${e(act.notes)}</span>` : last ? `<span>Última: ${e(shortDate(last.date))} · ${e(last.activity)}</span>` : ''}</div><div class="room-workers">${crew.map(id => `<div>${avatar(id)}<span>${e(workerName(id))}</span></div>`).join('')}</div><div class="room-card-footer"><button class="text-button" data-room="${e(room.id)}">Ver detalles</button><button class="small-btn" data-edit-room="${e(room.id)}">Editar</button><button class="small-btn indigo" data-room="${e(room.id)}">${icon('camera')}Fotos</button></div></article>`;
    }).join('');
  }
  grid.classList.toggle('list-mode', roomMode !== 'cards' && rooms.length > 0);
  grid.querySelectorAll('[data-room]').forEach(button => button.onclick = () => openRoom(button.dataset.room));
  grid.querySelectorAll('[data-activity]').forEach(button => button.onclick = () => editActivity(button.dataset.activity));
  grid.querySelectorAll('[data-edit-room]').forEach(button => button.onclick = () => editRoom(button.dataset.editRoom));
  grid.querySelectorAll('[data-list-room]').forEach(button => button.onclick = () => openRoom(button.dataset.listRoom));
  $('#selection-bar').hidden = !(view === 'habitaciones' && roomMode === 'list' && selected.size);
  $('#selection-count').textContent = selected.size;

  const max = Math.max(...statuses.map(countBy), 1);
  $('#nav-team-count').textContent = $('#team-count').textContent = workers.length;
  $('#team-grid').innerHTML = workers.length ? workers.map(w => {
    const assigned = state.rooms.filter(r => r.workers.includes(w.id));
    const done = assigned.filter(r => r.status === 'Finalizada').length;
    return `<article class="team-card"><div class="team-top"><div class="team-photo"><img src="${photoOf(w)}" alt="${e(w.name)}" loading="lazy"><span class="role-tag">${e((w.role || 'Obra').split(' ')[0])}</span></div><div><h3>${e(w.name)}</h3><p>${assigned.length ? `${assigned.length} ${assigned.length === 1 ? 'habitación' : 'habitaciones'}` : e(w.role || 'Personal de obra')}<span class="badge ${assigned.length ? 'active' : 'off'}">${assigned.length ? 'Asignado' : 'Libre'}</span></p>${w.phone ? `<p class="team-phone">${e(w.phone)}</p>` : ''}</div></div><div class="team-load"><div><span>Habitaciones finalizadas</span><span><b>${done}/${assigned.length}</b></span></div><div class="stage-track">${assigned.length ? assigned.map(r => `<span class="${r.status === 'Finalizada' ? 'reached' : ''}"></span>`).join('') : '<span></span>'}</div></div><div class="team-assignments">${assigned.length ? assigned.map(r => `<button class="pill" data-team-room="${e(r.id)}">Hab. ${e(r.number)}</button>`).join('') : '<span class="muted">Sin habitación asignada</span>'}<button class="small-btn team-edit" data-worker-edit="${e(w.id)}">${icon('edit')}Editar</button></div></article>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">${icon('users')}</div><h3>Aún no hay personal</h3><p>Agrega a las personas de la obra para asignarlas a las habitaciones.</p></div>`;
  document.querySelectorAll('[data-worker-edit]').forEach(b => b.onclick = () => editWorker(b.dataset.workerEdit));
  document.querySelectorAll('[data-team-room]').forEach(button => button.addEventListener('click', () => openRoom(button.dataset.teamRoom)));
  if (view === 'registro') renderGallery($('#global-gallery'), state.records);
}
function safely(name, fn) {
  try { const out = fn(); if (out?.catch) out.catch(error => console.error(`[Baco Studio] ${name}`, error)); }
  catch (error) { console.error(`[Baco Studio] ${name}`, error); }
}
// Pone el nombre de cada columna en sus celdas para que, en celular y tablet, la tabla se vea como tarjetas.
function labelTables(root = document) {
  for (const table of root.querySelectorAll('table.room-table')) {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr')) [...row.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; else td.removeAttribute('data-label'); });
  }
}
function render() {
  for (const [name, fn] of [['resumen', renderCore], ['tareas', renderTasks], ['materiales', renderMaterials], ['reportes', renderReports], ['entregas', renderMilestones], ['planos', renderPlans], ['listas', () => enhance(document)], ['tablas', labelTables]]) safely(name, fn);
}

const priorityClass = p => ({Alta:'n0', Media:'n1', Baja:'n2'}[p] || 'n1');
const taskStatusClass = s => ({'Pendiente':'pending', 'En progreso':'active', 'Completada':'done'}[s] || 'pending');
const timeLabel = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${String((h % 12) || 12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${h < 12 ? 'a. m.' : 'p. m.'}`; };
function scopedTasks() { return taskScope === 'today' ? state.tasks.filter(t => t.date === today()) : state.tasks; }
function filteredTasks() {
  const normalize = v => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = normalize($('#task-search').value.trim());
  const status = $('#task-status-filter').value, priority = $('#task-priority-filter').value;
  return sortTasks(scopedTasks().filter(t => (status === 'all' || t.status === status) && (priority === 'all' || t.priority === priority) && normalize([t.title, t.notes, state.rooms.find(r => r.id === t.roomId)?.number, workerName(t.workerId)].join(' ')).includes(q)));
}
function renderTasks() {
  const open = state.tasks.filter(t => t.status !== 'Completada').length;
  $('#nav-task-count').textContent = open;
  document.querySelectorAll('[data-task-scope]').forEach(b => b.classList.toggle('selected', view === 'tareas' && b.dataset.taskScope === taskScope));
  if (view !== 'tareas') return;
  const scoped = scopedTasks();
  $('#task-done-count').textContent = scoped.filter(t => t.status === 'Completada').length;
  $('#task-total-count').textContent = scoped.length;
  const tasks = filteredTasks();
  $('#task-table').innerHTML = tasks.length ? `<div class="room-table-wrap"><table class="room-table task-table"><thead><tr><th><span class="sr-only">Hecha</span></th><th>Tarea</th><th>Estado</th><th>Prioridad</th><th>Habitación</th><th>Responsable</th><th>Fecha límite</th><th></th></tr></thead><tbody>${tasks.map(t => {
    const room = state.rooms.find(r => r.id === t.roomId); const done = t.status === 'Completada'; const cls = taskStatusClass(t.status);
    return `<tr class="${done ? 'task-done' : ''}"><td><input type="checkbox" class="check" data-task-done="${e(t.id)}" aria-label="Marcar «${e(t.title)}» como completada" ${done ? 'checked' : ''}></td><td><strong class="task-title">${e(t.title)}</strong>${t.notes ? `<small>${e(t.notes)}</small>` : ''}</td><td><span class="status-cell"><span class="status-icon ${cls}">${icon(done ? 'check' : cls === 'active' ? 'sync' : 'clock')}</span>${e(t.status)}</span></td><td><span class="prio ${priorityClass(t.priority)}">${e(t.priority)}</span></td><td>${room ? `<button class="pill" data-task-room="${e(room.id)}">Hab. ${e(room.number)}</button>` : '<span class="muted">—</span>'}</td><td>${t.workerId ? `<span class="task-worker">${avatar(t.workerId)}<span>${e(workerName(t.workerId))}</span></span>` : '<span class="muted">—</span>'}</td><td class="${!done && t.date < today() ? 'overdue' : ''}"><strong>${e(timeLabel(t.time) || 'Sin hora')}</strong><small>${e(dateLabel(t.date + 'T12:00:00-05:00'))}${!done && t.date < today() ? ' · Vencida' : ''}</small></td><td><button class="small-btn" data-task-edit="${e(t.id)}">${icon('edit')}Editar</button></td></tr>`;
  }).join('')}</tbody></table></div>` : `<div class="empty-state compact"><div class="empty-icon">${icon('task')}</div><h3>${scoped.length ? 'No hay tareas con esos filtros' : taskScope === 'today' ? 'No tienes tareas para hoy' : 'Anota tu primera asignación'}</h3><p>${scoped.length ? 'Prueba otra búsqueda, estado o prioridad.' : 'Escribe la tarea, su prioridad, el responsable y la hora límite.'}</p>${scoped.length ? '' : `<button class="button primary" id="empty-new-task">${icon('plus')}Nueva tarea</button>`}</div>`;
  $('#empty-new-task')?.addEventListener('click', () => editTask());
  document.querySelectorAll('[data-task-done]').forEach(box => box.onchange = () => {
    const task = state.tasks.find(t => t.id === box.dataset.taskDone);
    task.status = box.checked ? 'Completada' : 'Pendiente'; task.completedAt = box.checked ? new Date().toISOString() : ''; task.updatedAt = new Date().toISOString();
    persist(); render();
  });
  document.querySelectorAll('[data-task-edit]').forEach(b => b.onclick = () => editTask(b.dataset.taskEdit));
  document.querySelectorAll('[data-task-room]').forEach(b => b.onclick = () => openRoom(b.dataset.taskRoom));
  const todays = state.tasks.filter(t => t.date === today());
  const doneToday = todays.filter(t => t.status === 'Completada').length;
  $('#task-today-percent').textContent = `${todays.length ? Math.round(doneToday / todays.length * 100) : 0}%`;
  $('#task-today-date').textContent = dateLabel(new Date().toISOString());
  if (state.goals[today()]?.text) $('#task-praise').textContent = `Objetivo de hoy: ${state.goals[today()].text}`; else $('#task-praise').textContent = !todays.length ? 'Anota tus asignaciones del día y márcalas al terminarlas.' : doneToday === todays.length ? '¡Buen trabajo! Completaste todas las tareas de hoy.' : `Te ${todays.length - doneToday === 1 ? 'queda 1 tarea' : `quedan ${todays.length - doneToday} tareas`} por completar hoy.`;
  $('#task-targets').innerHTML = priorities.map(p => {
    const list = todays.filter(t => t.priority === p); const done = list.filter(t => t.status === 'Completada').length;
    return `<div class="target-row"><div><strong>${done}</strong><span>/${list.length}</span><small>Prioridad ${e(p.toLowerCase())}</small></div><div class="target-track"><span class="${priorityClass(p)}" style="width:${list.length ? done / list.length * 100 : 0}%"></span></div></div>`;
  }).join('');
}
function editTask(id) {
  const task = state.tasks.find(t => t.id === id);
  $('#task-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#task-form'); form.reset();
  $('#task-form-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  form.elements.roomId.innerHTML = '<option value="">Sin habitación</option>' + [...state.rooms].sort((a, b) => a.number.localeCompare(b.number, 'es', {numeric:true})).map(r => `<option value="${e(r.id)}">Hab. ${e(r.number)} · ${e(r.level)}</option>`).join('');
  form.elements.workerId.innerHTML = '<option value="">Sin responsable</option>' + workers.map(w => `<option value="${w.id}">${e(w.name)}</option>`).join('');
  const values = task || {id:'', title:'', priority:'Media', status:'Pendiente', date: today(), time:'', roomId: activeRoom && $('#detail-dialog').open ? activeRoom : '', workerId:'', notes:''};
  for (const key of ['id','title','priority','status','date','time','roomId','workerId','notes']) form.elements[key].value = values[key] || '';
  $('#task-delete').hidden = !task; $('#task-delete').dataset.confirm = '';  $('#task-delete').textContent = 'Eliminar';
  $('#task-dialog').showModal();
}
$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const existing = state.tasks.find(t => t.id === data.id);
    const task = validateTask({...existing, ...data, id: data.id || crypto.randomUUID(), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: data.status === 'Completada' ? existing?.completedAt || new Date().toISOString() : ''}, state.rooms, workers);
    state.tasks = [...state.tasks.filter(t => t.id !== task.id), task]; persist();
    $('#task-dialog').close();
    if (view !== 'tareas') setView('tareas'); else render();
    toast(existing ? 'Tarea actualizada.' : 'Tarea anotada.');
  } catch (error) { errorToast(error); }
});
$('#task-delete').onclick = () => {
  const button = $('#task-delete');
  if (!button.dataset.confirm) { button.dataset.confirm = '1'; button.textContent = '¿Eliminar? Confirmar'; return; }
  const id = $('#task-form').elements.id.value;
  state.tasks = state.tasks.filter(t => t.id !== id); persist(); $('#task-dialog').close(); render(); toast('Tarea eliminada.');
};

// ---------- Equipo de obra ----------
let workerPhoto = '';
function setWorkerPhoto(src, name) {
  workerPhoto = src || '';
  $('#worker-photo-preview').hidden = !workerPhoto; if (workerPhoto) $('#worker-photo-preview').src = workerPhoto;
  $('#worker-initials').hidden = !!workerPhoto; $('#worker-initials').textContent = initials(name) || '?';
  $('#worker-photo-clear').hidden = !workerPhoto;
}
function editWorker(id) {
  const w = workers.find(x => x.id === id);
  $('#worker-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#worker-form'); form.reset();
  $('#worker-form-title').textContent = w ? 'Editar trabajador' : 'Agregar trabajador';
  for (const key of ['id','name','role','phone']) form.elements[key].value = w?.[key] || '';
  if (w?.role === 'Personal de obra') form.elements.role.value = '';
  setWorkerPhoto(w?.photo || '', w?.name);
  $('#worker-delete').hidden = !w; $('#worker-delete').dataset.confirm = ''; $('#worker-delete').textContent = 'Eliminar';
  $('#worker-dialog').showModal();
}
$('#worker-form').elements.name.addEventListener('input', event => { if (!workerPhoto) $('#worker-initials').textContent = initials(event.target.value) || '?'; });
$('#worker-photo').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Usa una foto JPG, PNG o WebP de hasta 15 MB.');
    const bitmap = await createImageBitmap(file);
    const size = 240, scale = Math.max(size / bitmap.width, size / bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    canvas.getContext('2d').drawImage(bitmap, (size - bitmap.width * scale) / 2, (size - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    setWorkerPhoto(canvas.toDataURL('image/jpeg', 0.82), $('#worker-form').elements.name.value);
  } catch (error) { errorToast(error.message ? error : new Error('No se pudo leer la foto.')); }
  event.target.value = '';
};
$('#worker-photo-clear').onclick = () => setWorkerPhoto('', $('#worker-form').elements.name.value);
$('#worker-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const isBase = baseWorkers.some(w => w.id === data.id);
    const w = validateWorker({...data, id: data.id || `worker-${crypto.randomUUID()}`, photo: workerPhoto}, workers);
    if (isBase) state.workerEdits[w.id] = {name: w.name, role: w.role, phone: w.phone, ...(workerPhoto ? {photo: workerPhoto} : {})};
    else state.customWorkers = [...state.customWorkers.filter(x => x.id !== w.id), w];
    persist(); refreshWorkers(); $('#worker-dialog').close();
    if (view !== 'equipo') setView('equipo'); else render();
    toast(data.id ? 'Trabajador actualizado.' : `${w.name} se agregó al equipo.`);
  } catch (error) { errorToast(error); }
});
$('#worker-delete').onclick = () => {
  const id = $('#worker-form').elements.id.value; const w = workers.find(x => x.id === id); if (!w) return;
  const rooms = state.rooms.filter(r => r.workers.includes(id));
  if (rooms.length) return errorToast(new Error(`Antes de eliminar a ${w.name}, reasigna ${rooms.length === 1 ? 'la habitación' : 'las habitaciones'} ${rooms.map(r => r.number).join(', ')}.`));
  const button = $('#worker-delete');
  if (!button.dataset.confirm) { button.dataset.confirm = '1'; button.textContent = '¿Eliminar? Confirmar'; return; }
  state.workerArchive[id] = {id, name: w.name, photo: w.photo || ''};
  if (baseWorkers.some(x => x.id === id)) state.removedWorkers.push(id); else state.customWorkers = state.customWorkers.filter(x => x.id !== id);
  persist(); refreshWorkers(); $('#worker-dialog').close(); render(); toast(`${w.name} se retiró del equipo. Su historial se conserva.`);
};

// ---------- Materiales y pedidos ----------
const payClass = p => ({'Por pagar':'n0', 'Abonado':'n1', 'Pagado':'n3'}[p]);
const orderClass = o => ({'Por pedir':'pending', 'Pedido':'active', 'Recibido':'done'}[o]);
const monthKey = () => today().slice(0, 7);
function scopedMaterials() {
  return state.materials.filter(m => materialScope === 'toOrder' ? m.orderStatus === 'Por pedir' : materialScope === 'owed' ? m.orderStatus !== 'Por pedir' && balance(m) > 0 : true);
}
function filteredMaterials() {
  const normalize = v => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = normalize($('#m-search').value.trim()), order = $('#m-order-filter').value, pay = $('#m-pay-filter').value;
  return scopedMaterials().filter(m => (order === 'all' || m.orderStatus === order) && (pay === 'all' || paymentStatus(m) === pay) && (materialRequester === 'all' || m.requestedBy === materialRequester) && normalize([m.name, m.supplier, m.notes, m.unit, state.rooms.find(r => r.id === m.roomId)?.number, workerName(m.requestedBy)].join(' ')).includes(q))
    .sort((a, b) => orderStatuses.indexOf(a.orderStatus) - orderStatuses.indexOf(b.orderStatus) || b.date.localeCompare(a.date));
}
function renderMaterials() {
  const toOrder = state.materials.filter(m => m.orderStatus === 'Por pedir').length;
  $('#nav-material-count').textContent = toOrder;
  $('#material-bar').hidden = !(view === 'materiales' && materialSelected.size);
  if (view !== 'materiales') return;
  const stats = materialStats(state.materials, monthKey());
  const monthName = new Intl.DateTimeFormat('es-CO', {month:'long', timeZone:'America/Bogota'}).format(new Date());
  $('#m-month').textContent = cop(stats.monthSpent); $('#m-month-sub').textContent = `${stats.monthCount} ${stats.monthCount === 1 ? 'pedido' : 'pedidos'} en ${monthName}`;
  $('#m-paid').textContent = cop(stats.paid);
  $('#m-owed').textContent = cop(stats.owed); $('#m-owed-tag').textContent = `${stats.owedCount} ${stats.owedCount === 1 ? 'pedido' : 'pedidos'}`; $('#m-owed-tag').classList.toggle('ok', !stats.owed);
  $('#m-toorder').textContent = stats.toOrder; $('#m-toorder-sub').textContent = stats.toOrderValue ? `Estimado ${cop(stats.toOrderValue)}` : 'Materiales sin pedir';
  const requesters = [...new Set(state.materials.map(m => m.requestedBy).filter(Boolean))];
  if (materialRequester !== 'all' && !requesters.includes(materialRequester)) materialRequester = 'all';
  $('#m-requesters').innerHTML = requesters.length ? `<span class="requester-label">Pedido por</span><button class="req-chip ${materialRequester === 'all' ? 'selected' : ''}" data-requester="all">Todos</button>${requesters.map(id => `<button class="req-chip ${materialRequester === id ? 'selected' : ''}" data-requester="${e(id)}">${avatar(id)}${e(workerName(id).split(' ').slice(0, 2).join(' '))}<b>${state.materials.filter(m => m.requestedBy === id).length}</b></button>`).join('')}` : '';
  document.querySelectorAll('[data-requester]').forEach(b => b.onclick = () => { materialRequester = b.dataset.requester; materialPage = 1; render(); });
  const list = filteredMaterials();
  for (const id of [...materialSelected]) if (!state.materials.some(m => m.id === id)) materialSelected.delete(id);
  const size = Number($('#m-page-size').value), pages = Math.max(1, Math.ceil(list.length / size));
  materialPage = Math.min(materialPage, pages);
  const page = list.slice((materialPage - 1) * size, materialPage * size);
  $('#m-showing').innerHTML = `Mostrando <b>${page.length} de ${list.length}</b> materiales${list.length !== state.materials.length ? ` (${state.materials.length} en total)` : ''}.`;
  $('#m-page').textContent = `${materialPage}/${pages}`; $('#m-prev').disabled = materialPage <= 1; $('#m-next').disabled = materialPage >= pages;
  const all = page.length && page.every(m => materialSelected.has(m.id));
  $('#m-table').innerHTML = page.length ? `<div class="room-table-wrap"><table class="room-table material-table"><thead><tr><th><input type="checkbox" class="check" id="m-check-all" aria-label="Seleccionar materiales de esta página" ${all ? 'checked' : ''}></th><th>Material</th><th>Cantidad</th><th>Pedido</th><th>Pago</th><th>Valor</th><th>Saldo</th><th>Pedido por</th><th>Habitación</th><th></th></tr></thead><tbody>${page.map(m => {
    const pay = paymentStatus(m), room = state.rooms.find(r => r.id === m.roomId), cls = orderClass(m.orderStatus);
    return `<tr class="${materialSelected.has(m.id) ? 'checked' : ''}"><td><input type="checkbox" class="check" data-m-select="${e(m.id)}" aria-label="Seleccionar ${e(m.name)}" ${materialSelected.has(m.id) ? 'checked' : ''}></td><td><strong>${e(m.name)}</strong><small>${e([m.supplier, dateLabel(m.date + 'T12:00:00-05:00')].filter(Boolean).join(' · '))}</small></td><td class="nowrap">${e(String(m.quantity).replace('.', ','))} ${e(m.unit)}</td><td><span class="status-cell"><span class="status-icon ${cls}">${icon(m.orderStatus === 'Recibido' ? 'check' : m.orderStatus === 'Pedido' ? 'truck' : 'clock')}</span>${e(m.orderStatus)}</span></td><td><span class="prio ${payClass(pay)}">${e(pay)}</span></td><td class="nowrap">${cop(m.total)}</td><td class="nowrap ${balance(m) ? 'owed' : ''}">${cop(balance(m))}</td><td>${m.requestedBy ? `<span class="task-worker">${avatar(m.requestedBy)}<span>${e(workerName(m.requestedBy))}</span></span>` : '<span class="muted">—</span>'}</td><td>${room ? `<span class="pill">Hab. ${e(room.number)}</span>` : '<span class="muted">—</span>'}</td><td><button class="small-btn" data-m-edit="${e(m.id)}">${icon('edit')}Editar</button></td></tr>`;
  }).join('')}</tbody></table></div>` : `<div class="empty-state compact"><div class="empty-icon">${icon('box')}</div><h3>${state.materials.length ? 'No hay materiales con esos filtros' : 'Registra el primer material'}</h3><p>${state.materials.length ? 'Prueba otra búsqueda, estado o persona.' : 'Anota lo que falta por pedir, lo pedido y lo pagado para saber cuánto se debe.'}</p>${state.materials.length ? '' : `<button class="button primary" id="empty-new-material">${icon('plus')}Nuevo pedido</button>`}</div>`;
  $('#empty-new-material')?.addEventListener('click', () => editMaterial());
  const checkAll = $('#m-check-all');
  if (checkAll) { checkAll.indeterminate = !all && page.some(m => materialSelected.has(m.id)); checkAll.onchange = () => { page.forEach(m => checkAll.checked ? materialSelected.add(m.id) : materialSelected.delete(m.id)); render(); }; }
  document.querySelectorAll('[data-m-select]').forEach(box => box.onchange = () => { box.checked ? materialSelected.add(box.dataset.mSelect) : materialSelected.delete(box.dataset.mSelect); render(); });
  document.querySelectorAll('[data-m-edit]').forEach(b => b.onclick = () => editMaterial(b.dataset.mEdit));
  $('#m-sel-count').textContent = materialSelected.size;
  $('#material-bar').hidden = !materialSelected.size;
}
function updateBalanceHint() {
  const f = $('#material-form').elements, total = parseMoney(f.total.value || 0), paid = parseMoney(f.paid.value || 0);
  $('#material-balance').textContent = Number.isFinite(total) && Number.isFinite(paid) && total ? `Saldo por pagar: ${cop(Math.max(0, total - paid))} · ${paymentStatus({total, paid})}` : '';
}
function editMaterial(id) {
  const m = state.materials.find(x => x.id === id);
  $('#material-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#material-form'); form.reset();
  $('#material-form-title').textContent = m ? 'Editar pedido' : 'Nuevo pedido';
  form.elements.roomId.innerHTML = '<option value="">General / sin habitación</option>' + [...state.rooms].sort((a, b) => a.number.localeCompare(b.number, 'es', {numeric:true})).map(r => `<option value="${e(r.id)}">Hab. ${e(r.number)} · ${e(r.level)}</option>`).join('');
  form.elements.requestedBy.innerHTML = '<option value="">Sin especificar</option>' + workers.map(w => `<option value="${w.id}">${e(w.name)}</option>`).join('');
  const values = m || {id:'', name:'', quantity:'', unit:'', orderStatus:'Por pedir', date: today(), requestedBy: materialRequester !== 'all' ? materialRequester : '', roomId: activeRoom && $('#detail-dialog').open ? activeRoom : '', supplier:'', total:'', paid:'', notes:''};
  for (const key of ['id','name','quantity','unit','orderStatus','date','requestedBy','roomId','supplier','total','paid','notes']) form.elements[key].value = values[key] ?? '';
  if (m) { form.elements.total.value = m.total ? m.total.toLocaleString('es-CO') : ''; form.elements.paid.value = m.paid ? m.paid.toLocaleString('es-CO') : ''; }
  updateBalanceHint();
  $('#material-delete').hidden = !m; $('#material-delete').dataset.confirm = ''; $('#material-delete').textContent = 'Eliminar';
  $('#material-dialog').showModal();
}
['total','paid'].forEach(k => $('#material-form').elements[k].addEventListener('input', updateBalanceHint));
$('#material-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const existing = state.materials.find(m => m.id === data.id);
    const m = validateMaterial({...existing, ...data, id: data.id || crypto.randomUUID(), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()}, state.rooms, workers);
    state.materials = [...state.materials.filter(x => x.id !== m.id), m]; persist(); $('#material-dialog').close();
    if (view !== 'materiales') setView('materiales'); else render();
    toast(existing ? 'Pedido actualizado.' : 'Material registrado.');
  } catch (error) { errorToast(error); }
});
$('#material-delete').onclick = () => {
  const button = $('#material-delete');
  if (!button.dataset.confirm) { button.dataset.confirm = '1'; button.textContent = '¿Eliminar? Confirmar'; return; }
  const id = $('#material-form').elements.id.value;
  state.materials = state.materials.filter(m => m.id !== id); materialSelected.delete(id); persist(); $('#material-dialog').close(); render(); toast('Pedido eliminado.');
};

// ---------- Reportes ----------
let reportTab = 'avance';
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Intl.DateTimeFormat('es-CO', {month:'short', year:'2-digit', timeZone:'UTC'}).format(new Date(Date.UTC(y, m - 1, 15))); };
function lastMonths(n) { const [y, m] = monthKey().split('-').map(Number); return Array.from({length:n}, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); }); }
function barChart(items, format = v => v, cls = '') {
  const max = Math.max(...items.map(i => i.value), 0);
  return `<div class="report-chart ${cls}">${items.map(i => `<div class="report-col"><b>${e(format(i.value))}</b><div class="report-bar-fill ${i.cls || ''}" style="height:${max ? Math.max(4, i.value / max * 100) : 4}%"></div><small>${e(i.label)}</small></div>`).join('')}</div>`;
}
function hbars(items, format) {
  const max = Math.max(...items.map(i => i.value), 0);
  return items.length ? items.map(i => `<div class="hbar"><span>${e(i.label)}</span><div><i style="width:${max ? i.value / max * 100 : 0}%"></i></div><b>${e(format(i.value))}</b></div>`).join('') : '<p class="rail-empty">Sin datos todavía.</p>';
}
function insights() {
  const list = [];
  const overdue = state.tasks.filter(t => t.status !== 'Completada' && t.date < today()).length;
  if (overdue) list.push(`${overdue} ${overdue === 1 ? 'tarea está vencida' : 'tareas están vencidas'}. Revisa la lista de tareas asignadas.`);
  const st = materialStats(state.materials, monthKey());
  if (st.owed) list.push(`Se deben ${cop(st.owed)} en ${st.owedCount} ${st.owedCount === 1 ? 'pedido' : 'pedidos'} de material.`);
  if (st.toOrder) list.push(`Faltan ${st.toOrder} ${st.toOrder === 1 ? 'material' : 'materiales'} por pedir.`);
  const review = state.rooms.filter(r => r.status === 'En revisión').length;
  if (review) list.push(`${review} ${review === 1 ? 'habitación espera' : 'habitaciones esperan'} revisión antes de entregarse.`);
  const noPhotos = state.rooms.filter(r => r.status !== 'Pendiente' && !state.records.some(x => x.roomId === r.id)).length;
  if (noPhotos) list.push(`${noPhotos} ${noPhotos === 1 ? 'habitación en obra no tiene' : 'habitaciones en obra no tienen'} registro fotográfico.`);
  return list.length ? `<ul class="insight-list">${list.map(i => `<li>${e(i)}</li>`).join('')}</ul>` : '<p class="rail-empty">Todo al día: no hay vencimientos, deudas ni pendientes destacados.</p>';
}
function renderReports() {
  if (view !== 'reportes') return;
  document.querySelectorAll('[data-report]').forEach(b => b.classList.toggle('selected', b.dataset.report === reportTab));
  const monthSel = $('#report-month'), months = lastMonths(12);
  if (monthSel.options.length !== months.length) { monthSel.innerHTML = months.slice().reverse().map(m => `<option value="${m}">${e(monthLabel(m))}</option>`).join(''); monthSel.value = monthKey(); }
  const month = monthSel.value || monthKey();
  monthSel.parentElement.hidden = reportTab !== 'materiales';
  let html = '';
  if (reportTab === 'avance') {
    const sectors = [...new Set(state.rooms.map(r => r.level))];
    const legend = `<div class="legend">${statuses.map(s => `<span class="${statusClass(s)}"><i></i>${e(s)}</span>`).join('')}</div>`;
    const total = state.rooms.length, done = state.rooms.filter(r => r.status === 'Finalizada').length;
    html = `<div class="report-grid"><div>${sectors.length ? sectors.map(sector => { const rs = state.rooms.filter(r => r.level === sector).sort((a, b) => a.number.localeCompare(b.number, 'es', {numeric:true})); return `<section class="sector-card panel-lite"><div class="sector-head"><h3>${e(sector)} <span class="count-chip">${rs.length}</span></h3>${legend}</div><div class="sector-rooms">${rs.map(room => `<button class="sector-room ${statusClass(room.status)}" data-report-room="${e(room.id)}" aria-label="Habitación ${e(room.number)}, ${e(room.status)}">${e(room.number)}<span class="tip"><b>Habitación</b>${e(room.number)}<br><b>Proceso</b>${e(room.process)}<br><b>Estado</b>${e(room.status)}<br><b>Fotos</b>${state.records.filter(r => r.roomId === room.id).length}</span></button>`).join('')}</div></section>`; }).join('') : `<div class="empty-state compact"><div class="empty-icon">${icon('chart')}</div><h3>Sin habitaciones registradas</h3><p>El reporte de avance aparecerá cuando registres habitaciones.</p></div>`}</div>
      <aside><section class="rail-card"><div class="rail-heading"><h3>Avance general de la obra</h3></div><strong class="rail-big">${total ? Math.round(done / total * 100) : 0}%</strong><p class="rail-note">${done} de ${total} habitaciones finalizadas.</p>${barChart(sectors.map(sec => { const rs = state.rooms.filter(r => r.level === sec); return {label: sec, value: Math.round(rs.filter(r => r.status === 'Finalizada').length / rs.length * 100)}; }), v => `${v}%`, 'pct')}</section>
      <section class="drive-callout"><h3>${icon('spark')}Observaciones</h3>${insights()}</section></aside></div>`;
  } else if (reportTab === 'materiales') {
    const ordered = state.materials.filter(m => m.orderStatus !== 'Por pedir');
    const inMonth = ordered.filter(m => m.date.startsWith(month));
    const byRoom = {}; inMonth.forEach(m => { const k = state.rooms.find(r => r.id === m.roomId) ? `Hab. ${state.rooms.find(r => r.id === m.roomId).number}` : 'General'; byRoom[k] = (byRoom[k] || 0) + m.total; });
    const bySupplier = {}; ordered.forEach(m => { const k = m.supplier || 'Sin proveedor'; bySupplier[k] ||= {total:0, paid:0}; bySupplier[k].total += m.total; bySupplier[k].paid += m.paid; });
    const st = materialStats(state.materials, month);
    html = `<section class="stats money-stats report-kpis"><div class="stat"><div class="stat-label">${icon('cash')}Gasto de ${e(monthLabel(month))}</div><div class="stat-row"><strong>${cop(st.monthSpent)}</strong></div><small>${st.monthCount} pedidos</small></div><div class="stat"><div class="stat-label">${icon('check')}Pagado (total)</div><div class="stat-row"><strong>${cop(st.paid)}</strong></div><small>Abonos y pagos</small></div><div class="stat stat-owed"><div class="stat-label">${icon('clock')}Se debe</div><div class="stat-row"><strong>${cop(st.owed)}</strong></div><small>${st.owedCount} pedidos con saldo</small></div><div class="stat"><div class="stat-label">${icon('truck')}Por pedir</div><div class="stat-row"><strong>${st.toOrder}</strong></div><small>${st.toOrderValue ? `Estimado ${cop(st.toOrderValue)}` : 'Materiales sin pedir'}</small></div></section>
      <div class="report-grid"><section class="rail-card"><div class="rail-heading"><h3>Gasto por mes</h3><span class="rail-tag">Últimos 6 meses</span></div>${barChart(lastMonths(6).map(k => ({label: monthLabel(k), value: ordered.filter(m => m.date.startsWith(k)).reduce((s, m) => s + m.total, 0), cls: k === month ? 'current' : ''})), v => v ? `$${Math.round(v / 1000).toLocaleString('es-CO')}k` : '$0')}</section>
      <section class="rail-card"><div class="rail-heading"><h3>Gasto por habitación · ${e(monthLabel(month))}</h3></div>${hbars(Object.entries(byRoom).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({label, value})), cop)}</section></div>
      <section class="rail-card"><div class="rail-heading"><h3>Cuentas por proveedor</h3></div>${Object.keys(bySupplier).length ? `<div class="room-table-wrap"><table class="room-table"><thead><tr><th>Proveedor</th><th>Comprado</th><th>Pagado</th><th>Saldo</th></tr></thead><tbody>${Object.entries(bySupplier).sort((a, b) => (b[1].total - b[1].paid) - (a[1].total - a[1].paid)).map(([name, v]) => `<tr><td><strong>${e(name)}</strong></td><td>${cop(v.total)}</td><td>${cop(v.paid)}</td><td class="${v.total - v.paid ? 'owed' : ''}">${cop(v.total - v.paid)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="rail-empty">Aún no hay pedidos realizados.</p>'}</section>`;
  } else {
    const rows = workers.map(w => { const rooms = state.rooms.filter(r => r.workers.includes(w.id)); const tasks = state.tasks.filter(t => t.workerId === w.id); const orders = state.materials.filter(m => m.requestedBy === w.id); return {w, rooms: rooms.length, done: rooms.filter(r => r.status === 'Finalizada').length, open: tasks.filter(t => t.status !== 'Completada').length, closed: tasks.filter(t => t.status === 'Completada').length, orders: orders.length, value: orders.reduce((s, m) => s + m.total, 0)}; });
    html = `<div class="report-grid"><section class="rail-card"><div class="rail-heading"><h3>Tareas completadas por persona</h3></div>${hbars(rows.filter(r => r.closed + r.open).sort((a, b) => b.closed - a.closed).map(r => ({label: r.w.name.split(' ').slice(0, 2).join(' '), value: r.closed})), v => `${v}`)}</section><section class="rail-card"><div class="rail-heading"><h3>Habitaciones por persona</h3></div>${hbars(rows.filter(r => r.rooms).sort((a, b) => b.rooms - a.rooms).map(r => ({label: r.w.name.split(' ').slice(0, 2).join(' '), value: r.rooms})), v => `${v}`)}</section></div>
      <section class="rail-card"><div class="rail-heading"><h3>Resumen del equipo</h3><span class="rail-tag">${workers.length} personas</span></div><div class="room-table-wrap"><table class="room-table"><thead><tr><th>Persona</th><th>Habitaciones</th><th>Finalizadas</th><th>Tareas abiertas</th><th>Tareas hechas</th><th>Pedidos</th><th>Valor pedido</th></tr></thead><tbody>${rows.map(r => `<tr><td><span class="task-worker">${avatar(r.w.id)}<span><strong>${e(r.w.name)}</strong><small>${e(r.w.role || '')}</small></span></span></td><td>${r.rooms}</td><td>${r.done}</td><td>${r.open}</td><td>${r.closed}</td><td>${r.orders}</td><td class="nowrap">${cop(r.value)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  $('#report-body').innerHTML = html;
  document.querySelectorAll('[data-report-room]').forEach(b => b.onclick = () => openRoom(b.dataset.reportRoom));
}

// ---------- Entregas y objetivos diarios ----------
const longDate = d => new Intl.DateTimeFormat('es-CO', {weekday:'long', day:'numeric', month:'long', timeZone:'UTC'}).format(new Date(d + 'T12:00:00Z'));
const shortDate = d => new Intl.DateTimeFormat('es-CO', {day:'numeric', month:'short', timeZone:'UTC'}).format(new Date(d + 'T12:00:00Z'));
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysText = n => n === 0 ? 'Es hoy' : n === 1 ? 'Falta 1 día' : n > 1 ? `Faltan ${n} días` : n === -1 ? 'Venció ayer' : `Venció hace ${-n} días`;
function renderClock() {
  const total = state.rooms.length, count = st => state.rooms.filter(r => r.status === st).length;
  $('#status-clock').innerHTML = [count('Pendiente'), count('En proceso'), count('Finalizada')].map(n => `<span>${pad(n)}</span>`).join('<i>:</i>');
  const review = count('En revisión');
  $('#clock-tag').textContent = !total ? 'Sin registros' : review ? `${review} en revisión` : 'Al día';
  $('#clock-tag').classList.toggle('ok', !!total && !review);
  const next = nextMilestone(state.milestones, today());
  if (!next) { $('#countdown-card').innerHTML = `<div class="countdown-empty">${icon('flag')}<div><strong>Sin entregas próximas</strong><p>Registra la próxima entrega para ver la cuenta regresiva.</p></div></div>`; return; }
  const ms = Math.max(0, new Date(next.date + 'T23:59:00-05:00').getTime() - Date.now());
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  const rooms = next.roomIds.map(id => state.rooms.find(r => r.id === id)).filter(Boolean), done = rooms.filter(r => r.status === 'Finalizada').length;
  $('#countdown-card').innerHTML = `<div class="countdown-info"><small>PRÓXIMA ENTREGA</small><strong>${e(next.name)}</strong><span>${e(longDate(next.date))}${rooms.length ? ` · ${done}/${rooms.length} habitaciones listas` : ''}</span></div><div class="countdown-clock"><div><b>${pad(d)}</b><small>Días</small></div><i>:</i><div><b>${pad(h)}</b><small>Horas</small></div><i>:</i><div><b>${pad(m)}</b><small>Min</small></div></div>`;
}
function renderMilestones() {
  if (view !== 'inicio') return;
  const list = [...state.milestones].sort((a, b) => (a.done - b.done) || a.date.localeCompare(b.date));
  $('#milestone-list').innerHTML = list.length ? list.map(m => {
    const rooms = m.roomIds.map(id => state.rooms.find(r => r.id === id)).filter(Boolean);
    const done = rooms.filter(r => r.status === 'Finalizada').length;
    const left = daysBetween(today(), m.date);
    const tone = m.done ? 'done' : left < 0 ? 'late' : left <= 3 ? 'soon' : 'ok';
    return `<article class="milestone ${tone}"><div class="milestone-date"><b>${e(new Intl.DateTimeFormat('es-CO', {day:'2-digit', timeZone:'UTC'}).format(new Date(m.date + 'T12:00:00Z')))}</b><small>${e(new Intl.DateTimeFormat('es-CO', {month:'short', timeZone:'UTC'}).format(new Date(m.date + 'T12:00:00Z')))}</small></div><div class="milestone-body"><div class="milestone-top"><h3>${e(m.name)}</h3><span class="badge ${m.done ? 'done' : left < 0 ? 'off' : left <= 3 ? 'pending' : 'active'}">${m.done ? 'Entregada' : e(daysText(left))}</span></div><p>${e(longDate(m.date))}${m.notes ? ` · ${e(m.notes)}` : ''}</p>${rooms.length ? `<div class="room-progress"><div><span>Habitaciones finalizadas</span><span><b>${done}/${rooms.length}</b></span></div><div class="stage-track">${rooms.map(r => `<span class="${r.status === 'Finalizada' ? 'reached' : ''}" title="Hab. ${e(r.number)} · ${e(r.status)}"></span>`).join('')}</div></div><div class="team-assignments">${rooms.map(r => `<button class="pill" data-ms-room="${e(r.id)}">Hab. ${e(r.number)} · ${e(r.status)}</button>`).join('')}</div>` : '<p class="muted">Sin habitaciones asociadas.</p>'}</div><button class="small-btn" data-ms-edit="${e(m.id)}">${icon('edit')}Editar</button></article>`;
  }).join('') : `<div class="empty-state compact"><div class="empty-icon">${icon('flag')}</div><h3>Registra tu primera entrega</h3><p>Por ejemplo: «Primera entrega», con su fecha y las habitaciones que incluye.</p><button class="button primary" id="empty-new-ms">${icon('plus')}Nueva entrega</button></div>`;
  $('#empty-new-ms')?.addEventListener('click', () => editMilestone());
  document.querySelectorAll('[data-ms-edit]').forEach(b => b.onclick = () => editMilestone(b.dataset.msEdit));
  document.querySelectorAll('[data-ms-room]').forEach(b => b.onclick = () => openRoom(b.dataset.msRoom));
  const days = Array.from({length:7}, (_, i) => addDays(today(), i));
  const extra = [];
  $('#goal-list').innerHTML = days.map(d => {
    const g = state.goals[d]?.text, ms = state.milestones.filter(m => m.date === d);
    return `<button class="goal-day ${d === today() ? 'today' : ''} ${d < today() ? 'past' : ''}" data-goal-day="${d}"><span class="goal-day-date"><b>${e(new Intl.DateTimeFormat('es-CO', {weekday:'short', timeZone:'UTC'}).format(new Date(d + 'T12:00:00Z')))}</b>${e(shortDate(d))}</span><span class="goal-day-text">${ms.map(m => `<em>${icon('flag')}${e(m.name)}</em>`).join('')}${g ? e(g) : `<i>${d === today() ? 'Define el objetivo de hoy' : d < today() ? 'Sin objetivo registrado' : 'Planear objetivo'}</i>`}</span></button>`;
  }).join('') + (extra.length ? `<p class="goal-history">Objetivos anteriores</p>${extra.map(d => `<button class="goal-day past" data-goal-day="${d}"><span class="goal-day-date"><b>${e(new Intl.DateTimeFormat('es-CO', {weekday:'short', timeZone:'UTC'}).format(new Date(d + 'T12:00:00Z')))}</b>${e(shortDate(d))}</span><span class="goal-day-text">${e(state.goals[d].text)}</span></button>`).join('')}` : '');
  document.querySelectorAll('[data-goal-day]').forEach(b => b.onclick = () => editGoal(b.dataset.goalDay));
}
function editGoal(date = today()) {
  $('#goal-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#goal-form'); form.reset();
  form.elements.date.value = date; form.elements.text.value = state.goals[date]?.text || '';
  updateGoalHint();
  $('#goal-dialog').showModal(); form.elements.text.focus();
}
function updateGoalHint() {
  const d = $('#goal-form').elements.date.value, next = /^\d{4}-\d{2}-\d{2}$/.test(d) ? nextMilestone(state.milestones, d) : null;
  $('#goal-milestone-hint').textContent = next ? `${next.name}: ${shortDate(next.date)} (${daysText(daysBetween(d, next.date)).toLowerCase()} desde esta fecha).` : 'Escribe qué debe quedar listo al final del día.';
}
$('#goal-form').elements.date.addEventListener('change', () => { const f = $('#goal-form').elements; f.text.value = state.goals[f.date.value]?.text || ''; updateGoalHint(); });
$('#goal-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const g = validateGoal(Object.fromEntries(new FormData(event.target)));
    if (g.text) state.goals[g.date] = {text: g.text, updatedAt: new Date().toISOString()}; else delete state.goals[g.date];
    persist(); $('#goal-dialog').close(); render(); toast(g.text ? `Objetivo guardado para ${longDate(g.date)}.` : 'Objetivo eliminado.');
  } catch (error) { errorToast(error); }
});
function editMilestone(id) {
  const m = state.milestones.find(x => x.id === id);
  $('#milestone-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#milestone-form'); form.reset();
  $('#milestone-form-title').textContent = m ? 'Editar entrega' : 'Nueva entrega';
  form.elements.id.value = m?.id || ''; form.elements.name.value = m?.name || ''; form.elements.date.value = m?.date || ''; form.elements.notes.value = m?.notes || ''; form.elements.done.checked = !!m?.done;
  const rooms = [...state.rooms].sort((a, b) => a.level.localeCompare(b.level) || a.number.localeCompare(b.number, 'es', {numeric:true}));
  $('#milestone-rooms').innerHTML = rooms.length ? rooms.map(r => `<label class="room-pick"><input type="checkbox" value="${e(r.id)}" ${m?.roomIds.includes(r.id) ? 'checked' : ''}><span>Hab. ${e(r.number)}<small>${e(r.level)}</small></span></label>`).join('') : '<p class="muted">Aún no hay habitaciones registradas.</p>';
  $('#milestone-delete').hidden = !m; $('#milestone-delete').dataset.confirm = ''; $('#milestone-delete').textContent = 'Eliminar';
  $('#milestone-dialog').showModal();
}
$('#milestone-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const f = event.target.elements, existing = state.milestones.find(m => m.id === f.id.value);
    const m = validateMilestone({...existing, id: f.id.value || crypto.randomUUID(), name: f.name.value, date: f.date.value, notes: f.notes.value, done: f.done.checked, roomIds: [...document.querySelectorAll('#milestone-rooms input:checked')].map(i => i.value)}, state.rooms);
    state.milestones = [...state.milestones.filter(x => x.id !== m.id), m]; persist(); $('#milestone-dialog').close();
    if (view !== 'inicio') setView('inicio'); else render();
    toast(existing ? 'Entrega actualizada.' : `Entrega «${m.name}» registrada para ${longDate(m.date)}.`);
  } catch (error) { errorToast(error); }
});
$('#milestone-delete').onclick = () => {
  const button = $('#milestone-delete');
  if (!button.dataset.confirm) { button.dataset.confirm = '1'; button.textContent = '¿Eliminar? Confirmar'; return; }
  const id = $('#milestone-form').elements.id.value;
  state.milestones = state.milestones.filter(m => m.id !== id); persist(); $('#milestone-dialog').close(); render(); toast('Entrega eliminada.');
};

// ---------- Procesos propios y listas desplegables ----------
function adoptProcess(name) {
  if (allProcesses().includes(name)) return true;
  try { state.customProcesses.push(validateProcessName(name, allProcesses())); return true; } catch { return false; }
}
function addProcess(name) {
  const clean = validateProcessName(name, allProcesses());
  state.customProcesses.push(clean); persist();
  document.querySelectorAll('select[name="process"]').forEach(sel => { const v = sel.value; sel.innerHTML = options(allProcesses(), v); });
  toast(`Proceso «${clean}» agregado.`);
  return clean;
}
function removeProcess(name) {
  if (state.rooms.some(r => r.process === name || (r.log || []).some(x => x.activity === name)) || state.records.some(r => r.process === name)) return 'No se puede eliminar: hay habitaciones o fotos con este proceso.';
  state.customProcesses = state.customProcesses.filter(p => p !== name); persist();
  document.querySelectorAll('select[name="process"]').forEach(sel => { const v = sel.value === name ? processes[0] : sel.value; sel.innerHTML = options(allProcesses(), v); });
  return '';
}
const selectConfig = select => select.name === 'process' ? {onAdd: addProcess, addLabel: 'Agregar proceso', addPlaceholder: 'Ej. Instalación de cielo raso', onRemove: removeProcess, removable: v => state.customProcesses.includes(v)} : {};
const enhance = root => enhanceSelects(root, selectConfig);

// ---------- Planos ----------
const planTypes = [['arq','Arquitectónico'], ['ele','Eléctrico'], ['hid','Hidráulico'], ['fed','Federado']];
const planTabs = {habitaciones:'arq', plano:'arq'};
const planUrls = new Map();
let planZoom = false;
async function planSource(key) {
  const meta = state.plans[key];
  if (!meta) return key === 'arq' ? {url: plan, mime:'image/png', name:'Baco-Studio-planta.png', supplied:true} : null;
  if (planUrls.has(key) && planUrls.get(key).at === meta.updatedAt) return {...planUrls.get(key), ...meta};
  const blob = await blobStore(`plan:${key}`, 'get');
  if (!blob) return null;
  const url = URL.createObjectURL(blob); planUrls.set(key, {url, at: meta.updatedAt}); return {url, ...meta};
}
async function renderPlans() {
  if (view === 'planos') return renderPlanCards();
  const targets = view === 'plano' ? [['plano', $('#full-plan')]] : [];
  for (const [where, box] of targets) {
    const key = planTabs[where], label = planTypes.find(p => p[0] === key)[1], large = where === 'plano';
    const sig = `${key}|${state.plans[key]?.updatedAt || ''}|${planZoom}|${Object.keys(state.plans).join()}`;
    if (box.dataset.sig === sig) continue;
    box.dataset.sig = sig;
    const src = await planSource(key).catch(() => null);
    if (planTabs[where] !== key || view !== where) return;
    const media = !src ? `<div class="plan-empty"><div class="empty-icon">${icon('plan')}</div><h3>Plano ${e(label.toLowerCase())}</h3><p>Aún no has cargado este plano. Sube una imagen (JPG, PNG o WebP) o un PDF.</p><label class="button primary">${icon('upload')}Subir plano<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-plan-upload="${key}" hidden></label></div>`
      : src.mime === 'application/pdf' ? `<iframe class="plan-pdf" src="${src.url}#view=FitH" title="Plano ${e(label)}"></iframe>`
      : `<img class="plan-img ${large && planZoom ? 'zoomed' : ''}" src="${src.url}" alt="Plano ${e(label)}" ${large ? 'data-plan-zoom' : 'data-plan-open'}>`;
    box.innerHTML = `<div class="plan-head"><div><button class="text-button plan-back" data-plan-back>← Todos los planos</button><h2>Plano ${e(label.toLowerCase())}</h2><p class="panel-sub">${src ? e(src.supplied ? 'Plano suministrado, sin modificaciones.' : `${src.name} · actualizado ${dateLabel(src.updatedAt)}`) : 'Sin cargar'}</p></div>${src ? `<div class="plan-actions">${!large ? `<button class="small-btn" data-plan-open>${icon('expand')}Ampliar</button>` : src.mime !== 'application/pdf' ? `<button class="small-btn" data-plan-zoom>${icon('zoom')}${planZoom ? 'Ajustar' : 'Acercar'}</button>` : ''}<a class="small-btn" href="${src.url}" download="${e(src.name)}">${icon('download')}Descargar</a><label class="small-btn">${icon('upload')}${src.supplied ? 'Reemplazar' : 'Cambiar'}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-plan-upload="${key}" hidden></label>${!src.supplied ? `<button class="small-btn" data-plan-remove="${key}">${icon('trash')}</button>` : ''}</div>` : ''}</div>
      <div class="segmented plan-tabs" role="tablist" aria-label="Tipo de plano">${planTypes.map(([k, l]) => `<button role="tab" aria-selected="${k === key}" class="${k === key ? 'selected' : ''}" data-plan-tab="${k}">${e(l)}${state.plans[k] || k === 'arq' ? '' : '<i class="plan-dot" title="Sin cargar"></i>'}</button>`).join('')}</div>
      <div class="plan-stage ${large && planZoom ? 'zoom' : ''}">${media}</div>`;
    box.querySelectorAll('[data-plan-back]').forEach(b => b.onclick = () => setView('planos'));
    box.querySelectorAll('[data-plan-tab]').forEach(b => b.onclick = () => { planTabs[where] = b.dataset.planTab; planZoom = false; renderPlans(); });
    box.querySelectorAll('[data-plan-open]').forEach(b => b.onclick = () => { planTabs.plano = key; setView('plano'); });
    box.querySelectorAll('[data-plan-zoom]').forEach(b => b.onclick = () => { planZoom = !planZoom; renderPlans(); });
    box.querySelectorAll('[data-plan-upload]').forEach(input => input.onchange = () => uploadPlan(input.dataset.planUpload, input.files[0]).catch(errorToast));
    box.querySelectorAll('[data-plan-remove]').forEach(b => b.onclick = () => {
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.lastChild.textContent = ''; b.append(' ¿Quitar?'); return; }
      const k = b.dataset.planRemove; delete state.plans[k]; persist(); blobStore(`plan:${k}`, 'delete').catch(() => {}); const u = planUrls.get(k); if (u) URL.revokeObjectURL(u.url); planUrls.delete(k); renderPlans(); toast('Plano retirado.');
    });
  }
}

async function renderPlanCards() {
  const box = $('#plan-cards');
  const sig = JSON.stringify(state.plans);
  if (box.dataset.sig === sig && box.children.length) return;
  box.dataset.sig = sig;
  const items = await Promise.all(planTypes.map(async ([key, label]) => ({key, label, src: await planSource(key).catch(() => null)})));
  if (view !== 'planos') return;
  box.innerHTML = items.map(({key, label, src}) => `<article class="plan-card-item ${src ? '' : 'empty'}"><button class="plan-thumb-btn" ${src ? `data-plan-view="${key}"` : ''} aria-label="${src ? 'Ver' : 'Sin cargar'}: plano ${e(label.toLowerCase())}">${!src ? `<span class="plan-thumb-empty">${icon('plan')}<small>Sin cargar</small></span>` : src.mime === 'application/pdf' ? `<span class="plan-thumb-empty pdf">${icon('room')}<small>PDF</small></span>` : `<img src="${src.url}" alt="">`}</button><div class="plan-card-body"><div><h3>Plano ${e(label.toLowerCase())}</h3><p>${src ? e(src.supplied ? 'Plano suministrado' : `${src.name} · ${dateLabel(src.updatedAt)}`) : 'Sube una imagen o un PDF'}</p></div><span class="badge ${src ? 'active' : 'pending'}">${src ? 'Cargado' : 'Pendiente'}</span></div><div class="plan-card-actions">${src ? `<button class="small-btn indigo" data-plan-view="${key}">${icon('expand')}Ver plano</button>` : ''}<label class="small-btn">${icon('upload')}${src ? 'Cambiar' : 'Subir plano'}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-plan-upload="${key}" hidden></label></div></article>`).join('');
  box.querySelectorAll('[data-plan-view]').forEach(b => b.onclick = () => { planTabs.plano = b.dataset.planView; planZoom = false; $('#full-plan').dataset.sig = ''; setView('plano'); });
  box.querySelectorAll('[data-plan-upload]').forEach(input => input.onchange = () => uploadPlan(input.dataset.planUpload, input.files[0]).then(() => { box.dataset.sig = ''; renderPlanCards(); }).catch(errorToast));
}
async function uploadPlan(key, file) {
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) throw new Error('Sube el plano como JPG, PNG, WebP o PDF.');
  if (file.size > 40 * 1024 * 1024) throw new Error('El plano debe pesar máximo 40 MB.');
  await blobStore(`plan:${key}`, 'put', file);
  state.plans[key] = {name: file.name, mime: file.type, updatedAt: new Date().toISOString()}; persist();
  renderPlans(); toast(`Plano ${planTypes.find(p => p[0] === key)[1].toLowerCase()} cargado.`);
}
function editRoom(id) {
  const room = state.rooms.find(r => r.id === id);
  $('#room-dialog').querySelector('.dialog-feedback')?.remove();
  const form = $('#room-form'); form.reset();
  $('#room-form-title').textContent = room ? `Editar habitación ${room.number}` : 'Nueva habitación';
  for (const key of ['id','number','level','notes','status']) form.elements[key].value = room?.[key] || (key === 'status' ? 'Pendiente' : '');
  form.elements.process.innerHTML = options(allProcesses(), room?.process || processes[0]);
  form.elements.worker1.innerHTML = workerOptions(room?.workers[0]);
  form.elements.worker2.innerHTML = workerOptions(room?.workers[1]);
  $('#room-dialog').showModal();
}
$('#room-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const existing = state.rooms.find(r => r.id === data.id);
    const room = validateRoom({...existing,...data,id:data.id || crypto.randomUUID(),workers:[data.worker1,data.worker2],dirty:true,updatedAt:new Date().toISOString()}, state.rooms, workers, allProcesses());
    delete room.worker1; delete room.worker2;
    state.rooms = [...state.rooms.filter(r => r.id !== room.id), room]; persist();
    $('#room-dialog').close(); render();
    if (activeRoom === room.id && $('#detail-dialog').open) renderDetail();
    toast('Habitación guardada. Usa «Actualizar desde Drive» para sincronizarla.');
  } catch (error) { errorToast(error); }
});
// ---------- Bitácora diaria ----------
function detailLog(room) {
  const log = [...(room.log || [])].sort((a, b) => b.date.localeCompare(a.date)), act = activityOn(room, today());
  const names = ids => ids.map(workerName).join(' · ');
  return `<div class="detail-process"><small>ACTIVIDAD DE HOY · ${e(longDate(today()))}</small><h3>${act ? e(act.activity) : 'Sin actividad registrada'}</h3>${act ? `<p>${e(names(act.workers))}</p>` : `<p>Último proceso: ${e(room.process)}</p>`}</div>
  <div class="section-heading log-heading"><h3>Bitácora diaria</h3><button class="small-btn indigo" id="activity-today">${act ? `${icon('edit')}Cambiar la de hoy` : '+ Actividad de hoy'}</button></div>
  ${log.length ? `<div class="log-list">${log.map(x => `<button class="log-item ${x.date === today() ? 'today' : ''}" data-log-date="${e(x.date)}"><span class="log-date"><b>${e(new Intl.DateTimeFormat('es-CO', {weekday:'short', timeZone:'UTC'}).format(new Date(x.date + 'T12:00:00Z')))}</b>${e(shortDate(x.date))}</span><span class="log-body"><strong>${e(x.activity)}</strong><small>${e(names(x.workers))}</small>${x.notes ? `<em>${e(x.notes)}</em>` : ''}</span><span class="log-avatars">${x.workers.slice(0, 3).map(id => avatar(id)).join('')}</span></button>`).join('')}</div>` : '<p class="muted log-empty">Aún no hay actividades. Anota lo que se hace hoy en esta habitación y quién lo hace.</p>'}`;
}
function editActivity(roomId, date = today()) {
  const room = state.rooms.find(r => r.id === roomId); if (!room) return;
  const form = $('#activity-form'); form.reset();
  $('#activity-dialog').querySelector('.dialog-feedback')?.remove();
  form.elements.roomId.value = roomId; form.elements.date.value = date;
  $('#activity-room').textContent = `HABITACIÓN ${room.number} · ${room.level}`.toUpperCase();
  fillActivity(room, date);
  $('#activity-dialog').showModal();
}
function fillActivity(room, date) {
  const form = $('#activity-form'), entry = activityOn(room, date), prev = entry || lastActivity(room, date);
  $('#activity-form-title').textContent = date === today() ? 'Actividad de hoy' : `Actividad del ${longDate(date)}`;
  form.elements.process.innerHTML = options(allProcesses(), entry?.activity || prev?.activity || room.process);
  form.elements.notes.value = entry?.notes || '';
  const chosen = entry?.workers || room.workers;
  const ids = [...new Set([...room.workers, ...chosen, ...workers.map(w => w.id)])].filter(id => worker(id));
  $('#activity-workers').innerHTML = ids.map(id => `<label class="room-pick worker-pick"><input type="checkbox" value="${e(id)}" ${chosen.includes(id) ? 'checked' : ''}><span>${avatar(id)}${e(workerName(id))}</span></label>`).join('');
  $('#activity-delete').hidden = !entry; delete $('#activity-delete').dataset.confirm; $('#activity-delete').textContent = 'Eliminar';
  syncSelects(form);
}
function syncRoomProcess(room) {
  const latest = [...(room.log || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) room.process = latest.activity;
  room.updatedAt = new Date().toISOString();
}
$('#activity-form').elements.date.addEventListener('change', event => { const room = state.rooms.find(r => r.id === $('#activity-form').elements.roomId.value); if (room && /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) fillActivity(room, event.target.value); });
$('#activity-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const f = event.target.elements, room = state.rooms.find(r => r.id === f.roomId.value);
    if (!room) throw new Error('La habitación ya no existe.');
    const entry = validateActivity({date: f.date.value, activity: f.process.value, notes: f.notes.value, workers: [...document.querySelectorAll('#activity-workers input:checked')].map(i => i.value)}, workers, allProcesses());
    room.log = upsertActivity(room.log, entry); syncRoomProcess(room); persist();
    $('#activity-dialog').close(); render(); if ($('#detail-dialog').open) renderDetail();
    toast(`${entry.date === today() ? 'Actividad de hoy' : `Actividad del ${shortDate(entry.date)}`} guardada: ${entry.activity}.`);
  } catch (error) { errorToast(error); }
});
$('#activity-delete').onclick = () => {
  const b = $('#activity-delete');
  if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = '¿Eliminar este día?'; return; }
  const f = $('#activity-form').elements, room = state.rooms.find(r => r.id === f.roomId.value); if (!room) return;
  room.log = (room.log || []).filter(x => x.date !== f.date.value); syncRoomProcess(room); persist();
  $('#activity-dialog').close(); render(); if ($('#detail-dialog').open) renderDetail(); toast('Actividad eliminada de la bitácora.');
};
async function openRoom(id) {
  activeRoom = id; renderDetail(); $('#detail-dialog').showModal();
  const room = state.rooms.find(r => r.id === id);
  if (drive.connected && room.folderId && !syncing) {
    try { await loadRecords(room); persist(); render(); if (activeRoom === id) renderDetail(); } catch (error) { errorToast(error); }
  }
}
function renderDetail() {
  const room = state.rooms.find(r => r.id === activeRoom); if (!room) return;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">${e(room.level)}</p><h2>Habitación ${e(room.number)}</h2></div><button class="icon-button" id="close-detail" aria-label="Cerrar">×</button></div><div class="detail-toolbar"><span class="badge ${statusClass(room.status)}">${e(room.status)}</span><button class="text-button" id="edit-detail">Editar habitación ↗</button><button class="text-button" id="task-detail">Anotar tarea ↗</button>${room.folderId ? `<a class="text-button" href="https://drive.google.com/drive/folders/${e(room.folderId)}" target="_blank" rel="noopener noreferrer">Abrir carpeta ↗</a>` : ''}</div>${detailLog(room)}<div class="detail-workers">${room.workers.map(id => `<div>${avatar(id)}<div><small>MAESTRO ENCARGADO</small><strong>${e(workerName(id))}</strong></div></div>`).join('')}</div>${room.notes ? `<p class="room-notes">${e(room.notes)}</p>` : ''}<div class="detail-divider"></div><h3>Nuevo registro fotográfico</h3><form id="photo-form"><div class="form-row"><label>Proceso<select name="process">${options(allProcesses(), room.process)}</select></label><label>Momento<select name="stage"><option>Antes</option><option selected>Durante</option><option>Después</option></select></label></div><label>Fecha del registro<input type="date" name="date" required value="${today()}" max="${today()}"></label><label class="upload-zone" id="upload-zone"><span class="upload-symbol">↑</span><strong>Seleccionar fotos del proceso</strong><span>JPG, PNG o WebP · hasta 20 MB por foto</span><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label><div id="selected-photos" class="selected-photos"></div><label>Observaciones<textarea name="notes" maxlength="1000" placeholder="¿Qué se hizo? ¿Qué falta por resolver?"></textarea></label><div class="dialog-actions"><button type="button" id="pending-upload" class="button secondary" ${uploadBusy || syncing ? 'disabled' : ''}>Subir pendientes</button><button type="submit" class="button primary" ${uploadBusy || syncing ? 'disabled' : ''}>${drive.connected ? 'Guardar y subir fotos' : 'Guardar fotos pendientes'}</button></div><p class="form-note">${drive.connected ? 'Cada foto se marca como subida cuando Google Drive confirma la carga.' : 'Drive no está conectado. Las fotos quedarán pendientes en este dispositivo.'}</p></form><div class="section-heading"><h3>Historial de esta habitación</h3><span class="pill">${state.records.filter(r => r.roomId === room.id).length} registros</span></div><div id="room-gallery" class="gallery"></div>`;
  $('#close-detail').onclick = () => $('#detail-dialog').close();
  $('#edit-detail').onclick = () => editRoom(room.id);
  $('#task-detail').onclick = () => editTask();
  $('#activity-today').onclick = () => editActivity(room.id);
  document.querySelectorAll('#detail-content [data-log-date]').forEach(b => b.onclick = () => editActivity(room.id, b.dataset.logDate));
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
  enhance($('#detail-content'));
}
async function recordImage(record) {
  if (urls.has(record.id)) return urls.get(record.id);
  const blob = record.pending ? await blobStore(record.id, 'get') : drive.connected ? await drive.image(record.fileId) : null;
  if (!blob) return '';
  const url = URL.createObjectURL(blob); urls.set(record.id, url); return url;
}
function renderGallery(container, records) {
  if (!records.length) { container.innerHTML = `<div class="empty-state compact"><div class="empty-icon">${icon('camera')}</div><h3>El avance todavía está por documentar.</h3><p>Abre una habitación para añadir las primeras fotos del proceso.</p></div>`; return; }
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
    if (!record.id || !adoptProcess(record.process) || !Array.isArray(record.workers) || !record.workers.every(id => worker(id)) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue;
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
      try { room = JSON.parse(folder.description); if (!room.id) continue; adoptProcess(room.process); room = validateRoom(room, [], workers, allProcesses()); } catch { continue; }
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
      if (state.rootId) { const previous = state; state = read(`baco.project.${folder.id}`, {rooms:[],records:[],rootId:folder.id,rootName:checked.name}); for (const key of ['tasks','materials','customWorkers','removedWorkers','workerEdits','workerArchive','milestones','goals','customProcesses','plans']) state[key] ||= previous[key]; ensureState(); refreshWorkers(); }
      else { state.rootId = folder.id; state.rootName = checked.name; }
      activeRoom = null; if ($('#detail-dialog').open) $('#detail-dialog').close();
    }
    state.rootName = checked.name; persist(); $('#drive-dialog').close(); await synchronize();
  } catch (error) { errorToast(error); }
};
$('#sync-button').onclick = () => synchronize().catch(errorToast);
$('#new-room').onclick = () => editRoom();
$('#goal-edit').onclick = () => editGoal();
$('#milestone-new').onclick = () => editMilestone();
setInterval(() => { if (!document.hidden) renderClock(); }, 30000);
$('#heading-action').onclick = () => ({inicio:() => editMilestone(), tareas:editTask, materiales:editMaterial, equipo:editWorker}[view] || editRoom)();
$('#task-praise-new').onclick = $('#task-quick').onclick = () => editTask();
$('#target-open').onclick = () => { taskScope = 'today'; render(); };
$('#tasks-toggle').onclick = () => { const g = $('#tasks-group'); if (view !== 'tareas') { g.classList.add('open'); setView('tareas'); } else g.classList.toggle('open'); $('#tasks-toggle').setAttribute('aria-expanded', String(g.classList.contains('open'))); };
document.querySelectorAll('[data-task-scope]').forEach(b => b.onclick = () => { taskScope = b.dataset.taskScope; if (view !== 'tareas') setView('tareas'); else { closeNav(); render(); } });
['#task-search','#task-status-filter','#task-priority-filter'].forEach(sel => $(sel).addEventListener(sel === '#task-search' ? 'input' : 'change', render));
$('#task-export').onclick = () => {
  const csv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = filteredTasks().map(t => [t.title, t.status, t.priority, state.rooms.find(r => r.id === t.roomId)?.number || '', t.workerId ? workerName(t.workerId) : '', t.date, t.time, t.notes].map(csv).join(','));
  const blob = new Blob(['\ufeff' + ['Tarea,Estado,Prioridad,Habitación,Responsable,Fecha,Hora,Notas', ...rows].join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `baco-studio-tareas-${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#drive-button').onclick = $('#sidebar-drive').onclick = openDriveSettings;
$('#bell').onclick = () => setView('registro');
const addMenu = $('#add-menu');
$('#add-menu-toggle').onclick = event => { event.stopPropagation(); addMenu.hidden = !addMenu.hidden; $('#add-menu-toggle').setAttribute('aria-expanded', String(!addMenu.hidden)); };
document.addEventListener('click', event => { if (!addMenu.hidden && !event.target.closest('.add-split')) addMenu.hidden = true; });
document.querySelectorAll('[data-add-action]').forEach(button => button.onclick = () => {
  addMenu.hidden = true; closeNav();
  const action = button.dataset.addAction;
  if (action === 'room') editRoom();
  else if (action === 'drive') openDriveSettings();
  else if (action === 'task') editTask();
  else if (action === 'goal') editGoal();
  else if (action === 'milestone') editMilestone();
  else if (action === 'material') editMaterial();
  else if (action === 'worker') editWorker();
  else if (state.rooms.length) { setView('habitaciones'); setRoomMode('cards'); render(); toast('Abre una habitación con «Fotos» para registrar su proceso.'); }
  else toast('Primero crea una habitación para registrar sus fotos.');
});
$('#rooms-toggle').onclick = () => {
  if (!['habitaciones','planos','plano'].includes(view)) { setRoomMode('cards'); setView('habitaciones'); return; }
  const group = $('#rooms-group');
  if (view !== 'habitaciones') { group.classList.add('open'); setView('habitaciones'); }
  else group.classList.toggle('open');
  $('#rooms-toggle').setAttribute('aria-expanded', String(group.classList.contains('open')));
};
document.querySelectorAll('[data-room-mode]').forEach(button => button.onclick = () => {
  setRoomMode(button.dataset.roomMode);
  if (view !== 'habitaciones') setView('habitaciones'); else { closeNav(); render(); }
  if (button.classList.contains('sub-item')) document.querySelector('.rooms-panel')?.scrollIntoView({behavior:'smooth', block:'start'});
});
$('#collapse-sidebar').onclick = () => document.body.classList.toggle('collapsed');
$('#menu-button').onclick = () => { document.body.classList.add('nav-open'); $('#scrim').hidden = false; };
$('#scrim').onclick = closeNav;
$('#selection-clear').onclick = () => { selected.clear(); render(); };
$('#selection-export').onclick = () => {
  const csv = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = state.rooms.filter(r => selected.has(r.id)).map(r => [r.number, r.level, r.process, r.status, ...r.workers.map(workerName), r.notes].map(csv).join(','));
  const blob = new Blob(['﻿' + ['Habitación,Sector,Proceso,Estado,Maestro 1,Maestro 2,Observaciones', ...rows].join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `baco-studio-habitaciones-${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#search').oninput = () => { if (view !== 'habitaciones') setView('habitaciones'); else render(); };
$('#status-filter').onchange = render;
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { if (button.dataset.roomNav) setRoomMode(button.dataset.roomNav); setView(button.dataset.view); });
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());


$('#add-worker').onclick = () => editWorker();
document.querySelectorAll('[data-report]').forEach(b => b.onclick = () => { reportTab = b.dataset.report; render(); });
$('#report-month').onchange = render;
$('#report-print').onclick = () => window.print();
['#m-order-filter','#m-pay-filter','#m-page-size'].forEach(sel => $(sel).addEventListener('change', () => { materialPage = 1; render(); }));
$('#m-search').addEventListener('input', () => { materialPage = 1; render(); });
$('#m-prev').onclick = () => { materialPage--; render(); };
$('#m-next').onclick = () => { materialPage++; render(); };
$('#m-sel-clear').onclick = () => { materialSelected.clear(); render(); };
document.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => {
  const now = new Date().toISOString();
  for (const m of state.materials.filter(x => materialSelected.has(x.id))) {
    if (b.dataset.bulk === 'pay') { if (m.orderStatus === 'Por pedir') m.orderStatus = 'Pedido'; m.paid = m.total; }
    else m.orderStatus = b.dataset.bulk;
    m.updatedAt = now;
  }
  const count = materialSelected.size; materialSelected.clear(); persist(); render();
  toast(`${count} ${count === 1 ? 'material actualizado' : 'materiales actualizados'}.`);
});
$('#m-export').onclick = () => {
  const csv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = filteredMaterials().map(m => [m.name, m.quantity, m.unit, m.orderStatus, paymentStatus(m), m.total, m.paid, balance(m), m.requestedBy ? workerName(m.requestedBy) : '', state.rooms.find(r => r.id === m.roomId)?.number || '', m.supplier, m.date, m.notes].map(csv).join(','));
  const blob = new Blob(['﻿' + ['Material,Cantidad,Unidad,Pedido,Pago,Valor total,Pagado,Saldo,Pedido por,Habitación,Proveedor,Fecha,Notas', ...rows].join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `baco-studio-materiales-${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#export-button').onclick = () => {
  const blob = new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `baco-studio-respaldo-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  toast('Respaldo de habitaciones y metadatos exportado. Las fotos pendientes permanecen en este dispositivo.');
};
setInterval(() => { if (!drive.connected && $('#drive-button').classList.contains('connected')) render(); }, 30000);
setView('inicio');
