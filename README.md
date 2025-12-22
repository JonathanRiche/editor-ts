# SuperTab

A powerful TypeScript library for editing HTML content while maintaining its structure in a JSON representation. SuperTab allows you to programmatically manipulate web page components, styles, and assets with a clean, type-safe API.

## Features

- **Component Management**: Find, add, update, and remove HTML components
- **Style Management**: Manipulate CSS styles, media queries, and pseudo-states
- **Asset Management**: Handle images, videos, and other media assets
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Utility Functions**: Helper functions for common operations
- **JSON Serialization**: Import and export your page structure as JSON

## Installation

```bash
bun install
```

## Toolbar System

SuperTab includes a **modular, component-level toolbar system** for WYSIWYG editing.

### Component-Level Toolbars

Each component can have its own toolbar configuration stored in JSON:

```typescript
import { Page, defaultToolbarConfig, toolbarPresets } from 'supertab';

const page = new Page(jsonData);

// Set default toolbar for a component
page.components.setToolbar('header', defaultToolbarConfig);

// Use preset toolbar (edit-only, no delete)
page.components.setToolbar('footer', toolbarPresets.editOnly);

// Create custom toolbar
page.components.setToolbar('sidebar', {
  enabled: true,
  actions: [
    { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
    { id: 'duplicate', label: 'Copy', icon: '📋', enabled: true }
  ]
});

// Disable toolbar for specific component
page.components.setToolbar('banner', { enabled: false, actions: [] });
```

### Available Toolbar Actions

- **Edit (✏️)** - Edit component properties in sidebar
- **Edit JS (📜)** - Edit component JavaScript with Monaco editor
- **Duplicate (📋)** - Create a copy of the component
- **Delete (🗑️)** - Remove component from page

### Toolbar Presets

- `toolbarPresets.full` - All actions enabled
- `toolbarPresets.editOnly` - Edit, Edit JS, Duplicate (no delete)
- `toolbarPresets.minimal` - Edit and Delete only
- `toolbarPresets.readOnly` - View only
- `toolbarPresets.disabled` - No toolbar

### ComponentManager Toolbar Methods

```typescript
// Get toolbar config
page.components.getToolbar('componentId');

// Set toolbar config
page.components.setToolbar('componentId', config);

// Remove toolbar
page.components.removeToolbar('componentId');

// Toggle specific action
page.components.toggleToolbarAction('componentId', 'delete', false);

// Add custom action
page.components.addToolbarAction('componentId', {
  id: 'custom',
  label: 'Custom',
  icon: '⚡',
  enabled: true
});
```

## Quick Start - Web Server

The fastest way to try SuperTab is to run the interactive web server:

```bash
bun run dev
# or
bun run server
```

Then open http://localhost:5021 in your browser!

