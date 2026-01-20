/**
 * PDF Renderer Service
 *
 * Converts HTML documents to PDF using Puppeteer.
 *
 * Features:
 * - HTML to PDF conversion
 * - Watermark injection
 * - Header/footer with version info and checksums
 * - Page numbering
 * - Print-optimized styling
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { promises as fs } from 'fs';

class PDFRenderer {
  constructor() {
    this.browser = null;
  }

  /**
   * Initialize browser instance
   */
  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Get base CSS for documents
   */
  getBaseCSS() {
    return `
      @page {
        margin: 1in;
        size: letter;
      }

      * {
        box-sizing: border-box;
      }

      body {
        font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.5;
        color: #171717;
        margin: 0;
        padding: 0;
      }

      h1, h2, h3, h4, h5, h6 {
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        line-height: 1.2;
        page-break-after: avoid;
      }

      h1 { font-size: 24pt; }
      h2 { font-size: 18pt; }
      h3 { font-size: 14pt; }
      h4 { font-size: 12pt; }

      p {
        margin: 0 0 1em;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        page-break-inside: avoid;
      }

      th, td {
        border: 1px solid #E5E5E5;
        padding: 8px 12px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background-color: #F5F5F5;
        font-weight: 600;
      }

      tr:nth-child(even) {
        background-color: #FAFAFA;
      }

      .page-break {
        page-break-before: always;
      }

      .no-break {
        page-break-inside: avoid;
      }

      /* Watermark styles */
      .watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 72pt;
        font-weight: bold;
        color: rgba(200, 200, 200, 0.3);
        white-space: nowrap;
        z-index: 1000;
        pointer-events: none;
      }

      /* Provenance field highlighting */
      .prov-field {
        position: relative;
        cursor: help;
      }

      .prov-field[data-source]:not([data-source=""]):hover::after {
        content: attr(data-source);
        position: absolute;
        bottom: 100%;
        left: 0;
        background: #171717;
        color: white;
        padding: 2px 6px;
        font-size: 9pt;
        border-radius: 3px;
        white-space: nowrap;
        z-index: 100;
      }

      /* Section styles */
      .section {
        margin-bottom: 2em;
      }

      .section-header {
        background-color: #0A0A0A;
        color: white;
        padding: 8px 16px;
        font-weight: 600;
        margin-bottom: 1em;
      }

      /* Metric cards */
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin: 1em 0;
      }

      .metric-card {
        border: 1px solid #E5E5E5;
        padding: 12px;
        text-align: center;
      }

      .metric-label {
        font-size: 9pt;
        color: #737373;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .metric-value {
        font-size: 18pt;
        font-weight: 600;
        margin-top: 4px;
      }

      /* Signature blocks */
      .signature-block {
        margin-top: 3em;
        page-break-inside: avoid;
      }

      .signature-line {
        border-top: 1px solid #171717;
        width: 300px;
        margin-top: 40px;
        padding-top: 4px;
      }

      .signature-name {
        font-weight: 600;
      }

      .signature-title {
        font-size: 10pt;
        color: #737373;
      }

      /* Status badges */
      .badge {
        display: inline-block;
        padding: 2px 8px;
        font-size: 9pt;
        font-weight: 600;
        border-radius: 3px;
        text-transform: uppercase;
      }

      .badge-draft {
        background-color: #FEF3C7;
        color: #92400E;
      }

      .badge-binding {
        background-color: #DBEAFE;
        color: #1E40AF;
      }

      .badge-executed {
        background-color: #D1FAE5;
        color: #065F46;
      }

      /* Footnotes */
      .footnotes {
        margin-top: 2em;
        padding-top: 1em;
        border-top: 1px solid #E5E5E5;
        font-size: 9pt;
        color: #737373;
      }

      /* Lists */
      ul, ol {
        margin: 0 0 1em;
        padding-left: 1.5em;
      }

      li {
        margin-bottom: 0.5em;
      }

      /* Cover page */
      .cover-page {
        text-align: center;
        padding-top: 3in;
      }

      .cover-title {
        font-size: 36pt;
        font-weight: 700;
        margin-bottom: 0.5em;
      }

      .cover-subtitle {
        font-size: 18pt;
        color: #737373;
        margin-bottom: 2em;
      }

      .cover-date {
        font-size: 12pt;
        color: #A3A3A3;
      }

      .cover-confidential {
        margin-top: 3in;
        font-size: 10pt;
        color: #DC2626;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
    `;
  }

  /**
   * Inject watermark HTML
   */
  injectWatermark(html, watermarkText) {
    if (!watermarkText) return html;

    const watermarkHtml = `<div class="watermark">${watermarkText}</div>`;

    // Insert watermark after opening body tag
    return html.replace(/<body([^>]*)>/i, `<body$1>${watermarkHtml}`);
  }

  /**
   * Build header template
   */
  buildHeaderTemplate(options = {}) {
    const { documentTitle, status, version } = options;

    return `
      <div style="
        width: 100%;
        font-size: 9pt;
        color: #A3A3A3;
        display: flex;
        justify-content: space-between;
        padding: 0 0.5in;
        border-bottom: 1px solid #E5E5E5;
        margin-bottom: 0.25in;
      ">
        <span>${documentTitle || ''}</span>
        <span>
          ${status ? `<span style="
            background: ${status === 'DRAFT' ? '#FEF3C7' : status === 'BINDING' ? '#DBEAFE' : '#D1FAE5'};
            color: ${status === 'DRAFT' ? '#92400E' : status === 'BINDING' ? '#1E40AF' : '#065F46'};
            padding: 1px 6px;
            border-radius: 2px;
            font-size: 8pt;
            font-weight: 600;
          ">${status}</span>` : ''}
          ${version ? `v${version}` : ''}
        </span>
      </div>
    `;
  }

  /**
   * Build footer template
   */
  buildFooterTemplate(options = {}) {
    const { contentHash, generatedAt } = options;

    const timestamp = generatedAt ? new Date(generatedAt).toLocaleString() : new Date().toLocaleString();
    const hashDisplay = contentHash ? contentHash.substring(0, 12) : '';

    return `
      <div style="
        width: 100%;
        font-size: 8pt;
        color: #A3A3A3;
        display: flex;
        justify-content: space-between;
        padding: 0 0.5in;
        border-top: 1px solid #E5E5E5;
        padding-top: 0.25in;
      ">
        <span>Generated: ${timestamp}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        <span style="font-family: monospace;">${hashDisplay}</span>
      </div>
    `;
  }

  /**
   * Render HTML to PDF
   */
  async renderToPDF(html, options = {}) {
    const {
      watermark,
      documentTitle,
      status,
      version,
      contentHash,
      generatedAt,
      format = 'letter',
      landscape = false,
      printBackground = true
    } = options;

    await this.init();

    const page = await this.browser.newPage();

    try {
      // Inject base CSS
      const baseCSS = this.getBaseCSS();
      const styledHtml = html.replace(
        '</head>',
        `<style>${baseCSS}</style></head>`
      );

      // Inject watermark
      const watermarkedHtml = this.injectWatermark(styledHtml, watermark);

      // Set content
      await page.setContent(watermarkedHtml, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format,
        landscape,
        printBackground,
        displayHeaderFooter: true,
        headerTemplate: this.buildHeaderTemplate({ documentTitle, status, version }),
        footerTemplate: this.buildFooterTemplate({ contentHash, generatedAt }),
        margin: {
          top: '1in',
          bottom: '1in',
          left: '0.75in',
          right: '0.75in'
        },
        preferCSSPageSize: true
      });

      // Get page count
      const pageCount = await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '@page { size: letter; margin: 1in; }';
        document.head.appendChild(style);
        return Math.ceil(document.body.scrollHeight / 792); // 792 = letter height in pixels at 72dpi
      });

      return {
        buffer: pdfBuffer,
        pageCount,
        sizeBytes: pdfBuffer.length
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Save PDF to file
   */
  async savePDF(pdfBuffer, outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, pdfBuffer);
    return outputPath;
  }

  /**
   * Generate PDF from HTML file
   */
  async renderFromFile(htmlPath, options = {}) {
    const html = await fs.readFile(htmlPath, 'utf-8');
    return this.renderToPDF(html, options);
  }
}

// Export singleton instance
const pdfRenderer = new PDFRenderer();

// Cleanup on process exit
process.on('exit', () => {
  pdfRenderer.close().catch(console.error);
});

process.on('SIGINT', async () => {
  await pdfRenderer.close();
  process.exit(0);
});

export {
  pdfRenderer,
  PDFRenderer
};
