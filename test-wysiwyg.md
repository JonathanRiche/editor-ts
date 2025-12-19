# WYSIWYG Editor Testing Guide

## How It Works Now

When you **click on an element** in the preview pane:

1. ✅ **Element gets highlighted** with green outline
2. ✅ **Component ID auto-fills** in the sidebar
3. ✅ **Component data auto-fetches** from the API
4. ✅ **Fields populate automatically** (type, style, etc.)
5. ✅ **Notification appears** at the top
6. ✅ **Section scrolls into view** and highlights green
7. ✅ **You can now edit** the fields and click "Update Component"

## Testing Steps

1. **Open the editor:**
   ```
   http://localhost:5021/editor
   ```

2. **Click any element in the preview pane** (right side)
   - Elements with IDs have blue dashed outlines
   - Hover to see the ID label

3. **Watch the magic happen:**
   - Sidebar auto-fills with component ID
   - Component details load automatically
   - Green notification appears
   - Component section highlights

4. **Edit the component:**
   - Modify the "Component Type" field
   - Update the "Inline Style" textarea
   - Click "Update Component" button

5. **Apply changes:**
   - Click "✓ Apply Changes" in header
   - Preview refreshes with your edits

## Example Workflow

**Click on element with ID "iydl":**
- ID field: `iydl` ← auto-filled
- Type field: `box` ← auto-loaded
- Style field: existing styles ← auto-loaded

**Make changes:**
- Type: `box` → `section`
- Style: add `background: red;`

**Click "Update Component"** → Changes saved!
**Click "Apply Changes"** → Preview updates!

## Key Features

- **Click-to-Edit**: No typing IDs manually
- **Auto-Fetch**: Component data loads automatically  
- **Visual Feedback**: Green highlights, notifications
- **Real-time**: Changes apply instantly
- **Non-destructive**: Reset button restores original

## Troubleshooting

If clicking doesn't work:
1. Check console for errors (F12)
2. Ensure iframe loaded: `/preview?edit=true`
3. Verify element has an ID attribute
4. Try clicking "Edit in Sidebar" button on preview toolbar
