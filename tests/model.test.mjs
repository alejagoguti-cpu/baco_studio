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
import {validateTask, sortTasks} from '../model.mjs';
test('validates tasks against real rooms and workers', () => {
  const task = {id:'t',title:'  Revisar enchape  ',status:'Pendiente',priority:'Alta',date:'2026-10-07',time:'09:30',roomId:'r',workerId:'a'};
  assert.equal(validateTask(task,[room],workers).title,'Revisar enchape');
  assert.throws(() => validateTask({...task,title:' '},[room],workers));
  assert.throws(() => validateTask({...task,priority:'Urgente'},[room],workers));
  assert.throws(() => validateTask({...task,date:''},[room],workers));
  assert.throws(() => validateTask({...task,roomId:'x'},[room],workers));
  assert.throws(() => validateTask({...task,workerId:'x'},[room],workers));
  assert.doesNotThrow(() => validateTask({...task,roomId:'',workerId:'',time:''},[],workers));
});
test('sorts open tasks by deadline before completed ones', () => {
  const t = (id, date, status='Pendiente', time='') => ({id,date,status,time,priority:'Media'});
  assert.deepEqual(sortTasks([t('c','2026-10-01','Completada'),t('b','2026-10-08'),t('a','2026-10-07','En progreso','08:00')]).map(x => x.id), ['a','b','c']);
});
import {validateMaterial, materialStats, paymentStatus, parseMoney, validateWorker} from '../model.mjs';
test('validates material orders and payments', () => {
  const m = {id:'m',name:' Cemento gris ',quantity:'10',unit:'bultos',orderStatus:'Pedido',total:'350.000',paid:'100000',date:'2026-10-06',requestedBy:'a',roomId:'r'};
  const v = validateMaterial(m,[room],workers);
  assert.equal(v.name,'Cemento gris'); assert.equal(v.total,350000); assert.equal(v.quantity,10);
  assert.equal(paymentStatus(v),'Abonado'); assert.equal(paymentStatus({...v,paid:350000}),'Pagado'); assert.equal(paymentStatus({...v,paid:0}),'Por pagar');
  assert.throws(() => validateMaterial({...m,paid:'400000'},[room],workers));
  assert.throws(() => validateMaterial({...m,quantity:'0'},[room],workers));
  assert.throws(() => validateMaterial({...m,orderStatus:'Perdido'},[room],workers));
  assert.throws(() => validateMaterial({...m,requestedBy:'x'},[room],workers));
  assert.equal(parseMoney('$ 1.250.000'),1250000);
});
test('summarises month spending, debt and pending orders', () => {
  const s = materialStats([
    {orderStatus:'Pedido',date:'2026-10-02',total:300,paid:100},
    {orderStatus:'Recibido',date:'2026-09-28',total:200,paid:200},
    {orderStatus:'Por pedir',date:'2026-10-05',total:50,paid:0}], '2026-10');
  assert.deepEqual(s,{monthSpent:300,monthCount:1,paid:300,owed:200,owedCount:1,toOrder:1,toOrderValue:50});
});
test('validates new workers and prevents duplicates', () => {
  assert.equal(validateWorker({id:'n',name:'  Ana   Pérez '},workers).name,'Ana Pérez');
  assert.throws(() => validateWorker({id:'n',name:'luis vásquez'},workers));
  assert.throws(() => validateWorker({id:'n',name:'Al'},workers));
  assert.throws(() => validateWorker({id:'n',name:'Ana Pérez',photo:'javascript:x'},workers));
});
import {validateMilestone, validateGoal, daysBetween, nextMilestone} from '../model.mjs';
test('validates deliveries and daily goals', () => {
  assert.equal(validateMilestone({name:' Primera entrega ',date:'2026-10-09',roomIds:['r','r']},[room]).roomIds.length,1);
  assert.throws(() => validateMilestone({name:'',date:'2026-10-09'},[room]));
  assert.throws(() => validateMilestone({name:'X',date:''},[room]));
  assert.throws(() => validateMilestone({name:'X',date:'2026-10-09',roomIds:['x']},[room]));
  assert.equal(validateGoal({date:'2026-10-07',text:'  Terminar enchape piso 2 '}).text,'Terminar enchape piso 2');
  assert.throws(() => validateGoal({date:'x',text:'a'}));
});
test('finds the next open delivery and counts days', () => {
  assert.equal(daysBetween('2026-10-06','2026-10-09'),3);
  const ms = [{id:'a',date:'2026-10-20',done:false},{id:'b',date:'2026-10-09',done:false},{id:'c',date:'2026-10-08',done:true},{id:'d',date:'2026-10-01',done:false}];
  assert.equal(nextMilestone(ms,'2026-10-06').id,'b');
  assert.equal(nextMilestone([], '2026-10-06'), null);
});
import {validateProcessName} from '../model.mjs';
test('adds custom processes without duplicates and accepts them in rooms', () => {
  assert.equal(validateProcessName('  instalación   de cielo raso ', ['Pintura y acabados']), 'Instalación de cielo raso');
  assert.throws(() => validateProcessName('pintura y ACABADOS', ['Pintura y acabados']));
  assert.throws(() => validateProcessName('ab', []));
  assert.throws(() => validateRoom({...room,process:'Cielo raso'},[],workers));
  assert.equal(validateRoom({...room,process:'Cielo raso'},[],workers,['Cielo raso']).process,'Cielo raso');
});
