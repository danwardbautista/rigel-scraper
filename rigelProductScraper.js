const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const today = new Date().toISOString().split('T')[0];

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

(async () => {
  let browser = await puppeteer.launch({ headless: true });
  let page = await browser.newPage();

  const resultsFolder = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);
  const failFolder = path.join(__dirname, 'product_fail');
  if (!fs.existsSync(failFolder)) fs.mkdirSync(failFolder);

  const productInitialFolder = path.join(__dirname, 'product_initial');
  const files = fs.readdirSync(productInitialFolder);
  const latestFile = files.find(file => file.startsWith("initial_rigel_products_"));

  if (!latestFile) {
    console.error("No product initial JSON file found!");
    await browser.close();
    return;
  }

  const productInitialFile = path.join(productInitialFolder, latestFile);
  const products = JSON.parse(fs.readFileSync(productInitialFile, 'utf-8'));

  let finalProducts = [];
  let failedProducts = [];
  let scrapeCount = 0;

  console.log("Scraping product details...");

  for (let [index, product] of products.entries()) {
    console.log(`Scraping product: ${product.product_name} (${product.product_link})`);
    try {
      await page.goto(product.product_link, { waitUntil: 'networkidle2' });
      await autoScroll(page);
      console.log("Waiting for images to load...");
      await page.waitForFunction(() => {
        const mainImg = document.querySelector('#zoom .productImage');
        const previewImgs = Array.from(document.querySelectorAll('.product-image-preview img'));
        if (!mainImg) return false;
        const mainLoaded = mainImg.complete && mainImg.naturalWidth > 0;
        const previewLoaded = previewImgs.length === 0 || previewImgs.every(img => img.complete && img.naturalWidth > 0);
        return mainLoaded && previewLoaded;
      }, { timeout: 60000 });

      const productDetails = await page.evaluate(() => {
        const productName = document.querySelector('.productName')?.innerText.trim();
        const productSubtitle = document.querySelector('.productSubtitle')?.innerText.trim();
        const productDescription = document.querySelector('.productDescription')?.innerText.trim();
        const productIdentifier = document.querySelector('div[style*="color:rgba(0,0,0,0.4);font-size:12px;margin-top: 50px;"]')?.innerText.trim();

        const mainImgElem = document.querySelector('#zoom .productImage');
        let mainImgSrc = mainImgElem ? mainImgElem.getAttribute('src') : null;
        if (mainImgSrc && !mainImgSrc.startsWith('http')) {
          mainImgSrc = `https://www.rigelmedical.com${mainImgSrc}`;
        }
        if (mainImgSrc) {
          mainImgSrc = mainImgSrc.replace("&height=500", "");
        }

        const previewImgElems = Array.from(document.querySelectorAll('.product-image-preview img'));
        const previewImgSrcs = previewImgElems.map(img => {
          let src = img.getAttribute('src');
          if (src) {
            if (!src.startsWith('http')) {
              src = `https://www.rigelmedical.com${src}`;
            }
            src = src.replace("&height=500", "");
            return src;
          }
          return null;
        }).filter(src => src !== null);

        let allImages = [];
        if (mainImgSrc) {
          allImages.push(mainImgSrc);
        }
        allImages = allImages.concat(previewImgSrcs);
        allImages = Array.from(new Set(allImages));

        let technicalSpecs = "";
        const specTables = document.querySelectorAll('#specsList table.table');
        specTables.forEach(table => {
          const headerCell = table.querySelector('tr th');
          if (headerCell) {
            const tableName = headerCell.innerText.trim();
            let tableHTML = `<h3>${tableName}</h3>`;
            tableHTML += `<table border="1" style="border-collapse: collapse; width: 100%;">`;
            tableHTML += `<thead><tr><th>Spec Name</th><th>Spec Value</th></tr></thead><tbody>`;
            const rows = table.querySelectorAll('tr');
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 2) {
                const specName = cells[0].innerText.trim();
                const specValue = cells[1].innerText.trim();
                tableHTML += `<tr><td>${specName}</td><td>${specValue}</td></tr>`;
              }
            }
            tableHTML += `</tbody></table>`;
            technicalSpecs += tableHTML + `<br><br>`;
          }
        });

        return {
          product_name: productName || null,
          product_identifier: productIdentifier || null,
          product_images: allImages,
          product_subtitle: productSubtitle || null,
          product_description: productDescription || null,
          product_link: window.location.href,
          technical_specifications: technicalSpecs
        };
      });
      
      productDetails.product_category_string = product.product_category_string || null;
      productDetails.product_subcategory_string = product.product_subcategory_string || null;
      
      finalProducts.push(productDetails);
    } catch (error) {
      console.error(`Failed to scrape product: ${product.product_name} (${product.product_link})`);
      failedProducts.push({
        product_name: product.product_name,
        product_link: product.product_link,
        error: error.message
      });
    }

    scrapeCount++;
    if (scrapeCount >= 5) {
      console.log("Restarting browser for optimization...");
      await browser.close();
      browser = await puppeteer.launch({ headless: true });
      page = await browser.newPage();
      scrapeCount = 0;
    }
  }

  const productResultsFile = path.join(resultsFolder, `rigel_product_${today}.json`);
  fs.writeFileSync(productResultsFile, JSON.stringify(finalProducts, null, 2));
  console.log(`Product details saved to ${productResultsFile}`);

  if (failedProducts.length > 0) {
    const failedFile = path.join(failFolder, `product_fail_rigel_${today}.json`);
    fs.writeFileSync(failedFile, JSON.stringify(failedProducts, null, 2));
    console.log(`Failed product details saved to ${failedFile}`);
  } else {
    console.log("No failed product scrapes.");
  }

  await browser.close();
  console.log("Product scraping complete!");
})();
