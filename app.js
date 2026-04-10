/**
 * IndexedDB Service for PixelForge Pro
 * Handles persistent storage of large image data and application state
 */
class IndexedDBService {
    constructor() {
        this.dbName = 'PixelForgeDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
            };
        });
    }

    async saveImage(id, data) {
        return this._performTransaction('images', 'readwrite', (store) => store.put({ id, data }));
    }

    async getImage(id) {
        const result = await this._performTransaction('images', 'readonly', (store) => store.get(id));
        return result ? result.data : null;
    }

    async deleteImage(id) {
        return this._performTransaction('images', 'readwrite', (store) => store.delete(id));
    }

    async saveState(key, value) {
        return this._performTransaction('state', 'readwrite', (store) => store.put({ key, value }));
    }

    async getState(key) {
        const result = await this._performTransaction('state', 'readonly', (store) => store.get(key));
        return result ? result.value : null;
    }

    _performTransaction(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('Database not initialized'));
            const transaction = this.db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

class PixelForgePro {
    constructor() {
        this.db = new IndexedDBService();
        this.currentTheme = 'light';
        this.currentTab = 'layers';
        this.layers = [];
        this.models = [];
        this.visibleOrder = [];
        this.favoritePrompts = [];
        this.layoutMode = 'vertical';
        this.currentLayerId = null;
        this.currentImageId = null;
        this.currentModelId = null;
        this.imageCounter = 0;
        this.modelCounter = 0;
        this.imageCache = new Map();
        
        this.currentPlatform = 'leonardo';
        this.platforms = {
            'midjourney': 'https://www.midjourney.com/',
            'dalle': 'https://labs.openai.com/',
            'leonardo': 'https://leonardo.ai/',
            'playground': 'https://playgroundai.com/'
        };
        this.platformNames = {
            'midjourney': 'Midjourney',
            'dalle': 'DALL-E 3',
            'leonardo': 'Leonardo AI',
            'playground': 'Playground AI'
        };
        this.customPlatforms = [];
        this.isEvolutionPromptEditing = false;
        
        this.init();
    }
    
    async init() {
        try {
            await this.db.init();
            await this.loadFromStorage();
            this.bindEvents();
            this.applyTheme();
            this.renderLayers();
            this.renderModels();
            this.renderPlatformTags();
            this.updateStats();
            this.updateEvolutionPrompt();
            this.handleEvolutionTabVisibility();
            
            // Global click to hide context menus
            document.addEventListener('click', () => this.hideContextMenu());
        } catch (error) {
            console.error('Init error:', error);
        }
    }
    
