/* Travel Journal cloud adapter: GitHub Pages + Supabase JS v2. No server secrets. */
(function () {
'use strict';
const cfg = window.TRAVEL_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url || '') &&
  !!cfg.publishableKey && !cfg.publishableKey.startsWith('YOUR_');
const client = configured && window.supabase ? window.supabase.createClient(cfg.url, cfg.publishableKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}}) : null;
const bucket = cfg.bucket || 'travel-photos';
let user = null, busy = 0, reloading = false, pending = false, timer = null, channel = null;
let photoPaths = new Map(); // signed URL -> private object path; never save signed URLs in SQL
const $ = id => document.getElementById(id);
function status(msg, type='info') {
 const s = $('cloudStatus'); if (s) {s.textContent = msg; s.dataset.status = type;}
}
function errorMessage(e) { return (e && e.message) || String(e || '알 수 없는 오류'); }
function assertReady() { if (!client || !user) throw Error('먼저 로그인해 주세요.'); }
function check(r) { if (r.error) throw r.error; return r.data; }
const wait = ms => new Promise(res=>setTimeout(res,ms));
async function locked(fn) {
 assertReady(); busy++; status('☁ 저장 중…');
 try {const result=await fn();status('✓ 클라우드 저장 완료','ok');return result;}
 catch(e){status('⚠ 동기화 실패','error'); alert('클라우드에 저장하지 못했습니다.\n'+errorMessage(e)+'\n인터넷 연결과 계정 권한을 확인해 주세요.');throw e;}
 finally {busy--;if(!busy && pending){pending=false;scheduleRefresh();}}
}
function screen(locked) {$('cloudGate').classList.toggle('hidden',!locked);}
function noteDirty() { return mode==='edit' && !!selected; }
function scheduleRefresh(){clearTimeout(timer);timer=setTimeout(async()=>{if(busy||reloading){pending=true;return;}if(noteDirty()){status('다른 기기 변경 감지 · 편집 종료 후 새로고침','warn');pending=true;return;}try{await refresh();}catch(e){status('⚠ 새로고침 실패','error');}},900);}
function userPhotoPath(trip){return `${user.id}/${trip}/${crypto.randomUUID()}.jpg`;}
async function urlFor(path){const r=await client.storage.from(bucket).createSignedUrl(path,60*60*12);return check(r).signedUrl;}
function dataBlob(uri){const [head,b64]=uri.split(',');if(!/^data:image\/jpeg;base64$/i.test(head))throw Error('JPEG 형식의 사진만 업로드할 수 있습니다.');const binary=atob(b64),arr=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)arr[i]=binary.charCodeAt(i);return new Blob([arr],{type:'image/jpeg'});}
async function uploadPhoto(uri,trip){const blob=dataBlob(uri),path=userPhotoPath(trip);check(await client.storage.from(bucket).upload(path,blob,{contentType:'image/jpeg',upsert:false}));return path;}
async function getRows(table){return check(await client.from(table).select('*').eq('user_id',user.id));}
async function refresh(){
 assertReady();if(busy){pending=true;return;} reloading=true;status('☁ 최신 여행 기록 불러오는 중…');
 try{
  const [trips,photos,colors]=await Promise.all([getRows('trips'),getRows('trip_photos'),getRows('region_colors')]);
  const byTrip=new Map(),newMap=new Map();
  for(const p of photos.sort((a,b)=>a.sort_order-b.sort_order)){
   let arr=byTrip.get(p.trip_id)||[];
   try{const url=await urlFor(p.storage_path);arr.push(url);newMap.set(url,p.storage_path);}catch(e){console.warn('사진 URL 생성 실패',p.storage_path,e);}
   byTrip.set(p.trip_id,arr);
  }
  photoPaths=newMap;
  db={entries:trips.map(t=>({id:t.id,region:t.region,title:t.title,date:t.visit_date||'',tag:t.tag||'',note:t.note||'',photos:byTrip.get(t.id)||[],_updated_at:t.updated_at})),
      colors:Object.fromEntries(colors.map(c=>[c.region,c.color]))};
  // Do not overwrite the original browser-only data; cloud mode is separate.
  selected=null;editing=null;mode='timeline';color=COLORS[0];updateStats();showMemo();updateMapColors();drawPins();
  status('✓ 모든 기기와 동기화됨','ok');
 }finally{reloading=false;}
}
async function saveEntry(x,old){return locked(async()=>{
 const existing=old?check(await client.from('trips').select('updated_at').eq('id',old.id).eq('user_id',user.id).single()):null;
 // Preserve a fingerprint from the last fetched record; detect edits from other devices.
 if(old && old._updated_at && existing.updated_at!==old._updated_at)throw Error('다른 기기에서 수정된 기록입니다. 목록을 새로고침한 뒤 다시 수정해 주세요.');
 const desiredPaths=[],uploaded=[];let photosCommitted=false;
 try{
  for(const uri of x.photos){const known=photoPaths.get(uri);if(known)desiredPaths.push(known);else if(/^data:image\/jpeg;base64,/i.test(uri)){let path=await uploadPhoto(uri,x.id);desiredPaths.push(path);uploaded.push(path);}else throw Error('사진을 확인할 수 없습니다. 다시 선택해 주세요.');}
  const fields={id:x.id,user_id:user.id,region:x.region,title:x.title,visit_date:x.date||null,tag:x.tag||'',note:x.note||'',updated_at:new Date().toISOString()};
  check(await client.from('trips').upsert(fields,{onConflict:'id'}));
  const previous=old?check(await client.from('trip_photos').select('storage_path').eq('user_id',user.id).eq('trip_id',x.id)):[];
  const removed=previous.map(p=>p.storage_path).filter(p=>!desiredPaths.includes(p));
  // Replace photo metadata with new order; do not delete original objects before metadata succeeds.
  check(await client.from('trip_photos').delete().eq('user_id',user.id).eq('trip_id',x.id));
  if(desiredPaths.length) check(await client.from('trip_photos').insert(desiredPaths.map((path,i)=>({user_id:user.id,trip_id:x.id,storage_path:path,sort_order:i}))));
  photosCommitted=true;
  check(await client.from('region_colors').upsert({user_id:user.id,region:x.region,color:x.color},{onConflict:'user_id,region'}));
  if(removed.length) {const r=await client.storage.from(bucket).remove(removed);if(r.error)console.warn('삭제된 사진 파일 정리 필요',r.error);}
  await refreshAfterWrite();
 }catch(e){if(uploaded.length && !photosCommitted){await client.storage.from(bucket).remove(uploaded).catch(()=>{});}throw e;}
});}
async function refreshAfterWrite(){// Busy guard prevents refresh in locked(); defer until unlocked.
 pending=true;
}
async function setColor(region,c){return locked(async()=>{if(c){check(await client.from('region_colors').upsert({user_id:user.id,region,color:c},{onConflict:'user_id,region'}));}else check(await client.from('region_colors').delete().eq('user_id',user.id).eq('region',region));pending=true;});}
async function deleteEntry(id){return locked(async()=>{
 const paths=check(await client.from('trip_photos').select('storage_path').eq('user_id',user.id).eq('trip_id',id)).map(p=>p.storage_path);
 check(await client.from('trips').delete().eq('user_id',user.id).eq('id',id));
 if(paths.length){const r=await client.storage.from(bucket).remove(paths);if(r.error)console.warn('기록 삭제 후 사진 파일 정리 필요',r.error);}
 pending=true;
});}
async function resetAll(){return locked(async()=>{
 const rows=await getRows('trip_photos');const paths=rows.map(x=>x.storage_path);
 check(await client.from('trips').delete().eq('user_id',user.id));
 check(await client.from('region_colors').delete().eq('user_id',user.id));
 if(paths.length){for(let i=0;i<paths.length;i+=50)check(await client.storage.from(bucket).remove(paths.slice(i,i+50)));}
 pending=true;
});}
async function signedToData(path){const data=check(await client.storage.from(bucket).download(path));return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(data);});}
async function exportBackup(){return locked(async()=>{
 status('☁ 사진 포함 전체 백업 생성 중…');const [trips,photos,colors]=await Promise.all([getRows('trips'),getRows('trip_photos'),getRows('region_colors')]);
 let entries=[];for(const t of trips){const imgs=[];for(const p of photos.filter(p=>p.trip_id===t.id).sort((a,b)=>a.sort_order-b.sort_order)){imgs.push(await signedToData(p.storage_path));}
 entries.push({id:t.id,region:t.region,title:t.title,date:t.visit_date,tag:t.tag,note:t.note,photos:imgs});}
 const blob=new Blob([JSON.stringify({version:3,entries,colors:Object.fromEntries(colors.map(c=>[c.region,c.color]))})],{type:'application/json'});
 const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='나의_여행_추억_클라우드_전체백업.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 });}
async function importBackup(data){return locked(async()=>{
 if(!Array.isArray(data.entries)||!data.colors||typeof data.colors!=='object'||Array.isArray(data.colors))throw Error('지원하지 않는 JSON 백업 형식입니다.');
 if(!confirm(`여행 ${data.entries.length}개를 클라우드에 가져올까요?\n동일 ID는 덮어쓰며, 클라우드의 다른 기록은 보존됩니다.`))return;
 let done=0;
 for(const e of data.entries){
  if(!e.id||!e.region)throw Error('백업에 필수 ID 또는 지역이 없습니다.');
  const prev=check(await client.from('trip_photos').select('storage_path').eq('user_id',user.id).eq('trip_id',e.id));
  const previousPaths=prev.map(p=>p.storage_path),newPaths=[];
  try{
   for(const uri of e.photos||[]){if(!/^data:image\/jpeg;base64,/i.test(uri))throw Error('백업 사진은 JPEG Base64 형태여야 합니다.');newPaths.push(await uploadPhoto(uri,e.id));}
   check(await client.from('trips').upsert({id:e.id,user_id:user.id,region:e.region,title:e.title||'',visit_date:e.date||null,tag:e.tag||'',note:e.note||'',updated_at:new Date().toISOString()},{onConflict:'id'}));
   check(await client.from('trip_photos').delete().eq('user_id',user.id).eq('trip_id',e.id));
   if(newPaths.length)check(await client.from('trip_photos').insert(newPaths.map((path,i)=>({user_id:user.id,trip_id:e.id,storage_path:path,sort_order:i}))));
   if(previousPaths.length){const removed=await client.storage.from(bucket).remove(previousPaths);if(removed.error)console.warn('이전 사진 정리 실패',removed.error);}
   done++;status(`☁ 가져오는 중 ${done}/${data.entries.length}`);
  }catch(err){if(newPaths.length)await client.storage.from(bucket).remove(newPaths);throw Error(`여행 ${done+1}번째 가져오기 실패: ${errorMessage(err)}`);}
 }
 const colors=Object.entries(data.colors).filter(([region,color])=>typeof region==='string'&&typeof color==='string').map(([region,color])=>({user_id:user.id,region,color}));
 if(colors.length)check(await client.from('region_colors').upsert(colors,{onConflict:'user_id,region'}));
 pending=true;alert(`여행 ${done}개를 가져왔습니다. 동기화 후 내용을 확인하세요.`);
 });}
async function migrateBrowserData(){
 const raw=localStorage.getItem('travel-scrap-korea-v2');
 if(!raw)return alert('이 브라우저에 이전 버전의 여행 데이터가 없습니다. 예전 기기에서 JSON 파일을 내려받아 불러오세요.');
 const data=JSON.parse(raw);
 if(!Array.isArray(data.entries))return alert('이전 여행 데이터 형식을 확인할 수 없습니다.');
 await importBackup(data); await refresh();
 // Deliberately preserve the old browser-only data for recovery.
}
function subscribe(){if(channel)client.removeChannel(channel);channel=client.channel('travel-updates');for(const table of ['trips','trip_photos','region_colors'])channel.on('postgres_changes',{event:'*',schema:'public',table},()=>{if(!busy)scheduleRefresh();else pending=true;});channel.subscribe();}
// Handles admin invitation callbacks as well as legacy token_hash and PKCE email URLs.
// Never log URLs containing tokens or show those tokens in UI.
function authLinkInfo(){
 const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));
 return {q,h,hasAuthLink:q.has('code')||q.has('token_hash')||h.has('access_token')||h.has('error')||q.has('error')};
}
function safeAuthError(code,description){
 const c=String(code||'').toLowerCase();
 if(c.includes('expired')||c.includes('invalid')||c.includes('otp'))return '초대 링크가 만료되었거나 이미 사용되었습니다. Supabase에서 새로운 초대 링크를 발송해 주세요.';
 return '이메일 링크 인증에 실패했습니다. 링크가 만료되지 않았는지 확인하고 다시 시도해 주세요.';
}
function showAuthHint(msg,problem=false){
 const el=$('cloudHelp'); if(el){el.textContent=msg;el.style.color=problem?'#a44d45':'';}
 if(problem)status('⚠ 이메일 인증 실패','error');
}
async function consumeAuthCallback(){
 const {q,h,hasAuthLink}=authLinkInfo();
 if(!hasAuthLink)return {hasAuthLink:false,session:null};
 const failure=q.get('error')||h.get('error');
 if(failure){const msg=safeAuthError(q.get('error_code')||h.get('error_code')||failure,q.get('error_description')||h.get('error_description'));showAuthHint(msg,true);return {hasAuthLink:true,session:null,error:true};}
 showAuthHint('초대 링크를 확인하고 로그인 중입니다…');
 try{
  // Supabase JS v2 normally consumes implicit #access_token during getSession().
  let r=await client.auth.getSession(); if(r.error)throw r.error;
  if(r.data.session)return {hasAuthLink:true,session:r.data.session};
  if(q.has('token_hash') && q.has('type')){
   const v=await client.auth.verifyOtp({token_hash:q.get('token_hash'),type:q.get('type')});
   if(v.error)throw v.error;
   history.replaceState(null,'',location.pathname);
   return {hasAuthLink:true,session:v.data.session};
  }
  if(q.has('code')){
   const v=await client.auth.exchangeCodeForSession(q.get('code'));
   if(v.error)throw v.error;
   history.replaceState(null,'',location.pathname);
   return {hasAuthLink:true,session:v.data.session};
  }
  if(h.has('access_token') && h.has('refresh_token')){
   const v=await client.auth.setSession({access_token:h.get('access_token'),refresh_token:h.get('refresh_token')});
   if(v.error)throw v.error;
   history.replaceState(null,'',location.pathname);
   return {hasAuthLink:true,session:v.data.session};
  }
  showAuthHint('초대 링크에서 로그인 정보를 확인할 수 없습니다. 이메일의 초대 링크가 올바른지 확인해 주세요.',true);
  return {hasAuthLink:true,session:null,error:true};
 }catch(e){
  console.warn('Invitation callback failed:',e?.name||'AuthError');
  showAuthHint(safeAuthError(e?.code,e?.message),true);
  return {hasAuthLink:true,session:null,error:true};
 }
}
async function signin(){const email=$('cloudEmail').value.trim();if(!email)return alert('이메일을 입력해 주세요.');
 const r=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+location.pathname}});
 if(r.error)alert('로그인 링크를 보낼 수 없습니다: '+errorMessage(r.error));else alert('등록된 이메일이라면 로그인 링크가 발송됩니다. 메일을 확인해 주세요.');}
