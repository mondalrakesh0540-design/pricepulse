const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

const { scrapeProduct } = require('./scraper')
const {
  startAutomaticPriceChecker,
} = require('./autoChecker')

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 5000

const supportedStores = [
  'amazon.in',
  'amzn.in',
  'flipkart.com',
  'croma.com',
]

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
})

app.use(cors())
app.use(express.json())

function getProductStore(productUrl) {
  try {
    const parsedUrl = new URL(productUrl)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return null
    }

    const hostname = parsedUrl.hostname.toLowerCase()

    return supportedStores.find(
      (store) =>
        hostname === store ||
        hostname.endsWith(`.${store}`),
    )
  } catch {
    return null
  }
}

function isDirectProductUrl(productUrl, store) {
  try {
    const parsedUrl = new URL(productUrl)
    const pathname = parsedUrl.pathname.toLowerCase()

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false
    }

    if (store === 'amazon.in') {
      return (
        pathname.includes('/dp/') ||
        pathname.includes('/gp/product/') ||
        pathname.includes('/gp/aw/d/')
      )
    }

    if (store === 'amzn.in') {
      return pathname.length > 1
    }

    if (store === 'flipkart.com') {
      return (
        pathname.includes('/p/itm') ||
        pathname.includes('/p/')
      )
    }

    if (store === 'croma.com') {
      return pathname.includes('/p/')
    }

    return false
  } catch {
    return false
  }
}

function formatProduct(row) {
  return {
    id: row.id,
    url: row.url,
    store: row.store,
    productName: row.product_name,
    currentPrice: row.current_price,
    previousPrice: row.previous_price,
    lowestPrice: row.lowest_price,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getAllProducts(database = pool) {
  const [rows] = await database.execute(`
    SELECT
      id,
      url,
      store,
      product_name,
      current_price,
      previous_price,
      lowest_price,
      last_checked_at,
      created_at,
      updated_at
    FROM products
    ORDER BY created_at DESC
  `)

  return rows.map(formatProduct)
}

async function getDashboardStats() {
  const [[productStats]] = await pool.execute(`
    SELECT COUNT(*) AS trackedProducts
    FROM products
  `)

  const [[notificationStats]] = await pool.execute(`
    SELECT
      COUNT(*) AS priceDrops,
      COALESCE(SUM(drop_amount), 0) AS totalSavings
    FROM notifications
    WHERE notification_type = 'price_drop'
  `)

  return {
    trackedProducts: Number(productStats.trackedProducts),
    priceDrops: Number(notificationStats.priceDrops),
    totalSavings: Number(notificationStats.totalSavings),
  }
}

async function refreshSingleProduct(product) {
  const scrapedProduct = await scrapeProduct(product.url)
  const newPrice = Number(scrapedProduct.currentPrice)

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    throw new Error('The detected product price is invalid.')
  }

  const oldPrice =
    product.current_price === null
      ? null
      : Number(product.current_price)

  const previousLowestPrice =
    product.lowest_price === null
      ? null
      : Number(product.lowest_price)

  const lowestPrice =
    previousLowestPrice === null
      ? newPrice
      : Math.min(previousLowestPrice, newPrice)

  const hasPriceDrop =
    oldPrice !== null && newPrice < oldPrice

  const dropAmount = hasPriceDrop
    ? Number((oldPrice - newPrice).toFixed(2))
    : 0

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    await connection.execute(
      `
        UPDATE products
        SET
          product_name = ?,
          previous_price = ?,
          current_price = ?,
          lowest_price = ?,
          last_checked_at = NOW()
        WHERE id = ?
      `,
      [
        scrapedProduct.productName,
        oldPrice,
        newPrice,
        lowestPrice,
        product.id,
      ],
    )

    await connection.execute(
      `
        INSERT INTO price_history (
          product_id,
          price
        )
        VALUES (?, ?)
      `,
      [product.id, newPrice],
    )

    if (hasPriceDrop) {
      await connection.execute(
        `
          INSERT INTO notifications (
            product_id,
            previous_price,
            new_price,
            drop_amount,
            notification_type,
            is_sent
          )
          VALUES (?, ?, ?, ?, 'price_drop', FALSE)
        `,
        [
          product.id,
          oldPrice,
          newPrice,
          dropAmount,
        ],
      )
    }

    await connection.commit()

    return {
      success: true,
      productId: product.id,
      productName: scrapedProduct.productName,
      previousPrice: oldPrice,
      currentPrice: newPrice,
      lowestPrice,
      priceDropped: hasPriceDrop,
      dropAmount,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to PricePulse API',
  })
})

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')

    res.status(200).json({
      success: true,
      message: 'PricePulse API and MySQL are running',
    })
  } catch (error) {
    console.error('Health check failed:', error.message)

    res.status(500).json({
      success: false,
      message: 'Database connection failed.',
    })
  }
})

