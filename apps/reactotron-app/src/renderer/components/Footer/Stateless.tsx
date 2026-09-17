import React from "react"
import styled from "styled-components"
import {
  MdOutlineReplay as ReloadIcon,
  MdOutlineRefresh as RefreshIcon,
  MdOutlineSecurity as ShieldIcon,
  MdOutlineSettings as SettingsIcon,
  MdOutlineSwapVert as ExpandIcon,
} from "react-icons/md"

import { getConfiguredServerPort } from "../../config"
import {
  getPlatformName,
  getPlatformDetails,
  getConnectionName,
} from "../../util/connectionHelpers"
import { Connection, ServerStatus } from "../../contexts/Standalone/useStandalone"
import { McpStatus } from "../../contexts/Standalone"
import ConnectionSelector from "../ConnectionSelector"

const Container = styled.div`
  border-top: 1px solid ${(props) => props.theme.borderSubtle};
  color: ${(props) => props.theme.foregroundDark};
  box-shadow: 0 0 30px ${(props) => props.theme.glow};
  color: ${(props) => props.theme.foregroundLight};
`

const ConnectionContainer = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  height: 85px;
  align-items: center;
`

interface ContentContainerProps {
  $isOpen: boolean
}
const ContentContainer = styled.div.attrs(() => ({}))<ContentContainerProps>`
  position: relative;
  display: flex;
  flex-direction: row;
  background-color: ${(props) => props.theme.surfaceStatus};
  padding: 0 350px 0 12px;
  justify-content: space-between;
  align-items: center;
  cursor: ${(props) => (props.$isOpen ? "auto" : "pointer")};
  height: ${(props) => (props.$isOpen ? "88px" : "28px")};
  box-sizing: border-box;
`

const CollapsedSummary = styled.div`
  display: grid;
  grid-template-columns: minmax(155px, 1fr) minmax(0, 1.4fr) minmax(155px, 1fr);
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
`

const ConnectionInfo = styled.div`
  text-align: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StatusInfo = styled(ConnectionInfo)`
  text-align: left;
  color: ${(props) => props.theme.foreground};
`

const PrimaryConnectionInfo = styled(ConnectionInfo)`
  color: ${(props) => props.theme.foregroundLight};
  font-weight: 600;
`

const ReloadButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: ${(props) => props.theme.foreground};
    background-color: ${(props) => `color-mix(in srgb, ${props.theme.highlight} 8%, transparent)`};
  }
`

const ExpandContainer = styled.div`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${(props) => `color-mix(in srgb, ${props.theme.highlight} 8%, transparent)`};
  }
`

interface McpButtonProps {
  $active: boolean
}

const FooterControls = styled.div`
  position: absolute;
  right: 32px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
`

const McpButton = styled.div.attrs(() => ({}))<McpButtonProps>`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  user-select: none;
  box-sizing: border-box;
  background-color: ${(props) =>
    props.$active
      ? `color-mix(in srgb, ${props.theme.highlight} 14%, transparent)`
      : "transparent"};
  border: 1px solid
    ${(props) =>
      props.$active
        ? `color-mix(in srgb, ${props.theme.highlight} 40%, transparent)`
        : props.theme.borderSubtle};
  color: ${(props) => (props.$active ? props.theme.highlight : props.theme.foregroundDark)};
  &:hover {
    background-color: ${(props) =>
      props.$active
        ? `color-mix(in srgb, ${props.theme.highlight} 22%, transparent)`
        : `color-mix(in srgb, ${props.theme.highlight} 8%, transparent)`};
  }
`

const McpDot = styled.div<McpButtonProps>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$active ? props.theme.support : props.theme.foregroundDark};
`

const McpSettingsButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: ${(props) => props.theme.foregroundDark};
  &:hover {
    color: ${(props) => props.theme.foreground};
    background-color: ${(props) => `color-mix(in srgb, ${props.theme.highlight} 8%, transparent)`};
  }
`

const RedactionBadge = styled.span<{ $warning?: boolean }>`
  display: flex;
  align-items: center;
  color: ${(props) => (props.$warning ? props.theme.warning : "inherit")};
