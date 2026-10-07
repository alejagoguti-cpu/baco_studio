export const processes = ['Demolición y retiro', 'Mampostería', 'Redes eléctricas', 'Redes hidrosanitarias', 'Telecomunicaciones', 'Pañete y resanes', 'Impermeabilización', 'Pisos y enchapes', 'Carpintería', 'Pintura y acabados', 'Instalación de mobiliario', 'Revisión y entrega'];
export const statuses = ['Pendiente', 'En proceso', 'En revisión', 'Finalizada'];
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function validateRoom(room, rooms, workers, extraProcesses = []) {
  if (!room.number?.trim() || !room.level?.trim()) throw new Error('Indica la habitación y el piso o sector.');
  if (rooms.some(r => r.id !== room.id && r.number.trim().toLowerCase() === room.number.trim().toLowerCase() && r.level.trim().toLowerCase() === room.level.trim().toLowerCase())) throw new Error('Esta habitación ya está registrada en ese piso o sector.');
  if (!Array.isArray(room.workers) || room.workers.length !== 2 || room.workers[0] === room.workers[1] || !room.workers.every(id => workers.some(w => w.id === id))) throw new Error('Selecciona dos maestros distintos del equipo.');
  if (![...processes, ...extraProcesses].includes(room.process) || !statuses.includes(room.status)) throw new Error('Selecciona un proceso y un estado válidos.');
  return {...room, number: room.number.trim(), level: room.level.trim()};
}
export function filterRooms(rooms, query, status, workers) {
  const normalize = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = normalize(query.trim());
  return rooms.filter(r => (status === 'all' || r.status === status) && normalize([r.number, r.level, r.process, ...r.workers.map(id => workers.find(w => w.id === id)?.name || '')].join(' ')).includes(q));
}
export function validatePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Usa imágenes JPG, PNG o WebP. Convierte HEIC antes de subir.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Cada foto debe pesar entre 1 byte y 20 MB.');
}
export const dateLabel = value => new Intl.DateTimeFormat('es-CO', {dateStyle:'medium', timeZone:'America/Bogota'}).format(new Date(value));
export function safeDriveLink(id) { return /^[a-zA-Z0-9_-]+$/.test(id || '') ? `https://drive.google.com/file/d/${id}/view` : ''; }
export const taskStatuses = ['Pendiente', 'En progreso', 'Completada'];
export const priorities = ['Alta', 'Media', 'Baja'];
export function validateTask(task, rooms, workers) {
  const title = String(task.title ?? '').trim();
  if (!title) throw new Error('Escribe la tarea.');
  if (title.length > 140) throw new Error('La tarea debe tener máximo 140 caracteres.');
  if (!taskStatuses.includes(task.status) || !priorities.includes(task.priority)) throw new Error('Selecciona un estado y una prioridad válidos.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.date || '')) throw new Error('Indica la fecha límite.');
  if (task.time && !/^\d{2}:\d{2}$/.test(task.time)) throw new Error('Indica una hora válida.');
  if (task.roomId && !rooms.some(r => r.id === task.roomId)) throw new Error('La habitación seleccionada no existe.');
  if (task.workerId && !workers.some(w => w.id === task.workerId)) throw new Error('Selecciona un responsable del equipo.');
  return {...task, title, notes: String(task.notes ?? '').trim().slice(0, 1000), time: task.time || '', roomId: task.roomId || '', workerId: task.workerId || ''};
}
export const sortTasks = tasks => [...tasks].sort((a, b) => (a.status === 'Completada') - (b.status === 'Completada') || `${a.date} ${a.time || '99:99'}`.localeCompare(`${b.date} ${b.time || '99:99'}`) || priorities.indexOf(a.priority) - priorities.indexOf(b.priority));
export const orderStatuses = ['Por pedir', 'Pedido', 'Recibido'];
export const paymentStatuses = ['Por pagar', 'Abonado', 'Pagado'];
const money = v => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n) : NaN; };
export const parseMoney = money;
export function paymentStatus(m) { const total = Number(m.total) || 0, paid = Number(m.paid) || 0; return total > 0 && paid >= total ? 'Pagado' : paid > 0 ? 'Abonado' : 'Por pagar'; }
export const balance = m => Math.max(0, (Number(m.total) || 0) - (Number(m.paid) || 0));
export function validateMaterial(m, rooms, workers) {
  const name = String(m.name ?? '').trim();
  if (!name) throw new Error('Escribe el material.');
  if (name.length > 120) throw new Error('El material debe tener máximo 120 caracteres.');
  const quantity = Number(String(m.quantity ?? '').replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Indica una cantidad mayor que cero.');
  const total = m.total === '' || m.total == null ? 0 : money(m.total), paid = m.paid === '' || m.paid == null ? 0 : money(m.paid);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(paid) || paid < 0) throw new Error('Escribe valores en pesos válidos.');
  if (paid > total) throw new Error('Lo pagado no puede superar el valor total.');
  if (!orderStatuses.includes(m.orderStatus)) throw new Error('Selecciona el estado del pedido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw new Error('Indica la fecha del pedido.');
  if (m.roomId && !rooms.some(r => r.id === m.roomId)) throw new Error('La habitación seleccionada no existe.');
  if (m.requestedBy && !workers.some(w => w.id === m.requestedBy)) throw new Error('Selecciona quién hizo el pedido.');
  return {...m, name, quantity, total, paid, unit: String(m.unit ?? '').trim().slice(0, 20), supplier: String(m.supplier ?? '').trim().slice(0, 80), notes: String(m.notes ?? '').trim().slice(0, 1000), roomId: m.roomId || '', requestedBy: m.requestedBy || ''};
}
export function materialStats(materials, month) {
  const ordered = materials.filter(m => m.orderStatus !== 'Por pedir');
  const inMonth = ordered.filter(m => m.date.startsWith(month));
  const pending = materials.filter(m => m.orderStatus === 'Por pedir');
  return {
    monthSpent: inMonth.reduce((s, m) => s + m.total, 0), monthCount: inMonth.length,
    paid: ordered.reduce((s, m) => s + m.paid, 0),
    owed: ordered.reduce((s, m) => s + balance(m), 0), owedCount: ordered.filter(m => balance(m) > 0).length,
    toOrder: pending.length, toOrderValue: pending.reduce((s, m) => s + m.total, 0)
  };
}
export function validateWorker(w, workers) {
  const name = String(w.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new Error('Escribe el nombre completo del trabajador.');
  if (name.length > 80) throw new Error('El nombre debe tener máximo 80 caracteres.');
  if (workers.some(x => x.id !== w.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('Ya hay un trabajador con ese nombre.');
  if (w.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(w.photo)) throw new Error('La foto no es válida.');
  return {...w, name, role: String(w.role ?? '').trim().slice(0, 40) || 'Personal de obra', phone: String(w.phone ?? '').replace(/[^\d+ ]/g, '').trim().slice(0, 20)};
}
export function validateMilestone(m, rooms) {
  const name = String(m.name ?? '').trim();
  if (!name) throw new Error('Escribe el nombre de la entrega.');
  if (name.length > 100) throw new Error('El nombre debe tener máximo 100 caracteres.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw new Error('Indica la fecha de la entrega.');
  const roomIds = [...new Set(Array.isArray(m.roomIds) ? m.roomIds : [])];
  if (roomIds.some(id => !rooms.some(r => r.id === id))) throw new Error('Una de las habitaciones seleccionadas no existe.');
  return {...m, name, roomIds, notes: String(m.notes ?? '').trim().slice(0, 1000), done: !!m.done};
}
export function validateGoal(g) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date || '')) throw new Error('Indica la fecha del objetivo.');
  const text = String(g.text ?? '').trim();
  if (text.length > 400) throw new Error('El objetivo debe tener máximo 400 caracteres.');
  return {date: g.date, text};
}
export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
export const nextMilestone = (milestones, today) => [...milestones].filter(m => !m.done && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
export function validateProcessName(name, existing) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3) throw new Error('Escribe el nombre del proceso (mínimo 3 letras).');
  if (clean.length > 60) throw new Error('El proceso debe tener máximo 60 caracteres.');
  const norm = v => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (existing.some(p => norm(p) === norm(clean))) throw new Error('Ese proceso ya existe.');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
// Bitácora diaria: una actividad por habitación y por día.
export function validateActivity(a, workers, procs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) throw new Error('Indica la fecha de la actividad.');
  if (!procs.includes(a.activity)) throw new Error('Selecciona la actividad del día.');
  const ids = [...new Set(Array.isArray(a.workers) ? a.workers : [])];
  if (!ids.length) throw new Error('Selecciona al menos una persona que trabajó en la actividad.');
  if (ids.some(id => !workers.some(w => w.id === id))) throw new Error('Una de las personas seleccionadas no existe.');
  return {date: a.date, activity: a.activity, workers: ids, notes: String(a.notes ?? '').trim().slice(0, 500), updatedAt: a.updatedAt || new Date().toISOString()};
}
export function upsertActivity(log, entry) {
  return [...(log || []).filter(x => x.date !== entry.date), entry].sort((a, b) => b.date.localeCompare(a.date));
}
export const activityOn = (room, date) => (room.log || []).find(x => x.date === date) || null;
export const lastActivity = (room, upTo) => (room.log || []).filter(x => x.date <= upTo).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
export const roles = ['Maestro', 'Oficial', 'Ayudante', 'Electricista', 'Plomero', 'Pintor', 'Enchapador'];
export function validateRoleName(name, existing) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3) throw new Error('Escribe el oficio (mínimo 3 letras).');
  if (clean.length > 40) throw new Error('El oficio debe tener máximo 40 caracteres.');
  const norm = v => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (existing.some(p => norm(p) === norm(clean))) throw new Error('Ese oficio ya existe.');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
