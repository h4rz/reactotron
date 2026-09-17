import React from "react"
import { Motion, spring } from "react-motion"
import styled from "styled-components"

interface Props {
  icon: any
  text: string
  isActive: boolean
  onClick: () => void
}

interface HeaderTabButtonProps {
  $colorAnimation: number
}

const HeaderTabButtonContainer = styled.div.attrs(() => ({}))<HeaderTabButtonProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 12px;
  margin: 0 4px;
  border-radius: 8px;
  cursor: pointer;
  background-color: ${(props) =>
    `color-mix(in srgb, ${props.theme.highlight} ${14 * props.$colorAnimation}%, transparent)`};
  color: ${(props) =>
    `color-mix(in srgb, ${props.theme.foregroundLight} ${
      100 * props.$colorAnimation
    }%, ${props.theme.highlight})`};
  -webkit-app-region: none;

  &:hover {
    background-color: ${(props) =>
      props.$colorAnimation > 0.5
        ? `color-mix(in srgb, ${props.theme.highlight} 18%, transparent)`
        : props.theme.surfaceRaised};
  }
`

const Title = styled.div`
  padding-top: 2px;
  text-align: center;
  font-size: 12px;
`

function HeaderTabButton({ icon: Icon, text, isActive, onClick }: Props) {
  return (
    <Motion style={{ color: spring(isActive ? 1 : 0) }}>
      {({ color }) => (
        <HeaderTabButtonContainer $colorAnimation={color} onClick={onClick}>
          {Icon && <Icon size={20} />}
          <Title>{text}</Title>
        </HeaderTabButtonContainer>
      )}
    </Motion>
  )
}

export default HeaderTabButton
