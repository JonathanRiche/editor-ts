# EditorTs Architecture Principles

## Core Principle: Runtime vs. Stored Data

This document defines the architectural boundaries between what gets stored in JSON (database) and what stays in JavaScript (runtime).

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

---

## ❌ What Stays in JavaScript (Runtime)

**Application logic and configuration - the "how" of your editor:**

### Editor Behaviors
- Toolbar configurations (which actions appear)
- Which components are editable
- Which actions are enabled/disabled
- Custom toolbar actions

### UI Interactions
- Click handlers
- Drag-and-drop rules
- Hover behaviors
- Selection logic

### Rendering Rules
- How to display components in editor
- Visual indicators (outlines, highlights)
- Preview modes
- Editor layouts

### Validation & Permissions
- Validation rules
- Permission checks
- Edit restrictions
- User role requirements

### Custom Handlers
- Custom toolbar actions
- Event listeners
- API integrations
- Business logic

### Example Runtime Configuration:
```typescript
const page = new Page(jsonData);

// Configure toolbar at runtime - NOT saved to JSON
page.toolbars.configureById('header', {
  enabled: true,
  actions: [
    { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
    { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true }
  ]
});

// Configure by type
page.toolbars.configureByType('custom-code', {
  enabled: true,
  actions: [
    { id: 'edit', enabled: true },
    { id: 'editJS', enabled: true },
    { id: 'delete', enabled: false }  // Can't delete custom code
  ]
});

// JSON export is still clean - no toolbar config
const cleanJSON = page.toJSON();
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
- Example: Which buttons appear in the toolbar

---

## 📐 Architecture Layers

```
┌─────────────────────────────────────────┐
│   Application Layer (JavaScript)        │
│   - Toolbar configs                     │
│   - Editor behaviors                    │
│   - UI interactions                     │
│   - Permissions                         │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│   EditorTs Library                      │
│   - Page, ComponentManager              │
│   - ToolbarManager (runtime)            │
│   - StyleManager, AssetManager          │
└─────────────────────────────────────────┘
              ↓ reads/writes
┌─────────────────────────────────────────┐
│   Clean JSON Data (Database)            │
│   - Components (type, attrs, structure) │
│   - Styles (CSS, selectors)             │
│   - Assets (URLs, metadata)             │
│   - NO behavioral config                │
└─────────────────────────────────────────┘
```

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

---

## 🚫 Anti-Patterns to Avoid

**Don't do this:**
```typescript
// ❌ Adding editor config to component data
component.editorConfig = { draggable: true, locked: false };
component.toolbar = { actions: [...] };
component.permissions = { canEdit: true };
```

**Do this instead:**
```typescript
// ✅ Configure at runtime, separate from data
page.toolbars.configureById('header', toolbarConfig);
editorPermissions.setEditable('header', true);
dragDropManager.setDraggable('header', true);
```

---

## 📝 Summary

**JSON = Data (the content)**
**JavaScript = Behavior (how to edit it)**

Keep them separate. The JSON should be dumb data that any application can consume. The JavaScript runtime decides how to interact with that data.

---

**This principle applies to ALL future features in EditorTs.**
