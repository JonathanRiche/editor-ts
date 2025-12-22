/**
 * EditorTs HTTP Server
 * A REST API server for testing the EditorTs library
 */

import { Page } from './index';
import { readFileSync } from 'fs';
import type { Component, Asset } from './src/types';

// Load sample page data (clean JSON - no toolbar configs)
let currentPage: Page;
try {
  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  currentPage = new Page(jsonData);
  console.log('✓ Loaded sample page successfully');
  
  // Configure toolbars at runtime (NOT stored in JSON)
  configureToolbars(currentPage);
  console.log('✓ Configured runtime toolbars');
} catch (error) {
  console.error('Failed to load sample page:', error);
  process.exit(1);
}

// Configure toolbars for the page (runtime only)
function configureToolbars(page: Page) {
  // Configure by ID
  page.toolbars.configureById('iydl', {
    enabled: true,
    actions: [
      { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
      { id: 'editJS', label: 'Edit JS', icon: '📜', enabled: true },
      { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
      { id: 'delete', label: 'Delete', icon: '🗑️', enabled: false, danger: true }, // Delete disabled
    ]
  });
  
  // Configure all custom-code components
  page.toolbars.configureByType('custom-code', {
    enabled: true,
    actions: [
      { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
      { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true },
      { id: 'duplicate', label: 'Clone', icon: '📋', enabled: true },
    ]
  });
  
  // Disable toolbar for specific components
  page.toolbars.configureById('step2', { enabled: false, actions: [] });
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};



// Create the server
const server = Bun.serve({
  port: 5021,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper to send JSON response
    const jsonResponse = (data: any, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    };

    try {
      // ==================== PAGE ROUTES ====================
      
      // GET /api/page - Get full page data
      if (path === '/api/page' && method === 'GET') {
        return jsonResponse({
          title: currentPage.getTitle(),
          item_id: currentPage.getItemId(),
          componentCount: currentPage.components.count(),
          styleCount: currentPage.styles.count(),
          assetCount: currentPage.assets.count(),
        });
      }

      // GET /api/page/title - Get page title
      if (path === '/api/page/title' && method === 'GET') {
        return jsonResponse({ title: currentPage.getTitle() });
      }

      // PUT /api/page/title - Update page title
      if (path === '/api/page/title' && method === 'PUT') {
        const body = await req.json() as { title: string };
        currentPage.setTitle(body.title);
        return jsonResponse({ success: true, title: currentPage.getTitle() });
      }

      // GET /api/page/export - Export full page as JSON
      if (path === '/api/page/export' && method === 'GET') {
        return jsonResponse(currentPage.toObject());
      }

      // ==================== COMPONENT ROUTES ====================

      // GET /api/components - Get all components
      if (path === '/api/components' && method === 'GET') {
        const type = url.searchParams.get('type');
        const tagName = url.searchParams.get('tagName');
        
        if (type) {
          return jsonResponse(currentPage.components.findByType(type));
        }
        if (tagName) {
          return jsonResponse(currentPage.components.findByTagName(tagName));
        }
        
        return jsonResponse({
          count: currentPage.components.count(),
          components: currentPage.components.getAll(),
        });
      }

      // GET /api/components/:id - Get component by ID
      if (path.startsWith('/api/components/') && method === 'GET') {
        const id = path.split('/')[3];
        const component = currentPage.components.findById(id!);
        
        if (!component) {
          return jsonResponse({ error: 'Component not found' }, 404);
        }
        
        return jsonResponse(component);
      }

      // PUT /api/components/:id - Update component
      if (path.startsWith('/api/components/') && method === 'PUT') {
        const id = path.split('/')[3];
        const updates = await req.json() as Partial<Component>;
        
        const success = currentPage.components.updateComponent(id!, updates);
        
        if (!success) {
          return jsonResponse({ error: 'Component not found' }, 404);
        }
        
        return jsonResponse({ success: true });
      }

      // POST /api/components - Add new component
      if (path === '/api/components' && method === 'POST') {
        const component = await req.json() as Component;
        currentPage.components.addComponent(component);
        return jsonResponse({ success: true }, 201);
      }

      // DELETE /api/components/:id - Delete component
      if (path.startsWith('/api/components/') && method === 'DELETE') {
        const id = path.split('/')[3];
        const success = currentPage.components.removeComponent(id!);
        
        if (!success) {
          return jsonResponse({ error: 'Component not found' }, 404);
        }
        
        return jsonResponse({ success: true });
      }

      // POST /api/components/:id/duplicate - Duplicate component
      if (path.match(/^\/api\/components\/[^/]+\/duplicate$/) && method === 'POST') {
        const id = path.split('/')[3];
        const original = currentPage.components.findById(id!);
        
        if (!original) {
          return jsonResponse({ error: 'Component not found' }, 404);
        }
        
        // Deep clone the component
        const duplicate = JSON.parse(JSON.stringify(original));
        
        // Generate new ID for duplicate and all nested components
        const generateNewId = (comp: any) => {
          if (comp.attributes?.id) {
            comp.attributes.id = comp.attributes.id + '-copy-' + Date.now();
          }
          if (comp.components) {
            comp.components.forEach(generateNewId);
          }
        };
        
        generateNewId(duplicate);
        
        // Add the duplicate
        currentPage.components.addComponent(duplicate);
        
        return jsonResponse({ 
          success: true, 
          newId: duplicate.attributes?.id,
          component: duplicate 
        });
      }

      // ==================== STYLE ROUTES ====================

      // GET /api/styles - Get all styles
      if (path === '/api/styles' && method === 'GET') {
        const selector = url.searchParams.get('selector');
        const mediaText = url.searchParams.get('media');
        
        if (selector) {
          return jsonResponse(currentPage.styles.findBySelector(selector));
        }
        if (mediaText) {
          return jsonResponse(currentPage.styles.findByMedia(mediaText));
        }
        
        return jsonResponse({
          count: currentPage.styles.count(),
          styles: currentPage.styles.getAll(),
        });
      }

      // PUT /api/styles/:selector - Update style
      if (path.startsWith('/api/styles/') && method === 'PUT') {
        const selector = decodeURIComponent(path.split('/')[3]!);
        const body = await req.json() as { properties: Record<string, string>; options?: any };
        
        const success = currentPage.styles.updateStyle(selector, body.properties, body.options);
        
        if (!success) {
          return jsonResponse({ error: 'Style not found' }, 404);
        }
        
        return jsonResponse({ success: true });
      }

      // GET /api/styles/css - Get compiled CSS
      if (path === '/api/styles/css' && method === 'GET') {
        return new Response(currentPage.styles.compileToCSS(), {
          headers: {
            'Content-Type': 'text/css',
            ...corsHeaders,
          },
        });
      }

      // ==================== ASSET ROUTES ====================

      // GET /api/assets - Get all assets
      if (path === '/api/assets' && method === 'GET') {
        const type = url.searchParams.get('type') as Asset['type'] | null;
        
        if (type) {
          return jsonResponse(currentPage.assets.findByType(type));
        }
        
        return jsonResponse({
          count: currentPage.assets.count(),
          assets: currentPage.assets.getAll(),
          images: currentPage.assets.getImages().length,
          videos: currentPage.assets.getVideos().length,
        });
      }

      // POST /api/assets - Add new asset
      if (path === '/api/assets' && method === 'POST') {
        const asset = await req.json() as Asset;
        currentPage.assets.addAsset(asset);
        return jsonResponse({ success: true }, 201);
      }

      // DELETE /api/assets - Delete asset by source
      if (path === '/api/assets' && method === 'DELETE') {
        const body = await req.json() as { src: string };
        const success = currentPage.assets.removeAsset(body.src);
        
        if (!success) {
          return jsonResponse({ error: 'Asset not found' }, 404);
        }
        
        return jsonResponse({ success: true });
      }

      // ==================== UTILITY ROUTES ====================

      // GET /api/toolbar/config - Get toolbar configuration (runtime export)
      if (path === '/api/toolbar/config' && method === 'GET') {
        return jsonResponse(JSON.parse(currentPage.toolbars.exportConfig()));
      }

      // GET /api/toolbar/:id - Get toolbar for specific component
      if (path.startsWith('/api/toolbar/') && method === 'GET') {
        const id = path.split('/')[3];
        const components = currentPage.components.getAll();
        const toolbar = currentPage.toolbars.getToolbarById(components, id!);
        
        if (!toolbar) {
          return jsonResponse({ error: 'Component not found' }, 404);
        }
        
        return jsonResponse(toolbar);
      }

      // POST /api/reload - Reload sample page
      if (path === '/api/reload' && method === 'POST') {
        const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
        currentPage = new Page(jsonData);
        configureToolbars(currentPage); // Re-apply runtime toolbar configs
        return jsonResponse({ 
          success: true, 
          message: 'Page reloaded from sample' 
        });
      }

      // GET /api/stats - Get page statistics
      if (path === '/api/stats' && method === 'GET') {
        return jsonResponse({
          title: currentPage.getTitle(),
          itemId: currentPage.getItemId(),
          components: currentPage.components.count(),
          styles: currentPage.styles.count(),
          assets: currentPage.assets.count(),
          images: currentPage.assets.getImages().length,
          videos: currentPage.assets.getVideos().length,
          audio: currentPage.assets.getAudio().length,
          documents: currentPage.assets.getDocuments().length,
          cdnAssets: currentPage.assets.getCDNAssets().length,
        });
      }

      // ==================== WEB UI ====================

      // Serve simple web UI
      if (path === '/' || path === '/index.html') {
        return new Response(getWebUI(), {
          headers: {
            'Content-Type': 'text/html',
            ...corsHeaders,
          },
        });
      }

      // GET /preview - Preview rendered HTML with styles
      if (path === '/preview' && method === 'GET') {
        const editMode = url.searchParams.get('edit') === 'true';
        const html = currentPage.getHTML();
        const css = currentPage.getCSS();
        const components = currentPage.components.getAll();
        
        const previewHTML = getPreviewHTML(currentPage.getTitle(), css, html, components, editMode);
        
        return new Response(previewHTML, {
          headers: {
            'Content-Type': 'text/html',
            ...corsHeaders,
          },
        });
      }

      // GET /editor - Interactive content editor
      if (path === '/editor' && method === 'GET') {
        return new Response(getEditorUI(), {
          headers: {
            'Content-Type': 'text/html',
            ...corsHeaders,
          },
        });
      }

      // GET /branding.css - Serve branding CSS
      if (path === '/branding.css' && method === 'GET') {
        try {
          const brandingCSS = readFileSync('./src/styles/branding.css', 'utf-8');
          return new Response(brandingCSS, {
            headers: {
              'Content-Type': 'text/css',
              ...corsHeaders,
            },
          });
        } catch (error) {
          console.error('Error loading branding.css:', error);
          return jsonResponse({ error: 'Failed to load branding CSS' }, 500);
        }
      }

      // 404 - Not Found
      return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
      console.error('Server error:', error);
      return jsonResponse({ 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }, 500);
    }
  },
});

console.log(`
╔════════════════════════════════════════════╗
║   EditorTs Server Running                  ║
╚════════════════════════════════════════════╝

🚀 Server:  http://localhost:${server.port}
📖 Web UI:  http://localhost:${server.port}/
🎨 Editor:  http://localhost:${server.port}/editor
👁️  Preview: http://localhost:${server.port}/preview
📊 Stats:   http://localhost:${server.port}/api/stats

API Endpoints:
  GET    /api/page              - Get page info
  GET    /api/page/title        - Get page title
  PUT    /api/page/title        - Update page title
  GET    /api/page/export       - Export page JSON
  
  GET    /api/components        - List components
  GET    /api/components/:id    - Get component by ID
  PUT    /api/components/:id    - Update component
  POST   /api/components        - Add component
  DELETE /api/components/:id    - Delete component
  
  GET    /api/styles            - List styles
  PUT    /api/styles/:selector  - Update style
  GET    /api/styles/css        - Get compiled CSS
  
  GET    /api/assets            - List assets
  POST   /api/assets            - Add asset
  DELETE /api/assets            - Delete asset
  
  GET    /api/stats             - Get page statistics
  POST   /api/reload            - Reload sample page

Press Ctrl+C to stop
`);

// HTML for simple web UI
function getWebUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EditorTs Server - Web UI</title>
  <link rel="stylesheet" href="/branding.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-main, 'Noto Sans', sans-serif);
      background: var(--color-editor-light-bg, #EDF0F5);
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }
    .header h1 {
      color: var(--color-editor-light-text, #212C3E);
      margin-bottom: 0.5rem;
    }
    .header p {
      color: #666;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    .card {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
    }
    .card h2 {
      color: #333;
      margin-bottom: 1rem;
      font-size: 1.25rem;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid #eee;
    }
    .stat:last-child {
      border-bottom: none;
    }
    .stat-label {
      color: #666;
    }
    .stat-value {
      font-weight: 600;
      color: var(--color-editor-light-text, #212C3E);
    }
    button {
      background: var(--color-editor-light-text, #212C3E);
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      transition: background 0.2s;
      width: 100%;
      margin-top: 1rem;
    }
    button:hover {
      background: #5568d3;
    }
    button:active {
      transform: scale(0.98);
    }
    .input-group {
      margin-bottom: 1rem;
    }
    .input-group label {
      display: block;
      margin-bottom: 0.5rem;
      color: #666;
      font-size: 0.9rem;
    }
    .input-group input, .input-group textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
    }
    .input-group textarea {
      min-height: 100px;
      font-family: monospace;
    }
    .success {
      background: #10b981;
      color: white;
      padding: 0.75rem;
      border-radius: 6px;
      margin-top: 1rem;
      display: none;
    }
    .error {
      background: #ef4444;
      color: white;
      padding: 0.75rem;
      border-radius: 6px;
      margin-top: 1rem;
      display: none;
    }
    pre {
      background: #f5f5f5;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.875rem;
      max-height: 400px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 EditorTs Server</h1>
      <p>Interactive web interface for testing the EditorTs library</p>
      <div style="margin-top: 1rem;">
        <a href="/editor" style="background: #10b981; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500; margin-right: 1rem;">
          🎨 Open Content Editor
        </a>
        <a href="/preview" target="_blank" style="background: var(--color-editor-light-text, #212C3E); color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500;">
          👁️ View Live Preview
        </a>
      </div>
    </div>

    <div class="grid">
      <!-- Stats Card -->
      <div class="card">
        <h2>📊 Page Statistics</h2>
        <div id="stats">
          <div class="stat">
            <span class="stat-label">Loading...</span>
            <span class="stat-value">-</span>
          </div>
        </div>
        <button onclick="loadStats()">Refresh Stats</button>
      </div>

      <!-- Title Update Card -->
      <div class="card">
        <h2>✏️ Update Page Title</h2>
        <div class="input-group">
          <label>Current Title:</label>
          <input type="text" id="currentTitle" readonly>
        </div>
        <div class="input-group">
          <label>New Title:</label>
          <input type="text" id="newTitle" placeholder="Enter new title">
        </div>
        <button onclick="updateTitle()">Update Title</button>
        <div class="success" id="titleSuccess">Title updated successfully!</div>
        <div class="error" id="titleError">Failed to update title</div>
      </div>

      <!-- Component Search Card -->
      <div class="card">
        <h2>🔍 Search Components</h2>
        <div class="input-group">
          <label>Component ID:</label>
          <input type="text" id="componentId" placeholder="e.g., iydl">
        </div>
        <button onclick="searchComponent()">Search</button>
        <div class="success" id="componentResult" style="margin-top: 1rem;">
          <pre id="componentData"></pre>
        </div>
        <div class="error" id="componentError">Component not found</div>
      </div>

      <!-- Assets Card -->
      <div class="card">
        <h2>🖼️ Assets</h2>
        <div id="assets">
          <div class="stat">
            <span class="stat-label">Loading...</span>
            <span class="stat-value">-</span>
          </div>
        </div>
        <button onclick="loadAssets()">View All Assets</button>
      </div>

      <!-- Styles Card -->
      <div class="card">
        <h2>🎨 Update Styles</h2>
        <div class="input-group">
          <label>Selector (e.g., #iydl):</label>
          <input type="text" id="styleSelector" placeholder="#element-id">
        </div>
        <div class="input-group">
          <label>CSS Properties (JSON):</label>
          <textarea id="styleProperties" placeholder='{"color": "red", "font-size": "2rem"}'></textarea>
        </div>
        <button onclick="updateStyle()">Update Style</button>
        <div class="success" id="styleSuccess">Style updated successfully!</div>
        <div class="error" id="styleError">Failed to update style</div>
      </div>

      <!-- Export Card -->
      <div class="card">
        <h2>💾 Export Page</h2>
        <p style="color: #666; margin-bottom: 1rem;">Download the current page as JSON</p>
        <button onclick="exportPage()">Export JSON</button>
        <button onclick="reloadPage()" style="background: #ef4444; margin-top: 0.5rem;">Reload Sample</button>
        <div class="success" id="exportSuccess">Check console for exported data</div>
      </div>
    </div>
  </div>

  <script>
    // Load stats on page load
    loadStats();
    loadAssets();

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('currentTitle').value = data.title;
        
        const statsHTML = Object.entries(data).map(([key, value]) => 
          \`<div class="stat">
            <span class="stat-label">\${key}:</span>
            <span class="stat-value">\${value}</span>
          </div>\`
        ).join('');
        
        document.getElementById('stats').innerHTML = statsHTML;
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }

    async function updateTitle() {
      const newTitle = document.getElementById('newTitle').value;
      if (!newTitle) return;

      try {
        const res = await fetch('/api/page/title', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle })
        });
        
        if (res.ok) {
          document.getElementById('titleSuccess').style.display = 'block';
          document.getElementById('titleError').style.display = 'none';
          setTimeout(() => {
            document.getElementById('titleSuccess').style.display = 'none';
            loadStats();
          }, 2000);
        } else {
          throw new Error('Failed');
        }
      } catch (error) {
        document.getElementById('titleError').style.display = 'block';
        document.getElementById('titleSuccess').style.display = 'none';
      }
    }

    async function searchComponent() {
      const id = document.getElementById('componentId').value;
      if (!id) return;

      try {
        const res = await fetch(\`/api/components/\${id}\`);
        const data = await res.json();
        
        if (res.ok) {
          document.getElementById('componentData').textContent = JSON.stringify(data, null, 2);
          document.getElementById('componentResult').style.display = 'block';
          document.getElementById('componentError').style.display = 'none';
        } else {
          throw new Error('Not found');
        }
      } catch (error) {
        document.getElementById('componentError').style.display = 'block';
        document.getElementById('componentResult').style.display = 'none';
      }
    }

    async function loadAssets() {
      try {
        const res = await fetch('/api/assets');
        const data = await res.json();
        
        const assetsHTML = \`
          <div class="stat">
            <span class="stat-label">Total Assets:</span>
            <span class="stat-value">\${data.count}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Images:</span>
            <span class="stat-value">\${data.images}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Videos:</span>
            <span class="stat-value">\${data.videos}</span>
          </div>
        \`;
        
        document.getElementById('assets').innerHTML = assetsHTML;
      } catch (error) {
        console.error('Failed to load assets:', error);
      }
    }

    async function updateStyle() {
      const selector = document.getElementById('styleSelector').value;
      const properties = document.getElementById('styleProperties').value;
      
      if (!selector || !properties) return;

      try {
        const props = JSON.parse(properties);
        const res = await fetch(\`/api/styles/\${encodeURIComponent(selector)}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: props })
        });
        
        if (res.ok) {
          document.getElementById('styleSuccess').style.display = 'block';
          document.getElementById('styleError').style.display = 'none';
          setTimeout(() => {
            document.getElementById('styleSuccess').style.display = 'none';
          }, 2000);
        } else {
          throw new Error('Failed');
        }
      } catch (error) {
        document.getElementById('styleError').style.display = 'block';
        document.getElementById('styleSuccess').style.display = 'none';
      }
    }

    async function exportPage() {
      try {
        const res = await fetch('/api/page/export');
        const data = await res.json();
        
        console.log('Exported page:', data);
        
        // Create download
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'page-export.json';
        a.click();
        
        document.getElementById('exportSuccess').style.display = 'block';
        setTimeout(() => {
          document.getElementById('exportSuccess').style.display = 'none';
        }, 2000);
      } catch (error) {
        console.error('Failed to export:', error);
      }
    }

    async function reloadPage() {
      try {
        const res = await fetch('/api/reload', { method: 'POST' });
        if (res.ok) {
          alert('Page reloaded from sample!');
          loadStats();
          loadAssets();
        }
      } catch (error) {
        console.error('Failed to reload:', error);
      }
    }
  </script>
</body>
</html>`;
}

// HTML for interactive editor UI
function getEditorUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EditorTs Content Editor</title>
  <link rel="stylesheet" href="/branding.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-main, 'Noto Sans', sans-serif);
      height: 100vh;
      display: flex;
      flex-direction: column;
      background-color: var(--color-primary-bg, #F9F9F9);
      color: var(--color-primary-text, #000000);
    }
    .header {
      background: var(--color-editor-light-text, #212C3E);
      color: white;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
    }
    .header h1 {
      font-size: 1.5rem;
    }
    .header-actions {
      display: flex;
      gap: 1rem;
    }
    .btn {
      background: white;
      color: var(--color-editor-light-text, #212C3E);
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .btn-primary {
      background: #10b981;
      color: white;
    }
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: 350px;
      background: var(--color-sidemenu-bg, #F0F2F8);
      border-right: 1px solid var(--color-primary-border, #e5e7eb);
      overflow-y: auto;
      padding: 1.5rem;
    }
    .editor-section {
      background: var(--color-secondary-bg, #FFFFFF);
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    }
    .editor-section h2 {
      font-size: 1.1rem;
      margin-bottom: 1rem;
      color: #333;
      border-bottom: 2px solid var(--color-editor-light-text, #212C3E);
      padding-bottom: 0.5rem;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    .form-group label {
      display: block;
      margin-bottom: 0.5rem;
      color: #666;
      font-size: 0.9rem;
      font-weight: 500;
    }
    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--color-primary-border, #e5e7eb);
      border-radius: 6px;
      font-size: 0.95rem;
      transition: border-color 0.2s;
      background-color: var(--color-primary-input-bg, #f9f9f9);
      font-family: var(--font-main, 'Noto Sans', sans-serif);
    }
    .form-group input:focus,
    .form-group textarea:focus,
    .form-group select:focus {
      outline: none;
      border-color: var(--color-editor-light-text, #212C3E);
      box-shadow: 0 0 0 3px var(--color-light-focus-ring, rgba(0, 0, 0, 0.2));
    }
    .form-group textarea {
      min-height: 100px;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
    }
    .preview-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .preview-toolbar {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 1rem;
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    .preview-frame {
      flex: 1;
      border: none;
      background: white;
    }
    .success-msg {
      background: #10b981;
      color: white;
      padding: 0.75rem;
      border-radius: 6px;
      margin-top: 1rem;
      display: none;
      animation: slideIn 0.3s ease;
    }
    .error-msg {
      background: #ef4444;
      color: white;
      padding: 0.75rem;
      border-radius: 6px;
      margin-top: 1rem;
      display: none;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .stat-badge {
      display: inline-block;
      background: #e0e7ff;
      color: #4f46e5;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.85rem;
      margin-right: 0.5rem;
    }
    .quick-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .quick-btn {
      padding: 0.5rem;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .quick-btn:hover {
      background: #e5e7eb;
    }
    .edit-notification {
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: white;
      padding: 1rem 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 10000;
      display: none;
      animation: slideDown 0.3s ease;
    }
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🎨 EditorTs Content Editor</h1>
      <div style="font-size: 0.85rem; opacity: 0.9; margin-top: 0.25rem;">
        <span class="stat-badge" id="compCount">0 components</span>
        <span class="stat-badge" id="styleCount">0 styles</span>
        <span class="stat-badge" id="assetCount">0 assets</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="window.open('/preview', '_blank')">👁️ Preview</button>
      <button class="btn" onclick="window.open('/', '_blank')">🏠 Dashboard</button>
      <button class="btn btn-primary" onclick="applyChanges()">✓ Apply Changes</button>
      <button class="btn btn-danger" onclick="reloadPage()">↻ Reset</button>
    </div>
  </div>
  
  <div id="editNotification" class="edit-notification">
    ✓ Element loaded! Edit the fields below and click "Update Component"
  </div>

  <div class="container">
    <div class="sidebar">
      <!-- Page Settings -->
      <div class="editor-section">
        <h2>📄 Page Settings</h2>
        <div class="form-group">
          <label>Page Title</label>
          <input type="text" id="pageTitle" placeholder="Enter page title">
        </div>
        <div class="form-group">
          <label>Page ID</label>
          <input type="number" id="pageId" placeholder="Enter page ID">
        </div>
        <button class="btn btn-primary" style="width: 100%;" onclick="updatePageSettings()">Update Page Settings</button>
        <div class="success-msg" id="pageSuccess">Page settings updated!</div>
      </div>

      <!-- Component Editor -->
      <div class="editor-section">
        <h2>🧩 Component Editor</h2>
        <div class="form-group">
          <label>Component ID</label>
          <input type="text" id="componentId" placeholder="e.g., iydl">
        </div>
        <div class="form-group">
          <label>Component Type</label>
          <input type="text" id="componentType" placeholder="e.g., box, custom-code">
        </div>
        <div class="form-group">
          <label>Inline Style</label>
          <textarea id="componentStyle" placeholder="background-color: blue; padding: 1rem;"></textarea>
        </div>
        <div class="quick-actions">
          <button class="quick-btn" onclick="searchComponent()">🔍 Find</button>
          <button class="quick-btn" onclick="updateComponent()">✏️ Update</button>
        </div>
        <div class="success-msg" id="componentSuccess">Component updated!</div>
        <div class="error-msg" id="componentError">Component not found!</div>
      </div>

      <!-- Style Editor -->
      <div class="editor-section">
        <h2>🎨 CSS Style Editor</h2>
        <div class="form-group">
          <label>CSS Selector</label>
          <input type="text" id="styleSelector" placeholder="e.g., #iydl, .button">
        </div>
        <div class="form-group">
          <label>CSS Properties (JSON)</label>
          <textarea id="styleProperties" placeholder='{
  "background-color": "#212C3E",
  "color": "white",
  "padding": "1rem"
}'></textarea>
        </div>
        <button class="btn btn-primary" style="width: 100%;" onclick="updateStyle()">Apply Style</button>
        <div class="success-msg" id="styleSuccess">Style updated!</div>
        <div class="error-msg" id="styleError">Failed to update style!</div>
      </div>

      <!-- Quick Component Search -->
      <div class="editor-section">
        <h2>🔍 Quick Search</h2>
        <div class="form-group">
          <label>Search By</label>
          <select id="searchType">
            <option value="id">Component ID</option>
            <option value="type">Component Type</option>
            <option value="tag">Tag Name</option>
          </select>
        </div>
        <div class="form-group">
          <label>Search Value</label>
          <input type="text" id="searchValue" placeholder="Enter search term">
        </div>
        <button class="btn" style="width: 100%;" onclick="quickSearch()">Search</button>
        <div id="searchResults" style="margin-top: 1rem; max-height: 200px; overflow-y: auto; font-size: 0.85rem;"></div>
      </div>
    </div>

    <div class="preview-container">
      <div class="preview-toolbar">
        <strong>Live Preview</strong>
        <button class="btn" onclick="refreshPreview()">🔄 Refresh Preview</button>
        <span style="margin-left: auto; color: #666; font-size: 0.9rem;">
          Changes will appear after clicking "Apply Changes"
        </span>
      </div>
      <iframe id="previewFrame" class="preview-frame" src="/preview?edit=true"></iframe>
    </div>
  </div>

  <script>
    // Load initial stats
    loadStats();

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('pageTitle').value = data.title;
        document.getElementById('pageId').value = data.itemId;
        document.getElementById('compCount').textContent = \`\${data.components} components\`;
        document.getElementById('styleCount').textContent = \`\${data.styles} styles\`;
        document.getElementById('assetCount').textContent = \`\${data.assets} assets\`;
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }

    async function updatePageSettings() {
      const title = document.getElementById('pageTitle').value;
      
      try {
        const res = await fetch('/api/page/title', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        });
        
        if (res.ok) {
          showMessage('pageSuccess');
          loadStats();
        }
      } catch (error) {
        console.error('Failed to update page:', error);
      }
    }

    async function searchComponent() {
      const id = document.getElementById('componentId').value;
      if (!id) return;

      try {
        const res = await fetch(\`/api/components/\${id}\`);
        const data = await res.json();
        
        if (res.ok) {
          document.getElementById('componentType').value = data.type || '';
          document.getElementById('componentStyle').value = data.style || '';
          showMessage('componentSuccess');
        } else {
          showMessage('componentError');
        }
      } catch (error) {
        showMessage('componentError');
      }
    }

    async function updateComponent() {
      const id = document.getElementById('componentId').value;
      const type = document.getElementById('componentType').value;
      const style = document.getElementById('componentStyle').value;
      
      if (!id) return;

      const updates = {};
      if (type) updates.type = type;
      if (style) updates.style = style;

      try {
        const res = await fetch(\`/api/components/\${id}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        
        if (res.ok) {
          showMessage('componentSuccess');
        } else {
          showMessage('componentError');
        }
      } catch (error) {
        showMessage('componentError');
      }
    }

    async function updateStyle() {
      const selector = document.getElementById('styleSelector').value;
      const properties = document.getElementById('styleProperties').value;
      
      if (!selector || !properties) return;

      try {
        const props = JSON.parse(properties);
        const res = await fetch(\`/api/styles/\${encodeURIComponent(selector)}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: props })
        });
        
        if (res.ok) {
          showMessage('styleSuccess');
        } else {
          showMessage('styleError');
        }
      } catch (error) {
        showMessage('styleError');
      }
    }

    async function quickSearch() {
      const type = document.getElementById('searchType').value;
      const value = document.getElementById('searchValue').value;
      
      if (!value) return;

      try {
        let url = '/api/components';
        if (type === 'type') url += \`?type=\${value}\`;
        else if (type === 'tag') url += \`?tagName=\${value}\`;
        else url += \`/\${value}\`;

        const res = await fetch(url);
        const data = await res.json();
        
        const resultsDiv = document.getElementById('searchResults');
        if (Array.isArray(data)) {
          resultsDiv.innerHTML = \`<strong>Found \${data.length} results</strong><br><br>\` + 
            data.slice(0, 10).map((c, i) => 
              \`<div style="padding: 0.5rem; background: #f3f4f6; border-radius: 4px; margin-bottom: 0.5rem;">
                <strong>\${i + 1}.</strong> Type: \${c.type || 'N/A'}, ID: \${c.attributes?.id || 'N/A'}
              </div>\`
            ).join('');
        } else {
          resultsDiv.innerHTML = \`<div style="padding: 0.5rem; background: #f3f4f6; border-radius: 4px;">
            <strong>Type:</strong> \${data.type || 'N/A'}<br>
            <strong>ID:</strong> \${data.attributes?.id || 'N/A'}<br>
            <strong>Tag:</strong> \${data.tagName || 'N/A'}
          </div>\`;
        }
      } catch (error) {
        document.getElementById('searchResults').innerHTML = 
          '<div style="color: #ef4444;">Error searching components</div>';
      }
    }

    function applyChanges() {
      refreshPreview();
      alert('✓ Changes applied! Preview updated.');
    }

    function refreshPreview() {
      document.getElementById('previewFrame').src = '/preview?edit=true&t=' + Date.now();
    }
    
    // Listen for messages from preview iframe
    window.addEventListener('message', async (event) => {
      if (event.data.type === 'elementSelected') {
        console.log('Element selected:', event.data);
        // Update sidebar with selected element data
        document.getElementById('componentId').value = event.data.id;
        // Auto-fetch component data when selected
        searchComponent().then(() => {
          // Show notification
          const notification = document.getElementById('editNotification');
          notification.style.display = 'block';
          setTimeout(() => {
            notification.style.display = 'none';
          }, 4000);
        });
        // Highlight the component editor section
        const componentSection = document.querySelector('#componentId').closest('.editor-section');
        if (componentSection) {
          componentSection.style.border = '2px solid #10b981';
          componentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            componentSection.style.border = '';
          }, 2000);
        }
      } else if (event.data.type === 'editElement') {
        console.log('Edit element:', event.data);
        // Populate the form and focus
        document.getElementById('componentId').value = event.data.id;
        searchComponent();
        // Scroll to component editor
        document.querySelector('#componentId').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (event.data.type === 'duplicateElement') {
        console.log('Duplicate element:', event.data);
        await handleDuplicate(event.data.id);
      } else if (event.data.type === 'deleteElement') {
        console.log('Delete element:', event.data);
        await handleDelete(event.data.id);
      } else if (event.data.type === 'editElementJS') {
        console.log('Edit element JS:', event.data);
        await handleEditJS(event.data.id);
      }
    });
    
    async function handleDuplicate(id) {
      try {
        const res = await fetch(\`/api/components/\${id}/duplicate\`, {
          method: 'POST'
        });
        const data = await res.json();
        
        if (res.ok) {
          alert('✓ Component duplicated! New ID: ' + data.newId);
          refreshPreview();
          loadStats();
        } else {
          alert('✗ Failed to duplicate component');
        }
      } catch (error) {
        console.error('Duplicate error:', error);
        alert('✗ Error duplicating component');
      }
    }
    
    async function handleDelete(id) {
      try {
        const res = await fetch(\`/api/components/\${id}\`, {
          method: 'DELETE'
        });
        
        if (res.ok) {
          alert('✓ Component deleted!');
          refreshPreview();
          loadStats();
          // Clear the editor fields
          document.getElementById('componentId').value = '';
          document.getElementById('componentType').value = '';
          document.getElementById('componentStyle').value = '';
        } else {
          alert('✗ Failed to delete component');
        }
      } catch (error) {
        console.error('Delete error:', error);
        alert('✗ Error deleting component');
      }
    }
    
    async function handleEditJS(id) {
      // TODO: Open Monaco editor modal for editing JavaScript
      alert('Edit JS feature coming soon! Will use modern-monaco editor.');
      console.log('Will edit JavaScript for component:', id);
    }

    async function reloadPage() {
      if (!confirm('Reset to original sample page? All changes will be lost.')) return;
      
      try {
        const res = await fetch('/api/reload', { method: 'POST' });
        if (res.ok) {
          loadStats();
          refreshPreview();
          alert('✓ Page reset to original!');
        }
      } catch (error) {
        console.error('Failed to reload:', error);
      }
    }

    function showMessage(id) {
      const el = document.getElementById(id);
      el.style.display = 'block';
      setTimeout(() => {
        el.style.display = 'none';
      }, 3000);
    }
  </script>
</body>
</html>`;
}

// HTML for preview with optional WYSIWYG editing
function getPreviewHTML(title: string, css: string, html: string, components: any[], editMode: boolean): string {
  const editingScript = editMode ? `
<style>
  .editorts-highlight {
    outline: 2px dashed var(--color-editor-light-text, #212C3E) !important;
    outline-offset: 2px;
    cursor: pointer !important;
    position: relative !important;
  }
  .editorts-highlight:hover {
    outline: 2px solid var(--color-editor-light-text, #212C3E) !important;
    background-color: rgba(33, 44, 62, 0.1) !important;
  }
  .editorts-selected {
    outline: 3px solid #10b981 !important;
    background-color: rgba(16, 185, 129, 0.1) !important;
  }
  .editorts-label {
    position: absolute;
    top: -24px;
    left: 0;
    background: var(--color-editor-light-text, #212C3E);
    color: white;
    padding: 2px 8px;
    font-size: 11px;
    font-family: monospace;
    border-radius: 3px;
    z-index: 10000;
    pointer-events: none;
  }
  .editorts-toolbar {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    z-index: 10001;
    max-width: 300px;
  }
  .editorts-toolbar h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: #333;
  }
  .editorts-toolbar p {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    color: #666;
  }
  .editorts-toolbar button {
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.5rem;
    background: var(--color-editor-light-text, #212C3E);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .editorts-toolbar button:hover {
    background: var(--color-editor-light-bg, #EDF0F5);
    color: var(--color-editor-light-text, #212C3E);
  }
  .editorts-context-toolbar {
    position: absolute;
    background: white;
    border-radius: 6px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    padding: 0.4rem;
    display: none;
    z-index: 999999;
    flex-direction: row;
    gap: 0.3rem;
    border: 2px solid var(--color-editor-light-text, #212C3E);
    width: auto;
    pointer-events: auto;
  }
  .editorts-context-toolbar.active {
    display: flex !important;
  }
  .toolbar-action {
    background: white;
    border: 1px solid var(--color-primary-border, #e5e7eb);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .toolbar-action:hover {
    background: var(--color-editor-light-bg, #EDF0F5);
    border-color: var(--color-editor-light-text, #212C3E);
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  .toolbar-action .icon {
    font-size: 1.1rem;
  }
  .toolbar-action.danger:hover {
    background: #fee;
    border-color: #ef4444;
    color: #ef4444;
  }
</style>
<script>
  let selectedElement = null;
  
  // Default toolbar configuration (fallback)
  const defaultToolbar = {
    enabled: true,
    actions: [
      { id: 'edit', label: 'Edit', icon: '✏️', enabled: true, description: 'Edit component' },
      { id: 'editJS', label: 'Edit JS', icon: '📜', enabled: true, description: 'Edit JavaScript' },
      { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true, description: 'Duplicate component' },
      { id: 'delete', label: 'Delete', icon: '🗑️', enabled: true, danger: true, description: 'Delete component' }
    ]
  };
  
  // Get toolbar config for a component by ID (fetches runtime config from server)
  async function getComponentToolbar(id) {
    try {
      const res = await fetch('/api/toolbar/' + id);
      if (res.ok) {
        return await res.json();
      }
    } catch (error) {
      console.error('Failed to fetch toolbar config:', error);
    }
    return defaultToolbar;
  }
  
  function initEditor() {
    document.querySelectorAll('[id]').forEach(el => {
      if (el.id && el.id !== 'editorts-toolbar') {
        el.classList.add('editorts-highlight');
        
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectElement(el);
        });
        
        el.addEventListener('mouseenter', () => {
          if (el !== selectedElement) {
            showLabel(el);
          }
        });
        
        el.addEventListener('mouseleave', () => {
          removeLabel(el);
        });
      }
    });
  }
  
  function selectElement(el) {
    if (selectedElement) {
      selectedElement.classList.remove('editorts-selected');
    }
    
    selectedElement = el;
    el.classList.add('editorts-selected');
    updateToolbar(el);
    showContextToolbar(el);
    
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'elementSelected',
        id: el.id,
        tagName: el.tagName.toLowerCase(),
        className: el.className
      }, '*');
    }
  }
  
  async function showContextToolbar(el) {
    const toolbar = document.getElementById('editorts-context-toolbar');
    if (!toolbar) return;
    
    // Get component's toolbar config from server
    const toolbarConfig = await getComponentToolbar(el.id);
    
    // Check if toolbar is enabled for this component
    if (!toolbarConfig.enabled) {
      toolbar.classList.remove('active');
      return;
    }
    
    // Build toolbar buttons dynamically from component's config
    const enabledActions = toolbarConfig.actions.filter(a => a.enabled);
    toolbar.innerHTML = enabledActions.map(action => {
      const dangerClass = action.danger ? ' danger' : '';
      return '<div class="toolbar-action' + dangerClass + '" onclick="toolbar' + capitalize(action.id) + '()" title="' + (action.description || action.label) + '">' +
        '<span class="icon">' + action.icon + '</span>' +
        '<span>' + action.label + '</span>' +
      '</div>';
    }).join('');
    
    // Append toolbar to the selected element (makes it relative to component)
    el.appendChild(toolbar);
    
    // Position at top-left of the component
    toolbar.style.top = '-40px';  // Slightly above the element
    toolbar.style.left = '0px';   // Aligned to left edge
    
    // Make visible
    toolbar.classList.add('active');
    
    console.log('✓ Toolbar anchored to element:', el.id);
  }
  
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  function hideContextToolbar() {
    const toolbar = document.getElementById('editorts-context-toolbar');
    if (toolbar) {
      toolbar.classList.remove('active');
    }
  }
  
  function showLabel(el) {
    const label = document.createElement('div');
    label.className = 'editorts-label';
    label.textContent = '#' + el.id;
    el.appendChild(label);
  }
  
  function removeLabel(el) {
    const label = el.querySelector('.editorts-label');
    if (label) label.remove();
  }
  
  function updateToolbar(el) {
    const toolbar = document.getElementById('editorts-toolbar');
    if (toolbar) {
      const info = toolbar.querySelector('.element-info');
      info.innerHTML = '<p><strong>ID:</strong> ' + el.id + '</p>' +
        '<p><strong>Tag:</strong> ' + el.tagName.toLowerCase() + '</p>' +
        '<p><strong>Classes:</strong> ' + (el.className || 'none') + '</p>';
    }
  }
  
  function editInSidebar() {
    if (selectedElement && window.parent !== window) {
      window.parent.postMessage({
        type: 'editElement',
        id: selectedElement.id
      }, '*');
    }
  }
  
  // ========== TOOLBAR ACTIONS ==========
  // Actions are configured in server.ts toolbarConfig
  
  function toolbarEdit() {
    if (!selectedElement) return;
    hideContextToolbar();
    editInSidebar();
  }
  
  function toolbarEditJS() {
    if (!selectedElement) return;
    hideContextToolbar();
    
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'editElementJS',
        id: selectedElement.id
      }, '*');
    }
  }
  
  function toolbarDuplicate() {
    if (!selectedElement) return;
    
    if (confirm('Duplicate element #' + selectedElement.id + '?')) {
      hideContextToolbar();
      
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'duplicateElement',
          id: selectedElement.id
        }, '*');
      }
    }
  }
  
  function toolbarDelete() {
    if (!selectedElement) return;
    
    if (confirm('Delete element #' + selectedElement.id + '? This cannot be undone.')) {
      hideContextToolbar();
      
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'deleteElement',
          id: selectedElement.id
        }, '*');
      }
    }
  }
  
  // Close toolbar when clicking outside
  document.addEventListener('click', (e) => {
    const toolbar = document.getElementById('editorts-context-toolbar');
    if (toolbar && !toolbar.contains(e.target) && !e.target.classList.contains('editorts-highlight')) {
      // Don't close immediately on element click
    }
  });
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
  } else {
    initEditor();
  }
</script>
<div id="editorts-toolbar" class="editorts-toolbar">
  <h3>🎯 Selected Element</h3>
  <div class="element-info">
    <p style="color: #999;">Click an element to select</p>
  </div>
  <button onclick="editInSidebar()">✏️ Edit in Sidebar</button>
</div>
<div id="editorts-context-toolbar" class="editorts-context-toolbar">
  <!-- Toolbar buttons are dynamically generated from component's toolbar config -->
</div>
` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${css}</style>
</head>
${html}
${editingScript}
</html>`;
}