`

function renderExpanded(
  serverStatus: ServerStatus,
  connections: Connection[],
  selectedConnection: Connection | null,
  onChangeConnection: (clientId: string | null) => void
) {
  return (
    <ConnectionContainer>
      {connections
        .filter((connection) => connection.connected)
        .map((c) => (
          <ConnectionSelector
            key={c.id}
            selectedConnection={selectedConnection}
            connection={c}
            onClick={() => onChangeConnection(c.clientId)}
          />
        ))}
    </ConnectionContainer>
  )
}

function renderConnectionInfo(selectedConnection) {
  return selectedConnection
    ? `${getConnectionName(selectedConnection)} | ${getPlatformName(
        selectedConnection
      )} ${getPlatformDetails(selectedConnection)}`
    : "Waiting for connection"
}

function renderCollapsed(
  serverStatus: ServerStatus,
  connections: Connection[],
  selectedConnection: Connection | null
) {
  const connectionText =
    serverStatus === "started"
      ? renderConnectionInfo(selectedConnection)
      : serverStatus === "portUnavailable"
        ? `Port ${getConfiguredServerPort()} unavailable.`
        : "Waiting for server to start"

  return (
    <CollapsedSummary>
      <StatusInfo>
        port {getConfiguredServerPort()} |{" "}
        {connections.filter((connection) => connection.connected).length} connections
      </StatusInfo>
      <PrimaryConnectionInfo>{connectionText}</PrimaryConnectionInfo>
      <div />
    </CollapsedSummary>
  )
}

interface Props {
  serverStatus: ServerStatus
  connections: Connection[]
  selectedConnection: Connection | null
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  onChangeConnection: (clientId: string | null) => void
  onRefreshConnections: () => void
  mcpStatus: McpStatus
  mcpPort: number | null
  onToggleMcp: () => void
  mcpRedactionEnforced: boolean
  onOpenMcpSettings: () => void
  onReloadMetro: () => void
}

function Header({
  serverStatus,
  connections,
  selectedConnection,
  isOpen,
  setIsOpen,
  onChangeConnection,
  onRefreshConnections,
  mcpStatus,
  mcpPort,
  onToggleMcp,
  mcpRedactionEnforced,
  onOpenMcpSettings,
  onReloadMetro,
}: Props) {
  return (
    <Container>
      <ContentContainer onClick={() => !isOpen && setIsOpen(true)} $isOpen={isOpen}>
        {isOpen
          ? renderExpanded(serverStatus, connections, selectedConnection, onChangeConnection)
          : renderCollapsed(serverStatus, connections, selectedConnection)}
        <FooterControls>
          {serverStatus === "started" && (
            <ReloadButton
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRefreshConnections()
              }}
              title="Refresh connected devices"
            >
              <RefreshIcon size={12} />
              Refresh devices
            </ReloadButton>
          )}
          {serverStatus === "started" && (
            <ReloadButton
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onReloadMetro()
              }}
              title="Reload React Native apps connected to Metro"
            >
              <ReloadIcon size={12} />
              Reload Metro
            </ReloadButton>
          )}
          <McpButton
            $active={mcpStatus === "started"}
            onClick={(e) => {
              e.stopPropagation()
              onToggleMcp()
            }}
            title={mcpStatus === "started" ? `MCP running on port ${mcpPort}` : "Start MCP server"}
          >
            <McpDot $active={mcpStatus === "started"} />
            {mcpStatus === "started" ? `MCP :${mcpPort}` : "MCP"}
            {mcpStatus === "started" &&
              (mcpRedactionEnforced ? (
                <RedactionBadge title="Sensitive data is redacted">
                  <ShieldIcon size={10} />
                </RedactionBadge>
              ) : (
                <RedactionBadge $warning title="Redaction disabled — sensitive data exposed">
                  <ShieldIcon size={10} />
                </RedactionBadge>
              ))}
          </McpButton>
          {mcpStatus === "started" && (
            <McpSettingsButton
              onClick={(e) => {
                e.stopPropagation()
                onOpenMcpSettings()
              }}
              title="MCP redaction settings"
            >
              <SettingsIcon size={14} />
            </McpSettingsButton>
          )}
        </FooterControls>
        <ExpandContainer onClick={() => setIsOpen(!isOpen)}>
          <ExpandIcon size={18} />
        </ExpandContainer>
      </ContentContainer>
    </Container>
  )
}

export default Header
