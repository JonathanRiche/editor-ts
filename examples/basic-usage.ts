/**
 * Basic usage examples for SuperTab library
 */

import { Page } from '../index';
import { readFileSync, writeFileSync } from 'fs';

// Example 1: Load and inspect a page
function example1() {
  console.log('=== Example 1: Load and inspect a page ===\n');

  // Load page from JSON file
  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Get basic page info
  console.log('Page Title:', page.getTitle());
  console.log('Page ID:', page.getItemId());
  console.log('Total Components:', page.components.count());
  console.log('Total Styles:', page.styles.count());
  console.log('Total Assets:', page.assets.count());
  console.log();
}

// Example 2: Find and update components
function example2() {
  console.log('=== Example 2: Find and update components ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Find component by ID
  const header = page.components.findById('iydl');
  if (header) {
    console.log('Found component:', header.attributes?.id);
  }

  // Find all custom-code components
  const customCode = page.components.findByType('custom-code');
  console.log('Custom code components:', customCode.length);

  // Update a component
  page.components.updateComponent('iydl', {
    style: 'background-color: blue; padding: 20px;'
  });
  console.log('Component updated');
  console.log();
}

// Example 3: Manage styles
function example3() {
  console.log('=== Example 3: Manage styles ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Find styles by selector
  const headerStyles = page.styles.findBySelector('#iydl');
  console.log('Header styles found:', headerStyles.length);

  // Update style properties
  page.styles.updateStyle('#iydl', {
    'background-color': '#ffffff',
    'padding': '2rem',
    'box-shadow': '0 2px 4px rgba(0,0,0,0.1)'
  });

  // Add new style
  page.styles.addStyle({
    selectors: ['#new-element'],
    style: {
      'color': 'red',
      'font-size': '1.5rem'
    }
  });

  console.log('Styles updated');
  console.log();
}

// Example 4: Manage assets
function example4() {
  console.log('=== Example 4: Manage assets ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Get all images
  const images = page.assets.getImages();
  console.log('Total images:', images.length);

  // Get CDN assets
  const cdnAssets = page.assets.getCDNAssets();
  console.log('CDN assets:', cdnAssets.length);

  // Add new asset
  page.assets.addAsset({
    type: 'image',
    src: 'https://example.com/new-image.jpg',
    unitDim: 'px',
    height: 500,
    width: 800,
    blinkCDN: false
  });

  console.log('New asset added');
  console.log('Total assets now:', page.assets.count());
  console.log();
}

// Example 5: Export modified page
function example5() {
  console.log('=== Example 5: Export modified page ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Make some changes
  page.setTitle('Modified Page Title');
  page.styles.updateStyle('#iydl', { 'display': 'flex' });
  page.components.updateComponent('iydl', { type: 'header' });

  // Export to JSON
  const modifiedJSON = page.toJSON();
  
  // Save to file
  writeFileSync('./examples/output/modified-page.json', modifiedJSON);
  console.log('Modified page saved to ./examples/output/modified-page.json');
  console.log();
}

// Example 6: Clone and modify
function example6() {
  console.log('=== Example 6: Clone and modify ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Clone the page
  const clonedPage = page.clone();

  // Modify clone
  clonedPage.setTitle('Cloned Page');
  clonedPage.setItemId(9999);

  console.log('Original title:', page.getTitle());
  console.log('Cloned title:', clonedPage.getTitle());
  console.log('Original ID:', page.getItemId());
  console.log('Cloned ID:', clonedPage.getItemId());
  console.log();
}

// Example 7: Search and filter
function example7() {
  console.log('=== Example 7: Search and filter ===\n');

  const jsonData = readFileSync('./samples/page_template.json', 'utf-8');
  const page = new Page(jsonData);

  // Find all div elements
  const divs = page.components.findByTagName('div');
  console.log('Total divs:', divs.length);

  // Find all link elements
  const links = page.components.findByTagName('link');
  console.log('Total links:', links.length);

  // Find media query styles
  const mobileStyles = page.styles.findByMedia('(max-width: 480px)');
  console.log('Mobile styles:', mobileStyles.length);

  console.log();
}

// Run all examples
async function runExamples() {
  try {
    example1();
    example2();
    example3();
    example4();
    example5();
    example6();
    example7();

    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run if executed directly
if (import.meta.main) {
  runExamples();
}