async function logout(){if(channel){await client.removeChannel(channel);channel=null;}await client.auth.signOut();user=null;db={entries:[],colors:{}};photoPaths.clear();showTimeline();updateStats();updateMapColors();drawPins();status('로그인 필요');screen(true);}
async function activate(session){if(!session?.user){user=null;screen(true);status('로그인 필요');return;}user=session.user;screen(false);$('cloudAccount').textContent=user.email||'로그인됨';await refresh();subscribe();}
async function init(){
 $('cloudLogin').onclick=()=>{if(!client)return alert('먼저 supabase-config.js에 프로젝트 URL과 공개용 키를 입력하세요.');signin();};
 $('cloudLogout').onclick=logout;
 $('browserImport').onclick=()=>migrateBrowserData().catch(e=>alert('기존 브라우저 데이터 이전 실패: '+errorMessage(e))); 
 $('cloudRefresh').onclick=()=>{if(noteDirty())return alert('작성 중인 내용을 저장하거나 편집을 종료한 다음 새로고침하세요.');refresh().catch(e=>alert(errorMessage(e)));};
 if(!client){screen(true);status('Supabase 연결 설정 필요','error');$('cloudHelp').textContent='supabase-config.js에 프로젝트 URL과 publishable key를 입력하세요.';return;}
 $('cloudHelp').textContent='초대 메일의 링크를 클릭하면 로그인됩니다. 가입된 계정은 로그인 링크를 다시 받을 수도 있습니다.';
 // Register listener before reading the session; defer async work outside auth callback.
 client.auth.onAuthStateChange((_event,session)=>{if(session?.user?.id===user?.id)return;setTimeout(()=>activate(session).catch(e=>{status('⚠ 연결 오류','error');showAuthHint('로그인은 확인됐지만 데이터를 불러오지 못했습니다: '+errorMessage(e),true);}),0);});
 const callback=await consumeAuthCallback();
 if(callback.session){await activate(callback.session);}
 else {
  const {data,error}=await client.auth.getSession();
  if(error){status('⚠ 로그인 상태 확인 실패','error');showAuthHint('로그인 상태를 확인하지 못했습니다: '+errorMessage(error),true);return;}
  await activate(data.session);
  if(!data.session && callback.error)status('⚠ 초대 링크 인증 실패','error');
 }
 window.addEventListener('focus',()=>{if(user&&!noteDirty())scheduleRefresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user&&!noteDirty())scheduleRefresh();});
}
window.travelCloud={saveEntry,setColor,deleteEntry,resetAll,exportBackup,importBackup,refresh,init};
})();
