# EditorTs Architecture Principles

## Core Principle: Runtime vs. Stored Data

This document defines the architectural boundaries between what gets stored in JSON (database) and what stays in JavaScript (runtime).

---

## 🏗️ How EditorTs Works

EditorTs is a TypeScript library for building HTML content editors. The library provides:

1. **`init()` Function** - One-line editor setup
2. **Page API** - Programmatic access to components, styles, and assets
3. **Runtime Configuration** - Toolbars, behaviors, and UI configured in JavaScript
4. **Clean JSON** - Only content metadata stored, never behavioral config

### Quick Example

```typescript
import { init } from 'editorts';

// User creates HTML layout (index.html)
// <iframe id="preview"></iframe>
// <div id="stats"></div>

// Initialize editor with config
const editor = init({
  iframeId: 'preview',
  data: pageData,
  toolbars: {
    byType: { 'box': { actions: ['edit', 'delete'] } }
  },
  ui: {
    stats: { containerId: 'stats' }
  }
});

// Access the Page API
editor.page.components.findById('header');

// Add event listeners
editor.on('componentSelect', (comp) => { ... });

// Save clean JSON
const json = editor.save();
```

---

## ✅ What Goes in JSON (Database)

**Pure data only - the "what" of your content:**

### Component Metadata
- Component type (`type: "box"`, `type: "custom-code"`)
- Attributes (`id`, `class`, `data-*`, etc.)
- Tag names (`tagName: "div"`, `tagName: "section"`)
- Component hierarchy (parent/child relationships)

### Styling
- CSS classes and IDs
- Inline styles (`style: "padding: 1rem;"`)
- Style definitions (selectors, properties, media queries)
- Compiled CSS strings

### Content
- Text content
- HTML markup
- Asset references (image URLs, video sources)
- Links and references

### Assets
- Image/video/audio sources
- Dimensions and units
- CDN flags
- Asset metadata

### Scripts (Component Behavior)
- Component-level JavaScript (`script: "console.log('loaded');"`)
- This is the component's own logic, not editor behavior

### Example Clean JSON:
```json
{
  "type": "box",
  "attributes": { 
    "id": "header",
    "class": "container"
  },
  "style": "padding: 1rem; background: blue;",
  "script": "console.log('component loaded');",
  "components": [
    {
      "type": "text",
      "content": "Hello World"
    }
  ]
}
```

**Notice:** No toolbar config, no editor behaviors, just pure component data.

---

## ❌ What Stays in JavaScript (Runtime)

**Application logic and configuration - the "how" of your editor:**

### Editor Behaviors
- Toolbar configurations (which actions appear)
- Which components are editable
- Which actions are enabled/disabled
- Custom toolbar actions

### UI Layout
- HTML structure (user creates in index.html)
- Sidebar placement
- Canvas/iframe positioning
- Custom UI elements

### UI Interactions
- Click handlers
- Drag-and-drop rules
- Hover behaviors
- Selection logic
- WYSIWYG overlay

### Rendering Rules
- How to display components in editor
- Visual indicators (outlines, highlights)
- Preview modes
- Iframe sandboxing

### Validation & Permissions
- Validation rules
- Permission checks
- Edit restrictions
- User role requirements

### Custom Handlers
- Event listeners (componentSelect, componentEdit, etc.)
- Custom toolbar actions
- API integrations
- Business logic

### Example Runtime Configuration:

**User creates HTML layout:**
```html
<!-- index.html -->
<div id="sidebar"></div>
<iframe id="preview"></iframe>
<div id="stats"></div>
```

**User configures in JavaScript:**
```typescript
import { init } from 'editorts';

const editor = init({
  iframeId: 'preview',
  data: jsonData,
  
  // Toolbar configs - runtime only
  toolbars: {
    byId: {
      'header': { 
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
          { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true }
        ]
      }
    },
    byType: {
      'custom-code': {
        actions: [
          { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true }
        ]
      }
    }
  },
  
  // UI container mapping
  ui: {
    stats: { containerId: 'stats', enabled: true }
  },
  
  // Event handlers
  onComponentSelect: (comp) => {
    console.log('Selected:', comp);
  }
});

// Page API access
editor.page.components.updateComponent('header', { style: 'color: red;' });
editor.page.toolbars.configureById('footer', { enabled: false });

// JSON export is CLEAN - no toolbar config
const cleanJSON = editor.save();
```

---

## 🎯 Decision Framework

When adding a new feature, ask:

### "Does this describe WHAT the content is?"
→ **Store in JSON**
- Examples: component type, styles, content, structure

### "Does this describe HOW to edit/interact with it?"
→ **Keep in JavaScript runtime**
- Examples: toolbars, permissions, behaviors, UI rules

### "Will different applications want different behaviors for the same content?"
→ **Keep in JavaScript runtime**
- Example: Admin users might have different toolbars than regular users

### "Is this data that should be versioned/backed up?"
→ **Store in JSON**
- Example: The actual page content and structure

### "Is this configuration specific to the editor application?"
→ **Keep in JavaScript runtime**
- Example: Which buttons appear in the toolbar, where sidebar is positioned

### "Does this control the UI or editor experience?"
→ **Keep in JavaScript runtime**
- Example: Sidebar width, stats display, event callbacks

---

## 📐 Architecture Layers

