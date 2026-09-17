import "v8-compile-cache"
import React, { useContext, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { ReactotronAppProvider } from "@hurajgor/reactotron-core-ui"

import "./global.css"

import App from "./App"
import AppPreferencesContext, {
  AppPreferencesProvider,
  TypographyPreferencesContext,
} from "./contexts/AppPreferences"
import { applyTypographyVariables } from "./typography"

function ThemedApp() {
  const { themeMode } = useContext(AppPreferencesContext)

  return (
    <ReactotronAppProvider themeName={themeMode}>
      <App />
    </ReactotronAppProvider>
  )
}

function TypographyAppearanceSync() {
  const preferences = useContext(TypographyPreferencesContext)

  useEffect(() => {
    applyTypographyVariables(document.documentElement, preferences)
  }, [preferences])

  return null
}

const root = createRoot(document.getElementById("app"))
root.render(
  <AppPreferencesProvider>
    <TypographyAppearanceSync />
    <ThemedApp />
  </AppPreferencesProvider>
)

// accept it like it's hot
if ((module as any).hot) {
  ;(module as any).hot.accept()
  ;(module as any).hot.dispose(() => {
    root.unmount()
  })
}
