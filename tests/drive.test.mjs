import test from 'node:test';
import assert from 'node:assert/strict';
import {Drive} from '../drive.mjs';
const connected = fetcher => { const drive = new Drive(fetcher); drive.token='test-token'; drive.expiry=Date.now()+10000; return drive; };
const json = value => new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
test('does not make unauthenticated requests', async () => {
  let called=false; const drive=new Drive(()=>{called=true;});
  await assert.rejects(()=>drive.list('root','room'), /Conecta/); assert.equal(called,false);
});
test('expired or revoked access is reported and token cleared', async () => {
  const drive=connected(async()=>new Response('{}',{status:401}));
  await assert.rejects(()=>drive.list('root','room')); assert.equal(drive.connected,false);
});
test('lists every page and includes bearer authorization', async () => {
  let calls=0;
  const drive=connected(async (url,options) => {
    assert.equal(options.headers.Authorization,'Bearer test-token');
    if (++calls===1) return json({files:[{id:'1'}],nextPageToken:'page2'});
    assert.ok(url.includes('pageToken=page2')); return json({files:[{id:'2'}]});
  });
  assert.deepEqual((await drive.list('root','room')).map(f=>f.id),['1','2']);
});
test('a retry recovers a previous photo rather than duplicating it', async () => {
  let uploads=0;
  const drive=connected(async url => {
    if (url.includes('/upload/')) { uploads++; return json({id:'new'}); }
    const q=new URL(url).searchParams.get('q');
    if (q.includes("value='process'")) return json({files:[{id:'p',name:'Pintura y acabados'}]});
    return json({files:[{id:'already-uploaded',appProperties:{recordId:'rec'}}]});
  });
  const result=await drive.upload({id:'rec',process:'Pintura y acabados'},new Blob(['photo'],{type:'image/jpeg'}),{folderId:'room'});
  assert.equal(result.id,'already-uploaded'); assert.equal(uploads,0);
});
test('uploads a binary multipart photo with room, process, date and responsible workers', async () => {
  let multipart='';
  const drive=connected(async (url,options) => {
    if (url.includes('/upload/')) { multipart=await options.body.text(); assert.match(options.headers['Content-Type'], /multipart\/related/); return json({id:'confirmed'}); }
    if (options.method==='POST') return json({id:'process-folder'});
    return json({files:[]});
  });
  const record={id:'rec',roomId:'r',date:'2026-10-06',stage:'Durante',process:'Pintura y acabados',notes:'Revisión',workers:['a','b']};
  const result=await drive.upload(record,new Blob(['BINARY-PHOTO'],{type:'image/jpeg'}),{folderId:'room'});
  assert.equal(result.id,'confirmed'); assert.match(multipart,/BINARY-PHOTO/);
  const metadata = JSON.parse(multipart.split('\r\n\r\n')[1].split('\r\n')[0]);
  assert.deepEqual(JSON.parse(metadata.description).workers,['a','b']);
  assert.equal(JSON.parse(metadata.description).roomId,'r');
});
