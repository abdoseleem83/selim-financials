import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('../app.src.jsx',import.meta.url),'utf8');
const backup=ui.slice(ui.indexOf('async function backupAll('),ui.indexOf('\nfunction newCompanyDoc('));
const docs=a=>({docs:a.map(x=>({id:x.id,data:()=>x}))});
async function runBackup(failAt='',companies=[{id:'demo',name:'Test',periods:[]}]){
 const alerts=[],busy=[],downloads=[],reads=[];let blob;
 const query=p=>({collection:n=>query(p+'/'+n),doc:n=>query(p+'/'+n),get:async o=>{reads.push({p,o});assert.equal(o.source,'server');if(p===failAt)throw new Error('simulated read failure');if(p.endsWith('/archives'))return docs([{id:'a',year:2025}]);if(p.includes('/archives/'))return docs([{id:'old',month:12,year:2025}]);return docs([{id:'now',month:1,year:2026}]);}});
 const c={db:{collection:n=>query(n)},APP_VERSION:'test',Map,Blob,JSON,Date,URL:{createObjectURL:b=>{blob=b;return 'blob:test'},revokeObjectURL:()=>{}},document:{createElement:()=>({click(){downloads.push(this.download)}})},alert:s=>alerts.push(s),setTimeout:()=>{}};
 vm.createContext(c);vm.runInContext(backup,c);await c.backupAll(companies,b=>busy.push(b));
 return{alerts,busy,downloads,reads,payload:blob?JSON.parse(await blob.text()):null};
}
for(const p of ['companies/demo/periods','companies/demo/archives','companies/demo/archives/a/periods'])test('backup refuses incomplete read '+p,async()=>{const r=await runBackup(p);assert.equal(r.downloads.length,0);assert.equal(r.payload,null);assert.match(r.alerts[0],/لم تكتمل/);assert.deepEqual(r.busy,[true,false]);});
test('complete backup includes current and archived periods with truthful counts',async()=>{const r=await runBackup();assert.equal(r.payload.complete,true);assert.equal(r.payload.companies[0].periods.length,1);assert.equal(r.payload.companies[0].archives[0].periods.length,1);assert.equal(r.downloads.length,1);assert.match(r.alerts[0],/1 شهر نشط/);assert.match(r.alerts[0],/1 شهر مؤرشف/);});
test('legacy periods retained and same-id live document replaces duplicate',async()=>{const r=await runBackup('',[{id:'demo',periods:[{id:'legacy',year:2024},{id:'now',year:1900}]}]);const p=r.payload.companies[0].periods;assert.equal(p.length,2);assert.equal(p.find(x=>x.id==='now').year,2026);});
test('empty list does not produce an empty backup success',async()=>{const r=await runBackup('',[]);assert.equal(r.downloads.length,0);assert.match(r.alerts[0],/لم تكتمل/);});
test('activation removes only old Selim caches',async()=>{const handlers={},deleted=[];const c={self:{addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>{}}},caches:{keys:async()=>['selim-shell-old','selim-shell-7.84','elkorashy-reports-v2','other-app'],delete:async k=>deleted.push(k)},Promise};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),c);let job;handlers.activate({waitUntil:p=>job=p});await job;assert.deepEqual(deleted,['selim-shell-old']);});
test('manual update leaves other app caches and service workers alone',async()=>{const deleted=[],removed=[];const c={window:{confirm:()=>true,caches:{},location:{href:'https://example.test/selim-financials/',pathname:'/selim-financials/'}},caches:{keys:async()=>['selim-shell-old','elkorashy-reports-v2'],delete:async k=>deleted.push(k)},navigator:{serviceWorker:{getRegistrations:async()=>['selim-financials','elkorashy-reports','elkorashy-wpc'].map(n=>({scope:'https://example.test/'+n+'/',unregister:async()=>removed.push(n)}))}},Date,URL,Promise};vm.createContext(c);vm.runInContext(ui.slice(ui.indexOf('function forceUpdate() {'),ui.indexOf('\nasync function backupAll(')),c);c.forceUpdate();await new Promise(r=>setImmediate(r));assert.deepEqual(deleted,['selim-shell-old']);assert.deepEqual(removed,['selim-financials']);});

const statusSource=ui.slice(ui.indexOf('function describeSaveState('),ui.indexOf('\nfunction SaveStatusBanner('));
function saveState(states,expected=4,online=true,failed=false){const c={};vm.createContext(c);vm.runInContext(statusSource,c);return c.describeSaveState(states,expected,online,failed);}
const confirmed=()=>Array.from({length:4},()=>({pending:false,fromCache:false}));
test('status waits until every required server snapshot arrives',()=>{assert.equal(saveState(confirmed().slice(0,3)).kind,'pending');});
test('status never calls cached or metadata-less data server-confirmed',()=>{const a=confirmed();a[0]={fromCache:true};assert.equal(saveState(a).kind,'pending');a[0]={};assert.equal(saveState(a).kind,'pending');});
test('status confirms only complete non-pending server snapshots',()=>{assert.equal(saveState(confirmed()).kind,'synced');});
test('pending writes and offline state both prevent confirmation',()=>{const a=confirmed();a[1].pending=true;assert.equal(saveState(a).kind,'pending');assert.equal(saveState(confirmed(),4,false).kind,'pending');});
test('save failures and listener failures override all success states',()=>{assert.equal(saveState(confirmed(),4,true,true).kind,'error');const a=confirmed();a[2].error=true;assert.equal(saveState(a).kind,'error');});
test('status is rendered on company list and working screen',()=>{assert.equal((ui.match(/<SaveStatusBanner user=\{user\} activeId=\{activeId\} \/>/g)||[]).length,2);assert.ok(!ui.includes('بياناتك محفوظة على السحابة ومتزامنة'));assert.ok(ui.includes('حالة الجلسة مش ضمان لحفظها على الجهاز'));});
