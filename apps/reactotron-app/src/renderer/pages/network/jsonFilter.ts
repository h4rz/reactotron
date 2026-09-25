export function filterJsonValue(value: unknown, search: string): unknown {
  const needle = search.trim().toLowerCase()
  if (!needle) return value

  if (Array.isArray(value)) {
    const matchingItems = value.filter((item) => filterJsonValue(item, search) !== undefined)
    return matchingItems.length > 0 ? matchingItems : undefined
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}

    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const filtered = filterJsonValue(item, search)
      if (key.toLowerCase().includes(needle) || filtered !== undefined) {
        output[key] = filtered === undefined ? item : filtered
      }
    })

    return Object.keys(output).length > 0 ? output : undefined
  }

  return String(value ?? "")
    .toLowerCase()
    .includes(needle)
    ? value
    : undefined
}
