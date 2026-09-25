import { filterJsonValue } from "./jsonFilter"

test("keeps complete array objects when a nested value matches", () => {
  const response = {
    additionalInfo: [],
    data: [
      { yardName: "MS - JACKSON", yard: { number: 12, city: "Jackson" }, saleId: 101 },
      { yardName: "FL - TAMPA", yard: { number: 34, city: "Tampa" }, saleId: 102 },
    ],
  }

  expect(filterJsonValue(response, "jackson")).toEqual({ data: [response.data[0]] })
  expect((filterJsonValue(response, "jackson") as { data: unknown[] }).data[0]).toBe(
    response.data[0]
  )
})

test("keeps matching primitive array entries and whole values for matching keys", () => {
  const response = { tags: ["blue", "green"], metadata: { saleId: 101, yard: "Jackson" } }

  expect(filterJsonValue(response, "blue")).toEqual({ tags: ["blue"] })
  expect(filterJsonValue(response, "metadata")).toEqual({ metadata: response.metadata })
  expect(filterJsonValue(response, "missing")).toBeUndefined()
})
