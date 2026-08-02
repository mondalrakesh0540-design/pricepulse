const cron = require('node-cron')

function startAutomaticPriceChecker({
  port,
  schedule = '*/30 * * * *',
}) {
  if (!cron.validate(schedule)) {
    console.error(
      `[AUTO CHECK] Invalid cron schedule: ${schedule}`,
    )

    return null
  }

  const task = cron.schedule(
    schedule,
    async () => {
      const startedAt = new Date()

      console.log(
        `[AUTO CHECK] Started at ${startedAt.toLocaleString(
          'en-IN',
        )}`,
      )

      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/products/refresh`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )

        const data = await response.json()

        if (!response.ok) {
          throw new Error(
            data.message ||
              'Automatic price check failed.',
          )
        }

        console.log(
          '[AUTO CHECK] Completed:',
          `checked=${data.summary.checked},`,
          `drops=${data.summary.priceDrops},`,
          `failed=${data.summary.failed},`,
          `savings=₹${data.summary.totalDropAmount}`,
        )
      } catch (error) {
        console.error(
          '[AUTO CHECK] Failed:',
          error.message,
        )
      }
    },
    {
      name: 'pricepulse-auto-check',
      timezone: 'Asia/Kolkata',
      noOverlap: true,
    },
  )

  console.log(
    `[AUTO CHECK] Scheduled with: ${schedule}`,
  )

  return task
}

module.exports = {
  startAutomaticPriceChecker,
}