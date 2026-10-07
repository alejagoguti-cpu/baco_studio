import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoom,validatePhoto,filterRooms,escapeHTML,safeDriveLink} from '../model.mjs';
const workers = [{id:'a',name:'Luis Vásquez'},{id:'b',name:'Nicol Castiblanco'}];
const room = {id:'r',number:'219',level:'Piso 2',workers:['a','b'],process:'Redes eléctricas',status:'En proceso'};
test('requires exactly two distinct known workers', () => {
  for (const ids of [['a','a'],['a'],['a','x'],['a','b','a']]) assert.throws(() => validateRoom({...room,workers:ids},[],workers));
  assert.equal(validateRoom(room,[],workers).number,'219');
});
test('prevents duplicate rooms within a sector while allowing different floors', () => {
  assert.throws(() => validateRoom({...room,id:'second'},[room],workers));
  assert.doesNotThrow(() => validateRoom({...room,id:'second',level:'Piso 3'},[room],workers));
  assert.doesNotThrow(() => validateRoom(room,[room],workers));
});
test('finds worker names without accents and filters by actual status', () => {
  assert.equal(filterRooms([room],'vasquez','all',workers).length,1);
  assert.equal(filterRooms([room],'219','Finalizada',workers).length,0);
});
test('rejects executable uploads, HEIC, empty files and oversize photos', () => {
  for (const file of [{type:'text/html',size:100},{type:'image/heic',size:100},{type:'image/jpeg',size:0},{type:'image/png',size:21*1024*1024}]) assert.throws(() => validatePhoto(file));
  assert.doesNotThrow(() => validatePhoto({type:'image/jpeg',size:500}));
});
test('escapes untrusted room notes and only produces valid Drive links', () => {
  assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
  assert.equal(safeDriveLink('javascript:bad'),'');
  assert.equal(safeDriveLink('abc_123'), 'https://drive.google.com/file/d/abc_123/view');
});
