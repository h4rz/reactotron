import React from "react"
import { shell } from "electron"
import styled from "styled-components"
import { reactotronLogo } from "../../images"
import { EmptyState } from "@hurajgor/reactotron-core-ui"

const WelcomeText = styled.div`
  font-size: 1.25em;
`

const Container = styled.div`
  display: flex;
  padding: 4px 8px;
  margin: 20px 0px 50px;
  border: 1px solid ${(props) => `color-mix(in srgb, ${props.theme.highlight} 42%, transparent)`};
  border-radius: 7px;
  cursor: pointer;
  background-color: ${(props) => props.theme.surfaceSelected};
  color: ${(props) => props.theme.highlight};
  align-items: center;
  justify-content: center;
  text-align: center;

  &:hover {
    background-color: ${(props) =>
      `color-mix(in srgb, ${props.theme.background} 76%, ${props.theme.highlight})`};
  }
`

function openDocs() {
  shell.openExternal("https://docs.infinite.red/reactotron/")
}

function Welcome() {
  return (
    <EmptyState image={reactotronLogo} title="Welcome to Reactotron!">
      <WelcomeText>Connect a device or simulator to get started.</WelcomeText>
      <WelcomeText>Need to set up your app to use Reactotron?</WelcomeText>
      <Container onClick={openDocs}>Check out the docs here!</Container>
    </EmptyState>
  )
}

export default Welcome
