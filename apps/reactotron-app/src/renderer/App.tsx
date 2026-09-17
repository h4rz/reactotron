import React, { useContext, useState } from "react"
import { HashRouter as Router, Route, Routes } from "react-router-dom"
import { LuPanelRight } from "react-icons/lu"
import styled from "styled-components"

import SideBar from "./components/SideBar"
import Footer from "./components/Footer"
import DeviceSurface from "./components/DeviceSurface"
import AppPreferencesContext from "./contexts/AppPreferences"
import RootContextProvider from "./contexts"
import RootModals from "./RootModals"

import Home from "./pages/home"
import Timeline from "./pages/timeline"
import Network from "./pages/network"
import Subscriptions from "./pages/state/Subscriptions"
import Snapshots from "./pages/state/Snapshots"
import Overlay from "./pages/reactNative/Overlay"
import Storybook from "./pages/reactNative/Storybook"
import CustomCommands from "./pages/customCommands"
import Settings from "./pages/settings"
import Help from "./pages/help"

const AppContainer = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.background};
`

const TopSection = styled.div`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-grow: 1;
  flex-direction: row;
`

const MainContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex: 1;
  min-width: 350px;
`

const PanelToggle = styled.button<{ $isOpen: boolean }>`
  position: absolute;
  z-index: 3;
  top: 10px;
  right: 10px;
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: ${(props) => (props.$isOpen ? props.theme.surfaceRaised : "transparent")};
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;
  -webkit-app-region: no-drag;

  &:hover {
    color: ${(props) => props.theme.foreground};
  }
`

function TimelineRoute() {
  const { enableNewTimeline } = useContext(AppPreferencesContext)

  return enableNewTimeline ? <Network title="Timeline" /> : <Timeline />
}

function App() {
  const [isDeviceSurfaceOpen, setIsDeviceSurfaceOpen] = useState(true)

  return (
    <Router>
      <RootContextProvider>
        <AppContainer>
          <TopSection>
            <SideBar />

            <MainContainer>
              <Routes>
                {/* Home */}
                <Route path="/" element={<Home />} />

                {/* Timeline */}
                <Route path="/timeline" element={<TimelineRoute />} />

                {/* Network */}
                <Route path="/network" element={<Network />} />

                {/* State */}
                <Route path="/state/subscriptions" element={<Subscriptions />} />
                <Route path="/state/snapshots" element={<Snapshots />} />

                {/* React Native */}
                <Route path="/native/overlay" element={<Overlay />} />
                <Route path="/native/storybook" element={<Storybook />} />

                {/* Custom Commands */}
                <Route path="/customCommands" element={<CustomCommands />} />

                {/* Settings */}
                <Route path="/settings" element={<Settings />} />

                {/* Help */}
                <Route path="/help" element={<Help />} />
              </Routes>
            </MainContainer>
            <DeviceSurface isOpen={isDeviceSurfaceOpen} />
            <PanelToggle
              type="button"
              $isOpen={isDeviceSurfaceOpen}
              title={isDeviceSurfaceOpen ? "Hide simulator panel" : "Show simulator panel"}
              aria-label={isDeviceSurfaceOpen ? "Hide simulator panel" : "Show simulator panel"}
              aria-pressed={isDeviceSurfaceOpen}
              onClick={() => setIsDeviceSurfaceOpen((isOpen) => !isOpen)}
            >
              <LuPanelRight size={18} />
            </PanelToggle>
          </TopSection>
          <Footer />
        </AppContainer>
        <RootModals />
      </RootContextProvider>
    </Router>
  )
}

export default App
