import React from "react"
import styled from "styled-components"

const Button = styled.button.attrs<{ selected: boolean }>((props) => ({
  selected: props.selected ? props.selected : false,
}))`
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
  margin-right: 4px;
  background-color: ${(props) =>
    props.selected ? props.theme.surfaceSelected : props.theme.surfacePanel};
  border-radius: 7px;
  border: 1px solid
    ${(props) => (props.selected ? props.theme.highlight : props.theme.borderSubtle)};
  cursor: pointer;
  color: ${(props) => (props.selected ? props.theme.highlight : props.theme.foregroundDark)};

  &:hover {
    color: ${(props) => props.theme.foreground};
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`

interface OverlayButtonProps {
  title: string
  selected?: boolean
  onClick: React.MouseEventHandler<HTMLButtonElement>
}

export function OverlayButton(props: OverlayButtonProps) {
  const { selected, title, onClick } = props
  return (
    <Button selected={selected} onClick={onClick}>
      {title}
    </Button>
  )
}
