type GroupableItem = {
  kind: "network" | "log"
  status: string
  searchText: string
}

export function isCollapsibleLog(previous: GroupableItem, next: GroupableItem) {
  return (
    previous.kind === "log" &&
    next.kind === "log" &&
    previous.status === next.status &&
    previous.searchText === next.searchText
  )
}
