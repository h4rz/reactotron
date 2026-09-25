import React, { ReactNode, useCallback, useContext, useMemo, useState } from "react"
import { clipboard } from "electron"
import {
  MdOutlineContentCopy,
  MdOutlineDeleteSweep,
  MdOutlineExpandMore,
  MdOutlineInsertDriveFile,
  MdOutlineNetworkWifi,
  MdOutlineArrowDownward,
  MdOutlineArrowUpward,
  MdOutlineSearch,
} from "react-icons/md"
import styled from "styled-components"
import { ContentView, EmptyState, Header, ReactotronContext } from "@hurajgor/reactotron-core-ui"
import type { ApiResponsePayload, Command, LogPayload } from "@hurajgor/reactotron-core-contract"
import { filterJsonValue } from "./jsonFilter"

type ConsoleKind = "network" | "log"
type BodyMode = "pretty" | "tree" | "raw"
type InspectorTab = "summary" | "request" | "response" | "headers" | "raw"
type LogLevel = "debug" | "info" | "warn" | "error"
type LogLevelSelection = Record<LogLevel, boolean>
type NetworkFilterKey =
  | "method"
  | "status"
  | "duration"
  | "contentType"
  | "timeWindow"
  | "duplicate"
  | "endpoint"
  | "host"
type NetworkFilters = Record<NetworkFilterKey, string>
type TableColumn = "kind" | "status" | "duration" | "time"
type TableColumns = Record<TableColumn, number>
type TreeValueType = "string" | "number" | "boolean" | "null" | "undefined" | "object"

type ConsoleItem = {
  id: string
  kind: ConsoleKind
  command: Command
  title: string
  subtitle: string
  searchText: string
  method: string
  status: string
  contentType: string
  tone: "good" | "warn" | "bad" | "muted" | "redirect"
  time: string
  duration?: number
  timestamp: number
  source: string
  count: number
}

type ApiRequest = Partial<ApiResponsePayload["request"]>
type ApiResponse = Partial<ApiResponsePayload["response"]>

const defaultLogLevels: LogLevelSelection = {
  debug: false,
  info: true,
  warn: true,
  error: true,
}

const defaultTableColumns: TableColumns = {
  kind: 92,
  status: 72,
  duration: 86,
  time: 96,
}

const defaultNetworkFilters: NetworkFilters = {
  method: "",
  status: "",
  duration: "",
  contentType: "",
  timeWindow: "",
  duplicate: "",
  endpoint: "",
  host: "",
}

const verboseLogLevels: LogLevelSelection = {
  debug: true,
  info: true,
  warn: true,
  error: true,
}

const logLevelOptions: Array<{ level: LogLevel; label: string }> = [
  { level: "debug", label: "Verbose" },
  { level: "info", label: "Info" },
  { level: "warn", label: "Warnings" },
  { level: "error", label: "Errors" },
]

const durationFilterOptions = ["500 ms+", "1 s+", "3 s+"]
const timeWindowFilterOptions = ["Last 30s", "Last 1m", "Last 5m"]
const duplicateFilterValue = "duplicates-only"

const treeValueColor: Record<TreeValueType, string> = {
  string: "#9ece6a",
  number: "#ff9e64",
  boolean: "#bb9af7",
  null: "#565f89",
  undefined: "#565f89",
  object: "#c0caf5",
}

const treePreviewLimit = 80
const monoFont = `var(--reactotron-monospace-font, ui-monospace, "SF Mono", Menlo, Consolas, monospace)`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  padding: 12px 16px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.surfacePanel};
`

const ToolbarRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
`

const SearchRow = styled(ToolbarRow)`
  flex-wrap: nowrap;
`

const FilterRow = styled(ToolbarRow)`
  align-items: stretch;
`

const FilterGroup = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-right: 10px;
  border-right: 1px solid ${(props) => props.theme.borderSubtle};

  &:last-child {
    padding-right: 0;
    border-right: 0;
  }
`

const ToggleCount = styled.span`
  color: ${(props) => props.theme.foregroundDark};
`

const SearchBox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 220px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foregroundDark};

  &:focus-within {
    border-color: ${(props) => props.theme.highlight};
    box-shadow: 0 0 0 2px
      ${(props) => `color-mix(in srgb, ${props.theme.highlight} 18%, transparent)`};
  }
`

const SearchInput = styled.input`
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: ${(props) => props.theme.foreground};
  font-size: 13px;
`

const Toggle = styled.label`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  color: ${(props) => props.theme.foreground};
  background-color: ${(props) => props.theme.background};
  font-size: 12px;
  cursor: pointer;

  input {
    margin: 0;
    accent-color: ${(props) => props.theme.highlight};
  }
`

const FilterSelect = styled.select`
  flex: 0 1 150px;
  width: 150px;
  min-width: 0;
  min-height: 34px;
  padding: 0 28px 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  outline: 0;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 12px;
  cursor: pointer;

  &:focus {
    border-color: ${(props) => props.theme.highlight};
    box-shadow: 0 0 0 2px
      ${(props) => `color-mix(in srgb, ${props.theme.highlight} 18%, transparent)`};
  }
`

const InlineFilterInput = styled.input`
  flex: 0 1 92px;
  width: 92px;
  min-width: 0;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  outline: 0;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 12px;

  &:focus {
    border-color: ${(props) => props.theme.highlight};
    box-shadow: 0 0 0 2px
      ${(props) => `color-mix(in srgb, ${props.theme.highlight} 18%, transparent)`};
  }
`

const LogLevelMenu = styled.details`
  position: relative;
  flex: 0 1 190px;
  width: 190px;
  min-width: 0;
  color: ${(props) => props.theme.foreground};
  font-size: 12px;
`

const LogLevelSummary = styled.summary`
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  background-color: ${(props) => props.theme.background};
  cursor: pointer;
  list-style: none;

  &::-webkit-details-marker {
    display: none;
  }
`

const LogLevelValue = styled.span`
  min-width: 0;
  overflow: hidden;
  color: ${(props) => props.theme.foregroundDark};
  text-overflow: ellipsis;
  white-space: nowrap;
`

const LogLevelPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 4;
  min-width: 190px;
  padding: 6px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background-color: ${(props) => props.theme.surfacePanel};
  box-shadow: 0 18px 36px rgba(15, 15, 25, 0.46);
`

const LogLevelAction = styled.button`
  display: block;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: ${(props) => props.theme.foreground};
  text-align: left;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background-color: ${(props) => props.theme.surfaceSelected};
  }
`

const LogLevelDivider = styled.div`
  height: 1px;
  margin: 5px 0;
  background-color: ${(props) => props.theme.borderSubtle};
`

const LogLevelOption = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 8px;
  border-radius: 3px;
  cursor: pointer;

  &:hover {
    background-color: ${(props) => props.theme.surfaceSelected};
  }

  input {
    margin: 0;
    accent-color: ${(props) => props.theme.highlight};
  }
`

const Workspace = styled.div<{ $inspectorWidth: number; $paneVisible: boolean }>`
  flex: 1;
  display: grid;
  grid-template-columns: ${(props) =>
    props.$paneVisible
      ? `minmax(0, 1fr) 7px minmax(240px, ${props.$inspectorWidth}px)`
      : "minmax(0, 1fr) 0 0"};
  width: 100%;
  max-width: 100%;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 520px) {
    grid-template-columns: ${(props) =>
      props.$paneVisible
        ? `minmax(0, 1fr) 7px minmax(220px, ${props.$inspectorWidth}px)`
        : "minmax(0, 1fr) 0 0"};
  }
`

const EmptyTableState = styled.div`
  height: calc(100% - 33px);
  min-height: 240px;
  display: flex;
`

const EventTable = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid ${(props) => props.theme.borderSubtle};
`

const SplitResizeHandle = styled.div`
  position: relative;
  min-width: 7px;
  background-color: ${(props) => props.theme.borderSubtle};
  cursor: col-resize;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background-color: ${(props) => props.theme.surfaceSelected};
  }

  &:hover {
    background-color: ${(props) => props.theme.highlight};
  }

  @media (max-width: 780px) {
    display: none;
  }
