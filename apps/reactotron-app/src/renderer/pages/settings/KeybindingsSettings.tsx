import React, { useMemo, useState } from "react"
import { LuRotateCcw, LuSearch, LuX } from "react-icons/lu"
import styled from "styled-components"

import {
  bindingFromKeyboardEvent,
  formatBinding,
  keybindingDefinitions,
  type KeybindingId,
  useKeybindings,
} from "../../keybindings"

const Container = styled.div`
  display: flex;
  width: 100%;
  max-width: 980px;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
`

const Toolbar = styled.div`
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
`

const BindingCount = styled.span`
  margin-right: 2px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
`

const SearchLabel = styled.label`
  position: relative;
  display: flex;
  width: 240px;
  align-items: center;

  svg {
    position: absolute;
    left: 12px;
    width: 16px;
    height: 16px;
    color: ${(props) => props.theme.foregroundDark};
    pointer-events: none;
  }
`

const SearchInput = styled.input`
  width: 100%;
  height: 30px;
  box-sizing: border-box;
  padding: 0 12px 0 38px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  background: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foreground};
  font: inherit;
  font-size: 13px;

  &::placeholder {
    color: ${(props) => props.theme.foregroundDark};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 1px;
  }
`

const Rows = styled.div`
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 12px;
  background: ${(props) => props.theme.background};
`

const Row = styled.div`
  display: grid;
  min-height: 48px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 6px 12px 6px 14px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: ${(props) =>
      `color-mix(in srgb, ${props.theme.foreground} 4%, ${props.theme.background})`};
  }
`

const ActionName = styled.h3`
  margin: 0 0 2px;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 12px;
  font-weight: 600;
`

const ActionDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 10px;
  line-height: 14px;
  text-wrap: pretty;
`

const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const ShortcutButton = styled.button<{ $recording: boolean }>`
  display: inline-flex;
  min-width: 82px;
  min-height: 30px;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 3px 6px;
  border: 1px solid ${(props) => (props.$recording ? props.theme.highlight : "transparent")};
  border-radius: 6px;
  background: ${(props) => (props.$recording ? props.theme.background : "transparent")};
  color: ${(props) => props.theme.foreground};
  cursor: pointer;
  font: inherit;
  font-size: 11px;

  &:hover {
    border-color: ${(props) => props.theme.borderSubtle};
    background: ${(props) => props.theme.background};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }
`

const KeyCap = styled.kbd`
  min-width: 18px;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: ${(props) => props.theme.surfacePanel};
  color: ${(props) => props.theme.foregroundLight};
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
`

const IconButton = styled.button`
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;

  &:hover {
    border-color: ${(props) => props.theme.borderSubtle};
    background: ${(props) => props.theme.background};
    color: ${(props) => props.theme.foreground};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }
`

const Status = styled.p<{ $error?: boolean }>`
  margin: 0;
  color: ${(props) => (props.$error ? props.theme.danger : props.theme.foregroundDark)};
  font-size: 11px;
  line-height: 14px;
`

const RowResetButton = styled(IconButton)`
  opacity: 0;

  ${Row}:hover &,
  &:focus-visible {
    opacity: 1;
  }
`

const EmptyState = styled.p`
  margin: 30px 0;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 13px;
  text-align: center;
`

export default function KeybindingsSettings() {
  const { bindings, setBinding, resetBinding, resetAll } = useKeybindings()
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [recordingId, setRecordingId] = useState<KeybindingId | null>(null)
  const [status, setStatus] = useState("")
  const [hasError, setHasError] = useState(false)

  const definitions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return keybindingDefinitions.filter((definition) => {
      if (!normalizedQuery) return true
      return `${definition.name} ${definition.description} ${definition.group}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [query])

  const recordBinding = (id: KeybindingId, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === "Escape") {
      setRecordingId(null)
      setStatus("Shortcut editing cancelled.")
      setHasError(false)
      return
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setBinding(id, null)
      setRecordingId(null)
      setStatus("Shortcut removed.")
      setHasError(false)
      return
    }
    const binding = bindingFromKeyboardEvent(event)
    if (!binding) {
      setStatus("Use at least one modifier key, or choose an F-key.")
      setHasError(true)
      return
    }
    const conflict = keybindingDefinitions.find(
      (definition) => definition.id !== id && bindings[definition.id] === binding
    )
    if (conflict) {
      setStatus(`That shortcut is already assigned to ${conflict.name}.`)
      setHasError(true)
      return
    }
    setBinding(id, binding)
    setRecordingId(null)
    setStatus("Shortcut saved.")
    setHasError(false)
  }

  return (
    <Container>
      <Toolbar>
        <BindingCount>{keybindingDefinitions.length} bindings</BindingCount>
        {searchOpen && (
          <SearchLabel>
            <LuSearch aria-hidden="true" />
            <SearchInput
              autoFocus
              aria-label="Search keybindings"
              placeholder="Search keybindings"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </SearchLabel>
        )}
        <IconButton
          type="button"
          aria-label={searchOpen ? "Close keybinding search" : "Search keybindings"}
          title={searchOpen ? "Close search" : "Search keybindings"}
          onClick={() => {
            setSearchOpen((open) => !open)
            if (searchOpen) setQuery("")
          }}
        >
          {searchOpen ? <LuX aria-hidden="true" /> : <LuSearch aria-hidden="true" />}
        </IconButton>
        <IconButton
          type="button"
          aria-label="Restore all default shortcuts"
          title="Restore defaults"
          onClick={() => {
            resetAll()
            setStatus("Default shortcuts restored.")
            setHasError(false)
          }}
        >
          <LuRotateCcw aria-hidden="true" />
        </IconButton>
      </Toolbar>
      {status && (
        <Status role={hasError ? "alert" : "status"} $error={hasError}>
          {status}
        </Status>
      )}
      {definitions.length ? (
        <Rows>
          {definitions.map((definition) => {
            const isRecording = recordingId === definition.id
            return (
              <Row key={definition.id}>
                <div>
                  <ActionName>
                    {definition.group}: {definition.name}
                  </ActionName>
                  <ActionDescription>{definition.description}</ActionDescription>
                </div>
                <RowActions>
                  <ShortcutButton
                    type="button"
                    $recording={isRecording}
                    aria-label={
                      isRecording
                        ? `Recording shortcut for ${definition.name}`
                        : `Change shortcut for ${definition.name}`
                    }
                    onClick={() => {
                      setRecordingId(definition.id)
                      setStatus(`Press a new shortcut for ${definition.name}.`)
                      setHasError(false)
                    }}
                    onKeyDown={(event) => {
                      if (isRecording) recordBinding(definition.id, event)
                    }}
                  >
                    {isRecording ? (
                      "Press shortcut…"
                    ) : (
                      <>
                        {formatBinding(bindings[definition.id]).map((part, index) => (
                          <KeyCap key={`${part}-${index}`}>{part}</KeyCap>
                        ))}
                      </>
                    )}
                  </ShortcutButton>
                  <RowResetButton
                    type="button"
                    aria-label={`Restore default shortcut for ${definition.name}`}
                    title="Restore default"
                    onClick={() => {
                      resetBinding(definition.id)
                      setStatus(`Restored the default for ${definition.name}.`)
                      setHasError(false)
                    }}
                  >
                    <LuRotateCcw aria-hidden="true" />
                  </RowResetButton>
                </RowActions>
              </Row>
            )
          })}
        </Rows>
      ) : (
        <EmptyState>No keybindings match “{query}”.</EmptyState>
      )}
    </Container>
  )
}
