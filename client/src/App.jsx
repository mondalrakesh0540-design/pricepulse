import { useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:5000/api'

const supportedStores = [
  'amazon.in',
  'amzn.in',
  'flipkart.com',
  'croma.com',
]

function isSupportedProductUrl(productUrl) {
  try {
    const hostname = new URL(productUrl).hostname.toLowerCase()

    return supportedStores.some(
      (store) => hostname === store || hostname.endsWith(`.${store}`),
    )
  } catch {
    return false
  }
}

function getStoreName(store = '') {
  if (store.includes('amazon')) {
    return 'Amazon'
  }

  if (store.includes('flipkart')) {
    return 'Flipkart'
  }

  if (store.includes('croma')) {
    return 'Croma'
  }

  return store || 'Store'
}

function formatPrice(price, fallbackText) {
  if (price === null || price === undefined) {
    return fallbackText
  }

  const numericPrice = Number(price)

  if (!Number.isFinite(numericPrice)) {
    return fallbackText
  }

  return `₹${numericPrice.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function App() {
  const [productUrl, setProductUrl] = useState('')
  const [products, setProducts] = useState([])
  const [formMessage, setFormMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function fetchProducts() {
      try {
        const response = await fetch(`${API_URL}/products`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.message || 'Unable to load products.')
        }

        if (isMounted) {
          setProducts(data.products)
        }
      } catch {
        if (isMounted) {
          setFormMessage({
            type: 'error',
            text: 'Could not connect to the PricePulse server.',
          })
        }
      }
    }

    fetchProducts()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedUrl = productUrl.trim()

    if (!isSupportedProductUrl(trimmedUrl)) {
      setFormMessage({
        type: 'error',
        text: 'Please enter a valid Amazon, Flipkart or Croma product link.',
      })

      return
    }

    setIsSubmitting(true)
    setFormMessage(null)

    try {
      const response = await fetch(`${API_URL}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: trimmedUrl,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Unable to add product.')
      }

      setProducts((currentProducts) => [
        data.product,
        ...currentProducts,
      ])

      setProductUrl('')

      setFormMessage({
        type: 'success',
        text: 'Product added to your PricePulse watchlist.',
      })
    } catch (error) {
      setFormMessage({
        type: 'error',
        text: error.message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    setFormMessage(null)

    try {
      const response = await fetch(`${API_URL}/products`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Unable to refresh products.')
      }

      setProducts(data.products)

      setFormMessage({
        type: 'success',
        text: 'Tracked products refreshed successfully.',
      })
    } catch (error) {
      setFormMessage({
        type: 'error',
        text: error.message,
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleUrlChange = (event) => {
    setProductUrl(event.target.value)

    if (formMessage) {
      setFormMessage(null)
    }
  }

  return (
    <div className="app">
      <header className="navbar">
        <a className="brand" href="/">
          <span className="brand-icon">📉</span>

          <div>
            <h1>PricePulse</h1>
            <p>Never miss a price drop</p>
          </div>
        </a>

        <nav className="nav-links">
          <a href="#dashboard">Dashboard</a>
          <a href="#products">Tracked Products</a>

          <button
            type="button"
            className="notification-button"
            aria-label="Notifications"
          >
            🔔
          </button>
        </nav>
      </header>

      <main className="main-content">
        <section className="hero-section" id="dashboard">
          <div className="hero-badge">SMART PRICE TRACKING</div>

          <h2>
            Track mobile prices.
            <span>Save more money.</span>
          </h2>

          <p className="hero-description">
            Add a product link and PricePulse will notify you whenever its price
            decreases—even by ₹1.
          </p>

          <form className="tracking-form" onSubmit={handleSubmit}>
            <input
              type="url"
              value={productUrl}
              onChange={handleUrlChange}
              placeholder="Paste Amazon, Flipkart or Croma mobile link"
              aria-label="Product link"
              aria-describedby="form-message"
              required
            />

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Checking Product...' : 'Track Product'}
            </button>
          </form>

          {formMessage && (
            <p
              id="form-message"
              className={`form-message ${formMessage.type}`}
              role={formMessage.type === 'error' ? 'alert' : 'status'}
            >
              {formMessage.text}
            </p>
          )}

          <p className="supported-stores">
            Supported stores: Amazon · Flipkart · Croma
          </p>
        </section>

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-icon">📱</span>

            <div>
              <p>Tracked Products</p>
              <h3>{products.length}</h3>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon">📉</span>

            <div>
              <p>Price Drops</p>
              <h3>0</h3>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon">💰</span>

            <div>
              <p>Total Savings</p>
              <h3>₹0</h3>
            </div>
          </article>
        </section>

        <section className="products-section" id="products">
          <div className="section-heading">
            <div>
              <p className="section-label">YOUR WATCHLIST</p>
              <h2>Tracked Products</h2>
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : '↻ Refresh Products'}
            </button>
          </div>

          {products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>

              <h3>No products tracked yet</h3>

              <p>
                Paste your first mobile product link above to start monitoring
                its price.
              </p>
            </div>
          ) : (
            <div className="products-grid">
              {products.map((product) => (
                <article className="product-card" key={product.id}>
                  <div className="product-card-header">
                    <span className="product-store">
                      {getStoreName(product.store)}
                    </span>

                    <span className="tracking-status">
                      ● Tracking
                    </span>
                  </div>

                  <h3>
                    {product.productName || 'Mobile Product'}
                  </h3>

                  <a
                    className="product-link"
                    href={product.url}
                    target="_blank"
                    rel="noreferrer"
                    title={product.url}
                  >
                    {product.url}
                  </a>

                  <div className="product-price-row">
                    <div>
                      <p>Current price</p>

                      <strong>
                        {formatPrice(
                          product.currentPrice,
                          'Waiting for first check',
                        )}
                      </strong>
                    </div>

                    <div>
                      <p>Lowest price</p>

                      <strong>
                        {formatPrice(product.lowestPrice, '—')}
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>© 2026 PricePulse · Built by Rakesh Mondal</p>
      </footer>
    </div>
  )
}

export default App