    bindEvents() {
        const getEl = (id) => document.getElementById(id);

        // Nav
        document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = (e) => {
            this.switchTab(e.currentTarget.dataset.tab);
            // Auto close mobile menu on selection
            const sidebar = getEl('sidebar');
            const overlay = getEl('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        });

        // Mobile Menu Toggle
        if (getEl('mobile-menu-toggle')) getEl('mobile-menu-toggle').onclick = () => {
            const sidebar = getEl('sidebar');
            const overlay = getEl('sidebar-overlay');
            if (sidebar) sidebar.classList.add('active');
            if (overlay) overlay.classList.add('active');
        };

        if (getEl('mobile-menu-close')) getEl('mobile-menu-close').onclick = () => {
            const sidebar = getEl('sidebar');
            const overlay = getEl('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        };

        if (getEl('sidebar-overlay')) getEl('sidebar-overlay').onclick = () => {
            const sidebar = getEl('sidebar');
            const overlay = getEl('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        };
        
        // Theme
        if (getEl('theme-toggle')) getEl('theme-toggle').onclick = () => this.toggleTheme();
        if (getEl('dark-mode-toggle')) getEl('dark-mode-toggle').onchange = (e) => this.toggleTheme(e.target.checked);
        
        // Search
        if (getEl('search-input')) getEl('search-input').oninput = () => this.filterContent();
        
        // Layer
        if (getEl('add-layer-btn')) getEl('add-layer-btn').onclick = () => this.showModal('add-layer-modal');
        if (getEl('create-first-layer')) getEl('create-first-layer').onclick = () => this.showModal('add-layer-modal');
        if (getEl('save-layer-btn')) getEl('save-layer-btn').onclick = () => this.addLayer();
        if (getEl('cancel-layer-btn')) getEl('cancel-layer-btn').onclick = () => this.hideModal('add-layer-modal');
        
        // Image
        if (getEl('browse-image-btn')) getEl('browse-image-btn').onclick = () => getEl('image-file-input').click();
        if (getEl('image-file-input')) getEl('image-file-input').onchange = (e) => {
            if (e.target.files[0] && getEl('selected-image-name')) getEl('selected-image-name').textContent = `Selected: ${e.target.files[0].name}`;
        };
        if (getEl('save-image-btn')) getEl('save-image-btn').onclick = () => this.addImage();
        if (getEl('cancel-image-btn')) getEl('cancel-image-btn').onclick = () => this.hideModal('add-image-modal');
        if (getEl('add-option-btn')) getEl('add-option-btn').onclick = () => this.addOptionToImage('add');
        
        // Model
        if (getEl('add-model-btn')) getEl('add-model-btn').onclick = () => this.showModal('add-model-modal');
        if (getEl('create-first-model')) getEl('create-first-model').onclick = () => this.showModal('add-model-modal');
        if (getEl('save-model-btn')) getEl('save-model-btn').onclick = () => this.addModel();
        if (getEl('cancel-model-btn')) getEl('cancel-model-btn').onclick = () => this.hideModal('add-model-modal');
        
        // Evolution
        if (getEl('refresh-platform')) getEl('refresh-platform').onclick = () => { 
            const frame = getEl('platform-frame');
            if (frame) frame.src = frame.src; 
            this.showToast('Refreshed'); 
        };
        if (getEl('open-platform-tab')) getEl('open-platform-tab').onclick = () => {
            const url = this.platforms[this.currentPlatform] || this.customPlatforms.find(p => p.id === this.currentPlatform)?.url;
            if (url) window.open(url, '_blank');
        };
        if (getEl('copy-all-prompt')) getEl('copy-all-prompt').onclick = () => {
            const display = getEl('evolution-prompt-display');
            if (display) this.copyToClipboard(display.textContent);
        };
        if (getEl('edit-evolution-prompt-btn')) getEl('edit-evolution-prompt-btn').onclick = () => this.toggleEvolutionPromptEdit();
        if (getEl('optimize-prompt')) getEl('optimize-prompt').onclick = () => this.optimizePrompt();
        
        // Actions
        if (getEl('save-btn')) getEl('save-btn').onclick = () => this.exportProject();
        if (getEl('load-btn')) getEl('load-btn').onclick = () => getEl('json-file-input').click();
        if (getEl('json-file-input')) getEl('json-file-input').onchange = (e) => this.importProject(e);
        if (getEl('copy-prompt-btn')) getEl('copy-prompt-btn').onclick = () => {
            const out = getEl('output-text');
            if (out) this.copyToClipboard(out.textContent);
        };
        if (getEl('add-favorite-btn')) getEl('add-favorite-btn').onclick = () => this.addToFavorites();
        if (getEl('show-favorites-btn')) getEl('show-favorites-btn').onclick = () => this.showFavorites();
        if (getEl('uncheck-btn')) getEl('uncheck-btn').onclick = () => this.uncheckAll();
        if (getEl('settings-btn')) getEl('settings-btn').onclick = () => {
            this.showModal('settings-modal');
            const menu = getEl('project-menu-content');
            if (menu) menu.classList.remove('active');
        };

        // Project Menu Toggle
        if (getEl('project-menu-btn')) getEl('project-menu-btn').onclick = (e) => {
            e.stopPropagation();
            const menu = getEl('project-menu-content');
            if (menu) menu.classList.toggle('active');
        };

        document.addEventListener('click', () => {
            const menu = getEl('project-menu-content');
            if (menu) menu.classList.remove('active');
        });
        
        // Modals
        if (getEl('close-settings-btn')) getEl('close-settings-btn').onclick = () => this.hideModal('settings-modal');
        if (getEl('close-favorites-btn')) getEl('close-favorites-btn').onclick = () => this.hideModal('favorites-modal');
        if (getEl('close-gallery-btn')) getEl('close-gallery-btn').onclick = () => this.hideModal('gallery-modal');

        this.setupIframeErrorHandler();
    }

    async exportProject() {
        const state = {
            layers: this.layers,
            models: this.models,
            currentTheme: this.currentTheme,
            imageCounter: this.imageCounter,
            modelCounter: this.modelCounter,
            currentPlatform: this.currentPlatform,
            customPlatforms: this.customPlatforms,
            images: {}
        };

        // Export images from IndexedDB
        for (const layer of this.layers) {
            for (const img of layer.images) {
                const data = await this.db.getImage(img.id);
                if (data) state.images[img.id] = data;
            }
        }

        const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pixelforge_project_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Project exported as JSON');
    }

    async importProject(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const state = JSON.parse(event.target.result);
                
                // Restore state
                this.layers = state.layers || [];
                this.models = state.models || [];
                this.currentTheme = state.currentTheme || 'light';
                this.imageCounter = state.imageCounter || 0;
                this.modelCounter = state.modelCounter || 0;
                this.currentPlatform = state.currentPlatform || 'leonardo';
                this.customPlatforms = state.customPlatforms || [];

                // Restore images to IndexedDB
                if (state.images) {
                    for (const [id, data] of Object.entries(state.images)) {
                        await this.db.saveImage(id, data);
                    }
                }

                this.renderLayers();
                this.renderModels();
                this.updateStats();
                this.applyTheme();
                this.showToast('Project imported successfully');
                this.saveToStorage();
            } catch (err) {
                console.error('Import error:', err);
                this.showToast('Failed to import project', 'error');
            }
        };
        reader.readAsText(file);
    }

    // Context Menu Logic
    showContextMenu(e, id) {
        e.preventDefault();
        this.hideContextMenu();
        const menu = document.getElementById(id);
        if (menu) {
            menu.style.display = 'block';
            menu.style.left = e.pageX + 'px';
            menu.style.top = e.pageY + 'px';
        }
    }

    hideContextMenu() {
        document.querySelectorAll('.context-menu').forEach(m => m.style.display = 'none');
    }

    deleteCurrentImage() {
        if (!confirm('Delete this image?')) return;
        const layer = this.layers[this.currentLayerId];
        const idx = layer.images.findIndex(img => img.id === this.currentImageId);
        if (idx > -1) {
            const img = layer.images[idx];
            layer.images.splice(idx, 1);
            this.db.deleteImage(img.id);
            this.visibleOrder = this.visibleOrder.filter(o => o.id !== img.id);
            this.renderLayerImages(this.currentLayerId);
            this.updateDisplay();
            this.updateStats();
            this.saveToStorage();
        }
    }

    deleteCurrentLayer() {
        if (!confirm('Delete this layer and all its images?')) return;
        const layer = this.layers[this.currentLayerId];
        layer.images.forEach(img => this.db.deleteImage(img.id));
        this.layers.splice(this.currentLayerId, 1);
        this.renderLayers();
        this.updateStats();
        this.saveToStorage();
    }

    // Model Management
    showAddModelModal() {
        this.showModal('add-model-modal');
    }

    async addModel() {
        const name = document.getElementById('model-name-input').value.trim();
        const type = document.getElementById('model-type-input').value;
        const file = document.getElementById('model-image-input').files[0];
        
        if (!name) return this.showToast('Model name is required', 'error');

        let imageData = null;
        if (file) {
            imageData = await new Promise(r => { 
                const rd = new FileReader(); 
                rd.onload = e => r(e.target.result); 
                rd.readAsDataURL(file); 
            });
        }

        const modelId = `model_${Date.now()}`;
        const newModel = { id: modelId, name, type, image: imageData };
        
        this.models.push(newModel);
        this.renderModels();
        this.hideModal('add-model-modal');
        this.saveToStorage();
        this.updateStats();
        this.showToast('Model added');
    }

    // Favorites Logic
    addToFavorites() {
        const prompt = document.getElementById('output-text').textContent;
        if (!prompt || prompt === 'No prompt generated yet.') return;
        
        if (!this.favoritePrompts.includes(prompt)) {
            this.favoritePrompts.push(prompt);
            this.saveToStorage();
            this.showToast('Added to favorites');
        } else {
            this.showToast('Already in favorites', 'info');
        }
    }

    showFavorites() {
        const list = document.getElementById('favorites-list');
        if (!list) return;

        if (this.favoritePrompts.length === 0) {
            list.innerHTML = '<p style="padding:20px;text-align:center;color:gray">No favorites yet.</p>';
        } else {
            list.innerHTML = this.favoritePrompts.map((p, i) => `
                <div class="card mb-4" style="padding:12px;">
                    <div style="font-size:13px;margin-bottom:8px;word-break:break-all;">${p}</div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-primary" onclick="app.copyToClipboard('${p.replace(/'/g, "\\'")}')">Copy</button>
                        <button class="btn btn-sm btn-outline" onclick="app.removeFavorite(${i})">Remove</button>
                    </div>
                </div>
            `).join('');
        }
        this.showModal('favorites-modal');
    }

    removeFavorite(index) {
        this.favoritePrompts.splice(index, 1);
        this.saveToStorage();
        this.showFavorites();
    }

    setupIframeErrorHandler() {
        const iframe = document.getElementById('platform-frame');
        if (!iframe) return;

        iframe.onerror = () => this.showIframeError();
        
        // Periodic check for block since 'error' event often doesn't fire for X-Frame-Options
        setInterval(() => {
            try {
                if (iframe.src && !iframe.src.startsWith('about:blank')) {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                }
            } catch (e) {
                // SecurityError usually means it's blocked by X-Frame-Options or CORS
                this.showIframeError();
            }
        }, 3000);
    }

    showIframeError() {
        const iframe = document.getElementById('platform-frame');
        if (!iframe) return;
        const platformPreview = iframe.parentElement;
        
        let errorDiv = platformPreview.querySelector('.iframe-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'iframe-error';
            errorDiv.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);color:white;text-align:center;padding:20px;z-index:10;';
            errorDiv.innerHTML = `
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <h3 style="margin-bottom: 12px;">Site Blocks Embedding</h3>
                <p style="margin-bottom: 24px;">This website (like Leonardo.ai) blocks being displayed in iframes for security.</p>
                <button class="btn btn-primary" onclick="window.open(document.getElementById('platform-frame').src, '_blank')">
                    Open in New Tab
                </button>
            `;
            platformPreview.appendChild(errorDiv);
        }
    }

    // UI Methods
    showModal(id) { document.getElementById(id).classList.add('active'); }
    hideModal(id) { document.getElementById(id).classList.remove('active'); }
    showToast(msg, type = 'success') {
        const t = document.createElement('div');
        t.className = 'toast-message';
        t.innerHTML = `<span>${type === 'success' ? '✅' : 'ℹ️'}</span><span>${msg}</span>`;
        document.body.appendChild(t);
        setTimeout(() => t.style.opacity = '1', 10);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
    }

    applyTheme() {
        document.body.classList.toggle('dark-theme', this.currentTheme === 'dark');
        document.getElementById('theme-toggle').innerHTML = this.currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        document.getElementById('dark-mode-toggle').checked = this.currentTheme === 'dark';
    }

    toggleTheme(dark = null) {
        this.currentTheme = dark !== null ? (dark ? 'dark' : 'light') : (this.currentTheme === 'light' ? 'dark' : 'light');
        this.applyTheme();
        this.saveToStorage();
    }

    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `${tab}-tab`));
        this.handleEvolutionTabVisibility();
        if (tab === 'evolution') this.updateEvolutionPrompt();
    }

