import React, { type MouseEvent } from "react"
import styled from "styled-components"

interface OverlayAlignmentButtonProps {
  justifyContent: string
  alignItems: string
  selectedJustifyContent: string
  selectedAlignItems: string
  onClick: (justifyContent: string, alignItems: string) => void
}

const Button = styled.button.attrs<{ selected: boolean }>((props) => ({
  selected: props.selected ? props.selected : false,
}))`
  height: 28px;
  width: 28px;
  background-color: ${(props) =>
    props.selected ? props.theme.surfaceSelected : props.theme.surfacePanel};
  border-radius: 6px;
  border: 1px solid
    ${(props) => (props.selected ? props.theme.highlight : props.theme.borderSubtle)};
  margin: 3px;
  cursor: pointer;

  &:hover {
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`

export function OverlayAlignmentButton(props: OverlayAlignmentButtonProps) {
  const { justifyContent, alignItems, selectedJustifyContent, selectedAlignItems } = props
  const isSelected = justifyContent === selectedJustifyContent && alignItems === selectedAlignItems

  const handleAlignmentChange =
    (justifyContent: string, alignItems: string) => (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      event.preventDefault()
      props.onClick(justifyContent, alignItems)
    }

  return (
    <Button selected={isSelected} onClick={handleAlignmentChange(justifyContent, alignItems)} />
  )
}
