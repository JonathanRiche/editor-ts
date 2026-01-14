import type { Page } from './Page';

export type IframeCanvasBuildOptions = {
  title: string;
  css: string;
  htmlBody: string;
};

function buildWysiwygCss(): string {
  // Pure CSS only.
  return `
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
  `;
}

// NOTE: This function is stringified and executed inside the iframe.
// Keep dependencies limited to browser globals.
function iframeWysiwygScript() {
  let selectedElement: HTMLElement | null = null;
  let editingElement: HTMLElement | null = null;
  let originalContent = '';
  let imageEditTarget: HTMLElement | null = null;
  let fileInput: HTMLInputElement | null = null;

  // Drag and drop state
  let draggedElement: HTMLElement | null = null;
  let draggedId: string | null = null;

  // Double-tap detection for mobile
  const doubleTapDelay = 300; // ms
  let lastTapTime = 0;
  let lastTapElement: HTMLElement | null = null;

  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function handleDoubleAction(el: HTMLElement) {
    const imgElement = getImageElement(el);
    if (imgElement) {
      startImageEdit(el, imgElement);
    } else {
      startTextEdit(el);
    }
  }

  function initWYSIWYG() {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'editorts-file-input';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', handleImageSelect);
    document.body.appendChild(fileInput);

    document.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
      if (!el.id || el.id.startsWith('editorts-')) return;

      el.classList.add('editorts-highlight');
      el.setAttribute('draggable', 'true');

      el.addEventListener('dragstart', (e) => {
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
        document.querySelectorAll('.editorts-drag-over').forEach((n) => n.classList.remove('editorts-drag-over'));
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

        window.parent.postMessage(
          {
            type: 'editorts:canvasReorder',
            draggedId,
            targetId: el.id,
          },
          '*'
        );
      });

      el.addEventListener('click', (e) => {
        if (editingElement === el) return;
        e.stopPropagation();
        selectElement(el);
      });

      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleDoubleAction(el);
      });

      if (isTouchDevice) {
        el.addEventListener(
          'touchend',
          (e) => {
            const currentTime = Date.now();
            const tapLength = currentTime - lastTapTime;

            if (lastTapElement === el && tapLength < doubleTapDelay && tapLength > 0) {
              e.preventDefault();
              e.stopPropagation();
              handleDoubleAction(el);
              lastTapTime = 0;
              lastTapElement = null;
            } else {
              lastTapTime = currentTime;
              lastTapElement = el;
            }
          },
          { passive: false }
        );
      }
    });
  }

  function selectElement(el: HTMLElement) {
    if (selectedElement) {
      selectedElement.classList.remove('editorts-selected');
      const oldToolbar = selectedElement.querySelector('.editorts-context-toolbar');
      if (oldToolbar) oldToolbar.remove();
    }

    selectedElement = el;
    el.classList.add('editorts-selected');

    window.parent.postMessage(
      {
        type: 'editorts:componentSelected',
        id: el.id,
        tagName: el.tagName.toLowerCase(),
        className: el.className,
      },
      '*'
    );

    window.parent.postMessage(
      {
        type: 'editorts:getToolbar',
        id: el.id,
      },
      '*'
    );
  }

  type ToolbarAction = { id: string; label: string; icon: string; enabled: boolean; danger?: boolean };
  type ToolbarConfig = { enabled: boolean; actions: ToolbarAction[] };

  function isToolbarConfig(value: unknown): value is ToolbarConfig {
    if (!value || typeof value !== 'object') return false;
    const v = value as ToolbarConfig;
    return typeof v.enabled === 'boolean' && Array.isArray(v.actions);
  }

  function renderToolbar(toolbarConfig: unknown, elementId: string) {
    const el = document.getElementById(elementId);
    if (!el || !isToolbarConfig(toolbarConfig) || !toolbarConfig.enabled) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'editorts-context-toolbar';

    const enabledActions = toolbarConfig.actions.filter((a) => a.enabled);
    enabledActions.forEach((action) => {
      const btn = document.createElement('button');
      btn.className = 'toolbar-action' + (action.danger ? ' danger' : '');
      btn.textContent = action.icon + ' ' + action.label;
      btn.onclick = () => {
        window.parent.postMessage(
          {
            type: 'editorts:toolbarAction',
            action: action.id,
            elementId,
          },
          '*'
        );
      };
      toolbar.appendChild(btn);
    });

    el.appendChild(toolbar);
  }

  function handleToolbarAction(action: string) {
    if (!selectedElement) return;

    if (action === 'delete') {
      selectedElement.remove();
    }
  }

  function getImageElement(el: HTMLElement): HTMLImageElement | null {
    if (el.tagName.toLowerCase() === 'img') return el as unknown as HTMLImageElement;
    return el.querySelector('img');
  }

  function startTextEdit(el: HTMLElement) {
    if (editingElement) return;

    editingElement = el;
    originalContent = el.textContent ?? '';

    el.classList.add('editorts-editing');
    el.contentEditable = 'true';
    el.focus();

    const onBlur = () => {
      finishTextEdit(el, true);
      el.removeEventListener('blur', onBlur);
    };

    el.addEventListener('blur', onBlur);
  }

  function finishTextEdit(el: HTMLElement, save: boolean) {
    if (!editingElement) return;

    const newContent = el.textContent ?? '';

    el.contentEditable = 'false';
    el.classList.remove('editorts-editing');

    window.parent.postMessage(
      {
        type: 'editorts:textEditEnd',
        id: el.id,
        content: newContent,
        originalContent,
        saved: save && newContent !== originalContent,
      },
      '*'
    );

    editingElement = null;
    originalContent = '';

    selectElement(el);
  }

  function startImageEdit(container: HTMLElement, img: HTMLImageElement) {
    imageEditTarget = container;
    container.classList.add('editorts-image-editing');

    window.parent.postMessage(
      {
        type: 'editorts:imageEditStart',
        id: container.id,
        src: img.getAttribute('src') ?? '',
      },
      '*'
    );

    if (fileInput) {
      fileInput.click();
    }
  }

  function handleImageSelect(e: Event) {
    if (!imageEditTarget || !fileInput) return;

    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = getImageElement(imageEditTarget!);
      if (img) {
        img.src = String(reader.result ?? '');
      }

      window.parent.postMessage(
        {
          type: 'editorts:imageUpdate',
          id: imageEditTarget!.id,
          src: String(reader.result ?? ''),
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
          },
        },
        '*'
      );

      imageEditTarget!.classList.remove('editorts-image-editing');
      imageEditTarget = null;
      if (fileInput) {
        fileInput.value = '';
      }
    };

    reader.readAsDataURL(file);
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'editorts:toolbarConfig') {
      renderToolbar(event.data.config, event.data.elementId);
    } else if (event.data.type === 'editorts:toolbarAction') {
      handleToolbarAction(event.data.action);
    } else if (event.data.type === 'editorts:selectComponent') {
      const el = document.getElementById(event.data.id);
      if (el) {
        selectElement(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWYSIWYG);
  } else {
    initWYSIWYG();
  }
}

export function buildIframeCanvasSrcdoc(options: IframeCanvasBuildOptions): string {
  const { title, css, htmlBody } = options;

  // Serialize a real function body into the iframe.
  const scriptSource = `(${iframeWysiwygScript.toString()})();`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${css}</style>
  <style>${buildWysiwygCss()}</style>
</head>
${htmlBody}
<script>${scriptSource}</script>
</html>`;
}

export function buildIframeCanvasSrcdocFromPage(page: Page): string {
  return buildIframeCanvasSrcdoc({
    title: page.getTitle(),
    css: page.getCSS(),
    htmlBody: page.getHTML(),
  });
}