The server provides:
- **Web Dashboard** (http://localhost:5021/) - View statistics and test APIs
- **Content Editor** (http://localhost:5021/editor) - Interactive visual editor
- **Live Preview** (http://localhost:5021/preview) - See your page with applied styles
- **REST API** - Full programmatic access to all features

### Content Editor Features

The visual editor at `/editor` provides:
- 📄 Page settings (title, ID)
- 🧩 Component editor (find, update by ID)
- 🎨 CSS style editor (update styles with JSON)
- 🔍 Quick search (by ID, type, or tag)
- 👁️ **Live preview with WYSIWYG** (click elements to edit!)
- ↻ Reset to original sample

### WYSIWYG Click-to-Edit

The preview pane includes **one-click editing**:

**How it works:**
1. **Click** any element in the preview (elements with IDs have blue dashed outlines)
2. **Auto-magic happens:**
   - Element highlights in green
   - Sidebar auto-fills with component ID
   - Component data automatically loads from API
   - Fields populate (type, style, etc.)
   - Green notification appears
   - Component section scrolls into view

3. **Edit the fields** (type, inline styles, etc.)
4. **Click "Update Component"** to save changes
5. **Click "✓ Apply Changes"** in header to refresh preview

**Visual indicators:**
- 🔵 Blue dashed outline = clickable element (on hover)
- 🟢 Green solid outline = selected element  
- 🏷️ ID label appears on hover
- ✅ Green notification = data loaded, ready to edit
- 📍 Floating toolbar shows selection details

## Quick Start - Programmatic Usage

```typescript
import { Page } from 'supertab';

// Load a page from JSON
const page = new Page(jsonData);

// Find and update components
const header = page.components.findById('header');
page.components.updateComponent('header', {
  style: 'background-color: blue;'
});

// Manage styles
page.styles.updateStyle('#header', {
  'font-size': '2rem',
  'color': '#ffffff'
});

// Work with assets
const images = page.assets.getImages();
console.log('Total images:', images.length);

// Export back to JSON
const json = page.toJSON();
```

## API Reference

### Page Class

The main class for managing page content.

#### Constructor

```typescript
const page = new Page(jsonData: PageData | string);
```

#### Methods

- `getTitle()`: Get the page title
- `setTitle(title: string)`: Set the page title
- `getHTML()`: Get the raw HTML
- `setHTML(html: string)`: Set the raw HTML
- `getCSS()`: Get the compiled CSS
- `toJSON()`: Export page as JSON string
- `toObject()`: Export page as object
- `clone()`: Create a copy of the page

### ComponentManager

Manages HTML components in the page.

#### Methods

- `find(query: ComponentQuery)`: Find components matching a query
- `findById(id: string)`: Find a component by ID
- `findByType(type: string)`: Find components by type
- `findByTagName(tagName: string)`: Find components by tag name
- `addComponent(component: Component)`: Add a component
- `addChildComponent(parentId: string, component: Component)`: Add a child component
- `removeComponent(id: string)`: Remove a component
- `updateComponent(id: string, updates: Partial<Component>)`: Update a component
- `getAll()`: Get all components
- `count()`: Get component count

### StyleManager

Manages CSS styles.

#### Methods

- `find(query: StyleQuery)`: Find styles matching a query
- `findBySelector(selector: string)`: Find styles by selector
- `findByMedia(mediaText: string)`: Find styles by media query
- `addStyle(style: Style)`: Add a new style rule
- `updateStyle(selector: string, properties: CSSProperties)`: Update style properties
- `removeBySelector(selector: string)`: Remove styles
- `compileToCSS()`: Compile styles to CSS string
- `getAll()`: Get all styles
- `count()`: Get style count

### AssetManager

Manages page assets.

#### Methods

- `findByType(type: 'image' | 'video' | 'audio' | 'document')`: Find assets by type
- `findBySource(src: string)`: Find assets by source URL
- `addAsset(asset: Asset)`: Add a new asset
- `removeAsset(src: string)`: Remove an asset
- `updateAsset(src: string, updates: Partial<Asset>)`: Update an asset
- `getImages()`: Get all image assets
- `getVideos()`: Get all video assets
- `getAudio()`: Get all audio assets
- `getDocuments()`: Get all document assets
- `getCDNAssets()`: Get assets from CDN
- `getAll()`: Get all assets
- `count()`: Get asset count

## Utility Functions

SuperTab includes helpful utility functions:

- `deepClone<T>(obj: T)`: Deep clone an object
- `generateId(prefix?: string)`: Generate a unique ID
- `cssObjectToString(css: CSSProperties)`: Convert CSS object to string
- `cssStringToObject(cssString: string)`: Convert CSS string to object
- `flattenComponents(components: Component[])`: Flatten component tree
- `extractComponentIds(components: Component[])`: Extract all component IDs
- `isValidURL(url: string)`: Validate a URL
- `formatFileSize(bytes: number)`: Format file size

## Examples

Check out the `examples/basic-usage.ts` file for comprehensive examples:

```bash
bun run examples/basic-usage.ts
```

### Example: Finding and Updating Components

```typescript
import { Page } from 'supertab';

const page = new Page(jsonData);

// Find all div elements
const divs = page.components.findByTagName('div');

// Find component by ID
const navbar = page.components.findById('navbar');

// Update component
page.components.updateComponent('navbar', {
  attributes: { class: 'navbar-new' }
});
```

### Example: Managing Styles

```typescript
// Find styles for mobile
const mobileStyles = page.styles.findByMedia('(max-width: 480px)');

// Update style
page.styles.updateStyle('#header', {
  'background-color': '#333',
  'padding': '1rem'
});

// Add new style with media query
page.styles.addStyle({
  selectors: ['#hero'],
  style: {
    'font-size': '1rem'
  },
  mediaText: '(max-width: 768px)',
  atRuleType: 'media'
});
```

### Example: Working with Assets

```typescript
// Get all images
const images = page.assets.getImages();

// Add new image
page.assets.addAsset({
  type: 'image',
  src: 'https://example.com/image.jpg',
  width: 800,
  height: 600,
  unitDim: 'px',
  blinkCDN: false
});

// Update asset dimensions
page.assets.updateAsset('https://example.com/image.jpg', {
  width: 1200,
  height: 900
});
```

## Server API

SuperTab includes a built-in HTTP server with REST API endpoints:

### Starting the Server

```bash
bun run server
```

Server runs at http://localhost:5021

### Web Routes

- `GET /` - Main dashboard with statistics and quick actions
- `GET /editor` - Interactive content editor with live preview
- `GET /preview` - Rendered HTML page with applied styles

### API Endpoints

**Page Operations:**
- `GET /api/page` - Get page info
- `GET /api/page/title` - Get page title
- `PUT /api/page/title` - Update page title
- `GET /api/page/export` - Export full page as JSON
- `GET /api/stats` - Get page statistics

**Component Operations:**
- `GET /api/components` - List all components (supports `?type=` and `?tagName=` filters)
- `GET /api/components/:id` - Get component by ID
- `PUT /api/components/:id` - Update component
- `POST /api/components` - Add new component
- `DELETE /api/components/:id` - Delete component

**Style Operations:**
- `GET /api/styles` - List all styles (supports `?selector=` and `?media=` filters)
- `PUT /api/styles/:selector` - Update style properties
- `GET /api/styles/css` - Get compiled CSS

**Asset Operations:**
- `GET /api/assets` - List all assets (supports `?type=` filter)
- `POST /api/assets` - Add new asset
- `DELETE /api/assets` - Delete asset by source

**Utility:**
- `POST /api/reload` - Reload sample page

### Example API Requests

```bash
# Get page statistics
curl http://localhost:5021/api/stats

# Update page title
curl -X PUT http://localhost:5021/api/page/title \
  -H "Content-Type: application/json" \
  -d '{"title":"My New Title"}'

# Find component by ID
curl http://localhost:5021/api/components/iydl

# Update component
curl -X PUT http://localhost:5021/api/components/iydl \
  -H "Content-Type: application/json" \
  -d '{"style":"background-color: blue;"}'

# Update style
curl -X PUT http://localhost:5021/api/styles/%23iydl \
  -H "Content-Type: application/json" \
  -d '{"properties":{"color":"red","font-size":"2rem"}}'

# Get all images
curl http://localhost:5021/api/assets?type=image
```

## Type Definitions

SuperTab is fully typed. Key interfaces include:

```typescript
interface PageData {
  title: string;
  item_id: number;
  body: PageBody;
}

interface Component {
  type: string;
  attributes?: Record<string, any>;
  components?: Component[];
  tagName?: string;
  style?: string;
  script?: string;
}

interface Style {
  selectors: (string | SelectorObject)[];
  selectorsAdd?: string;
  style: CSSProperties;
  mediaText?: string;
  atRuleType?: 'media' | 'keyframes' | 'supports';
  state?: 'hover' | 'active' | 'focus' | 'visited';
}

interface Asset {
  type: 'image' | 'video' | 'audio' | 'document';
  src: string;
  width: number;
  height: number;
  unitDim: 'px' | '%' | 'em' | 'rem';
  blinkCDN?: boolean;
}
```

## Project Structure

```
supertab/
├── src/
│   ├── core/
│   │   ├── Page.ts              # Main Page class
│   │   ├── ComponentManager.ts  # Component operations
│   │   ├── StyleManager.ts      # Style operations
│   │   └── AssetManager.ts      # Asset operations
│   ├── utils/
│   │   └── helpers.ts           # Utility functions
│   └── types.ts                 # Type definitions
├── examples/
│   ├── basic-usage.ts           # Usage examples
│   └── output/                  # Example outputs
├── samples/
│   └── page_template.json       # Sample page data
└── index.ts                     # Main exports
```

## Development

### Run Examples

```bash
bun run examples/basic-usage.ts
```

### Build

```bash
bun build index.ts --outdir=dist
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
