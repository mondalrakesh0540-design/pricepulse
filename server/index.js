const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

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

  try {
    const [result] = await pool.execute(
      `
        INSERT INTO products (
          url,
          store,
          product_name
        )
        VALUES (?, ?, ?)
      `,
      [productUrl, store, 'Mobile Product'],
    )

    const [rows] = await pool.execute(
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

    return res.status(201).json({
      success: true,
      message: 'Product added successfully.',
      product: formatProduct(rows[0]),
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'This product is already being tracked.',
      })
    }

    console.error('Unable to add product:', error.message)

    return res.status(500).json({
      success: false,
      message: 'Unable to add the product.',
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