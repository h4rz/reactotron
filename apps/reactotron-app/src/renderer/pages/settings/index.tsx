import React, { useContext, useEffect, useState } from "react"
import { Header, themes, themeVariants, type ThemeStyle } from "@hurajgor/reactotron-core-ui"
import { LuKeyboard, LuMoon, LuPalette, LuSettings2, LuSun } from "react-icons/lu"
import styled from "styled-components"

import AppPreferencesContext, {
  ThemeAppearance,
  TypographyPreferencesContext,
  maxMaxCommands,
  minMaxCommands,
} from "../../contexts/AppPreferences"
import { resolveInterfaceFont, resolveMonospaceFont } from "../../typography"
import FontFamilyPicker from "./FontFamilyPicker"
import KeybindingsSettings from "./KeybindingsSettings"

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
`

const SettingsContainer = styled.div`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 30px 32px 40px;
  overflow-y: auto;
  overflow-x: hidden;

  @media (max-width: 640px) {
    padding: 22px 18px 32px;
  }
`

const SettingsContent = styled.div`
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  align-items: start;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  box-sizing: border-box;
  gap: 32px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`

const SettingsNav = styled.nav`
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;

  @media (max-width: 760px) {
    position: static;
    flex-direction: row;
  }
`

const SettingsNavButton = styled.button<{ $isActive: boolean }>`
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: ${(props) =>
    props.$isActive
      ? `color-mix(in srgb, ${props.theme.highlight} 24%, transparent)`
      : "transparent"};
  color: ${(props) => (props.$isActive ? props.theme.foregroundLight : props.theme.foregroundDark)};
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: ${(props) => (props.$isActive ? 600 : 500)};
  text-align: left;

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    stroke-width: 1.8;
  }

  &:hover {
    background: ${(props) =>
      props.$isActive
        ? `color-mix(in srgb, ${props.theme.highlight} 28%, transparent)`
        : `color-mix(in srgb, ${props.theme.foreground} 6%, transparent)`};
    color: ${(props) => props.theme.foreground};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }
`

const SettingsPane = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 32px;
`

const Intro = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
`

const PageTitle = styled.h1`
  margin: 0;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 22px;
  font-weight: 700;
`

const PageDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 13px;
  line-height: 20px;
`

const AppearanceSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const SectionLabel = styled.h2`
  margin: 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
`

const AppearanceOptions = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 680px) {
    grid-template-columns: 1fr;
  }
`

const SchemeOption = styled.label<{ $isActive: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.highlight : props.theme.borderSubtle)};
  border-radius: 12px;
  background: ${(props) =>
    props.$isActive
      ? `color-mix(in srgb, ${props.theme.highlight} 7%, ${props.theme.background})`
      : props.theme.background};
  color: ${(props) => (props.$isActive ? props.theme.foregroundLight : props.theme.foreground)};
  cursor: pointer;
  font-size: 13px;
  font-weight: ${(props) => (props.$isActive ? 600 : 500)};
  text-align: center;
  box-shadow: ${(props) =>
    props.$isActive
      ? `0 0 0 1px color-mix(in srgb, ${props.theme.highlight} 45%, transparent)`
      : "none"};
  transition:
    border-color 0.12s ease-out,
    background-color 0.12s ease-out;

  &:hover {
    border-color: ${(props) => props.theme.highlight};
  }

  &:focus-within {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
`

const SchemePreview = styled.span<{ $appearance: ThemeAppearance }>`
  position: relative;
  display: block;
  height: 58px;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background: ${(props) => {
    if (props.$appearance === "light") return "#f5f7fa"
    if (props.$appearance === "dark") return "#18212b"
    return "linear-gradient(90deg, #f5f7fa 0 50%, #18212b 50% 100%)"
  }};

  &::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    border-right: 1px solid rgba(120, 140, 160, 0.25);
    background: ${(props) => {
      if (props.$appearance === "dark") return "#223242"
      if (props.$appearance === "light") return "#e5ebf2"
      return "linear-gradient(90deg, #e5ebf2 0 50%, #223242 50% 100%)"
    }};
  }

  &::after {
    content: "";
    position: absolute;
    top: 17px;
    right: 11%;
    width: 45%;
    height: 7px;
    border-radius: 999px;
    background: ${(props) => (props.$appearance === "light" ? "#9cb7ca" : "#426884")};
    box-shadow:
      0 17px 0 -1px rgba(128, 144, 158, 0.46),
      0 34px 0 -2px rgba(128, 144, 158, 0.25);
  }
`

const ThemeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`

const ThemeCard = styled.div<{ $isActive: boolean }>`
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 88px;
  flex-direction: column;
  justify-content: space-between;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.highlight : props.theme.borderSubtle)};
  border-radius: 12px;
  background: ${(props) =>
    props.$isActive
      ? `color-mix(in srgb, ${props.theme.highlight} 7%, ${props.theme.background})`
      : props.theme.background};
  color: ${(props) => props.theme.foreground};
  text-align: left;
  box-shadow: ${(props) =>
    props.$isActive
      ? `inset 0 0 0 1px color-mix(in srgb, ${props.theme.highlight} 40%, transparent)`
      : "none"};
  transition:
    transform 0.12s ease-out,
    border-color 0.12s ease-out,
    background-color 0.12s ease-out;

  &:hover {
    border-color: ${(props) => props.theme.highlight};
    background: ${(props) =>
      `color-mix(in srgb, ${props.theme.highlight} 5%, ${props.theme.background})`};
    transform: translateY(-1px);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:hover {
      transform: none;
    }
  }
`

const ThemeCardSelectButton = styled.button`
  position: absolute;
  z-index: 1;
  inset: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }
`

const ThemePreviewPair = styled.span`
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
`

const ThemeOrb = styled.button<{
  $background: string
  $surface: string
  $accent: string
  $foreground: string
  $isActive: boolean
}>`
  position: relative;
  width: 44px;
  height: 44px;
  padding: 3px;
  border: 0;
  border-radius: 50%;
  background: radial-gradient(
      circle at 70% 28%,
      ${(props) => props.$foreground} 0 4%,
      transparent 5%
    ),
    radial-gradient(circle at 30% 72%, ${(props) => props.$accent} 0 22%, transparent 45%),
    linear-gradient(145deg, ${(props) => props.$surface}, ${(props) => props.$background});
  background-clip: content-box;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, ${(props) => props.$foreground} 35%, transparent),
    0 4px 10px ${(props) => props.theme.glow};
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.12s ease-out;

  ${(props) =>
    props.$isActive &&
    `box-shadow: inset 0 0 0 2px ${props.theme.highlight}, 0 4px 10px ${props.theme.glow};`}

  &:hover {
    transform: ${(props) => (props.$isActive ? "none" : "scale(1.05)")};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:hover {
      transform: none;
    }
  }
`

const OrbModeBadge = styled.span`
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 50%;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};

  svg {
    width: 11px;
    height: 11px;
    stroke-width: 2;
  }
`

const ThemeCardFooter = styled.span`
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
`

const ThemeName = styled.span`
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ActiveMark = styled.span`
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  flex: 0 0 18px;
  border-radius: 50%;
  background: ${(props) => props.theme.highlight};
  color: ${(props) => props.theme.tagComplement};
  font-size: 11px;
`

const TypographyHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const TypographyPanel = styled.div`
  overflow: visible;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 12px;
  background: ${(props) => props.theme.background};
`

const TypographyRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(250px, 330px);
  gap: 10px 20px;
  padding: 13px 16px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};

  &:last-child {
    border-bottom: 0;
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

const TypographyTitle = styled.h3`
  margin: 0 0 5px;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 14px;
  font-weight: 650;
`

const TypographyDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
  line-height: 18px;
`

const TypographyControls = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px;
  gap: 10px;
  align-self: center;
`

const TypographySelect = styled.select`
  min-width: 0;
  height: 36px;
  padding: 0 30px 0 11px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font: inherit;
  font-size: 13px;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 1px;
  }
`

const FontPreview = styled.div<{ $family: string; $size: number; $monospace?: boolean }>`
  grid-column: 1 / -1;
  min-width: 0;
  overflow: hidden;
  padding: 12px 14px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-family: ${(props) => props.$family};
  font-size: ${(props) => props.$size}px;
  line-height: 1.55;
  text-overflow: ellipsis;
  white-space: ${(props) => (props.$monospace ? "pre" : "normal")};
`

const SmoothingControl = styled.label`
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
`

const PreferencesPanel = styled.section`
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 12px;
  background: ${(props) => props.theme.background};
`

const PreferenceSection = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 280px);
  gap: 24px;
  align-items: center;
  min-height: 82px;
  padding: 17px 20px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};

  &:last-child {
    border-bottom: 0;
  }

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
    gap: 12px;
  }
`

const PreferenceTitle = styled.h3`
  margin: 0 0 5px;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 14px;
  font-weight: 650;
`

const PreferenceDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
  line-height: 18px;
`