`

const TableGrid = styled.div<{ $columns: TableColumns }>`
  grid-template-columns:
    ${(props) => props.$columns.kind}px minmax(120px, 1fr)
    ${(props) => props.$columns.status}px ${(props) => props.$columns.duration}px
    ${(props) => props.$columns.time}px;
`

const TableHeader = styled(TableGrid)`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
`

const TableHeaderCell = styled.span`
  position: relative;
  min-width: 0;
`

const SortButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  cursor: pointer;

  &:hover {
    color: ${(props) => props.theme.foreground};
  }
`

const ColumnResizeHandle = styled.button`
  position: absolute;
  top: -9px;
  right: -9px;
  bottom: -9px;
  width: 9px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: col-resize;

  &:hover {
    background-color: ${(props) => props.theme.highlight};
  }
`

const EventRow = styled(TableGrid)<{ $selected: boolean; $tone: ConsoleItem["tone"] }>`
  display: grid;
  gap: 12px;
  width: 100%;
  position: relative;
  box-sizing: border-box;
  min-height: 34px;
  padding: 6px 12px;
  border: 0;
  border-bottom: 1px solid ${(props) => props.theme.line};
  border-left: 2px solid ${(props) => toneColor(props.$tone)};
  outline: 0;
  background-color: ${(props) => (props.$selected ? props.theme.surfaceSelected : "transparent")};
  color: ${(props) => props.theme.foreground};
  text-align: left;
  cursor: pointer;

  &:hover {
    background-color: ${(props) =>
      props.$selected ? props.theme.surfaceSelected : props.theme.surfacePanel};
  }

  &:hover .row-actions,
  &:focus-within .row-actions {
    opacity: 1;
  }

  &:hover .row-time,
  &:focus-within .row-time {
    visibility: hidden;
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 1px ${(props) => props.theme.highlight};
  }
`

const Chevron = styled.span<{ $open: boolean }>`
  display: inline-flex;
  flex-shrink: 0;
  color: ${(props) => props.theme.foregroundDark};
  transform: rotate(${(props) => (props.$open ? 0 : -90)}deg);
  transition: transform 100ms ease;
`

const ChevronSpacer = styled.span`
  display: inline-block;
  width: 14px;
`

const ExpandedBody = styled.div`
  grid-column: 1 / -1;
  min-width: 0;
  margin: 4px 0 2px 24px;
  padding: 8px 10px;
  border-left: 2px solid ${(props) => props.theme.line};
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  color: ${(props) => props.theme.foreground};
  font-family: ${monoFont};
  font-size: var(--reactotron-monospace-font-size, 12px);
  line-height: 20px;
  cursor: auto;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
`

const RowActions = styled.span`
  position: absolute;
  top: 50%;
  right: 10px;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 6px;
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 120ms ease;
`

const RowAction = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;

  & + & {
    border-left: 1px solid ${(props) => props.theme.borderSubtle};
  }

  &:hover {
    background-color: ${(props) => props.theme.surfaceSelected};
    color: ${(props) => props.theme.foreground};
  }
`

const CountBadge = styled.span`
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  background-color: rgba(65, 72, 104, 0.6);
  color: ${(props) => props.theme.foregroundLight};
  font-family: ${monoFont};
  font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.833);
  font-weight: 700;
  line-height: 16px;
`

const SourceChip = styled.button`
  flex-shrink: 0;
  max-width: 220px;
  overflow: hidden;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background-color: ${(props) => props.theme.surfaceSelected};
  color: ${(props) => props.theme.support};
  font-family: ${monoFont};
  font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.875);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: ${(props) => props.theme.surfaceSelected};
  }
`

const TitleLine = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`

const Method = styled.strong<{ $kind: ConsoleKind }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: ${(props) => (props.$kind === "network" ? props.theme.support : props.theme.keyword)};
  font-family: ${monoFont};
  font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.917);
  line-height: 18px;
`

const EventTitle = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: ${monoFont};

  b,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  b {
    font-size: var(--reactotron-monospace-font-size, 12px);
    font-weight: 500;
    line-height: 18px;
  }

  small {
    color: ${(props) => props.theme.foregroundDark};
    font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.875);
    line-height: 14px;
  }
`

const EndpointPath = styled.b`
  display: inline-flex;
  min-width: 0;
  overflow: hidden;
  color: ${(props) => props.theme.foregroundLight};
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EndpointSegment = styled.span<{ $tone: number }>`
  min-width: 0;
  overflow: hidden;
  color: ${(props) => endpointSegmentColor(props.$tone)};
  text-overflow: ellipsis;
`

const EndpointSlash = styled.span`
  color: ${(props) => props.theme.foregroundDark};
`

const Status = styled.i<{ $tone: ConsoleItem["tone"] }>`
  align-self: center;
  justify-self: start;
  padding: 1px 7px;
  font-family: ${monoFont};
  border-radius: 999px;
  color: ${(props) => toneColor(props.$tone)};
  background-color: rgba(65, 72, 104, 0.42);
  font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.917);
  font-style: normal;
  font-weight: 700;
`

const EmptyStatus = styled.span`
  align-self: center;
`

const Time = styled.small`
  align-self: center;
  justify-self: end;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: ${(props) => props.theme.foregroundDark};
  font-family: ${monoFont};
  font-size: calc(var(--reactotron-monospace-font-size, 12px) * 0.875);
  line-height: 14px;

  em {
    font-style: normal;
    opacity: 0.6;
  }
`

const Inspector = styled.aside`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.backgroundDarker};
`

const InspectorHeader = styled.div`
  padding: 14px 16px 12px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.background};

  @media (max-width: 560px) {
    padding: 12px 10px 10px;
  }
`

const InspectorEyebrow = styled.div`
  margin-bottom: 6px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
`

const InspectorTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: ${(props) => props.theme.foreground};
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
  }
`

const InspectorEndpoint = styled.strong`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
`

const ActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.surfacePanel};

  @media (max-width: 560px) {
    padding: 8px 10px;
  }
`

const ActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    border-color: ${(props) => props.theme.foregroundDark};
    background-color: ${(props) => props.theme.surfaceSelected};
  }
`

const Tabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 16px 0;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.background};

  @media (max-width: 560px) {
    padding: 8px 10px 0;
  }
`

const TabButton = styled.button<{ $active: boolean }>`
  flex: 0 0 auto;
  padding: 8px 10px;
  border: 0;
  border-bottom: 2px solid ${(props) => (props.$active ? props.theme.highlight : "transparent")};
  background: transparent;
  color: ${(props) => (props.$active ? props.theme.foreground : props.theme.foregroundDark)};
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
`

const ScrollPane = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 16px;
  user-select: text;

  @media (max-width: 560px) {
    padding: 10px;
  }
`

const Section = styled.section`
  margin-bottom: 18px;
`

const SectionTitle = styled.h3`
  margin: 0 0 10px;
  color: ${(props) => props.theme.bold};
  font-size: 12px;
  text-transform: uppercase;
`

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  overflow: hidden;
  user-select: text;
`

const FieldLabel = styled.div`
  padding: 8px 10px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
`

const FieldValue = styled.div`
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  color: ${(props) => props.theme.foreground};
  font-size: 12px;
  overflow-wrap: anywhere;
`

const ViewerContainer = styled.div`
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  overflow: hidden;
  user-select: text;
`

const ViewerHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.surfacePanel};
`

const ViewerTools = styled.div`
  display: flex;
  flex: 1 1 180px;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const ViewerModes = styled.div`
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
`

const ViewerSearch = styled.label`
  display: flex;
  flex: 1 1 130px;
  align-items: center;
  gap: 6px;
  min-width: 112px;
  max-width: 220px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 6px;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foregroundDark};
`

const ViewerSearchInput = styled.input`
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: ${(props) => props.theme.foreground};
  font-size: 11px;
`

const MatchCount = styled.span`
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
  white-space: nowrap;
