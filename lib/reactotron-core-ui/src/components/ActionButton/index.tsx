import React from "react"
import styled from "styled-components"
import Tooltip from "../Tooltip"
import { type TooltipProps } from "react-tooltip"

const Container = styled.div`
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: 0 3px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: ${(props) => props.theme.foregroundDark};
  -webkit-app-region: none;

  &:hover {
    color: ${(props) => props.theme.highlight};
    border-color: ${(props) => props.theme.borderSubtle};
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`

interface Props {
  tip: string
  tipProps?: TooltipProps
  icon: any
  onClick: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
}

function ActionButton({ icon: Icon, tip, tipProps = {}, onClick }: Props) {
  return (
    <Container data-tip={tip} onClick={onClick}>
      <Icon size={18} />
      <Tooltip {...tipProps} />
    </Container>
  )
}

export default ActionButton
