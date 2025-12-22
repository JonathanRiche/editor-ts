# SuperTab

A powerful TypeScript library for editing HTML content while maintaining its structure in a JSON representation. SuperTab provides a simple `init()` function to create a fully-functional WYSIWYG editor with minimal configuration.

## Features

- **One-Line Setup**: Initialize a complete editor with `init()`
- **WYSIWYG Editing**: Click-to-edit interface with context toolbars
- **Runtime Configuration**: Toolbars configured in JavaScript, not stored in JSON
- **Iframe Sandboxing**: Template runs in isolated iframe for proper CSS/JS scoping
- **Event System**: Hook into component selection, editing, deletion, etc.
- **Type-Safe**: Full TypeScript support
- **Clean JSON**: Only stores component metadata and styles, no behavioral config

## Quick Start

```bash
bun install
bun run dev
```

Open http://localhost:5021 to see the editor!

## Simple Usage with `init()`

```typescript
import { init } from 'supertab';
import pageData from './page.json';

// Initialize editor with one function call
const editor = init({
  containerId: 'root',
  data: pageData,
  
  // Configure toolbars (runtime only, not saved to JSON)
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
  
  // Optional callbacks
  onComponentSelect: (component) => {
    console.log('Selected:', component.attributes?.id);
  }
});

// Access the Page API
editor.page.components.findById('header');
editor.page.styles.updateStyle('#header', { 'color': 'red' });

// Add event listeners
editor.on('componentEdit', (component) => {
  console.log('Editing:', component);
});

// Save the page (clean JSON, no toolbar configs)
const json = editor.save();
```

## Architecture: Runtime vs. Stored Data

SuperTab follows a clean separation between **data** (stored in JSON) and **behavior** (configured in JavaScript).

**See [AGENTS.md](./AGENTS.md) for full architecture principles.**

### What's Stored in JSON (Database)
- Component metadata (type, attributes, tagName)
- Styling (CSS, inline styles)
- Content (text, HTML, assets)
- Component structure

### What's Configured in JavaScript (Runtime)
- Toolbar configurations
- Editor behaviors
- UI interactions
- Event handlers
- Permissions

**Example:**
```typescript
// JSON stays clean
const page = new Page(jsonData);

// Configure at runtime
page.toolbars.configureById('header', { ... });

// Export is still clean
page.toJSON(); // No toolbar property in output
```

## Toolbar System

### Configure Toolbars at Runtime

```typescript
const editor = init({
  containerId: 'root',
  data: pageData,
  toolbars: {
    // By component ID
    byId: {
      'header': { enabled: true, actions: [...] },
      'footer': { enabled: false, actions: [] }
    },
    
    // By component type
    byType: {
      'custom-code': { actions: [...] },
      'box': { actions: [...] }
    },
    
    // By tag name
    byTag: {
      'div': { actions: [...] }
    },
    
    // Global default
    default: { actions: [...] }
  }
});

// Or configure after init
editor.page.toolbars.configureById('sidebar', {
  enabled: true,
  actions: [
    { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
    { id: 'delete', label: 'Delete', icon: '🗑️', enabled: false, danger: true }
  ]
});
```

### Toolbar Actions

- **Edit (✏️)** - Edit component properties
- **Edit JS (📜)** - Edit component JavaScript with Monaco editor
- **Duplicate (📋)** - Create a copy of the component
- **Delete (🗑️)** - Remove component from page

### Toolbar Presets

```typescript
import { toolbarPresets } from 'supertab';

// Use presets
page.toolbars.configureById('header', toolbarPresets.full);
page.toolbars.configureById('footer', toolbarPresets.editOnly);
page.toolbars.configureById('banner', toolbarPresets.minimal);
```

Available presets:
- `full` - All actions enabled
- `editOnly` - Edit, Edit JS, Duplicate (no delete)
- `minimal` - Edit and Delete only
- `readOnly` - View only
- `disabled` - No toolbar

## API Reference

### `init(config)` → SuperTabEditor

Initialize the editor with configuration.

**Returns:** SuperTabEditor instance

```typescript
interface SuperTabEditor {
  page: Page;                    // Full Page instance
  on(event, callback): void;     // Add event listener
  off(event, callback): void;    // Remove event listener
  refresh(): void;               // Refresh preview
  save(): string;                // Export JSON
  destroy(): void;               // Clean up
  elements: {                    // Access DOM elements
    container: HTMLElement;
    sidebar?: HTMLElement;
    canvas: HTMLElement;
    iframe: HTMLIFrameElement;
  }
}
```