`

const ModeButton = styled.button<{ $active: boolean }>`
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid ${(props) => (props.$active ? props.theme.highlight : props.theme.borderSubtle)};
  border-radius: 6px;
  background-color: ${(props) =>
    props.$active ? props.theme.surfaceSelected : props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 11px;
  cursor: pointer;
`

const CodeBlock = styled.pre`
  margin: 0;
  min-height: 180px;
  max-height: 520px;
  overflow: auto;
  padding: 12px;
  color: ${(props) => props.theme.foreground};
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  font-size: 12px;
  line-height: 18px;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
`

const JsonKey = styled.span`
  color: #7dcfff;
`

const JsonString = styled.span`
  color: #9ece6a;
`

const JsonNumber = styled.span`
  color: #ff9e64;
`

const JsonBoolean = styled.span`
  color: #bb9af7;
`

const JsonNull = styled.span`
  color: #bb9af7;
`

const JsonPunctuation = styled.span`
  color: #565f89;
`

const Highlight = styled.mark`
  padding: 0;
  color: inherit;
  background-color: rgba(224, 175, 104, 0.45);
`

const TreeBody = styled.div`
  min-height: 180px;
  max-height: 520px;
  overflow: auto;
  padding: 12px;
  color: ${(props) => props.theme.foreground};
  background-color: ${(props) => props.theme.backgroundSubtleDark};
  font-size: 12px;
  line-height: 20px;
  user-select: text;
`

const TreeNode = styled.div<{ $depth: number }>`
  margin-left: ${(props) => props.$depth * 14}px;
`

const TreeNodeSummary = styled.summary`
  cursor: pointer;
  list-style: disclosure-closed;

  &::-webkit-details-marker {
    color: ${(props) => props.theme.foregroundDark};
  }
`

const TreeKey = styled.span`
  color: #7dcfff;
`

const TreeIndex = styled.span`
  color: #bb9af7;
`

const TreeSummary = styled.span`
  color: #c0caf5;
`

const TreeValue = styled.span<{ $type: TreeValueType }>`
  color: ${(props) => treeValueColor[props.$type]};
`

const TreePrimitiveRow = styled.div<{ $depth: number }>`
  margin-left: ${(props) => props.$depth * 14}px;
`

const TreeMoreRow = styled.div<{ $depth: number }>`
  margin-left: ${(props) => props.$depth * 14}px;
  color: ${(props) => props.theme.foregroundDark};
`

const TreeMoreButton = styled.button`
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${(props) => props.theme.highlight};
  font: inherit;
  cursor: pointer;
  user-select: none;

  &:hover {
    color: ${(props) => props.theme.foregroundLight};
  }
`

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resizeInspector(
  event: React.MouseEvent,
  currentWidth: number,
  setInspectorWidth: React.Dispatch<React.SetStateAction<number>>
) {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = currentWidth

  const onMouseMove = (moveEvent: MouseEvent) => {
    setInspectorWidth(clamp(startWidth + startX - moveEvent.clientX, 240, 900))
  }

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }

  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"
  document.addEventListener("mousemove", onMouseMove)
  document.addEventListener("mouseup", onMouseUp)
}

function resizeTableColumn(
  event: React.MouseEvent,
  column: TableColumn,
  tableColumns: TableColumns,
  setTableColumns: React.Dispatch<React.SetStateAction<TableColumns>>
) {
  event.preventDefault()
  event.stopPropagation()

  const startX = event.clientX
  const startWidth = tableColumns[column]

  const limits: Record<TableColumn, { min: number; max: number }> = {
    kind: { min: 58, max: 150 },
    status: { min: 58, max: 130 },
    duration: { min: 68, max: 150 },
    time: { min: 62, max: 170 },
  }

  const onMouseMove = (moveEvent: MouseEvent) => {
    const nextWidth = clamp(
      startWidth + moveEvent.clientX - startX,
      limits[column].min,
      limits[column].max
    )
    setTableColumns((columns) => ({ ...columns, [column]: nextWidth }))
  }

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }

  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"
  document.addEventListener("mousemove", onMouseMove)
  document.addEventListener("mouseup", onMouseUp)
}

function Network({ title = "Network" }: { title?: string }) {
  const { clearCommands, commands } = useContext(ReactotronContext)
  const [query, setQuery] = useState("")
  const [showNetwork, setShowNetwork] = useState(true)
  const [showLogs, setShowLogs] = useState(true)
  const [isRegexSearch, setIsRegexSearch] = useState(false)
  const [logLevels, setLogLevels] = useState<LogLevelSelection>(defaultLogLevels)
  const [networkFilters, setNetworkFilters] = useState<NetworkFilters>(defaultNetworkFilters)
  const [selectedId, setSelectedId] = useState<string>("")
  const [newestFirst, setNewestFirst] = useState(true)
  const [inspectorWidth, setInspectorWidth] = useState(560)
  const [tableColumns, setTableColumns] = useState<TableColumns>(defaultTableColumns)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const toggleExpanded = useCallback((id: string, force?: boolean) => {
    setExpandedIds((current) => {
      const open = force ?? !current.has(id)
      if (open === current.has(id)) return current
      const next = new Set(current)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const items = useMemo(() => buildItems(commands), [commands])
  const networkItems = useMemo(() => items.filter((item) => item.kind === "network"), [items])
  const networkCount = useMemo(() => networkItems.length, [networkItems])
  const logCount = useMemo(() => items.filter((item) => item.kind === "log").length, [items])
  const networkFilterOptions = useMemo(
    () => buildNetworkFilterOptions(networkItems),
    [networkItems]
  )
  const activeNetworkFilters = useMemo(
    () => normalizeNetworkFilters(networkFilters, networkFilterOptions),
    [networkFilters, networkFilterOptions]
  )
  const duplicateNetworkKeys = useMemo(() => duplicateRequestKeys(networkItems), [networkItems])
  const visibleItems = useMemo(() => {
    const searchMatcher = buildSearchMatcher(query, isRegexSearch)
    const now = Date.now()
    return items
      .filter((item) => (item.kind === "network" ? showNetwork : showLogs))
      .filter(
        (item) =>
          item.kind !== "network" ||
          matchesNetworkFilters(item, activeNetworkFilters, duplicateNetworkKeys, now)
      )
      .filter((item) => item.kind !== "log" || logLevels[item.status as LogLevel])
      .filter((item) => {
        if (!searchMatcher) return true
        return searchMatcher(item.searchText)
      })
      .reduce<ConsoleItem[]>((acc, item) => {
        const previous = acc[acc.length - 1]
        if (previous && isCollapsible(previous, item)) {
          acc[acc.length - 1] = { ...item, count: previous.count + 1 }
        } else {
          acc.push(item)
        }
        return acc
      }, [])
      .sort((a, b) => (newestFirst ? b.timestamp - a.timestamp : a.timestamp - b.timestamp))
  }, [
    activeNetworkFilters,
    newestFirst,
    duplicateNetworkKeys,
    isRegexSearch,
    items,
    logLevels,
    query,
    showLogs,
    showNetwork,
  ])
  const filteredItemCount = items.length - visibleItems.length

  const selectedItem = selectedId
    ? visibleItems.find((item) => item.id === selectedId && item.kind === "network") ?? null
    : null
  const paneVisible = showNetwork

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]")
    if (!row) return
    const id = row.dataset.rowId ?? ""
    const item = visibleItems.find((entry) => entry.id === id)
    if (!item) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const sibling =
        event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling
      if (sibling instanceof HTMLElement && sibling.dataset.rowId) sibling.focus()
    } else if (event.key === "ArrowRight" && item.kind === "log") {
      event.preventDefault()
      toggleExpanded(id, true)
    } else if (event.key === "ArrowLeft" && item.kind === "log") {
      event.preventDefault()
      toggleExpanded(id, false)
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (item.kind === "network") setSelectedId(id)
      else toggleExpanded(id)
    }
  }

  return (
    <Container>
      <Header title={title} isDraggable />
      <Toolbar>
        <SearchRow>
          <SearchBox>
            <MdOutlineSearch size={16} />
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isRegexSearch
                  ? "Regex search endpoints, logs, status, hosts"
                  : "Search endpoints, logs, status, hosts"
              }
            />
          </SearchBox>
          <Toggle title="Interpret search as a regular expression">
            <input
              type="checkbox"
              checked={isRegexSearch}
              onChange={(event) => setIsRegexSearch(event.target.checked)}
            />
            Regex
          </Toggle>
          <ActionButton
            type="button"
            onClick={() => {
              clearCommands()
              setNetworkFilters(defaultNetworkFilters)
              setSelectedId("")
            }}
          >
            <MdOutlineDeleteSweep size={14} />
            Clear
          </ActionButton>
        </SearchRow>
        <FilterRow>
          <FilterGroup>
            <Toggle>
              <input
                type="checkbox"
                checked={showNetwork}
                onChange={(event) => setShowNetwork(event.target.checked)}
              />
              Network <ToggleCount>{networkCount}</ToggleCount>
            </Toggle>
            {showNetwork ? (
              <NetworkFilterControls
                filters={activeNetworkFilters}
                networkCount={networkCount}
                options={networkFilterOptions}
                setFilters={setNetworkFilters}
              />
            ) : null}
          </FilterGroup>
          <FilterGroup>
            <Toggle>
              <input
                type="checkbox"
                checked={showLogs}
                onChange={(event) => setShowLogs(event.target.checked)}
              />
              Logs <ToggleCount>{logCount}</ToggleCount>
            </Toggle>
            {showLogs ? <LogLevelFilter levels={logLevels} setLevels={setLogLevels} /> : null}
          </FilterGroup>
        </FilterRow>
      </Toolbar>
      <Workspace $inspectorWidth={inspectorWidth} $paneVisible={paneVisible}>
        <EventTable onKeyDown={handleTableKeyDown}>
          <TableHeader $columns={tableColumns}>
            <TableHeaderCell>
              Kind
              <ColumnResizeHandle
                type="button"
                title="Resize kind column"
                onMouseDown={(event) =>
                  resizeTableColumn(event, "kind", tableColumns, setTableColumns)
                }
              />
            </TableHeaderCell>
            <TableHeaderCell>Event</TableHeaderCell>
            <TableHeaderCell>
              Status
              <ColumnResizeHandle
                type="button"
                title="Resize status column"
                onMouseDown={(event) =>
                  resizeTableColumn(event, "status", tableColumns, setTableColumns)
                }
              />
            </TableHeaderCell>
            <TableHeaderCell>
              Duration
              <ColumnResizeHandle
                type="button"
                title="Resize duration column"
                onMouseDown={(event) =>
                  resizeTableColumn(event, "duration", tableColumns, setTableColumns)
                }
              />
            </TableHeaderCell>
            <TableHeaderCell>
              <SortButton
                type="button"
                title={
                  newestFirst
                    ? "Newest first — click for oldest first"
                    : "Oldest first — click for newest first"
                }
                onClick={() => setNewestFirst((value) => !value)}
              >
                Time
                {newestFirst ? (
                  <MdOutlineArrowDownward size={12} />
                ) : (
                  <MdOutlineArrowUpward size={12} />
                )}
              </SortButton>
              <ColumnResizeHandle
                type="button"
                title="Resize time column"
                onMouseDown={(event) =>
                  resizeTableColumn(event, "time", tableColumns, setTableColumns)
                }
              />
            </TableHeaderCell>
          </TableHeader>
          {visibleItems.length === 0 ? (
            <EmptyTableState>
              <EmptyState icon={MdOutlineNetworkWifi} title="No Network Activity">
                {items.length > 0 && filteredItemCount > 0
                  ? "Events are currently hidden by the active search, type, or log-level filters."
                  : "Network requests and logs will appear here once your app connects on the active Reactotron port."}
              </EmptyState>
            </EmptyTableState>
          ) : (
            visibleItems.map((item, index) => (
              <EventRow
                key={item.id}
                role="button"
                tabIndex={0}
                data-row-id={item.id}
                $columns={tableColumns}
                $selected={selectedItem?.id === item.id}
                $tone={item.tone}
                onClick={() => {
                  if (item.kind === "network") {
                    setSelectedId(item.id)
                  } else {
                    toggleExpanded(item.id)
                  }
                }}
              >
                <Method $kind={item.kind}>
                  {item.kind === "network" ? (
                    <ChevronSpacer />
                  ) : (
                    <Chevron $open={expandedIds.has(item.id)}>
                      <MdOutlineExpandMore size={14} />
                    </Chevron>
                  )}
                  {item.kind === "network" ? (
                    <MdOutlineNetworkWifi size={14} />
                  ) : (
                    <MdOutlineInsertDriveFile size={14} />
                  )}
                  {item.method}
                </Method>
                <EventTitle>
                  <TitleLine>
                    {item.source ? (
                      <SourceChip
                        as="span"
                        title={`Filter by ${item.source}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setQuery(item.source)
                        }}
                      >
                        {item.source}
                      </SourceChip>
                    ) : null}
                    {item.kind === "network" ? renderEndpointPath(item.title) : <b>{item.title}</b>}
                    {item.count > 1 ? (
                      <CountBadge title="Consecutive identical events">×{item.count}</CountBadge>
                    ) : null}
                  </TitleLine>
                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                </EventTitle>
                <RowActions className="row-actions">
                  <RowAction
                    title={item.kind === "network" ? "Copy as cURL" : "Copy log"}
                    onClick={(event) => {
                      event.stopPropagation()
                      clipboard.writeText(rowCopyText(item))
                    }}
                  >
                    <MdOutlineContentCopy size={13} />
                  </RowAction>
                </RowActions>
                {item.kind === "network" ? (
                  <Status $tone={item.tone}>{item.status}</Status>
                ) : (
                  <EmptyStatus />
                )}
                <Time>
                  {item.kind === "network" && item.duration != null
                    ? formatDuration(item.duration)
                    : ""}
                </Time>
                <Time className="row-time">
                  {item.time}
                  <em>{relativeTime(item, visibleItems[newestFirst ? index + 1 : index - 1])}</em>
                </Time>
                {item.kind === "log" && expandedIds.has(item.id) ? (
                  <ExpandedBody onClick={(event) => event.stopPropagation()}>
                    <InlineLogBody item={item} />
                  </ExpandedBody>
                ) : null}
              </EventRow>
            ))
          )}
        </EventTable>
        <SplitResizeHandle
          role="separator"
          aria-orientation="vertical"
          title="Resize inspector"
          onMouseDown={(event) => resizeInspector(event, inspectorWidth, setInspectorWidth)}
        />
        <Inspector>
          {selectedItem ? (
            <NetworkInspector item={selectedItem} />
          ) : (
            <EmptyState icon={MdOutlineNetworkWifi} title="Select A Request">
              Choose a network request to inspect it. Logs expand inline.
            </EmptyState>
          )}
        </Inspector>
      </Workspace>
    </Container>
  )
}

