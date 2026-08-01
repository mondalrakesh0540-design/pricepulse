const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'PricePulse API is running',
  })
})

app.listen(PORT, () => {
  console.log(`PricePulse API running on http://localhost:${PORT}`)
})
