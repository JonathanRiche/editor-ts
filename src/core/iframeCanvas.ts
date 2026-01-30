import type { Page } from './Page';

export type IframeCanvasBuildOptions = {
  title: string;
  css: string;
  htmlBody: string;
  headHtml?: string;
  stylesheets?: string[];
  inlineStyles?: string[];
  baseHref?: string;
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
    }
    .editorts-selected {
      outline: 3px solid #10b981 !important;
    }

    .editorts-box-model {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 9998;
      box-sizing: border-box;
      display: none;
    }
    .editorts-box-model [data-layer] {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      border-style: solid;
      pointer-events: none;
    }
    .editorts-box-model [data-layer="margin"] {
      border-color: rgba(251, 146, 60, 0.35);
    }
    .editorts-box-model [data-layer="padding"] {
      border-color: rgba(59, 130, 246, 0.3);
    }

    .editorts-flash {
      animation: editortsFlash 300ms cubic-bezier(0.2, 0.8, 0.2, 1) 1;
    }

    @keyframes editortsFlash {
      0% {
        outline: 4px solid rgba(245, 158, 11, 0.95);
        outline-offset: 4px;
      }
      60% {
        outline: 4px solid rgba(245, 158, 11, 0.65);
        outline-offset: 3px;
      }
      100% {
        outline: 3px solid rgba(16, 185, 129, 0.85);
        outline-offset: 2px;
      }
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
      top: 0;
      left: 0;
      transform: translateY(calc(-100% - 8px));
      z-index: 10000;
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
  const dropEdgeThreshold = 0.25;

  const isComponentElement = (el: HTMLElement | null): el is HTMLElement => {
    return !!el && !!el.id && !el.id.startsWith('editorts-');
  };

  const parsePixelValue = (value: string | null): number => {
    if (!value) return 0;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const toPixelStyle = (value: number) => `${Math.max(0, value)}px`;

  const getBoxModelMetrics = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return {
      marginTop: parsePixelValue(style.marginTop),
      marginRight: parsePixelValue(style.marginRight),
      marginBottom: parsePixelValue(style.marginBottom),
      marginLeft: parsePixelValue(style.marginLeft),
      paddingTop: parsePixelValue(style.paddingTop),
      paddingRight: parsePixelValue(style.paddingRight),
      paddingBottom: parsePixelValue(style.paddingBottom),
      paddingLeft: parsePixelValue(style.paddingLeft),
    };
  };

  const ensureBoxModelOverlay = (el: HTMLElement) => {
    let overlay = el.querySelector('.editorts-box-model') as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'editorts-box-model';

      const marginLayer = document.createElement('div');
      marginLayer.dataset.layer = 'margin';
      const paddingLayer = document.createElement('div');
      paddingLayer.dataset.layer = 'padding';

      overlay.appendChild(marginLayer);
      overlay.appendChild(paddingLayer);
      el.appendChild(overlay);
    }

    return overlay;
  };

  const updateBoxModelOverlay = (el: HTMLElement) => {
    const overlay = ensureBoxModelOverlay(el);
    const marginLayer = overlay.querySelector('[data-layer="margin"]') as HTMLDivElement | null;
    const paddingLayer = overlay.querySelector('[data-layer="padding"]') as HTMLDivElement | null;
    if (!marginLayer || !paddingLayer) return;

    const metrics = getBoxModelMetrics(el);

    marginLayer.style.position = 'absolute';
    marginLayer.style.inset = `-${metrics.marginTop}px -${metrics.marginRight}px -${metrics.marginBottom}px -${metrics.marginLeft}px`;
    marginLayer.style.borderWidth = `${metrics.marginTop}px ${metrics.marginRight}px ${metrics.marginBottom}px ${metrics.marginLeft}px`;
    marginLayer.style.background = 'transparent';

    paddingLayer.style.position = 'absolute';
    paddingLayer.style.inset = '0';
    paddingLayer.style.borderWidth = `${metrics.paddingTop}px ${metrics.paddingRight}px ${metrics.paddingBottom}px ${metrics.paddingLeft}px`;
    paddingLayer.style.background = 'transparent';
  };

  const showBoxModelOverlay = (el: HTMLElement) => {
    const overlay = ensureBoxModelOverlay(el);
    updateBoxModelOverlay(el);
    overlay.style.display = 'block';
  };

  const hideBoxModelOverlay = (el: HTMLElement) => {
    const overlay = el.querySelector('.editorts-box-model') as HTMLDivElement | null;
    if (overlay) overlay.style.display = 'none';
  };

  const getParentComponent = (el: HTMLElement): HTMLElement | null => {
    let parent = el.parentElement;
    while (parent) {
      const candidate = parent as HTMLElement;
      if (isComponentElement(candidate)) return candidate;
      parent = parent.parentElement;
    }
    return null;
  };

  const getChildComponents = (el: HTMLElement): HTMLElement[] => {
    return Array.from(el.children)
      .filter((child): child is HTMLElement => isComponentElement(child as HTMLElement));
  };

  const getRootComponents = (): HTMLElement[] => {
    return Array.from(document.body.children)
      .filter((child): child is HTMLElement => isComponentElement(child as HTMLElement));
  };

  const getDropPosition = (el: HTMLElement, clientY: number): 'before' | 'inside' | 'after' => {
    const rect = el.getBoundingClientRect();
    const offset = clientY - rect.top;
    const edgeSize = rect.height * dropEdgeThreshold;

    if (offset <= edgeSize) return 'before';
    if (offset >= rect.height - edgeSize) return 'after';
    return 'inside';
  };

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

        const position = getDropPosition(el, e.clientY);
        const parentComponent = getParentComponent(el);
        const targetParentId = parentComponent ? parentComponent.id : null;

        let newParentId = targetParentId;
        let newIndex = 0;

        if (position === 'inside') {
          newParentId = el.id;
          newIndex = getChildComponents(el).length;
        } else {
          const siblings = parentComponent ? getChildComponents(parentComponent) : getRootComponents();
          const currentIndex = siblings.findIndex((node) => node.id === el.id);
          const baseIndex = currentIndex === -1 ? siblings.length : currentIndex;
          newIndex = position === 'before' ? baseIndex : baseIndex + 1;
        }

        window.parent.postMessage(
          {
            type: 'editorts:canvasReorder',
            draggedId,
            targetId: el.id,
            targetParentId: newParentId,
            targetIndex: newIndex,
          },
          '*'
        );
      });

      el.addEventListener('mouseenter', () => {
        if (editingElement || imageEditTarget) return;
        showBoxModelOverlay(el);
      });

      el.addEventListener('mouseleave', () => {
        hideBoxModelOverlay(el);
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
      hideBoxModelOverlay(selectedElement);
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

    // If the toolbar would be clipped above the viewport, place it below.
    const elRect = el.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const needsBelow = elRect.top - toolbarRect.height - 8 < 0;

    if (needsBelow) {
      toolbar.style.top = '100%';
      toolbar.style.transform = 'translateY(8px)';
    } else {
      toolbar.style.top = '0';
      toolbar.style.transform = 'translateY(calc(-100% - 8px))';
    }
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

  let placementMode = false;

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
    } else if (event.data.type === 'editorts:placementMode') {
      placementMode = !!event.data.enabled;
      document.body.style.cursor = placementMode ? 'crosshair' : '';
    } else if (event.data.type === 'editorts:flashSelect') {
      const el = document.getElementById(event.data.id);
        if (el) {
          // Flash by retriggering CSS animation
          el.classList.remove('editorts-flash');
          // Force reflow
          void el.offsetHeight;
          el.classList.add('editorts-flash');

          selectElement(el);
          showBoxModelOverlay(el);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

    }
  });

  document.addEventListener('click', (e) => {
    if (!placementMode) return;

    const target = e.target as HTMLElement | null;
    const el = target?.closest('[id]') as HTMLElement | null;
    if (!el || !el.id || el.id.startsWith('editorts-')) return;

    e.preventDefault();
    e.stopPropagation();

    placementMode = false;
    document.body.style.cursor = '';

    window.parent.postMessage(
      {
        type: 'editorts:placeComponent',
        targetId: el.id,
      },
      '*'
    );
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWYSIWYG);
  } else {
    initWYSIWYG();
  }
}

