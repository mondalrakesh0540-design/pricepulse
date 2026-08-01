const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const crypto = require('crypto')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

const supportedStores = [
  'amazon.in',
  'amzn.in',
  'flipkart.com',
  'croma.com',
]

const products = []

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

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to PricePulse API',
  })
})

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'PricePulse API is running',
  })
})

app.get('/api/products', (req, res) => {
  res.status(200).json({
    success: true,
    count: products.length,
    products,
  })
})

app.post('/api/products', (req, res) => {
  const productUrl = req.body.url?.trim()
  const store = getProductStore(productUrl)

  if (!productUrl || !store) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid Amazon, Flipkart or Croma product link.',
    })
  }

  const existingProduct = products.find(
    (product) => product.url === productUrl,
  )

  if (existingProduct) {
    return res.status(409).json({
      success: false,
      message: 'This product is already being tracked.',
    })
  }

  const product = {
    id: crypto.randomUUID(),
    url: productUrl,
    store,
    currentPrice: null,
    previousPrice: null,
    lowestPrice: null,
    createdAt: new Date().toISOString(),
  }

  products.push(product)

  return res.status(201).json({
    success: true,
    message: 'Product added successfully.',
    product,
  })
})

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found.',
  })
})

app.listen(PORT, () => {
  console.log(`PricePulse API running on http://localhost:${PORT}`)
})