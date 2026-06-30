// ---------- Persistence ----------
// Uses Claude's cloud storage (window.storage) when available so scenarios can
// be shared; otherwise falls back to this browser's localStorage.

const HAS_CLOUD_STORAGE = !!(window.storage && typeof window.storage.get === 'function' && typeof window.storage.set === 'function');

function lsGet(key){
  try{ return localStorage.getItem('budget:'+key); }catch(e){ return null; }
}
function lsSet(key, value){
  try{ localStorage.setItem('budget:'+key, value); return true; }catch(e){ console.error('local save failed', key, e); return false; }
}
function lsDelete(key){
  try{ localStorage.removeItem('budget:'+key); }catch(e){}
}

async function safeGet(key){
  if(HAS_CLOUD_STORAGE){
    try{
      const res = await window.storage.get(key, true);
      return res ? res.value : null;
    }catch(e){ return null; }
  }
  return lsGet(key);
}
async function safeSet(key, value){
  if(HAS_CLOUD_STORAGE){
    try{ await window.storage.set(key, value, true); return true; }
    catch(e){ console.error('save failed', key, e); return false; }
  }
  return lsSet(key, value);
}
async function safeDelete(key){
  if(HAS_CLOUD_STORAGE){
    try{ await window.storage.delete(key, true); }catch(e){}
    return;
  }
  lsDelete(key);
}
