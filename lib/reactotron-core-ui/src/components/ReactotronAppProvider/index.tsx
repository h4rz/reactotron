import React from "react"
import styled, { ThemeProvider } from "styled-components"

import useColorScheme from "../../hooks/useColorScheme"
import { ThemeName, themes } from "../../themes"

const ReactotronContainer = styled.div<{
  $interfaceFontFamily?: string
  $interfaceFontSize?: number
  $monospaceFontFamily?: string
  $monospaceFontSize?: number
  $fontSmoothing?: boolean
}>`
  ${(props) =>
    props.$monospaceFontFamily ? `--reactotron-monospace-font: ${props.$monospaceFontFamily};` : ""}
  ${(props) =>
    props.$monospaceFontSize
      ? `--reactotron-monospace-font-size: ${props.$monospaceFontSize}px;`
      : ""}
  font-family: ${(props) =>
    props.$interfaceFontFamily || `var(--reactotron-interface-font, ${props.theme.fontFamily})`};
  font-size: ${(props) =>
    props.$interfaceFontSize
      ? `${props.$interfaceFontSize}px`
      : "var(--reactotron-interface-font-size, 0.94em)"};
  -webkit-font-smoothing: ${(props) =>
    props.$fontSmoothing === undefined
      ? "var(--reactotron-font-smoothing, auto)"
      : props.$fontSmoothing
        ? "antialiased"
        : "auto"};
  width: 100%;
  height: 100%;
  user-select: none;
`

interface Props {
  children: React.ReactNode
  themeName?: ThemeName
  interfaceFontFamily?: string
  interfaceFontSize?: number
  monospaceFontFamily?: string
  monospaceFontSize?: number
  fontSmoothing?: boolean
}

const ReactotronAppProvider: React.FC<Props> = ({
  children,
  themeName,
  interfaceFontFamily,
  interfaceFontSize,
  monospaceFontFamily,
  monospaceFontSize,
  fontSmoothing,
}) => {
  const storedThemeName = useColorScheme()
  const resolvedThemeName = themeName || storedThemeName

  return (
    <ThemeProvider theme={themes[resolvedThemeName]}>
      <ReactotronContainer
        $interfaceFontFamily={interfaceFontFamily}
        $interfaceFontSize={interfaceFontSize}
        $monospaceFontFamily={monospaceFontFamily}
        $monospaceFontSize={monospaceFontSize}
        $fontSmoothing={fontSmoothing}
      >
        {children}
      </ReactotronContainer>
    </ThemeProvider>
  )
}

export default ReactotronAppProvider
