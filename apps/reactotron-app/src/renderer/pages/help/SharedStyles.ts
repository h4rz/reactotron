import styled from "styled-components"

export const ItemContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 12px 10px;
  margin: 5px;
  flex: 1;
  background-color: ${(props) => props.theme.surfaceChrome};
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  color: ${(props) => props.theme.foreground};

  &:hover {
    border-color: ${(props) => props.theme.highlight};
    background-color: ${(props) => props.theme.surfaceRaised};
  }
`
export const ItemIconContainer = styled.div`
  color: ${(props) => props.theme.highlight};
  margin-bottom: 8px;
`
