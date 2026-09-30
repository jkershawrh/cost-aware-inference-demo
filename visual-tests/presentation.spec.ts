import { expect, test } from '@playwright/test'

test('opening and architecture remain visually stable', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveScreenshot('opening.png', { fullPage: true })
  await page.goto('/?act=1&scene=0')
  await expect(page).toHaveScreenshot('architecture.png', { fullPage: true })
})

test('live journey opens as a workload workspace with topology on demand', async ({ page }) => {
  await page.goto('/?act=2&scene=0')
  await expect(page).toHaveScreenshot('live-journey.png', { fullPage: true })
})

test('resolution separates constants, differences, and decision in one viewport', async ({ page }) => {
  await page.goto('/?act=2&scene=1')
  await expect(page.getByRole('heading', { name: 'Same task. Different placement.' })).toBeVisible()
  await expect(page.getByText('HELD CONSTANT')).toBeVisible()
  await expect(page.getByText('WHAT THE RESULT MEANS')).toBeVisible()
  const viewport = page.viewportSize()
  if (viewport && viewport.width >= 1000) {
    const dimensions = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: window.innerHeight }))
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewport)
  }
})

test('core controls are keyboard reachable', async ({ page }) => {
  await page.goto('/?act=0&scene=0')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Restart presentation' })).toBeFocused()
})