    handleEvolutionTabVisibility() {
        document.getElementById('main-output-section').style.display = this.currentTab === 'evolution' ? 'none' : 'block';
    }

    // Storage
    async saveToStorage() {
        const state = {
            layers: this.layers,
            models: this.models,
            currentTheme: this.currentTheme,
            imageCounter: this.imageCounter,
            modelCounter: this.modelCounter,
            currentPlatform: this.currentPlatform,
            customPlatforms: this.customPlatforms
        };
        await this.db.saveState('appState', state);
        this.showToast('Project saved');
    }

    async loadFromStorage() {
        const state = await this.db.getState('appState');
        if (state) {
            Object.assign(this, state);
            this.visibleOrder = [];
            this.layers.forEach((l, lIdx) => l.images.forEach(img => {
                if (img.visible) this.visibleOrder.push({ id: img.id, layerId: lIdx, prompt: this.buildPromptFromOptions(img) });
            }));
        }
    }

    // Layer/Image Methods
    renderLayers() {
        const list = document.getElementById('layers-list');
        if (this.layers.length === 0) {
            list.innerHTML = `<div class="empty-state"><h3>No Layers Yet</h3><button class="btn btn-primary" onclick="app.showModal('add-layer-modal')">➕ Create First Layer</button></div>`;
            return;
        }
        list.innerHTML = this.layers.map((l, i) => `
            <div class="layer-item" data-layer-id="${i}" oncontextmenu="app.currentLayerId=${i}; app.showContextMenu(event, 'layer-context-menu')">
                <div class="layer-header">
                    <div class="layer-name"><i class="fas fa-folder"></i> ${l.name} (${l.images.length})</div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-primary add-image-to-layer-btn" onclick="app.showAddImageModal(${i})">
                            <i class="fas fa-plus"></i> <span>Add Image</span>
                        </button>
                    </div>
                </div>
                <div class="layer-images-container"><div class="layer-images" id="layer-images-${i}"></div></div>
            </div>
        `).join('');
        this.layers.forEach((_, i) => this.renderLayerImages(i));
    }

