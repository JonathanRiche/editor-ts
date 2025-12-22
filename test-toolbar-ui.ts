/**
 * Playwright test to visually inspect the toolbar
 */

import { chromium } from 'playwright';

async function testToolbarUI() {
  console.log('🎭 Starting Playwright test for toolbar UI...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // Navigate to editor
    console.log('📍 Navigating to http://localhost:5021/editor');
    await page.goto('http://localhost:5021/editor');
    await page.waitForTimeout(2000);

    console.log('✓ Page loaded\n');

    // Get iframe
    const iframe = page.frameLocator('#previewFrame');
    
    // Wait for elements to be ready
    console.log('⏳ Waiting for preview to load...');
    await page.waitForTimeout(3000);

    // Find an element with ID to click
    console.log('🔍 Looking for clickable elements in preview...');
    
    // Try different elements until we find a visible one
    const testIds = ['ir8u', 'ifgaj', 'i8rd', 'iydl', 'step1', 'step2', 'step3'];
    let element = null;
    let clickedId = '';
    
    for (const id of testIds) {
      const el = iframe.locator('#' + id).first();
      const isVisible = await el.isVisible().catch(() => false);
      if (isVisible) {
        element = el;
        clickedId = id;
        console.log('✓ Found visible element #' + id + '\n');
        break;
      }
    }
    
    if (element) {
      console.log('👆 Clicking element #' + clickedId + '...');
      await element.click();
      await page.waitForTimeout(1000);
      
      // Check if toolbar appeared
      const toolbar = iframe.locator('#supertab-context-toolbar');
      const toolbarVisible = await toolbar.isVisible();
      console.log('   Toolbar visible:', toolbarVisible ? '✅ YES' : '❌ NO');
      
      if (toolbarVisible) {
        const toolbarHTML = await toolbar.innerHTML();
        console.log('   Toolbar HTML:', toolbarHTML.substring(0, 200));
        
        // Check for toolbar actions
        const actions = await toolbar.locator('.toolbar-action').count();
        console.log('   Toolbar actions found:', actions);
        
        // Get action labels
        const actionLabels = await toolbar.locator('.toolbar-action span:not(.icon)').allTextContents();
        console.log('   Actions:', actionLabels.join(', '));
      } else {
        console.log('\n⚠️  Toolbar is NOT visible. Debugging...');
        
        // Check if toolbar element exists
        const toolbarExists = await toolbar.count();
        console.log('   Toolbar element exists:', toolbarExists > 0 ? 'YES' : 'NO');
        
        // Check toolbar classes
        const classes = await toolbar.getAttribute('class');
        console.log('   Toolbar classes:', classes);
        
        // Check if it has 'active' class
        const hasActive = classes?.includes('active');
        console.log('   Has "active" class:', hasActive ? 'YES' : 'NO');
        
        // Get computed display style
        const display = await toolbar.evaluate((el: any) => {
          const win = el.ownerDocument.defaultView;
          return win ? win.getComputedStyle(el).display : 'unknown';
        });
        console.log('   Computed display:', display);
        
        // Get toolbar HTML content
        const html = await toolbar.innerHTML();
        console.log('   Toolbar HTML:', html || '(empty)');
      }
      
      // Check console for errors
      console.log('\n📝 Checking browser console...');
      page.on('console', msg => console.log('   Browser:', msg.text()));
      
      await page.waitForTimeout(2000);
      
    } else {
      console.log('❌ Element #iydl not visible in preview');
      
      // List all elements with IDs
      const allIds = await iframe.locator('[id]').evaluateAll((elements) => 
        elements.slice(0, 10).map(el => el.id)
      );
      console.log('Available element IDs:', allIds.join(', '));
    }

    console.log('\n⏸️  Keeping browser open for 30 seconds for manual inspection...');
    console.log('   You can interact with the page now!');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
    console.log('\n✓ Test completed');
    process.exit(0);
  }
}

if (import.meta.main) {
  testToolbarUI();
}
