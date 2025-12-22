/**
 * Test script for EditorTs API server
 * This demonstrates how to interact with the REST API
 */

const BASE_URL = 'http://localhost:5021';

async function testAPI() {
  console.log('🧪 Testing EditorTs API\n');
  console.log('Make sure the server is running: bun run server\n');

  try {
    // Test 1: Get page stats
    console.log('1️⃣ Getting page statistics...');
    const statsRes = await fetch(`${BASE_URL}/api/stats`);
    const stats = await statsRes.json();
    console.log('   ✓ Stats:', stats);
    console.log();

    // Test 2: Get page title
    console.log('2️⃣ Getting page title...');
    const titleRes = await fetch(`${BASE_URL}/api/page/title`);
    const titleData = await titleRes.json() as { title: string };
    console.log('   ✓ Current title:', titleData.title);
    console.log();

    // Test 3: Update page title
    console.log('3️⃣ Updating page title...');
    const newTitle = `Test Title - ${new Date().toLocaleTimeString()}`;
    const updateRes = await fetch(`${BASE_URL}/api/page/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    const updateData = await updateRes.json() as { title: string };
    console.log('   ✓ Updated title:', updateData.title);
    console.log();

    // Test 4: Search for a component
    console.log('4️⃣ Searching for component by ID (iydl)...');
    const compRes = await fetch(`${BASE_URL}/api/components/iydl`);
    const component = await compRes.json() as any;
    console.log('   ✓ Found component type:', component.type);
    console.log('   ✓ Component attributes:', component.attributes);
    console.log();

    // Test 5: Update component style
    console.log('5️⃣ Updating component style...');
    const updateCompRes = await fetch(`${BASE_URL}/api/components/iydl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style: 'background-color: #ff0000; padding: 2rem;',
      }),
    });
    const updateCompData = await updateCompRes.json() as { success: boolean };
    console.log('   ✓ Component updated:', updateCompData.success);
    console.log();

    // Test 6: Update CSS style
    console.log('6️⃣ Updating CSS style for #iydl...');
    const updateStyleRes = await fetch(
      `${BASE_URL}/api/styles/${encodeURIComponent('#iydl')}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: {
            'background-color': '#2563eb',
            'color': '#ffffff',
            'font-size': '1.2rem',
          },
        }),
      }
    );
    const updateStyleData = await updateStyleRes.json() as { success: boolean };
    console.log('   ✓ Style updated:', updateStyleData.success);
    console.log();

    // Test 7: Get assets
    console.log('7️⃣ Getting all assets...');
    const assetsRes = await fetch(`${BASE_URL}/api/assets`);
    const assetsData = await assetsRes.json() as any;
    console.log('   ✓ Total assets:', assetsData.count);
    console.log('   ✓ Images:', assetsData.images);
    console.log('   ✓ Videos:', assetsData.videos);
    console.log();

    // Test 8: Get image assets only
    console.log('8️⃣ Getting image assets only...');
    const imagesRes = await fetch(`${BASE_URL}/api/assets?type=image`);
    const images = await imagesRes.json() as any[];
    console.log('   ✓ Found', images.length, 'images');
    if (images.length > 0) {
      console.log('   ✓ First image:', images[0].src.substring(0, 60) + '...');
    }
    console.log();

    // Test 9: Get components by type
    console.log('9️⃣ Getting custom-code components...');
    const customCodeRes = await fetch(`${BASE_URL}/api/components?type=custom-code`);
    const customCode = await customCodeRes.json() as any[];
    console.log('   ✓ Found', customCode.length, 'custom-code components');
    console.log();

    // Test 10: Get page info
    console.log('🔟 Getting final page info...');
    const pageRes = await fetch(`${BASE_URL}/api/page`);
    const pageData = await pageRes.json();
    console.log('   ✓ Final stats:', pageData);
    console.log();

    console.log('✅ All API tests completed successfully!\n');
    console.log('💡 Try the web UI at http://localhost:5021');

  } catch (error) {
    console.error('\n❌ Error testing API:', error);
    console.log('\n💡 Make sure the server is running: bun run server');
    process.exit(1);
  }
}

// Run tests
if (import.meta.main) {
  testAPI();
}
