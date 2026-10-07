const BASE = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const folderMime = 'application/vnd.google-apps.folder';
export class Drive {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; this.token = ''; this.expiry = 0; }
  get connected() { return Boolean(this.token && Date.now() < this.expiry); }
  disconnect() { this.token = ''; this.expiry = 0; }
  connect(clientId) {
    if (!globalThis.google?.accounts?.oauth2) throw new Error('No se pudo cargar Google. Revisa tu conexión e intenta nuevamente.');
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({client_id: clientId, scope: SCOPE,
        callback: response => {
          if (response.error || !response.access_token) return reject(new Error('No se completó la autorización de Google.'));
          if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) return reject(new Error('Google Drive requiere autorizar el permiso de archivos.'));
          this.token = response.access_token; this.expiry = Date.now() + Number(response.expires_in || 3600) * 1000; resolve();
        }, error_callback: () => reject(new Error('La ventana de Google se cerró o fue bloqueada. Vuelve a conectar.'))});
      client.requestAccessToken({prompt:'select_account'});
    });
  }
  async request(url, options = {}) {
    if (!this.connected) throw new Error('Conecta Google Drive para continuar. La sesión puede haber vencido.');
    const response = await this.fetcher(url, {...options, headers:{...options.headers, Authorization:`Bearer ${this.token}`}});
    if (!response.ok) {
      if (response.status === 401) this.disconnect();
      const data = await response.json().catch(() => ({}));
      throw new Error(response.status === 403 ? 'No tienes permiso para esta carpeta, o la API de Drive no está habilitada.' : response.status === 404 ? 'No se puede acceder a la carpeta. Selecciónala con Google Picker.' : data.error?.message || `Drive respondió con error ${response.status}.`);
    }
    return response;
  }
  async list(parent, kind) {
    const q = `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false${kind ? ` and appProperties has { key='bacoKind' and value='${kind}' }` : ''}`;
    const files = []; let pageToken;
    do {
      const params = new URLSearchParams({q, fields:'nextPageToken,files(id,name,mimeType,description,appProperties,webViewLink,createdTime)', pageSize:'100', supportsAllDrives:'true', includeItemsFromAllDrives:'true'});
      if (pageToken) params.set('pageToken', pageToken);
      const data = await (await this.request(`${BASE}/files?${params}`)).json();
      files.push(...data.files); pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }
  async folder(name, parent, properties = {}, description = '') {
    const metadata = {name, mimeType:folderMime, appProperties:properties, description};
    if (parent) metadata.parents = [parent];
    return (await this.request(`${BASE}/files?fields=id,name&supportsAllDrives=true`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)})).json();
  }
  async checkFolder(id) {
    const data = await (await this.request(`${BASE}/files/${id}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`)).json();
    if (data.mimeType !== folderMime || !data.capabilities?.canAddChildren) throw new Error('Selecciona una carpeta con permiso para agregar archivos.');
    return data;
  }
  async saveRoom(room, parent) {
    const metadata = {name:`Habitación ${room.number} · ${room.level}`, description:JSON.stringify({id:room.id,number:room.number,level:room.level,workers:room.workers,process:room.process,status:room.status,notes:room.notes}), appProperties:{bacoKind:'room',roomId:room.id}};
    if (!room.folderId) {
      const existing = (await this.list(parent, 'room')).find(f => f.appProperties?.roomId === room.id);
      if (existing) room.folderId = existing.id;
    }
    if (room.folderId) {
      await this.request(`${BASE}/files/${room.folderId}?supportsAllDrives=true`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)});
      return room.folderId;
    }
    return (await this.folder(metadata.name, parent, metadata.appProperties, metadata.description)).id;
  }
  async upload(record, blob, room) {
    let processFolder = (await this.list(room.folderId, 'process')).find(f => f.name === record.process);
    if (!processFolder) processFolder = await this.folder(record.process, room.folderId, {bacoKind:'process'});
    // A deterministic record ID lets a retry find an upload whose response was lost.
    const existing = (await this.list(processFolder.id, 'photo')).find(f => f.appProperties?.recordId === record.id);
    if (existing) return existing;
    const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type];
    const metadata = {name:`${record.date}_${record.stage}_${record.id}.${ext}`,parents:[processFolder.id],description:JSON.stringify({id:record.id,roomId:record.roomId,process:record.process,date:record.date,stage:record.stage,notes:record.notes,workers:record.workers}),appProperties:{bacoKind:'photo',recordId:record.id,roomId:record.roomId}};
    const boundary = `baco_${crypto.randomUUID()}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    return (await this.request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`, {method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body})).json();
  }
  async records(room) {
    const all = [];
    for (const folder of await this.list(room.folderId, 'process')) {
      for (const file of await this.list(folder.id, 'photo')) {
        try { const record = JSON.parse(file.description); if (record.roomId === room.id) all.push({...record, fileId:file.id, pending:false}); } catch { /* Ignore unrelated or damaged metadata. */ }
      }
    }
    return all;
  }
  async image(fileId) { return (await this.request(`${BASE}/files/${fileId}?alt=media&supportsAllDrives=true`)).blob(); }
  pickFolder({apiKey, appId}) {
    if (!this.connected) throw new Error('Conecta Google Drive antes de seleccionar una carpeta.');
    if (!apiKey || !appId) throw new Error('Configura la clave de API y el número de proyecto para usar Google Picker.');
    if (!globalThis.gapi) throw new Error('Google Picker no se ha cargado. Revisa tu conexión.');
    return new Promise((resolve, reject) => {
      gapi.load('picker', {callback:() => {
        try {
          const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
          new google.picker.PickerBuilder().addView(view).setOAuthToken(this.token).setDeveloperKey(apiKey).setAppId(appId).setOrigin(location.origin).setTitle('Carpeta del proyecto Baco Studio').setCallback(data => {
            if (data.action === google.picker.Action.PICKED) resolve(data.docs[0]);
            if (data.action === google.picker.Action.CANCEL) resolve(null);
          }).build().setVisible(true);
        } catch (error) { reject(error); }
      }, onerror:() => reject(new Error('No se pudo cargar Google Picker.')), timeout:15000, ontimeout:() => reject(new Error('Google Picker tardó demasiado en cargar.'))});
    });
  }
}