    async renderLayerImages(lIdx) {
        const container = document.getElementById(`layer-images-${lIdx}`);
        if (!container) return;
        const imgs = await Promise.all(this.layers[lIdx].images.map(img => this.getImageHTML(img, lIdx)));
        container.innerHTML = imgs.join('') || '<p style="padding:10px;color:gray">No images.</p>';
        container.querySelectorAll('.image-frame').forEach(f => {
            f.onclick = () => this.toggleImageSelection(parseInt(f.dataset.layerId), f.dataset.imageId);
            f.oncontextmenu = (e) => {
                this.currentLayerId = parseInt(f.dataset.layerId);
                this.currentImageId = f.dataset.imageId;
                this.showContextMenu(e, 'image-context-menu');
            };
        });
    }

    renderModels() {
        const list = document.getElementById('models-list');
        if (this.models.length === 0) {
            list.innerHTML = `<div class="empty-state"><h3>No Models Yet</h3><button class="btn btn-primary" onclick="app.showModal('add-model-modal')">➕ Add First Model</button></div>`;
            return;
        }
        list.innerHTML = this.models.map(m => `
            <div class="model-frame" data-model-id="${m.id}" oncontextmenu="app.currentModelId='${m.id}'; app.showContextMenu(event, 'model-context-menu')">
                <div class="model-name">${m.name}</div>
            </div>
        `).join('');
    }

