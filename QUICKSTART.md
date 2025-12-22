# Quick Start Guide

Get started with EditorTs in 5 minutes!

## Installation

```bash
bun install
```

## Option 1: Interactive Web Server (Recommended)

The easiest way to explore EditorTs:

```bash
bun run dev
# or
bun run server
```

Then open http://localhost:5021 in your browser!

You'll get:
- 📊 Live page statistics
- ✏️ Interactive title editor
- 🔍 Component search
- 🎨 Style updater
- 🖼️ Asset viewer
- 💾 JSON export

## Option 2: Programmatic Usage

## Your First Program

Create a new file `my-first-edit.ts`:

```typescript
import { Page } from './index';
import { readFileSync, writeFileSync } from 'fs';

// Load a page from JSON
const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
const page = new Page(jsonData);

// Get page info
console.log('Title:', page.getTitle());
console.log('Components:', page.components.count());
console.log('Styles:', page.styles.count());

// Make changes
page.setTitle('My Edited Page');
page.styles.updateStyle('#iydl', {
  'background-color': '#ff0000',
  'padding': '2rem'
});

// Save changes
const output = page.toJSON();
writeFileSync('./my-edited-page.json', output);
console.log('Saved to my-edited-page.json');
```

Run it:

```bash
bun run my-first-edit.ts
```

## Common Tasks

### Find a Component by ID

```typescript
const component = page.components.findById('header');
if (component) {
  console.log('Found:', component);
}
```

### Update Component Attributes

```typescript
page.components.updateComponent('navbar', {
  attributes: { class: 'navbar-dark' }
});
```

### Add a New Style

```typescript
page.styles.addStyle({
  selectors: ['#my-element'],
  style: {
    'color': 'blue',
    'font-size': '1.5rem'
  }
});
```

### Get All Images

```typescript
const images = page.assets.getImages();
images.forEach(img => {
  console.log('Image:', img.src);
});
```

### Clone and Modify

```typescript
const clone = page.clone();
clone.setTitle('Cloned Page');
clone.setItemId(9999);
```

## Next Steps

- Check out `examples/basic-usage.ts` for more examples
- Read the full [README.md](./README.md) for complete API documentation
- Explore the type definitions in `src/types.ts`

## Need Help?

- Review the examples in the `examples/` directory
- Check the API reference in README.md
- Look at the type definitions for available options
