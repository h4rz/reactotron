import React, { useContext } from "react"
import styled from "styled-components"
import { Header, ReactNativeContext } from "@hurajgor/reactotron-core-ui"
import {
  MdOutlineAutoStories,
  MdOutlinePhotoCamera,
  MdOutlineRadioButtonChecked,
  MdOutlineRadioButtonUnchecked,
  MdOutlineWarningAmber,
} from "react-icons/md"
import { storybookActiveImg, storybookInactiveImg } from "../../images"

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`

const StorybookContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TopSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`

const StorybookLogo = styled.img`
  width: 220px;
  height: auto;
  padding-bottom: 20;
`

const ToggleContainer = styled.div`
  display: flex;
  gap: 6px;
  color: ${(props) => props.theme.foreground};
`
const RadioButton = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 8px 10px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  color: ${(props) => props.theme.foregroundDark};

  &:hover {
    color: ${(props) => props.theme.highlight};
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`

const WarningContainer = styled.div`
  display: flex;
  color: ${(props) => props.theme.warning};
  background-color: ${(props) => props.theme.backgroundDarker};
  border-top: 1px solid ${(props) => props.theme.borderSubtle};
  align-items: center;
  padding: 12px 20px;
`
const WarningDescription = styled.div`
  margin-left: 20px;
`

function Storybook() {
  const { isStorybookOn, turnOffStorybook, turnOnStorybook } = useContext(ReactNativeContext)

  return (
    <Container>
      <Header
        isDraggable
        tabs={[
          {
            text: "Image Overlay",
            icon: MdOutlinePhotoCamera,
            isActive: false,

            onClick: () => {
              // TODO: Couldn't get react-router-dom to do it for me so I forced it.
              window.location.hash = "#/native/overlay"
            },
          },
          {
            text: "Storybook",
            icon: MdOutlineAutoStories,
            isActive: true,
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            onClick: () => {},
          },
        ]}
        // actions={[
        //   {
        //     tip: "Search",
        //     icon: MdSearch,
        //     onClick: () => {
        //       toggleSearch()
        //     },
        //   },
        //   {
        //     tip: "Filter",
        //     icon: MdFilterList,
        //     onClick: () => {
        //       openFilter()
        //     },
        //   },
        //   {
        //     tip: "Reverse Order",
        //     icon: MdSwapVert,
        //     onClick: () => {
        //       toggleReverse()
        //     },
        //   },
        //   {
        //     tip: "Clear",
        //     icon: MdDeleteSweep,
        //     onClick: () => {
        //       clearSelectedConnectionCommands()
        //     },
        //   },
        // ]}
      />
      <StorybookContainer>
        <TopSection>
          <StorybookLogo src={isStorybookOn ? storybookActiveImg : storybookInactiveImg} />

          <ToggleContainer>
            <RadioButton onClick={() => turnOnStorybook()}>
              {isStorybookOn ? (
                <MdOutlineRadioButtonChecked size={18} />
              ) : (
                <MdOutlineRadioButtonUnchecked size={18} />
              )}
              <div>On</div>
            </RadioButton>
            <RadioButton onClick={() => turnOffStorybook()}>
              {isStorybookOn ? (
                <MdOutlineRadioButtonUnchecked size={18} />
              ) : (
                <MdOutlineRadioButtonChecked size={18} />
              )}
              <div>Off</div>
            </RadioButton>
          </ToggleContainer>
        </TopSection>
        <WarningContainer>
          <MdOutlineWarningAmber size={20} />
          <WarningDescription>
            This is preview feature. It requires a specific setup of Storybook within React Native.
          </WarningDescription>
        </WarningContainer>
      </StorybookContainer>
    </Container>
  )
}

export default Storybook