function LogLevelFilter({
  levels,
  setLevels,
}: {
  levels: LogLevelSelection
  setLevels: React.Dispatch<React.SetStateAction<LogLevelSelection>>
}) {
  const toggleLevel = (level: LogLevel) => {
    setLevels((current) => ({ ...current, [level]: !current[level] }))
  }

  return (
    <LogLevelMenu>
      <LogLevelSummary>
        <span>Log level</span>
        <LogLevelValue>{logLevelSelectionLabel(levels)}</LogLevelValue>
      </LogLevelSummary>
      <LogLevelPanel>
        <LogLevelAction type="button" onClick={() => setLevels(defaultLogLevels)}>
          Default
        </LogLevelAction>
        <LogLevelAction type="button" onClick={() => setLevels(verboseLogLevels)}>
          Verbose
        </LogLevelAction>
        <LogLevelDivider />
        {logLevelOptions.map((option) => (
          <LogLevelOption key={option.level}>
            <input
              type="checkbox"
              checked={levels[option.level]}
              onChange={() => toggleLevel(option.level)}
            />
            {option.label}
          </LogLevelOption>
        ))}
      </LogLevelPanel>
    </LogLevelMenu>
  )
}

function NetworkFilterControls({
  filters,
  networkCount,
  options,
  setFilters,
}: {
  filters: NetworkFilters
  networkCount: number
  options: Record<NetworkFilterKey, string[]>
  setFilters: React.Dispatch<React.SetStateAction<NetworkFilters>>
}) {
  const setFilter = (key: NetworkFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <NetworkFilterSelect
        label="Method"
        value={filters.method}
        options={options.method}
        onChange={(value) => setFilter("method", value)}
      />
      <NetworkFilterSelect
        label="Status"
        value={filters.status}
        options={options.status}
        onChange={(value) => setFilter("status", value)}
      />
      <NetworkFilterSelect
        label="Duration"
        value={filters.duration}
        options={durationFilterOptions}
        onChange={(value) => setFilter("duration", value)}
        showWhenEmpty={networkCount > 0}
      />
      <NetworkFilterSelect
        label="Type"
        value={filters.contentType}
        options={options.contentType}
        onChange={(value) => setFilter("contentType", value)}
      />
      <TimeWindowFilterSelect
        value={filters.timeWindow}
        options={timeWindowFilterOptions}
        onChange={(value) => setFilter("timeWindow", value)}
        visible={networkCount > 0}
      />
      <DuplicateFilterToggle
        value={filters.duplicate}
        onChange={(value) => setFilter("duplicate", value)}
        visible={networkCount > 0}
      />
      <NetworkFilterSelect
        label="Endpoint"
        value={filters.endpoint}
        options={options.endpoint}
        onChange={(value) => setFilter("endpoint", value)}
      />
      <NetworkFilterSelect
        label="Host"
        value={filters.host}
        options={options.host}
        onChange={(value) => setFilter("host", value)}
      />
    </>
  )
}