const NumberInput = styled.input`
  width: 120px;
  padding: 8px 10px;
  box-sizing: border-box;
  color: ${(props) => props.theme.foreground};
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  font-size: 13px;

  &:focus {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 1px;
  }
`

const PreferenceControl = styled.label`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
  color: ${(props) => props.theme.foreground};
  cursor: pointer;

  &:focus-within > span {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }

  @media (max-width: 700px) {
    justify-content: flex-start;
  }
`

const ToggleInput = styled.input`
  position: absolute;
  opacity: 0;
  pointer-events: none;
`

const ToggleTrack = styled.span<{ $isEnabled: boolean }>`
  display: inline-flex;
  align-items: center;
  width: 44px;
  height: 24px;
  flex: 0 0 44px;
  padding: 2px;
  border: 1px solid
    ${(props) => (props.$isEnabled ? props.theme.highlight : props.theme.borderSubtle)};
  border-radius: 999px;
  background-color: ${(props) =>
    props.$isEnabled
      ? `color-mix(in srgb, ${props.theme.highlight} 24%, transparent)`
      : props.theme.background};
  transition:
    background-color 0.12s ease-out,
    border-color 0.12s ease-out;
`

const ToggleThumb = styled.span<{ $isEnabled: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background-color: ${(props) =>
    props.$isEnabled ? props.theme.highlight : props.theme.foregroundDark};
  transform: translateX(${(props) => (props.$isEnabled ? 20 : 0)}px);
  transition:
    background-color 0.12s ease-out,
    transform 0.12s ease-out;
`

const themeOptions: Array<{ label: string; value: ThemeStyle }> = [
  { label: "Ocean", value: "ocean" },
  { label: "Iris", value: "iris" },
  { label: "One", value: "one" },
  { label: "Solarized", value: "solarized" },
  { label: "Kanagawa", value: "kanagawa" },
  { label: "Everforest", value: "everforest" },
  { label: "Gruvbox", value: "gruvbox" },
]

const appearanceOptions: Array<{ label: string; value: ThemeAppearance }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
]

function Settings() {
  const {
    setThemeStyle,
    lightThemeStyle,
    darkThemeStyle,
    setThemeStyleForAppearance,
    themeAppearance,
    setThemeAppearance,
    enableNewTimeline,
    setEnableNewTimeline,
    startWithCompactSidebar,
    setStartWithCompactSidebar,
    maxCommands,
    setMaxCommands,
  } = useContext(AppPreferencesContext)
  const {
    interfaceFont,
    setInterfaceFont,
    interfaceFontSize,
    setInterfaceFontSize,
    monospaceFont,
    setMonospaceFont,
    monospaceFontSize,
    setMonospaceFontSize,
    fontSmoothing,
    setFontSmoothing,
  } = useContext(TypographyPreferencesContext)

  const [activeSection, setActiveSection] = useState<"general" | "appearance" | "keybindings">(
    "appearance"
  )
  const [maxCommandsDraft, setMaxCommandsDraft] = useState(String(maxCommands))
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform)

  useEffect(() => {
    setMaxCommandsDraft(String(maxCommands))
  }, [maxCommands])

  const commitMaxCommands = () => {
    const parsed = Number(maxCommandsDraft)

    if (!Number.isFinite(parsed)) {
      setMaxCommandsDraft(String(maxCommands))
      return
    }

    setMaxCommands(parsed)
  }

  return (
    <Container>
      <Header title="Settings" isDraggable />
      <SettingsContainer>
        <SettingsContent>
          <SettingsNav aria-label="Settings sections">
            <SettingsNavButton
              type="button"
              $isActive={activeSection === "general"}
              aria-current={activeSection === "general" ? "page" : undefined}
              onClick={() => setActiveSection("general")}
            >
              <LuSettings2 aria-hidden="true" />
              General
            </SettingsNavButton>
            <SettingsNavButton
              type="button"
              $isActive={activeSection === "appearance"}
              aria-current={activeSection === "appearance" ? "page" : undefined}
              onClick={() => setActiveSection("appearance")}
            >
              <LuPalette aria-hidden="true" />
              Appearance
            </SettingsNavButton>
            <SettingsNavButton
              type="button"
              $isActive={activeSection === "keybindings"}
              aria-current={activeSection === "keybindings" ? "page" : undefined}
              onClick={() => setActiveSection("keybindings")}
            >
              <LuKeyboard aria-hidden="true" />
              Keybindings
            </SettingsNavButton>
          </SettingsNav>

          <SettingsPane>
            <Intro>
              <PageTitle>
                {activeSection === "appearance"
                  ? "Appearance"
                  : activeSection === "keybindings"
                    ? "Keybindings"
                    : "General"}
              </PageTitle>
              <PageDescription>
                {activeSection === "appearance"
                  ? "Choose independent light and dark palettes, then follow your system or lock either appearance."
                  : activeSection === "keybindings"
                    ? "Customize Reactotron and device controls. Changes apply immediately."
                    : "Tune Reactotron for long debugging sessions. Changes apply immediately."}
              </PageDescription>
            </Intro>

            {activeSection === "appearance" ? (
              <>
                <AppearanceSection>
                  <SectionLabel>Color scheme</SectionLabel>
                  <AppearanceOptions>
                    {appearanceOptions.map((option) => (
                      <SchemeOption key={option.value} $isActive={themeAppearance === option.value}>
                        <input
                          type="radio"
                          name="theme-appearance"
                          value={option.value}
                          checked={themeAppearance === option.value}
                          onChange={() => setThemeAppearance(option.value)}
                        />
                        <SchemePreview $appearance={option.value} />
                        {option.label}
                      </SchemeOption>
                    ))}
                  </AppearanceOptions>
                </AppearanceSection>

                <AppearanceSection>
                  <SectionLabel>
                    Themes · choose each circle or click the card for both
                  </SectionLabel>
                  <ThemeGrid>
                    {themeOptions.map((option) => {
                      const variants = themeVariants[option.value]
                      const lightTheme = themes[variants.light]
                      const darkTheme = themes[variants.dark]
                      const lightIsActive = lightThemeStyle === option.value
                      const darkIsActive = darkThemeStyle === option.value
                      const bothAreActive = lightIsActive && darkIsActive

                      return (
                        <ThemeCard key={option.value} $isActive={bothAreActive}>
                          <ThemeCardSelectButton
                            type="button"
                            aria-label={`Use ${option.label} for both light and dark appearances`}
                            aria-pressed={bothAreActive}
                            onClick={() => setThemeStyle(option.value)}
                          />
                          <ThemePreviewPair>
                            <ThemeOrb
                              type="button"
                              aria-label={`Use ${option.label} for light appearance`}
                              aria-pressed={lightIsActive}
                              $isActive={lightIsActive}
                              $background={lightTheme.background}
                              $surface={lightTheme.surfaceRaised}
                              $accent={lightTheme.highlight}
                              $foreground={lightTheme.foreground}
                              onClick={(event) => {
                                event.stopPropagation()
                                setThemeStyleForAppearance("light", option.value)
                              }}
                            >
                              {lightIsActive && (
                                <OrbModeBadge aria-hidden="true">
                                  <LuSun />
                                </OrbModeBadge>
                              )}
                            </ThemeOrb>
                            <ThemeOrb
                              type="button"
                              aria-label={`Use ${option.label} for dark appearance`}
                              aria-pressed={darkIsActive}
                              $isActive={darkIsActive}
                              $background={darkTheme.background}
                              $surface={darkTheme.surfaceRaised}
                              $accent={darkTheme.highlight}
                              $foreground={darkTheme.foreground}
                              onClick={(event) => {
                                event.stopPropagation()
                                setThemeStyleForAppearance("dark", option.value)
                              }}
                            >
                              {darkIsActive && (
                                <OrbModeBadge aria-hidden="true">
                                  <LuMoon />
                                </OrbModeBadge>
                              )}
                            </ThemeOrb>
                          </ThemePreviewPair>
                          <ThemeCardFooter>
                            <ThemeName>{option.label}</ThemeName>
                            {bothAreActive && <ActiveMark aria-hidden="true">✓</ActiveMark>}
                          </ThemeCardFooter>
                        </ThemeCard>
                      )
                    })}
                  </ThemeGrid>
                </AppearanceSection>

                <AppearanceSection>
                  <TypographyHeader>
                    <SectionLabel>Typography</SectionLabel>
                    {isMac && (
                      <SmoothingControl>
                        Font smoothing
                        <ToggleInput
                          type="checkbox"
                          aria-label="Use antialiased font smoothing"
                          checked={fontSmoothing}
                          onChange={(event) => setFontSmoothing(event.target.checked)}
                        />
                        <ToggleTrack $isEnabled={fontSmoothing}>
                          <ToggleThumb $isEnabled={fontSmoothing} />
                        </ToggleTrack>
                      </SmoothingControl>
                    )}
                  </TypographyHeader>
                  <TypographyPanel>
                    <TypographyRow>
                      <div>
                        <TypographyTitle>Interface font</TypographyTitle>
                        <TypographyDescription>
                          Navigation, settings, labels, and timeline content.
                        </TypographyDescription>
                      </div>
                      <TypographyControls>
                        <FontFamilyPicker
                          ariaLabel="Interface font family"
                          value={interfaceFont}
                          onChange={setInterfaceFont}
                        />
                        <TypographySelect
                          aria-label="Interface font size"
                          value={interfaceFontSize}
                          onChange={(event) => setInterfaceFontSize(Number(event.target.value))}
                        >
                          {Array.from({ length: 9 }, (_, index) => index + 12).map((size) => (
                            <option key={size} value={size}>
                              {size} px
                            </option>
                          ))}
                        </TypographySelect>
                      </TypographyControls>
                      <FontPreview
                        $family={resolveInterfaceFont(interfaceFont)}
                        $size={interfaceFontSize}
                      >
                        Connection established · Timeline ready for inspection.
                      </FontPreview>
                    </TypographyRow>

                    <TypographyRow>
                      <div>
                        <TypographyTitle>Monospace font</TypographyTitle>
                        <TypographyDescription>
                          Timestamps, network requests, payloads, and diagnostic values.
                        </TypographyDescription>
                      </div>
                      <TypographyControls>
                        <FontFamilyPicker
                          ariaLabel="Monospace font family"
                          value={monospaceFont}
                          requireMonospace
                          onChange={setMonospaceFont}
                        />
                        <TypographySelect
                          aria-label="Monospace font size"
                          value={monospaceFontSize}
                          onChange={(event) => setMonospaceFontSize(Number(event.target.value))}
                        >
                          {Array.from({ length: 9 }, (_, index) => index + 10).map((size) => (
                            <option key={size} value={size}>
                              {size} px
                            </option>
                          ))}
                        </TypographySelect>
                      </TypographyControls>
                      <FontPreview
                        $family={resolveMonospaceFont(monospaceFont)}
                        $size={monospaceFontSize}
                        $monospace
                      >
                        {'GET /api/session   200   42 ms   { "connected": true }'}
                      </FontPreview>
                    </TypographyRow>
                  </TypographyPanel>
                </AppearanceSection>
              </>
            ) : activeSection === "keybindings" ? (
              <KeybindingsSettings />
            ) : (
              <AppearanceSection>
                <SectionLabel>Interface</SectionLabel>
                <PreferencesPanel>
                  <PreferenceSection>
                    <div>
                      <PreferenceTitle>Timeline</PreferenceTitle>
                      <PreferenceDescription>
                        Use the newer event table UI when opening Timeline.
                      </PreferenceDescription>
                    </div>
                    <PreferenceControl>
                      <ToggleInput
                        type="checkbox"
                        checked={enableNewTimeline}
                        onChange={(event) => setEnableNewTimeline(event.target.checked)}
                      />
                      <ToggleTrack $isEnabled={enableNewTimeline}>
                        <ToggleThumb $isEnabled={enableNewTimeline} />
                      </ToggleTrack>
                    </PreferenceControl>
                  </PreferenceSection>

                  <PreferenceSection>
                    <div>
                      <PreferenceTitle>Sidebar</PreferenceTitle>
                      <PreferenceDescription>
                        Start Reactotron with the compact left sidebar.
                      </PreferenceDescription>
                    </div>
                    <PreferenceControl>
                      <ToggleInput
                        type="checkbox"
                        checked={startWithCompactSidebar}
                        onChange={(event) => setStartWithCompactSidebar(event.target.checked)}
                      />
                      <ToggleTrack $isEnabled={startWithCompactSidebar}>
                        <ToggleThumb $isEnabled={startWithCompactSidebar} />
                      </ToggleTrack>
                    </PreferenceControl>
                  </PreferenceSection>

                  <PreferenceSection>
                    <div>
                      <PreferenceTitle>Command history</PreferenceTitle>
                      <PreferenceDescription>
                        Maximum logs and network calls kept per connection. Use {minMaxCommands}–
                        {maxMaxCommands}.
                      </PreferenceDescription>
                    </div>
                    <PreferenceControl>
                      <NumberInput
                        aria-label="Maximum command history"
                        type="number"
                        min={minMaxCommands}
                        max={maxMaxCommands}
                        value={maxCommandsDraft}
                        onChange={(event) => setMaxCommandsDraft(event.target.value)}
                        onBlur={commitMaxCommands}
                      />
                    </PreferenceControl>
                  </PreferenceSection>
                </PreferencesPanel>
              </AppearanceSection>
            )}
          </SettingsPane>
        </SettingsContent>
      </SettingsContainer>
    </Container>
  )
}

export default Settings
