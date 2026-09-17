import React from "react"
import { Motion, spring } from "react-motion"
import { Link } from "react-router-dom"
import styled from "styled-components"

interface SideBarButtonComponentProps {
  icon?: any
  iconColor?: string
  image?: any
  path: string
  text: string
  isActive: boolean
  hideTopBar?: boolean
  iconSize?: number
  isCompact?: boolean
  onPress?: () => void
}

interface SideBarButtonProps {
  $hideTopBar: boolean
  $colorAnimation: number
  $isCompact?: boolean
}

export const SideBarButtonContainer = styled.div.attrs(() => ({}))<SideBarButtonProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: ${(props) => (props.$isCompact ? 44 : 56)}px;
  padding: ${(props) => (props.$isCompact ? "5px 0" : "8px 0")};
  margin: 0 ${(props) => (props.$isCompact ? 6 : 8)}px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  background-color: ${(props) =>
    `color-mix(in srgb, ${props.theme.highlight} ${12 * props.$colorAnimation}%, transparent)`};
  color: ${(props) =>
    `color-mix(in srgb, ${props.theme.highlight} ${
      100 * props.$colorAnimation
    }%, ${props.theme.foregroundDark})`};
  transition:
    background-color 0.12s ease-out,
    border-color 0.12s ease-out;

  &:hover {
    border-color: ${(props) => props.theme.line};
    background-color: ${(props) =>
      props.$colorAnimation > 0.5
        ? `color-mix(in srgb, ${props.theme.highlight} 18%, transparent)`
        : props.theme.surfaceRaised};
    color: ${(props) =>
      props.$colorAnimation > 0.5 ? props.theme.highlight : props.theme.foreground};
  }
`

const Image = styled.img.attrs(() => ({}))<SideBarButtonProps>`
  width: 32px;
  height: 32px;
  padding-bottom: 4px;
  filter: grayscale(${(props) => 100 - 100 * props.$colorAnimation}%)
    brightness(${(props) => 70 + 30 * props.$colorAnimation}%);
`

const Title = styled.div`
  padding-top: 2px;
  text-align: center;
  font-size: 11px;
  line-height: 14px;
`

function SideBarButton({
  icon: Icon,
  iconColor,
  image,
  path,
  text,
  isActive,
  hideTopBar,
  iconSize,
  isCompact,
  onPress,
}: SideBarButtonComponentProps) {
  const resolvedIconSize = iconSize || (isCompact ? 20 : 22)

  return (
    <Motion style={{ color: spring(isActive ? 1 : 0) }}>
      {({ color }) => (
        <Link to={path} title={text} style={{ textDecoration: "none" }} onClick={onPress}>
          <SideBarButtonContainer
            $hideTopBar={hideTopBar || false}
            $colorAnimation={color}
            $isCompact={isCompact}
          >
            {Icon && <Icon size={resolvedIconSize} color={iconColor} />}
            {image && (
              <Image src={image} $hideTopBar={hideTopBar || false} $colorAnimation={color} />
            )}
            {!isCompact && <Title>{text}</Title>}
          </SideBarButtonContainer>
        </Link>
      )}
    </Motion>
  )
}

export default SideBarButton