app.get('/api/products', async (req, res) => {
  try {
    const products = await getAllProducts()

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    })
  } catch (error) {
    console.error(
      'Unable to load products:',
      error.message,
    )

    res.status(500).json({
      success: false,
      message: 'Unable to load tracked products.',
    })
  }
})

app.post('/api/products', async (req, res) => {
  const productUrl =
    typeof req.body.url === 'string'
      ? req.body.url.trim()
      : ''

  const store = getProductStore(productUrl)

  if (!productUrl || !store) {
    return res.status(400).json({
      success: false,
      message:
        'Enter a valid Amazon, Flipkart or Croma product link.',
    })
  }

  if (!isDirectProductUrl(productUrl, store)) {
    return res.status(400).json({
      success: false,
      message:
        'Please paste the direct mobile product page link, not a search or category page.',
    })
  }

  let connection

  try {
    const [existingRows] = await pool.execute(
      `
        SELECT id
        FROM products
        WHERE url = ?
        LIMIT 1
      `,
      [productUrl],
    )

    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          'This product is already being tracked.',
      })
    }

    const scrapedProduct = await scrapeProduct(productUrl)

    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [result] = await connection.execute(
      `
        INSERT INTO products (
          url,
          store,
          product_name,
          current_price,
          previous_price,
          lowest_price,
          last_checked_at
        )
        VALUES (?, ?, ?, ?, NULL, ?, NOW())
      `,
      [
        productUrl,
        store,
        scrapedProduct.productName,
        scrapedProduct.currentPrice,
        scrapedProduct.currentPrice,
      ],
    )

    await connection.execute(
      `
        INSERT INTO price_history (
          product_id,
          price
        )
        VALUES (?, ?)
      `,
      [
        result.insertId,
        scrapedProduct.currentPrice,
      ],
    )

    const [rows] = await connection.execute(
      `
        SELECT
          id,
          url,
          store,
          product_name,
          current_price,
          previous_price,
          lowest_price,
          last_checked_at,
          created_at,
          updated_at
        FROM products
        WHERE id = ?
      `,
      [result.insertId],
    )

    await connection.commit()

    return res.status(201).json({
      success: true,
      message:
        'Mobile added with its current price.',
      product: formatProduct(rows[0]),
    })
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback()
      } catch (rollbackError) {
        console.error(
          'Rollback failed:',
          rollbackError.message,
        )
      }
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message:
          'This product is already being tracked.',
      })
    }

    console.error(
      'Unable to add product:',
      error.message,
    )

    const validationMessages = [
      'does not appear to be a mobile',
      'Could not detect',
      'blocked the automatic price check',
      'invalid',
    ]

    const isValidationError =
      validationMessages.some((message) =>
        error.message.includes(message),
      )

    return res
      .status(isValidationError ? 422 : 500)
      .json({
        success: false,
        message:
          error.message ||
          'Unable to add the product.',
      })
  } finally {
    if (connection) {
      connection.release()
    }
  }
})