    renderPlatformTags() {
        const container = document.getElementById('platform-tags-container');
        if (!container) return;
        container.innerHTML = Object.keys(this.platformNames).map(k => `
            <div class="platform-tag ${this.currentPlatform === k ? 'active' : ''}" onclick="app.switchPlatform('${k}')">
                ${this.platformNames[k]}
            </div>
        `).join('');
    }

    switchPlatform(p) {
        this.currentPlatform = p;
        const frame = document.getElementById('platform-frame');
        if (frame) frame.src = this.platforms[p];
        this.renderPlatformTags();
    }

    async getImageHTML(img, lIdx) {
        let src = this.imageCache.get(img.id) || await this.db.getImage(img.id) || this.createPlaceholderImage();
        this.imageCache.set(img.id, src);
        return `
            <div class="image-frame ${img.visible ? 'selected' : ''}" data-image-id="${img.id}" data-layer-id="${lIdx}">
                <div class="image-title">${img.title}</div>
                <div class="image-container"><img src="${src}"></div>
            </div>`;
    }

    addLayer() {
        const name = document.getElementById('layer-name-input').value.trim();
        if (!name) return;
        this.layers.push({ name, images: [] });
        this.renderLayers();
        this.hideModal('add-layer-modal');
        this.saveToStorage();
    }

    showAddImageModal(lIdx) {
        this.currentLayerId = lIdx;
        document.getElementById('image-prompt-input').value = '';
        document.getElementById('selected-image-name').textContent = '';
        this.showModal('add-image-modal');
    }

    async addImage() {
        const file = document.getElementById('image-file-input').files[0];
        const prompt = document.getElementById('image-prompt-input').value.trim();
        if (!file || !prompt) return;
        const data = await new Promise(r => { const rd = new FileReader(); rd.onload = e => r(e.target.result); rd.readAsDataURL(file); });
        const id = `img_${Date.now()}`;
        await this.db.saveImage(id, data);
        this.layers[this.currentLayerId].images.push({ id, prompt, title: prompt.slice(0, 15), visible: false, options: [] });
        this.renderLayerImages(this.currentLayerId);
        this.hideModal('add-image-modal');
        this.saveToStorage();
        this.updateStats();
    }

