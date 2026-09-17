import React, { FunctionComponent } from "react"
import ReactModal from "react-modal"
import styled, { useTheme } from "styled-components"

ReactModal.setAppElement(document.body)

const Title = styled.h1`
  margin: 0;
  padding: 0;
  text-align: left;
  font-weight: 700;
  font-size: 18px;
  color: ${(props) => props.theme.foregroundLight};
`
const KeystrokesContainer = styled.div`
  display: flex;
  align-self: center;
  padding-top: 20px;
  font-size: 13px;
`
export const KeystrokeContainer = styled.div`
  padding: 0 10px;
`
export const Keystroke = styled.span`
  padding: 3px 8px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 6px;
  background-color: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foregroundLight};
`

interface Props {
  isOpen: boolean
  onClose: () => void
  onAfterOpen?: () => void
  title: string
  additionalKeystrokes?: React.ReactNode
}

const Modal: FunctionComponent<React.PropsWithChildren<Props>> = ({
  isOpen,
  onClose,
  onAfterOpen,
  title,
  children,
  additionalKeystrokes,
}) => {
  const theme = useTheme()

  return (
    <ReactModal
      isOpen={isOpen}
      onAfterOpen={onAfterOpen}
      onRequestClose={onClose}
      style={{
        overlay: {
          backgroundColor: theme.modalOverlay,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 40,
        },
        content: {
          display: "flex",
          flexDirection: "column",
          borderRadius: 8,
          padding: 20,
          backgroundColor: theme.surfacePanel,
          color: theme.foreground,
          borderColor: theme.borderSubtle,
          width: 500,
          position: "auto" as any, // TODO: Fix this!
          top: "auto",
          bottom: "auto",
          fontFamily: theme.fontFamily,
        },
      }}
    >
      <div>
        <Title>{title}</Title>
      </div>
      <div>{children}</div>
      <KeystrokesContainer>
        <KeystrokeContainer>
          <Keystroke>ESC</Keystroke> Close
        </KeystrokeContainer>
        {additionalKeystrokes}
      </KeystrokesContainer>
    </ReactModal>
  )
}

export default Modal
