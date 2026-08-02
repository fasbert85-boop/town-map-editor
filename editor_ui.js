// editor_ui.js
import { parseTownMap, serializeTownMap } from './pbs_parser.js';

let _t = s => s;
export function setI18n(tFn) { _t = tFn; }
const imageCache = new Map();
let cachedGameRoot = null;

export function clearTownMapCache() {

  for (const url of imageCache.values()) {
    URL.revokeObjectURL(url);
  }
  imageCache.clear();
  cachedGameRoot = null;
}

export function mountTownMapEditor(ctx, host) {
  const GRID_SIZE = 16;
  
  let regions = [];
  let activeRegion = null;
  let selectedPoint = null;


  let zoom = 1;
  let imgWidth = 0;
  let imgHeight = 0;
  let isPanning = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let isDraggingPoint = false;
  let isSpaceDown = false;

    const MAX_HISTORY = 50;
  const undoStack = [];
  const redoStack = [];
  let dragSnapshotPushed = false; 
  
  function cloneRegions(src) {
    return src.map(r => ({
      id: r.id,
      name: r.name,
      filename: r.filename,
      points: r.points.map(p => ({ ...p }))
    }));
  }

  function selectionIndices() {
    if (!activeRegion || !selectedPoint) return null;
    const rIdx = regions.indexOf(activeRegion);
    if (rIdx === -1) return null;
    const pIdx = activeRegion.points.indexOf(selectedPoint);
    return { rIdx, pIdx };
  }

  function applySnapshot(snap) {
    // 1. Guardamos el nombre de la imagen ANTES de aplicar el undo
    const oldFilename = activeRegion ? activeRegion.filename : null;

    regions = cloneRegions(snap.regions);
    const sel = snap.sel;
    if (sel && sel.rIdx >= 0 && sel.rIdx < regions.length) {
      activeRegion = regions[sel.rIdx];
      if (sel.pIdx >= 0 && sel.pIdx < activeRegion.points.length) {
        selectedPoint = activeRegion.points[sel.pIdx];
      } else {
        selectedPoint = null;
      }
    } else {
      activeRegion = regions.length > 0 ? regions[Math.min(sel?.rIdx ?? 0, regions.length - 1)] : null;
      selectedPoint = null;
    }

    if (typeof host.updateRegionSelect === 'function') host.updateRegionSelect();
    const selEl = host.querySelector('#tme-region-select');
    if (selEl) selEl.value = regions.indexOf(activeRegion);
    renderPoints();
    renderSidebar();
    
    // 2. Comparamos si la imagen DESPUÉS del undo es diferente
    const newFilename = activeRegion ? activeRegion.filename : null;
    
    // 3. Solo recargamos si realmente cambió la región o el background
    if (activeRegion && oldFilename !== newFilename) {
      loadRegionImage(activeRegion);
    }
    
    updateUndoRedoButtons();
  }
    function pushUndo() {
    undoStack.push({
      regions: cloneRegions(regions),
      sel: selectionIndices()
    });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // cualquier mutacion nueva invalida el redo
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push({
      regions: cloneRegions(regions),
      sel: selectionIndices()
    });
    const snap = undoStack.pop();
    applySnapshot(snap);
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push({
      regions: cloneRegions(regions),
      sel: selectionIndices()
    });
    const snap = redoStack.pop();
    applySnapshot(snap);
  }

  function updateUndoRedoButtons() {
    const bU = host.querySelector('#tme-btn-undo');
    const bR = host.querySelector('#tme-btn-redo');
    if (bU) bU.disabled = undoStack.length === 0;
    if (bR) bR.disabled = redoStack.length === 0;
  }

  host.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); color: var(--text-primary); font-family: inherit;">
      
      <div style="padding: 8px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; z-index: 100;">
        <select id="tme-region-select" style="background: var(--input-bg); color: var(--text-primary); border: 1px solid var(--border); padding: 4px; border-radius: 4px; min-width: 150px; outline: none;"></select>
        <button id="tme-btn-save" style="background: var(--accent); color: var(--accent-text); border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">${_t('Save PBS')}</button>
        <div style="margin-left: auto; font-size: 11px; color: var(--text-secondary);">
          <span id="tme-zoom-level">${_t('Zoom')}: 100%</span>
        </div>
      </div>

      <div style="display: flex; flex: 1; overflow: hidden; position: relative;">
        
        <div id="tme-viewport" style="flex: 2; overflow: auto; background: var(--canvas-bg); position: relative; cursor: crosshair;">
                  <style>@keyframes tme-spin { to { transform: rotate(360deg); } }</style>
          <div id="tme-loader" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 50; justify-content: center; align-items: center; backdrop-filter: blur(2px);">
            <div style="width: 40px; height: 40px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tme-spin 0.8s linear infinite;"></div>
          </div>

          <div id="tme-layout-spacer" style="position: absolute; top: 0; left: 0; pointer-events: none;"></div>

          <div id="tme-map-container" style="position: absolute; top: 0; left: 0; user-select: none; transform-origin: 0 0;">
           <img id="tme-map-img" style="display: block; width: 100%; height: 100%; image-rendering: pixelated;" alt="${_t('Town Map')}" draggable="false" />
            
            <div id="tme-points-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
              background-image: linear-gradient(to right, rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.15) 1px, transparent 1px);
              background-size: 16px 16px;">
            </div>
          </div>

        </div>

        <div id="tme-tooltip" style="display: none; position: absolute; background: rgba(0,0,0,0.85); 
        color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px; pointer-events: none; z-index: 1000; 
        box-shadow: 0 2px 8px rgba(0,0,0,0.5); white-space: nowrap;">
        </div>

        <div style="flex: 1; min-width: 250px; max-width: 300px; border-left: 1px solid var(--border); padding: 16px; background: var(--bg-secondary); overflow-y: auto; z-index: 100;">
          <div id="tme-properties"></div>
        </div>

      </div>
    </div>
  `;

  const viewport = host.querySelector('#tme-viewport');
  const layoutSpacer = host.querySelector('#tme-layout-spacer');
  const mapContainer = host.querySelector('#tme-map-container');
  const pointsLayer = host.querySelector('#tme-points-layer');
  const propertiesPanel = host.querySelector('#tme-properties');
  const tooltip = host.querySelector('#tme-tooltip');
  const imgElement = host.querySelector('#tme-map-img');
  const loaderElement = host.querySelector('#tme-loader');



  (async () => {
    try {
      const pbsText = await ctx.fs.readProjectFile("PBS/town_map.txt");
      regions = parseTownMap(pbsText);
      
      const select = host.querySelector('#tme-region-select');
      const updateSelect = () => {
        select.innerHTML = '';
        regions.forEach((r, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = `[${r.id}] ${r.name || _t('Unnamed')}`;
          select.appendChild(option);
        });
        if (activeRegion) select.value = regions.indexOf(activeRegion);
      };
      
      updateSelect();
      host.updateRegionSelect = updateSelect;

      select.addEventListener('change', (e) => {
        activeRegion = regions[e.target.value];
        selectedPoint = null;
        zoom = 1;
        loadRegionImage(activeRegion);
      });
      
      if (regions.length > 0) {
        activeRegion = regions[0];
        loadRegionImage(activeRegion);
      }
    } catch (err) {
      ctx.ui.showToast({ message: _t("PBS/town_map.txt not found"), level: "error" });
    }
  })();

imgElement.onload = () => {
    imgWidth = imgElement.naturalWidth;
    imgHeight = imgElement.naturalHeight;
    updateZoom();
    renderPoints();
    loaderElement.style.display = 'none';
    imgElement.style.opacity = '1';
  };

  imgElement.onerror = () => {
    loaderElement.style.display = 'none';
    ctx.ui.showToast({ message: _t("Error decoding image data."), level: "error" });
  }; 

  async function findFileRecursive(dirPath, filename) {
    let entries;
    try {
      entries = await window.__TAURI__.core.invoke("list_directory", { path: dirPath });
    } catch (e) {
      return null;
    }
    if (!entries || !Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (entry.name === filename && entry.path) return entry.path;
    }
    for (const entry of entries) {
      if (entry.path && entry.path !== dirPath) {
        const found = await findFileRecursive(entry.path, filename);
        if (found) return found;
      }
    }
    return null;
  }

  async function loadRegionImage(region) {
    if (!region || !region.filename) return;
    const gameRoot = ctx.editor.gameRoot();
    if (!gameRoot) return;

      if (cachedGameRoot !== gameRoot) {
      clearTownMapCache();
      cachedGameRoot = gameRoot;
    }
      if (imageCache.has(region.filename)) {
      imgElement.src = imageCache.get(region.filename);
      renderSidebar();
      return;
    }
    loaderElement.style.display = 'flex';
    imgElement.style.opacity = '0';



    const basePath = `${gameRoot}/Graphics/UI/Town Map`;
    let filePath = null;

    try {
      const exists = await window.__TAURI__.core.invoke("file_exists", {
        path: `${basePath}/${region.filename}`
      });
      if (exists) {
        filePath = `${basePath}/${region.filename}`;
      }
    } catch (e) {}

    if (!filePath) {
      filePath = await findFileRecursive(basePath, region.filename);
    }

    if (!filePath) {
      loaderElement.style.display = 'none'; 
      ctx.ui.showToast({ message: `${_t('Image not found')}: ${region.filename}`, level: "error" });
      return;
    }

    try {
      const bytes = await window.__TAURI__.core.invoke("read_binary_file", { path: filePath });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });

      const blobUrl = URL.createObjectURL(blob);
      imageCache.set(region.filename, blobUrl);
      imgElement.src = blobUrl;
      renderSidebar();
        
  } catch(err) {
      loaderElement.style.display = 'none';
      ctx.ui.showToast({ message: `${_t('Error loading image')}: ${region.filename}`, level: "error" });

}
}
    


  function updateZoom() {
    host.querySelector('#tme-zoom-level').textContent = `${_t('Zoom')}: ${Math.round(zoom * 100)}%`;
    

    layoutSpacer.style.width = `${imgWidth * zoom}px`;
    layoutSpacer.style.height = `${imgHeight * zoom}px`;
    

    mapContainer.style.width = `${imgWidth}px`;
    mapContainer.style.height = `${imgHeight}px`;
    mapContainer.style.transform = `scale(${zoom})`;
  }

  viewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault(); 
      
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      const oldZoom = zoom;
      zoom = Math.max(0.5, Math.min(4, zoom + zoomDelta));

      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const scrollX = viewport.scrollLeft;
      const scrollY = viewport.scrollTop;
      
      updateZoom();
      
      viewport.scrollLeft = ((scrollX + mouseX) * (zoom / oldZoom)) - mouseX;
      viewport.scrollTop = ((scrollY + mouseY) * (zoom / oldZoom)) - mouseY;
    }
  });

  function renderPoints() {
    pointsLayer.innerHTML = '';
    if (!activeRegion) return;

    activeRegion.points.forEach(pt => {
      const isSelected = (selectedPoint === pt);
      const div = document.createElement('div');
      
      div.style.position = 'absolute';
      
      div.style.left = `${pt.x * GRID_SIZE}px`;
      div.style.top = `${pt.y * GRID_SIZE}px`;
      div.style.width = `${GRID_SIZE}px`;
      div.style.height = `${GRID_SIZE}px`;
      div.style.boxSizing = 'border-box';
      div.style.pointerEvents = 'none';
      
      if (isSelected) {
        div.style.border = '1px solid var(--accent)';
        div.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
        div.style.boxShadow = '0 0 8px var(--accent)';
        div.style.zIndex = '10';
      } else {
        div.style.border = '1px solid rgba(255, 255, 255, 0.8)';
        div.style.backgroundColor = 'rgba(68, 249, 252, 0.14)';
        div.style.zIndex = '1';
      }

      pointsLayer.appendChild(div);
    });
  }

  function renderSidebar() {
    if (!activeRegion) return;

    let html = `
      <h3 style="margin-top: 0; margin-bottom: 12px; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">${_t('Current Region')}</h3>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border);">
        <div>
          <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('REGION NAME')}</label>
          <input type="text" id="reg-name" value="${activeRegion.name}" style="width: 100%; box-sizing: border-box; background: var(--input-bg); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; margin-top: 4px;" />
        </div>
        <div>
          <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('MAP IMAGE')}</label>
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <input type="text" disabled value="${activeRegion.filename}" style="flex: 1; min-width: 0; background: var(--bg-tertiary); color: var(--text-tertiary); border: 1px solid var(--border); padding: 6px; border-radius: 4px;" />
            <button id="reg-pick-graphic" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; cursor: pointer;" title="${_t('Change Image')}">⟲</button>
          </div>
        </div>
      </div>
      
      <h3 style="margin-top: 0; margin-bottom: 12px; color: var(--text-secondary); font-size: 12px; text-transform: uppercase;">${_t('Point Properties')}</h3>
    `;

    if (!selectedPoint) {
      html += `<p style="color: var(--text-tertiary); font-size: 13px; text-align: center; margin-top: 20px;">${_t('Select a point with a')} <b>${_t('click')}</b>.<br><br><b>${_t('Double-click')}</b> ${_t('on an empty space to create a new one.')}.<br><br><b>${_t('Drag')}</b> ${_t('a point to move it.')}.</p>`;
      propertiesPanel.innerHTML = html;
    } else {
      const hasFly = selectedPoint.healingMap !== "" && selectedPoint.healingMap !== undefined;
      const hasSwitch = selectedPoint.switchId !== "" && selectedPoint.switchId !== undefined;

      let flyDisplayName = "";
      if (hasFly) {
        const mapId = parseInt(selectedPoint.healingMap, 10);
        const maps = ctx.projectData.maps(); 
        const mapData = maps.find(m => m.id === mapId);
        const mapName = mapData ? mapData.name : _t("Unknown Map"); // <-- AQUÍ
        flyDisplayName = `[${mapId}] ${mapName} (${selectedPoint.healingX}, ${selectedPoint.healingY})`;
      }

      let switchDisplayName = "";
      if (hasSwitch) {
        const swId = parseInt(selectedPoint.switchId, 10);
        const switchNames = ctx.projectData.switchNames();
        const swName = switchNames[swId] || _t("Unnamed");
        switchDisplayName = `[${swId}] ${swName}`;
      }

      html += `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('COORDINATES')} (X, Y)</label>
            <input type="text" id="pt-coords" disabled value="${selectedPoint.x}, ${selectedPoint.y}" style="width: 100%; box-sizing: border-box; background: var(--bg-tertiary); color: var(--text-tertiary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; margin-top: 4px;" />
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('PLACE NAME')}</label>
            <input type="text" id="pt-name" value="${selectedPoint.name}" placeholder="" style="width: 100%; box-sizing: border-box; background: var(--input-bg); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; margin-top: 4px;" />
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('POINT OF INTEREST')}</label>
            <input type="text" id="pt-poi" value="${selectedPoint.poi}" placeholder="" style="width: 100%; box-sizing: border-box; background: var(--input-bg); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; margin-top: 4px;" />
          </div>
          
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('FLY DESTINATION')}</label>
            ${hasFly ? `
              <div style="display: flex; gap: 4px; margin-top: 4px;">
                <button id="pt-pick-coord" style="flex: 1; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${flyDisplayName}">
                  ${flyDisplayName}
                </button>
                 <button id="pt-clear-coord" style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 0 12px; cursor: pointer;" title="${_t('Remove Destination')}">✖</button>
              </div>
            ` : `
              <button id="pt-pick-coord" style="width: 100%; margin-top: 4px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s;">
                 ${_t('Assign fly point')}
              </button>
            `}
          </div>

          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--text-secondary);">${_t('SWITCH')}</label>
            ${hasSwitch ? `
              <div style="display: flex; gap: 4px; margin-top: 4px;">
                <button id="pt-pick-switch" style="flex: 1; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${switchDisplayName}">
                  ${switchDisplayName}
                </button>
                 <button id="pt-clear-switch" style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 0 12px; cursor: pointer;" title="${_t('Remove Switch')}">✖</button>
              </div>
            ` : `
              <button id="pt-pick-switch" style="width: 100%; margin-top: 4px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s;">
                 ${_t('Assign Switch')}
              </button>
            `}
          </div>

          <button id="pt-delete" style="margin-top: 16px; background: transparent; color: var(--danger); border: 1px solid var(--danger); padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold;">
            ${_t('Delete Point')}
          </button>
        </div>
      `;
      propertiesPanel.innerHTML = html;
    }
  }

  function getGridCoords(e) {
    const rect = mapContainer.getBoundingClientRect(); 
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    return {
      x: Math.floor(clickX / (GRID_SIZE * zoom)),
      y: Math.floor(clickY / (GRID_SIZE * zoom))
    };
  }

  viewport.addEventListener('mousedown', (e) => {
    if (!activeRegion) return;


    if (e.button === 1 || e.altKey) {
      e.preventDefault(); 
      isPanning = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      viewport.style.cursor = 'grabbing';
      return;
    }


    if (e.button === 0 && isSpaceDown) {
      e.preventDefault();
      isPanning = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      viewport.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      const grid = getGridCoords(e);
      const existingPoint = activeRegion.points.find(p => p.x === grid.x && p.y === grid.y);

      if (existingPoint) {
        selectedPoint = existingPoint;
        isDraggingPoint = true;
        dragSnapshotPushed = false;
      } else {
        selectedPoint = null;
      }
      renderPoints();
      renderSidebar();
    }
  });

  const onMouseMove = (e) => {
    if (isPanning) {

      viewport.scrollLeft -= (e.clientX - lastMouseX);
      viewport.scrollTop  -= (e.clientY - lastMouseY);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      return;
    }

    if (isDraggingPoint && selectedPoint) {
      const grid = getGridCoords(e);
      const collision = activeRegion.points.find(p => p !== selectedPoint && p.x === grid.x && p.y === grid.y);
      
      if (!collision && (selectedPoint.x !== grid.x || selectedPoint.y !== grid.y)) {
        if (!dragSnapshotPushed) { pushUndo(); dragSnapshotPushed = true; }
        selectedPoint.x = grid.x;
        selectedPoint.y = grid.y;
        renderPoints();
        const coordInput = host.querySelector('#pt-coords');
        if (coordInput) coordInput.value = `${grid.x}, ${grid.y}`;
      }
    }

    // Tooltips
    if (!isDraggingPoint && !isPanning && activeRegion) {
      const rect = viewport.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const grid = getGridCoords(e);
        const hoverPt = activeRegion.points.find(p => p.x === grid.x && p.y === grid.y);
        
        if (hoverPt) {
          const parentRect = tooltip.parentElement.getBoundingClientRect();
          tooltip.style.display = 'block';
          tooltip.style.left = (e.clientX - parentRect.left + 15) + 'px';
          tooltip.style.top = (e.clientY - parentRect.top + 15) + 'px';
          tooltip.innerHTML = `<strong style="color: var(--accent);">${hoverPt.name || _t('Unnamed')}</strong>${hoverPt.poi ? `<br/>${hoverPt.poi}` : ''}`;
        } else {
          tooltip.style.display = 'none';
        }
      } else {
        tooltip.style.display = 'none';
      }
    }
  };

  const onMouseUp = () => {
    isPanning = false;
    isDraggingPoint = false;
    viewport.style.cursor = 'crosshair';
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);



  const onKeyDown = (e) => {

    if (!host.isConnected) return;


    if (e.code === 'Space' && !isSpaceDown) {

      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        isSpaceDown = true;
        viewport.style.cursor = 'grab';
        e.preventDefault(); 
      }
    }

    const key = e.key.toLowerCase();

    if (e.ctrlKey && key === 'z') {
      e.preventDefault();
      undo();
    }

    if (e.ctrlKey && key === 'y') {
      e.preventDefault();
      redo();
    }
    
    if (e.ctrlKey && key === 's') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      const saveBtn = host.querySelector('#tme-btn-save');
      if (saveBtn) saveBtn.click();
    }

    if (e.key === 'Delete' && selectedPoint) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const deleteBtn = host.querySelector('#pt-delete');
      if (deleteBtn) deleteBtn.click();
    }
  };

  const onKeyUp = (e) => {
    if (!host.isConnected) return;
    if (e.code === 'Space') {
      isSpaceDown = false;

      if (!isPanning) viewport.style.cursor = 'crosshair';
    }
  };
    

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });


  viewport.addEventListener('mouseup', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  viewport.addEventListener('dblclick', (e) => {
    if (!activeRegion || e.button !== 0 || e.altKey) return;
    const grid = getGridCoords(e);
    const existingPoint = activeRegion.points.find(p => p.x === grid.x && p.y === grid.y);

    if (!existingPoint) {
      pushUndo();
      const newPoint = { x: grid.x, y: grid.y, name: "", poi: "", healingMap: "", healingX: "", healingY: "", switchId: "" };
      activeRegion.points.push(newPoint);
      selectedPoint = newPoint;
      
      renderPoints();
      renderSidebar();
      setTimeout(() => host.querySelector('#pt-name')?.focus(), 50);
    }
  });

  host.querySelector('#tme-btn-save').addEventListener('click', async () => {
    try {
      const newPbs = serializeTownMap(regions);
      await ctx.fs.writeProjectFile("PBS/town_map.txt", newPbs);
      ctx.ui.showToast({ message: _t("town_map.txt saved successfully."), level: "info" });
    } catch (err) {
      ctx.log.error(err);
      ctx.ui.showToast({ message: _t("Error saving town_map.txt"), level: "error" });
    }
  });

  return () => {
    
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
  };
}
