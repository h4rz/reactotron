import React, { useContext, useEffect, useState } from "react"
import { Header, themes, themeVariants, type ThemeStyle } from "@hurajgor/reactotron-core-ui"
import styled from "styled-components"

import AppPreferencesContext, {
  ThemeAppearance,
  maxMaxCommands,
  minMaxCommands,
} from "../../contexts/AppPreferences"

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
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid ${(props) => (props.$isActive ? props.theme.chromeLine : "transparent")};
  border-radius: 8px;
  background: ${(props) => (props.$isActive ? props.theme.backgroundLighter : "transparent")};
  color: ${(props) => (props.$isActive ? props.theme.foregroundLight : props.theme.foregroundDark)};
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: ${(props) => (props.$isActive ? 600 : 500)};
  text-align: left;

  &::before {
    content: "";
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border: 1px solid currentColor;
    border-radius: ${(props) => (props.$isActive ? "2px" : "50%")};
    background: ${(props) => (props.$isActive ? props.theme.highlight : "transparent")};
  }

  &:hover {
    background: ${(props) => props.theme.backgroundSubtleLight};
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
  gap: 14px;
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
  gap: 12px;

  @media (max-width: 680px) {
    grid-template-columns: 1fr;
  }
`

const SchemeOption = styled.label<{ $isActive: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid ${(props) => (props.$isActive ? props.theme.highlight : props.theme.chromeLine)};
  border-radius: 12px;
  background: ${(props) => props.theme.backgroundLighter};
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
  height: 70px;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.chromeLine};
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
  gap: 12px;

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
  min-height: 112px;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 15px 13px;
  border: 1px solid ${(props) => (props.$isActive ? props.theme.highlight : props.theme.chromeLine)};
  border-radius: 12px;
  background: ${(props) => props.theme.backgroundLighter};
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
    background: ${(props) => props.theme.backgroundSubtleLight};
    transform: translateY(-1px);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:hover {
      transform: none;
    }
  }
`

const ThemePreviewPair = styled.span`
  display: flex;
  align-items: center;
  gap: 10px;
`

const ThemeOrb = styled.button<{
  $background: string
  $surface: string
  $accent: string
  $foreground: string
  $isActive: boolean
}>`
  position: relative;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid ${(props) => (props.$isActive ? props.theme.highlight : props.$surface)};
  border-radius: 50%;
  background: radial-gradient(
      circle at 70% 28%,
      ${(props) => props.$foreground} 0 5%,
      transparent 6%
    ),
    radial-gradient(circle at 30% 72%, ${(props) => props.$accent} 0 22%, transparent 45%),
    linear-gradient(145deg, ${(props) => props.$surface}, ${(props) => props.$background});
  box-shadow: 0 4px 10px ${(props) => props.theme.glow};
  cursor: pointer;

  ${(props) =>
    props.$isActive &&
    `box-shadow: 0 0 0 2px ${props.theme.backgroundLighter}, 0 0 0 4px ${props.theme.highlight};`}

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 4px;
  }
`

const OrbModeBadge = styled.span`
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 50%;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 9px;
  font-weight: 700;
`

const ThemeCardFooter = styled.span`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
`

const ThemeNameButton = styled.button`
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    color: ${(props) => props.theme.highlight};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 3px;
  }
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

const PreferencesPanel = styled.section`
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 12px;
  background: ${(props) => props.theme.backgroundLighter};
`

const PreferenceSection = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 280px);
  gap: 24px;
  align-items: center;
  min-height: 82px;
  padding: 17px 20px;
  border-bottom: 1px solid ${(props) => props.theme.chromeLine};

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
  border: 1px solid ${(props) => props.theme.chromeLine};
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
    ${(props) => (props.$isEnabled ? props.theme.highlight : props.theme.chromeLine)};
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
  { label: "T3 Code", value: "t3Code" },
  { label: "Ocean", value: "ocean" },
  { label: "Iris", value: "iris" },
  { label: "Solarized", value: "solarized" },
  { label: "Kanagawa", value: "kanagawa" },
  { label: "Everforest", value: "everforest" },
  { label: "Gruvbox", value: "gruvbox" },
]

const legacyThemeOptions: Array<{ label: string; value: ThemeStyle }> = [
  { label: "Catppuccin · Legacy", value: "catppuccin" },
  { label: "One · Legacy", value: "one" },
  { label: "Nord · Legacy", value: "nord" },
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

  const [activeSection, setActiveSection] = useState<"general" | "appearance">("appearance")
  const [maxCommandsDraft, setMaxCommandsDraft] = useState(String(maxCommands))
  const selectedLegacyThemes = legacyThemeOptions.filter(
    (option) => option.value === lightThemeStyle || option.value === darkThemeStyle
  )
  const displayedThemeOptions = [...themeOptions, ...selectedLegacyThemes]

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
              General
            </SettingsNavButton>
            <SettingsNavButton
              type="button"
              $isActive={activeSection === "appearance"}
              aria-current={activeSection === "appearance" ? "page" : undefined}
              onClick={() => setActiveSection("appearance")}
            >
              Appearance
            </SettingsNavButton>
          </SettingsNav>

          <SettingsPane>
            <Intro>
              <PageTitle>{activeSection === "appearance" ? "Appearance" : "General"}</PageTitle>
              <PageDescription>
                {activeSection === "appearance"
                  ? "Choose independent light and dark palettes, then follow your system or lock either appearance."
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
                  <SectionLabel>Themes · choose each circle or use the name for both</SectionLabel>
                  <ThemeGrid>
                    {displayedThemeOptions.map((option) => {
                      const variants = themeVariants[option.value]
                      const lightTheme = themes[variants.light]
                      const darkTheme = themes[variants.dark]
                      const lightIsActive = lightThemeStyle === option.value
                      const darkIsActive = darkThemeStyle === option.value
                      const bothAreActive = lightIsActive && darkIsActive

                      return (
                        <ThemeCard key={option.value} $isActive={lightIsActive || darkIsActive}>
                          <ThemePreviewPair>
                            <ThemeOrb
                              type="button"
                              aria-label={`Use ${option.label} for light appearance`}
                              aria-pressed={lightIsActive}
                              $isActive={lightIsActive}
                              $background={lightTheme.background}
                              $surface={lightTheme.backgroundLighter}
                              $accent={lightTheme.highlight}
                              $foreground={lightTheme.foreground}
                              onClick={() => setThemeStyleForAppearance("light", option.value)}
                            >
                              <OrbModeBadge aria-hidden="true">L</OrbModeBadge>
                            </ThemeOrb>
                            <ThemeOrb
                              type="button"
                              aria-label={`Use ${option.label} for dark appearance`}
                              aria-pressed={darkIsActive}
                              $isActive={darkIsActive}
                              $background={darkTheme.background}
                              $surface={darkTheme.backgroundLighter}
                              $accent={darkTheme.highlight}
                              $foreground={darkTheme.foreground}
                              onClick={() => setThemeStyleForAppearance("dark", option.value)}
                            >
                              <OrbModeBadge aria-hidden="true">D</OrbModeBadge>
                            </ThemeOrb>
                          </ThemePreviewPair>
                          <ThemeCardFooter>
                            <ThemeNameButton
                              type="button"
                              aria-label={`Use ${option.label} for both light and dark appearances`}
                              onClick={() => setThemeStyle(option.value)}
                            >
                              {option.label}
                            </ThemeNameButton>
                            {bothAreActive && (
                              <ActiveMark aria-label="Selected for both">✓</ActiveMark>
                            )}
                          </ThemeCardFooter>
                        </ThemeCard>
                      )
                    })}
                  </ThemeGrid>
                </AppearanceSection>
              </>
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
