// Datos compartidos del equipo en Supabase. Cada elemento (habitación, tarea, pedido…) es una fila
// en obra_items; los ajustes van en la colección «settings». Las fotos pendientes y los archivos de
// planos se quedan en este dispositivo (sus archivos viven en IndexedDB / Google Drive).
export const SUPABASE_URL = 'https://zhkmykhsyhznkpakvbdj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_HYlV1s3Gjs2fuYKhLJWzDw_e4VsasgB';

const LISTS = ['rooms', 'tasks', 'materials', 'milestones', 'customWorkers', 'records'];
const SETTINGS = ['goals', 'customProcesses', 'customRoles', 'customUnits', 'removedWorkers', 'workerEdits', 'workerArchive'];
const JOIN_FLAG = 'baco.cloud.joined.zhkmykhsyhznkpakvbdj';
// Al entrar por primera vez desde un dispositivo: la nube manda, pero lo que solo existe en el dispositivo se agrega.
export function joinFirstTime(remote, local, firstTime) {
  const merged = new Map(remote);
  if (!firstTime) return merged;
  for (const [k, v] of local) {
    if (!merged.has(k)) { merged.set(k, v); continue; }
    if (!k.startsWith('settings\u0000')) continue;
    const r = JSON.parse(merged.get(k)), l = JSON.parse(v);
    if (Array.isArray(r) && Array.isArray(l)) merged.set(k, JSON.stringify([...new Set([...r, ...l].map(x => JSON.stringify(x)))].map(x => JSON.parse(x))));
    else if (r && l && typeof r === 'object' && typeof l === 'object') merged.set(k, JSON.stringify({...l, ...r}));
  }
  return merged;
}
const key = (collection, id) => `${collection}\u0000${id}`;

// Convierte el estado de la app en un mapa «colección+id» → JSON del elemento.
export function toItems(state) {
  const map = new Map();
  for (const c of LISTS) for (const item of state[c] || []) {
    if (!item?.id || (c === 'records' && item.pending)) continue;
    map.set(key(c, String(item.id)), JSON.stringify(item));
  }
  for (const s of SETTINGS) if (state[s] !== undefined) map.set(key('settings', s), JSON.stringify(state[s]));
  if (state.rootId) map.set(key('settings', 'drive'), JSON.stringify({rootId: state.rootId, rootName: state.rootName || ''}));
  return map;
}

// Reconstruye el estado desde el mapa, conservando lo que es solo de este dispositivo.
export function fromItems(map, local = {}) {
  const next = {...local};
  for (const c of LISTS) next[c] = [];
  for (const [k, json] of map) {
    const [c, id] = k.split('\u0000');
    const value = JSON.parse(json);
    if (c === 'settings') { if (id === 'drive') { next.rootId = value.rootId || ''; next.rootName = value.rootName || ''; } else next[id] = value; }
    else if (LISTS.includes(c)) next[c].push(value);
  }
  next.records = [...next.records, ...(local.records || []).filter(r => r.pending && !next.records.some(x => x.id === r.id))];
  return next;
}

export function diff(before, after) {
  const upserts = [], deletes = [];
  for (const [k, json] of after) if (before.get(k) !== json) upserts.push(k);
  for (const k of before.keys()) if (!after.has(k)) deletes.push(k);
  return {upserts, deletes};
}

