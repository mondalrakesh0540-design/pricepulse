const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')
const { scrapeProduct } = require('./scraper')

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
    const hostname = new URL(productUrl).hostname.toLowerCase()

    return supportedStores.find(
      (store) => hostname === store || hostname.endsWith(`.${store}`),
    )
  } catch {
    return null
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

/*
|--------------------------------------------------------------------------
| Root route
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to PricePulse API',
  })
})

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Get all tracked products
|--------------------------------------------------------------------------
*/

app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
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

    res.status(200).json({
      success: true,
      count: rows.length,
      products: rows.map(formatProduct),
    })
  } catch (error) {
    console.error('Unable to load products:', error.message)

    res.status(500).json({
      success: false,
      message: 'Unable to load tracked products.',
    })
  }
})

/*
|--------------------------------------------------------------------------
| Add and scrape a mobile product
|--------------------------------------------------------------------------
*/

app.post('/api/products', async (req, res) => {
  const productUrl =
    typeof req.body.url === 'string' ? req.body.url.trim() : ''

  const store = getProductStore(productUrl)

  if (!productUrl || !store) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid Amazon, Flipkart or Croma product link.',
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
        message: 'This product is already being tracked.',
      })
    }

    /*
     * Playwright দিয়ে product name ও current price বের করা হবে।
     */
    const scrapedProduct = await scrapeProduct(productUrl)

    connection = await pool.getConnection()
    await connection.beginTransaction()

    /*
     * Product database-এ save করা।
     */
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

    /*
     * প্রথম price check price_history table-এ save করা।
     */
    await connection.execute(
      `
        INSERT INTO price_history (
          product_id,
          price
        )
        VALUES (?, ?)
      `,
      [result.insertId, scrapedProduct.currentPrice],
    )

    /*
     * সদ্য save হওয়া product আবার database থেকে নেওয়া।
     */
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
      message: 'Mobile added with its current price.',
      product: formatProduct(rows[0]),
    })
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback()
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError.message)
      }
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'This product is already being tracked.',
      })
    }

    console.error('Unable to add product:', error.message)

    const isProductValidationError =
      error.message.includes('does not appear to be a mobile') ||
      error.message.includes('Could not detect') ||
      error.message.includes('blocked the automatic price check')

    return res.status(isProductValidationError ? 422 : 500).json({
      success: false,
      message: error.message || 'Unable to add the product.',
    })
  } finally {
    if (connection) {
      connection.release()
    }
  }
})

/*
|--------------------------------------------------------------------------
| Route not found
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found.',
  })
})

/*
|--------------------------------------------------------------------------
| Start server after MySQL connection
|--------------------------------------------------------------------------
*/

async function startServer() {
  const requiredVariables = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ]

  const missingVariables = requiredVariables.filter(
    (variable) => !process.env[variable],
  )

  if (missingVariables.length > 0) {
    console.error(
      `Missing environment variables: ${missingVariables.join(', ')}`,
    )

    process.exit(1)
  }

  try {
    const connection = await pool.getConnection()

    await connection.ping()
    connection.release()

    console.log('MySQL connected successfully')

    app.listen(PORT, () => {
      console.log(`PricePulse API running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Server startup failed:', error.message)
    process.exit(1)
  }
}

startServer()