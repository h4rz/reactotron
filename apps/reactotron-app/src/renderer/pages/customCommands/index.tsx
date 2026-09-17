import React, { useState, useContext, useReducer } from "react"
import { Header, EmptyState, CustomCommandsContext } from "@hurajgor/reactotron-core-ui"
import type { CustomCommand } from "@hurajgor/reactotron-core-ui"
import styled from "styled-components"
import { MdOutlineAutoFixHigh, MdOutlineSearch } from "react-icons/md"
import { produce } from "immer"

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`

const CommandsContainer = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 28px;
  padding-bottom: 0;
`

const SearchContainer = styled.div`
  display: flex;
  align-items: center;
  padding-bottom: 10px;
  padding-top: 4px;
  padding-right: 10px;
`
const SearchLabel = styled.p`
  padding: 0 10px;
  font-size: 14px;
  color: ${(props) => props.theme.foregroundDark};
`
const SearchInput = styled.input`
  border-radius: 7px;
  padding: 10px;
  flex: 1;
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.borderSubtle};
  color: ${(props) => props.theme.foreground};
  font-size: 14px;
`

const ButtonContianer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background-color: ${(props) => props.theme.surfacePanel};
  color: ${(props) => props.theme.foreground};
`
const Title = styled.div`
  color: ${(props) => props.theme.foregroundLight};
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
`
const Description = styled.div`
  color: ${(props) => props.theme.foregroundDark};
  margin-bottom: 12px;
`
const ArgsContainer = styled.div`
  margin-bottom: 24px;
`
const SendButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.theme.surfaceSelected};
  border: 1px solid ${(props) => `color-mix(in srgb, ${props.theme.highlight} 42%, transparent)`};
  border-radius: 7px;
  width: 170px;
  min-height: 36px;
  margin-bottom: 24px;
  cursor: pointer;
  color: ${(props) => props.theme.highlight};
  font-size: 12px;
  font-weight: 700;
  transition: background-color 0.25s ease-in-out;

  &:hover {
    background-color: ${(props) =>
      `color-mix(in srgb, ${props.theme.background} 76%, ${props.theme.highlight})`};
  }
`
const ArgContainer = styled.div`
  &:not(:last-child) {
    margin-bottom: 12px;
  }
`
const ArgName = styled.div`
  margin-bottom: 8px;
`
const ArgInput = styled.input`
  padding: 10px 12px;
  outline: none;
  border-radius: 7px;
  width: 90%;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-size: 13px;
`

// TODO: This item thing is getting complicated, move it out!
// TODO: Better typing
function customCommandItemReducer(state: any, action: any) {
  switch (action.type) {
    case "UPDATE_ARG":
      return produce(state, (draftState) => {
        draftState[action.payload.argName] = action.payload.value
      })
    default:
      return state
  }
}

function CustomCommandItem({
  customCommand,
  sendCustomCommand,
}: {
  customCommand: CustomCommand
  sendCustomCommand: (command: any, args: any) => void
}) {
  const [state, dispatch] = useReducer(customCommandItemReducer, customCommand.args, (args) => {
    if (!args) return {}

    const argMap = {}

    args.forEach((arg) => {
      argMap[arg.name] = ""
    })

    return argMap
  })

  return (
    <ButtonContianer>
      <Title>{customCommand.title || customCommand.command}</Title>
      <Description>{customCommand.description || "No Description Provided"}</Description>
      {!!customCommand.args && customCommand.args.length > 0 && (
        <ArgsContainer>
          {customCommand.args.map((arg) => {
            return (
              <ArgContainer key={arg.name}>
                <ArgName>{arg.name}</ArgName>
                <ArgInput
                  type="text"
                  placeholder={arg.name}
                  value={state[arg.name]}
                  onChange={(e) => {
                    dispatch({
                      type: "UPDATE_ARG",
                      payload: {
                        argName: arg.name,
                        value: e.target.value,
                      },
                    })
                  }}
                />
              </ArgContainer>
            )
          })}
        </ArgsContainer>
      )}
      <SendButton
        onClick={() => {
          sendCustomCommand(customCommand.command, state)
        }}
      >
        Send Command
      </SendButton>
    </ButtonContianer>
  )
}

function CustomCommands() {
  const [isSearchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState("")

  const { customCommands, sendCustomCommand } = useContext(CustomCommandsContext)

  const lowerSearch = search.toLowerCase()
  const filteredCustomCommands =
    search !== ""
      ? customCommands.filter(
          (cc) =>
            cc.command.toLowerCase().indexOf(lowerSearch) > -1 ||
            (cc.title || "").toLowerCase().indexOf(lowerSearch) > -1 ||
            (cc.description || "").toLowerCase().indexOf(lowerSearch) > -1
        )
      : customCommands

  return (
    <Container>
      <Header
        title="Custom Commands"
        isDraggable
        actions={[
          {
            tip: "Search",
            icon: MdOutlineSearch,
            onClick: () => {
              setSearchOpen(!isSearchOpen)
            },
          },
        ]}
      >
        {isSearchOpen && (
          <SearchContainer>
            <SearchLabel>Search</SearchLabel>
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} />
          </SearchContainer>
        )}
      </Header>
      <CommandsContainer>
        {customCommands.length === 0 ? (
          <EmptyState icon={MdOutlineAutoFixHigh} title="No Custom Commands">
            When your app registers a custom command it will show here!
          </EmptyState>
        ) : (
          filteredCustomCommands.map((cc) => (
            <CustomCommandItem
              key={`${cc.clientId}-${cc.id}`}
              customCommand={cc}
              sendCustomCommand={sendCustomCommand}
            />
          ))
        )}
      </CommandsContainer>
    </Container>
  )
}

export default CustomCommands
