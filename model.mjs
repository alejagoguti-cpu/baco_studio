export const processes = ['Demolición y retiro', 'Mampostería', 'Redes eléctricas', 'Redes hidrosanitarias', 'Telecomunicaciones', 'Pañete y resanes', 'Impermeabilización', 'Pisos y enchapes', 'Carpintería', 'Pintura y acabados', 'Instalación de mobiliario', 'Revisión y entrega'];
export const statuses = ['Pendiente', 'En proceso', 'En revisión', 'Finalizada'];
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function validateRoom(room, rooms, workers) {
  if (!room.number?.trim() || !room.level?.trim()) throw new Error('Indica la habitación y el piso o sector.');
  if (rooms.some(r => r.id !== room.id && r.number.trim().toLowerCase() === room.number.trim().toLowerCase() && r.level.trim().toLowerCase() === room.level.trim().toLowerCase())) throw new Error('Esta habitación ya está registrada en ese piso o sector.');
  if (!Array.isArray(room.workers) || room.workers.length !== 2 || room.workers[0] === room.workers[1] || !room.workers.every(id => workers.some(w => w.id === id))) throw new Error('Selecciona dos maestros distintos del equipo.');
  if (!processes.includes(room.process) || !statuses.includes(room.status)) throw new Error('Selecciona un proceso y un estado válidos.');
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
