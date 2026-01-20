/**
 * A.CRE Website Crawler
 * Extracts underwriting insights, metrics, and best practices for different property sectors
 */

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://www.adventuresincre.com';

// Target pages to crawl for sector-specific content
const TARGET_PAGES = [
  // Main resource pages
  '/',
  '/models/',
  '/real-estate-financial-modeling/',
  '/accelerator/',

  // Sector-specific models
  '/all-in-one-rent-roll-analyzer/',
  '/multifamily-acquisition-model/',
  '/office-building-acquisition-model/',
  '/retail-acquisition-model/',
  '/industrial-acquisition-model/',
  '/hotel-development-model/',
  '/self-storage-acquisition-model/',
  '/student-housing-acquisition-model/',
  '/seniors-housing-acquisition-model/',
  '/manufactured-housing-acquisition-model/',
  '/data-center-development-model/',
  '/life-sciences-real-estate-model/',
  '/mixed-use-development-model/',
  '/net-lease-acquisition-model/',
  '/land-development-model/',
  '/ground-lease-model/',

  // Underwriting articles
  '/category/underwriting/',
  '/underwriting-real-estate/',
  '/how-to-underwrite-real-estate/',
  '/irr-internal-rate-return/',
  '/equity-multiple/',
  '/cash-on-cash-return/',
  '/capitalization-rate/',
  '/debt-service-coverage-ratio/',
  '/loan-to-value/',
  '/waterfall-model/',
  '/equity-waterfall/',
  '/promote-structure/',
  '/sensitivity-analysis/',
  '/rent-roll-analysis/',
  '/t12-trailing-twelve-months/',

  // Blog/articles categories
  '/blog/',
  '/category/acquisition/',
  '/category/development/',
  '/category/debt/',
];

// Store extracted data
const extractedData = {
  sectors: {},
  metrics: {},
  bestPractices: [],
  articles: [],
  models: [],
  crawledAt: new Date().toISOString()
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crawlPage(browser, url) {
  const page = await browser.newPage();

  try {
    console.log(`Crawling: ${url}`);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const pageData = {
      url,
      title: $('title').text().trim(),
      h1: $('h1').first().text().trim(),
      content: extractMainContent($),
      metrics: extractMetrics($),
      lists: extractLists($),
      tables: extractTables($)
    };

    // Identify sector from URL
    const sectorMatch = identifySector(url);
    if (sectorMatch) {
      if (!extractedData.sectors[sectorMatch]) {
        extractedData.sectors[sectorMatch] = [];
      }
      extractedData.sectors[sectorMatch].push(pageData);
    }

    // Extract metrics definitions
    if (pageData.metrics.length > 0) {
      extractedData.metrics[url] = pageData.metrics;
    }

    // Store article info
    extractedData.articles.push({
      url,
      title: pageData.title,
      h1: pageData.h1
    });

    return pageData;

  } catch (error) {
    console.error(`Error crawling ${url}:`, error.message);
    return null;
  } finally {
    await page.close();
  }
}

function extractMainContent($) {
  // Try different content selectors
  const selectors = [
    '.entry-content',
    '.post-content',
    'article',
    '.content',
    'main'
  ];

  for (const selector of selectors) {
    const content = $(selector).text().trim();
    if (content.length > 200) {
      // Clean and truncate
      return content
        .replace(/\s+/g, ' ')
        .substring(0, 5000);
    }
  }

  return $('body').text().trim().substring(0, 2000);
}

function extractMetrics($) {
  const metrics = [];

  // Look for common metric patterns
  const metricPatterns = [
    /IRR/gi,
    /cap\s*rate/gi,
    /NOI/gi,
    /RevPAR/gi,
    /ADR/gi,
    /DSCR/gi,
    /LTV/gi,
    /equity\s*multiple/gi,
    /cash[\s-]*on[\s-]*cash/gi,
    /GOPPAR/gi,
    /PUE/gi,
    /per\s*key/gi,
    /per\s*bed/gi,
    /per\s*unit/gi,
    /per\s*SF/gi,
    /occupancy/gi,
    /vacancy/gi,
    /rent\s*growth/gi,
    /exit\s*cap/gi,
    /going[\s-]*in\s*cap/gi,
    /FFO/gi,
    /AFFO/gi,
    /spread/gi,
    /yield/gi
  ];

  const text = $('body').text();

  for (const pattern of metricPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        if (!metrics.includes(match.toLowerCase())) {
          metrics.push(match.toLowerCase());
        }
      });
    }
  }

  return metrics;
}

function extractLists($) {
  const lists = [];

  $('ul, ol').each((i, elem) => {
    const items = [];
    $(elem).find('li').each((j, li) => {
      const text = $(li).text().trim();
      if (text.length > 10 && text.length < 500) {
        items.push(text);
      }
    });

    if (items.length >= 3) {
      lists.push(items);
    }
  });

  return lists.slice(0, 10); // Limit to 10 lists
}

