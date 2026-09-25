import { isCollapsibleLog } from "./logGrouping"

const log = (searchText: string) => ({ kind: "log" as const, status: "info", searchText })

test("keeps logs with different full payloads separate even when their previews match", () => {
  const sharedPreview = "liveAuctionStore processAuctionProviderMessage response.msgType:"
  const first = log(`${sharedPreview} ${"x".repeat(160)} currentBid: 125`)
  const second = log(`${sharedPreview} ${"x".repeat(160)} currentBid: 150`)

  expect(isCollapsibleLog(first, second)).toBe(false)
})

test("collapses only consecutive logs with the same complete searchable content and level", () => {
  const first = log('liveAuctionStore {"msgType":"INVALIDLOTS","invalidLots":[]}')

  expect(isCollapsibleLog(first, { ...first })).toBe(true)
  expect(isCollapsibleLog(first, { ...first, status: "warn" })).toBe(false)
  expect(isCollapsibleLog(first, { ...first, kind: "network" })).toBe(false)
})
