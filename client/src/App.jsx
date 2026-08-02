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
      (store) =>
        hostname === store || hostname.endsWith(`.${store}`),
    )
  } catch {
    return false
  }
}

function getStoreName(store = '') {
  if (store.includes('amazon')) return 'Amazon'
  if (store.includes('flipkart')) return 'Flipkart'
  if (store.includes('croma')) return 'Croma'

  return store || 'Store'
}

function formatPrice(price, fallbackText = '—') {
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

function formatDate(dateValue) {
  if (!dateValue) {
    return 'Not checked yet'
  }

  const date = new Date(dateValue)

  if (Number.isNaN(date.getTime())) {
    return 'Not checked yet'
  }

  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission === 'denied') {
    return false
  }

  const permission = await Notification.requestPermission()

  return permission === 'granted'
}

function App() {
  const [productUrl, setProductUrl] = useState('')
  const [products, setProducts] = useState([])
  const [notifications, setNotifications] = useState([])
  const [stats, setStats] = useState({
    trackedProducts: 0,
    priceDrops: 0,
    totalSavings: 0,
  })

  const [formMessage, setFormMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadDashboard() {
      try {
        const [
          productsResponse,
          statsResponse,
          notificationsResponse,
        ] = await Promise.all([
          fetch(`${API_URL}/products`),
          fetch(`${API_URL}/stats`),
          fetch(`${API_URL}/notifications`),
        ])

        const productsData = await productsResponse.json()
        const statsData = await statsResponse.json()
        const notificationsData =
          await notificationsResponse.json()

        if (!productsResponse.ok) {
          throw new Error(
            productsData.message || 'Unable to load products.',
          )
        }

        if (!statsResponse.ok) {
          throw new Error(
            statsData.message || 'Unable to load statistics.',
          )
        }

        if (!notificationsResponse.ok) {
          throw new Error(
            notificationsData.message ||
              'Unable to load notifications.',
          )
        }

        if (isMounted) {
          setProducts(productsData.products)
          setStats(statsData.stats)
          setNotifications(notificationsData.notifications)
        }
      } catch (error) {
        if (isMounted) {
          setFormMessage({
            type: 'error',
            text:
              error.message ||
              'Could not connect to the PricePulse server.',
          })
        }
      }
    }

    loadDashboard()

    return () => {
      isMounted = false
    }
  }, [])

  async function loadStats() {
    const response = await fetch(`${API_URL}/stats`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message || 'Unable to load dashboard statistics.',
      )
    }

    setStats(data.stats)
  }

  async function loadNotifications() {
    const response = await fetch(`${API_URL}/notifications`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message || 'Unable to load notifications.',
      )
    }

    setNotifications(data.notifications)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedUrl = productUrl.trim()

    if (!isSupportedProductUrl(trimmedUrl)) {
      setFormMessage({
        type: 'error',
        text:
          'Please enter a valid Amazon, Flipkart or Croma product link.',
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
        throw new Error(
          data.message || 'Unable to add the product.',
        )
      }

      setProducts((currentProducts) => [
        data.product,
        ...currentProducts,
      ])

      setProductUrl('')

      await loadStats()

      setFormMessage({
        type: 'success',
        text: 'Mobile added with its current price.',
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
      const response = await fetch(
        `${API_URL}/products/refresh`,
        {
          method: 'POST',
        },
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.message || 'Unable to refresh product prices.',
        )
      }

      setProducts(data.products)

      await Promise.all([
        loadStats(),
        loadNotifications(),
      ])

      const droppedProducts = data.results.filter(
        (result) =>
          result.success && result.priceDropped,
      )

      if (droppedProducts.length > 0) {
        const permissionGranted =
          await requestNotificationPermission()

        if (permissionGranted) {
          droppedProducts.forEach((product) => {
            new Notification('PricePulse Price Drop!', {
              body:
                `${product.productName}\n` +
                `${formatPrice(product.previousPrice)} → ` +
                `${formatPrice(product.currentPrice)}\n` +
                `You save ${formatPrice(product.dropAmount)}.`,
            })
          })
        }

        setShowNotifications(true)
      }

      const failedText =
        data.summary.failed > 0
          ? ` ${data.summary.failed} product could not be checked.`
          : ''

      setFormMessage({
        type:
          data.summary.priceDrops > 0
            ? 'success'
            : 'success',
        text: `${data.message}${failedText}`,
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

  const handleNotificationButton = async () => {
    const shouldOpen = !showNotifications

    setShowNotifications(shouldOpen)

    if (shouldOpen) {
      await requestNotificationPermission()
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

          <div className="notification-wrapper">
            <button
              type="button"
              className="notification-button"
              aria-label="Price-drop notifications"
              onClick={handleNotificationButton}
            >
              🔔

              {notifications.length > 0 && (
                <span className="notification-count">
                  {notifications.length > 99
                    ? '99+'
                    : notifications.length}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="notification-panel">
                <div className="notification-panel-header">
                  <div>
                    <p>PRICE ALERTS</p>
                    <h3>Notifications</h3>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setShowNotifications(false)
                    }
                    aria-label="Close notifications"
                  >
                    ×
                  </button>
                </div>

                {notifications.length === 0 ? (
                  <div className="no-notifications">
                    <span>🔕</span>
                    <p>No price drops detected yet.</p>
                  </div>
                ) : (
                  <div className="notification-list">
                    {notifications.map((notification) => (
                      <article
                        className="notification-item"
                        key={notification.id}
                      >
                        <div className="notification-icon">
                          📉
                        </div>

                        <div>
                          <h4>
                            {notification.productName}
                          </h4>

                          <p>
                            {formatPrice(
                              notification.previousPrice,
                            )}
                            {' → '}
                            <strong>
                              {formatPrice(
                                notification.newPrice,
                              )}
                            </strong>
                          </p>

                          <span>
                            Dropped by{' '}
                            {formatPrice(
                              notification.dropAmount,
                            )}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>
      </header>

      <main className="main-content">
        <section
          className="hero-section"
          id="dashboard"
        >
          <div className="hero-badge">
            SMART PRICE TRACKING
          </div>

          <h2>
            Track mobile prices.
            <span>Save more money.</span>
          </h2>

          <p className="hero-description">
            Add a product link and PricePulse will notify
            you whenever its price decreases—even by ₹1.
          </p>

          <form
            className="tracking-form"
            onSubmit={handleSubmit}
          >
            <input
              type="url"
              value={productUrl}
              onChange={handleUrlChange}
              placeholder="Paste a direct Amazon, Flipkart or Croma mobile link"
              aria-label="Product link"
              aria-describedby="form-message"
              required
            />

            <button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Checking Product...'
                : 'Track Product'}
            </button>
          </form>

          {formMessage && (
            <p
              id="form-message"
              className={`form-message ${formMessage.type}`}
              role={
                formMessage.type === 'error'
                  ? 'alert'
                  : 'status'
              }
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
              <h3>{stats.trackedProducts}</h3>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon">📉</span>

            <div>
              <p>Price Drops</p>
              <h3>{stats.priceDrops}</h3>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon">💰</span>

            <div>
              <p>Total Savings</p>
              <h3>
                {formatPrice(stats.totalSavings, '₹0')}
              </h3>
            </div>
          </article>
        </section>

        <section
          className="products-section"
          id="products"
        >
          <div className="section-heading">
            <div>
              <p className="section-label">
                YOUR WATCHLIST
              </p>

              <h2>Tracked Products</h2>
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing
                ? 'Checking Live Prices...'
                : '↻ Refresh Prices'}
            </button>
          </div>

          {products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>

              <h3>No products tracked yet</h3>

              <p>
                Paste your first direct mobile product link
                above to start monitoring its price.
              </p>
            </div>
          ) : (
            <div className="products-grid">
              {products.map((product) => (
                <article
                  className="product-card"
                  key={product.id}
                >
                  <div className="product-card-header">
                    <span className="product-store">
                      {getStoreName(product.store)}
                    </span>

                    <span className="tracking-status">
                      ● Tracking
                    </span>
                  </div>

                  <h3>
                    {product.productName ||
                      'Mobile Product'}
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
                        {formatPrice(
                          product.lowestPrice,
                        )}
                      </strong>
                    </div>
                  </div>

                  <div className="last-checked">
                    Last checked:{' '}
                    {formatDate(product.lastCheckedAt)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>
          © 2026 PricePulse · Built by Rakesh Mondal
        </p>
      </footer>
    </div>
  )
}

export default App