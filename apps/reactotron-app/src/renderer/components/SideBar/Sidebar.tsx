import React from "react"
import {
  MdOutlineAssignment,
  MdOutlineAutoFixHigh,
  MdOutlineChevronLeft,
  MdOutlineChevronRight,
  MdOutlineHelpOutline,
  MdOutlineHome,
  MdOutlineMobileOff,
  MdOutlinePhoneIphone,
  MdOutlinePhonelinkSetup,
  MdOutlineSettings,
  MdOutlineTimeline,
  MdOutlineWarningAmber,
} from "react-icons/md"
import styled from "styled-components"

import SideBarButton from "../SideBarButton"
import { ServerStatus } from "../../contexts/Standalone/useStandalone"
import { getConfiguredServerPort } from "../../config"
import type { SideBarMode } from "../../contexts/Layout/useLayout"

interface SideBarContainerProps {
  $mode: SideBarMode
}
const SideBarContainer = styled.div.attrs(() => ({}))<SideBarContainerProps>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: ${(props) => (props.$mode === "compact" ? 10 : 14)}px;
  background-color: ${(props) => props.theme.surfaceChrome};
  border-right: 1px solid ${(props) => props.theme.borderSubtle};
  width: ${(props) => (props.$mode === "compact" ? 54 : 104)}px;
  flex: 0 0 ${(props) => (props.$mode === "compact" ? 54 : 104)}px;
  transition:
    flex-basis 0.16s ease-out,
    width 0.16s ease-out;
  overflow: hidden;
`

const Spacer = styled.div`
  flex: 1;
`

const SideBarTools = styled.div<{ $isCompact: boolean }>`
  display: flex;
  flex-direction: ${(props) => (props.$isCompact ? "column" : "row")};
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 0 8px;
`

const SideBarToolButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid ${(props) => props.theme.line};
  border-radius: 7px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;

  &:hover {
    color: ${(props) => props.theme.foreground};
    border-color: ${(props) => props.theme.borderSubtle};
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`

function SideBar({
  mode,
  onToggleCompact,
  onRestartServer,
  serverStatus,
}: {
  mode: SideBarMode
  onToggleCompact: () => void
  onRestartServer: () => void
  serverStatus: ServerStatus
}) {
  const isCompact = mode === "compact"
  let serverIcon = MdOutlineMobileOff
  let iconColor
  let serverText = "Stopped"
  if (serverStatus === "started") {
    serverIcon = MdOutlinePhonelinkSetup
    serverText = "Running"
  }
  if (serverStatus === "portUnavailable") {
    serverIcon = MdOutlineWarningAmber
    iconColor = "#bb9af7"
    serverText = `Retry port ${getConfiguredServerPort()}`
  }

  const retryConnection = () => {
    if (serverStatus === "portUnavailable") {
      onRestartServer()
    }
  }

  return (
    <SideBarContainer $mode={mode}>
      <SideBarTools $isCompact={isCompact}>
        <SideBarToolButton
          type="button"
          title={isCompact ? "Expand sidebar" : "Compact sidebar"}
          onClick={onToggleCompact}
        >
          {isCompact ? <MdOutlineChevronRight size={18} /> : <MdOutlineChevronLeft size={18} />}
        </SideBarToolButton>
      </SideBarTools>

      <SideBarButton icon={MdOutlineHome} path="/" text="Home" hideTopBar isCompact={isCompact} />
      <SideBarButton
        icon={MdOutlineTimeline}
        path="/timeline"
        text="Timeline"
        isCompact={isCompact}
      />
      <SideBarButton
        icon={MdOutlineAssignment}
        path="/state/subscriptions"
        matchPath="/state"
        text="State"
        isCompact={isCompact}
      />
      <SideBarButton
        icon={MdOutlinePhoneIphone}
        path="/native/overlay"
        matchPath="/native"
        text="React Native"
        isCompact={isCompact}
      />
      <SideBarButton
        icon={MdOutlineAutoFixHigh}
        path="/customCommands"
        text="Custom Commands"
        isCompact={isCompact}
      />

      <Spacer />

      <SideBarButton
        icon={serverIcon}
        path="#"
        onPress={retryConnection}
        text={serverText}
        iconColor={iconColor}
        isCompact={isCompact}
      />

      <SideBarButton
        icon={MdOutlineSettings}
        path="/settings"
        text="Settings"
        hideTopBar
        isCompact={isCompact}
      />

      <SideBarButton
        icon={MdOutlineHelpOutline}
        path="/help"
        text="Help"
        hideTopBar
        isCompact={isCompact}
      />
    </SideBarContainer>
  )
}

export default SideBar
