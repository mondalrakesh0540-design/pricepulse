const { chromium } = require('playwright')

const mobileKeywords =
  /\b(mobile|smartphone|phone|iphone|galaxy|oneplus|redmi|realme|iqoo|vivo|oppo|motorola|moto|poco|pixel|nothing|narzo|infinix|tecno|lava)\b/i

function cleanText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const cleanedValue = value
    .replace(/,/g, '')
    .replace(/[^\d.]/g, '')
    .trim()

  const price = Number.parseFloat(cleanedValue)

  return Number.isFinite(price) ? price : null
}

function findProductJsonLd(value) {
  if (!value) {
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const product = findProductJsonLd(item)

      if (product) {
        return product
      }
    }

    return null
  }

  if (typeof value !== 'object') {
    return null
  }

  const type = value['@type']
  const types = Array.isArray(type) ? type : [type]

  if (
    types.some(
      (item) =>
        typeof item === 'string' &&
        item.toLowerCase() === 'product',
    )
  ) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    const product = findProductJsonLd(nestedValue)

    if (product) {
      return product
    }
  }

  return null
}

function getOfferPrice(offers) {
  if (!offers) {
    return null
  }

  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const price = getOfferPrice(offer)

      if (price !== null) {
        return price
      }
    }

    return null
  }

  if (typeof offers !== 'object') {
    return null
  }

  return (
    parsePrice(offers.price) ??
    parsePrice(offers.lowPrice) ??
    parsePrice(offers.highPrice) ??
    parsePrice(offers.priceSpecification?.price)
  )
}

async function scrapeProduct(productUrl) {
  let browser

  try {
    new URL(productUrl)

    browser = await chromium.launch({
      headless: true,
    })

    const context = await browser.newContext({
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/140.0.0.0 Safari/537.36',
      viewport: {
        width: 1440,
        height: 900,
      },
    })

    const page = await context.newPage()

    page.setDefaultNavigationTimeout(45000)

    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })

    await page.waitForTimeout(2000)

    const extractedData = await page.evaluate(() => {
      function getMeta(selector) {
        return document.querySelector(selector)?.content?.trim() || ''
      }

      function getText(selector) {
        return document.querySelector(selector)?.textContent?.trim() || ''
      }

      const jsonLdItems = []

      for (const script of document.querySelectorAll(
        'script[type="application/ld+json"]',
      )) {
        try {
          jsonLdItems.push(JSON.parse(script.textContent))
        } catch {
          // Ignore invalid JSON-LD blocks.
        }
      }

      const priceCandidates = [
        getMeta('meta[property="product:price:amount"]'),
        getMeta('meta[property="og:price:amount"]'),
        getMeta('meta[itemprop="price"]'),
        document
          .querySelector('[itemprop="price"]')
          ?.getAttribute('content'),
        getText('#corePrice_feature_div .a-offscreen'),
        getText('#apex_desktop .a-price .a-offscreen'),
        getText('.a-price .a-offscreen'),
        getText('div.Nx9bqj.CxhGGd'),
        getText('[data-testid="price"]'),
      ].filter(Boolean)

      return {
        pageTitle: document.title,
        openGraphTitle: getMeta('meta[property="og:title"]'),
        openGraphImage: getMeta('meta[property="og:image"]'),
        currency:
          getMeta('meta[property="product:price:currency"]') ||
          getMeta('meta[itemprop="priceCurrency"]') ||
          'INR',
        priceCandidates,
        jsonLdItems,
        bodyText: document.body?.innerText?.slice(0, 1000) || '',
      }
    })

    const pageText =
      `${extractedData.pageTitle} ${extractedData.bodyText}`.toLowerCase()

    if (
      pageText.includes('captcha') ||
      pageText.includes('robot check') ||
      pageText.includes('access denied')
    ) {
      throw new Error(
        'The store blocked the automatic price check. Try again later.',
      )
    }

    const productJsonLd = findProductJsonLd(
      extractedData.jsonLdItems,
    )

    const productName = cleanText(
      productJsonLd?.name ||
        extractedData.openGraphTitle ||
        extractedData.pageTitle,
    )

    const jsonLdPrice = getOfferPrice(productJsonLd?.offers)

    const fallbackPrice = extractedData.priceCandidates
      .map(parsePrice)
      .find((price) => price !== null)

    const currentPrice = jsonLdPrice ?? fallbackPrice ?? null

    const productImage = Array.isArray(productJsonLd?.image)
      ? productJsonLd.image[0]
      : productJsonLd?.image || extractedData.openGraphImage || null

    if (!productName) {
      throw new Error('Could not detect the product name.')
    }

    if (!mobileKeywords.test(productName)) {
      throw new Error(
        'This link does not appear to be a mobile phone product.',
      )
    }

    if (currentPrice === null) {
      throw new Error(
        'Could not detect the current product price.',
      )
    }

    return {
      productName,
      currentPrice,
      currency: extractedData.currency || 'INR',
      productImage,
      productUrl,
    }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

module.exports = {
  scrapeProduct,
}

if (require.main === module) {
  const productUrl = process.argv[2]

  if (!productUrl) {
    console.error(
      'Usage: node scraper.js "https://product-link-here"',
    )
    process.exit(1)
  }

  scrapeProduct(productUrl)
    .then((product) => {
      console.log('\nProduct detected successfully:\n')
      console.log(product)
    })
    .catch((error) => {
      console.error('\nScraping failed:', error.message)
      process.exitCode = 1
    })
}