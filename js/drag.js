// ---------- Free-form drag (Lucidspark-style sticky dragging) ----------

let pendingDrag = null; // captured on pointerdown, before the move threshold is met
let dragCtx = null;     // populated once an actual drag begins

function onCardPointerDown(e){
  if(e.target.closest('button')) return; // let icon / move buttons behave normally
  const cardEl = e.target.closest('.card');
  if(!cardEl) return;
  const zoneEl = cardEl.closest('.dropzone');
  if(!zoneEl) return;
  const rect = cardEl.getBoundingClientRect();
  pendingDrag = {
    id: cardEl.dataset.id,
    startX: e.clientX,
    startY: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', onDocPointerUp, { once:true });
}

function onDocPointerMove(e){
  if(!pendingDrag) return;

  if(!dragCtx){
    const dx = e.clientX - pendingDrag.startX;
    const dy = e.clientY - pendingDrag.startY;
    if(Math.hypot(dx, dy) < 4) return; // not a drag yet, just a click/tap

    const original = document.querySelector(`.card[data-id="${pendingDrag.id}"]`);
    if(!original){ pendingDrag = null; return; }

    const ghost = original.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.left = (e.clientX - pendingDrag.offsetX) + 'px';
    ghost.style.top = (e.clientY - pendingDrag.offsetY) + 'px';
    ghost.style.width = pendingDrag.width + 'px';
    document.body.appendChild(ghost);

    original.classList.add('dragging-source');
    document.body.classList.add('no-select');

    dragCtx = Object.assign({}, pendingDrag, { ghost, original });
  }

  dragCtx.ghost.style.left = (e.clientX - dragCtx.offsetX) + 'px';
  dragCtx.ghost.style.top = (e.clientY - dragCtx.offsetY) + 'px';

  document.querySelectorAll('.dropzone.dragover').forEach(z=>z.classList.remove('dragover'));
  const hoverZone = document.elementFromPoint(e.clientX, e.clientY);
  const hoverDropzone = hoverZone && hoverZone.closest('.dropzone');
  if(hoverDropzone) hoverDropzone.classList.add('dragover');
}

function onDocPointerUp(e){
  document.removeEventListener('pointermove', onDocPointerMove);
  document.body.classList.remove('no-select');
  document.querySelectorAll('.dropzone.dragover').forEach(z=>z.classList.remove('dragover'));

  if(!dragCtx){ pendingDrag = null; return; } // was just a click/tap

  const { id, ghost, original, offsetX, offsetY, width } = dragCtx;
  ghost.remove();
  original.classList.remove('dragging-source');

  const targetEl = document.elementFromPoint(e.clientX, e.clientY);
  const targetZone = targetEl && targetEl.closest('.dropzone');
  const cat = state.categories.find(c=>c.id===id);

  if(cat && targetZone){
    const canvas = targetZone.querySelector('.canvas');
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left - offsetX;
    let y = e.clientY - rect.top - offsetY;
    x = Math.max(0, Math.min(x, Math.max(0, canvas.clientWidth - width)));
    y = Math.max(0, y);
    cat.x = Math.round(x);
    cat.y = Math.round(y);
    cat.location = targetZone.dataset.zone;
    queueSave();
  }

  dragCtx = null;
  pendingDrag = null;
  render();
}
