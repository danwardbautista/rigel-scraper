const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const today = new Date().toISOString().split('T')[0];

(async () => {
  let browser = await puppeteer.launch({ headless: true });
  let page = await browser.newPage();

  const categoryFolder = path.join(__dirname, 'category_result');
  const productFolder = path.join(__dirname, 'product_initial');
  if (!fs.existsSync(categoryFolder)) fs.mkdirSync(categoryFolder);
  if (!fs.existsSync(productFolder)) fs.mkdirSync(productFolder);

  console.log("Scraping categories...");

  await page.goto('https://www.rigelmedical.com/gb/products/', { waitUntil: 'networkidle2' });

  const categories = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.industryCard')).map(card => {
      const categoryLink = card.querySelector('a')?.getAttribute('href');
      const categoryImage = card.querySelector('img')?.getAttribute('src');
      const categoryName = card.querySelector('.card-title')?.innerText.trim();
      const categoryDescription = card.querySelector('.card-body div')?.innerText.trim();

      return {
        category_name: categoryName,
        category_image: categoryImage ? `https://www.rigelmedical.com${categoryImage}` : null,
        category_description: categoryDescription,
        category_link: categoryLink ? `https://www.rigelmedical.com${categoryLink}` : null
      };
    });
  });

  const categoriesFile = path.join(categoryFolder, 'categories.json');
  fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2));
  console.log(`Categories saved to ${categoriesFile}`);

  let subcategories = [];
  let products = [];
  let productCount = 0;

  console.log("Scraping subcategories...");

  for (let category of categories) {
    console.log(`Scraping from: ${category.category_link}`);

    await page.goto(category.category_link, { waitUntil: 'networkidle2' });

    const subcats = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.row .col-12.col-sm-6.col-lg-4'))
        .slice(0, 2)
        .map(sub => {
          const subcategoryName = sub.querySelector('.panel-title')?.innerText.trim();
          const subcategoryImage = sub.querySelector('img')?.getAttribute('src');
          const subcategoryLink = sub.querySelector('a')?.getAttribute('href');

          return {
            subcategory_name: subcategoryName,
            subcategory_image: subcategoryImage ? `https://www.rigelmedical.com${subcategoryImage}` : null,
            subcategory_link: subcategoryLink ? `https://www.rigelmedical.com${subcategoryLink}` : null
          };
        });
    });

    subcats.forEach(subcat => {
      subcat.product_category_string = category.category_name;
    });

    subcategories = subcategories.concat(subcats);
  }

  const subcategoriesFile = path.join(categoryFolder, 'subcategory.json');
  fs.writeFileSync(subcategoriesFile, JSON.stringify(subcategories, null, 2));
  console.log(`Subcategories saved to ${subcategoriesFile}`);

  console.log("Scraping initial product data...");

  for (let subcategory of subcategories) {
    console.log(`Scraping products from: ${subcategory.subcategory_link}`);

    await page.goto(subcategory.subcategory_link, { waitUntil: 'networkidle2' });

    let subProducts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.row.padding-top-20 .col-12.col-sm-6.col-lg-4')).map(product => {
        const productName = product.querySelector('.productBoxName')?.innerText.trim();
        const productImage = product.querySelector('.product-box img')?.getAttribute('src');
        const productShortDescription = product.querySelector('.productBoxTag')?.innerText.trim();
        const productLink = product.querySelector('a.product-link')?.getAttribute('href');

        return {
          product_name: productName,
          product_image: productImage ? `https://www.rigelmedical.com${productImage}` : null,
          product_short_description: productShortDescription,
          product_link: productLink ? `https://www.rigelmedical.com${productLink}` : null
        };
      });
    });

    subProducts = subProducts.map(product => ({
      ...product,
      product_category_string: subcategory.product_category_string,
      product_subcategory_string: subcategory.subcategory_name
    }));

    subProducts.forEach(product => {
      console.log(`Found product: ${product.product_name} - ${product.product_link}`);
    });

    products = products.concat(subProducts);
    productCount += subProducts.length;

    if (productCount >= 5) {
      console.log("Restarting browser for optimization...");
      await browser.close();
      browser = await puppeteer.launch({ headless: true });
      page = await browser.newPage();
      productCount = 0;
    }
  }

  const productFile = path.join(productFolder, `initial_rigel_products_${today}.json`);
  fs.writeFileSync(productFile, JSON.stringify(products, null, 2));
  console.log(`Products saved to ${productFile}`);

  await browser.close();
  console.log("Scraping complete!");
})();