    toggleImageSelection(lIdx, imgId) {
        const img = this.layers[lIdx].images.find(i => i.id === imgId);
        img.visible = !img.visible;
        if (img.visible) this.visibleOrder.push({ id: imgId, layerId: lIdx, prompt: img.prompt });
        else this.visibleOrder = this.visibleOrder.filter(o => o.id !== imgId);
        this.updateDisplay();
        this.updateEvolutionPrompt();
        this.renderLayerImages(lIdx);
    }

    uncheckAll() {
        this.layers.forEach(l => l.images.forEach(img => img.visible = false));
        this.visibleOrder = [];
        this.renderLayers();
        this.updateDisplay();
        this.updateEvolutionPrompt();
        this.saveToStorage();
    }

    filterContent() {
        const q = document.getElementById('search-input').value.toLowerCase();
        document.querySelectorAll('.layer-item, .image-frame, .model-frame').forEach(el => {
            const text = el.textContent.toLowerCase();
            el.style.display = text.includes(q) ? '' : 'none';
        });
    }

    optimizePrompt() {
        const display = document.getElementById('evolution-prompt-display');
        if (!display) return;
        const current = display.textContent;
        const optimized = current + ", high quality, detailed, masterpiece, 8k";
        display.textContent = optimized;
        this.showToast('Prompt optimized!');
    }

    toggleEvolutionPromptEdit() {
        const display = document.getElementById('evolution-prompt-display');
        if (!display) return;
        if (!this.isEvolutionPromptEditing) {
            const text = display.textContent;
            display.innerHTML = `<textarea id="edit-prompt-area" style="width:100%;height:100px;">${text}</textarea>
                                 <button onclick="app.saveEvolutionPrompt()">Save</button>`;
            this.isEvolutionPromptEditing = true;
        }
    }

    saveEvolutionPrompt() {
        const area = document.getElementById('edit-prompt-area');
        if (area) {
            document.getElementById('evolution-prompt-display').textContent = area.value;
            this.isEvolutionPromptEditing = false;
            this.showToast('Prompt saved locally');
        }
    }

    updateDisplay() {
        const out = document.getElementById('output-text');
        if (out) out.textContent = this.visibleOrder.map(o => o.prompt).join(', ');
    }

    updateEvolutionPrompt() {
        const display = document.getElementById('evolution-prompt-display');
        const out = document.getElementById('output-text');
        if (display && !this.isEvolutionPromptEditing) {
            display.textContent = (out && out.textContent) ? out.textContent : 'No prompt generated.';
        }
    }

    // Stats
    updateStats() {
        const layersCount = document.getElementById('layers-count');
        const imagesCount = document.getElementById('images-count');
        const modelsCount = document.getElementById('models-count');
        
        if (layersCount) layersCount.textContent = this.layers.length;
        if (imagesCount) imagesCount.textContent = this.layers.reduce((s, l) => s + l.images.length, 0);
        if (modelsCount) modelsCount.textContent = this.models.length;
    }

    // Utils
    copyToClipboard(text) {
        if (!text) return;
        
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => this.showToast('Copied to clipboard!'))
                .catch(() => this.copyToClipboardFallback(text));
        } else {
            this.copyToClipboardFallback(text);
        }
    }

    copyToClipboardFallback(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            this.showToast('Copied to clipboard! (fallback)');
        } catch (err) {
            console.error('Fallback copy failed', err);
            this.showToast('Failed to copy', 'error');
        }
        document.body.removeChild(textArea);
    }

    createPlaceholderImage() { return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNGRkZGRkUiLz48cGF0aCBkPSJNMzAgMzBINzBWNzBIMzBWMzBaIiBmaWxsPSIjRUVFRUVFIi8+PHBhdGggZD0iTTcwIDcwTDMwIDMwIiBzdHJva2U9IiNDQ0NDQ0MiIHN0cm9rZS13aWR0aD0iMiIvPjxwYXRoIGQ9Ik0zMCA3MEw3MCAzMCIgc3Ryb2tlPSIjQ0NDQ0NDIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4='; }
    buildPromptFromOptions(img) { return img.prompt; }
}

window.app = new PixelForgePro();