**Events:**
- `componentSelect` - When component is clicked
- `componentEdit` - When edit action is triggered
- `componentDuplicate` - When component is duplicated
- `componentDelete` - When component is deleted
- `componentEditJS` - When Edit JS is triggered

### Page Class

Direct API for programmatic manipulation:

```typescript
import { Page } from 'supertab';

const page = new Page(jsonData);

// Page methods
page.getTitle();
page.setTitle(title);
page.getHTML();
page.getCSS();
page.toJSON();
page.clone();

// Managers
page.components.findById(id);
page.components.updateComponent(id, updates);
page.styles.updateStyle(selector, properties);
page.assets.getImages();
page.toolbars.configureById(id, config);
```

### ComponentManager

```typescript
page.components.find(query);
page.components.findById(id);
page.components.findByType(type);
page.components.addComponent(component);
page.components.removeComponent(id);
page.components.updateComponent(id, updates);
page.components.getAll();
page.components.count();
```

### StyleManager

```typescript
page.styles.findBySelector(selector);
page.styles.findByMedia(mediaText);
page.styles.addStyle(style);
page.styles.updateStyle(selector, properties);
page.styles.removeBySelector(selector);
page.styles.compileToCSS();
page.styles.getAll();
```

### AssetManager

```typescript
page.assets.findByType(type);
page.assets.getImages();
page.assets.addAsset(asset);
page.assets.removeAsset(src);
page.assets.updateAsset(src, updates);
page.assets.getAll();
```

### ToolbarManager

```typescript
page.toolbars.configureById(id, config);
page.toolbars.configureByType(type, config);
page.toolbars.configureByTag(tagName, config);
page.toolbars.configureCustom(matcher, config);
page.toolbars.getToolbarForComponent(component);
page.toolbars.setGlobalDefault(config);
```

## Examples

### Basic Editor Setup

```typescript
import { init } from 'supertab';

const editor = init({
  containerId: 'root',
  data: pageData
});

console.log('Components:', editor.page.components.count());
```

### With Toolbar Configuration

```typescript
const editor = init({
  containerId: 'root',
  data: pageData,
  toolbars: {
    byType: {
      'custom-code': {
        actions: [
          { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true }
        ]
      }
    }
  }
});
```

### With Event Handlers

```typescript
const editor = init({
  containerId: 'root',
  data: pageData,
  onComponentSelect: (comp) => console.log('Selected:', comp),
  onComponentDelete: (comp) => console.log('Deleted:', comp)
});

// Add more listeners after init
editor.on('componentEdit', (component) => {
  // Custom edit logic
});
```

### Programmatic Page Manipulation

```typescript
import { Page } from 'supertab';

const page = new Page(jsonData);

// Find components
const header = page.components.findById('header');
const boxes = page.components.findByType('box');

// Update styles
page.styles.updateStyle('#header', {
  'background-color': '#333',
  'padding': '2rem'
});

// Manage assets
const images = page.assets.getImages();

// Export clean JSON
const json = page.toJSON();
```

## Project Structure

```
supertab/
├── src/
│   ├── core/
│   │   ├── init.ts              # Editor initialization
│   │   ├── Page.ts              # Main Page class
│   │   ├── ComponentManager.ts  # Component operations
│   │   ├── StyleManager.ts      # Style operations
│   │   ├── AssetManager.ts      # Asset operations
│   │   └── ToolbarManager.ts    # Runtime toolbar config
│   ├── styles/
│   │   └── branding.css         # Editor branding
│   ├── utils/
│   │   ├── helpers.ts           # Utility functions
│   │   └── toolbar.ts           # Toolbar utilities
│   └── types.ts                 # Type definitions
├── examples/
│   ├── quickstart.ts            # Simple editor example
│   ├── basic-usage.ts           # Library API examples
│   └── toolbar-example.ts       # Toolbar configuration examples
├── samples/
│   └── page_template.json       # Sample page data
├── index.html                   # Editor HTML template
├── local-server.ts              # Simple Bun dev server
├── index.ts                     # Main library exports
└── AGENTS.md                    # Architecture principles
```

## Development

```bash
# Run the editor
bun run dev

# Run examples
bun run examples/basic-usage.ts
bun run examples/toolbar-example.ts

# Build
bun build index.ts --outdir=dist
```

## License

MIT

## Contributing

Contributions are welcome! Please read [AGENTS.md](./AGENTS.md) for architecture guidelines.