function NetworkFilterSelect({
  label,
  value,
  options,
  onChange,
  showWhenEmpty = false,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  showWhenEmpty?: boolean
}) {
  if (options.length === 0 && !showWhenEmpty) return null

  const selectedValue = options.includes(value) ? value : ""

  return (
    <FilterSelect
      aria-label={`Filter network requests by ${label.toLowerCase()}`}
      value={selectedValue}
      title={`Filter by ${label.toLowerCase()}`}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">All {label.toLowerCase()}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </FilterSelect>
  )
}

function TimeWindowFilterSelect({
  value,
  options,
  onChange,
  visible,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  visible: boolean
}) {
  if (!visible) return null

  const isCustom = value.startsWith("custom:")
  const selectedValue = isCustom ? "custom" : options.includes(value) ? value : ""
  const customValue = isCustom ? value.slice("custom:".length) : ""

  return (
    <>
      <FilterSelect
        aria-label="Filter network requests by time window"
        value={selectedValue}
        title="Filter by time window"
        onChange={(event) => {
          const nextValue = event.target.value
          onChange(nextValue === "custom" ? "custom:" : nextValue)
        }}
      >
        <option value="">All window</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="custom">Custom</option>
      </FilterSelect>
      {isCustom ? (
        <InlineFilterInput
          aria-label="Custom network time window"
          placeholder="45s"
          title="Use ms, s, or m. Bare numbers are seconds."
          value={customValue}
          onChange={(event) => onChange(`custom:${event.target.value}`)}
        />
      ) : null}
    </>
  )
}

function DuplicateFilterToggle({
  value,
  onChange,
  visible,
}: {
  value: string
  onChange: (value: string) => void
  visible: boolean
}) {
  if (!visible) return null

  return (
    <Toggle title="Show only repeated requests with the same method and endpoint">
      <input
        type="checkbox"
        checked={value === duplicateFilterValue}
        onChange={(event) => onChange(event.target.checked ? duplicateFilterValue : "")}
      />
      Duplicates only
    </Toggle>
  )
}

function InlineLogBody({ item }: { item: ConsoleItem }) {
  const payload = item.command.payload as LogPayload
  const args = useMemo(
    () => normalizeLogArgs(payload.message).map(normalizeLogArgument),
    [payload.message]
  )
  const bodyArgs = args.length > 1 ? args.slice(1) : args

  return (
    <>
      {bodyArgs.map((arg, index) => {
        const value = parseBody(arg.value)
        return value && typeof value === "object" ? (
          <JsonTree key={index} value={value} />
        ) : (
          <div key={index}>{formatBody(arg.value)}</div>
        )
      })}
      {"stack" in payload && payload.stack ? <div>{String(payload.stack)}</div> : null}
    </>
  )
}

function NetworkInspector({ item }: { item: ConsoleItem }) {
  const [tab, setTab] = useState<InspectorTab>("response")
  const payload = item.command.payload as ApiResponsePayload
  const request: ApiRequest = payload.request ?? {}
  const response: ApiResponse = payload.response ?? {}
  const responseCopyText = useMemo(() => formatBody(response.body), [response.body])
  const requestCopyText = useMemo(() => formatBody(request.data), [request.data])
  const curlCopyText = useMemo(() => apiRequestToCurl(payload), [payload])
  const eventCopyText = useMemo(() => JSON.stringify(item.command, null, 2), [item.command])

  return (
    <>
      <InspectorHeader>
        <InspectorEyebrow>Network request</InspectorEyebrow>
        <InspectorTitle>
          <InspectorEndpoint title={request.url}>
            {renderEndpointPath(item.title)}
          </InspectorEndpoint>
          <Status $tone={item.tone}>{item.status}</Status>
        </InspectorTitle>
      </InspectorHeader>
      <ActionBar>
        <CopyButton text={responseCopyText}>Copy response</CopyButton>
        <CopyButton text={requestCopyText}>Copy request</CopyButton>
        <CopyButton text={curlCopyText}>Copy cURL</CopyButton>
        <CopyButton text={eventCopyText}>Copy event</CopyButton>
      </ActionBar>
      <Tabs>
        {(["summary", "request", "response", "headers", "raw"] as InspectorTab[]).map((value) => (
          <TabButton
            key={value}
            type="button"
            $active={tab === value}
            onClick={() => setTab(value)}
          >
            {labelForTab(value)}
          </TabButton>
        ))}
      </Tabs>
      <ScrollPane>{renderNetworkTab(tab, payload, item.command)}</ScrollPane>
    </>
  )
}

type LogArgument = {
  value: unknown
  parsedFromString: boolean
  original: unknown
  role?: "message" | "payload" | "event" | "extra"
}

type ExpandedLogPart = {
  __reactotronLogPart: true
  role: LogArgument["role"]
  value: unknown
}

