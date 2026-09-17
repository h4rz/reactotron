import React, { useContext, useMemo } from "react"
import { GlobalHotKeys } from "react-hotkeys"
import { ReactotronContext, StateContext, TimelineContext } from "@hurajgor/reactotron-core-ui"
import LayoutContext from "./contexts/Layout"
import { createKeyMap, deviceCommandEvent, type DeviceCommand, useKeybindings } from "./keybindings"

function KeybindHandler({ children }) {
  const { toggleSideBar } = useContext(LayoutContext)
  const { openDispatchModal, openSubscriptionModal, clearCommands } = useContext(ReactotronContext)
  const { openSearch, toggleSearch } = useContext(TimelineContext)
  const { createSnapshot } = useContext(StateContext)
  const { bindings } = useKeybindings()
  const keyMap = useMemo(() => createKeyMap(bindings), [bindings])

  const runDeviceCommand = (command: DeviceCommand) => {
    window.dispatchEvent(new CustomEvent(deviceCommandEvent, { detail: command }))
  }

  const handlers = {
    // Tab Navigation
    OpenHomeTab: () => {
      window.location.hash = "/"
    },
    OpenTimelineTab: () => {
      window.location.hash = "/timeline"
    },
    OpenStateTab: () => {
      window.location.hash = "/state/subscriptions"
    },
    OpenReactNativeTab: () => {
      window.location.hash = "/native/overlay"
    },
    OpenCustomCommandsTab: () => {
      window.location.hash = "/customCommands"
    },
    OpenSettingsTab: () => {
      window.location.hash = "/settings"
    },
    OpenHelpTab: () => {
      window.location.hash = "/help"
    },

    // Modals
    // OpenFindKeysValuesModal: () => {
    //   throw new Error("Implement Me!")
    // },
    OpenSubscriptionModal: () => {
      openSubscriptionModal()
    },
    OpenDispatchModal: () => {
      openDispatchModal("")
    },
    TakeSnapshot: () => {
      createSnapshot()
    },

    // Miscellaneous
    ToggleSidebar: () => {
      toggleSideBar()
    },
    ToggleSearch: () => {
      // If we're on the timeline page, toggle the search, otherwise switch to the timeline tab and open search
      if (window.location.hash === "#/") {
        toggleSearch()
      } else {
        openSearch()
        handlers.OpenTimelineTab()
      }
    },
    ClearTimeline: () => {
      clearCommands()
    },
    DeviceHome: () => runDeviceCommand("home"),
    DeviceBack: () => runDeviceCommand("back"),
    DeviceRecents: () => runDeviceCommand("recents"),
    DeviceReload: () => runDeviceCommand("reload"),
    DeviceReconnect: () => runDeviceCommand("reconnect"),
    DeviceRotate: () => runDeviceCommand("rotate"),
    DeviceScreenshot: () => runDeviceCommand("screenshot"),
    DeviceRecord: () => runDeviceCommand("record"),
    DeviceAppearance: () => runDeviceCommand("appearance"),
  }

  return (
    <GlobalHotKeys keyMap={keyMap as any} handlers={handlers} allowChanges>
      {children}
    </GlobalHotKeys>
  )
}

export default KeybindHandler