function extractTables($) {
  const tables = [];

  $('table').each((i, table) => {
    const rows = [];
    $(table).find('tr').each((j, tr) => {
      const cells = [];
      $(tr).find('td, th').each((k, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    if (rows.length > 0) {
      tables.push(rows);
    }
  });

  return tables.slice(0, 5); // Limit to 5 tables
}

function identifySector(url) {
  const sectorMap = {
    'multifamily': 'MULTIFAMILY',
    'apartment': 'MULTIFAMILY',
    'office': 'OFFICE',
    'retail': 'RETAIL',
    'industrial': 'INDUSTRIAL',
    'warehouse': 'INDUSTRIAL',
    'hotel': 'HOTEL',
    'hospitality': 'HOTEL',
    'self-storage': 'SELF_STORAGE',
    'storage': 'SELF_STORAGE',
    'student': 'STUDENT_HOUSING',
    'seniors': 'SENIORS_HOUSING',
    'senior': 'SENIORS_HOUSING',
    'manufactured': 'MANUFACTURED_HOUSING',
    'mobile': 'MANUFACTURED_HOUSING',
    'data-center': 'DATA_CENTER',
    'data_center': 'DATA_CENTER',
    'life-science': 'LIFE_SCIENCES',
    'lab': 'LIFE_SCIENCES',
    'mixed-use': 'MIXED_USE',
    'development': 'DEVELOPMENT',
    'net-lease': 'NET_LEASE',
    'ground-lease': 'GROUND_LEASE',
    'land': 'LAND'
  };

  const urlLower = url.toLowerCase();

  for (const [pattern, sector] of Object.entries(sectorMap)) {
    if (urlLower.includes(pattern)) {
      return sector;
    }
  }

  return null;
}

async function discoverMoreUrls(browser, baseUrl) {
  const page = await browser.newPage();
  const discoveredUrls = new Set();

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    const $ = cheerio.load(html);

    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith(BASE_URL)) {
        discoveredUrls.add(href);
      } else if (href && href.startsWith('/')) {
        discoveredUrls.add(BASE_URL + href);
      }
    });

  } catch (error) {
    console.error('Error discovering URLs:', error.message);
  } finally {
    await page.close();
  }

  return Array.from(discoveredUrls);
}

async function main() {
  console.log('Starting A.CRE crawler...');
  console.log('Installing browser...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // First, discover more URLs from the main pages
    console.log('\n=== Discovering URLs ===');
    const additionalUrls = await discoverMoreUrls(browser, BASE_URL);
    console.log(`Found ${additionalUrls.length} additional URLs`);

    // Filter to relevant URLs
    const relevantUrls = additionalUrls.filter(url => {
      const lower = url.toLowerCase();
      return lower.includes('model') ||
             lower.includes('underwriting') ||
             lower.includes('acquisition') ||
             lower.includes('development') ||
             lower.includes('analysis') ||
             lower.includes('irr') ||
             lower.includes('cap-rate') ||
             lower.includes('waterfall') ||
             lower.includes('rent-roll') ||
             identifySector(url) !== null;
    });

    // Combine with target pages
    const allUrls = [...new Set([
      ...TARGET_PAGES.map(p => BASE_URL + p),
      ...relevantUrls.slice(0, 50) // Limit additional URLs
    ])];

    console.log(`\n=== Crawling ${allUrls.length} pages ===`);

    // Crawl each page with delay to be respectful
    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      console.log(`\n[${i + 1}/${allUrls.length}] ${url}`);

      const pageData = await crawlPage(browser, url);

      if (pageData) {
        // Extract best practices from content
        const practices = extractBestPractices(pageData.content);
        if (practices.length > 0) {
          extractedData.bestPractices.push(...practices);
        }
      }

      // Rate limiting - be nice to their server
      await delay(2000);
    }

    // Save results
    const outputPath = path.join(process.cwd(), 'scripts', 'acre-crawl-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(extractedData, null, 2));
    console.log(`\n=== Results saved to ${outputPath} ===`);

    // Print summary
    printSummary();

  } finally {
    await browser.close();
  }
}

function extractBestPractices(content) {
  const practices = [];

  // Look for sentences with best practice indicators
  const indicators = [
    'best practice',
    'typically',
    'standard',
    'rule of thumb',
    'industry',
    'commonly',
    'usually',
    'should',
    'recommend',
    'important to',
    'key metric',
    'critical'
  ];

  const sentences = content.split(/[.!?]+/);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    for (const indicator of indicators) {
      if (lower.includes(indicator) && sentence.length > 30 && sentence.length < 500) {
        practices.push(sentence.trim());
        break;
      }
    }
  }

  return practices.slice(0, 10);
}

function printSummary() {
  console.log('\n========================================');
  console.log('CRAWL SUMMARY');
  console.log('========================================\n');

  console.log(`Total articles crawled: ${extractedData.articles.length}`);
  console.log(`Sectors identified: ${Object.keys(extractedData.sectors).length}`);
  console.log(`Best practices found: ${extractedData.bestPractices.length}`);

  console.log('\n--- Sectors with content ---');
  for (const [sector, pages] of Object.entries(extractedData.sectors)) {
    console.log(`  ${sector}: ${pages.length} pages`);
  }

  console.log('\n--- All metrics found ---');
  const allMetrics = new Set();
  for (const metrics of Object.values(extractedData.metrics)) {
    metrics.forEach(m => allMetrics.add(m));
  }
  console.log(`  ${Array.from(allMetrics).join(', ')}`);
}

main().catch(console.error);