function PayloadViewer({ label, value }: { label: string; value: unknown }) {
  const [search, setSearch] = useState("")
  const parsed = useMemo(() => parseBody(value), [value])
  const [mode, setMode] = useState<BodyMode>(() =>
    parsed && typeof parsed === "object" ? "tree" : "pretty"
  )
  const prettyText = useMemo(() => formatBody(value), [value])
  const rawText = useMemo(
    () => (typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    [value]
  )
  const canTree = parsed !== undefined && parsed !== null && typeof parsed === "object"
  const visibleText = mode === "raw" ? rawText : prettyText
  const matchCount = useMemo(() => countMatches(visibleText, search), [visibleText, search])
  const treeValue = useMemo(
    () => (search && canTree ? filterJsonValue(parsed, search) : parsed),
    [canTree, parsed, search]
  )
  const codeContent = useMemo(() => renderCodeText(visibleText, search), [visibleText, search])

  return (
    <Section>
      {label ? <SectionTitle>{label}</SectionTitle> : null}
      <ViewerContainer>
        <ViewerHeader>
          <ViewerTools>
            <ViewerModes>
              <ModeButton
                type="button"
                $active={mode === "pretty"}
                onClick={() => setMode("pretty")}
              >
                Pretty
              </ModeButton>
              <ModeButton
                type="button"
                $active={mode === "tree"}
                onClick={() => setMode("tree")}
                disabled={!canTree}
              >
                Tree
              </ModeButton>
              <ModeButton type="button" $active={mode === "raw"} onClick={() => setMode("raw")}>
                Raw
              </ModeButton>
            </ViewerModes>
            <ViewerSearch>
              <MdOutlineSearch size={13} />
              <ViewerSearchInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find in JSON"
              />
            </ViewerSearch>
            {search && <MatchCount>{matchCount} matches</MatchCount>}
          </ViewerTools>
          <CopyButton text={visibleText}>Copy</CopyButton>
        </ViewerHeader>
        {mode === "tree" && canTree ? (
          <TreeBody>
            <JsonTree value={treeValue} />
          </TreeBody>
        ) : (
          <CodeBlock>{codeContent}</CodeBlock>
        )}
      </ViewerContainer>
    </Section>
  )
}

function JsonTree({ value, depth = 0, name }: { value: unknown; depth?: number; name?: string }) {
  const [open, setOpen] = useState(depth < 2)
  const [showAll, setShowAll] = useState(false)

  if (!value || typeof value !== "object") {
    return (
      <TreePrimitiveRow $depth={depth}>
        {name ? renderTreeKey(name) : null}
        <TreeValue $type={treeValueType(value)}>{formatTreePrimitive(value)}</TreeValue>
      </TreePrimitiveRow>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const visibleEntries = showAll ? entries : entries.slice(0, treePreviewLimit)
  const label = name ?? (Array.isArray(value) ? "Array" : "Object")
  const summary = Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`
  const hiddenCount = entries.length - visibleEntries.length

  return (
    <TreeNode $depth={depth}>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <TreeNodeSummary>
          {name ? renderTreeKey(label) : null}
          <TreeSummary>{summary}</TreeSummary>
        </TreeNodeSummary>
        {open
          ? visibleEntries.map(([key, item]) => (
              <JsonTree key={key} name={key} value={item} depth={depth + 1} />
            ))
          : null}
        {open && hiddenCount > 0 ? (
          <TreeMoreRow $depth={depth + 1}>
            ... {hiddenCount} more items
            <TreeMoreButton
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setShowAll(true)
              }}
            >
              show all
            </TreeMoreButton>
          </TreeMoreRow>
        ) : null}
      </details>
    </TreeNode>
  )
}

function renderTreeKey(name: string) {
  return /^\d+$/.test(name) ? <TreeIndex>{name}: </TreeIndex> : <TreeKey>{name}: </TreeKey>
}

function treeValueType(value: unknown): TreeValueType {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  return "object"
}

function formatTreePrimitive(value: unknown) {
  if (typeof value === "string") return `"${value}"`
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  return String(value)
}

function CopyButton({ text, children }: { text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)

  return (
    <ActionButton
      type="button"
      onClick={() => {
        clipboard.writeText(text ?? "")
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1100)
      }}
    >
      <MdOutlineContentCopy size={14} />
      {copied ? "Copied" : children}
    </ActionButton>
  )
}

function renderNetworkTab(tab: InspectorTab, payload: ApiResponsePayload, command: Command) {
  const request: ApiRequest = payload.request ?? {}
  const response: ApiResponse = payload.response ?? {}

  switch (tab) {
    case "summary":
      return (
        <Section>
          <SectionTitle>Summary</SectionTitle>
          <FieldTable
            rows={[
              ["URL", request.url],
              ["Method", request.method],
              ["Status", response.status],
              ["Duration", payload.duration != null ? `${payload.duration} ms` : ""],
              ["Time", formatDate(command.date)],
              ["Message ID", command.messageId],
            ]}
          />
        </Section>
      )
    case "request":
      return (
        <>
          <Section>
            <SectionTitle>Query Params</SectionTitle>
            <ContentView value={request.params ?? queryParams(request.url)} />
          </Section>
          <PayloadViewer label="Request body" value={request.data ?? ""} />
        </>
      )
    case "response":
      return <PayloadViewer label="Response body" value={response.body ?? ""} />
    case "headers":
      return (
        <>
          <Section>
            <SectionTitle>Request Headers</SectionTitle>
            <ContentView value={request.headers ?? {}} copyToClipboard={clipboard.writeText} />
          </Section>
          <Section>
            <SectionTitle>Response Headers</SectionTitle>
            <ContentView value={response.headers ?? {}} copyToClipboard={clipboard.writeText} />
          </Section>
        </>
      )
    case "raw":
      return <PayloadViewer label="Raw event" value={command} />
  }
}

function FieldTable({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <FieldGrid>
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <FieldLabel>{label}</FieldLabel>
          <FieldValue>{String(value ?? "")}</FieldValue>
        </React.Fragment>
      ))}
    </FieldGrid>
  )
}

function buildNetworkFilterOptions(items: ConsoleItem[]): Record<NetworkFilterKey, string[]> {
  const exactStatuses = uniqueSorted(items.map((item) => item.status))
  const statusFamilies = ["2xx", "3xx", "4xx", "5xx"].filter((family) =>
    items.some((item) => statusMatchesFamily(item.status, family))
  )

  return {
    method: uniqueSorted(items.map((item) => item.method)),
    status: [...statusFamilies, ...exactStatuses],
    duration: durationFilterOptions,
    contentType: uniqueSorted(items.map((item) => item.contentType)),
    timeWindow: timeWindowFilterOptions,
    duplicate: [duplicateFilterValue],
    endpoint: uniqueSorted(items.map((item) => item.title)),
    host: uniqueSorted(items.map((item) => item.subtitle)),
  }
}

function normalizeNetworkFilters(
  filters: NetworkFilters,
  options: Record<NetworkFilterKey, string[]>
): NetworkFilters {
  return {
    method: options.method.includes(filters.method) ? filters.method : "",
    status: options.status.includes(filters.status) ? filters.status : "",
    duration: options.duration.includes(filters.duration) ? filters.duration : "",
    contentType: options.contentType.includes(filters.contentType) ? filters.contentType : "",
    timeWindow:
      options.timeWindow.includes(filters.timeWindow) || filters.timeWindow.startsWith("custom:")
        ? filters.timeWindow
        : "",
    duplicate: filters.duplicate === duplicateFilterValue ? filters.duplicate : "",
    endpoint: options.endpoint.includes(filters.endpoint) ? filters.endpoint : "",
    host: options.host.includes(filters.host) ? filters.host : "",
  }
}

function matchesNetworkFilters(
  item: ConsoleItem,
  filters: NetworkFilters,
  duplicateKeys: Set<string>,
  now: number
) {
  return (
    (!filters.method || item.method === filters.method) &&
    (!filters.status ||
      item.status === filters.status ||
      statusMatchesFamily(item.status, filters.status)) &&
    (!filters.duration || matchesDurationFilter(item.duration, filters.duration)) &&
    (!filters.contentType || item.contentType === filters.contentType) &&
    (!filters.timeWindow || matchesTimeWindowFilter(item.timestamp, filters.timeWindow, now)) &&
    (!filters.duplicate || duplicateKeys.has(requestKey(item))) &&
    (!filters.endpoint || item.title === filters.endpoint) &&
    (!filters.host || item.subtitle === filters.host)
  )
}

function duplicateRequestKeys(items: ConsoleItem[]) {
  const counts = new Map<string, number>()

  items.forEach((item) => {
    const key = requestKey(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
  )
}

function requestKey(item: ConsoleItem) {
  return `${item.method} ${item.title}`
}

function statusMatchesFamily(status: string, family: string) {
  return /^[2-5]xx$/.test(family) && status.startsWith(family[0])
}

function matchesDurationFilter(duration: number | undefined, filter: string) {
  if (duration == null) return false
  if (filter === "500 ms+") return duration >= 500
  if (filter === "1 s+") return duration >= 1000
  if (filter === "3 s+") return duration >= 3000
  return true
}

function matchesTimeWindowFilter(timestamp: number, filter: string, now: number) {
  const age = now - timestamp
  if (filter === "Last 30s") return age <= 30_000
  if (filter === "Last 1m") return age <= 60_000
  if (filter === "Last 5m") return age <= 300_000
  if (filter.startsWith("custom:")) {
    const duration = parseWindowDuration(filter.slice("custom:".length))
    return duration == null ? true : age <= duration
  }
  return true
}

function parseWindowDuration(value: string) {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined

  const unit = match[2] ?? "s"
  if (unit === "ms") return amount
  if (unit === "m") return amount * 60_000
  return amount * 1000
}

function headerValue(headers: ApiRequest["headers"] | ApiResponse["headers"], name: string) {
  if (!headers) return undefined
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function contentTypeCategory(value: unknown) {
  const contentType = String(value ?? "").toLowerCase()

  if (!contentType) return ""
  if (contentType.includes("json")) return "JSON"
  if (contentType.includes("html")) return "HTML"
  if (contentType.startsWith("image/")) return "Image"
  if (contentType.startsWith("text/")) return "Text"
  if (
    contentType.includes("octet-stream") ||
    contentType.includes("application/pdf") ||
    contentType.includes("application/zip")
  ) {
    return "Binary"
  }

  return "Other"
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  )
}

function buildItems(commands: Command[]): ConsoleItem[] {
  return commands
    .filter((command) => command.type === "api.response" || command.type === "log")
    .map((command) => (command.type === "api.response" ? networkItem(command) : logItem(command)))
}

function networkItem(command: Command): ConsoleItem {
  const payload = command.payload as ApiResponsePayload
  const request: ApiRequest = payload.request ?? {}
  const response: ApiResponse = payload.response ?? {}
  const status = response.status
  const url = String(request.url ?? "")
  const contentType = contentTypeCategory(
    headerValue(response.headers, "content-type") ?? headerValue(request.headers, "content-type")
  )

  return {
    id: String(command.messageId),
    kind: "network",
    command,
    title: urlPath(url),
    subtitle: hostName(url),
    searchText: [
      request.method,
      url,
      hostName(url),
      response.status,
      payload.duration,
      contentType,
      request.headers,
      request.data,
      response.headers,
      response.body,
    ]
      .map(searchableText)
      .join(" "),
    method: String(request.method ?? "HTTP").toUpperCase(),
    status: status == null ? "pending" : String(status),
    contentType,
    tone: toneForStatus(status),
    time: formatTime(command.date),
    duration: payload.duration,
    timestamp: command.date.getTime(),
    source: "",
    count: 1,
  }
}

function logItem(command: Command): ConsoleItem {
  const payload = command.payload as LogPayload
  const level = payload?.level ?? "log"
  const message = payload?.message
  const { source, title } = splitLogSource(formatLogPreview(message))
  const subtitle = formatLogSubtitlePreview(message)

  return {
    id: String(command.messageId),
    kind: "log",
    command,
    title,
    subtitle,
    searchText: [
      displayLogLevel(level),
      normalizeLogLevel(level),
      source,
      title,
      subtitle,
      message,
      "stack" in payload ? payload.stack : "",
    ]
      .map(searchableText)
      .join(" "),
    method: displayLogLevel(level),
    status: normalizeLogLevel(level),
    contentType: "",
    tone: toneForLogLevel(level),
    time: formatTime(command.date),
    timestamp: command.date.getTime(),
    source,
    count: 1,
  }
}

// "MqttClusterManager [slc1] - _dispatchMessage - received ..." => chip + message
function splitLogSource(title: string) {
  const match = /^([A-Za-z_$][\w$]*(?:\s*\[[^\]]*\])?)\s+[-–—:]\s+(.+)$/s.exec(title)
  if (!match) return { source: "", title }
  return { source: match[1].replace(/\s+/g, " "), title: match[2] }
}

function isCollapsible(previous: ConsoleItem, next: ConsoleItem) {
  return (
    previous.kind === "log" &&
    next.kind === "log" &&
    previous.status === next.status &&
    previous.source === next.source &&
    previous.title === next.title &&
    previous.subtitle === next.subtitle
  )
}

function relativeTime(item: ConsoleItem, previous?: ConsoleItem) {
  if (!previous) return ""
  const delta = item.timestamp - previous.timestamp
  if (!Number.isFinite(delta) || delta === 0) return "+0ms"
  const sign = delta > 0 ? "+" : "-"
  const abs = Math.abs(delta)
  if (abs < 1000) return `${sign}${abs}ms`
  if (abs < 60000) return `${sign}${(abs / 1000).toFixed(1)}s`
  return `${sign}${Math.round(abs / 60000)}m`
}

function rowCopyText(item: ConsoleItem) {
  if (item.kind === "network") return apiRequestToCurl(item.command.payload as ApiResponsePayload)
  const payload = item.command.payload as LogPayload
  return formatLogForCopy(normalizeLogArgs(payload.message).map(normalizeLogArgument))
}

function labelForTab(tab: InspectorTab) {
  switch (tab) {
    case "summary":
      return "Summary"
    case "request":
      return "Request"
    case "response":
      return "Response"
    case "headers":
      return "Headers"
    case "raw":
      return "Raw"
  }
}

function toneForStatus(status: unknown): ConsoleItem["tone"] {
  const code = Number(status)
  if (!Number.isFinite(code)) return "muted"
  if (code >= 500) return "bad"
  if (code >= 400) return "warn"
  if (code >= 300) return "redirect"
  if (code >= 200) return "good"
  return "muted"
}

function toneForLogLevel(level: unknown): ConsoleItem["tone"] {
  const text = normalizeLogLevel(level)
  if (text === "error") return "bad"
  if (text === "warn") return "warn"
  return "muted"
}

function normalizeLogLevel(level: unknown): LogLevel {
  const text = String(level ?? "").toLowerCase()
  if (text === "error") return "error"
  if (text === "warn" || text === "warning") return "warn"
  if (text === "info" || text === "log") return "info"
  return "debug"
}

function displayLogLevel(level: unknown) {
  const normalized = normalizeLogLevel(level)
  if (normalized === "debug") return "DEBUG"
  if (normalized === "info") return "INFO"
  if (normalized === "warn") return "WARN"
  return "ERROR"
}

function logLevelSelectionLabel(levels: LogLevelSelection) {
  if (logLevelSelectionsEqual(levels, defaultLogLevels)) return "Default"
  if (logLevelSelectionsEqual(levels, verboseLogLevels)) return "Verbose"

  const selected = logLevelOptions
    .filter((option) => levels[option.level])
    .map((option) => option.label)

  return selected.length > 0 ? selected.join(", ") : "None"
}

function logLevelSelectionsEqual(left: LogLevelSelection, right: LogLevelSelection) {
  return logLevelOptions.every((option) => left[option.level] === right[option.level])
}

function normalizeLogArgs(message: unknown) {
  const value = unwrapSerializedLogMessage(message)
  const args = Array.isArray(value) ? value : [value]
  return args.flatMap(expandEmbeddedJsonArgument)
}

function expandEmbeddedJsonArgument(value: unknown): unknown[] {
  if (typeof value !== "string") return [value]

  const embedded = extractEmbeddedJson(value)
  if (!embedded) return [value]

  const parts: unknown[] = []
  const messageText = `${embedded.before} ${embedded.after}`.trim()
  if (messageText) parts.push({ __reactotronLogPart: true, role: "message", value: messageText })
  parts.push({ __reactotronLogPart: true, role: "payload", value: embedded.value })

  return parts
}

function normalizeLogArgument(value: unknown): LogArgument {
  if (
    value &&
    typeof value === "object" &&
    "__reactotronLogPart" in value &&
    (value as { __reactotronLogPart?: unknown }).__reactotronLogPart === true &&
    "role" in value &&
    "value" in value &&
    isLogArgumentRole((value as { role?: unknown }).role)
  ) {
    const expanded = value as ExpandedLogPart
    return {
      value: expanded.value,
      parsedFromString: true,
      original: value,
      role: expanded.role,
    }
  }

  if (typeof value !== "string") {
    return { value, parsedFromString: false, original: value }
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return { value, parsedFromString: false, original: value }
  }

  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return { value, parsedFromString: false, original: value }
  }

  try {
    return { value: JSON.parse(trimmed), parsedFromString: true, original: value }
  } catch {
    return { value, parsedFromString: false, original: value }
  }
}

function isLogArgumentRole(value: unknown): value is LogArgument["role"] {
  return value === "message" || value === "payload" || value === "event" || value === "extra"
}

function extractEmbeddedJson(text: string):
  | {
      before: string
      after: string
      value: unknown
    }
  | undefined {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== "{" && char !== "[") continue

    const end = findJsonEnd(text, index)
    if (end === -1) continue

    const candidate = text.slice(index, end + 1)
    try {
      return {
        before: text.slice(0, index).trim(),
        after: text.slice(end + 1).trim(),
        value: JSON.parse(candidate),
      }
    } catch {
      continue
    }
  }

  return undefined
}

function findJsonEnd(text: string, start: number) {
  const opening = text[start]
  const closing = opening === "{" ? "}" : "]"
  const stack = [closing]
  let inString = false
  let escaped = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]")
      continue
    }

    if (char === "}" || char === "]") {
      if (char !== stack[stack.length - 1]) return -1
      stack.pop()
      if (stack.length === 0) return index
    }
  }

  return -1
}

function formatLogForCopy(args: LogArgument[]) {
  return args.map((arg) => formatBody(arg.value)).join(" ")
}

function unwrapSerializedLogMessage(message: unknown): unknown {
  if (typeof message !== "string") return message

  const trimmed = message.trim()
  if (!trimmed) return message

  try {
    return JSON.parse(trimmed)
  } catch {
    return message
  }
}

function formatLogPreview(message: unknown) {
  const value = Array.isArray(message) ? message[0] : message

  if (typeof value === "string") return value.slice(0, 500)
  if (value instanceof Error) return value.message.slice(0, 500)

  return formatCompactLogValue(value).slice(0, 500)
}

function formatLogSubtitlePreview(message: unknown) {
  if (!Array.isArray(message) || message.length <= 1) return ""

  return message
    .slice(1, 4)
    .map((item) => formatCompactLogValue(item))
    .filter(Boolean)
    .join(" | ")
}

function formatCompactLogValue(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  if (Array.isArray(value)) return `Array(${value.length})`
  if (value && typeof value === "object") {
    try {
      const json = JSON.stringify(value)
      return json.length > 160 ? `${json.slice(0, 160)}…` : json
    } catch {
      return `{ ${Object.keys(value).slice(0, 4).join(", ")} }`
    }
  }
  return String(value)
}

function toneColor(tone: ConsoleItem["tone"]) {
  switch (tone) {
    case "good":
      return "#7aa2f7"
    case "warn":
      return "#bb9af7"
    case "bad":
      return "#bb9af7"
    case "redirect":
      return "#7dcfff"
    default:
      return "#565f89"
  }
}

function endpointSegmentColor(index: number) {
  const colors = ["#7dcfff", "#7aa2f7", "#bb9af7", "#9ece6a", "#c0caf5"]
  return colors[index % colors.length]
}

function renderEndpointPath(path: string) {
  const [pathname, query] = path.split("?")
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) {
    return <EndpointPath>{path}</EndpointPath>
  }

  return (
    <EndpointPath>
      {pathname.startsWith("/") ? <EndpointSlash>/</EndpointSlash> : null}
      {segments.map((segment, index) => (
        <React.Fragment key={`${segment}-${index}`}>
          {index > 0 ? <EndpointSlash>/</EndpointSlash> : null}
          <EndpointSegment $tone={index}>{segment}</EndpointSegment>
        </React.Fragment>
      ))}
      {query ? (
        <>
          <EndpointSlash>?</EndpointSlash>
          <EndpointSegment $tone={segments.length}>{query}</EndpointSegment>
        </>
      ) : null}
    </EndpointPath>
  )
}

function urlPath(value: string) {
  if (!value) return "Network request"
  try {
    const url = new URL(value)
    return `${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function hostName(value: string) {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function queryParams(value: unknown) {
  try {
    const url = new URL(String(value ?? ""))
    return Object.fromEntries(url.searchParams.entries())
  } catch {
    return {}
  }
}

function parseBody(value: unknown) {
  if (value === null || value === undefined) return value
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function formatBody(value: unknown) {
  const parsed = parseBody(value)
  if (parsed !== undefined) {
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)
  }
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function searchableText(value: unknown) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.message} ${value.stack ?? ""}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildSearchMatcher(search: string, isRegexSearch: boolean) {
  const needle = search.trim()
  if (!needle) return null

  if (isRegexSearch) {
    try {
      const regex = new RegExp(needle, "i")
      return (value: string) => regex.test(value)
    } catch {
      const wildcardRegex = wildcardSearchRegex(needle)
      if (!wildcardRegex) return () => false
      return (value: string) => wildcardRegex.test(value)
    }
  }

  const regexMatch = needle.match(/^\/(.+)\/([dgimsuvy]*)$/)
  if (regexMatch) {
    try {
      const flags = regexMatch[2].includes("i") ? regexMatch[2] : `${regexMatch[2]}i`
      const regex = new RegExp(regexMatch[1], flags)
      return (value: string) => regex.test(value)
    } catch {
      return () => false
    }
  }

  const lowerNeedle = needle.toLowerCase()
  return (value: string) => value.toLowerCase().includes(lowerNeedle)
}

function wildcardSearchRegex(search: string) {
  if (!search.includes("*")) return null

  const pattern = search
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")

  try {
    return new RegExp(pattern, "i")
  } catch {
    return null
  }
}

function formatDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""))
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ""
}

function formatTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""))
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : ""
}

