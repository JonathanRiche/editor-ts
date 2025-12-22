/**
 * Example: Using runtime toolbar configurations (NOT stored in JSON)
 */

import { Page, defaultToolbarConfig, toolbarPresets, createToolbarConfig } from '../index';
import { readFileSync, writeFileSync } from 'fs';

async function toolbarExamples() {
  console.log('🛠️  Runtime Toolbar Configuration Examples\n');
  console.log('NOTE: Toolbar configs are NOT saved to JSON - they are runtime only!\n');

  // Load page (clean JSON, no toolbar data)
  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Example 1: Configure toolbar by component ID
  console.log('1️⃣  Configuring toolbar for component "iydl" by ID...');
  page.toolbars.configureById('iydl', defaultToolbarConfig);
  console.log('   ✓ Toolbar set with all actions: Edit, Edit JS, Duplicate, Delete\n');

  // Example 2: Configure toolbar by component type (applies to all matching components)
  console.log('2️⃣  Configuring toolbar for all "box" type components...');
  page.toolbars.configureByType('box', toolbarPresets.editOnly);
  console.log('   ✓ All box components now have: Edit, Edit JS, Duplicate (no Delete)\n');

  // Example 3: Configure toolbar by tag name
  console.log('3️⃣  Configuring toolbar for all "div" elements...');
  page.toolbars.configureByTag('div', toolbarPresets.minimal);
  console.log('   ✓ All div elements now have: Edit, Delete only\n');

  // Example 4: Disable toolbar for specific component
  console.log('4️⃣  Disabling toolbar for component "step2"...');
  page.toolbars.configureById('step2', {
    enabled: false,
    actions: [],
  });
  console.log('   ✓ Toolbar disabled - component is not editable\n');

  // Example 5: Create custom toolbar
  console.log('5️⃣  Creating custom toolbar for "custom-code" components...');
  const customToolbar = createToolbarConfig([
    {
      id: 'edit',
      label: 'Edit',
      icon: '✏️',
      enabled: true,
      description: 'Edit this code block',
    },
    {
      id: 'editJS',
      label: 'Edit Code',
      icon: '📜',
      enabled: true,
      description: 'Edit with Monaco editor',
    },
    {
      id: 'duplicate',
      label: 'Clone',
      icon: '📋',
      enabled: true,
      description: 'Clone this code block',
    },
  ]);
  page.toolbars.configureByType('custom-code', customToolbar);
  console.log('   ✓ Custom toolbar set for custom-code components\n');

  // Example 6: Configure with custom matcher function
  console.log('6️⃣  Configuring toolbar for components with specific class...');
  page.toolbars.configureCustom(
    (component) => component.attributes?.class?.includes('important'),
    {
      enabled: true,
      actions: [
        { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
        { id: 'delete', label: 'Delete', icon: '🗑️', enabled: false, danger: true }, // Can't delete important components
      ],
    }
  );
  console.log('   ✓ Components with "important" class cannot be deleted\n');

  // Example 7: Get toolbar for a specific component
  console.log('7️⃣  Getting toolbar config for component "iydl"...');
  const components = page.components.getAll();
  const toolbar = page.toolbars.getToolbarById(components, 'iydl');
  if (toolbar) {
    console.log('   ✓ Toolbar enabled:', toolbar.enabled);
    console.log('   ✓ Total actions:', toolbar.actions.length);
    const enabledActions = toolbar.actions.filter(a => a.enabled);
    console.log('   ✓ Enabled actions:', enabledActions.map(a => a.label).join(', '));
  }
  console.log();

  // Example 8: Export toolbar configuration (for sharing runtime config)
  console.log('8️⃣  Exporting toolbar configuration...');
  const toolbarConfig = page.toolbars.exportConfig();
  writeFileSync('./examples/output/toolbar-config.json', toolbarConfig);
  console.log('   ✓ Toolbar config saved (runtime config, not page data)\n');

  // Example 9: Save page - notice NO toolbar data in JSON
  console.log('9️⃣  Saving page JSON (notice: NO toolbar data)...');
  const output = page.toJSON();
  writeFileSync('./examples/output/clean-page.json', output);
  
  // Verify no toolbar in JSON
  const hasToolbar = output.includes('"toolbar"');
  console.log('   ✓ Page saved to ./examples/output/clean-page.json');
  console.log('   ✓ Contains toolbar property:', hasToolbar ? 'YES ❌' : 'NO ✅');
  console.log('   ✓ JSON is clean and portable!\n');

  console.log('✅ All toolbar examples completed!\n');
  console.log('📖 Runtime toolbar configurations:');
  console.log('   - iydl: Full toolbar (configured by ID)');
  console.log('   - All "box" types: Edit-only toolbar');
  console.log('   - All "div" tags: Minimal toolbar');
  console.log('   - step2: Toolbar disabled');
  console.log('   - custom-code types: Custom toolbar with Edit Code');
  console.log('   - Components with "important" class: Cannot delete\n');
  console.log('💡 Toolbar configs are runtime only - NOT saved to database!');
}

if (import.meta.main) {
  toolbarExamples();
}