app.post('/api/products/refresh', async (req, res) => {
  try {
    const [products] = await pool.execute(`
      SELECT
        id,
        url,
        store,
        product_name,
        current_price,
        previous_price,
        lowest_price
      FROM products
      ORDER BY id ASC
    `)

    if (products.length === 0) {
      return res.status(200).json({
        success: true,
        message:
          'No products are currently being tracked.',
        summary: {
          checked: 0,
          priceDrops: 0,
          failed: 0,
          totalDropAmount: 0,
        },
        results: [],
        products: [],
      })
    }

    const results = []

    for (const product of products) {
      try {
        const result =
          await refreshSingleProduct(product)

        results.push(result)
      } catch (error) {
        console.error(
          `Refresh failed for product ${product.id}:`,
          error.message,
        )

        results.push({
          success: false,
          productId: product.id,
          productName: product.product_name,
          message: error.message,
        })
      }
    }

    const successfulResults = results.filter(
      (result) => result.success,
    )

    const priceDropResults =
      successfulResults.filter(
        (result) => result.priceDropped,
      )

    const failedResults = results.filter(
      (result) => !result.success,
    )

    const totalDropAmount =
      priceDropResults.reduce(
        (total, result) =>
          total + result.dropAmount,
        0,
      )

    const updatedProducts =
      await getAllProducts()

    return res.status(200).json({
      success: true,
      message:
        priceDropResults.length > 0
          ? `${priceDropResults.length} price drop detected.`
          : 'All prices checked. No price drop detected.',
      summary: {
        checked: successfulResults.length,
        priceDrops: priceDropResults.length,
        failed: failedResults.length,
        totalDropAmount: Number(
          totalDropAmount.toFixed(2),
        ),
      },
      results,
      products: updatedProducts,
    })
  } catch (error) {
    console.error(
      'Price refresh failed:',
      error.message,
    )

    return res.status(500).json({
      success: false,
      message:
        'Unable to refresh product prices.',
    })
  }
})

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats()

    res.status(200).json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error(
      'Unable to load stats:',
      error.message,
    )

    res.status(500).json({
      success: false,
      message:
        'Unable to load dashboard statistics.',
    })
  }
})

app.get('/api/notifications', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        notifications.id,
        notifications.product_id AS productId,
        notifications.previous_price AS previousPrice,
        notifications.new_price AS newPrice,
        notifications.drop_amount AS dropAmount,
        notifications.notification_type AS notificationType,
        notifications.is_sent AS isSent,
        notifications.created_at AS createdAt,
        products.product_name AS productName,
        products.store,
        products.url
      FROM notifications
      INNER JOIN products
        ON products.id = notifications.product_id
      ORDER BY notifications.created_at DESC
      LIMIT 50
    `)

    res.status(200).json({
      success: true,
      count: rows.length,
      notifications: rows,
    })
  } catch (error) {
    console.error(
      'Unable to load notifications:',
      error.message,
    )

    res.status(500).json({
      success: false,
      message:
        'Unable to load notifications.',
    })
  }
})

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found.',
  })
})

async function startServer() {
  const requiredVariables = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ]

  const missingVariables =
    requiredVariables.filter(
      (variable) => !process.env[variable],
    )

  if (missingVariables.length > 0) {
    console.error(
      `Missing environment variables: ${missingVariables.join(', ')}`,
    )

    process.exit(1)
  }

  try {
    const connection =
      await pool.getConnection()

    await connection.ping()
    connection.release()

    console.log('MySQL connected successfully')

    app.listen(PORT, () => {
      console.log(
        `PricePulse API running on http://localhost:${PORT}`,
      )

      startAutomaticPriceChecker({
        port: PORT,
        schedule:
          process.env.PRICE_CHECK_CRON ||
          '*/30 * * * *',
      })
    })
  } catch (error) {
    console.error(
      'Server startup failed:',
      error.message,
    )

    process.exit(1)
  }
}

startServer()