import React from "react"
import { shell } from "electron"
import { Header } from "@hurajgor/reactotron-core-ui"
import styled from "styled-components"
import {
  MdAlternateEmail as TwitterIcon,
  MdOutlineCode as RepoIcon,
  MdOutlineFeedback as FeedbackIcon,
  MdOutlineNewReleases as ReleaseIcon,
} from "react-icons/md"
import { ItemContainer, ItemIconContainer } from "./SharedStyles"
import { reactotronLogo } from "../../images"

const projectJson = require("../../../../package.json")

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`
const HelpContainer = styled.div`
  padding: 20px;
  overflow-y: auto;
  overflow-x: hidden;
`
const LogoContainer = styled.div`
  display: flex;
  justify-content: center;
`
const LogoImage = styled.img`
  height: 72px;
  margin: 14px 0 20px;
`
const Title = styled.div`
  font-size: 18px;
  margin: 10px 0;
  padding-bottom: 2px;
  color: ${(props) => props.theme.foregroundLight};
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
`
const ConnectContainer = styled.div`
  display: flex;
  align-items: flex-start;
  color: ${(props) => props.theme.foreground};
  margin-bottom: 50px;
`

function openRepo() {
  shell.openExternal("https://github.com/hurajgor/reactotron")
}

function openFeedback() {
  shell.openExternal("https://github.com/hurajgor/reactotron/issues/new")
}

function openUpdates() {
  shell.openExternal("https://github.com/hurajgor/reactotron/releases")
}

function openTwitter() {
  shell.openExternal("https://twitter.com/reactotron")
}

function Help() {
  return (
    <Container>
      <Header title={`Using Reactotron ${projectJson.version}`} isDraggable />
      <HelpContainer>
        <LogoContainer>
          <LogoImage src={reactotronLogo} />
        </LogoContainer>
        <Title>Let&apos;s Connect!</Title>
        <ConnectContainer>
          <ItemContainer onClick={openRepo}>
            <ItemIconContainer>
              <RepoIcon size={22} />
            </ItemIconContainer>
            GitHub Docs
          </ItemContainer>
          <ItemContainer onClick={openFeedback}>
            <ItemIconContainer>
              <FeedbackIcon size={22} />
            </ItemIconContainer>
            Feedback
          </ItemContainer>
          <ItemContainer onClick={openUpdates}>
            <ItemIconContainer>
              <ReleaseIcon size={22} />
            </ItemIconContainer>
            Updates
          </ItemContainer>
          <ItemContainer onClick={openTwitter}>
            <ItemIconContainer>
              <TwitterIcon size={22} />
            </ItemIconContainer>
            @reactotron
          </ItemContainer>
        </ConnectContainer>
      </HelpContainer>
    </Container>
  )
}

export default Help