function formatDuration(value: unknown) {
  const duration = Number(value)
  if (!Number.isFinite(duration)) return ""
  if (duration < 10) return `${duration.toFixed(1)} ms`
  return `${Math.round(duration)} ms`
}

function apiRequestToCurl(payload: Partial<ApiResponsePayload> = {}) {
  const output = []
  const request: ApiRequest = payload.request || {}
  const { method, headers, data, url } = request

  if (method === "GET") {
    output.push("curl")
  } else {
    output.push(`curl -X ${method || "GET"} `)
  }

  for (const header in headers) {
    output.push(` -H "${header}:${headers[header]}"`)
  }

  output.push(` ${url || ""}`)

  if (data) {
    output.push(` -d '${compactBody(data)}'`)
  }

  return output.join("")
}

function compactBody(value: unknown) {
  if (typeof value !== "string") return JSON.stringify(value)
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return value
  }
}

function countMatches(text: string, search: string) {
  const needle = search.trim().toLowerCase()
  if (!needle) return 0

  let count = 0
  let index = 0
  const haystack = text.toLowerCase()

  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++
    index += needle.length
  }

  return count
}

function renderCodeText(text: string, search: string) {
  const tokenPattern =
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b|([{}[\],:])/g
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(
        renderSearchHighlightedText(text.slice(cursor, match.index), search, `plain-${cursor}`)
      )
    }

    const token = match[0]
    const key = `${match.index}-${token}`
    const content = renderSearchHighlightedText(token, search, key)

    if (match[1]) {
      nodes.push(<JsonKey key={key}>{content}</JsonKey>)
    } else if (match[2]) {
      nodes.push(<JsonString key={key}>{content}</JsonString>)
    } else if (match[3]) {
      nodes.push(<JsonNumber key={key}>{content}</JsonNumber>)
    } else if (match[4]) {
      nodes.push(<JsonBoolean key={key}>{content}</JsonBoolean>)
    } else if (token === "null") {
      nodes.push(<JsonNull key={key}>{content}</JsonNull>)
    } else {
      nodes.push(<JsonPunctuation key={key}>{content}</JsonPunctuation>)
    }

    cursor = match.index + token.length
  }

  if (cursor < text.length) {
    nodes.push(renderSearchHighlightedText(text.slice(cursor), search, `plain-${cursor}`))
  }

  return nodes
}

function renderSearchHighlightedText(text: string, search: string, keyPrefix: string): ReactNode {
  const needle = search.trim()
  if (!needle) return text

  const lowerText = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = lowerText.indexOf(lowerNeedle)

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex))
    }

    const end = matchIndex + needle.length
    parts.push(
      <Highlight key={`${keyPrefix}-${matchIndex}-${end}`}>{text.slice(matchIndex, end)}</Highlight>
    )
    cursor = end
    matchIndex = lowerText.indexOf(lowerNeedle, cursor)
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts
}

export default Network
