/**
 * SuperTab HTTP Server
 * A REST API server for testing the SuperTab library
 */

import { Page } from './index';
import { readFileSync } from 'fs';
import type { Component, Asset } from './src/types';

// Load sample page data
let currentPage: Page;
try {
  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  currentPage = new Page(jsonData);
  console.log('✓ Loaded sample page successfully');
} catch (error) {
  console.error('Failed to load sample page:', error);
  process.exit(1);
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

      // POST /api/reload - Reload sample page
      if (path === '/api/reload' && method === 'POST') {
        const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
        currentPage = new Page(jsonData);
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
        
        const previewHTML = getPreviewHTML(currentPage.getTitle(), css, html, editMode);
        
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
║   SuperTab Server Running                  ║
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
  <title>SuperTab Server - Web UI</title>
  <link rel="stylesheet" href="/branding.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-main, 'Noto Sans', sans-serif);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
      color: #667eea;
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
      color: #667eea;
    }
    button {
      background: #667eea;
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
      <h1>🚀 SuperTab Server</h1>
      <p>Interactive web interface for testing the SuperTab library</p>
      <div style="margin-top: 1rem;">
        <a href="/editor" style="background: #10b981; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500; margin-right: 1rem;">
          🎨 Open Content Editor
        </a>
        <a href="/preview" target="_blank" style="background: #667eea; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500;">
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
  <title>SuperTab Content Editor</title>
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
      <h1>🎨 SuperTab Content Editor</h1>
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
  "background-color": "#667eea",
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
      <iframe id="previewFrame" class="preview-frame" src="/preview"></iframe>
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
    window.addEventListener('message', (event) => {
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
      }
    });

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
function getPreviewHTML(title: string, css: string, html: string, editMode: boolean): string {
  const editingScript = editMode ? `
<style>
  .supertab-highlight {
    outline: 2px dashed var(--color-editor-light-text, #212C3E) !important;
    outline-offset: 2px;
    cursor: pointer !important;
    position: relative !important;
  }
  .supertab-highlight:hover {
    outline: 2px solid var(--color-editor-light-text, #212C3E) !important;
    background-color: rgba(33, 44, 62, 0.1) !important;
  }
  .supertab-selected {
    outline: 3px solid #10b981 !important;
    background-color: rgba(16, 185, 129, 0.1) !important;
  }
  .supertab-label {
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
  .supertab-toolbar {
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
  .supertab-toolbar h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: #333;
  }
  .supertab-toolbar p {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    color: #666;
  }
  .supertab-toolbar button {
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.5rem;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .supertab-toolbar button:hover {
    background: #5568d3;
  }
</style>
<script>
  let selectedElement = null;
  
  function initEditor() {
    document.querySelectorAll('[id]').forEach(el => {
      if (el.id && el.id !== 'supertab-toolbar') {
        el.classList.add('supertab-highlight');
        
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
      selectedElement.classList.remove('supertab-selected');
    }
    
    selectedElement = el;
    el.classList.add('supertab-selected');
    updateToolbar(el);
    
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'elementSelected',
        id: el.id,
        tagName: el.tagName.toLowerCase(),
        className: el.className
      }, '*');
    }
  }
  
  function showLabel(el) {
    const label = document.createElement('div');
    label.className = 'supertab-label';
    label.textContent = '#' + el.id;
    el.appendChild(label);
  }
  
  function removeLabel(el) {
    const label = el.querySelector('.supertab-label');
    if (label) label.remove();
  }
  
  function updateToolbar(el) {
    const toolbar = document.getElementById('supertab-toolbar');
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
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
  } else {
    initEditor();
  }
</script>
<div id="supertab-toolbar" class="supertab-toolbar">
  <h3>🎯 Selected Element</h3>
  <div class="element-info">
    <p style="color: #999;">Click an element to select</p>
  </div>
  <button onclick="editInSidebar()">✏️ Edit in Sidebar</button>
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