```
┌─────────────────────────────────────────────────┐
│   Application Layer (User's Code)               │
│   - HTML layout (index.html)                    │
│   - CSS styling (custom styles)                 │
│   - init() configuration                        │
│   - Event listeners                             │
│   - Custom UI elements                          │
└─────────────────────────────────────────────────┘
                    ↓ uses
┌─────────────────────────────────────────────────┐
│   EditorTs Library                               │
│   - init() function                              │
│   - Page class                                   │
│   - ComponentManager, StyleManager, AssetManager │
│   - ToolbarManager (runtime configs)            │
│   - Event system (on/off/emit)                  │
│   - WYSIWYG iframe injection                    │
└─────────────────────────────────────────────────┘
                    ↓ reads/writes
┌─────────────────────────────────────────────────┐
│   Clean JSON Data (Database)                    │
│   - Components (type, attrs, structure)         │
│   - Styles (CSS, selectors)                     │
│   - Assets (URLs, metadata)                     │
│   - Component scripts (their own JS logic)      │
│   - NO toolbar config                           │
│   - NO editor behaviors                         │
│   - NO UI layout                                │
└─────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow

### Loading Data
```
Database (JSON) 
  → Page class parses
  → User calls init() with Page data
  → init() loads into iframe
  → User configures toolbars at runtime
  → WYSIWYG overlays added
```

### Saving Data
```
User clicks save
  → editor.save() called
  → Page.toJSON() exports
  → Only component/style/asset data
  → NO toolbar configs
  → Clean JSON to database
```

### User Interaction
```
User clicks component in iframe
  → postMessage to parent
  → Page API finds component
  → ToolbarManager gets runtime config
  → Toolbar rendered based on config
  → User clicks action
  → Event emitted
  → Component updated
  → Iframe refreshed
```

---

## 🎨 User-Controlled Layout

Users create their own HTML structure and style it however they want:

**User's HTML:**
```html
<!-- They design the layout -->
<div class="my-custom-editor">
  <aside class="my-sidebar">
    <div id="my-stats"></div>
    <div id="my-selected"></div>
  </aside>
  <main class="my-canvas">
    <iframe id="my-preview"></iframe>
  </main>
</div>

<!-- They add their own styles -->
<style>
  .my-custom-editor { /* custom layout */ }
  .my-sidebar { /* custom sidebar style */ }
</style>
```

**User's JavaScript:**
```typescript
import { init } from 'editorts';

// init() populates their containers
const editor = init({
  iframeId: 'my-preview',  // User's iframe
  data: pageData,
  ui: {
    stats: { containerId: 'my-stats' },
    selectedInfo: { containerId: 'my-selected' }
  }
});
```

**EditorTs doesn't force any UI structure** - users have complete control.

---

## ✅ Benefits of This Approach

1. **Clean Data Separation**
   - JSON is portable and reusable
   - Same data can be used in different editors
   - Data is simpler to version control

2. **Flexible Behavior**
   - Different apps can have different toolbars for same content
   - Easy to change editor behavior without migrating data
   - Behavior can depend on user roles/permissions

3. **No Data Pollution**
   - Database doesn't contain UI configuration
   - JSON exports are clean
   - Easier to integrate with other systems

4. **Runtime Flexibility**
   - Configure toolbars based on user role
   - Dynamic behavior without data changes
   - Easy A/B testing of editor features

5. **User-Controlled UI**
   - Users design their own layouts
   - Complete styling freedom
   - No forced UI structure
   - Bring your own HTML/CSS

6. **Proper Sandboxing**
   - Template runs in iframe
   - CSS/JS properly isolated
   - Component scripts execute safely
   - No style conflicts

---

## 🚫 Anti-Patterns to Avoid

### ❌ Don't Store Behavioral Config in JSON

```typescript
// ❌ BAD - Adding editor config to component data
component.toolbar = { actions: [...] };
component.editorConfig = { draggable: true };
component.permissions = { canEdit: true };
component.uiLayout = { position: 'top' };
```

### ✅ Do Configure at Runtime

```typescript
// ✅ GOOD - Configure at runtime, separate from data
const editor = init({
  iframeId: 'preview',
  data: jsonData,
  toolbars: {
    byId: { 'header': { ... } }
  }
});

editor.page.toolbars.configureById('footer', toolbarConfig);
```

### ❌ Don't Create UI in init()

```typescript
// ❌ BAD - init() creates HTML structure
init({ 
  containerId: 'root',
  createSidebar: true,  // NO!
  sidebarWidth: 300     // NO!
});
```

### ✅ Do Let Users Create UI

```html
<!-- ✅ GOOD - User creates structure in HTML -->
<div id="my-sidebar"></div>
<iframe id="preview"></iframe>

<script>
  init({
    iframeId: 'preview',
    ui: { stats: { containerId: 'my-sidebar' } }
  });
</script>
```

---

## 📝 Summary

**JSON = Data (the content)**
- Components, styles, assets
- What exists and how it's structured

**JavaScript = Behavior (how to edit it)**
- Toolbar configs, event handlers
- How users interact with the content

**HTML/CSS = UI (user controls design)**
- Layout, positioning, styling
- Completely customizable by user

**Keep them separate.** The JSON should be dumb data that any application can consume. The JavaScript runtime decides how to interact with that data. The user decides how to present it.

---

## 🎓 Guidelines for Contributors

When adding a new feature:

1. **Ask:** Is this about the content or the editor?
   - Content → JSON
   - Editor → Runtime

2. **Check:** Does this belong in init() config?
   - Yes if: User should configure it
   - No if: Internal library logic

3. **Consider:** Should users control this UI?
   - Yes → Let them create HTML elements
   - No → Handle internally (like iframe content)

4. **Test:** Export the JSON
   - Verify no editor configs leaked
   - JSON should be portable

5. **Document:** Update this file if architecture changes

6. **Respect User Edits:** 
   - If the user has removed a component/feature from their code, DO NOT add it back
   - The user is actively editing files - check recent changes before suggesting additions
   - Example: If user removed a save button, don't re-introduce it

---

**This principle applies to ALL future features in EditorTs.**