export function createSync({getToken, getState, setState, onStatus, onError, who, client: injected}) {
  let client = null, remote = new Map(), synced = new Map(), timer = null, busy = false, again = false, channel = null, enabled = false;
  const status = s => onStatus?.(s);

  async function connect() {
    if (injected) { client = injected; return; }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { accessToken: async () => (await getToken()) ?? null });
  }

  async function fetchAll() {
    const rows = []; const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await client.from('obra_items').select('collection,id,data').range(from, from + page - 1);
      if (error) throw error;
      rows.push(...data); if (data.length < page) break;
    }
    return new Map(rows.map(r => [key(r.collection, r.id), JSON.stringify(r.data)]));
  }

  async function start() {
    status('connecting');
    try {
      await connect();
      const { data: team, error: teamError } = await client.from('team_members').select('email').limit(1);
      if (teamError) throw teamError;
      if (!team.length) { status('no-access'); return false; }
      remote = await fetchAll();
      const local = toItems(getState());
      if (local.size && [...local].some(([k, v]) => remote.get(k) !== v)) {
        try { localStorage.setItem('baco.state.backup', JSON.stringify({savedAt: new Date().toISOString(), state: getState()})); } catch {}
      }
      // Primera vez de este dispositivo en la nube: se suma lo que solo existe aquí (no se pierde nada).
      const merged = joinFirstTime(remote, local, localStorage.getItem(JOIN_FLAG) !== '1');
      synced = new Map(remote); enabled = true;
      setState(fromItems(merged, getState()));
      try { localStorage.setItem(JOIN_FLAG, '1'); } catch {}
      if (merged.size !== remote.size || [...merged].some(([k, v]) => remote.get(k) !== v)) await flush();
      subscribe();
      addEventListener('online', () => schedule(0));
      status('saved');
      return true;
    } catch (error) { status('offline'); onError?.(error); return false; }
  }

  function subscribe() {
    channel = client.channel('obra-items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'obra_items' }, payload => {
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
        if (!row?.collection || !row?.id) return;
        const k = key(row.collection, row.id);
        if (payload.eventType === 'DELETE') { if (!remote.has(k)) return; remote.delete(k); synced.delete(k); }
        else { const json = JSON.stringify(row.data); if (remote.get(k) === json) return; remote.set(k, json); synced.set(k, json); }
        // Lo que este dispositivo aún no ha subido se conserva encima de lo que llegó.
        const pending = diff(synced, toItems(getState()));
        const merged = new Map(remote), mine = toItems(getState());
        for (const p of pending.upserts) if (p !== k) merged.set(p, mine.get(p));
        for (const p of pending.deletes) if (p !== k) merged.delete(p);
        setState(fromItems(merged, getState()));
      })
      .subscribe();
  }

  function schedule(delay = 700) {
    if (!enabled) return;
    clearTimeout(timer); timer = setTimeout(flush, delay);
  }

  async function flush() {
    if (!enabled || !client) return;
    if (busy) { again = true; return; }
    busy = true; status('saving');
    try {
      const now = toItems(getState());
      const { upserts, deletes } = diff(synced, now);
      for (let i = 0; i < upserts.length; i += 200) {
        const batch = upserts.slice(i, i + 200).map(k => { const [collection, id] = k.split('\u0000'); return {collection, id, data: JSON.parse(now.get(k)), updated_at: new Date().toISOString(), updated_by: who?.() || null}; });
        const { error } = await client.from('obra_items').upsert(batch, { onConflict: 'collection,id' });
        if (error) throw error;
        for (const r of batch) { const k = key(r.collection, r.id); synced.set(k, now.get(k)); remote.set(k, now.get(k)); }
      }
      const byCollection = {};
      for (const k of deletes) { const [c, id] = k.split('\u0000'); (byCollection[c] ||= []).push(id); }
      for (const [c, ids] of Object.entries(byCollection)) {
        const { error } = await client.from('obra_items').delete().eq('collection', c).in('id', ids);
        if (error) throw error;
        for (const id of ids) { synced.delete(key(c, id)); remote.delete(key(c, id)); }
      }
      status('saved');
    } catch (error) {
      status(navigator.onLine ? 'error' : 'offline'); onError?.(error);
      clearTimeout(timer); timer = setTimeout(flush, 15000);
    } finally {
      busy = false; if (again) { again = false; schedule(0); }
    }
  }

  // Fotos compartidas: bucket privado «fotos»; solo el equipo puede verlas (URL firmada por 1 hora).
  const signed = new Map();
  async function uploadPhoto(path, blob) {
    if (!enabled) throw new Error('Sin conexión con la nube.');
    const { error } = await client.storage.from('fotos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
    if (error) throw error;
    return path;
  }
  async function photoUrl(path) {
    const hit = signed.get(path); if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await client.storage.from('fotos').createSignedUrl(path, 3600);
    if (error) throw error;
    signed.set(path, { url: data.signedUrl, until: Date.now() + 3300 * 1000 });
    return data.signedUrl;
  }
  async function removePhoto(path) { if (enabled) await client.storage.from('fotos').remove([path]); }

  return { start, schedule, flush, uploadPhoto, photoUrl, removePhoto, get enabled() { return enabled; } };
}
