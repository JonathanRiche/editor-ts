/**
 * EditorTs Editor Initialization
 * Users control the layout - init() just populates their containers
 */

import { Page } from './Page';
import { LayerManager } from './LayerManager';
import { StorageManager } from './StorageManager';
import type { InitConfig, EditorTsEditor, Component, PageData, MultiPageData } from '../types';

/**
 * Initialize EditorTs Editor
 * User creates the HTML structure, init() populates it
 */
export function init(config: InitConfig): EditorTsEditor {
  // Get the iframe element (required)
  const iframe = document.getElementById(config.iframeId) as HTMLIFrameElement;
  if (!iframe || iframe.tagName !== 'IFRAME') {
    throw new Error(`Iframe element #${config.iframeId} not found or is not an iframe`);
  }

  const isMultiPageData = (data: any): data is MultiPageData => {
    return !!data && typeof data === 'object' && Array.isArray(data.pages);
  };

  const rawData = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  let multiPageData: MultiPageData | null = null;
  let activePageIndex = 0;

  let initialPageData: PageData;
  if (isMultiPageData(rawData)) {
    if (rawData.pages.length === 0) {
      throw new Error('MultiPageData.pages cannot be empty');
    }

    multiPageData = rawData;
    activePageIndex = rawData.activePageIndex ?? 0;
    initialPageData = rawData.pages[activePageIndex] ?? rawData.pages[0]!;
  } else {
    initialPageData = rawData as PageData;
  }

  // Create Page instance
  const page = new Page(initialPageData);

  // Configure toolbars from config
  if (config.toolbars) {
    if (config.toolbars.byId) {
      Object.entries(config.toolbars.byId).forEach(([id, toolbarConfig]) => {
        page.toolbars.configureById(id, toolbarConfig);
      });
    }

    if (config.toolbars.byType) {
      Object.entries(config.toolbars.byType).forEach(([type, toolbarConfig]) => {
        page.toolbars.configureByType(type, toolbarConfig);
      });
    }

    if (config.toolbars.byTag) {
      Object.entries(config.toolbars.byTag).forEach(([tag, toolbarConfig]) => {
        page.toolbars.configureByTag(tag, toolbarConfig);
      });
    }

    if (config.toolbars.default) {
      page.toolbars.setGlobalDefault(config.toolbars.default);
    }
  }

  // Event system
  const eventListeners: Record<string, Function[]> = {};

  const on = (event: string, callback: Function) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event]!.push(callback);
  };

  const off = (event: string, callback: Function) => {
    if (eventListeners[event]) {
      eventListeners[event] = eventListeners[event]!.filter(cb => cb !== callback);
    }
  };

  const emit = (event: string, ...args: any[]) => {
    if (eventListeners[event]) {
      eventListeners[event]!.forEach(callback => callback(...args));
    }
  };

  // Get optional UI containers
  const sidebarContainer = config.ui?.sidebar?.containerId 
    ? document.getElementById(config.ui.sidebar.containerId) 
    : null;
  
  const statsContainer = config.ui?.stats?.containerId
    ? document.getElementById(config.ui.stats.containerId)
    : null;
  
  const selectedInfoContainer = config.ui?.selectedInfo?.containerId
    ? document.getElementById(config.ui.selectedInfo.containerId)
    : null;

  const layersContainer = config.ui?.layers?.containerId
    ? document.getElementById(config.ui.layers.containerId)
    : null;

  // Optional code editor containers
  const jsEditorContainer = config.ui?.editors?.js?.containerId
    ? document.getElementById(config.ui.editors.js.containerId)
    : null;

  const cssEditorContainer = config.ui?.editors?.css?.containerId
    ? document.getElementById(config.ui.editors.css.containerId)
    : null;

  const jsonEditorContainer = config.ui?.editors?.json?.containerId
    ? document.getElementById(config.ui.editors.json.containerId)
    : null;

  // Initialize layer manager if container provided
  let layerManager: LayerManager | null = null;
  if (layersContainer && config.ui?.layers?.enabled !== false) {
    layerManager = new LayerManager({
      container: layersContainer,
      onSelect: (component) => {
        // Notify iframe to select this component
        const id = component.attributes?.id;
        if (id) {
          iframe.contentWindow?.postMessage({
            type: 'editorts:selectComponent',
            id: id
          }, '*');
        }
        
        // Emit event
        emit('componentSelect', component);
        if (config.onComponentSelect) {
          config.onComponentSelect(component);
        }
      },
      onReorder: (componentId, newParentId, newIndex) => {
        // Reorder in component manager
        page.components.moveComponent(componentId, newParentId, newIndex);
        
        // Emit event
        const component = page.components.findById(componentId);
        if (component) {
          emit('componentReorder', component, newParentId, newIndex);
        }
        
        // Refresh iframe
        refresh();
      }
    });
    
    // Initial render
    layerManager.update(page.components.getAll());
  }

  const renderStats = () => {
    if (!statsContainer || config.ui?.stats?.enabled === false) return;

    statsContainer.innerHTML = `
      <div style="font-size: 0.85rem;">
        <div>Components: ${page.components.count()}</div>
        <div>Styles: ${page.styles.count()}</div>
        <div>Assets: ${page.assets.count()}</div>
      </div>
    `;
  };

  // Populate stats if container provided
  renderStats();

  // Built-in code editor setup (optional)
  const codeEditorProvider = config.codeEditor?.provider ?? 'textarea';

  type RuntimeCodeEditor = {
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    dispose(): void;
  };

  function createTextareaCodeEditor(host: HTMLElement, initialValue: string): RuntimeCodeEditor {
    host.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.value = initialValue;
    textarea.spellcheck = false;
    textarea.style.width = '100%';
    textarea.style.minHeight = '16rem';
    textarea.style.fontFamily = 'monospace';
    textarea.style.fontSize = '0.9rem';

    host.appendChild(textarea);

    return {
      getValue: () => textarea.value,
      setValue: (value: string) => {
        textarea.value = value;
      },
      focus: () => textarea.focus(),
      dispose: () => {
        textarea.remove();
      },
    };
  }

  let modernMonacoInitPromise: Promise<any> | null = null;

  async function loadModernMonaco(): Promise<any> {
    if (!modernMonacoInitPromise) {
      modernMonacoInitPromise = import('modern-monaco')
        .then((mod: any) => {
          if (!mod?.init) {
            throw new Error('modern-monaco missing init() export');
          }
          return mod.init();
        })
        .catch((err) => {
          modernMonacoInitPromise = null;
          throw err;
        });
    }

    return modernMonacoInitPromise;
  }

  async function createModernMonacoCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'css' | 'json'
  ): Promise<RuntimeCodeEditor> {
    host.innerHTML = '';

    const monacoHost = document.createElement('div');
    monacoHost.style.width = '100%';
    monacoHost.style.minHeight = '16rem';
    host.appendChild(monacoHost);

    const monaco = await loadModernMonaco();

    const editor = monaco.editor.create(monacoHost, {
      automaticLayout: true,
      minimap: { enabled: false },
    });

    const model = monaco.editor.createModel(initialValue ?? '', language);
    editor.setModel(model);

    return {
      getValue: () => model.getValue(),
      setValue: (value: string) => model.setValue(value ?? ''),
      focus: () => editor.focus(),
      dispose: () => {
        editor.dispose();
        model.dispose();
        monacoHost.remove();
      },
    };
  }

  async function createCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'css' | 'json'
  ): Promise<RuntimeCodeEditor> {
    if (codeEditorProvider === 'modern-monaco') {
      try {
        return await createModernMonacoCodeEditor(host, initialValue, language);
      } catch (err) {
        console.warn('Failed to load modern-monaco; falling back to textarea:', err);
        return createTextareaCodeEditor(host, initialValue);
      }
    }

    return createTextareaCodeEditor(host, initialValue);
  }

  // Code editor instances
  let jsEditor: RuntimeCodeEditor | null = null;
  let cssEditor: RuntimeCodeEditor | null = null;
  let jsonEditor: RuntimeCodeEditor | null = null;

  // Track selected component for JS editor
  let selectedComponentId: string | null = null;

  // Build iframe content with WYSIWYG
  // NOTE: this must be built on-demand so refresh() reflects current Page state.
  const buildIframeContent = () => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.getTitle()}</title>
  <style>${page.getCSS()}</style>
  <style>
    /* WYSIWYG editing styles */
    .editorts-highlight {
      outline: 2px dashed var(--color-editor-light-text, #212C3E) !important;
      outline-offset: 2px;
      cursor: pointer !important;
      position: relative !important;
    }
    .editorts-highlight:hover {
      outline: 2px solid var(--color-editor-light-text, #212C3E) !important;
      background-color: rgba(33, 44, 62, 0.05) !important;
    }
    .editorts-selected {
      outline: 3px solid #10b981 !important;
      background-color: rgba(16, 185, 129, 0.1) !important;
    }
    .editorts-drag-over {
      outline: 3px dashed #3b82f6 !important;
      outline-offset: 2px;
    }
    .editorts-dragging {
      opacity: 0.5 !important;
    }
    .editorts-context-toolbar {
      position: absolute;
      top: -42px;
      left: 0;
      background: white;
      border: 2px solid var(--color-editor-light-text, #212C3E);
      border-radius: 6px;
      padding: 0.4rem;
      display: flex;
      gap: 0.3rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      z-index: 9999;
    }
    .toolbar-action {
      background: white;
      border: 1px solid var(--color-primary-border, #e5e7eb);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      white-space: nowrap;
      font-family: var(--font-main);
      transition: all 0.2s;
    }
    .toolbar-action:hover {
      background: var(--color-editor-light-bg, #EDF0F5);
      border-color: var(--color-editor-light-text, #212C3E);
    }
    .toolbar-action.danger:hover {
      background: #fee;
      border-color: #ef4444;
      color: #ef4444;
    }
    /* Text editing mode */
    .editorts-editing {
      outline: 3px solid #3b82f6 !important;
      background-color: rgba(59, 130, 246, 0.1) !important;
      cursor: text !important;
      min-height: 1em;
    }
    .editorts-editing:focus {
      outline: 3px solid #2563eb !important;
      background-color: rgba(59, 130, 246, 0.15) !important;
    }
    /* Image editing mode */
    .editorts-image-editing {
      outline: 3px solid #f59e0b !important;
      background-color: rgba(245, 158, 11, 0.1) !important;
      cursor: pointer !important;
    }
    /* Hidden file input */
    #editorts-file-input {
      display: none;
    }
  </style>
</head>
${page.getHTML()}
<script>
  let selectedElement = null;
  let editingElement = null;
  let originalContent = '';
  let imageEditTarget = null;
  let fileInput = null;

  // Drag and drop state
  let draggedElement = null;
  let draggedId = null;

  // Double-tap detection for mobile
  const doubleTapDelay = 300; // ms
  let lastTapTime = 0;
  let lastTapElement = null;

  // Detect if device supports touch
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  // Handle double-tap/double-click to edit
  function handleDoubleAction(el) {
    // Check if this is an image element or contains an image
    const imgElement = getImageElement(el);
    if (imgElement) {
      startImageEdit(el, imgElement);
    } else {
      startTextEdit(el);
    }
  }

  // Initialize WYSIWYG
  function initWYSIWYG() {
    // Create hidden file input for image uploads
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'editorts-file-input';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', handleImageSelect);
    document.body.appendChild(fileInput);

    document.querySelectorAll('[id]').forEach(el => {
      if (!el.id || el.id.startsWith('editorts-')) return;

      el.classList.add('editorts-highlight');

      // Enable drag-and-drop reordering in the canvas
      el.setAttribute('draggable', 'true');

      el.addEventListener('dragstart', (e) => {
        // Don't interfere with editing states
        if (editingElement || imageEditTarget) {
          e.preventDefault();
          return;
        }

        draggedElement = el;
        draggedId = el.id;
        el.classList.add('editorts-dragging');

        e.dataTransfer?.setData('text/plain', el.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });

      el.addEventListener('dragend', () => {
        if (draggedElement) draggedElement.classList.remove('editorts-dragging');
        document.querySelectorAll('.editorts-drag-over').forEach(n => n.classList.remove('editorts-drag-over'));
        draggedElement = null;
        draggedId = null;
      });

      el.addEventListener('dragover', (e) => {
        if (!draggedId || draggedId === el.id) return;
        e.preventDefault();
        el.classList.add('editorts-drag-over');
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('editorts-drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('editorts-drag-over');

        if (!draggedId || draggedId === el.id) return;

        window.parent.postMessage({
          type: 'editorts:canvasReorder',
          draggedId: draggedId,
          targetId: el.id,
        }, '*');
      });
      
      el.addEventListener('click', (e) => {
        // Don't interfere with text editing
        if (editingElement === el) return;
        e.stopPropagation();
        selectElement(el);
      });

      // Double-click to edit (text or image) - desktop
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleDoubleAction(el);
      });

      // Double-tap to edit - mobile/touch
      if (isTouchDevice) {
        el.addEventListener('touchend', (e) => {
          const currentTime = Date.now();
          const tapLength = currentTime - lastTapTime;
          
          if (lastTapElement === el && tapLength < doubleTapDelay && tapLength > 0) {
            // Double tap detected
            e.preventDefault();
            e.stopPropagation();
            handleDoubleAction(el);
            lastTapTime = 0;
            lastTapElement = null;
          } else {
            // First tap - record it
            lastTapTime = currentTime;
            lastTapElement = el;
          }
        }, { passive: false });
      }
    });
  }

  // Check if element is an image or contains a direct image child
  function getImageElement(el) {
    // If the element itself is an img
    if (el.tagName === 'IMG') {
      return el;
    }
    // If the element contains a direct img child (e.g., a wrapper div)
    const img = el.querySelector('img');
    if (img) {
      return img;
    }
    return null;
  }

  // Start image editing mode
  function startImageEdit(containerEl, imgEl) {
    // End any current text editing
    if (editingElement) {
      endTextEdit(true);
    }

    imageEditTarget = { container: containerEl, image: imgEl };
    
    // Visual feedback
    containerEl.classList.remove('editorts-selected');
    containerEl.classList.add('editorts-image-editing');

    // Notify parent
    window.parent.postMessage({
      type: 'editorts:imageEditStart',
      id: containerEl.id,
      currentSrc: imgEl.src
    }, '*');

    // Trigger file input
    fileInput.click();
  }

  // Handle image file selection
  function handleImageSelect(e) {
    const file = e.target.files[0];
    
    if (!file || !imageEditTarget) {
      endImageEdit(false);
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = function(event) {
      const newSrc = event.target.result;
      const oldSrc = imageEditTarget.image.src;
      
      // Update the image in DOM
      imageEditTarget.image.src = newSrc;
      
      // Notify parent of image update
      window.parent.postMessage({
        type: 'editorts:imageUpdate',
        id: imageEditTarget.container.id,
        src: newSrc,
        originalSrc: oldSrc,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      }, '*');

      endImageEdit(true);
    };
    reader.onerror = function() {
      endImageEdit(false);
    };
    reader.readAsDataURL(file);

    // Reset file input for next use
    fileInput.value = '';
  }

  // End image editing mode
  function endImageEdit(saved) {
    if (!imageEditTarget) return;

    const containerEl = imageEditTarget.container;
    containerEl.classList.remove('editorts-image-editing');

    // Notify parent editing ended
    window.parent.postMessage({
      type: 'editorts:imageEditEnd',
      id: containerEl.id,
      saved: saved
    }, '*');

    // Re-select the element
    selectElement(containerEl);

    imageEditTarget = null;
  }

  // Start text editing mode
  function startTextEdit(el) {
    // If already editing, do nothing
    if (editingElement) {
      if (editingElement === el) return;
      // Save current edit first
      endTextEdit(true);
    }

    editingElement = el;
    originalContent = el.innerHTML;

    // Remove toolbar during editing
    const toolbar = el.querySelector('.editorts-context-toolbar');
    if (toolbar) toolbar.remove();

    // Enter edit mode
    el.classList.remove('editorts-selected');
    el.classList.add('editorts-editing');
    el.contentEditable = 'true';
    
    // Focus the element - use setTimeout for mobile to ensure keyboard appears
    // Mobile browsers sometimes need a small delay after touch events
    if (isTouchDevice) {
      setTimeout(() => {
        el.focus();
        // On iOS, we need to explicitly set selection to trigger keyboard
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }, 10);
    } else {
      el.focus();
      // Select all text for easy replacement
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Notify parent
    window.parent.postMessage({
      type: 'editorts:textEditStart',
      id: el.id
    }, '*');

    // Handle blur to save
    el.addEventListener('blur', handleEditBlur);
    
    // Handle keyboard shortcuts
    el.addEventListener('keydown', handleEditKeydown);
  }

  function handleEditBlur(e) {
    // Small delay to allow for click events
    setTimeout(() => {
      if (editingElement && !editingElement.contains(document.activeElement)) {
        endTextEdit(true);
      }
    }, 100);
  }

  function handleEditKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      endTextEdit(false); // Cancel - restore original
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      endTextEdit(true); // Save
    }
  }

  // End text editing mode
  function endTextEdit(save) {
    if (!editingElement) return;

    const el = editingElement;
    const newContent = el.innerHTML;
    
    // Remove event listeners
    el.removeEventListener('blur', handleEditBlur);
    el.removeEventListener('keydown', handleEditKeydown);

    // Exit edit mode
    el.contentEditable = 'false';
    el.classList.remove('editorts-editing');

    if (save && newContent !== originalContent) {
      // Notify parent of text update
      window.parent.postMessage({
        type: 'editorts:textUpdate',
        id: el.id,
        content: newContent,
        originalContent: originalContent
      }, '*');
    } else if (!save) {
      // Restore original content
      el.innerHTML = originalContent;
    }

    // Notify parent editing ended
    window.parent.postMessage({
      type: 'editorts:textEditEnd',
      id: el.id,
      saved: save && newContent !== originalContent
    }, '*');

    editingElement = null;
    originalContent = '';

    // Re-select the element
    selectElement(el);
  }

  function selectElement(el) {
    // Clear previous selection
    if (selectedElement) {
      selectedElement.classList.remove('editorts-selected');
      const oldToolbar = selectedElement.querySelector('.editorts-context-toolbar');
      if (oldToolbar) oldToolbar.remove();
    }

    // Highlight new selection
    selectedElement = el;
    el.classList.add('editorts-selected');

    // Notify parent
    window.parent.postMessage({
      type: 'editorts:componentSelected',
      id: el.id,
      tagName: el.tagName.toLowerCase(),
      className: el.className
    }, '*');

    // Request toolbar config
    window.parent.postMessage({
      type: 'editorts:getToolbar',
      id: el.id
    }, '*');
  }

  // Listen for messages from parent
  window.addEventListener('message', (event) => {
    if (event.data.type === 'editorts:toolbarConfig') {
      renderToolbar(event.data.config, event.data.elementId);
    } else if (event.data.type === 'editorts:toolbarAction') {
      handleToolbarAction(event.data.action, event.data.elementId);
    } else if (event.data.type === 'editorts:selectComponent') {
      // Select component from layer panel
      const el = document.getElementById(event.data.id);
      if (el) {
        selectElement(el);
        // Scroll element into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  function renderToolbar(toolbarConfig, elementId) {
    const el = document.getElementById(elementId);
    if (!el || !toolbarConfig.enabled) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'editorts-context-toolbar';

    const enabledActions = toolbarConfig.actions.filter(a => a.enabled);
    enabledActions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'toolbar-action' + (action.danger ? ' danger' : '');
      btn.textContent = action.icon + ' ' + action.label;
      btn.onclick = () => {
        window.parent.postMessage({
          type: 'editorts:toolbarAction',
          action: action.id,
          elementId: elementId
        }, '*');
      };
      toolbar.appendChild(btn);
    });

    el.appendChild(toolbar);
  }

  function handleToolbarAction(action, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (action === 'delete') {
      el.remove();
    }
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWYSIWYG);
  } else {
    initWYSIWYG();
  }
</script>
</html>`;

  // Load content into iframe
  iframe.srcdoc = buildIframeContent();

  // --- Optional code editors (JS/CSS/JSON) ---
  const shouldEnableJsEditor = !!jsEditorContainer && config.ui?.editors?.js?.enabled !== false;
  const shouldEnableCssEditor = !!cssEditorContainer && config.ui?.editors?.css?.enabled !== false;
  const shouldEnableJsonEditor = !!jsonEditorContainer && config.ui?.editors?.json?.enabled !== false;

  // Render editor panels
  if (shouldEnableJsEditor && jsEditorContainer) {
    jsEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
          <strong>Component JavaScript</strong>
          <button data-editorts-action="save-js" type="button">Save</button>
        </div>
        <div data-editorts-field="js-status" style="font-size:0.85rem; opacity:0.8;">Select a component to edit its script</div>
        <div data-editorts-field="js-editor"></div>
      </div>
    `;
  }

  if (shouldEnableCssEditor && cssEditorContainer) {
    cssEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
          <strong>Page CSS</strong>
          <button data-editorts-action="save-css" type="button">Save</button>
        </div>
        <div data-editorts-field="css-editor"></div>
      </div>
    `;
  }

  if (shouldEnableJsonEditor && jsonEditorContainer) {
    jsonEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
          <strong>Page JSON</strong>
          <button data-editorts-action="save-json" type="button">Apply</button>
        </div>
        <div data-editorts-field="json-error" style="display:none; color:#ef4444; font-size:0.85rem;"></div>
        <div data-editorts-field="json-editor"></div>
      </div>
    `;
  }

  async function ensureCssEditorReady() {
    if (!shouldEnableCssEditor || !cssEditorContainer) return;
    const host = cssEditorContainer.querySelector('[data-editorts-field="css-editor"]') as HTMLElement | null;
    if (!host) return;

    if (!cssEditor) {
      cssEditor = await createCodeEditor(host, page.getCSS() ?? '', 'css');
    } else {
      cssEditor.setValue(page.getCSS() ?? '');
    }
  }

  async function ensureJsonEditorReady() {
    if (!shouldEnableJsonEditor || !jsonEditorContainer) return;
    const host = jsonEditorContainer.querySelector('[data-editorts-field="json-editor"]') as HTMLElement | null;
    if (!host) return;

    const nextValue = serializeData();

    if (!jsonEditor) {
      jsonEditor = await createCodeEditor(host, nextValue, 'json');
    } else {
      jsonEditor.setValue(nextValue);
    }
  }

  async function ensureJsEditorReadyFor(component: Component | null) {
    if (!shouldEnableJsEditor || !jsEditorContainer) return;

    const status = jsEditorContainer.querySelector('[data-editorts-field="js-status"]') as HTMLElement | null;
    const host = jsEditorContainer.querySelector('[data-editorts-field="js-editor"]') as HTMLElement | null;
    if (!host) return;

    if (!component) {
      selectedComponentId = null;
      if (status) status.textContent = 'Select a component to edit its script';
      if (!jsEditor) {
        jsEditor = await createCodeEditor(host, '', 'javascript');
      } else {
        jsEditor.setValue('');
      }
      return;
    }

    selectedComponentId = component.attributes?.id ?? null;
    if (status) status.textContent = selectedComponentId ? `Editing: ${selectedComponentId}` : 'Editing: (no id)';

    const nextValue = typeof component.script === 'string' ? component.script : '';

    if (!jsEditor) {
      jsEditor = await createCodeEditor(host, nextValue, 'javascript');
    } else {
      jsEditor.setValue(nextValue);
    }
  }

  // Wire Save buttons
  if (shouldEnableCssEditor && cssEditorContainer) {
    const btn = cssEditorContainer.querySelector('[data-editorts-action="save-css"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      await ensureCssEditorReady();
      if (!cssEditor) return;

      page.styles.setCompiledCSS(cssEditor.getValue());
      refresh();
    });
  }

  if (shouldEnableJsEditor && jsEditorContainer) {
    const btn = jsEditorContainer.querySelector('[data-editorts-action="save-js"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      if (!selectedComponentId) return;
      const component = page.components.findById(selectedComponentId);
      if (!component) return;

      await ensureJsEditorReadyFor(component);
      if (!jsEditor) return;

      page.components.updateComponent(selectedComponentId, { script: jsEditor.getValue() });
      refresh();
    });
  }

  if (shouldEnableJsonEditor && jsonEditorContainer) {
    const btn = jsonEditorContainer.querySelector('[data-editorts-action="save-json"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      await ensureJsonEditorReady();
      if (!jsonEditor) return;

      const errorEl = jsonEditorContainer.querySelector('[data-editorts-field="json-error"]') as HTMLElement | null;

      try {
        const next = JSON.parse(jsonEditor.getValue());

        const toolbarRuntimeConfig = page.toolbars.exportConfig();

        if (isMultiPageData(next)) {
          if (!next.pages || next.pages.length === 0) throw new Error('MultiPageData.pages cannot be empty');
          multiPageData = next;
          activePageIndex = next.activePageIndex ?? 0;
          const loadedPageData = next.pages[activePageIndex] ?? next.pages[0]!;
          const newPage = new Page(loadedPageData);
          Object.assign(page, newPage);
        } else {
          multiPageData = null;
          activePageIndex = 0;
          const newPage = new Page(next as PageData);
          Object.assign(page, newPage);
        }

        // Reapply runtime toolbar configuration
        page.toolbars.importConfig(toolbarRuntimeConfig);

        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        refresh();
      } catch (err: any) {
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = err?.message || String(err);
        }
      }
    });
  }

  // Initial editor content
  void ensureCssEditorReady();
  void ensureJsonEditorReady();
  void ensureJsEditorReadyFor(null);

  // Handle messages from iframe
  window.addEventListener('message', (event) => {
    if (event.data.type === 'editorts:componentSelected') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update JS editor panel (if enabled)
        void ensureJsEditorReadyFor(component);

        // Update selected info container if provided
        if (selectedInfoContainer && config.ui?.selectedInfo?.enabled !== false) {
          renderSelectedInfo(component, event.data.id, event.data.tagName);
        }

        // Sync layer panel selection
        if (layerManager) {
          layerManager.setSelected(event.data.id);
        }

        // Emit event
        emit('componentSelect', component);
        if (config.onComponentSelect) {
          config.onComponentSelect(component);
        }
      }
    } else if (event.data.type === 'editorts:getToolbar') {
      // Send toolbar config to iframe
      const component = page.components.findById(event.data.id);
      if (component) {
        const toolbarConfig = page.toolbars.getToolbarForComponent(component);
        iframe.contentWindow?.postMessage({
          type: 'editorts:toolbarConfig',
          config: toolbarConfig,
          elementId: event.data.id
        }, '*');
      }
    } else if (event.data.type === 'editorts:toolbarAction') {
      handleToolbarAction(event.data.action, event.data.elementId);
    } else if (event.data.type === 'editorts:canvasReorder') {
      const draggedId = event.data.draggedId as string;
      const targetId = event.data.targetId as string;

      if (!draggedId || !targetId || draggedId === targetId) return;

      const targetInfo = page.components.getParentAndIndex(targetId);
      if (!targetInfo) return;

      page.components.moveComponent(draggedId, targetInfo.parentId, targetInfo.index);

      const component = page.components.findById(draggedId);
      if (component) {
        emit('componentReorder', component, targetInfo.parentId, targetInfo.index);
      }

      refresh();
    } else if (event.data.type === 'editorts:textEditStart') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('textEditStart', component);
        if (config.onTextEditStart) {
          config.onTextEditStart(component);
        }
      }
    } else if (event.data.type === 'editorts:textUpdate') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update the component's text content
        page.components.updateTextContent(event.data.id, event.data.content);
        
        emit('textUpdate', component, event.data.content, event.data.originalContent);
        if (config.onTextUpdate) {
          config.onTextUpdate(component, event.data.content, event.data.originalContent);
        }
      }
    } else if (event.data.type === 'editorts:textEditEnd') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('textEditEnd', component, event.data.saved);
        if (config.onTextEditEnd) {
          config.onTextEditEnd(component, event.data.saved);
        }
      }
    } else if (event.data.type === 'editorts:imageEditStart') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('imageEditStart', component, event.data.currentSrc);
        if (config.onImageEditStart) {
          config.onImageEditStart(component, event.data.currentSrc);
        }
      }
    } else if (event.data.type === 'editorts:imageUpdate') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update the component's image src
        page.components.updateImageSrc(event.data.id, event.data.src);
        
        const fileInfo = {
          fileName: event.data.fileName,
          fileType: event.data.fileType,
          fileSize: event.data.fileSize
        };
        
        emit('imageUpdate', component, event.data.src, event.data.originalSrc, fileInfo);
        if (config.onImageUpdate) {
          config.onImageUpdate(component, event.data.src, event.data.originalSrc, fileInfo);
        }
      }
    } else if (event.data.type === 'editorts:imageEditEnd') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('imageEditEnd', component, event.data.saved);
        if (config.onImageEditEnd) {
          config.onImageEditEnd(component, event.data.saved);
        }
      }
    }
  });

  function renderSelectedInfo(component: Component, elementId: string, tagName: string) {
    if (!selectedInfoContainer) return;

    const selectedElement = iframe.contentDocument?.getElementById(elementId) as HTMLElement | null;
    const isPlainTextElement = !!selectedElement && selectedElement.childElementCount === 0;

    // For text, only allow editing inner text (not HTML).
    // Also avoid wiping nested markup by requiring a plain-text element.
    const canEditText = isPlainTextElement && tagName?.toLowerCase() !== 'img';

    const canEditImageSrc =
      tagName?.toLowerCase() === 'img' ||
      typeof component.attributes?.src === 'string' ||
      (selectedElement?.tagName.toLowerCase() === 'img');

    selectedInfoContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <div>
          <div><strong>ID:</strong> ${elementId}</div>
          <div><strong>Tag:</strong> ${tagName}</div>
        </div>

        ${canEditText ? `
          <div>
            <div style="font-weight:600; margin-bottom:0.25rem;">Text</div>
            <textarea data-editorts-field="text-content" style="width:100%; min-height:6rem;"></textarea>
            <button data-editorts-action="apply-text" style="margin-top:0.25rem;">Apply</button>
          </div>
        ` : ''}

        ${canEditImageSrc ? `
          <div>
            <div style="font-weight:600; margin-bottom:0.25rem;">Image URL</div>
            <input data-editorts-field="image-src" type="text" style="width:100%;" />
            <button data-editorts-action="apply-image-src" style="margin-top:0.25rem;">Apply</button>
          </div>
        ` : ''}
      </div>
    `;

    const textArea = selectedInfoContainer.querySelector('[data-editorts-field="text-content"]') as HTMLTextAreaElement | null;
    if (textArea) {
      textArea.value = selectedElement?.textContent ?? '';
    }

    const imageSrcInput = selectedInfoContainer.querySelector('[data-editorts-field="image-src"]') as HTMLInputElement | null;
    if (imageSrcInput) {
      const currentImgEl =
        selectedElement?.tagName.toLowerCase() === 'img'
          ? (selectedElement as HTMLImageElement)
          : (selectedElement?.querySelector('img') as HTMLImageElement | null);

      imageSrcInput.value = currentImgEl?.getAttribute('src') ?? component.attributes?.src ?? '';
    }

    const applyTextButton = selectedInfoContainer.querySelector('[data-editorts-action="apply-text"]') as HTMLButtonElement | null;
    if (applyTextButton && textArea) {
      applyTextButton.addEventListener('click', () => {
        const nextText = textArea.value;

        page.components.updateTextContent(elementId, nextText);
        if (selectedElement) {
          selectedElement.textContent = nextText;
        }
      });
    }

    const applyImageSrcButton = selectedInfoContainer.querySelector('[data-editorts-action="apply-image-src"]') as HTMLButtonElement | null;
    if (applyImageSrcButton && imageSrcInput) {
      applyImageSrcButton.addEventListener('click', () => {
        const nextSrc = imageSrcInput.value;

        page.components.updateImageSrc(elementId, nextSrc);

        if (selectedElement) {
          const imgEl =
            selectedElement.tagName.toLowerCase() === 'img'
              ? (selectedElement as HTMLImageElement)
              : (selectedElement.querySelector('img') as HTMLImageElement | null);

          if (imgEl) {
            imgEl.src = nextSrc;
          }
        }
      });
    }
  }

  // Handle toolbar actions
  function handleToolbarAction(actionId: string, elementId: string) {
    const component = page.components.findById(elementId);
    if (!component) return;

    switch (actionId) {
      case 'edit':
        emit('componentEdit', component);
        if (config.onComponentEdit) {
          config.onComponentEdit(component);
        }
        break;

      case 'editJS':
        emit('componentEditJS', component);
        void ensureJsEditorReadyFor(component).then(() => jsEditor?.focus());
        break;

      case 'editCSS':
        emit('pageEditCSS', page.getBody());
        void ensureCssEditorReady().then(() => cssEditor?.focus());
        break;

      case 'editJSON':
        emit('pageEditJSON', page.getBody());
        void ensureJsonEditorReady().then(() => jsonEditor?.focus());
        break;

      case 'duplicate':
        const clone = JSON.parse(JSON.stringify(component));
        clone.attributes = clone.attributes || {};
        clone.attributes.id = elementId + '-copy-' + Date.now();
        page.components.addComponent(clone);
        
        emit('componentDuplicate', component, clone);
        if (config.onComponentDuplicate) {
          config.onComponentDuplicate(component, clone);
        }
        
        refresh();
        break;

      case 'delete':
        page.components.removeComponent(elementId);
        
        emit('componentDelete', component);
        if (config.onComponentDelete) {
          config.onComponentDelete(component);
        }
        
        // Notify iframe to remove element
        iframe.contentWindow?.postMessage({
          type: 'editorts:toolbarAction',
          action: 'delete',
          elementId: elementId
        }, '*');
        break;
    }
  }

  // Refresh iframe and layer panel
  function refresh() {
    iframe.srcdoc = buildIframeContent();

    if (layerManager) {
      layerManager.update(page.components.getAll());
    }

    renderStats();
    void ensureCssEditorReady();
    void ensureJsonEditorReady();

    const selected = selectedComponentId ? page.components.findById(selectedComponentId) : null;
    void ensureJsEditorReadyFor(selected);
  }

  // Initialize storage manager
  const storage = new StorageManager(config.storage);

  function serializeData(): string {
    if (!multiPageData) {
      return page.toJSON();
    }

    multiPageData.pages[activePageIndex] = page.toObject();
    return JSON.stringify(multiPageData, null, 2);
  }

  // Save page data (returns JSON string)
  function save(): string {
    return serializeData();
  }

  // Save page to storage
  async function saveTo(key: string): Promise<void> {
    const data = serializeData();
    await storage.savePage(key, data);
    emit('pageSaved', key);
  }

  // Load page from storage
  async function loadFrom(key: string): Promise<boolean> {
    const data = await storage.loadPage(key);
    if (!data) return false;

    const parsed = JSON.parse(data);

    if (isMultiPageData(parsed)) {
      if (parsed.pages.length === 0) {
        throw new Error('MultiPageData.pages cannot be empty');
      }

      multiPageData = parsed;
      activePageIndex = parsed.activePageIndex ?? 0;

      const loadedPageData = parsed.pages[activePageIndex] ?? parsed.pages[0]!;
      const newPage = new Page(loadedPageData);
      Object.assign(page, newPage);
    } else {
      multiPageData = null;
      activePageIndex = 0;

      const newPage = new Page(parsed as PageData);
      Object.assign(page, newPage);
    }

    refresh();
    emit('pageLoaded', key);
    return true;
  }

  // Destroy editor
  function destroy() {
    iframe.srcdoc = '';

    jsEditor?.dispose();
    cssEditor?.dispose();
    jsonEditor?.dispose();

    if (sidebarContainer) sidebarContainer.innerHTML = '';
    if (statsContainer) statsContainer.innerHTML = '';
    if (selectedInfoContainer) selectedInfoContainer.innerHTML = '';
    if (jsEditorContainer) jsEditorContainer.innerHTML = '';
    if (cssEditorContainer) cssEditorContainer.innerHTML = '';
    if (jsonEditorContainer) jsonEditorContainer.innerHTML = '';
    if (layerManager) layerManager.destroy();
    
    Object.keys(eventListeners).forEach(key => {
      eventListeners[key] = [];
    });
  }

  // Return EditorTsEditor instance
  return {
    page,
    storage,
    on,
    off,
    refresh,
    save,
    saveTo,
    loadFrom,
    destroy,
    elements: {
      iframe,
      sidebar: sidebarContainer || undefined,
      stats: statsContainer || undefined,
      selectedInfo: selectedInfoContainer || undefined,
    }
  };
}