export function buildIframeCanvasSrcdoc(options: IframeCanvasBuildOptions): string {
  const { title, css, htmlBody, headHtml, stylesheets, inlineStyles, baseHref } = options;

  // Serialize a real function body into the iframe.
  const scriptSource = `(${iframeWysiwygScript.toString()})();`;
  const safeScriptSource = scriptSource.replace(/<\/script>/gi, '<\\/script>');

  const stylesheetTags = (stylesheets ?? [])
    .filter((href) => typeof href === 'string' && href.trim().length > 0)
    .map((href) => `  <link rel="stylesheet" href="${href}">`)
    .join('\n');

  const extraInlineStyles = (inlineStyles ?? [])
    .filter((style) => typeof style === 'string' && style.trim().length > 0)
    .map((style) => `  <style>${style}</style>`)
    .join('\n');

  const baseTag = baseHref && baseHref.trim().length > 0 ? `  <base href="${baseHref}">` : '';
  const headHtmlBlock = headHtml ? `\n${headHtml}` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
${baseTag}
${stylesheetTags}
  <style data-editorts="page-css">${css}</style>
${extraInlineStyles}
  <style>${buildWysiwygCss()}</style>
${headHtmlBlock}
</head>
${htmlBody}
<script>${safeScriptSource}</script>
</html>`;
}

export function buildIframeCanvasSrcdocFromPage(
  page: Page,
  options?: Pick<IframeCanvasBuildOptions, 'headHtml' | 'stylesheets' | 'inlineStyles' | 'baseHref'>
): string {
  return buildIframeCanvasSrcdoc({
    title: page.getTitle(),
    css: page.getCSS(),
    htmlBody: page.getHTML(),
    ...options,
  });
}
