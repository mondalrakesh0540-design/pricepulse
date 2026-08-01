import './App.css'

function App() {
  const handleSubmit = (event) => {
    event.preventDefault()
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
          <button type="button" className="notification-button">
            🔔
          </button>
        </nav>
      </header>

      <main className="main-content">
        <section className="hero-section" id="dashboard">
          <div className="hero-badge">SMART PRICE TRACKING</div>

          <h2>
            Track mobile prices.
            <span> Save more money.</span>
          </h2>

          <p className="hero-description">
            Add a product link and PricePulse will notify you whenever its price
            decreases—even by ₹1.
          </p>

          <form className="tracking-form" onSubmit={handleSubmit}>
            <input
              type="url"
              placeholder="Paste Amazon, Flipkart or Croma product link"
              aria-label="Product link"
              required
            />

            <button type="submit">Track Product</button>
          </form>

          <p className="supported-stores">
            Supported stores: Amazon · Flipkart · Croma
          </p>
        </section>

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-icon">📱</span>
            <div>
              <p>Tracked Products</p>
              <h3>0</h3>
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

            <button type="button" className="refresh-button">
              ↻ Refresh Prices
            </button>
          </div>

          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <h3>No products tracked yet</h3>
            <p>
              Paste your first mobile product link above to start monitoring its
              price.
            </p>
          </div>
        </section>
      </main>

      <footer>
        <p>© 2026 PricePulse · Built by Rakesh Mondal</p>
      </footer>
    </div>
  )
}

export default App